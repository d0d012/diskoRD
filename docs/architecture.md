# Architecture notes

Runtime behavior that isn't obvious from a single file. For the stack and feature list see the [README](../README.md).

## Gateway (`backend/internal/gateway`)

- Single `/gateway` WebSocket. Events look like `{ "op": "MESSAGE_CREATE", "d": { ... }, "s": 42 }`.
- Guild-scoped events fan out across backend instances via Redis Pub/Sub; direct user and DM notifications go through the local hub only.
- Per-client guild routing sets are mutex-guarded (`Client.HasGuild/AddGuild/RemoveGuild`).
- Heartbeat/ping-pong is implemented; session resume is not.
- Presence lives at `presence:{userId}` (TTL, heartbeat-refreshed). The stored value is the user's **preferred** status (`online | idle | dnd | invisible`); `invisible` is mapped to `offline` by `presence.Visible` on the way out, so other clients never see it. `READY` carries the visible statuses plus `me.preferredStatus` for the client's own picker, and `PRESENCE_UPDATE` stays `{ userId, status }` with `status ∈ online|idle|dnd|offline`.
- Presence and profile-change audiences are resolved from the DB (`guild_members`, `dm_channels`), not the in-memory connection map, so the last disconnect still reaches guild members with `offline`.
- `USER_UPDATE` carries the public profile (`id, username, displayName, avatarUrl, bio, bannerColor`) and is published to every guild the user belongs to, every DM partner, and the user themself; the self copy also carries `preferredStatus`. Avatars change URL on every upload, so clients never need cache-busting.
- In dev, Vite must proxy `/gateway` (ws) to the backend — without it every realtime event silently stops arriving.

## Auth & sessions (`backend/internal/auth`, `frontend/src/lib/api.ts`)

- Access token: JWT, 15 min (`JWT_ACCESS_EXPIRY`). Refresh token: opaque, stored hashed in Redis (`refresh:{sha256}`), `JWT_REFRESH_EXPIRY=8760h`, renewed on every refresh so active accounts stay signed in.
- Refresh tokens rotate on use; the old token stays valid for a 30 s grace window so a lost response or two racing clients don't end the session.
- `POST /auth/login` accepts `rememberMe` (default `true`); `false` limits the session to 24 h.
- Redis runs with `appendonly yes` so sessions survive restarts. Wiping Redis or changing `JWT_ACCESS_SECRET` logs everyone out.
- Frontend: one shared `refreshSession()` (concurrent callers share a request), refreshing ~2 min before expiry and on focus/visibility/online. Only an explicit 400/401/403 from `/auth/refresh` logs the user out; network errors, 5xx and 429 retry with backoff and keep credentials. The rotated refresh token is persisted before anything else.
- `useGateway` reconnects with the freshest token (backoff 1–30 s, immediate on focus) and refreshes on close code 4001.

## Profiles & presence (`backend/internal/user`, `frontend/src/stores/userStore.ts`)

- `PATCH /users/me` updates `displayName`, `bio` (max 190 runes) and `bannerColor` (`#rrggbb` or `""` to clear); `nil`/omitted means unchanged, `""` clears to NULL. It deliberately has no `avatarUrl` — avatars are only set by `POST /users/me/avatar` (content-sniffed, image-only, 8 MB, rate-limited) and cleared by `DELETE /users/me/avatar`.
- Guild icons work the same way: owner-only `POST /guilds/:id/icon` / `DELETE /guilds/:id/icon` (sniffed via `storage.SniffImage`, stored under `uploads/guild-icons/{guildId}/`), and `PATCH /guilds/:id` has no `iconUrl`. `GUILD_UPDATE` always carries `iconUrl` (null when removed) because the client merges guild updates into existing state.
- `PUT /users/me/presence` stores the preferred status and leaves the live presence value to the hub (`SET ... XX KEEPTTL`), so choosing a status only takes effect while connected.
- Public user payloads never include the live status; the frontend `userStore` is a live overlay seeded from members/friends/DMs/messages and kept fresh by `USER_UPDATE`, resolved through `useLiveUser`.

## DM calls (`backend/internal/call`, `frontend/src/features/call`)

- Redis state: `call:{channelId}` hash (`caller`, `callee`, `state` = ringing|active) plus `usercall:{userId}` for busy checks.
- Rings time out after 30 s (`CALL_TIMEOUT` to both sides). Active calls expire after 90 s unless clients ping `POST /dms/:id/call/keepalive` (every 30 s).
- Initiate returns 409 if either user is busy or the DM is already ringing; only the callee can accept/decline. If the DM has an *active* call, a new Initiate from either member replaces it (and sends `CALL_END` to the other side): the caller's client can't be in a call when it initiates, so that call died on their side (crash, reload, lost hang-up). Legacy string-typed `call:*` keys from older builds are deleted on read.
- `DMCallPanel` is mounted app-wide in `AppPage` (remote audio via `GlobalVoiceAudio`), hangs up if the other side leaves the LiveKit room, and ends the call on `pagehide`/logout. Joining a DM call leaves any guild voice channel. On desktop the call's video shows in the separate call window (see Desktop); on the web it's an in-app card that can be dragged, resized, collapsed and hidden. Either way the sidebar "Call Connected" bar brings it back.

## Voice (`backend/internal/voice`, `frontend/src/hooks/useVoice.ts`)

- `POST /channels/:id/voice/token` returns a LiveKit JWT. Room name: `guild:{guildId}:channel:{channelId}`. `POST /channels/:id/voice/viewer` returns a hidden, subscribe-only token for the desktop call window (only for someone in the channel).
- Voice state lives in Redis at `voice_state:{channelId}`; presence at `presence:{userId}` (TTL).
- Coturn (TURN/STUN) exists only in the production compose file. Local LiveKit doesn't forward its UDP range (see README), so local media runs over ICE/TCP on 7881.

### Soundboard

- `Soundboard` is a nonmodal, anchored popover shared by the voice control bar, persistent sidebar voice controls, and DM call header. The desktop call window has its own sound grid that sends play commands to the main window, where the session lives. Search filters a compact grid; preview mode changes clicks to local-only playback. Clicking sounds keeps the board open. Escape restores trigger focus; outside clicks dismiss without blocking the underlying voice controls.
- `attachSoundboard(room, guildId?)` owns playback independently of panel navigation. The guild is the **connected voice guild**, never the guild currently being browsed. DM calls have built-in sounds only. Six licensed recordings are bundled in `frontend/public/sounds/soundboard/` and predecoded on joining; custom clips use the same cached AudioBuffer playback path. There is no runtime synthesis or third-party audio fetch. The popover links to `CREDITS.txt` with creators, source URLs, licenses, and conversion details.
- Reliable LiveKit data on `diskord.soundboard.v2` carries a catalog ID, timestamp and unique event UUID, never arbitrary URLs/audio. Local feedback starts before waiting for publish completion. Listeners deduplicate event IDs, reject oversized packets, and drop late ones without trusting the sender's clock: `createFreshnessFilter` learns each sender's offset from the smallest observed receive−send delta and drops packets more than 5 seconds slower than that (three rejections in a row re-learn the baseline, for clocks corrected backwards). A skewed PC clock used to silence that user in both directions, and resolve custom IDs only from the current guild catalog. All clients need the v2 implementation; old v1 boards do not interoperate.
- Every trigger starts its own voice, so repeated clicks (same or different sounds, same or different senders) stack instead of cutting each other off; a newer trigger never cancels an earlier one that is still loading. There is **no clip-duration lock or two-second cooldown**. A token bucket permits eight immediate triggers and refills ten per second; each listener independently applies the same flood limit. At most 16 voices play at once; past that the oldest voice is stopped for the newest rather than queuing. A compressor bounds the combined soundboard mix; individual custom clips are peak-limited.
- Existing LiveKit publish/data grants govern broadcast access. The normal client also requires connected, unmuted, undeafened state; previews never publish. Self-mute/deafen remain client controls, not server moderation boundaries. Listener-only volume (default 50%) multiplies participant volume and affects active clips. Deafen and Stop immediately cancel active and pending playback; Stop is local only. Preferences last for the app lifetime.
- Reconnect/disconnect stops active playback; departure stops that participant. Cleanup aborts audio downloads, clears decoded buffers, disconnects audio nodes/listeners, and closes the AudioContext. Async work cannot play after disposal, a session transition, a newer trigger, or a local stop. Autoplay-locked sounds are dropped, not replayed after the next gesture; the board shows an unlock hint. Reliable delivery is not a playback acknowledgment.

#### Guild uploads (`backend/internal/soundboard`)

- Apply migration **000016** manually before using guild sounds. `GET/POST /guilds/:id/sounds`, `GET /guilds/:id/sounds/:soundId` and `DELETE /guilds/:id/sounds/:soundId` all require authentication and guild membership. **Every member** may upload, not just admins. Deletion is limited to the uploader or a moderator/admin/owner; list metadata includes the caller's `canDelete` flag.
- The inline Add sound form accepts browser-decodable audio (MP3/WAV/Ogg etc.), at most 8 MB and 5 minutes of input. `SoundTrimmer` shows the waveform (an overview strip plus a 45-second detail window for long files) and lets the member pick a clip of up to 15 seconds (`MAX_SOUND_SECONDS`, migration 000019) by dragging the edges or the selection, or with arrow keys. Preview plays only the selection; nothing is uploaded until Add sound, when `renderSoundClip` renders the selection with 8 ms fades. The client downmixes/resamples to mono 24 kHz PCM16 WAV. The server independently validates the exact canonical header, sample format, byte counts and ≤720,044-byte duration bound (`soundboard.MaxAudioBytes`, which must match `MAX_SOUND_WAV_BYTES` on the client); extensions, MIME types and client duration claims are not trusted.
- At most 48 clips per guild, enforced under a guild-row transaction lock so concurrent uploads cannot bypass the quota. Uploads also use the existing Redis HTTP rate limiter (10/minute per IP/path). The bounded catalog is returned as one list.
- Small canonical clips are stored as PostgreSQL BYTEA alongside metadata, served inside the existing authenticated JSON envelope as base64. This avoids another media service, public file URLs and orphan-file cleanup, works across backend instances, and cascades on guild deletion. Deleted users leave creatorless sounds removable by moderators. Include `guild_sounds` in normal DB backups.
- Successful uploads/deletions emit guild-scoped `SOUNDBOARD_UPDATE` over the existing gateway/Redis fanout. Voice sessions refresh metadata and predecode sounds with three concurrent requests; opening the board and reconnecting also refresh. A first trigger racing the catalog event gets a bounded metadata retry. Unknown IDs are never fetched directly. Late downloads (>2 seconds for remote playback) are dropped rather than surprising listeners. Deleted clips are evicted and stopped.

Manual smoke test: use two clients in a guild voice channel; open from sidebar and full voice controls, search and rapidly retrigger a sound, toggle local preview, and keep talking/navigating. Upload as an ordinary member; verify another client sees and hears it without reopening. Exercise invalid/overlong files, quota/network errors, deletion by uploader/moderator vs another member, mute/deafen/volume-zero, simultaneous senders, reconnect, switching guilds, and hangup during download/playback. Repeat built-ins in DM calls. Check WebKit/Tauri autoplay before/after a gesture, and popover positioning at viewport edges.

## Image attachments (`backend/internal/message`, `backend/internal/storage`)

- `POST /channels/:id/upload` creates the message, writes the file to `{STORAGE_PATH}/{messageId}/image.{ext}` (`storage.Service.Save`), stores the public URL in `messages.attachments` (`TEXT[]`, migration **000021**), then publishes `MESSAGE_CREATE` with it. Pasted images and pixel art "Send to chat" use the same endpoint.
- URLs are `{baseURL}/uploads/{messageId}/image.{ext}`; `baseURL` is empty in production (nginx serves `/uploads`), `http://localhost:{APP_PORT}` otherwise. List, get, create and edit all return `attachments`.
- Before 000021 the URL was never stored, so older image messages lost their image on reload although the file stayed on disk. **Deploying 000021 to an existing server:** run the migration (`scripts/update.sh` does), then the one-off backfill inside the backend container. It scans the uploads volume for message-UUID directories (skipping `avatars/` and `guild-icons/`) and fills `attachments` only where it is empty, so re-running it is harmless; `-dry-run` only counts.

  ```bash
  docker compose -f infra/docker-compose.prod.yml --env-file .env.prod exec -T backend ./backfill-attachments
  ```

  Locally: `cd backend && go run ./cmd/backfill-attachments` (reads `.env` / `STORAGE_PATH` like the server).

## Pixel art & decorations (`frontend/src/features/pixelart`, `backend/internal/decoration`, `backend/internal/pixelart`)

- The editor is client-only. Art is indexed color (`PixelArtDoc`: width × height from `CANVAS_PRESETS` (16–256 squares, plus the banners 100 × 32 and 150 × 48), ≤ 64 colors, base64 indices with 0 = transparent). The server's `allowedSizes` must list the same shapes. The server caps a doc at 128 KB and width×height×frames at 256², so a 256 canvas carries one frame. The view zooms (Ctrl/⌘+wheel, ±, 0) and pans (Space or middle drag); brushes are 1–4 px.
- **Import** (`lib/importImage.ts`): `suggestImport` detects pixel art saved at an integer zoom (uniform blocks, `detectPixelScale`), undoes the zoom losslessly and suggests a 1:1 import on the smallest canvas that fits. Other images get smooth area-averaged scaling into 64×64. "All" colors keeps exact colors up to 64; "Fewer" runs k-means seeded with farthest-point colors. Images load with nearest-neighbour scaling (≤ 2048 px) so block detection survives. "Send to chat" uploads a 512px nearest-neighbour PNG through the normal image upload; `.pixel.json` is the lossless import/export format. The draft lives in `localStorage`.
- **Decorations** drop a copy of a doc anywhere in a chat's history. The chat is one borderless canvas, but each piece is anchored to the message under the pointer, so it scrolls and paginates with that message (`message_decorations`, migration **000020**; apply it manually before deploying a backend that serves them).
  - `POST /messages/:id/decorations` `{doc, x 0–100, y −256…1024 px from the anchor row's top, size 32/48/64/96/128/192/256 (migration **000023**), opacity 10–100 %}` and `DELETE /decorations/:id`, both rate limited. x spans the row width minus the piece, so pieces never leave the chat horizontally. The y bounds live in `decoration.MinY/MaxY` and `DECORATION_MIN_Y/MAX_Y`, which must match.
  - `pixelart.Validate` checks and canonicalizes every doc server-side.
  - At most 3 per message, enforced under a `FOR UPDATE` lock on the message row.
  - Removal is allowed for the placer, the message author, or a guild owner/admin/moderator.
  - `GET /channels/:id/messages` attaches `decorations`. A failure to load them is logged and the page is returned without them.
  - `DECORATION_ADD` / `DECORATION_REMOVE` use the reaction fanout (guild or DM pair). The client's `updateMessage` keeps existing decorations, because edit events don't carry them.
- **Rendering:** each decoration is an `<img>` (data URL cached per distinct doc) inside its anchor row, using `z-index: -1`, its own opacity (migration **000022**; the placement bar offers 35/60/100 %, the last choice is remembered per device, and requests without one get 35 %) and `pointer-events: none`. The message list wrapper is the only stacking context (`isolation: isolate`); rows must not create their own (no z-index, transform or isolation). That way every piece paints behind every row's text, whichever rows it overlaps. There are no scroll listeners or measurement passes; `MessageList` ignores decoration image loads when following the bottom. "Hide Decorations" is a per-device setting (`settings.showDecorations`).
- **Placing:** "Place in chat" in the editor (from the composer, or from a message's "Decorate with Pixel Art") sets `decorationPlacementStore`. `MessageList` then shows `PlaceDecoration` over the list: a ghost follows the pointer, the wheel keeps scrolling the history (re-dispatched to the list so it stops following the bottom), +/− or Ctrl/Alt+wheel resize, a click places it and Escape cancels. Switching channels cancels a pending placement.

### Gallery, showcase, remix and buddies (`backend/internal/pixelart`, `frontend/src/stores/pixelArtStore.ts`)

- Migration **000024** adds `pixel_arts` and `profile_buddies`.
  - `pixel_arts`: a gallery of up to 50 pieces per user, with the quota enforced under a `FOR UPDATE` lock on the user row. `showcase_position` is 0–14, with a unique partial index per owner. `remix_of` and `remix_author_id` survive the source being deleted.
  - `profile_buddies`: up to 5 per user; `x` is % of the card width, `y` is px from the card top, `height` is 16–128, plus `flip` and `front`.
- **Routes.** The `/users/me/...` routes are registered one by one, never through a `Group` with middleware: Fiber runs group middleware for every route under the prefix, including other packages' routes.
  - `GET/POST /users/me/pixel-arts`, `PATCH/DELETE /users/me/pixel-arts/:id`, `PUT /users/me/showcase {ids}` (ordered, own pieces only) and `PUT /users/me/buddies {buddies}` replace the stored values.
  - `GET /users/:id/pixel-profile` returns `{showcase, buddies}` (buddies with their docs) to any signed-in user, like the profile itself.
- **Remix.** A remix must come from a showcased piece or one of your own. It credits the source's owner, and remixing your own remix keeps the original credit.
- **Live updates.** Every change emits `PIXEL_PROFILE_UPDATE {userId}` through `Hub.PublishToUserAudience`, which reaches the same audience as `USER_UPDATE`. It is a separate op so partial payloads can't clobber profile fields. Clients refetch only the profiles they have loaded.
- **Editor.** The editor reads the gallery from `pixelArtStore`: My art (open, star onto the profile, delete) and Save (title, show on profile, save changes or a copy, Ctrl/⌘+S). It can start from a given piece, for opening one or for a credited remix.
- **Profile card.**
  - `ProfileShowcase` shows five 46px tiles and a "+N" tile that expands in place. Tiles open `ShowcaseViewer`: integer-scaled and pixel-perfect, with prev/next, Remix (others' pieces) or Edit and reorder (your own), and PNG download.
  - `ProfileBuddies` draws the buddies. The card is one stacking context: banner < behind buddies (z 1) < card content (z 2) < front buddies (z 3). Tops use `min(y, 100% − height)` so buddies never leave a short card.
  - Arrange mode on your own card has a toolbar next to the card. Sizes snap to whole-number zooms of the trimmed art.
  - The card stays open while the viewer, editor or arrange mode is on top; Escape closes only the topmost.
- **Display.** Thumbnails and buddies use `trimmedImage`, which crops transparent borders, and `fitScale` (whole numbers when enlarging, smooth when shrinking).

### Banners and the showcase museum

- **Banners (migration 000025).**
  - `profile_banners` holds one row per user, with exactly one of `builtin` (an id from `pixelart.BuiltinBanners`) or `doc` (a 100 × 32 or 150 × 48 drawing).
  - `PUT /users/me/banner {builtin | doc}` and `DELETE /users/me/banner`; `pixel-profile` returns `banner`.
  - The six built-in scenes are drawn in code by `lib/banners.ts`, for both banner sizes. Its ids must match the Go allowlist.
  - The card shows the banner at ×3 (100 × 32) or ×2 (150 × 48). The Banner picker sits beside your own card. "Edit or draw your own" opens the current banner in the editor with a "Use as banner" `primaryAction`.
  - The editor only autosaves the chat draft when it was opened without `initial` art.
- **Showcase museum.**
  - `ShowcaseMuseumHost` (mounted in `AppPage`) shows `ShowcaseMuseum` for `useShowcaseOverlayStore.userId`. It is opened by "View all" on the card, "My showcase" in both user panels (`ChannelSidebar`, `FriendsSidebar`), and "View Showcase" in the message menu.
  - **Rendering.** Everything is pixel art at one room zoom `S` (×2–×4 from the window size). `museumArt.ts` generates tiny tiles and sprites (wallpaper, wainscot, floor, carpet, lamp, light cone, glass streaks, glint) that CSS scales with `image-rendering: pixelated`. Light cones stop above the art so the piece stays clean.
  - **Layout and text.** The first showcase piece is the hero case. The banner hangs as a framed painting. Plaques and signs use the bundled Silkscreen font (`@fontsource/silkscreen`, OFL).
  - **Interaction.** Owners reorder with native drag and drop ("Arrange" → "Save order" → `PUT /users/me/showcase`). Escape closes the topmost layer: viewer, then arranging, then the museum.

## Desktop (`frontend/src-tauri`)

- Closing the main window (title-bar ✕, Alt+F4, Cmd+W) hides it to the system tray / menu bar; voice and the gateway keep running. Left-clicking the tray icon, the tray "Open diskoRD" item, the macOS Dock icon, or a second launch / `diskord://` link shows it again. Only the tray "Quit diskoRD" item (or Cmd+Q on macOS) exits.
- The webview ignores `target="_blank"`, so `installExternalLinkHandler` (`frontend/src/lib/externalLinks.ts`) sends clicks on external `http(s)`/`mailto`/`tel` links to the default browser via `tauri-plugin-opener`; links a component already handled (in-app invites) are skipped. Use `openExternal(url)` instead of `window.open`.
- Keep `@tauri-apps/plugin-*` npm packages on the same minor as their Rust crates; newer opener releases require `@tauri-apps/api` 2.11, so it is held at 2.5.
- Desktop call window (`call-view`, `frontend/src/features/call/CallViewWindow.tsx`, loaded as `index.html?view=call`): a separate, frameless, always-on-top OS window for a DM call or a guild voice channel. The call itself — mic, camera, mute/deafen, soundboard, hang-up — always stays in the main window; the window joins as a hidden, subscribe-only, video-only viewer (`POST /dms/:id/call/viewer` or `POST /channels/:id/voice/viewer`, identity `{userId}:viewer`, issued only to someone in that call) because a second webview can't share the main window's media. Its buttons send commands to the main window, which echoes the resulting state. Protocol in `lib/callView.ts`, main-window side in `hooks/useCallViewHost.ts` (one host per kind; only the active one answers, and a host only closes a window it opened). DM calls open it automatically and replace the in-app card on desktop; guild voice keeps the in-app panel and opens the window from the voice control bar or the sidebar bar. The window asks for a token only while it has none — re-sending tokens reconnects it and blacks out video — and uses no adaptive stream for the same reason. Both windows set `backgroundThrottling: "disabled"` (macOS 14+; Windows/WebView2 doesn't throttle pages with live WebRTC/audio). Its capability (`capabilities/call-view.json`) only allows dragging, resizing, closing and always-on-top.
