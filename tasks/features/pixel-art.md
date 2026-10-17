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

## Phase 1: editor + post to chat (frontend only, shippable alone)

- **Entry point:** a pixel art button in `MessageInput` next to the upload button opens a `PixelArtEditor` modal for the current channel.
- **Editor UI:** canvas size picker (16/32/64, default 32), tool bar (six tools, keys `B E G I L U`), palette swatches and a color input to replace a swatch, mirror toggle, grid toggle, undo/redo (`Ctrl/Cmd+Z`, `Shift+Ctrl/Cmd+Z`), clear, and **Send**.
- **Drawing:** pointer events with pointer capture. Interpolate between pointer samples with Bresenham so fast strokes have no gaps. Redraw by writing one `ImageData` at native size and letting CSS scale it, so each change costs at most 4096 pixel writes.
- **Send:** render to PNG at ×16 nearest-neighbour (32×32 → 512×512, a few KB) via an offscreen canvas and upload it with the existing `uploadImage(channelId, file)`. It then shows up in message history like any image attachment, with no backend change.
- **Draft:** autosave the current doc to `localStorage` (guarded with try/catch) so closing the modal doesn't lose work.
- **Code layout:** `frontend/src/features/pixelart/` holds:
  - `lib/` with pure, DOM-free functions: `floodFill`, `line`, `pixelPerfect`, `mirror`, `encodeDoc`/`decodeDoc`, `renderToCanvas`, `history`.
  - `PixelArtEditor.tsx`, `Toolbar.tsx`, `Palette.tsx`.
  - A small Zustand store (`pixelArtStore`) for editor state.

## Phase 2: gallery + profile showcase (backend + frontend)

- **Database (migration `000020_pixel_arts`)**: table `pixel_arts`
  - `id` UUID PK
  - `owner_id` FK → users `ON DELETE CASCADE`, indexed
  - `title` VARCHAR(40)
  - `doc` JSONB NOT NULL
  - `showcase_position` SMALLINT NULL; values 0–2, unique per owner where not null
  - `created_at`, `updated_at` TIMESTAMPTZ
  - Quota of 50 per user, enforced under a user-row lock like the soundboard quota.
- **Backend `internal/pixelart`:** `handler/service/repository/models/routes`. The server validates the doc: version, allowed sizes, palette length and `#rrggbb` format, base64 decoding to exactly `w*h` bytes, every index ≤ palette length, frame count, total size ≤ 64 KB. Never trust client-supplied PNGs here; the profile renders from the doc.
  - `GET /users/me/pixel-arts` (cursor paginated), `POST /users/me/pixel-arts`, `PATCH /users/me/pixel-arts/:id` (title, doc), `DELETE /users/me/pixel-arts/:id`.
  - `PUT /users/me/pixel-arts/showcase` with `{ ids: string[] }`, at most 3, in order.
  - `GET /users/:id/pixel-arts/showcase`: auth required, same visibility as the profile.
  - The existing Redis rate limiter applies to writes.
- **Realtime:** a showcase change emits `USER_UPDATE` with a `showcaseVersion` bump. Open profile cards refetch the showcase; we don't push the docs over the gateway.
- **Frontend:**
  - The editor gains **Save to gallery** and **Open from gallery**.
  - Settings → Profile gets a "Pixel art" section: a grid of saved pieces, drag or pick up to 3 to showcase, rename, delete.
  - `UserProfileCard` shows the showcase row under the bio. Each piece is rendered client-side from the doc to a small canvas (memoized data URL); click opens it enlarged in the existing `AvatarLightbox` style.
- **Docs:** add a "Pixel art" section to `docs/architecture.md` (doc validation, quota, showcase flow) and the migration to the manual-migration note.

## Phase 3 (optional): animation

- Frame strip (add, duplicate, delete, reorder; max 8), onion skin toggle, play preview, frame duration.
- Send as GIF: encode client-side with a small, permissively licensed encoder (e.g. `gifenc`, MIT; check the license when adding it), upscaled ×8. The 8 MB upload limit leaves plenty of room.
- The profile showcase animates on hover only.

## Out of scope

- Real-time collaborative canvas (shared drawing in a channel or voice call), layers, selections and transforms, importing arbitrary images, `.ase` import/export, using pixel art as an avatar (possible later: it is just a PNG upload to the existing avatar endpoint), and remixing art from someone else's message.

## Acceptance

- **Phase 1:**
  - Draw a 32×32 piece using all six tools, mirror and undo, then send it. Both clients see a crisp 512×512 image in history. Reopening the editor restores the draft.
  - Vitest covers each `lib/` function (fill bounds and holes, line endpoints, pixel-perfect corners, encode/decode round trip) and the editor's send path, with `uploadImage` mocked.
  - `npm run lint` and `npm run test` pass.
- **Phase 2:**
  - Save, rename, showcase 3 pieces and delete one. Another user's profile card shows the updated showcase without a reload.
  - A malformed doc (wrong byte count, out-of-range index, 33 colors, 128×128) is rejected with 400.
  - The 51st save is rejected.
  - Go tests (testify, mocked repository) cover validation, quota and showcase ordering. `go test ./...` passes and the migration up/down applies cleanly.
- **Performance:** drawing stays smooth on a 64×64 canvas in the Tauri WebView2 build. No per-pixel DOM elements; only one canvas plus a grid overlay.
