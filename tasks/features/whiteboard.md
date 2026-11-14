# Feature: Board (whiteboard channels)

## Goal

A third channel type, **Board**, next to Text and Voice: a versatile, general-purpose infinite collaborative canvas in the spirit of FigJam and Excalidraw, with diskoRD's own look. It should support a broad range of uses; e.g., game-dev planning (tasks, to-dos and progress laid out in frames and sticky notes), teaching (one friend explains on the board while everyone is in voice), and collage / moodboard (images, pixel art and notes arranged for looks). These are illustrative examples, not modes, and nothing in the engine is specialised for them.

Priority is identity over speed: we write **our own engine**. No Excalidraw (custom object types are impossible without a fork) and no tldraw (production licence key, watermark). Small MIT helpers such as `perfect-freehand` are fine.

## Decisions

| Topic | Decision |
|---|---|
| Rendering | DOM/SVG. Every object is a React component styled with our tokens, in one ordered stack inside a single camera-transformed root. No `<canvas>` in v1; revisit only if the benchmark fails |
| UI name | "Board" (channel type value `whiteboard`) |
| Sync | Server-authoritative. One board-wide `seq`; an object's `version` is the board `seq` of its last write (monotonic even across delete and re-create). Optimistic concurrency via `expectedVersion`. No CRDT |
| Writes | Mutations are an HTTP `POST` (request/response ack, error envelope, rate limiting, easy tests); only the resulting commit is broadcast over the gateway. A command is all-or-nothing |
| Write frequency | A drag travels as ephemeral presence and becomes **one** write on pointer-up. Text commits on blur or after a 500 ms pause, never per keystroke |
| Recovery | On join, on every gateway `READY`, or on a `seq` gap that is still open after 300 ms, the client refetches the whole board and re-applies its pending ops on top. No operation log, no replay in v1 |
| Idempotency | Every command carries a client `opId`; the server remembers it in Redis for 10 minutes and returns the original result on a resend. A pending op with no answer after 5 s is resent once, then triggers a refetch |
| Conflicts | Stale write is rejected with the server's current objects (`gone` if the object no longer exists) and the client adopts them. Dragging/editing is advertised through presence so others see a soft lock before they collide |
| Undo | Local, own actions only; an undo is a normal conditional write and is skipped for objects someone else changed since. Undo waits for the op it reverts to be acknowledged |
| Scale assumption | Production runs a single backend instance; ordering relies on a per-board mutex around commit + publish. Multi-instance ordering is out of scope |
| Frames | No parent/child tree. Dragging a frame moves the objects whose centre is inside it at pointer-down |
| Fonts | Sticky notes use a bundled OFL handwriting font via `@fontsource` (candidate: Patrick Hand; must render Turkish glyphs `ğ ş ı İ ç ö ü`). Text objects use the app font |
| Permissions | v1: every guild member can view and edit; creating/renaming/deleting the channel follows existing channel rules |

## v1 scope

**Tools** (key): Select `V`, Hand `H` (also Space-drag, middle-drag), Pen `P`, Sticky `S`, Rectangle `R`, Ellipse `O`, Line `L`, Arrow `A`, Text `T`, Frame `F`, Image `I`. Pen and Arrow stay active; the others create one object and return to Select.

**Objects**

| Object | v1 behaviour |
|---|---|
| Stroke | `perfect-freehand` outline as an SVG path; two presets (pen, marker); after pointer-up it is a normal object (move, resize, recolour, delete). Max 2,048 points and 32 KB, simplified on finish |
| Rect / Ellipse | 8 handles, Shift keeps aspect, stroke colour from the palette, fill none / tint / solid, two weights |
| Line / Arrow | Straight, two endpoint handles, Shift snaps to 15°. Not attached to objects |
| Text | Width handles reflow, corner handles step the size (S/M/L/XL); bold, italic, colour, alignment per object |
| Sticky | 200×200 base, four colours (yellow, pink, mint, sky), handwriting font that auto-fits down to 14px then grows the note downward |
| Image | Upload, paste or drop; aspect-locked resize; double-click enters crop mode; "Crisp pixels" toggle (`image-rendering: pixelated`). Can also be picked from the pixel-art gallery, which enables crisp pixels automatically |
| Frame | Labelled rectangle drawn behind other objects; draggable only by its label or border, so a drag inside starts a marquee |

**Canvas:** pan (wheel / two-finger scroll), zoom around the cursor (Ctrl/⌘-wheel, pinch) clamped to 10–400%, dot grid that fades out when zoomed far out, zoom-to-fit (`Shift+1`), marquee select, Shift-click, `Ctrl/⌘+D`, arrow-key nudge, `[` / `]` send to back / bring to front, copy/paste, Delete, undo/redo. Double-click on empty canvas creates a text object. Shape drags under 6px create a default-sized object instead of a speck.

**Layout:** normal channel header; members panel hidden by default on a board (`MainLayout` always renders it today and it has no collapse state, so this is new work); floating bottom toolbar (opaque app-elevated surface, 14px radius, no blur); a contextual style bar above the selection instead of a permanent inspector; undo/redo bottom-left; zoom control bottom-right.

**Collaboration:** named coloured cursors with idle fade, other people's selections outlined in their colour, "typing…" tag while they edit text, soft lock on an object someone else is dragging or editing, small avatars of people on the board in the header.

## Design direction

- Blend the owner's dark FigJam mood with diskoRD's pixel-art identity, not a 1:1 mockup copy.
- Keep the navy canvas, 24px dot grid, four bright sticky fills/inks, Caveat and named cursor pills.
- Use app blurple for selection, active tools and frame chips; purple remains an ink colour only.
- Reserve bundled Silkscreen for small machine labels; use square dark-outlined handles and crisp stepped cursor arrows.
- Centre an opaque elevated dock with the app shadow/top edge, neutral icons, a pen ink dot and springing white active/hover pills.
- Give stickies a 6px darker adhesive band and deterministic ±1.5° rest tilt; pickup straightens/lifts to 1.03, drop settles, hover never scales.
- Brighten every fifth grid dot; minor dots fade out below 30% zoom and major dots persist down to 15%.
- Keep frames transparent and shadowless with a 1.5px blurple border at 35%; put chip + title outside the top-left corner.
- Use radii of 8px for objects, 14px for dock, 10px for popovers/style bar and 4px for chips; pills only for cursor tags/reactions; zoom stays bottom-right.
- Match app motion: 150ms pop-in, 100ms deletion fade, app spring/expo easings and reduced-motion support; no gradients, glass, infinite/ping animations or FPS watermark.

## Out of scope for v1

Rotation, arrows bound to objects, curved arrows, text inside shapes, highlighter, Alt-drag duplicate, grouping, layer panel, free colour picker, partial eraser, per-character text styling, role-based read-only boards, boards in DMs, mobile/touch-first editing.

## Later phases

- **v1.1:** checkbox lines in text (`- [ ]`, clickable), laser pointer (ephemeral trail), speaking halo on cursors from LiveKit state, "Follow me" presenter view, emoji reaction chips on stickies, minimap, idle cursors turning into the user's buddy, snapping/alignment guides, buddy empty state.
- **v2:** timed voting, pixel-art stamp stickers, a few starter templates (e.g. sprint board, loop diagram, lecture, moodboard, sprite critique wall), frame-to-PNG export, op log if history/replay is ever needed.

## Database changes

Migration `000028_create_whiteboards`:

- The existing CHECK is inline and unnamed, so Postgres calls it `channels_type_check`: drop it and add `CHECK (type IN ('text','voice','whiteboard'))` (10 chars, fits `VARCHAR(10)`). The down migration deletes whiteboard channels, then restores the old CHECK (a down that raises would leave golang-migrate dirty).
- `whiteboards (id UUID PK → channels ON DELETE CASCADE, seq BIGINT NOT NULL DEFAULT 0, timestamps)`. The row is created lazily (`INSERT … ON CONFLICT DO NOTHING` on first load or write), so the channel package needs no transaction refactor.
- `whiteboard_objects (id UUID PK (client-generated), board_id → whiteboards ON DELETE CASCADE (indexed), version BIGINT > 0, body JSONB, timestamps)`. Deletes are hard deletes.
- `whiteboard_assets (id UUID PK, board_id → whiteboards ON DELETE CASCADE (indexed), storage_key TEXT UNIQUE, mime, bytes, width, height, uploaded_by → users ON DELETE SET NULL, timestamps)`.

## Backend / API changes

New package `backend/internal/whiteboard` (models, validation, repository, service, handler, routes), with a repository interface so version conflicts and ordering are testable with mocks plus one real-Postgres integration test.

- `channel/models.go`: `CreateChannelRequest` validates `oneof=text voice` today; add `whiteboard`.
- `message/service.go`: `Send` (and upload/typing) never checks the channel type; reject anything that is not a text channel.
- `GET /channels/:id/board` → `{ data: { seq, objects: [...] } }`, reading `seq` and objects in one consistent transaction.
- `POST /channels/:id/board/ops` with `{ opId, changes: [{ id, action: "create"|"update"|"delete", expectedVersion?, body?/patch? }] }` → `{ data: { seq, changes: [{ id, action, version }] } }`, or `409` with `{ error, current: [...] }`. Under a per-board mutex: check membership, dedupe `opId` (Redis `board:op:{opId}`, 10 min), lock the board row, validate bodies (finite numbers, bounded text, allow-listed kinds and style values, assets belong to the board), compare `expectedVersion`, bump `seq`, write, commit, publish `BOARD_COMMIT`.
- `POST /channels/:id/board/assets` (multipart) → `{ id, url, width, height }`. Uses `storage.SniffImage` and `image.DecodeConfig` for the pixel check, rejects SVG, 8 MiB, 16 MP. Files go under `board-assets/{boardId}/` with random names — a top-level UUID directory would be mistaken for a message by `storage.ListMessageImages`. Image objects carry `url`, `width` and `height` in their body so other clients can render them straight from the commit.
- `/uploads` is public (no auth), as for chat images: anyone with the URL can see a board image. Accepted for v1.
- Limits: 5,000 objects and 10 MB of bodies per board, 32 KB per object, 500 changes per command, 10 commands/s per user (burst 20), 100 **referenced** assets per board, 10 uploads/min per user (the existing limiter keys on IP + path; these need a per-user key). Orphaned asset files (deleted boards/objects, unused uploads) are cleaned by a later GC, not v1.

## Realtime events

Board rooms on the existing `/gateway` socket. Redis keeps its single `gateway:events` topic: add `RoomID` to `routableEvent` and filter through a local room index (per-connection room set + hub index room → connections); room fanout also checks `client.HasGuild`. Rooms are cleared on `CHANNEL_DELETE` and when a member is removed from the guild. Raise `maxMessageSize` in `gateway/client.go` from 4096 only as far as presence needs (writes are HTTP).

| Op | Direction | Payload (`d`) |
|---|---|---|
| `BOARD_SUBSCRIBE` / `BOARD_UNSUBSCRIBE` | client → server | `{ channelId }` |
| `BOARD_SUBSCRIBED` | server → client | `{ channelId, seq, participants }` |
| `BOARD_COMMIT` | server → room | `{ channelId, opId, seq, userId, changes: [{ id, action, version, body?/patch? }] }` |
| `BOARD_PRESENCE` | both, never persisted | `{ channelId, cursor?, selectedIds?, editingId?, drag?: { ids, dx, dy }, viewport? }`; server stamps `userId` |
| `BOARD_JOIN` / `BOARD_LEAVE` | server → room | `{ channelId, userId }` |

Presence rules: cursors ≤ 20 Hz, the rest ≤ 5 Hz, ≤ 2 KiB, expires after 10 s; coalesced per user per room on the server (latest wins); it must not call the hub's per-frame presence `touch` (one Redis round trip each, inside the single hub loop); when a client's send buffer is over half full, presence is dropped and commits never are. The gateway has no rate limiter today, so a per-client token bucket is part of this work.

Client join order: `BOARD_SUBSCRIBE` → wait for `BOARD_SUBSCRIBED` (with a timeout: an old backend ignores unknown ops) → buffer commits → `GET /board` → apply buffered commits with `seq` above the snapshot's → re-apply pending local ops. Room state dies with the socket, and `useGateway` replaces sockets on resume/focus, so the board re-subscribes and refetches on every `READY`. `useGateway.ts` needs a generic `sendGateway(op, d)` and an `onGatewayReady` subscription (only `sendGatewayTyping` exists today).

## Frontend changes

`frontend/src/features/whiteboard/`:

```txt
contract/   types.ts, operations.ts, interfaces.ts     ← written first, then frozen
core/       camera.ts, geometry.ts, stroke.ts, rank.ts, ops.ts, history.ts   (pure, no DOM)
state/      boardStore.ts (objects, pending ops), sessionStore.ts (tool, selection)
render/     Viewport.tsx, objects/*, overlays/* (selection, handles, cursors, grid)
input/      controller.ts, tools/*, shortcuts.ts
editing/    TextEditor.tsx, CropEditor.tsx
assets/     upload.ts, clipboard.ts
sync/       adapter.ts, presence.ts
ui/         Toolbar.tsx, StyleBar.tsx, ZoomControl.tsx, whiteboard.css (--wb-* tokens)
WhiteboardChannel.tsx
```

- Pointer samples, camera ticks, drag previews and remote cursor positions never go through React or Zustand state; a mutable runtime plus one `requestAnimationFrame` scheduler writes transforms directly. Objects are memoized and subscribe by id; offscreen objects are culled.
- Z-order uses fractional rank strings with the object id as tie-breaker.
- Text editing is a positioned plain-text overlay (IME-safe), not a React-controlled `contenteditable`.
- Board shortcuts fire only when the canvas has focus and no text editor is active.
- Integration in existing files: `types/index.ts` (channel type), `stores/guildStore.ts` (createChannel signature; default selection stays text-only), `components/layout/ChannelSidebar.tsx` (today any non-text channel gets the voice icon and channels are filtered into two sections, so boards need their own icon and section), `features/channel/CreateChannelModal.tsx` (type choice), `pages/AppPage.tsx` (board branch — today a board would fall through to the chat view; voice keeps running), `components/layout/MainLayout.tsx` (members panel), `hooks/useGateway.ts`.
- The pixel-art picker rasterizes the pixel-art document to PNG on the client and uploads it as a board asset (gallery items are JSON, not files).
- Desktop/webview constraints, decided up front: set `dragDropEnabled: false` in `tauri.conf.json` (the default swallows file drops on Windows); zoom uses non-passive `wheel` listeners with `preventDefault` plus `gesturestart`/`gesturechange` suppression so the webview does not zoom the whole app; pasted images come from the `paste` event's `clipboardData`, not `navigator.clipboard.read`.

## Milestones

| | Deliverable | Runs in parallel |
|---|---|---|
| M0 | Throwaway spike: 2,000 mixed DOM/SVG objects panning and zooming at 60 fps (gates the rendering decision). Then the contract: object types, op shapes, sync rules (`opId`, version = seq, pending-op rebase, undo vs unacknowledged ops), store API, sync adapter interface, `--wb-*` tokens | spike · contract |
| M1a | Foundations | `core` + tests · `state` · backend migration + channel type + guards |
| M1b | Local-only editor behind the new channel type: all v1 tools except images, selection, undo, no network; webview constraints applied | `render` · `input` · `editing/TextEditor` · `ui` + integration · backend `whiteboard` service + ops endpoint |
| M2 | Realtime: gateway rooms, commits, presence cursors and drags, persistence, reconnect | gateway rooms + presence · `sync` adapter · presence overlay |
| M3 | Images: asset upload, paste/drop, crop, pixel-art gallery picker | backend assets · `assets` + `editing/CropEditor` |
| M4 | Polish and hardening: two-client pass, benchmark re-run on the real engine, Tauri pass, reduced motion | — |

Underestimated parts to budget for: the IME-safe text overlay with size steps and reflow, sticky auto-fit, crop mode, and undo/redo over asynchronous commits.

## Acceptance criteria

- A Board channel can be created, renamed and deleted like a text channel, and survives a reload with all objects.
- Every v1 tool works with mouse and trackpad in the browser and in the Tauri app; shortcuts never fire while typing.
- Two clients see each other's changes within ~150 ms on a local network, see each other's cursors and selections, and converge to the same board after one of them reconnects.
- Simultaneous edits of the same object never corrupt it: one write wins, the other client visibly adopts it. A resent command is never applied twice, and no pending edit stays stuck after a dropped connection.
- Messages, uploads and typing are refused on board channels; a removed guild member stops receiving board events.
- Undo never removes or reverts another person's work.
- Panning and zooming a board with 2,000 mixed objects stays at 60 fps on the owner's machine; text stays sharp after zoom settles.
- An 8 MiB image can be pasted, cropped and seen by others; SVG and oversized files are refused with a clear message.
- Being on a board does not interrupt an ongoing voice connection.
- `go test ./...`, `npm run lint` and `npm run test` pass; `core/` has unit tests for camera, geometry, resize, rank and op merge.
