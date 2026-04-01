import { useVoiceStore } from "../../stores/voiceStore";

interface ScreenShareModalProps {
  onClose: () => void;
}

const RESOLUTIONS = [
  { label: "720", value: "720" },
  { label: "1080", value: "1080" },
  { label: "1440", value: "1440" },
  { label: "SOURCE", value: "source" },
] as const;

const FRAMERATES = [15, 30, 60] as const;

export function ScreenShareModal({ onClose }: ScreenShareModalProps) {
  const {
    screenShareFps,
    screenShareResolution,
    screenShareAudio,
    setScreenShareFps,
    setScreenShareResolution,
    setScreenShareAudio,
    setScreenSharing,
  } = useVoiceStore();

  function handleGoLive() {
    setScreenSharing(true);
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.6)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-[440px] rounded-lg overflow-hidden shadow-2xl"
        style={{ backgroundColor: "var(--color-dc-bg-secondary, #2b2d31)" }}
      >
        {/* Header */}
        <div className="relative flex items-center justify-center px-6 pt-6 pb-4">
          <h2 className="text-xl font-bold" style={{ color: "var(--color-dc-header-primary, #f2f3f5)" }}>
            Screen Share
          </h2>
          <button
            onClick={onClose}
            className="absolute right-4 top-4 p-1 rounded transition-colors"
            style={{ color: "var(--color-dc-interactive-normal, #b5bac1)" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--color-dc-interactive-hover, #dbdee1)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--color-dc-interactive-normal, #b5bac1)")}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59 7.11 5.7A1 1 0 0 0 5.7 7.11L10.59 12 5.7 16.89a1 1 0 1 0 1.41 1.41L12 13.41l4.89 4.89a1 1 0 0 0 1.41-1.41L13.41 12l4.89-4.89a1 1 0 0 0 0-1.4z"/>
            </svg>
          </button>
        </div>

        <div className="px-6 pb-6 flex flex-col gap-5">
          {/* Share application audio */}
          <label className="flex items-center gap-3 cursor-pointer select-none">
            <div
              className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0 transition-colors"
              style={{
                backgroundColor: screenShareAudio
                  ? "var(--color-dc-brand, #5865f2)"
                  : "var(--color-dc-bg-tertiary, #1e1f22)",
                border: screenShareAudio ? "none" : "2px solid var(--color-dc-interactive-normal, #b5bac1)",
              }}
              onClick={() => setScreenShareAudio(!screenShareAudio)}
            >
              {screenShareAudio && (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="white">
                  <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/>
                </svg>
              )}
            </div>
            <span className="text-sm" style={{ color: "var(--color-dc-text-normal, #dbdee1)" }}>
              Also share application audio.
            </span>
          </label>

          {/* Stream quality */}
          <div>
            <p
              className="text-xs font-semibold uppercase tracking-wide mb-3"
              style={{ color: "var(--color-dc-text-muted, #80848e)" }}
            >
              Stream Quality
            </p>

            {/* Resolution */}
            <p className="text-xs font-semibold mb-2" style={{ color: "var(--color-dc-text-muted, #80848e)" }}>
              RESOLUTION
            </p>
            <div className="flex gap-2 mb-4">
              {RESOLUTIONS.map(({ label, value }) => (
                <button
                  key={value}
                  onClick={() => setScreenShareResolution(value)}
                  className="flex-1 py-1.5 rounded text-sm font-semibold transition-colors"
                  style={{
                    backgroundColor: screenShareResolution === value
                      ? "var(--color-dc-brand, #5865f2)"
                      : "var(--color-dc-bg-tertiary, #1e1f22)",
                    color: screenShareResolution === value
                      ? "#fff"
                      : "var(--color-dc-interactive-normal, #b5bac1)",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Frame rate */}
            <p className="text-xs font-semibold mb-2" style={{ color: "var(--color-dc-text-muted, #80848e)" }}>
              FRAME RATE
            </p>
            <div className="flex gap-2">
              {FRAMERATES.map((fps) => (
                <button
                  key={fps}
                  onClick={() => setScreenShareFps(fps)}
                  className="flex-1 py-1.5 rounded text-sm font-semibold transition-colors"
                  style={{
                    backgroundColor: screenShareFps === fps
                      ? "var(--color-dc-brand, #5865f2)"
                      : "var(--color-dc-bg-tertiary, #1e1f22)",
                    color: screenShareFps === fps
                      ? "#fff"
                      : "var(--color-dc-interactive-normal, #b5bac1)",
                  }}
                >
                  {fps}
                </button>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <button
              onClick={onClose}
              className="flex-1 py-2 rounded text-sm font-medium transition-colors"
              style={{
                backgroundColor: "var(--color-dc-bg-tertiary, #1e1f22)",
                color: "var(--color-dc-text-normal, #dbdee1)",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--color-dc-bg-modifier-hover, #35373c)")}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "var(--color-dc-bg-tertiary, #1e1f22)")}
            >
              Back
            </button>
            <button
              onClick={handleGoLive}
              className="flex-1 py-2 rounded text-sm font-medium transition-colors"
              style={{ backgroundColor: "var(--color-dc-brand, #5865f2)", color: "#fff" }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#4752c4")}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "var(--color-dc-brand, #5865f2)")}
            >
              Go Live
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
