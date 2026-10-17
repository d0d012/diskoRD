import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Art } from "./lib/art";
import { encodeDoc } from "./lib/doc";
import { DECORATION_SIZES, decorationLeft, docImageUrl } from "./decorationImage";
const MAX_Y = 64;

export interface Placement {
  x: number;
  y: number;
  size: number;
}

interface Props {
  art: Art;
  /** The message row the piece is pinned to. */
  row: HTMLElement;
  onPlace: (placement: Placement) => Promise<void>;
  onCancel: () => void;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/** Lets the user position a piece over a message: a ghost follows the pointer, click places it. */
export function PlaceDecoration({ art, row, onPlace, onCancel }: Props) {
  const url = useMemo(() => docImageUrl(encodeDoc(art)), [art]);
  const [sizeIndex, setSizeIndex] = useState(2); // 64px
  const [spot, setSpot] = useState({ x: 50, y: 0 });
  const [rect, setRect] = useState(() => row.getBoundingClientRect());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const size = DECORATION_SIZES[sizeIndex];

  /** Follows the pointer; the row is re-measured since the list can move underneath. */
  function track(clientX: number, clientY: number) {
    const r = row.getBoundingClientRect();
    const next = {
      x: Math.round(clamp(((clientX - r.left) / r.width) * 100, 0, 100)),
      y: Math.round(clamp(clientY - r.top - size / 2, 0, MAX_Y)),
    };
    setRect(r);
    setSpot(next);
    return next;
  }

  function resize(delta: number) {
    setSizeIndex((i) => clamp(i + delta, 0, DECORATION_SIZES.length - 1));
  }

  async function place(at: { x: number; y: number }) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await onPlace({ ...at, size });
    } catch (err) {
      const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(message ?? "Couldn't place it. Try again.");
      setBusy(false);
    }
  }

  // Wheel resizes instead of scrolling the list underneath.
  const overlayRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      resize(e.deltaY < 0 ? 1 : -1);
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const latest = useRef(onCancel);
  useEffect(() => {
    latest.current = onCancel;
  });
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        latest.current();
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  const toolbarTop = Math.max(8, rect.top - 44);
  const buttonStyle = { backgroundColor: "var(--color-dc-bg-secondary)", color: "var(--color-dc-text-normal)" };

  return createPortal(
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[10002]"
      style={{ cursor: busy ? "progress" : "crosshair" }}
      onPointerMove={(e) => track(e.clientX, e.clientY)}
      onClick={(e) => void place(track(e.clientX, e.clientY))}
      role="dialog"
      aria-label="Place pixel art on message"
    >
      {/* Band the piece can occupy */}
      <div
        className="absolute pointer-events-none rounded"
        style={{
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: Math.max(rect.height, MAX_Y + size),
          outline: "2px dashed var(--color-dc-brand)",
          backgroundColor: "rgba(88,101,242,0.06)",
        }}
      >
        {url && (
          <img
            src={url}
            alt=""
            className="absolute"
            style={{
              left: decorationLeft(spot.x, size),
              top: spot.y,
              width: size,
              height: size,
              opacity: 0.7,
              imageRendering: "pixelated",
            }}
          />
        )}
      </div>

      <div
        className="absolute flex items-center gap-2 px-2 py-1.5 rounded-md shadow-lg text-xs"
        style={{ left: rect.left + 8, top: toolbarTop, backgroundColor: "var(--color-dc-bg-floating)", color: "var(--color-dc-text-normal)", cursor: "default" }}
        onClick={(e) => e.stopPropagation()}
        onPointerMove={(e) => e.stopPropagation()}
      >
        <span style={{ color: "var(--color-dc-text-muted)" }}>Click to place · scroll to resize · Esc to cancel</span>
        <button onClick={() => resize(-1)} disabled={sizeIndex === 0} aria-label="Smaller" className="w-6 h-6 rounded disabled:opacity-40" style={buttonStyle}>−</button>
        <span className="w-10 text-center tabular-nums">{size}px</span>
        <button onClick={() => resize(1)} disabled={sizeIndex === DECORATION_SIZES.length - 1} aria-label="Larger" className="w-6 h-6 rounded disabled:opacity-40" style={buttonStyle}>+</button>
        <button onClick={onCancel} className="px-2 h-6 rounded" style={buttonStyle}>Cancel</button>
        {error && <span style={{ color: "var(--color-dc-red, #ed4245)" }}>{error}</span>}
      </div>
    </div>,
    document.body,
  );
}
