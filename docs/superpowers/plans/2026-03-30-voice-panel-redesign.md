# Voice Panel Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fixed-size avatar tile layout in VoicePanel with a smart adaptive layout: equal grid for audio-only, main-stage + sidebar when video/screen is active, click-to-pin, and double-click fullscreen overlay.

**Architecture:** Seven focused components replace the VoicePanel monolith. Pure layout utility functions handle all switching logic and are tested independently. VoicePanel owns `pinnedId` and `fullscreenId` as local React state and selects which layout to render — no store changes required.

**Tech Stack:** React 19, TypeScript, Tailwind CSS, Vitest, React Testing Library, LiveKit client (track types only)

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `frontend/src/features/voice/voiceLayout.ts` | Pure fns: getLayoutMode, getGridColumns, getMainParticipant |
| Create | `frontend/src/features/voice/voiceLayout.test.ts` | Unit tests for the above |
| Create | `frontend/src/features/voice/VideoTile.tsx` | `<video>` with LiveKit track.attach/detach |
| Create | `frontend/src/features/voice/ParticipantTile.tsx` | Single tile: avatar or video, badges, speaking ring |
| Create | `frontend/src/features/voice/ControlBar.tsx` | Mic/deafen/camera/screenshare/disconnect buttons |
| Create | `frontend/src/features/voice/GridLayout.tsx` | Equal 16:9 grid for audio-only state |
| Create | `frontend/src/features/voice/StageLayout.tsx` | Main stage (75%) + sidebar strip (25%) |
| Create | `frontend/src/features/voice/FullscreenOverlay.tsx` | Fixed overlay, auto-hide controls, Esc to close |
| Create | `frontend/src/features/voice/FullscreenOverlay.test.tsx` | Behavioral tests for overlay |
| Create | `frontend/src/features/voice/VoicePanel.test.tsx` | Integration tests: layout switching, pin, fullscreen |
| Create | `frontend/src/test-setup.ts` | Jest-DOM matchers setup for Vitest |
| Modify | `frontend/vite.config.ts` | Add Vitest config block |
| Modify | `frontend/package.json` | Add test script + test devDependencies |
| Modify | `frontend/src/features/voice/VoicePanel.tsx` | Rewrite to wire all sub-components |

---

## Task 0: Install and configure Vitest + React Testing Library

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/vite.config.ts`
- Create: `frontend/src/test-setup.ts`

- [ ] **Step 1: Install test dependencies**

```bash
cd frontend
npm install --save-dev vitest @testing-library/react @testing-library/user-event @testing-library/jest-dom jsdom
```

Expected: packages added to `node_modules`, no errors.

- [ ] **Step 2: Add test script to package.json**

Open `frontend/package.json` and add `"test": "vitest run"` to the `"scripts"` section:

```json
"scripts": {
  "dev": "vite",
  "build": "tsc -b && vite build",
  "lint": "eslint .",
  "preview": "vite preview",
  "test": "vitest run"
},
```

- [ ] **Step 3: Add Vitest config to vite.config.ts**

Replace the full contents of `frontend/vite.config.ts` with:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
```

- [ ] **Step 4: Create test setup file**

Create `frontend/src/test-setup.ts`:

```ts
import "@testing-library/jest-dom";
```

- [ ] **Step 5: Verify the test runner works**

```bash
cd frontend
npm test
```

Expected: `No test files found` or similar — not an error, just no tests yet.

- [ ] **Step 6: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/vite.config.ts frontend/src/test-setup.ts
git commit -m "chore(frontend): set up Vitest + React Testing Library"
```

---

## Task 1: Layout utility functions

**Files:**
- Create: `frontend/src/features/voice/voiceLayout.ts`
- Create: `frontend/src/features/voice/voiceLayout.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/features/voice/voiceLayout.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { getLayoutMode, getGridColumns, getMainParticipant } from "./voiceLayout";
import type { VoiceParticipant } from "../../hooks/useVoice";

function mkp(overrides: Partial<VoiceParticipant> = {}): VoiceParticipant {
  return {
    identity: "u1",
    name: "Alice",
    isSpeaking: false,
    isMicEnabled: true,
    isCameraEnabled: false,
    isScreenSharing: false,
    isLocal: false,
    cameraTrack: null,
    screenTrack: null,
    ...overrides,
  };
}

describe("getLayoutMode", () => {
  it("returns grid when all participants are audio-only", () => {
    expect(getLayoutMode([mkp(), mkp({ identity: "u2" })])).toBe("grid");
  });
  it("returns grid for empty array", () => {
    expect(getLayoutMode([])).toBe("grid");
  });
  it("returns stage when any participant has a camera track", () => {
    expect(getLayoutMode([mkp({ cameraTrack: {} as any })])).toBe("stage");
  });
  it("returns stage when any participant has a screen track", () => {
    expect(getLayoutMode([mkp({ screenTrack: {} as any })])).toBe("stage");
  });
});

describe("getGridColumns", () => {
  it("returns 1 for 0 or 1 participant", () => {
    expect(getGridColumns(0)).toBe(1);
    expect(getGridColumns(1)).toBe(1);
  });
  it("returns 2 for 2-4 participants", () => {
    expect(getGridColumns(2)).toBe(2);
    expect(getGridColumns(4)).toBe(2);
  });
  it("returns 3 for 5+ participants", () => {
    expect(getGridColumns(5)).toBe(3);
    expect(getGridColumns(9)).toBe(3);
  });
});

describe("getMainParticipant", () => {
  it("returns null for empty array", () => {
    expect(getMainParticipant([], null)).toBeNull();
  });
  it("returns pinned participant when pinnedId matches", () => {
    const a = mkp({ identity: "a" });
    const b = mkp({ identity: "b" });
    expect(getMainParticipant([a, b], "b")).toBe(b);
  });
  it("falls back to screen sharer when pinnedId not found", () => {
    const track = {} as any;
    const a = mkp({ identity: "a" });
    const b = mkp({ identity: "b", screenTrack: track });
    expect(getMainParticipant([a, b], "nonexistent")).toBe(b);
  });
  it("prefers screen share over camera track", () => {
    const track = {} as any;
    const a = mkp({ identity: "a", cameraTrack: track });
    const b = mkp({ identity: "b", screenTrack: track });
    expect(getMainParticipant([a, b], null)).toBe(b);
  });
  it("falls back to camera when no screen share", () => {
    const track = {} as any;
    const a = mkp({ identity: "a" });
    const b = mkp({ identity: "b", cameraTrack: track });
    expect(getMainParticipant([a, b], null)).toBe(b);
  });
  it("falls back to speaking participant", () => {
    const a = mkp({ identity: "a" });
    const b = mkp({ identity: "b", isSpeaking: true });
    expect(getMainParticipant([a, b], null)).toBe(b);
  });
  it("falls back to first participant when no other signal", () => {
    const a = mkp({ identity: "a" });
    const b = mkp({ identity: "b" });
    expect(getMainParticipant([a, b], null)).toBe(a);
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
cd frontend && npm test
```

Expected: errors like `Cannot find module './voiceLayout'`

- [ ] **Step 3: Implement voiceLayout.ts**

Create `frontend/src/features/voice/voiceLayout.ts`:

```ts
import type { VoiceParticipant } from "../../hooks/useVoice";

export type LayoutMode = "grid" | "stage";

export function getLayoutMode(participants: VoiceParticipant[]): LayoutMode {
  return participants.some(p => p.cameraTrack !== null || p.screenTrack !== null)
    ? "stage"
    : "grid";
}

export function getGridColumns(count: number): number {
  if (count <= 1) return 1;
  if (count <= 4) return 2;
  return 3;
}

export function getMainParticipant(
  participants: VoiceParticipant[],
  pinnedId: string | null
): VoiceParticipant | null {
  if (!participants.length) return null;
  if (pinnedId) {
    const pinned = participants.find(p => p.identity === pinnedId);
    if (pinned) return pinned;
  }
  const screensharer = participants.find(p => p.screenTrack !== null);
  if (screensharer) return screensharer;
  const camera = participants.find(p => p.cameraTrack !== null);
  if (camera) return camera;
  const speaker = participants.find(p => p.isSpeaking);
  if (speaker) return speaker;
  return participants[0];
}
```

- [ ] **Step 4: Run tests — confirm all pass**

```bash
cd frontend && npm test
```

Expected: `voiceLayout.test.ts` — 13 tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/voice/voiceLayout.ts frontend/src/features/voice/voiceLayout.test.ts
git commit -m "feat(voice): add layout utility functions with tests"
```

---

## Task 2: VideoTile + ParticipantTile

**Files:**
- Create: `frontend/src/features/voice/VideoTile.tsx`
- Create: `frontend/src/features/voice/ParticipantTile.tsx`

These are leaf components with no sub-dependencies. `VideoTile` is extracted unchanged from `VoicePanel.tsx`. `ParticipantTile` replaces the old inline tile with a prop-driven version that supports variants and callbacks.

- [ ] **Step 1: Create VideoTile.tsx**

Create `frontend/src/features/voice/VideoTile.tsx`:

```tsx
import { useEffect, useRef } from "react";
import { Track } from "livekit-client";

interface VideoTileProps {
  track: Track;
  className?: string;
}

export function VideoTile({ track, className }: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    track.attach(el);
    return () => { track.detach(el); };
  }, [track]);

  return (
    <video
      ref={videoRef}
      autoPlay
      muted
      playsInline
      className={className}
      style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "inherit" }}
    />
  );
}
```

- [ ] **Step 2: Create ParticipantTile.tsx**

Create `frontend/src/features/voice/ParticipantTile.tsx`:

```tsx
import { useEffect, useState } from "react";
import type { VoiceParticipant } from "../../hooks/useVoice";
import { VideoTile } from "./VideoTile";

// Speaking ring — injected once into <head>
const SPEAKING_STYLE = `
@keyframes voice-pulse {
  0%, 100% { box-shadow: 0 0 0 0px rgba(35,165,90,0.8); }
  50%       { box-shadow: 0 0 0 4px rgba(35,165,90,0); }
}
.voice-speaking {
  animation: voice-pulse 1s ease-in-out infinite;
  border: 2px solid #23a55a !important;
}
`;

function injectSpeakingStyles() {
  if (document.getElementById("voice-speaking-styles")) return;
  const el = document.createElement("style");
  el.id = "voice-speaking-styles";
  el.textContent = SPEAKING_STYLE;
  document.head.appendChild(el);
}

interface ParticipantTileProps {
  participant: VoiceParticipant;
  /** "grid" = equal grid tile, "sidebar" = compact strip tile, "main" = large stage tile */
  variant?: "grid" | "sidebar" | "main";
  isPinned?: boolean;
  onClick?: () => void;
  onDoubleClick?: () => void;
}

export function ParticipantTile({
  participant,
  variant = "grid",
  isPinned = false,
  onClick,
  onDoubleClick,
}: ParticipantTileProps) {
  const [showExpand, setShowExpand] = useState(false);

  useEffect(() => { injectSpeakingStyles(); }, []);

  const { name, isSpeaking, isMicEnabled, cameraTrack, screenTrack, isScreenSharing, isLocal } = participant;
  const hasVideo = cameraTrack !== null;
  const hasScreen = screenTrack !== null;
  const color = `hsl(${(name.charCodeAt(0) * 37) % 360}, 55%, 40%)`;

  const isSidebar = variant === "sidebar";
  const avatarSize = isSidebar ? "w-7 h-7 text-xs" : "w-10 h-10 text-base";
  const nameSize = isSidebar ? "text-[10px]" : "text-xs";
  const badgeSize = isSidebar ? "w-3.5 h-3.5" : "w-5 h-5";
  const badgeIcon = isSidebar ? "7" : "10";

  return (
    <div
      data-testid={`participant-tile-${participant.identity}`}
      className={`relative flex flex-col items-center justify-center overflow-hidden rounded-xl border-2 transition-all duration-200 cursor-pointer select-none ${
        isSpeaking ? "voice-speaking" : "border-transparent"
      } ${isPinned ? "ring-2 ring-[#5865f2]" : ""}`}
      style={{ backgroundColor: hasVideo || hasScreen ? "#000" : color, width: "100%", height: "100%" }}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onMouseEnter={() => variant === "main" && setShowExpand(true)}
      onMouseLeave={() => setShowExpand(false)}
    >
      {/* Video or avatar */}
      {hasVideo && cameraTrack ? (
        <VideoTile track={cameraTrack} />
      ) : hasScreen && screenTrack ? (
        <VideoTile track={screenTrack} />
      ) : (
        <span className={`${avatarSize} rounded-full flex items-center justify-center font-bold text-white`}
          style={{ backgroundColor: color }}>
          {name[0]?.toUpperCase() ?? "?"}
        </span>
      )}

      {/* Name label */}
      <div className={`absolute bottom-1.5 left-2 right-2 flex items-center gap-1 ${isSidebar ? "justify-center" : ""}`}>
        <span
          className={`${nameSize} font-medium truncate px-1 py-0.5 rounded`}
          style={{ backgroundColor: "rgba(0,0,0,0.55)", color: "#dbdee1" }}
        >
          {isLocal ? "You" : name}
        </span>
        {isPinned && <span className="text-[9px]">📌</span>}
      </div>

      {/* Muted badge */}
      {!isMicEnabled && (
        <div
          className={`absolute top-1.5 left-1.5 ${badgeSize} rounded-full flex items-center justify-center`}
          style={{ backgroundColor: "var(--color-dc-red, #ed4245)" }}
        >
          <svg width={badgeIcon} height={badgeIcon} viewBox="0 0 24 24" fill="white">
            <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z"/>
          </svg>
        </div>
      )}

      {/* Screen sharing badge */}
      {isScreenSharing && (
        <div
          className={`absolute top-1.5 right-1.5 ${badgeSize} rounded-full flex items-center justify-center`}
          style={{ backgroundColor: "var(--color-dc-brand, #5865f2)" }}
        >
          <svg width={badgeIcon} height={badgeIcon} viewBox="0 0 24 24" fill="white">
            <path d="M20 3H4c-1.1 0-2 .9-2 2v11c0 1.1.9 2 2 2h7v2H9v2h6v-2h-2v-2h7c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 13H4V5h16v11z"/>
          </svg>
        </div>
      )}

      {/* Expand button — only on main stage tile, on hover */}
      {variant === "main" && showExpand && (
        <button
          className="absolute top-2 right-2 px-2 py-0.5 rounded text-[10px] font-medium"
          style={{ backgroundColor: "rgba(0,0,0,0.65)", color: "#dbdee1" }}
          onClick={(e) => { e.stopPropagation(); onDoubleClick?.(); }}
          title="Expand to fullscreen"
        >
          ⛶
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Run tests to make sure nothing broke**

```bash
cd frontend && npm test
```

Expected: still 13 passing, no new failures (no tests for these components yet — they come in Task 6).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/features/voice/VideoTile.tsx frontend/src/features/voice/ParticipantTile.tsx
git commit -m "feat(voice): add VideoTile and ParticipantTile components"
```

---

## Task 3: ControlBar

**Files:**
- Create: `frontend/src/features/voice/ControlBar.tsx`

Extracts the five control buttons from `VoicePanel.tsx`. Accepts a `floating` prop for use inside the fullscreen overlay (transparent background, slightly smaller).

- [ ] **Step 1: Create ControlBar.tsx**

Create `frontend/src/features/voice/ControlBar.tsx`:

```tsx
import { useVoiceStore } from "../../stores/voiceStore";

interface ControlBarProps {
  /** When true, renders with semi-transparent dark background for overlay use */
  floating?: boolean;
}

function ControlBtn({
  active,
  danger,
  onClick,
  title,
  children,
  floating,
}: {
  active?: boolean;
  danger?: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
  floating?: boolean;
}) {
  const base = floating ? "w-10 h-10" : "w-12 h-12";
  const bg = danger
    ? "var(--color-dc-red, #ed4245)"
    : active
    ? floating ? "rgba(79,86,96,0.85)" : "var(--color-dc-bg-modifier-selected)"
    : floating ? "rgba(79,86,96,0.75)" : "var(--color-dc-bg-tertiary)";

  return (
    <button
      onClick={onClick}
      title={title}
      className={`${base} rounded-full flex items-center justify-center transition-all duration-150 flex-shrink-0`}
      style={{ backgroundColor: bg, color: active ? "var(--color-dc-header-primary)" : "var(--color-dc-interactive-normal)" }}
    >
      {children}
    </button>
  );
}

export function ControlBar({ floating = false }: ControlBarProps) {
  const { isMuted, isDeafened, isCameraOn, isScreenSharing, setMuted, setDeafened, setCameraOn, setScreenSharing, leaveVoice } =
    useVoiceStore();

  return (
    <div className={`flex items-center justify-center gap-3 ${floating ? "py-3" : "px-6 py-4"}`}>
      {/* Mic */}
      <ControlBtn active={!isMuted} onClick={() => setMuted(!isMuted)} title={isMuted ? "Unmute" : "Mute"} floating={floating}>
        {isMuted ? (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z"/>
          </svg>
        ) : (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 15c1.66 0 3-1.34 3-3V6c0-1.66-1.34-3-3-3S9 4.34 9 6v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V6zm6 6c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-2.08c3.39-.49 6-3.39 6-6.92h-2z"/>
          </svg>
        )}
      </ControlBtn>

      {/* Deafen */}
      <ControlBtn active={!isDeafened} onClick={() => setDeafened(!isDeafened)} title={isDeafened ? "Undeafen" : "Deafen"} floating={floating}>
        {isDeafened ? (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 3a9 9 0 0 0-9 9v4a3 3 0 0 0 3 3h1a1 1 0 0 0 1-1v-6a1 1 0 0 0-1-1H6.29A7 7 0 0 1 19 12h-1a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h1a3 3 0 0 0 3-3v-4a9 9 0 0 0-9-9z"/>
            <line x1="3" y1="3" x2="21" y2="21" stroke="currentColor" strokeWidth="2"/>
          </svg>
        ) : (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 3a9 9 0 0 0-9 9v4a3 3 0 0 0 3 3h1a1 1 0 0 0 1-1v-6a1 1 0 0 0-1-1H6.29A7 7 0 0 1 19 12h-1a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h1a3 3 0 0 0 3-3v-4a9 9 0 0 0-9-9z"/>
          </svg>
        )}
      </ControlBtn>

      {/* Camera */}
      <ControlBtn active={isCameraOn} onClick={() => setCameraOn(!isCameraOn)} title={isCameraOn ? "Turn off camera" : "Turn on camera"} floating={floating}>
        {isCameraOn ? (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
            <path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z"/>
          </svg>
        ) : (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
            <path d="M21 6.5l-4 4V7a1 1 0 0 0-1-1H9.82L21 17.18V6.5zM3.27 2L2 3.27 4.73 6H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12c.21 0 .39-.08.54-.18L19.73 21 21 19.73 3.27 2z"/>
          </svg>
        )}
      </ControlBtn>

      {/* Screen share */}
      <ControlBtn active={isScreenSharing} onClick={() => setScreenSharing(!isScreenSharing)} title={isScreenSharing ? "Stop sharing" : "Share screen"} floating={floating}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
          <path d="M20 3H4c-1.1 0-2 .9-2 2v11c0 1.1.9 2 2 2h7v2H9v2h6v-2h-2v-2h7c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 13H4V5h16v11z"/>
          {isScreenSharing && <circle cx="12" cy="11" r="3" fill="currentColor"/>}
        </svg>
      </ControlBtn>

      {/* Disconnect */}
      <ControlBtn danger onClick={leaveVoice} title="Disconnect" floating={floating}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08A.99.99 0 0 1 0 12.37c0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.66c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48a1 1 0 0 1-.71.29c-.27 0-.52-.11-.7-.28a11.27 11.27 0 0 0-2.67-1.85.985.985 0 0 1-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/>
        </svg>
      </ControlBtn>
    </div>
  );
}
```

- [ ] **Step 2: Run tests**

```bash
cd frontend && npm test
```

Expected: 13 tests still pass.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/features/voice/ControlBar.tsx
git commit -m "feat(voice): add ControlBar component"
```

---

## Task 4: GridLayout

**Files:**
- Create: `frontend/src/features/voice/GridLayout.tsx`

Renders all participants as equal 16:9 tiles in a responsive CSS grid. Column count is driven by `getGridColumns`.

- [ ] **Step 1: Create GridLayout.tsx**

Create `frontend/src/features/voice/GridLayout.tsx`:

```tsx
import type { VoiceParticipant } from "../../hooks/useVoice";
import { ParticipantTile } from "./ParticipantTile";
import { getGridColumns } from "./voiceLayout";

interface GridLayoutProps {
  participants: VoiceParticipant[];
  onFullscreen: (identity: string) => void;
}

export function GridLayout({ participants, onFullscreen }: GridLayoutProps) {
  const cols = getGridColumns(participants.length);
  const gridStyle = {
    display: "grid",
    gridTemplateColumns: `repeat(${cols}, 1fr)`,
    gap: "12px",
    padding: "20px",
    height: "100%",
    alignContent: "center",
  };

  if (participants.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 opacity-40">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="currentColor" style={{ color: "var(--color-dc-text-muted)" }}>
          <path d="M12 3c-4.97 0-9 4.03-9 9v7c0 1.1.9 2 2 2h4v-8H5v-1c0-3.87 3.13-7 7-7s7 3.13 7 7v1h-4v8h4c1.1 0 2-.9 2-2v-7c0-4.97-4.03-9-9-9z"/>
        </svg>
        <p className="text-sm" style={{ color: "var(--color-dc-text-muted)" }}>No one else here yet</p>
      </div>
    );
  }

  return (
    <div data-testid="grid-layout" style={gridStyle}>
      {participants.map((p) => (
        <div key={p.identity} style={{ aspectRatio: "16 / 9" }}>
          <ParticipantTile
            participant={p}
            variant="grid"
            onDoubleClick={() => onFullscreen(p.identity)}
          />
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Run tests**

```bash
cd frontend && npm test
```

Expected: 13 tests pass.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/features/voice/GridLayout.tsx
git commit -m "feat(voice): add GridLayout component"
```

---

## Task 5: StageLayout

**Files:**
- Create: `frontend/src/features/voice/StageLayout.tsx`

Two-column split: main stage tile (~75%) on the left, scrollable sidebar strip (~25%) on the right. Main participant is determined by `getMainParticipant`. Clicking a sidebar tile pins it; clicking the pinned tile unpins.

- [ ] **Step 1: Create StageLayout.tsx**

Create `frontend/src/features/voice/StageLayout.tsx`:

```tsx
import type { VoiceParticipant } from "../../hooks/useVoice";
import { ParticipantTile } from "./ParticipantTile";
import { getMainParticipant } from "./voiceLayout";

interface StageLayoutProps {
  participants: VoiceParticipant[];
  pinnedId: string | null;
  onPin: (identity: string) => void;
  onFullscreen: (identity: string) => void;
}

export function StageLayout({ participants, pinnedId, onPin, onFullscreen }: StageLayoutProps) {
  const main = getMainParticipant(participants, pinnedId);

  return (
    <div data-testid="stage-layout" className="flex h-full">
      {/* Main stage */}
      <div className="flex-1 p-3 min-w-0">
        {main && (
          <div className="w-full h-full rounded-xl overflow-hidden">
            <ParticipantTile
              participant={main}
              variant="main"
              isPinned={main.identity === pinnedId}
              onClick={() => onPin(main.identity)}
              onDoubleClick={() => onFullscreen(main.identity)}
            />
          </div>
        )}
      </div>

      {/* Sidebar strip */}
      <div
        className="w-[120px] flex-shrink-0 flex flex-col gap-2 py-3 pr-3 overflow-y-auto"
        style={{ borderLeft: "1px solid var(--color-dc-bg-floating)" }}
      >
        {participants.map((p) => (
          <div
            key={p.identity}
            style={{ aspectRatio: "16 / 9" }}
            className="rounded-lg overflow-hidden flex-shrink-0"
          >
            <ParticipantTile
              participant={p}
              variant="sidebar"
              isPinned={p.identity === pinnedId}
              onClick={() => onPin(p.identity)}
              onDoubleClick={() => onFullscreen(p.identity)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run tests**

```bash
cd frontend && npm test
```

Expected: 13 tests pass.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/features/voice/StageLayout.tsx
git commit -m "feat(voice): add StageLayout component"
```

---

## Task 6: FullscreenOverlay + tests

**Files:**
- Create: `frontend/src/features/voice/FullscreenOverlay.tsx`
- Create: `frontend/src/features/voice/FullscreenOverlay.test.tsx`

Fixed overlay over the entire app. Controls auto-hide after 3 seconds of no mouse movement and reappear on movement. Esc key and ✕ button both call `onClose`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/features/voice/FullscreenOverlay.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FullscreenOverlay } from "./FullscreenOverlay";
import type { VoiceParticipant } from "../../hooks/useVoice";

vi.mock("../../stores/voiceStore", () => ({
  useVoiceStore: () => ({
    isMuted: false,
    isDeafened: false,
    isCameraOn: false,
    isScreenSharing: false,
    setMuted: vi.fn(),
    setDeafened: vi.fn(),
    setCameraOn: vi.fn(),
    setScreenSharing: vi.fn(),
    leaveVoice: vi.fn(),
  }),
}));

function mkp(overrides: Partial<VoiceParticipant> = {}): VoiceParticipant {
  return {
    identity: "u1",
    name: "Alice",
    isSpeaking: false,
    isMicEnabled: true,
    isCameraEnabled: false,
    isScreenSharing: false,
    isLocal: false,
    cameraTrack: null,
    screenTrack: null,
    ...overrides,
  };
}

describe("FullscreenOverlay", () => {
  it("renders participant name", () => {
    render(<FullscreenOverlay participant={mkp({ name: "Alice" })} onClose={vi.fn()} />);
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("renders with data-testid fullscreen-overlay", () => {
    render(<FullscreenOverlay participant={mkp()} onClose={vi.fn()} />);
    expect(screen.getByTestId("fullscreen-overlay")).toBeInTheDocument();
  });

  it("calls onClose when the exit button is clicked", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<FullscreenOverlay participant={mkp()} onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: /exit/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose when Escape is pressed", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<FullscreenOverlay participant={mkp()} onClose={onClose} />);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail**

```bash
cd frontend && npm test
```

Expected: `Cannot find module './FullscreenOverlay'`

- [ ] **Step 3: Implement FullscreenOverlay.tsx**

Create `frontend/src/features/voice/FullscreenOverlay.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import type { VoiceParticipant } from "../../hooks/useVoice";
import { ParticipantTile } from "./ParticipantTile";
import { ControlBar } from "./ControlBar";

interface FullscreenOverlayProps {
  participant: VoiceParticipant;
  onClose: () => void;
}

export function FullscreenOverlay({ participant, onClose }: FullscreenOverlayProps) {
  const [controlsVisible, setControlsVisible] = useState(true);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Esc key to close
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // Auto-hide controls after 3s of no mouse movement
  function resetHideTimer() {
    setControlsVisible(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setControlsVisible(false), 3000);
  }

  useEffect(() => {
    resetHideTimer();
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      data-testid="fullscreen-overlay"
      className="fixed inset-0 z-[9999] bg-black flex flex-col"
      onMouseMove={resetHideTimer}
    >
      {/* Video / avatar fills the space */}
      <div className="flex-1 relative overflow-hidden">
        <ParticipantTile participant={participant} variant="main" />

        {/* Exit button — always visible */}
        <button
          aria-label="exit fullscreen"
          onClick={onClose}
          className="absolute top-4 right-4 px-3 py-1.5 rounded-md text-xs font-semibold transition-opacity"
          style={{ backgroundColor: "rgba(0,0,0,0.65)", color: "#dbdee1", border: "1px solid #4f5660" }}
        >
          ✕ Exit
        </button>
      </div>

      {/* Floating controls bar — fades on inactivity */}
      <div
        className="flex-shrink-0 transition-opacity duration-300"
        style={{
          opacity: controlsVisible ? 1 : 0,
          background: "linear-gradient(transparent, rgba(0,0,0,0.8))",
          pointerEvents: controlsVisible ? "auto" : "none",
        }}
        onMouseEnter={resetHideTimer}
      >
        <ControlBar floating />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests — confirm all pass**

```bash
cd frontend && npm test
```

Expected: 17 tests pass (13 layout utils + 4 overlay tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/features/voice/FullscreenOverlay.tsx frontend/src/features/voice/FullscreenOverlay.test.tsx
git commit -m "feat(voice): add FullscreenOverlay with auto-hide controls and tests"
```

---

## Task 7: VoicePanel refactor + integration tests

**Files:**
- Modify: `frontend/src/features/voice/VoicePanel.tsx`
- Create: `frontend/src/features/voice/VoicePanel.test.tsx`

Replaces the monolith. Owns `pinnedId` and `fullscreenId` as local state. Derives layout mode from participants. Renders the appropriate layout component and conditionally renders `FullscreenOverlay` on top.

- [ ] **Step 1: Write the failing integration tests**

Create `frontend/src/features/voice/VoicePanel.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VoicePanel } from "./VoicePanel";
import { ConnectionState } from "livekit-client";
import type { VoiceParticipant } from "../../hooks/useVoice";

vi.mock("../../stores/voiceStore", () => ({
  useVoiceStore: () => ({
    activeVoiceChannelId: "ch-1",
    isMuted: false,
    isDeafened: false,
    isCameraOn: false,
    isScreenSharing: false,
    isConnecting: false,
    setMuted: vi.fn(),
    setDeafened: vi.fn(),
    setCameraOn: vi.fn(),
    setScreenSharing: vi.fn(),
    leaveVoice: vi.fn(),
  }),
}));

vi.mock("../../stores/guildStore", () => ({
  useGuildStore: () => ({ channels: {}, activeGuildId: null }),
}));

function mkp(overrides: Partial<VoiceParticipant> = {}): VoiceParticipant {
  return {
    identity: "u1",
    name: "Alice",
    isSpeaking: false,
    isMicEnabled: true,
    isCameraEnabled: false,
    isScreenSharing: false,
    isLocal: false,
    cameraTrack: null,
    screenTrack: null,
    ...overrides,
  };
}

describe("VoicePanel layout switching", () => {
  it("renders GridLayout when no participant has video or screen", () => {
    render(<VoicePanel participants={[mkp()]} connectionState={ConnectionState.Connected} />);
    expect(screen.getByTestId("grid-layout")).toBeInTheDocument();
    expect(screen.queryByTestId("stage-layout")).toBeNull();
  });

  it("renders StageLayout when any participant has a screen track", () => {
    render(
      <VoicePanel
        participants={[mkp({ identity: "a", screenTrack: {} as any })]}
        connectionState={ConnectionState.Connected}
      />
    );
    expect(screen.getByTestId("stage-layout")).toBeInTheDocument();
    expect(screen.queryByTestId("grid-layout")).toBeNull();
  });

  it("renders StageLayout when any participant has a camera track", () => {
    render(
      <VoicePanel
        participants={[mkp({ identity: "a", cameraTrack: {} as any })]}
        connectionState={ConnectionState.Connected}
      />
    );
    expect(screen.getByTestId("stage-layout")).toBeInTheDocument();
  });
});

describe("VoicePanel fullscreen", () => {
  it("opens FullscreenOverlay on double-click of a grid tile", async () => {
    const user = userEvent.setup();
    render(<VoicePanel participants={[mkp({ identity: "a", name: "Alice" })]} connectionState={ConnectionState.Connected} />);
    await user.dblClick(screen.getByTestId("participant-tile-a"));
    expect(screen.getByTestId("fullscreen-overlay")).toBeInTheDocument();
  });

  it("closes FullscreenOverlay when Esc is pressed", async () => {
    const user = userEvent.setup();
    render(<VoicePanel participants={[mkp({ identity: "a" })]} connectionState={ConnectionState.Connected} />);
    await user.dblClick(screen.getByTestId("participant-tile-a"));
    expect(screen.getByTestId("fullscreen-overlay")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("fullscreen-overlay")).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests — confirm new tests fail**

```bash
cd frontend && npm test
```

Expected: new tests in `VoicePanel.test.tsx` fail — VoicePanel still renders old markup.

- [ ] **Step 3: Rewrite VoicePanel.tsx**

Replace the full contents of `frontend/src/features/voice/VoicePanel.tsx`:

```tsx
import { useEffect, useState } from "react";
import { ConnectionState } from "livekit-client";
import { useVoiceStore } from "../../stores/voiceStore";
import { useGuildStore } from "../../stores/guildStore";
import type { VoiceParticipant } from "../../hooks/useVoice";
import { getLayoutMode } from "./voiceLayout";
import { GridLayout } from "./GridLayout";
import { StageLayout } from "./StageLayout";
import { FullscreenOverlay } from "./FullscreenOverlay";
import { ControlBar } from "./ControlBar";

interface VoicePanelProps {
  participants: VoiceParticipant[];
  connectionState: ConnectionState;
}

export function VoicePanel({ participants, connectionState }: VoicePanelProps) {
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [fullscreenId, setFullscreenId] = useState<string | null>(null);

  const { activeVoiceChannelId, isConnecting } = useVoiceStore();
  const { channels, activeGuildId } = useGuildStore();

  const channel = activeGuildId
    ? (channels[activeGuildId] ?? []).find((c) => c.id === activeVoiceChannelId)
    : null;

  const layoutMode = getLayoutMode(participants);

  // Clear pin when layout reverts to grid or pinned participant leaves
  useEffect(() => {
    if (layoutMode === "grid") {
      setPinnedId(null);
    } else if (pinnedId && !participants.find((p) => p.identity === pinnedId)) {
      setPinnedId(null);
    }
  }, [participants, layoutMode, pinnedId]);

  // Clear fullscreen when that participant leaves
  useEffect(() => {
    if (fullscreenId && !participants.find((p) => p.identity === fullscreenId)) {
      setFullscreenId(null);
    }
  }, [participants, fullscreenId]);

  const fullscreenParticipant = fullscreenId
    ? (participants.find((p) => p.identity === fullscreenId) ?? null)
    : null;

  const isConnected = connectionState === ConnectionState.Connected;
  const isReconnecting = connectionState === ConnectionState.Reconnecting;

  function handlePin(identity: string) {
    setPinnedId((prev) => (prev === identity ? null : identity));
  }

  return (
    <div
      className="flex-1 flex flex-col overflow-hidden"
      style={{ backgroundColor: "var(--color-dc-bg-primary)" }}
    >
      {/* Header */}
      <div
        className="h-12 px-4 flex items-center gap-2 flex-shrink-0 border-b"
        style={{ borderColor: "var(--color-dc-bg-floating)" }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style={{ color: "var(--color-dc-channel-default)" }}>
          <path d="M12 3c-4.97 0-9 4.03-9 9v7c0 1.1.9 2 2 2h4v-8H5v-1c0-3.87 3.13-7 7-7s7 3.13 7 7v1h-4v8h4c1.1 0 2-.9 2-2v-7c0-4.97-4.03-9-9-9z"/>
        </svg>
        <span className="font-semibold" style={{ color: "var(--color-dc-header-primary)" }}>
          {channel?.name ?? "Voice"}
        </span>
        {(isConnecting || isReconnecting) && (
          <span className="text-xs ml-2" style={{ color: "var(--color-dc-text-muted)" }}>
            {isReconnecting ? "Reconnecting…" : "Connecting…"}
          </span>
        )}
        {isConnected && (
          <span className="text-xs ml-2 flex items-center gap-1" style={{ color: "#23a55a" }}>
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#23a55a]" />
            Connected
          </span>
        )}
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-hidden">
        {layoutMode === "stage" ? (
          <StageLayout
            participants={participants}
            pinnedId={pinnedId}
            onPin={handlePin}
            onFullscreen={setFullscreenId}
          />
        ) : (
          <GridLayout
            participants={participants}
            onFullscreen={setFullscreenId}
          />
        )}
      </div>

      {/* Controls */}
      <div
        className="flex-shrink-0 border-t"
        style={{ borderColor: "var(--color-dc-bg-floating)", backgroundColor: "var(--color-dc-bg-secondary)" }}
      >
        <ControlBar />
      </div>

      {/* Fullscreen overlay — rendered outside layout flow */}
      {fullscreenParticipant && (
        <FullscreenOverlay
          participant={fullscreenParticipant}
          onClose={() => setFullscreenId(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run all tests — confirm everything passes**

```bash
cd frontend && npm test
```

Expected: 21 tests pass across `voiceLayout.test.ts`, `FullscreenOverlay.test.tsx`, `VoicePanel.test.tsx`.

- [ ] **Step 5: Confirm the app builds without errors**

```bash
cd frontend && npm run build 2>&1 | grep -E "error|warning" | grep -v "useVoice"
```

Expected: no new errors (the pre-existing `useVoice.ts` audio option error is unrelated and can be ignored).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/features/voice/VoicePanel.tsx frontend/src/features/voice/VoicePanel.test.tsx
git commit -m "feat(voice): redesign VoicePanel — adaptive layout, pin, fullscreen"
```

---

## Self-Review Checklist

**Spec coverage:**
- ✅ State 1 (audio-only equal grid) → `GridLayout.tsx`, Task 4
- ✅ Grid column counts (1/2/3) → `getGridColumns`, Task 1
- ✅ State 2 (screen/camera → main stage + sidebar) → `StageLayout.tsx`, Task 5
- ✅ Main participant priority order (pin → screen → camera → speaking → first) → `getMainParticipant`, Task 1
- ✅ ⛶ expand button on hover over main stage → `ParticipantTile` variant="main", Task 2
- ✅ Pin on click (sidebar tile) → `StageLayout` + `VoicePanel.handlePin`, Task 5+7
- ✅ Pin cleared when participant leaves or layout reverts → `VoicePanel` effect, Task 7
- ✅ State 3 (fullscreen overlay on double-click / ⛶ button) → `FullscreenOverlay`, Task 6
- ✅ Esc and ✕ to exit fullscreen → `FullscreenOverlay` keydown handler + button, Task 6
- ✅ Controls auto-hide in fullscreen → `FullscreenOverlay` hide timer, Task 6
- ✅ ControlBar reused in overlay (floating prop) → Tasks 3 + 6
- ✅ Speaking ring preserved → `ParticipantTile` injected CSS, Task 2
- ✅ Muted + screen-share badges preserved → `ParticipantTile`, Task 2
- ✅ No backend/store changes → confirmed, only VoicePanel local state

**Placeholder scan:** None found.

**Type consistency:**
- `VoiceParticipant` imported from `../../hooks/useVoice` consistently across all tasks ✅
- `data-testid="grid-layout"` in `GridLayout.tsx` matches test assertion in Task 7 ✅
- `data-testid="stage-layout"` in `StageLayout.tsx` matches test assertion in Task 7 ✅
- `data-testid="fullscreen-overlay"` in `FullscreenOverlay.tsx` matches assertions in Tasks 6+7 ✅
- `data-testid={participant-tile-${identity}}` in `ParticipantTile.tsx` matches Task 7 test ✅
- `onPin` prop in `StageLayout` takes `(identity: string) => void` — `handlePin` in `VoicePanel` matches ✅
- `onFullscreen` prop is `(identity: string) => void` throughout ✅
