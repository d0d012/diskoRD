import { useEffect, useState } from "react";
import type { VoiceParticipant } from "../../hooks/useVoice";
import { VideoTile } from "./VideoTile";
import { VolumeMenu } from "./VolumeMenu";

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
  /** Right-click per-user volume; off where it can't apply (the desktop call window). */
  volumeMenu?: boolean;
}

export function ParticipantTile({
  participant,
  variant = "grid",
  isPinned = false,
  onClick,
  onDoubleClick,
  volumeMenu: volumeMenuEnabled = true,
}: ParticipantTileProps) {
  const [showExpand, setShowExpand] = useState(false);
  const [volumeMenu, setVolumeMenu] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => { injectSpeakingStyles(); }, []);

  const { name, isSpeaking, isMicEnabled, cameraTrack, isLocal, isCameraEnabled } = participant;
  const hasVideo = isCameraEnabled && cameraTrack !== null;
  const color = `hsl(${(name.charCodeAt(0) * 37) % 360}, 55%, 40%)`;

  const isSidebar = variant === "sidebar";
  const avatarSize = isSidebar ? "w-7 h-7 text-xs" : "w-10 h-10 text-base";
  const nameSize = isSidebar ? "text-[10px]" : "text-xs";
  const badgeSize = isSidebar ? "w-3.5 h-3.5" : "w-5 h-5";
  const badgeIcon = isSidebar ? "7" : "10";

  return (
    <>
    <div
      data-testid={`participant-tile-${participant.identity}`}
      className={`relative flex flex-col items-center justify-center overflow-hidden rounded-xl border-2 transition-all duration-200 cursor-pointer select-none ${
        isSpeaking ? "voice-speaking" : "border-transparent"
      } ${isPinned ? "ring-2 ring-[#5865f2]" : ""}`}
      style={{ backgroundColor: hasVideo ? "#000" : color, width: "100%", height: "100%" }}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onMouseEnter={() => variant === "main" && setShowExpand(true)}
      onMouseLeave={() => setShowExpand(false)}
      onContextMenu={!isLocal && volumeMenuEnabled ? (e) => { e.preventDefault(); e.stopPropagation(); setVolumeMenu({ x: e.clientX, y: e.clientY }); } : undefined}
    >
      {/* Video or avatar */}
      {hasVideo && cameraTrack ? (
        <VideoTile track={cameraTrack} />
      ) : (
        <span className={`${avatarSize} rounded-full flex items-center justify-center font-bold text-white`}
          style={{ backgroundColor: color }}>
          {name[0]?.toUpperCase() ?? "?"}
        </span>
      )}

      {/* Name label */}
      <div className={`absolute bottom-1.5 left-2 right-2 flex items-center gap-1 ${isSidebar ? "justify-center" : ""}`}>
        <div
          className={`flex items-center gap-1.5 px-1 py-0.5 rounded overflow-hidden max-w-full`}
          style={{ backgroundColor: "rgba(0,0,0,0.55)", color: "#dbdee1" }}
        >
          <span className={`${nameSize} font-medium truncate`}>
            {isLocal ? "You" : name}
          </span>
          {!isMicEnabled && (
            <div
              className={`${badgeSize} rounded-full flex items-center justify-center shrink-0`}
              style={{ backgroundColor: "var(--color-dc-red, #ed4245)" }}
            >
              <svg width={badgeIcon} height={badgeIcon} viewBox="0 0 24 24" fill="white">
                <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z"/>
              </svg>
            </div>
          )}
        </div>
        {isPinned && (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="#5865f2" style={{ flexShrink: 0 }}>
            <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5v6h2v-6h5v-2l-2-2z"/>
          </svg>
        )}
      </div>


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

    {volumeMenu && (
      <VolumeMenu
        userId={participant.identity}
        name={name}
        x={volumeMenu.x}
        y={volumeMenu.y}
        onClose={() => setVolumeMenu(null)}
      />
    )}
    </>
  );
}
