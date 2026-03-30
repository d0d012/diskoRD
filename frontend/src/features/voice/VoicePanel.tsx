import { useEffect, useRef } from "react";
import { Track, ConnectionState } from "livekit-client";
import { useVoiceStore } from "../../stores/voiceStore";
import { useGuildStore } from "../../stores/guildStore";
import type { VoiceParticipant } from "../../hooks/useVoice";

// ── Speaking ring animation (CSS injected once) ─────────────────────────────

const SPEAKING_STYLE = `
@keyframes voice-pulse {
  0%, 100% { box-shadow: 0 0 0 0px rgba(35, 165, 90, 0.8); }
  50%       { box-shadow: 0 0 0 3px rgba(35, 165, 90, 0); }
}
.voice-speaking {
  animation: voice-pulse 1s ease-in-out infinite;
  border: 2px solid #23a55a !important;
}
`;

function injectStyles() {
  if (document.getElementById("voice-panel-styles")) return;
  const el = document.createElement("style");
  el.id = "voice-panel-styles";
  el.textContent = SPEAKING_STYLE;
  document.head.appendChild(el);
}

// ── Video tile ───────────────────────────────────────────────────────────────

function VideoTile({ track, className }: { track: Track; className?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !track) return;
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

// ── Avatar tile ──────────────────────────────────────────────────────────────

function ParticipantTile({ participant }: { participant: VoiceParticipant }) {
  const color = `hsl(${(participant.name.charCodeAt(0) * 37) % 360}, 55%, 40%)`;
  const hasVideo = participant.isCameraEnabled && participant.cameraTrack;
  const hasScreen = participant.isScreenSharing && participant.screenTrack;

  return (
    <div
      className="relative flex flex-col items-center gap-2"
      style={{ minWidth: 0 }}
    >
      {/* Main tile */}
      <div
        className={`relative w-24 h-24 rounded-2xl overflow-hidden flex items-center justify-center flex-shrink-0 border-2 transition-all duration-200 ${
          participant.isSpeaking ? "voice-speaking" : "border-transparent"
        }`}
        style={{ backgroundColor: hasVideo ? "#000" : color }}
      >
        {hasVideo && participant.cameraTrack ? (
          <VideoTile track={participant.cameraTrack} />
        ) : (
          <span className="text-white text-3xl font-bold select-none">
            {participant.name[0]?.toUpperCase() ?? "?"}
          </span>
        )}

        {/* Screen share badge */}
        {hasScreen && (
          <div
            className="absolute bottom-1 right-1 w-5 h-5 rounded-full flex items-center justify-center"
            style={{ backgroundColor: "var(--color-dc-brand)" }}
            title="Screen sharing"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="white">
              <path d="M20 3H4c-1.1 0-2 .9-2 2v11c0 1.1.9 2 2 2h7v2H9v2h6v-2h-2v-2h7c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 13H4V5h16v11z"/>
            </svg>
          </div>
        )}

        {/* Muted badge */}
        {!participant.isMicEnabled && (
          <div
            className="absolute bottom-1 left-1 w-5 h-5 rounded-full flex items-center justify-center"
            style={{ backgroundColor: "var(--color-dc-red, #ed4245)" }}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="white">
              <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z"/>
            </svg>
          </div>
        )}
      </div>

      {/* Screen share tile (below avatar if active) */}
      {hasScreen && participant.screenTrack && (
        <div
          className="w-40 h-24 rounded-xl overflow-hidden border-2"
          style={{ borderColor: "var(--color-dc-brand)" }}
        >
          <VideoTile track={participant.screenTrack} />
        </div>
      )}

      {/* Name */}
      <div className="flex items-center gap-1">
        {participant.isLocal && (
          <span className="text-xs px-1 py-0.5 rounded" style={{ backgroundColor: "var(--color-dc-brand)", color: "white" }}>
            You
          </span>
        )}
        <span
          className="text-sm font-medium truncate max-w-[7rem]"
          style={{ color: "var(--color-dc-header-primary)" }}
        >
          {participant.name}
        </span>
      </div>
    </div>
  );
}

// ── Control button ───────────────────────────────────────────────────────────

function ControlBtn({
  active,
  danger,
  onClick,
  title,
  children,
}: {
  active?: boolean;
  danger?: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="w-12 h-12 rounded-full flex items-center justify-center transition-all duration-150 flex-shrink-0"
      style={{
        backgroundColor: danger
          ? "var(--color-dc-red, #ed4245)"
          : active
          ? "var(--color-dc-bg-modifier-selected)"
          : "var(--color-dc-bg-tertiary)",
        color: active ? "var(--color-dc-header-primary)" : "var(--color-dc-interactive-normal)",
        transform: "scale(1)",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.transform = "scale(1.08)";
        if (!danger && !active)
          (e.currentTarget as HTMLButtonElement).style.backgroundColor = "var(--color-dc-bg-modifier-hover)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)";
        if (!danger && !active)
          (e.currentTarget as HTMLButtonElement).style.backgroundColor = "var(--color-dc-bg-tertiary)";
      }}
    >
      {children}
    </button>
  );
}

// ── Main panel ───────────────────────────────────────────────────────────────

interface VoicePanelProps {
  participants: VoiceParticipant[];
  connectionState: ConnectionState;
}

export function VoicePanel({ participants, connectionState }: VoicePanelProps) {
  const {
    activeVoiceChannelId,
    isMuted,
    isDeafened,
    isCameraOn,
    isScreenSharing,
    isConnecting,
    setMuted,
    setDeafened,
    setCameraOn,
    setScreenSharing,
    leaveVoice,
  } = useVoiceStore();

  const { channels, activeGuildId } = useGuildStore();

  useEffect(() => { injectStyles(); }, []);

  const channel = activeGuildId
    ? (channels[activeGuildId] ?? []).find((c) => c.id === activeVoiceChannelId)
    : null;

  const isConnected = connectionState === ConnectionState.Connected;
  const isReconnecting = connectionState === ConnectionState.Reconnecting;

  return (
    <div
      className="flex-1 flex flex-col"
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
          <span
            className="text-xs ml-2 flex items-center gap-1"
            style={{ color: "var(--color-dc-online, #23a55a)" }}
          >
            <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "var(--color-dc-online, #23a55a)" }} />
            Connected
          </span>
        )}
      </div>

      {/* Participant grid */}
      <div className="flex-1 overflow-y-auto p-8 flex flex-wrap gap-8 items-center justify-center content-start">
        {participants.length === 0 ? (
          <div className="flex flex-col items-center gap-4 opacity-40">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="currentColor" style={{ color: "var(--color-dc-text-muted)" }}>
              <path d="M12 3c-4.97 0-9 4.03-9 9v7c0 1.1.9 2 2 2h4v-8H5v-1c0-3.87 3.13-7 7-7s7 3.13 7 7v1h-4v8h4c1.1 0 2-.9 2-2v-7c0-4.97-4.03-9-9-9z"/>
            </svg>
            <p className="text-sm" style={{ color: "var(--color-dc-text-muted)" }}>
              No one else here yet
            </p>
          </div>
        ) : (
          participants.map((p) => (
            <ParticipantTile key={p.identity} participant={p} />
          ))
        )}
      </div>

      {/* Controls bar */}
      <div
        className="flex-shrink-0 px-6 py-4 flex items-center justify-center gap-3 border-t"
        style={{ borderColor: "var(--color-dc-bg-floating)", backgroundColor: "var(--color-dc-bg-secondary)" }}
      >
        {/* Mute */}
        <ControlBtn
          active={!isMuted}
          onClick={() => setMuted(!isMuted)}
          title={isMuted ? "Unmute" : "Mute"}
        >
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
        <ControlBtn
          active={!isDeafened}
          onClick={() => setDeafened(!isDeafened)}
          title={isDeafened ? "Undeafen" : "Deafen"}
        >
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
        <ControlBtn
          active={isCameraOn}
          onClick={() => setCameraOn(!isCameraOn)}
          title={isCameraOn ? "Turn off camera" : "Turn on camera"}
        >
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

        {/* Screen Share */}
        <ControlBtn
          active={isScreenSharing}
          onClick={() => setScreenSharing(!isScreenSharing)}
          title={isScreenSharing ? "Stop sharing" : "Share screen"}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20 3H4c-1.1 0-2 .9-2 2v11c0 1.1.9 2 2 2h7v2H9v2h6v-2h-2v-2h7c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 13H4V5h16v11z"/>
            {isScreenSharing && <circle cx="12" cy="11" r="3" fill="currentColor"/>}
          </svg>
        </ControlBtn>

        {/* Disconnect */}
        <ControlBtn danger onClick={leaveVoice} title="Disconnect">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08A.99.99 0 0 1 0 12.37c0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.66c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48a1 1 0 0 1-.71.29c-.27 0-.52-.11-.7-.28a11.27 11.27 0 0 0-2.67-1.85.985.985 0 0 1-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/>
          </svg>
        </ControlBtn>
      </div>
    </div>
  );
}
