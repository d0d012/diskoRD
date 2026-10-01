import { useCallback, useEffect, useRef, useState } from "react";
import {
  Room,
  RoomEvent,
  Track,
  ConnectionState,
  Participant,
  RemoteParticipant,
  LocalAudioTrack,
} from "livekit-client";
import { useCallStore } from "../../stores/callStore";
import { useAuthStore } from "../../stores/authStore";
import { apiBaseURL } from "../../lib/api";
import { GlobalVoiceAudio } from "../voice/GlobalVoiceAudio";
import { useVoiceStore } from "../../stores/voiceStore";
import { useNoiseCancellation } from "../../hooks/useNoiseCancellation";
import { ParticipantTile } from "../voice/ParticipantTile";
import { FullscreenOverlay } from "../voice/FullscreenOverlay";
import { buildTiles } from "../voice/voiceLayout";
import type { VoiceParticipant } from "../../hooks/useVoice";
import type { VoiceTile } from "../voice/voiceLayout";

function buildParticipant(p: Participant, isLocal: boolean): VoiceParticipant {
  let cameraTrack: Track | null = null;
  let screenTrack: Track | null = null;
  let audioTrack: Track | null = null;
  let screenAudioTrack: Track | null = null;
  for (const pub of p.trackPublications.values()) {
    if (!pub.track) continue;
    if (pub.source === Track.Source.Camera) cameraTrack = pub.track;
    if (pub.source === Track.Source.ScreenShare) screenTrack = pub.track;
    if (pub.source === Track.Source.Microphone) audioTrack = pub.track;
    if (pub.source === Track.Source.ScreenShareAudio) screenAudioTrack = pub.track;
  }
  return {
    identity: p.identity,
    name: p.name ?? p.identity,
    isSpeaking: p.isSpeaking,
    isMicEnabled: p.isMicrophoneEnabled,
    isCameraEnabled: p.isCameraEnabled,
    isScreenSharing: screenTrack !== null,
    isLocal,
    cameraTrack,
    screenTrack,
    audioTrack,
    screenAudioTrack,
  };
}

export function DMCallPanel() {
  const { state, call, endCall, keepalive, notice, setNotice } = useCallStore();
  const { isMuted, setMuted, isNoiseCancellationEnabled } = useVoiceStore();
  const { processStream, isEnabled: isNCEnabled, toggle: toggleNC } = useNoiseCancellation();

  const roomRef = useRef<Room | null>(null);
  const ncCleanupRef = useRef<(() => void) | null>(null);
  const [participants, setParticipants] = useState<VoiceParticipant[]>([]);
  const [connState, setConnState] = useState<ConnectionState>(ConnectionState.Disconnected);
  const [fullscreenTile, setFullscreenTile] = useState<VoiceTile | null>(null);

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
    room.on(RoomEvent.Disconnected, () => {
      setConnState(ConnectionState.Disconnected);
      setParticipants([]);
    });

    room.connect(call.url, call.token).then(async () => {
      if (cancelled) { room.disconnect(); return; }
      if (room.remoteParticipants.size > 0) hadRemote = true;
      try {
        const rawStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) { rawStream.getTracks().forEach((t) => t.stop()); return; }
        const { stream: processedStream, cleanup } = await processStream(rawStream);
        if (cancelled) { cleanup(); rawStream.getTracks().forEach((t) => t.stop()); return; }
        ncCleanupRef.current = cleanup;
        const processedTrack = processedStream.getAudioTracks()[0];
        const livekitTrack = new LocalAudioTrack(processedTrack, undefined, false);
        await room.localParticipant.publishTrack(livekitTrack, { source: Track.Source.Microphone });
      } catch {
        room.localParticipant.setMicrophoneEnabled(true).catch(() => {
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
      if (aloneTimer) clearTimeout(aloneTimer);
      ncCleanupRef.current?.();
      ncCleanupRef.current = null;
      room.disconnect();
      roomRef.current = null;
      setParticipants([]);
    };
  }, [state, call?.token, call?.url, refresh, processStream]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync mute state
  useEffect(() => {
    const room = roomRef.current;
    if (!room || state !== "in-call") return;
    room.localParticipant.setMicrophoneEnabled(!isMuted).catch(() => {});
  }, [isMuted, state]);

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
        rawStream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
  }, [isNoiseCancellationEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

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

      <div
        className="fixed bottom-4 right-4 z-[9000] flex flex-col rounded-lg overflow-hidden shadow-2xl border"
        style={{
          width: 340,
          backgroundColor: "var(--color-dc-bg-secondary)",
          borderColor: "var(--color-dc-bg-floating)",
          minHeight: 160,
          maxHeight: 220,
        }}
      >
        {/* Mini header */}
        <div
          className="flex items-center justify-between px-3 py-1.5 flex-shrink-0"
          style={{ borderBottom: "1px solid var(--color-dc-bg-floating)" }}
        >
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: "#23a55a" }} />
            <span className="text-xs font-medium" style={{ color: "var(--color-dc-header-primary)" }}>
              {isConnecting ? "Connecting…" : `In call with ${call.recipientName}`}
            </span>
          </div>

          <div className="flex items-center gap-1">
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
          </div>
        </div>

        {/* Participant tiles */}
        <div className="flex-1 flex items-center justify-center gap-2 px-3 py-2 overflow-hidden">
          {tiles.map((tile) => (
            <div
              key={tile.id}
              className="flex-shrink-0"
              style={{ width: tiles.length === 1 ? 140 : 120, height: tiles.length === 1 ? 130 : 110 }}
              onDoubleClick={() => handleDoubleClick(tile)}
            >
              <ParticipantTile
                participant={tile.participant}
                variant="sidebar"
              />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
