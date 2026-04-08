import { useEffect, useState } from "react";
import { ConnectionState } from "livekit-client";
import { useVoiceStore } from "../../stores/voiceStore";
import { useGuildStore } from "../../stores/guildStore";
import type { VoiceParticipant } from "../../hooks/useVoice";
import { buildTiles, getLayoutMode } from "./voiceLayout";
import type { VoiceTile } from "./voiceLayout";
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
  const [manualLayout, setManualLayout] = useState<"grid" | "stage" | null>(null);

  const { activeVoiceChannelId } = useVoiceStore();
  const { channels, activeGuildId } = useGuildStore();

  const channel = activeGuildId
    ? (channels[activeGuildId] ?? []).find((c) => c.id === activeVoiceChannelId)
    : null;

  const isConnecting = connectionState === ConnectionState.Connecting;
  const autoLayout = getLayoutMode(participants);
  const layoutMode = manualLayout ?? autoLayout;
  const tiles = buildTiles(participants);

  // Clear pin when layout is grid or pinned tile leaves
  useEffect(() => {
    if (layoutMode === "grid") {
      setPinnedId(null);
    } else if (pinnedId && !tiles.find((t) => t.id === pinnedId)) {
      setPinnedId(null);
    }
  }, [participants, layoutMode, pinnedId, tiles]);

  // Clear fullscreen when that tile leaves
  useEffect(() => {
    if (fullscreenId && !tiles.find((t) => t.id === fullscreenId)) {
      setFullscreenId(null);
    }
  }, [participants, fullscreenId]);

  const fullscreenTile: VoiceTile | null = fullscreenId
    ? (tiles.find((t) => t.id === fullscreenId) ?? null)
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

        {/* Layout toggle — right side of header */}
        <div className="ml-auto flex items-center gap-1">
          {/* Grid view */}
          <button
            onClick={() => setManualLayout(layoutMode === "grid" ? null : "grid")}
            title="Grid view"
            className="p-1.5 rounded transition-colors"
            style={{
              backgroundColor: layoutMode === "grid" ? "var(--color-dc-bg-modifier-selected)" : "transparent",
              color: layoutMode === "grid" ? "var(--color-dc-interactive-active)" : "var(--color-dc-interactive-normal)",
            }}
            onMouseEnter={(e) => { if (layoutMode !== "grid") e.currentTarget.style.backgroundColor = "var(--color-dc-bg-modifier-hover)"; }}
            onMouseLeave={(e) => { if (layoutMode !== "grid") e.currentTarget.style.backgroundColor = "transparent"; }}
          >
            {/* 2x2 grid icon */}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M3 3h8v8H3zm10 0h8v8h-8zM3 13h8v8H3zm10 0h8v8h-8z"/>
            </svg>
          </button>

          {/* Focus/Stage view */}
          <button
            onClick={() => setManualLayout(layoutMode === "stage" ? null : "stage")}
            title="Focus view"
            className="p-1.5 rounded transition-colors"
            style={{
              backgroundColor: layoutMode === "stage" ? "var(--color-dc-bg-modifier-selected)" : "transparent",
              color: layoutMode === "stage" ? "var(--color-dc-interactive-active)" : "var(--color-dc-interactive-normal)",
            }}
            onMouseEnter={(e) => { if (layoutMode !== "stage") e.currentTarget.style.backgroundColor = "var(--color-dc-bg-modifier-hover)"; }}
            onMouseLeave={(e) => { if (layoutMode !== "stage") e.currentTarget.style.backgroundColor = "transparent"; }}
          >
            {/* Large + sidebar icon */}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M3 3h13v13H3zm14 0h4v4h-4zm0 5h4v4h-4zm0 5h4v4h-4zM3 17h13v4H3z" opacity="0"/>
              <path d="M3 3h13v14H3V3zm15 0h3v4h-3V3zm0 5h3v4h-3V8zm0 5h3v4h-3v-4z"/>
            </svg>
          </button>
        </div>
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
      {fullscreenTile && (
        <FullscreenOverlay
          tile={fullscreenTile}
          onClose={() => setFullscreenId(null)}
        />
      )}
    </div>
  );
}
