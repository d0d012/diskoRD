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

  const { activeVoiceChannelId } = useVoiceStore();
  const { channels, activeGuildId } = useGuildStore();

  const channel = activeGuildId
    ? (channels[activeGuildId] ?? []).find((c) => c.id === activeVoiceChannelId)
    : null;

  const isConnecting = connectionState === ConnectionState.Connecting;
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
