import { useRef, useState } from "react";
import { useVoiceStore } from "../../stores/voiceStore";
import { useNoiseCancellation } from "../../hooks/useNoiseCancellation";
import { ScreenShareModal } from "./ScreenShareModal";

interface ControlBarProps {
  /** When true, renders with semi-transparent dark background for overlay use */
  floating?: boolean;
}

function ControlBtn({
  active,
  danger,
  onClick,
  title,
  children,
  floating,
}: {
  active?: boolean;
  danger?: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
  floating?: boolean;
}) {
  const base = floating ? "w-10 h-10" : "w-12 h-12";
  const bg = danger
    ? "var(--color-dc-red, #ed4245)"
    : active
    ? floating ? "rgba(79,86,96,0.85)" : "var(--color-dc-bg-modifier-selected)"
    : floating ? "rgba(79,86,96,0.75)" : "var(--color-dc-bg-tertiary)";

  return (
    <button
      onClick={onClick}
      title={title}
      className={`${base} rounded-full flex items-center justify-center transition-all duration-150 flex-shrink-0`}
      style={{ backgroundColor: bg, color: active ? "var(--color-dc-header-primary)" : "var(--color-dc-interactive-normal)" }}
    >
      {children}
    </button>
  );
}

export function ControlBar({ floating = false }: ControlBarProps) {
  const [showModal, setShowModal] = useState(false);
  const [isMonitoring, setIsMonitoring] = useState(false);
  const monitorCleanupRef = useRef<(() => void) | null>(null);
  const monitorLoadingRef = useRef(false);
  const { isMuted, isDeafened, isCameraOn, isScreenSharing, setMuted, setDeafened, setCameraOn, setScreenSharing, leaveVoice } =
    useVoiceStore();
  const { isEnabled: isNCEnabled, toggle: toggleNC, processStream } = useNoiseCancellation();

  async function toggleMonitor() {
    if (isMonitoring) {
      monitorCleanupRef.current?.();
      monitorCleanupRef.current = null;
      setIsMonitoring(false);
      return;
    }
    if (monitorLoadingRef.current) return;
    monitorLoadingRef.current = true;
    try {
      const rawStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const { stream, cleanup: ncCleanup } = await processStream(rawStream);
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      source.connect(ctx.destination);
      monitorCleanupRef.current = () => {
        source.disconnect();
        ctx.close();
        ncCleanup();
        rawStream.getTracks().forEach(t => t.stop());
      };
      setIsMonitoring(true);
    } catch {
      // ignore
    } finally {
      monitorLoadingRef.current = false;
    }
  }

  return (
    <>
      <div className={`flex items-center justify-center gap-3 ${floating ? "py-3" : "px-6 py-4"}`}>
        {/* Mic */}
        <ControlBtn active={!isMuted} onClick={() => setMuted(!isMuted)} title={isMuted ? "Unmute" : "Mute"} floating={floating}>
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
        <ControlBtn active={!isDeafened} onClick={() => setDeafened(!isDeafened)} title={isDeafened ? "Undeafen" : "Deafen"} floating={floating}>
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
        <ControlBtn active={isCameraOn} onClick={() => setCameraOn(!isCameraOn)} title={isCameraOn ? "Turn off camera" : "Turn on camera"} floating={floating}>
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

        {/* Screen share — if active, clicking stops; if inactive, opens modal */}
        <ControlBtn
          active={isScreenSharing}
          onClick={() => isScreenSharing ? setScreenSharing(false) : setShowModal(true)}
          title={isScreenSharing ? "Stop sharing" : "Share screen"}
          floating={floating}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20 3H4c-1.1 0-2 .9-2 2v11c0 1.1.9 2 2 2h7v2H9v2h6v-2h-2v-2h7c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 13H4V5h16v11z"/>
            {isScreenSharing && <circle cx="12" cy="11" r="3" fill="currentColor"/>}
          </svg>
        </ControlBtn>

        {/* Noise Cancellation */}
        <ControlBtn
          active={isNCEnabled}
          onClick={toggleNC}
          title={isNCEnabled ? "Noise cancellation on" : "Noise cancellation off"}
          floating={floating}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 12h2"/>
            <path d="M4 12 Q5 6 6 12 Q7 18 8 12"/>
            <path d="M8 12 Q9 4 10 12 Q11 20 12 12"/>
            <path d="M12 12 Q13 4 14 12 Q15 20 16 12"/>
            <path d="M16 12 Q17 6 18 12 Q19 18 20 12"/>
            <path d="M20 12h2"/>
          </svg>
        </ControlBtn>

        {/* Mic monitor — hear your own processed audio */}
        <ControlBtn
          active={isMonitoring}
          onClick={toggleMonitor}
          title={isMonitoring ? "Stop monitoring mic" : "Hear your mic (test NC)"}
          floating={floating}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
            <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
          </svg>
        </ControlBtn>

        {/* Disconnect */}
        <ControlBtn danger onClick={leaveVoice} title="Disconnect" floating={floating}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08A.99.99 0 0 1 0 12.37c0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.66c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48a1 1 0 0 1-.71.29c-.27 0-.52-.11-.7-.28a11.27 11.27 0 0 0-2.67-1.85.985.985 0 0 1-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/>
          </svg>
        </ControlBtn>
      </div>

      {showModal && <ScreenShareModal onClose={() => setShowModal(false)} />}
    </>
  );
}
