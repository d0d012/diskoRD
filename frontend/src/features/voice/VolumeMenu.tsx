import { useEffect, useRef } from "react";
import { useVoiceStore } from "../../stores/voiceStore";

interface VolumeMenuProps {
  userId: string;
  name: string;
  x: number;
  y: number;
  onClose: () => void;
}

export function VolumeMenu({ userId, name, x, y, onClose }: VolumeMenuProps) {
  const volume = useVoiceStore((s) => s.remoteVolumes[userId] ?? 1);
  const setRemoteVolume = useVoiceStore((s) => s.setRemoteVolume);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [onClose]);

  // Keep menu inside viewport
  const menuW = 200;
  const menuH = 100;
  const left = Math.min(x, window.innerWidth - menuW - 8);
  const top = Math.min(y, window.innerHeight - menuH - 8);

  return (
    <div
      ref={ref}
      className="fixed z-50 rounded-lg shadow-2xl p-3 flex flex-col gap-2"
      style={{ left, top, width: menuW, backgroundColor: "var(--color-dc-bg-floating, #111214)" }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <p className="text-xs font-semibold truncate" style={{ color: "var(--color-dc-header-primary)" }}>
        {name}
      </p>
      <div className="flex items-center gap-2">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ color: "var(--color-dc-text-muted)", flexShrink: 0 }}>
          <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
        </svg>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => setRemoteVolume(userId, parseFloat(e.target.value))}
          className="flex-1 accent-[#5865f2]"
        />
        <span className="text-xs w-8 text-right tabular-nums" style={{ color: "var(--color-dc-text-muted)" }}>
          {Math.round(volume * 100)}%
        </span>
      </div>
      <button
        className="text-xs text-left px-1 py-0.5 rounded transition-colors"
        style={{ color: "var(--color-dc-text-muted)" }}
        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "var(--color-dc-bg-modifier-hover)")}
        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
        onClick={() => { setRemoteVolume(userId, 1); onClose(); }}
      >
        Reset to 100%
      </button>
    </div>
  );
}
