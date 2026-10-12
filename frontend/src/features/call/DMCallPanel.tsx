import { useCallback, useEffect, useRef, useState } from "react";
import {
  Room,
  RoomEvent,
  Track,
  ConnectionState,
  RemoteParticipant,
  LocalAudioTrack,
} from "livekit-client";
import { isCallPanelHidden, useCallStore } from "../../stores/callStore";
import { useAuthStore } from "../../stores/authStore";
import { apiBaseURL } from "../../lib/api";
import { GlobalVoiceAudio } from "../voice/GlobalVoiceAudio";
import { Soundboard } from "../voice/Soundboard";
import { attachSoundboard } from "../../lib/soundboard";
import { useVoiceStore } from "../../stores/voiceStore";
import { useNoiseCancellation } from "../../hooks/useNoiseCancellation";
import { ParticipantTile } from "../voice/ParticipantTile";
import { FullscreenOverlay } from "../voice/FullscreenOverlay";
import { buildTiles } from "../voice/voiceLayout";
import type { VoiceParticipant } from "../../hooks/useVoice";
import type { VoiceTile } from "../voice/voiceLayout";
import { buildParticipant } from "./participants";
import { cameraDeviceId, micConstraints } from "../../lib/mediaDevices";
import { useSettingsStore } from "../../stores/settingsStore";
import { api } from "../../lib/api";
import { isTauri } from "../../lib/inviteLinks";
import { useCallViewHost } from "../../hooks/useCallViewHost";

/** On desktop the call's video shows in a separate OS window instead of the in-app card. */
const desktop = isTauri();


const POSITION_KEY = "dmCallPanel.position";
const WIDTH_KEY = "dmCallPanel.width";
const LAYOUT_KEY = "dmCallPanel.layout";

type TileLayout = "row" | "column";

function loadLayout(): TileLayout {
  try {
    return localStorage.getItem(LAYOUT_KEY) === "column" ? "column" : "row";
  } catch {
    return "row";
  }
}
const MARGIN = 8;
const MIN_WIDTH = 280;

function loadWidth(): number | null {
  try {
    const w = Number(localStorage.getItem(WIDTH_KEY));
    return Number.isFinite(w) && w >= MIN_WIDTH ? w : null;
  } catch {
    return null;
  }
}

interface PanelPosition { x: number; y: number }

function loadPosition(): PanelPosition | null {
  try {
    const p = JSON.parse(localStorage.getItem(POSITION_KEY) ?? "null") as PanelPosition | null;
    return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null;
  } catch {
    return null;
  }
}

function clampPosition(p: PanelPosition, el: HTMLElement | null): PanelPosition {
  const w = el?.offsetWidth ?? 340;
  const h = el?.offsetHeight ?? 60;
  return {
    x: Math.min(Math.max(MARGIN, p.x), Math.max(MARGIN, window.innerWidth - w - MARGIN)),
    y: Math.min(Math.max(MARGIN, p.y), Math.max(MARGIN, window.innerHeight - h - MARGIN)),
  };
}


export function DMCallPanel() {
  const { state, call, endCall, keepalive, notice, setNotice } = useCallStore();
  const { isMuted, setMuted, isDeafened, setDeafened, isNoiseCancellationEnabled } = useVoiceStore();
  const { processStream, isEnabled: isNCEnabled, toggle: toggleNC } = useNoiseCancellation();

  const roomRef = useRef<Room | null>(null);
  const ncCleanupRef = useRef<(() => void) | null>(null);
  const [participants, setParticipants] = useState<VoiceParticipant[]>([]);
  const [connState, setConnState] = useState<ConnectionState>(ConnectionState.Disconnected);
  const [fullscreenTile, setFullscreenTile] = useState<VoiceTile | null>(null);
  const inputDeviceId = useSettingsStore((s) => s.inputDeviceId);
  const videoDeviceId = useSettingsStore((s) => s.videoDeviceId);
  // Camera is per call: remembering the channel resets it for the next call.
  const [cameraChannel, setCameraChannel] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [position, setPosition] = useState<PanelPosition | null>(loadPosition);
  const [userWidth, setUserWidth] = useState<number | null>(loadWidth);
  const [layout, setLayout] = useState<TileLayout>(loadLayout);
  const hidden = useCallStore(isCallPanelHidden);
  const cameraOnNow = state === "in-call" && !!call && cameraChannel === call.channelId;
  useCallViewHost({
    kind: "dm",
    sessionId: state === "in-call" && call ? call.channelId : null,
    title: call ? `In call with ${call.recipientName}` : "",
    visible: !hidden,
    isMuted,
    isDeafened,
    cameraOn: cameraOnNow,
    fetchViewer: async (channelId) => (await api.post(`/dms/${channelId}/call/viewer`)).data.data,
    onCommand: (command) => {
      const current = useCallStore.getState().call;
      if (!current) return;
      const voice = useVoiceStore.getState();
      if (command.type === "mute") voice.setMuted(!voice.isMuted);
      else if (command.type === "deafen") voice.setDeafened(!voice.isDeafened);
      else if (command.type === "camera") setCameraChannel((c) => (c === current.channelId ? null : current.channelId));
      else if (command.type === "hangup") void useCallStore.getState().endCall(current.channelId);
    },
    onClosed: () => useCallStore.getState().setCallPanelHidden(true),
  });
  const setCallPanelHidden = useCallStore((s) => s.setCallPanelHidden);
  const panelRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(() => {
    const room = roomRef.current;
    if (!room) return;
    const list: VoiceParticipant[] = [buildParticipant(room.localParticipant, true)];
    room.remoteParticipants.forEach((p: RemoteParticipant) => list.push(buildParticipant(p, false)));
    setParticipants(list);
  }, []);

  // Auto-dismiss notices (errors, "No answer", …)
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(t);
  }, [notice, setNotice]);

  // Keep the server-side call alive; the server reaps calls whose clients vanished.
  const channelId = call?.channelId;
  useEffect(() => {
    if (state !== "in-call" || !channelId) return;
    const t = setInterval(() => void keepalive(channelId), 30_000);
    return () => clearInterval(t);
  }, [state, channelId, keepalive]);

  // Closing the window mid-call: tell the server so the other side isn't left alone.
  useEffect(() => {
    if (state !== "in-call" || !channelId) return;
    function onPageHide() {
      const token = useAuthStore.getState().accessToken;
      if (!token) return;
      void fetch(`${apiBaseURL}/dms/${channelId}/call/end`, {
        method: "POST",
        keepalive: true,
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [state, channelId]);

  // Connect when in-call
  useEffect(() => {
    if (state !== "in-call" || !call?.token || !call?.url) return;

    let cancelled = false;
    let hadRemote = false;
    let aloneTimer: ReturnType<typeof setTimeout> | null = null;
    const callChannelId = call.channelId;

    const room = new Room();
    roomRef.current = room;
    const cleanupSoundboard = attachSoundboard(room);

    // If the other person drops out of the room for good, hang up.
    function checkAlone() {
      if (aloneTimer) clearTimeout(aloneTimer);
      aloneTimer = null;
      if (hadRemote && room.remoteParticipants.size === 0) {
        aloneTimer = setTimeout(() => {
          if (!cancelled && room.remoteParticipants.size === 0) {
            useCallStore.getState().endCall(callChannelId);
          }
        }, 5000);
      }
    }

    room.on(RoomEvent.ConnectionStateChanged, (s: ConnectionState) => setConnState(s));
    room.on(RoomEvent.ParticipantConnected, () => {
      hadRemote = true;
      checkAlone();
      refresh();
    });
    room.on(RoomEvent.ParticipantDisconnected, () => {
      checkAlone();
      refresh();
    });
    room.on(RoomEvent.TrackSubscribed, refresh);
    room.on(RoomEvent.TrackUnsubscribed, refresh);
    room.on(RoomEvent.TrackMuted, refresh);
    room.on(RoomEvent.TrackUnmuted, refresh);
    room.on(RoomEvent.ActiveSpeakersChanged, refresh);
    room.on(RoomEvent.LocalTrackPublished, refresh);
    room.on(RoomEvent.LocalTrackUnpublished, refresh);
    room.on(RoomEvent.Disconnected, () => {
      setConnState(ConnectionState.Disconnected);
      setParticipants([]);
    });

    room.connect(call.url, call.token).then(async () => {
      if (cancelled) { room.disconnect(); return; }
      room.startAudio().catch(() => {}); // succeeds when the accept click is still "fresh"
      if (room.remoteParticipants.size > 0) hadRemote = true;
      try {
        const rawStream = await navigator.mediaDevices.getUserMedia(micConstraints());
        if (cancelled) { rawStream.getTracks().forEach((t) => t.stop()); return; }
        const { stream: processedStream, cleanup } = await processStream(rawStream);
        if (cancelled) { cleanup(); rawStream.getTracks().forEach((t) => t.stop()); return; }
        ncCleanupRef.current = cleanup;
        const processedTrack = processedStream.getAudioTracks()[0];
        const livekitTrack = new LocalAudioTrack(processedTrack, undefined, false);
        const pub = await room.localParticipant.publishTrack(livekitTrack, { source: Track.Source.Microphone });
        // Mute may have been toggled while the track was publishing.
        if (useVoiceStore.getState().isMuted) await pub.mute();
      } catch {
        room.localParticipant.setMicrophoneEnabled(!useVoiceStore.getState().isMuted).catch(() => {
          useCallStore.getState().setNotice("Couldn't access your microphone");
        });
      }
      refresh();
    }).catch(() => {
      if (cancelled) return;
      useCallStore.getState().setNotice("Couldn't connect to the call");
      useCallStore.getState().endCall(callChannelId);
    });

    return () => {
      cancelled = true;
      cleanupSoundboard();
      if (aloneTimer) clearTimeout(aloneTimer);
      ncCleanupRef.current?.();
      ncCleanupRef.current = null;
      room.disconnect();
      roomRef.current = null;
      setParticipants([]);
    };
  }, [state, call?.token, call?.url, refresh, processStream]); // eslint-disable-line react-hooks/exhaustive-deps

  // WebKit suspends the audio context until a user gesture; resume LiveKit's playback on the next one.
  useEffect(() => {
    if (state !== "in-call") return;
    function resume() {
      roomRef.current?.startAudio().catch(() => {});
    }
    document.addEventListener("pointerdown", resume);
    document.addEventListener("keydown", resume);
    return () => {
      document.removeEventListener("pointerdown", resume);
      document.removeEventListener("keydown", resume);
    };
  }, [state]);

  // Sync mute state. Only toggles an already-published mic: before that, the connect
  // handler publishes it and applies the mute state; calling setMicrophoneEnabled here
  // would publish a second microphone track and break negotiation.
  useEffect(() => {
    const pub = roomRef.current?.localParticipant.getTrackPublication(Track.Source.Microphone);
    if (!pub?.track || state !== "in-call") return;
    (isMuted ? pub.mute() : pub.unmute()).catch(() => {});
  }, [isMuted, state]);

  // Camera on/off (and switching cameras from settings while it's on)
  const cameraOn = state === "in-call" && !!channelId && cameraChannel === channelId;
  useEffect(() => {
    const room = roomRef.current;
    if (!room || connState !== ConnectionState.Connected) return;
    if (!cameraOn && !room.localParticipant.isCameraEnabled) return;
    room.localParticipant
      .setCameraEnabled(cameraOn, { deviceId: cameraDeviceId(), resolution: { width: 1280, height: 720, frameRate: 30 } })
      .then(refresh)
      .catch(() => {
        setCameraChannel(null);
        useCallStore.getState().setNotice("Couldn't turn on your camera. Check Settings → Permissions.");
      });
  }, [cameraOn, videoDeviceId, connState, refresh]);

  // Keep a dragged panel on screen when the window shrinks
  useEffect(() => {
    if (!position) return;
    function onResize() {
      setPosition((p) => (p ? clampPosition(p, panelRef.current) : p));
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [position]);

  function startDrag(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || (e.target as Element).closest("button")) return;
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const offsetY = e.clientY - rect.top;
    const header = e.currentTarget;
    header.setPointerCapture(e.pointerId);
    let latest: PanelPosition = { x: rect.left, y: rect.top };
    function onMove(ev: PointerEvent) {
      latest = clampPosition({ x: ev.clientX - offsetX, y: ev.clientY - offsetY }, panel);
      setPosition(latest);
    }
    function onUp() {
      header.removeEventListener("pointermove", onMove);
      header.removeEventListener("pointerup", onUp);
      header.removeEventListener("pointercancel", onUp);
      try { localStorage.setItem(POSITION_KEY, JSON.stringify(latest)); } catch { /* storage unavailable */ }
    }
    header.addEventListener("pointermove", onMove);
    header.addEventListener("pointerup", onUp);
    header.addEventListener("pointercancel", onUp);
  }

  /** Drag the corner handle to resize; the height follows the tiles' aspect ratio. */
  function startResize(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    // Anchor the top-left corner while resizing (the default is anchored bottom-right).
    const anchor = { x: rect.left, y: rect.top };
    setPosition(anchor);
    const startX = e.clientX;
    const startWidth = rect.width;
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    let latest = startWidth;
    function onMove(ev: PointerEvent) {
      const max = window.innerWidth - anchor.x - MARGIN;
      latest = Math.round(Math.max(MIN_WIDTH, Math.min(max, startWidth + ev.clientX - startX)));
      setUserWidth(latest);
    }
    function onUp() {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      try {
        localStorage.setItem(WIDTH_KEY, String(latest));
        localStorage.setItem(POSITION_KEY, JSON.stringify(anchor));
      } catch { /* storage unavailable */ }
      // A taller panel may now overflow the bottom edge.
      setPosition((p) => (p ? clampPosition(p, panelRef.current) : p));
    }
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  }

  function resetPosition() {
    setPosition(null);
    try { localStorage.removeItem(POSITION_KEY); } catch { /* storage unavailable */ }
  }

  // NC toggle mid-call — rewire the mic pipeline when NC enabled state changes
  useEffect(() => {
    const room = roomRef.current;
    if (!room || room.state !== ConnectionState.Connected) return;

    let cancelled = false;
    let rawStream: MediaStream | null = null;

    async function rewireMic() {
      ncCleanupRef.current?.();
      ncCleanupRef.current = null;

      const micPub = room!.localParticipant.getTrackPublication(Track.Source.Microphone);

      try {
        rawStream = await navigator.mediaDevices.getUserMedia(micConstraints());
        if (cancelled) { rawStream.getTracks().forEach(t => t.stop()); return; }
        const { stream: processedStream, cleanup } = await processStream(rawStream);
        if (cancelled) { cleanup(); rawStream.getTracks().forEach(t => t.stop()); return; }
        ncCleanupRef.current = cleanup;
        const processedTrack = processedStream.getAudioTracks()[0];
        if (micPub?.track) {
          await (micPub.track as LocalAudioTrack).replaceTrack(processedTrack);
        } else {
          const livekitTrack = new LocalAudioTrack(processedTrack, undefined, false);
          await room!.localParticipant.publishTrack(livekitTrack, { source: Track.Source.Microphone });
        }
      } catch {
        rawStream?.getTracks().forEach(t => t.stop());
      }
    }

    rewireMic();
    return () => { cancelled = true; };
  }, [isNoiseCancellationEnabled, inputDeviceId]); // eslint-disable-line react-hooks/exhaustive-deps

  const noticeToast = notice ? (
    <div
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[10001] px-4 py-2 rounded-md text-sm font-medium shadow-lg"
      style={{ backgroundColor: "var(--color-dc-bg-floating)", color: "var(--color-dc-header-primary)" }}
      role="status"
    >
      {notice}
    </div>
  ) : null;

  if (state !== "in-call" || !call) return noticeToast;

  const tiles = buildTiles(participants);
  const hasVideo = participants.some((p) => p.isCameraEnabled && p.cameraTrack);
  const column = layout === "column";
  const panelWidth = userWidth ?? (column ? (hasVideo ? 320 : 280) : hasVideo ? 520 : 340);

  function toggleLayout() {
    const next: TileLayout = column ? "row" : "column";
    setLayout(next);
    // Row and column want different widths; drop a custom width so the new layout fits.
    setUserWidth(null);
    try {
      localStorage.setItem(LAYOUT_KEY, next);
      localStorage.removeItem(WIDTH_KEY);
    } catch { /* storage unavailable */ }
    // A column is taller: keep it on screen.
    requestAnimationFrame(() => setPosition((p) => (p ? clampPosition(p, panelRef.current) : p)));
  }
  const isConnecting = connState === ConnectionState.Connecting || connState === ConnectionState.Reconnecting;

  function handleDoubleClick(tile: VoiceTile) {
    setFullscreenTile(tile);
  }

  return (
    <>
      {noticeToast}
      <GlobalVoiceAudio participants={participants} />
      {fullscreenTile && (
        <FullscreenOverlay tile={fullscreenTile} onClose={() => setFullscreenTile(null)} />
      )}

      {!hidden && !desktop && (
      <div
        ref={panelRef}
        className="fixed z-[9000] flex flex-col rounded-lg overflow-hidden shadow-2xl border"
        style={{
          width: panelWidth,
          maxWidth: `calc(100vw - ${MARGIN * 2}px)`,
          backgroundColor: "var(--color-dc-bg-secondary)",
          borderColor: "var(--color-dc-bg-floating)",
          ...(position ? { left: position.x, top: position.y } : { right: 16, bottom: 16 }),
        }}
      >
        {/* Mini header — drag to move, double-click to snap back to the corner */}
        <div
          className="flex items-center justify-between px-3 py-1.5 flex-shrink-0 cursor-grab active:cursor-grabbing select-none touch-none"
          style={{ borderBottom: collapsed ? undefined : "1px solid var(--color-dc-bg-floating)" }}
          onPointerDown={startDrag}
          onDoubleClick={(e) => { if (!(e.target as Element).closest("button")) resetPosition(); }}
          title="Drag to move · double-click to reset"
        >
          <div className="flex min-w-0 items-center gap-1.5">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: "#23a55a" }} />
            <span className="text-xs font-medium truncate" style={{ color: "var(--color-dc-header-primary)" }}>
              {isConnecting ? "Connecting…" : `In call with ${call.recipientName}`}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <Soundboard compact />
            {/* Mute */}
            <button
              onClick={() => setMuted(!isMuted)}
              className="p-1 rounded transition-colors"
              title={isMuted ? "Unmute" : "Mute"}
              style={{ color: isMuted ? "var(--color-dc-red, #ed4245)" : "var(--color-dc-interactive-normal)" }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--color-dc-bg-modifier-hover)")}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
            >
              {isMuted ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z"/>
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z"/>
                </svg>
              )}
            </button>

            <button
              onClick={() => setDeafened(!isDeafened)}
              className="p-1 rounded transition-colors"
              title={isDeafened ? "Undeafen" : "Deafen"}
              aria-label={isDeafened ? "Undeafen" : "Deafen"}
              aria-pressed={isDeafened}
              style={{ color: isDeafened ? "var(--color-dc-red, #ed4245)" : "var(--color-dc-interactive-normal)" }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M3 14v-2a9 9 0 0 1 18 0v2M3 13h4v8H3zM17 13h4v8h-4z" />
                {isDeafened && <path d="m3 3 18 18" />}
              </svg>
            </button>

            {/* Noise Cancellation */}
            <button
              onClick={toggleNC}
              className="p-1 rounded transition-colors"
              title={isNCEnabled ? "Noise cancellation on" : "Noise cancellation off"}
              style={{
                color: isNCEnabled
                  ? "var(--color-dc-interactive-active, #00b0f4)"
                  : "var(--color-dc-interactive-normal)",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.backgroundColor =
                  "var(--color-dc-bg-modifier-hover)")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.backgroundColor = "transparent")
              }
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 12h2"/>
                <path d="M4 12 Q5 6 6 12 Q7 18 8 12"/>
                <path d="M8 12 Q9 4 10 12 Q11 20 12 12"/>
                <path d="M12 12 Q13 4 14 12 Q15 20 16 12"/>
                <path d="M16 12 Q17 6 18 12 Q19 18 20 12"/>
                <path d="M20 12h2"/>
              </svg>
            </button>

            {/* Row / column layout */}
            <button
              onClick={toggleLayout}
              className="p-1 rounded transition-colors hover:bg-[var(--color-dc-bg-modifier-hover)]"
              title={column ? "Show participants side by side" : "Stack participants vertically"}
              aria-label={column ? "Show participants side by side" : "Stack participants vertically"}
              style={{ color: "var(--color-dc-interactive-normal)" }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                {column ? (
                  <><rect x="3" y="5" width="8" height="14" rx="1.5" /><rect x="13" y="5" width="8" height="14" rx="1.5" /></>
                ) : (
                  <><rect x="5" y="3" width="14" height="8" rx="1.5" /><rect x="5" y="13" width="14" height="8" rx="1.5" /></>
                )}
              </svg>
            </button>

            {/* Camera */}
            <button
              onClick={() => setCameraChannel(cameraOn ? null : call.channelId)}
              disabled={isConnecting}
              className="p-1 rounded transition-colors hover:bg-[var(--color-dc-bg-modifier-hover)] disabled:opacity-40"
              title={cameraOn ? "Turn off camera" : "Turn on camera"}
              aria-label={cameraOn ? "Turn off camera" : "Turn on camera"}
              aria-pressed={cameraOn}
              style={{ color: cameraOn ? "var(--color-dc-online, #23a55a)" : "var(--color-dc-interactive-normal)" }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z" />
                {!cameraOn && <path d="M2.3 3.7 3.7 2.3l18 18-1.4 1.4z" />}
              </svg>
            </button>

            {/* Collapse / expand */}
            <button
              onClick={() => setCollapsed((c) => !c)}
              className="p-1 rounded transition-colors hover:bg-[var(--color-dc-bg-modifier-hover)]"
              title={collapsed ? "Show call" : "Minimize call"}
              aria-label={collapsed ? "Show call" : "Minimize call"}
              aria-expanded={!collapsed}
              style={{ color: "var(--color-dc-interactive-normal)" }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                {collapsed ? <path d="m6 15 6-6 6 6" /> : <path d="m6 9 6 6 6-6" />}
              </svg>
            </button>

            {/* End call */}
            <button
              onClick={() => endCall(call.channelId)}
              className="p-1 rounded transition-colors"
              title="End call"
              style={{ color: "var(--color-dc-red, #ed4245)" }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--color-dc-bg-modifier-hover)")}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56-.35-.12-.74-.03-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z"/>
              </svg>
            </button>

            <span className="w-px h-4 mx-0.5" style={{ backgroundColor: "var(--color-dc-bg-modifier-hover)" }} aria-hidden="true" />

            {/* Hide window — the call keeps running */}
            <button
              onClick={() => setCallPanelHidden(true)}
              className="p-1 rounded transition-colors hover:bg-[var(--color-dc-bg-modifier-hover)]"
              title="Hide call window (call continues — reopen from the sidebar)"
              aria-label="Hide call window"
              style={{ color: "var(--color-dc-interactive-normal)" }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59 7.11 5.7A1 1 0 0 0 5.7 7.11L10.59 12 5.7 16.89a1 1 0 1 0 1.41 1.41L12 13.41l4.89 4.89a1 1 0 0 0 1.41-1.41L13.41 12l4.89-4.89a1 1 0 0 0 0-1.4z" />
              </svg>
            </button>
          </div>
        </div>

        {/* Participant tiles — side by side or stacked; 16:9 when anyone has video */}
        {!collapsed && (
        <div className={`flex ${column ? "flex-col items-stretch" : "items-center justify-center"} gap-2 px-3 py-2 overflow-hidden`}>
          {tiles.map((tile) => (
            <div
              key={tile.id}
              className="min-w-0"
              style={column
                ? { width: "100%", aspectRatio: hasVideo ? "16 / 9" : "16 / 10" }
                : hasVideo
                  ? { flex: "1 1 0", maxWidth: tiles.length === 1 ? 360 : undefined, aspectRatio: "16 / 9" }
                  : { flex: "1 1 0", maxWidth: tiles.length === 1 ? "60%" : undefined, aspectRatio: "4 / 3" }}
              onDoubleClick={() => handleDoubleClick(tile)}
            >
              <ParticipantTile
                participant={tile.participant}
                variant="sidebar"
              />
            </div>
          ))}
        </div>
        )}

        {/* Resize handle */}
        {!collapsed && (
          <div
            onPointerDown={startResize}
            onDoubleClick={() => { setUserWidth(null); try { localStorage.removeItem(WIDTH_KEY); } catch { /* storage unavailable */ } }}
            className="absolute right-0 bottom-0 w-4 h-4 cursor-nwse-resize touch-none flex items-end justify-end p-0.5 opacity-60 hover:opacity-100"
            title="Drag to resize · double-click to reset size"
            aria-hidden="true"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" style={{ color: "var(--color-dc-interactive-normal)" }}>
              <path d="M9 3 3 9M9 6 6 9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </div>
        )}
      </div>
      )}
    </>
  );
}
