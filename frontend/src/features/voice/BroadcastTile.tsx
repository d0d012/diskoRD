import { useState } from "react";
import type { VoiceParticipant } from "../../hooks/useVoice";
import { VideoTile } from "./VideoTile";
import { VolumeMenu } from "./VolumeMenu";

interface BroadcastTileProps {
  participant: VoiceParticipant;
  isPinned?: boolean;
  onClick?: () => void;
  onDoubleClick?: () => void;
  variant?: "grid" | "sidebar" | "main";
}

export function BroadcastTile({
  participant,
  isPinned = false,
  onClick,
  onDoubleClick,
  variant = "grid",
}: BroadcastTileProps) {
  const [volumeMenu, setVolumeMenu] = useState<{ x: number; y: number } | null>(null);
  const { name, screenTrack, screenAudioTrack } = participant;

  const isSidebar = variant === "sidebar";
  const nameSize = isSidebar ? "text-[9px]" : "text-xs";
  const color = `hsl(${(name.charCodeAt(0) * 37) % 360}, 55%, 40%)`;

  return (
    <>
      <div
        data-testid={`broadcast-tile-${participant.identity}`}
        className={`relative flex flex-col items-center justify-center overflow-hidden rounded-xl border-2 transition-all duration-200 cursor-pointer select-none ${
          isPinned ? "ring-2 ring-[#5865f2]" : "border-transparent"
        }`}
        style={{
          backgroundColor: "#0a0a0b",
          width: "100%",
          height: "100%",
          borderColor: isPinned ? undefined : "rgba(88,101,242,0.3)",
        }}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setVolumeMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        {/* Screen video */}
        {screenTrack ? (
          <VideoTile track={screenTrack} />
        ) : (
          <div className="flex flex-col items-center gap-2 opacity-30">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="white">
              <path d="M20 3H4c-1.1 0-2 .9-2 2v11c0 1.1.9 2 2 2h7v2H9v2h6v-2h-2v-2h7c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 13H4V5h16v11z"/>
            </svg>
          </div>
        )}

        {/* LIVE badge */}
        {!isSidebar && (
          <div
            className="absolute top-2 left-2 px-1.5 py-0.5 rounded text-[9px] font-bold tracking-widest"
            style={{ backgroundColor: "rgba(237,66,69,0.85)", color: "#fff" }}
          >
            LIVE
          </div>
        )}

        {/* Screen audio indicator */}
        {screenAudioTrack && !isSidebar && (
          <div
            className="absolute top-2 right-2 w-5 h-5 rounded-full flex items-center justify-center"
            style={{ backgroundColor: "rgba(0,0,0,0.6)" }}
            title="Sharing audio"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="white">
              <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
            </svg>
          </div>
        )}

        {/* Bottom label: avatar + "Name's Screen" */}
        <div className="absolute bottom-1.5 left-2 right-2 flex items-center gap-1.5">
          <div
            className="flex items-center gap-1 px-1.5 py-0.5 rounded overflow-hidden max-w-full"
            style={{ backgroundColor: "rgba(0,0,0,0.65)", color: "#dbdee1" }}
          >
            {/* Mini avatar */}
            <div
              className="w-3.5 h-3.5 rounded-full flex-shrink-0 flex items-center justify-center text-white font-bold"
              style={{ backgroundColor: color, fontSize: "7px" }}
            >
              {name[0]?.toUpperCase()}
            </div>
            <span className={`${nameSize} font-medium truncate`}>
              {name}'s Screen
            </span>
            {/* Monitor icon */}
            <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" style={{ opacity: 0.6, flexShrink: 0 }}>
              <path d="M20 3H4c-1.1 0-2 .9-2 2v11c0 1.1.9 2 2 2h7v2H9v2h6v-2h-2v-2h7c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 13H4V5h16v11z"/>
            </svg>
          </div>
          {isPinned && (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="#5865f2" style={{ flexShrink: 0 }}>
              <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5v6h2v-6h5v-2l-2-2z"/>
            </svg>
          )}
        </div>
      </div>

      {volumeMenu && (
        <VolumeMenu
          userId={`screen-${participant.identity}`}
          name={`${name}'s Screen`}
          x={volumeMenu.x}
          y={volumeMenu.y}
          onClose={() => setVolumeMenu(null)}
        />
      )}
    </>
  );
}
