import { useCallback, useEffect, useRef, useState } from "react";
import { ConnectionState, Room, RoomEvent, Track, type RemoteParticipant, type RemoteTrackPublication } from "livekit-client";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ParticipantTile } from "../voice/ParticipantTile";
import { BroadcastTile } from "../voice/BroadcastTile";
import { buildTiles } from "../voice/voiceLayout";
import { buildParticipant } from "./participants";
import type { VoiceParticipant } from "../../hooks/useVoice";
import {
  CALL_VIEW_EVENTS, saveCallViewBounds,
  type CallViewCommand, type CallViewControls, type CallViewInit,
} from "../../lib/callView";

const LAYOUT_KEY = "callView.layout";

function readLayout(): "row" | "column" {
  try { return localStorage.getItem(LAYOUT_KEY) === "column" ? "column" : "row"; } catch { return "row"; }
}

/** Only video (cameras, screen shares) is needed here: audio plays in the main window. */
function subscribeVideoOnly(pub: RemoteTrackPublication) {
  pub.setSubscribed(pub.kind === Track.Kind.Video);
}

/** Root component of the desktop call window (index.html?view=call). */
export function CallViewWindow() {
  const [init, setInit] = useState<CallViewInit | null>(null);
  const [participants, setParticipants] = useState<VoiceParticipant[]>([]);
  const [connState, setConnState] = useState<ConnectionState>(ConnectionState.Disconnected);
  const [layout, setLayout] = useState<"row" | "column">(readLayout);
  const [pinned, setPinned] = useState(true);
  const [controls, setControls] = useState<CallViewControls | null>(null);
  const [soundsOpen, setSoundsOpen] = useState(false);
  const roomRef = useRef<Room | null>(null);

  // Messages from the main window. A repeated init for the call we're already watching is
  // ignored: swapping the token would tear down a working connection (black video).
  useEffect(() => {
    const unlisten = listen<CallViewInit>(CALL_VIEW_EVENTS.init, (e) => {
      setInit((current) => {
        const connected = roomRef.current?.state === ConnectionState.Connected;
        return current && connected && current.sessionId === e.payload.sessionId ? current : e.payload;
      });
    });
    const unlistenState = listen<CallViewControls>(CALL_VIEW_EVENTS.state, (e) => setControls(e.payload));
    return () => {
      void unlisten.then((f) => f());
      void unlistenState.then((f) => f());
    };
  }, []);

  // Handshake: ask for a viewer token only while we don't have one. Each answer is a new
  // token, so asking while connected would reconnect the viewer every time.
  useEffect(() => {
    if (init) return;
    const announce = () => void emitTo("main", CALL_VIEW_EVENTS.ready).catch(() => {});
    announce();
    const retry = setInterval(announce, 2000);
    return () => clearInterval(retry);
  }, [init]);

  // Remember where the user put the window and how big they made it.
  useEffect(() => {
    const win = getCurrentWindow();
    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    async function saveBounds() {
      const [pos, size, scale] = await Promise.all([win.outerPosition(), win.innerSize(), win.scaleFactor()]);
      saveCallViewBounds({ x: pos.x / scale, y: pos.y / scale, width: size.width / scale, height: size.height / scale });
    }
    const scheduleSave = () => {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => void saveBounds().catch(() => {}), 300);
    };
    const unMoved = win.onMoved(scheduleSave);
    const unResized = win.onResized(scheduleSave);
    return () => {
      if (saveTimer) clearTimeout(saveTimer);
      void unMoved.then((f) => f());
      void unResized.then((f) => f());
    };
  }, []);

  useEffect(() => { if (init) document.title = init.title; }, [init]);

  const refresh = useCallback(() => {
    const room = roomRef.current;
    if (!room || !init) return;
    const list: VoiceParticipant[] = [];
    room.remoteParticipants.forEach((p: RemoteParticipant) => list.push(buildParticipant(p, p.identity === init.selfIdentity)));
    // Other people first, yourself last.
    list.sort((a, b) => Number(a.isLocal) - Number(b.isLocal));
    setParticipants(list);
  }, [init]);

  // Join as a hidden viewer once the token arrives (and again for a new call).
  useEffect(() => {
    if (!init) return;
    // No adaptive stream: switching quality layers when the window's visibility changes
    // (app switching, occlusion, dragging) froze or blacked out the video for a second.
    const room = new Room({ adaptiveStream: false });
    roomRef.current = room;
    room.on(RoomEvent.ConnectionStateChanged, setConnState);
    // LiveKit gave up reconnecting: drop the token so the handshake fetches a fresh one.
    room.on(RoomEvent.Disconnected, () => setInit(null));
    room.on(RoomEvent.TrackPublished, (pub) => { subscribeVideoOnly(pub); refresh(); });
    for (const ev of [
      RoomEvent.ParticipantConnected, RoomEvent.ParticipantDisconnected, RoomEvent.TrackSubscribed,
      RoomEvent.TrackUnsubscribed, RoomEvent.TrackUnpublished, RoomEvent.TrackMuted, RoomEvent.TrackUnmuted,
      RoomEvent.ActiveSpeakersChanged,
    ] as const) room.on(ev, refresh);
    room.connect(init.url, init.token, { autoSubscribe: false }).then(() => {
      room.remoteParticipants.forEach((p) => p.trackPublications.forEach(subscribeVideoOnly));
      refresh();
    }).catch(() => {
      // Expired token or the call just ended: ask again after a moment.
      setConnState(ConnectionState.Disconnected);
      setTimeout(() => setInit((current) => (current === init ? null : current)), 2000);
    });
    return () => {
      room.removeAllListeners();
      void room.disconnect();
      roomRef.current = null;
    };
  }, [init, refresh]);

  function toggleLayout() {
    const next = layout === "row" ? "column" : "row";
    setLayout(next);
    try { localStorage.setItem(LAYOUT_KEY, next); } catch { /* storage unavailable */ }
  }

  function togglePinned() {
    const next = !pinned;
    setPinned(next);
    void getCurrentWindow().setAlwaysOnTop(next).catch(() => {});
  }

  /** The call lives in the main window; ask it to act and wait for the new state. */
  function send(command: CallViewCommand) {
    void emitTo("main", CALL_VIEW_EVENTS.command, command).catch(() => {});
  }

  async function hide() {
    // The call continues in the main window; it can reopen this window from the sidebar.
    await emitTo("main", CALL_VIEW_EVENTS.closed).catch(() => {});
    await getCurrentWindow().close().catch(() => {});
  }

  const status = !init || connState === ConnectionState.Connecting
    ? "Connecting…"
    : connState === ConnectionState.Reconnecting || connState === ConnectionState.SignalReconnecting
      ? "Reconnecting…"
      : connState === ConnectionState.Disconnected ? "Disconnected" : null;

  const tiles = buildTiles(participants);
  // Row mode fills the window with a near-square grid; column mode stacks everything.
  const columns = layout === "column" ? 1 : Math.max(1, Math.ceil(Math.sqrt(tiles.length)));
  const rows = Math.max(1, Math.ceil(tiles.length / columns));
  const iconButton = "p-1 rounded transition-colors hover:bg-[var(--color-dc-bg-modifier-hover)]";

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden select-none"
      style={{ backgroundColor: "var(--color-dc-bg-secondary)", color: "var(--color-dc-text-normal)" }}>
      {/* Title bar — drag anywhere on it to move the window */}
      <div data-tauri-drag-region className="h-8 flex-shrink-0 flex items-center gap-2 pl-3 pr-1.5 cursor-grab"
        style={{ borderBottom: "1px solid var(--color-dc-bg-floating)" }}>
        <span data-tauri-drag-region className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ backgroundColor: status ? "var(--color-dc-idle)" : "var(--color-dc-online)" }} />
        <span data-tauri-drag-region className="text-xs font-medium truncate flex-1" style={{ color: "var(--color-dc-header-primary)" }}>
          {status ?? init?.title}
        </span>
        <button onClick={toggleLayout} className={iconButton} style={{ color: "var(--color-dc-interactive-normal)" }}
          title={layout === "column" ? "Show as a grid" : "Stack vertically"} aria-label={layout === "column" ? "Show as a grid" : "Stack vertically"}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            {layout === "column"
              ? <><rect x="3" y="5" width="8" height="14" rx="1.5" /><rect x="13" y="5" width="8" height="14" rx="1.5" /></>
              : <><rect x="5" y="3" width="14" height="8" rx="1.5" /><rect x="5" y="13" width="14" height="8" rx="1.5" /></>}
          </svg>
        </button>
        <button onClick={togglePinned} className={iconButton} aria-pressed={pinned}
          style={{ color: pinned ? "var(--color-dc-interactive-active)" : "var(--color-dc-interactive-muted)" }}
          title={pinned ? "Always on top (click to unpin)" : "Keep on top of other windows"} aria-label="Always on top">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M16 3a1 1 0 0 1 .7 1.7L15 6.4v4.1l2.7 2.7a1 1 0 0 1-.7 1.7h-4v6.1a1 1 0 0 1-2 0v-6.1H7a1 1 0 0 1-.7-1.7L9 10.5V6.4L7.3 4.7A1 1 0 0 1 8 3z" />
          </svg>
        </button>
        <button onClick={() => void hide()} className={iconButton} style={{ color: "var(--color-dc-interactive-normal)" }}
          title="Hide (call continues — reopen from the sidebar)" aria-label="Hide call window">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59 7.11 5.7A1 1 0 0 0 5.7 7.11L10.59 12 5.7 16.89a1 1 0 1 0 1.41 1.41L12 13.41l4.89 4.89a1 1 0 0 0 1.41-1.41L13.41 12l4.89-4.89a1 1 0 0 0 0-1.4z" />
          </svg>
        </button>
      </div>

      {/* Tiles fill the window; resize the window to make them bigger */}
      <div className="flex-1 min-h-0 grid gap-2 p-2"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}>
        {tiles.map((tile) => (
          <div key={tile.id} className="min-w-0 min-h-0">
            {tile.type === "broadcast"
              ? <BroadcastTile participant={tile.participant} variant="grid" />
              : <ParticipantTile participant={tile.participant} variant="grid" volumeMenu={false} />}
          </div>
        ))}
        {tiles.length === 0 && (
          <div className="flex items-center justify-center text-sm" style={{ color: "var(--color-dc-text-muted)" }}>
            {status ?? "Waiting for video…"}
          </div>
        )}
      </div>

      {/* Soundboard */}
      {controls && soundsOpen && (
        <div className="flex-shrink-0 mx-2 mb-2 p-2 rounded-lg max-h-36 overflow-y-auto"
          style={{ backgroundColor: "var(--color-dc-bg-tertiary)" }}>
          {!controls.soundboard.available && (
            <p className="text-xs mb-1.5" style={{ color: "var(--color-dc-text-muted)" }}>Unmute and undeafen to play sounds.</p>
          )}
          <div className="grid gap-1" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))" }}>
            {controls.soundboard.sounds.map((sound) => (
              <button key={sound.id} disabled={!controls.soundboard.available}
                onClick={() => send({ type: "sound", id: sound.id })}
                className="h-8 px-2 rounded flex items-center gap-1.5 text-xs truncate transition-colors bg-white/5 hover:bg-white/15 active:bg-white/25 disabled:opacity-40"
                title={`${sound.name} · Play for everyone`}>
                <span aria-hidden="true">{sound.emoji ?? "🔊"}</span>
                <span className="truncate">{sound.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Call controls */}
      {controls && (
        <div className="flex-shrink-0 flex items-center justify-center gap-2 pb-2 px-6">
          <ControlButton
            label={controls.isMuted ? "Unmute" : "Mute"}
            active={controls.isMuted}
            onClick={() => send({ type: "mute" })}
            icon={controls.isMuted
              ? <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z" />
              : <path d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z" />}
          />
          <ControlButton
            label={controls.isDeafened ? "Undeafen" : "Deafen"}
            active={controls.isDeafened}
            onClick={() => send({ type: "deafen" })}
            icon={<>
              <path d="M12 3a9 9 0 0 0-9 9v7a2 2 0 0 0 2 2h2v-8H5v-1a7 7 0 0 1 14 0v1h-2v8h2a2 2 0 0 0 2-2v-7a9 9 0 0 0-9-9z" />
              {controls.isDeafened && <path d="M2.3 3.7 3.7 2.3l18 18-1.4 1.4z" />}
            </>}
          />
          <ControlButton
            label={controls.cameraOn ? "Turn off camera" : "Turn on camera"}
            on={controls.cameraOn}
            onClick={() => send({ type: "camera" })}
            icon={<>
              <path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z" />
              {!controls.cameraOn && <path d="M2.3 3.7 3.7 2.3l18 18-1.4 1.4z" />}
            </>}
          />
          <ControlButton
            label={soundsOpen ? "Hide soundboard" : "Soundboard"}
            on={soundsOpen}
            onClick={() => setSoundsOpen((o) => !o)}
            icon={<>
              <rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" />
              <rect x="3" y="14" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" />
            </>}
          />
          <ControlButton
            label={init?.kind === "guild" ? "Disconnect" : "End call"}
            danger
            onClick={() => send({ type: "hangup" })}
            icon={<path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08A.99.99 0 0 1 0 12.37c0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.66c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48a1 1 0 0 1-.71.29c-.27 0-.52-.11-.7-.28a11.27 11.27 0 0 0-2.67-1.85.985.985 0 0 1-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z" />}
          />
        </div>
      )}
      {/* Resize grip: frameless windows can't always be resized from their edges (Windows) */}
      <div
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          void getCurrentWindow().startResizeDragging("SouthEast").catch(() => {});
        }}
        className="fixed right-0 bottom-0 w-4 h-4 cursor-nwse-resize flex items-end justify-end p-0.5 opacity-60 hover:opacity-100"
        title="Drag to resize"
        aria-hidden="true"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" style={{ color: "var(--color-dc-interactive-normal)" }}>
          <path d="M9 3 3 9M9 6 6 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      </div>
    </div>
  );
}

/** Round call-control button. `active` = a "you're cut off" state (red), `on` = a feature that's on (green). */
function ControlButton({ label, icon, onClick, active, on, danger }: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  on?: boolean;
  danger?: boolean;
}) {
  const background = danger ? "var(--color-dc-red, #ed4245)"
    : on ? "var(--color-dc-online, #23a55a)"
    : "var(--color-dc-bg-tertiary)";
  const color = danger || on ? "#fff" : active ? "var(--color-dc-red, #ed4245)" : "var(--color-dc-interactive-normal)";
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={danger ? undefined : !!(active || on)}
      className="w-9 h-9 rounded-full flex items-center justify-center transition-[filter] hover:brightness-125"
      style={{ backgroundColor: background, color }}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">{icon}</svg>
    </button>
  );
}
