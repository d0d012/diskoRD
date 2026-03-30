import { useCallback, useEffect, useRef, useState } from "react";
import type { VoiceParticipant } from "../../hooks/useVoice";
import { ParticipantTile } from "./ParticipantTile";
import { ControlBar } from "./ControlBar";

interface FullscreenOverlayProps {
  participant: VoiceParticipant;
  onClose: () => void;
}

export function FullscreenOverlay({ participant, onClose }: FullscreenOverlayProps) {
  const [controlsVisible, setControlsVisible] = useState(true);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Esc key to close
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // Auto-hide controls after 3s of no mouse movement
  const resetHideTimer = useCallback(() => {
    setControlsVisible(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setControlsVisible(false), 3000);
  }, []);

  useEffect(() => {
    resetHideTimer();
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [resetHideTimer]);

  return (
    <div
      data-testid="fullscreen-overlay"
      className="fixed inset-0 z-[9999] bg-black flex flex-col"
      onMouseMove={resetHideTimer}
    >
      {/* Video / avatar fills the space */}
      <div className="flex-1 relative overflow-hidden">
        <ParticipantTile participant={participant} variant="main" />

        {/* Participant name label */}
        <div
          data-testid="participant-name-label"
          className="absolute bottom-4 left-4 px-2 py-1 rounded text-sm font-medium"
          style={{ backgroundColor: "rgba(0,0,0,0.65)", color: "#dbdee1" }}
        >
          {participant.name}
        </div>

        {/* Exit button — always visible */}
        <button
          aria-label="exit fullscreen"
          onClick={onClose}
          className="absolute top-4 right-4 px-3 py-1.5 rounded-md text-xs font-semibold transition-opacity"
          style={{ backgroundColor: "rgba(0,0,0,0.65)", color: "#dbdee1", border: "1px solid #4f5660" }}
        >
          ✕ Exit
        </button>
      </div>

      {/* Floating controls bar — fades on inactivity */}
      <div
        className="flex-shrink-0 transition-opacity duration-300"
        style={{
          opacity: controlsVisible ? 1 : 0,
          background: "linear-gradient(transparent, rgba(0,0,0,0.8))",
          pointerEvents: controlsVisible ? "auto" : "none",
        }}
        onMouseEnter={resetHideTimer}
      >
        <ControlBar floating />
      </div>
    </div>
  );
}
