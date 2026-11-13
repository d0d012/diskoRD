import { useState } from "react";
import type { VoiceParticipant } from "../../hooks/useVoice";
import { useLiveUser } from "../../hooks/useLiveUser";
import { Avatar } from "../../components/ui/Avatar";
import { VideoTile } from "./VideoTile";
import { VolumeMenu } from "./VolumeMenu";

import "./voice.css";

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

  const { name, isSpeaking, isMicEnabled, cameraTrack, isLocal, isCameraEnabled } = participant;
  const hasVideo = isCameraEnabled && cameraTrack !== null;
  const live = useLiveUser(participant.identity, { id: participant.identity, username: name });

  const isSidebar = variant === "sidebar";
  const nameSize = isSidebar ? "text-[10px]" : "text-xs";
  const badgeSize = isSidebar ? "w-3.5 h-3.5" : "w-5 h-5";
  const badgeIcon = isSidebar ? "7" : "10";

  return (
    <>
    <div
      data-testid={`participant-tile-${participant.identity}`}
      data-speaking={isSpeaking}
      data-speaking-ring={hasVideo || isSidebar ? "tile" : "avatar"}
      className={`dc-voice-tile relative flex flex-col items-center justify-center overflow-hidden rounded-xl cursor-pointer select-none ${isPinned ? "outline-2 outline-dc-brand outline-offset-2" : ""}`}
      style={{ backgroundColor: hasVideo ? "#000" : "var(--color-dc-bg-tertiary)", width: "100%", height: "100%" }}
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
        <div className="dc-voice-avatar" data-speaking={isSpeaking && !isSidebar}>
          <Avatar name={live.username ?? name} src={live.avatarUrl} size={isSidebar ? 28 : variant === "main" ? 80 : 64} />
        </div>
      )}

      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,transparent_65%,rgba(0,0,0,0.7)_100%)]" />

      {/* Name label */}
      <div className={`absolute bottom-1.5 left-2 right-2 flex items-center gap-1 ${isSidebar ? "justify-center" : ""}`}>
        <div
          className={`flex items-center gap-1.5 ${isSidebar ? "px-1.5 py-0.5" : "px-2 py-1"} rounded-md overflow-hidden max-w-full`}
          style={{ backgroundColor: "color-mix(in srgb, var(--color-dc-bg-floating) 80%, transparent)", color: "var(--color-dc-text-normal)" }}
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
          <svg width="10" height="10" viewBox="0 0 24 24" fill="var(--color-dc-brand)" style={{ flexShrink: 0 }}>
            <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5v6h2v-6h5v-2l-2-2z"/>
          </svg>
        )}
      </div>


      {/* Expand button — only on main stage tile, on hover */}
      {variant === "main" && showExpand && (
        <button
          className="dc-press absolute top-2 right-2 px-2 py-0.5 rounded text-[10px] font-medium"
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
