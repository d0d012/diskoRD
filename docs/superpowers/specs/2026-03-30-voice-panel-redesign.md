# Voice Panel Redesign

**Date:** 2026-03-30
**Status:** Approved
**Scope:** `frontend/src/features/voice/VoicePanel.tsx` only — no backend changes required.

---

## Goal

Replace the fixed-size avatar tile layout with a Discord-like, context-aware voice panel that adapts to what participants are doing and supports fullscreen and pin interactions.

---

## Layout States

### State 1 — Audio-only (default)

- All participants rendered as equal 16:9 tiles in a responsive CSS grid
- Grid columns: 1 col for 1 participant, 2 cols for 2–4, 3 cols for 5+
- Each tile fills its grid cell; avatar/initial centered inside
- Speaking ring (green border pulse) on the active speaker tile
- Muted badge (bottom-left) and screen-share badge (bottom-right) preserved from current implementation

### State 2 — Video/screen active (smart layout)

Triggered when **any participant has an active screen share OR camera track**.

- Layout switches to a two-column split: main stage (left, ~75% width) + sidebar strip (right, ~25% width)
- **Main stage** shows the most relevant content, priority order:
  1. Pinned participant (user override — see Interactions)
  2. Active screen share (auto)
  3. Active camera (auto)
  4. Loudest speaker (auto)
- **Sidebar strip** shows all participants as small tiles (same order as audio-only grid), scrollable if overflow
- Each sidebar tile: avatar/video thumbnail, name, speaking indicator, muted badge
- A `⛶` expand button appears on hover over the main stage tile (top-right corner)

### State 3 — Fullscreen overlay

Triggered by **double-clicking any tile** OR clicking the `⛶` expand button.

- Renders as a fixed-position overlay covering the entire app (`position: fixed; inset: 0; z-index: 9999`)
- Background: `#000`
- The selected tile's video/avatar fills the overlay
- Participant name label bottom-left, semi-transparent pill
- Floating controls bar at the bottom (same mic/deafen/camera/screenshare/disconnect buttons), appears on mouse move, fades after 3 seconds of inactivity
- `✕ exit` button top-right
- Pressing `Esc` exits fullscreen
- Fullscreen state is local UI only — does not affect what others see

---

## Interactions

### Pin (click to spotlight)
- Clicking a **sidebar tile** in State 2 pins that participant to the main stage
- A `📌` pin icon appears on the pinned tile in the sidebar
- Clicking the pinned tile again, or clicking a different sidebar tile, transfers the pin
- Pin is cleared automatically when:
  - The pinned participant leaves
  - The layout reverts to State 1 (no more video/screen activity)
- Pin state is local UI only

### Fullscreen (double-click / ⛶ button)
- Double-clicking **any tile** (grid tile in State 1, main stage or sidebar tile in State 2) opens that participant in fullscreen
- The `⛶` hover button on the main stage tile is a single-click shortcut to the same behavior
- `Esc` key and the `✕` button both exit fullscreen
- Exiting fullscreen returns to whatever state the panel was in before (State 1 or State 2)

---

## Component Structure

The current `VoicePanel.tsx` monolith is split into focused components, all in `frontend/src/features/voice/`:

| File | Responsibility |
|---|---|
| `VoicePanel.tsx` | Root: reads state, decides which layout to render, owns `pinnedId` and `fullscreenId` local state |
| `GridLayout.tsx` | State 1 — responsive equal-tile grid |
| `StageLayout.tsx` | State 2 — main stage + sidebar strip |
| `FullscreenOverlay.tsx` | State 3 — fixed overlay with floating controls |
| `ParticipantTile.tsx` | Single tile used across all layouts (avatar or video, badges, speaking ring) |
| `ControlBar.tsx` | Mic / deafen / camera / screenshare / disconnect buttons (reused in panel and fullscreen overlay) |
| `VideoTile.tsx` | Existing video `<video>` element with LiveKit `track.attach` — kept as-is |

`VoicePanel.tsx` layout-switching logic:

```
hasVideoOrScreen = any participant has cameraTrack or screenTrack
if fullscreenId → render FullscreenOverlay
else if hasVideoOrScreen → render StageLayout
else → render GridLayout
```

---

## State Owned by VoicePanel

Two pieces of local React state live in `VoicePanel.tsx`:

- `pinnedId: string | null` — identity of pinned participant; null = auto
- `fullscreenId: string | null` — identity of participant in fullscreen; null = not fullscreen

No store changes required. No backend changes required.

---

## Controls

The control bar is unchanged functionally. It moves into its own `ControlBar.tsx` component so it can be reused inside `FullscreenOverlay` without duplication.

---

## Fullscreen Controls Auto-hide

Inside `FullscreenOverlay`, the controls bar:
- Visible on initial render
- Fades out after 3 seconds of no mouse movement (`opacity: 0; transition: opacity 0.3s`)
- Reappears on any `mousemove` event inside the overlay
- Always visible when mouse is hovering the controls bar itself

---

## Out of Scope

- Drag-to-resize split divider
- PiP camera-within-screenshare swap
- Any backend or gateway changes
- Mobile / responsive breakpoints (desktop-only for now)
