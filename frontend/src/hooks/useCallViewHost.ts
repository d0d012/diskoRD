import { useCallback, useEffect, useMemo, useRef } from "react";
import { emitTo, listen } from "@tauri-apps/api/event";
import { useAuthStore } from "../stores/authStore";
import { useSoundboardStore } from "../stores/soundboardStore";
import { useUserStore } from "../stores/userStore";
import { SOUNDBOARD_SOUNDS } from "../lib/soundboard";
import { isTauri } from "../lib/inviteLinks";
import {
  CALL_VIEW_EVENTS, CALL_VIEW_LABEL, closeCallView, openCallView,
  type CallViewCommand, type CallViewControls, type CallViewInit, type CallViewKind,
} from "../lib/callView";

const desktop = isTauri();

export interface CallViewHostOptions {
  kind: CallViewKind;
  /** The current call/voice channel, or null when there is none. */
  sessionId: string | null;
  title: string;
  /** Whether the window should be open right now. */
  visible: boolean;
  isMuted: boolean;
  isDeafened: boolean;
  cameraOn: boolean;
  fetchViewer: (sessionId: string) => Promise<{ url: string; token: string }>;
  /** Mute/deafen/camera/hang-up from the window. Sounds are handled here. */
  onCommand: (command: Exclude<CallViewCommand, { type: "sound" }>) => void;
  /** The window was closed by the user (✕, Cmd+W, Alt+F4). */
  onClosed: () => void;
}

/**
 * Main-window side of the desktop call window (see lib/callView.ts). Mounted for both DM
 * calls and guild voice; only the host with an active session answers the window, and a
 * host only closes a window it opened, so the two never fight over it.
 */
export function useCallViewHost(options: CallViewHostOptions): void {
  const { sessionId, visible, isMuted, isDeafened, cameraOn } = options;
  const active = desktop && !!sessionId;
  const show = active && visible;

  const soundboardAvailable = useSoundboardStore((s) => !!s.session && s.available);
  const guildSounds = useSoundboardStore((s) => s.sounds);
  // Known profiles ride along with the controls so the call window can render avatars;
  // any profile change re-memoises and re-emits state.
  const users = useUserStore((s) => s.users);
  const controls = useMemo<CallViewControls>(() => ({
    isMuted,
    isDeafened,
    cameraOn,
    profiles: users,
    soundboard: {
      available: soundboardAvailable,
      sounds: [
        ...SOUNDBOARD_SOUNDS.map(({ id, name, emoji }) => ({ id, name, emoji })),
        // Guild clips only exist in guild voice; DM calls have built-ins only.
        ...(options.kind === "guild" ? guildSounds.map(({ id, name }) => ({ id, name })) : []),
      ],
    },
  }), [isMuted, isDeafened, cameraOn, soundboardAvailable, guildSounds, options.kind, users]);

  // Latest values for the long-lived listeners below.
  const latest = useRef({ options, controls, active });
  useEffect(() => { latest.current = { options, controls, active }; });

  // Open/close with the session. Only close a window this host opened.
  const openedRef = useRef(false);
  useEffect(() => {
    if (!desktop) return;
    if (show) {
      openedRef.current = true;
      void openCallView(() => {
        openedRef.current = false;
        if (latest.current.active) latest.current.options.onClosed();
      });
    } else if (openedRef.current) {
      openedRef.current = false;
      void closeCallView();
    }
  }, [show]);

  // Keep the window's buttons in sync.
  useEffect(() => {
    if (show) void emitTo(CALL_VIEW_LABEL, CALL_VIEW_EVENTS.state, controls).catch(() => {});
  }, [show, controls]);

  /** The session the window was last given, to notice channel switches. */
  const sentSessionRef = useRef<string | null>(null);

  /** Sends the window a fresh viewer token for the current session, plus control state. */
  const sendInit = useCallback(async () => {
    const { options: o, controls: c, active: isActive } = latest.current;
    const selfIdentity = useAuthStore.getState().user?.id;
    if (!isActive || !o.sessionId || !selfIdentity) return;
    try {
      const viewer = await o.fetchViewer(o.sessionId);
      const init: CallViewInit = { kind: o.kind, sessionId: o.sessionId, title: o.title, selfIdentity, ...viewer };
      sentSessionRef.current = o.sessionId;
      await emitTo(CALL_VIEW_LABEL, CALL_VIEW_EVENTS.init, init);
      await emitTo(CALL_VIEW_LABEL, CALL_VIEW_EVENTS.state, c);
    } catch { /* the window keeps asking; the next attempt may succeed */ }
  }, []);

  // Switching to another voice channel while the window is open: hand it the new call.
  useEffect(() => {
    if (!show || !sessionId) return;
    const previous = sentSessionRef.current;
    sentSessionRef.current = sessionId;
    if (previous && previous !== sessionId) void sendInit();
  }, [show, sessionId, sendInit]);



  useEffect(() => {
    if (!desktop) return;
    const unlisten = [
      listen(CALL_VIEW_EVENTS.ready, () => void sendInit()),
      listen(CALL_VIEW_EVENTS.closed, () => {
        if (latest.current.active) latest.current.options.onClosed();
      }),
      listen<CallViewCommand>(CALL_VIEW_EVENTS.command, (e) => {
        if (!latest.current.active) return;
        const command = e.payload;
        if (command.type === "sound") void useSoundboardStore.getState().session?.play(command.id);
        else latest.current.options.onCommand(command);
      }),
    ];
    return () => unlisten.forEach((p) => void p.then((f) => f()));
  }, [sendInit]);
}
