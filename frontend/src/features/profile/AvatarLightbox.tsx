import { useEffect } from "react";
import { createPortal } from "react-dom";
import { resolveMediaUrl } from "../../lib/api";

interface Props {
  src: string;
  name: string;
  onClose: () => void;
}

/** Full-size view of a user's avatar. Closes on backdrop click or Esc. */
export function AvatarLightbox({ src, name, onClose }: Props) {
  // Capture-phase Esc so the profile card underneath stays open.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[10003] flex flex-col items-center justify-center gap-3 p-6 lightbox-in"
      style={{ backgroundColor: "rgba(0,0,0,0.85)" }}
      role="dialog"
      aria-modal="true"
      aria-label={`${name}'s avatar`}
      data-avatar-lightbox
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <img
        src={resolveMediaUrl(src)}
        alt={`${name}'s avatar`}
        draggable={false}
        className="rounded-lg shadow-2xl object-contain"
        style={{ width: "min(512px, 80vw, 75vh)", height: "min(512px, 80vw, 75vh)" }}
      />
      <div className="flex items-center gap-4 text-sm">
        <a
          href={resolveMediaUrl(src)}
          target="_blank"
          rel="noreferrer"
          className="hover:underline"
          style={{ color: "rgba(255,255,255,0.75)" }}
        >
          Open original
        </a>
        <button type="button" onClick={onClose} className="hover:underline" style={{ color: "rgba(255,255,255,0.75)" }}>
          Close
        </button>
      </div>
    </div>,
    document.body,
  );
}
