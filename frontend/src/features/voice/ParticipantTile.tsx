import { useEffect, useState } from "react";
import type { VoiceParticipant } from "../../hooks/useVoice";
import { VideoTile } from "./VideoTile";

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
}

export function ParticipantTile({
  participant,
  variant = "grid",
  isPinned = false,
  onClick,
  onDoubleClick,
}: ParticipantTileProps) {
  const [showExpand, setShowExpand] = useState(false);

  useEffect(() => { injectSpeakingStyles(); }, []);

  const { name, isSpeaking, isMicEnabled, cameraTrack, screenTrack, isScreenSharing, isLocal } = participant;
  const hasVideo = cameraTrack !== null;
  const hasScreen = screenTrack !== null;
  const color = `hsl(${(name.charCodeAt(0) * 37) % 360}, 55%, 40%)`;

  const isSidebar = variant === "sidebar";
  const avatarSize = isSidebar ? "w-7 h-7 text-xs" : "w-10 h-10 text-base";
  const nameSize = isSidebar ? "text-[10px]" : "text-xs";
  const badgeSize = isSidebar ? "w-3.5 h-3.5" : "w-5 h-5";
  const badgeIcon = isSidebar ? "7" : "10";

  return (
    <div
      data-testid={`participant-tile-${participant.identity}`}
      className={`relative flex flex-col items-center justify-center overflow-hidden rounded-xl border-2 transition-all duration-200 cursor-pointer select-none ${
        isSpeaking ? "voice-speaking" : "border-transparent"
      } ${isPinned ? "ring-2 ring-[#5865f2]" : ""}`}
      style={{ backgroundColor: hasVideo || hasScreen ? "#000" : color, width: "100%", height: "100%" }}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onMouseEnter={() => variant === "main" && setShowExpand(true)}
      onMouseLeave={() => setShowExpand(false)}
    >
      {/* Video or avatar */}
      {hasVideo && cameraTrack ? (
        <VideoTile track={cameraTrack} />
      ) : hasScreen && screenTrack ? (
        <VideoTile track={screenTrack} />
      ) : (
        <span className={`${avatarSize} rounded-full flex items-center justify-center font-bold text-white`}
          style={{ backgroundColor: color }}>
          {name[0]?.toUpperCase() ?? "?"}
        </span>
      )}

      {/* Name label */}
      <div className={`absolute bottom-1.5 left-2 right-2 flex items-center gap-1 ${isSidebar ? "justify-center" : ""}`}>
        <span
          className={`${nameSize} font-medium truncate px-1 py-0.5 rounded`}
          style={{ backgroundColor: "rgba(0,0,0,0.55)", color: "#dbdee1" }}
        >
          {isLocal ? "You" : name}
        </span>
        {isPinned && <span className="text-[9px]">📌</span>}
      </div>

      {/* Muted badge */}
      {!isMicEnabled && (
        <div
          className={`absolute top-1.5 left-1.5 ${badgeSize} rounded-full flex items-center justify-center`}
          style={{ backgroundColor: "var(--color-dc-red, #ed4245)" }}
        >
          <svg width={badgeIcon} height={badgeIcon} viewBox="0 0 24 24" fill="white">
            <path d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z"/>
          </svg>
        </div>
      )}

      {/* Screen sharing badge */}
      {isScreenSharing && (
        <div
          className={`absolute top-1.5 right-1.5 ${badgeSize} rounded-full flex items-center justify-center`}
          style={{ backgroundColor: "var(--color-dc-brand, #5865f2)" }}
        >
          <svg width={badgeIcon} height={badgeIcon} viewBox="0 0 24 24" fill="white">
            <path d="M20 3H4c-1.1 0-2 .9-2 2v11c0 1.1.9 2 2 2h7v2H9v2h6v-2h-2v-2h7c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 13H4V5h16v11z"/>
          </svg>
        </div>
      )}

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
  );
}
