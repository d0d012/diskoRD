import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { BackgroundThrottlingPolicy } from "@tauri-apps/api/window";

/**
 * Desktop call window: a separate, always-on-top OS window that shows a call's video
 * (a DM call or a guild voice channel). The call itself (mic, camera, soundboard,
 * controls) stays in the main window; the call window joins the room as a hidden,
 * subscribe-only viewer and drives the call by sending commands back.
 *
 *   call window ──ready──▶ main  (fetches a viewer token)
 *   call window ◀──init── main
 *   call window ──closed─▶ main  (user hid it; reopen from the sidebar)
 *   call window ─command─▶ main  (mute, deafen, camera, hang up, play a sound)
 *   call window ◀──state── main  (control + soundboard state, on change and after init)
 */
export const CALL_VIEW_LABEL = "call-view";
export const CALL_VIEW_EVENTS = {
  ready: "call-view:ready",
  init: "call-view:init",
  closed: "call-view:closed",
  command: "call-view:command",
  state: "call-view:state",
} as const;

export type CallViewKind = "dm" | "guild";

export interface CallViewInit {
  kind: CallViewKind;
  /** DM channel or voice channel id; a new id means a different call. */
  sessionId: string;
  title: string;
  url: string;
  token: string;
  /** The user's real LiveKit identity, so their own tile is labelled "You". */
  selfIdentity: string;
}

export interface CallViewSound { id: string; name: string; emoji?: string }

export interface CallViewControls {
  isMuted: boolean;
  isDeafened: boolean;
  cameraOn: boolean;
  soundboard: { available: boolean; sounds: CallViewSound[] };
}

export type CallViewCommand =
  | { type: "mute" | "deafen" | "camera" | "hangup" }
  | { type: "sound"; id: string };

const BOUNDS_KEY = "callView.bounds";

export interface CallViewBounds { x: number; y: number; width: number; height: number }

export function loadCallViewBounds(): CallViewBounds | null {
  try {
    const b = JSON.parse(localStorage.getItem(BOUNDS_KEY) ?? "null") as CallViewBounds | null;
    return b && [b.x, b.y, b.width, b.height].every(Number.isFinite) ? b : null;
  } catch {
    return null;
  }
}

export function saveCallViewBounds(b: CallViewBounds): void {
  try { localStorage.setItem(BOUNDS_KEY, JSON.stringify(b)); } catch { /* storage unavailable */ }
}

/**
 * Opens the call window, or brings it forward if it's already open. `onClosed` runs when
 * the window goes away for any reason (✕, Cmd+W/Alt+F4, or closeCallView).
 */
export async function openCallView(onClosed?: () => void): Promise<void> {
  const existing = await WebviewWindow.getByLabel(CALL_VIEW_LABEL);
  if (existing) {
    await existing.show().catch(() => {});
    await existing.setFocus().catch(() => {});
    return;
  }
  const b = loadCallViewBounds();
  const win = new WebviewWindow(CALL_VIEW_LABEL, {
    url: "index.html?view=call",
    title: "diskoRD — Call",
    width: b?.width ?? 480,
    height: b?.height ?? 320,
    ...(b ? { x: b.x, y: b.y } : { center: true }),
    minWidth: 240,
    minHeight: 200,
    alwaysOnTop: true,
    decorations: false,
    resizable: true,
    shadow: true,
    focus: false,
    // macOS 14+: keep video running when the window is covered or another app is active.
    backgroundThrottling: "disabled" as BackgroundThrottlingPolicy,
  });
  win.once("tauri://error", () => {});
  if (onClosed) void win.once("tauri://destroyed", onClosed);
}

export async function closeCallView(): Promise<void> {
  const existing = await WebviewWindow.getByLabel(CALL_VIEW_LABEL);
  await existing?.close().catch(() => {});
}
