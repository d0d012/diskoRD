# Feature: Pixel art

## Goal

Let members draw small pixel art in a lightweight built-in editor, post it into a chat, and pin favourites to their profile. It should feel like a tiny Aseprite, cheap enough to run anywhere: grids of at most 64×64 and one canvas element.

## Aseprite: what we borrow (concepts only)

Aseprite (`github.com/aseprite/aseprite`) is source-available under an EULA that allows modification only for personal use or upstream contributions, and forbids redistribution. **Copy no code, assets or palettes files from it.** LibreSprite (GPLv2 fork) is also off-limits because of GPL. We reimplement these ideas from scratch:

| Aseprite concept | Our minimal version |
|---|---|
| Indexed color mode + palette | Every pixel is a palette index (`Uint8Array`); index 0 = transparent. Palette of up to 32 colors |
| Pencil / eraser / paint bucket / eyedropper / line / rectangle | Same six tools. Bucket = 4-way flood fill on indices |
| "Pixel-perfect" stroke | Drop the middle pixel of L-shaped corners while dragging the pencil |
| Symmetry mode | Horizontal mirror toggle |
| Grid + zoom with nearest-neighbour | CSS-scaled canvas with `image-rendering: pixelated` and a grid overlay |
| Undo history | Whole-frame snapshot stack (64×64 = 4 KB per step, cap 100) |
| Frames + onion skin (phase 3) | Up to 8 frames, previous frame at 30% opacity, GIF export |

Not borrowed: layers, cels, tilemaps, blend modes, scripting, `.ase` file format, RGBA mode, selection/transform tools.

## Data format

A pixel art document (`PixelArtDoc`) is plain JSON, small enough for PostgreSQL:

```ts
interface PixelArtDoc {
  v: 1;
  width: 16 | 32 | 64;          // square only
  height: 16 | 32 | 64;
  palette: string[];            // "#rrggbb", 1..32 entries; index 0 is transparent and not listed
  frames: string[];             // base64 of Uint8Array(width*height) of palette indices, 1 frame until phase 3
  frameMs?: number;             // phase 3, 80..1000
}
```

Max size: 64×64×8 frames = 32 KB raw, ~44 KB base64. The default palette is our own 16-color palette, defined in `frontend/src/features/pixelart/palette.ts`.

## Phase 1: editor + post to chat (frontend only, shippable alone) — done

- **Entry point:** a pixel art button in `MessageInput` next to the upload button opens a `PixelArtEditor` modal for the current channel.
- **Editor UI:** canvas size picker (16/32/64, default 32), tool bar (six tools, keys `B E G I L U`), palette swatches and a color input to replace a swatch, mirror toggle, grid toggle, undo/redo (`Ctrl/Cmd+Z`, `Shift+Ctrl/Cmd+Z`), clear, and **Send**.
- **Drawing:** pointer events with pointer capture. Interpolate between pointer samples with Bresenham so fast strokes have no gaps. Redraw by writing one `ImageData` at native size and letting CSS scale it, so each change costs at most 4096 pixel writes.
- **Send:** render to PNG at ×16 nearest-neighbour (32×32 → 512×512, a few KB) via an offscreen canvas and upload it with the existing `uploadImage(channelId, file)`. It then shows up in message history like any image attachment, with no backend change.
- **Import:** "Import image" accepts any browser-decodable image (PNG/JPEG/GIF first frame/WebP, ≤ 8 MB), e.g. a sprite found online. Steps:
  - Pick a target size (16/32/64) and a fit: contain or crop.
  - Downscale on an offscreen canvas, area-averaging when shrinking and nearest-neighbour when the source is already pixel art at an integer scale.
  - Quantize to the palette with a toggle: "keep my palette" maps to the nearest color, "make a new palette" runs k-means (≤ 32 colors, 8 iterations over ≤ 4096 pixels).
  - Pixels with alpha below 128 become transparent.
  - Show a live preview before replacing the canvas, and push the replacement onto undo.
  - Users are responsible for the rights to what they import. The UI says so in one line.
- **Export:** "Download PNG" (×1, ×8 or ×16 nearest-neighbour) and "Download .pixel.json" (the `PixelArtDoc`). "Import" also accepts `.pixel.json` for a lossless round trip. In Tauri, downloads go through the existing save path; if there is none, use a plain `<a download>`.
- **Draft:** autosave the current doc to `localStorage` (guarded with try/catch) so closing the modal doesn't lose work.
- **Code layout:** `frontend/src/features/pixelart/` holds:
  - `lib/` with pure, DOM-free functions: `floodFill`, `line`, `pixelPerfect`, `mirror`, `encodeDoc`/`decodeDoc`, `history`, `quantize` (nearest color + k-means), `downscale`.
  - `render.ts` for the canvas/PNG glue.
  - `PixelArtEditor.tsx`. Its state is local to the modal, since nothing else reads it.

## Phase 1b: message decorations (backend + frontend) — done

Anyone in a channel or DM can pin a pixel art piece to a message as a decoration. It is drawn faintly behind the chat and scrolls with the history.

- **Anchoring:** a decoration belongs to one message and stores:
  - `x`: horizontal center, 0–100 % of the row width
  - `y`: top offset, 0–64 px below the row top
  - `size`: 32/48/64/96/128 px
  - `doc`: a copy of the art, so later gallery edits don't change placed pieces
- **Rendering:** it is drawn inside its message row, in an isolated stacking context at `z-index: -1`, at 35 % opacity with `pointer-events: none` and `image-rendering: pixelated`. Since `y ≥ 0`, a piece can only spill into *later* rows, which paint over it, so every message's text stays on top.
- **Performance:** each distinct doc is rendered once to a data URL and cached in a module-level map. Only loaded messages render their decorations, there is no scroll listener and no extra layout pass, and decorations arrive with the message page.
- **Limits:**
  - At most 3 decorations per message, enforced under a lock on the message row.
  - Writes are rate limited to 10/min per IP/path.
  - Docs are validated by `internal/pixelart` (shared with the gallery).
  - Any viewer can turn decorations off with "Hide decorations" in the message context menu (stored locally).
- **Who can remove one:** whoever placed it, the message author, or a guild owner/admin/moderator.
- **API:**
  - `POST /messages/:id/decorations` `{doc, x, y, size}` returns 201 with the decoration.
  - `DELETE /decorations/:id`.
  - `GET /channels/:id/messages` items carry `decorations`.
- **Events:** `DECORATION_ADD` (the decoration plus `channelId`, `guildId`) and `DECORATION_REMOVE` `{id, messageId, channelId, guildId}`, via the same guild/DM fanout as reactions.
- **Database:** migration `000020_create_message_decorations`, with the message FK `ON DELETE CASCADE` and the author FK `ON DELETE SET NULL`, both indexed.
- **Placing:** the message context menu has "Decorate with pixel art". It opens the editor with a "Place on message" action; a ghost of the art then follows the pointer over that message, the mouse wheel or the − / + buttons change size, a click places it and Escape cancels. The same menu offers "Remove Decoration(s)" for the pieces the viewer may remove (the client knows owners only; admins and moderators are enforced by the server).

## Phase 2: gallery + profile showcase (backend + frontend)

- **Database (migration `000021_pixel_arts`)**: table `pixel_arts`
  - `id` UUID PK
  - `owner_id` FK → users `ON DELETE CASCADE`, indexed
  - `title` VARCHAR(40)
  - `doc` JSONB NOT NULL
  - `showcase_position` SMALLINT NULL; values 0–14, unique per owner where not null
  - `created_at`, `updated_at` TIMESTAMPTZ
  - Quota of 50 per user, enforced under a user-row lock like the soundboard quota.
- **Backend `internal/pixelart`:** `handler/service/repository/models/routes`. The server validates the doc: version, allowed sizes, palette length and `#rrggbb` format, base64 decoding to exactly `w*h` bytes, every index ≤ palette length, frame count, total size ≤ 64 KB. Never trust client-supplied PNGs here; the profile renders from the doc.
  - `GET /users/me/pixel-arts` (cursor paginated), `POST /users/me/pixel-arts`, `PATCH /users/me/pixel-arts/:id` (title, doc), `DELETE /users/me/pixel-arts/:id`.
  - `PUT /users/me/pixel-arts/showcase` with `{ ids: string[] }`, at most 15, in order.
  - `GET /users/:id/pixel-arts/showcase`: auth required, same visibility as the profile.
  - The existing Redis rate limiter applies to writes.
- **Realtime:** a showcase change emits `USER_UPDATE` with a `showcaseVersion` bump. Open profile cards refetch the showcase; we don't push the docs over the gateway.
- **Frontend:**
  - The editor gains **Save to gallery** and **Open from gallery**.
  - Settings → Profile gets a "Pixel art" section: a grid of saved pieces, drag or pick up to 15 to showcase, rename, delete.
  - `UserProfileCard` shows the first 5 showcase pieces under the bio, plus a "+N" tile that opens the full 15-piece overview grid. Each piece is rendered client-side from the doc to a small canvas (memoized data URL); click opens it enlarged in the existing `AvatarLightbox` style.
- **Docs:** add a "Pixel art" section to `docs/architecture.md` (doc validation, quota, showcase flow) and the migration to the manual-migration note.

## Phase 3 (optional): animation

- Frame strip (add, duplicate, delete, reorder; max 8), onion skin toggle, play preview, frame duration.
- Send as GIF: encode client-side with a small, permissively licensed encoder (e.g. `gifenc`, MIT; check the license when adding it), upscaled ×8. The 8 MB upload limit leaves plenty of room.
- The profile showcase animates on hover only.

## Out of scope

- Real-time collaborative canvas (shared drawing in a channel or voice call), layers, selections and transforms, importing arbitrary images, `.ase` import/export, using pixel art as an avatar (possible later: it is just a PNG upload to the existing avatar endpoint), and remixing art from someone else's message.

## Acceptance

- **Phase 1:**
  - Import a photo and an online sprite at 32×32 in both palette modes and export both as PNG and `.pixel.json`. Re-importing the JSON is pixel-identical.
  - Draw a 32×32 piece using all six tools, mirror and undo, then send it. Both clients see a crisp 512×512 image in history. Reopening the editor restores the draft.
  - Vitest covers each `lib/` function (fill bounds and holes, line endpoints, pixel-perfect corners, encode/decode round trip, quantize nearest/k-means, downscale of transparent pixels) and the editor's send path, with `uploadImage` mocked.
  - `npm run lint` and `npm run test` pass.
- **Phase 2:**
  - Save, rename, showcase 15 pieces (a 16th is rejected) and delete one. Another user's profile card shows the updated showcase without a reload.
  - A malformed doc (wrong byte count, out-of-range index, 33 colors, 128×128) is rejected with 400.
  - The 51st save is rejected.
  - Go tests (testify, mocked repository) cover validation, quota and showcase ordering. `go test ./...` passes and the migration up/down applies cleanly.
- **Performance:** drawing stays smooth on a 64×64 canvas in the Tauri WebView2 build. No per-pixel DOM elements; only one canvas plus a grid overlay.
