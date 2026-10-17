import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Art } from "./lib/art";
import { encodeDoc } from "./lib/doc";
import { DECORATION_MAX_Y, DECORATION_MIN_Y, DECORATION_OPACITIES, DECORATION_SIZES, docImageUrl } from "./decorationImage";

export interface Placement {
  /** The message the piece is anchored to, so it scrolls and paginates with it. */
  messageId: string;
  x: number;
  y: number;
  size: number;
  /** Percent. */
  opacity: number;
}

const OPACITY_KEY = "pixelart.decorationOpacity";

function loadOpacity(): number {
  try {
    const saved = Number(localStorage.getItem(OPACITY_KEY));
    if ((DECORATION_OPACITIES as readonly number[]).includes(saved)) return saved;
  } catch {
    // Storage unavailable: fall through to the default.
  }
  return 100;
}

function saveOpacity(value: number) {
  try {
    localStorage.setItem(OPACITY_KEY, String(value));
  } catch {
    // Storage unavailable: the choice lasts for this placement only.
  }
}

interface Props {
  art: Art;
  /** The scrolling message list: the whole history is the canvas. */
  list: HTMLElement;
  onPlace: (placement: Placement) => Promise<void>;
  onCancel: () => void;
}

interface Ghost {
  placement: Omit<Placement, "opacity">;
  /** Screen position of the ghost's top-left corner. */
  left: number;
  top: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/** The row under the point, or the closest one when the point is in a gap or past the ends. */
function rowAt(list: HTMLElement, clientY: number): HTMLElement | null {
  let best: HTMLElement | null = null;
  let bestDistance = Infinity;
  for (const row of list.querySelectorAll<HTMLElement>("[data-message-id]")) {
    const r = row.getBoundingClientRect();
    const distance = clientY < r.top ? r.top - clientY : clientY >= r.bottom ? clientY - r.bottom : 0;
    if (distance < bestDistance) {
      best = row;
      bestDistance = distance;
      if (distance === 0) break;
    }
  }
  return best;
}

/**
 * Drop a piece anywhere in the chat: a ghost follows the pointer, the wheel
 * keeps scrolling the history, click places it. The piece is anchored to the
 * message under the pointer, with its offset from that message's top.
 */
export function PlaceDecoration({ art, list, onPlace, onCancel }: Props) {
  const url = useMemo(() => docImageUrl(encodeDoc(art)), [art]);
  const [sizeIndex, setSizeIndex] = useState(2); // 64px
  const [opacity, setOpacity] = useState(loadOpacity);
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const [bounds, setBounds] = useState(() => list.getBoundingClientRect());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const size = DECORATION_SIZES[sizeIndex];

  function locate(clientX: number, clientY: number, pieceSize: number): Ghost | null {
    setBounds(list.getBoundingClientRect());
    const row = rowAt(list, clientY);
    const messageId = row?.dataset.messageId;
    if (!row || !messageId) return null;
    const r = row.getBoundingClientRect();
    // The pointer is the piece's center; x spans the row width minus the piece, so it never leaves the row.
    const x = Math.round(clamp(((clientX - r.left - pieceSize / 2) / Math.max(1, r.width - pieceSize)) * 100, 0, 100));
    const y = Math.round(clamp(clientY - pieceSize / 2 - r.top, DECORATION_MIN_Y, DECORATION_MAX_Y));
    return {
      placement: { messageId, x, y, size: pieceSize },
      left: r.left + ((r.width - pieceSize) * x) / 100,
      top: r.top + y,
    };
  }

  function track(clientX: number, clientY: number, pieceSize = size) {
    pointerRef.current = { x: clientX, y: clientY };
    const next = locate(clientX, clientY, pieceSize);
    setGhost(next);
    return next;
  }

  function resize(delta: number) {
    const nextIndex = clamp(sizeIndex + delta, 0, DECORATION_SIZES.length - 1);
    setSizeIndex(nextIndex);
    const p = pointerRef.current;
    if (p) track(p.x, p.y, DECORATION_SIZES[nextIndex]);
  }

  async function place(at: Ghost | null) {
    if (busy || !at) return;
    setBusy(true);
    setError("");
    try {
      await onPlace({ ...at.placement, opacity });
    } catch (err) {
      const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(message ?? "Couldn't place it. Try again.");
      setBusy(false);
    }
  }

  // The wheel keeps scrolling the history underneath (the canvas is borderless);
  // Ctrl/Alt + wheel resizes.
  const latest = useRef({ resize, track, onCancel });
  useEffect(() => {
    latest.current = { resize, track, onCancel };
  });
  const overlayRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      if (e.ctrlKey || e.altKey) {
        latest.current.resize(e.deltaY < 0 ? 1 : -1);
        return;
      }
      // Re-dispatch so the list sees a user scroll (it stops following the bottom), then move it.
      list.dispatchEvent(new WheelEvent("wheel", { deltaY: e.deltaY, bubbles: true }));
      list.scrollTop += e.deltaY;
      const p = pointerRef.current;
      if (p) requestAnimationFrame(() => latest.current.track(p.x, p.y));
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        latest.current.onCancel();
      } else if (e.key === "+" || e.key === "=") {
        latest.current.resize(1);
      } else if (e.key === "-") {
        latest.current.resize(-1);
      }
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKey, true);
    return () => {
      el.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [list]);

  const buttonStyle = { backgroundColor: "var(--color-dc-bg-secondary)", color: "var(--color-dc-text-normal)" };

  return createPortal(
    <div
      ref={overlayRef}
      className="fixed z-[10002]"
      style={{ left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height, cursor: busy ? "progress" : "crosshair" }}
      onPointerMove={(e) => track(e.clientX, e.clientY)}
      onPointerLeave={() => setGhost(null)}
      onClick={(e) => void place(track(e.clientX, e.clientY))}
      role="dialog"
      aria-label="Place pixel art in chat"
    >
      <div className="absolute inset-0 pointer-events-none" style={{ outline: "2px dashed var(--color-dc-brand)", outlineOffset: -2, backgroundColor: "rgba(88,101,242,0.05)" }} />

      {ghost && url && (
        <img
          src={url}
          alt=""
          data-testid="decoration-ghost"
          className="fixed pointer-events-none"
          style={{ left: ghost.left, top: ghost.top, width: size, height: size, opacity: opacity / 100, imageRendering: "pixelated" }}
        />
      )}

      <div
        className="absolute left-2 top-2 flex flex-wrap items-center gap-2 px-2 py-1.5 rounded-md shadow-lg text-xs max-w-[calc(100%-16px)]"
        style={{ backgroundColor: "var(--color-dc-bg-floating)", color: "var(--color-dc-text-normal)", cursor: "default" }}
        onClick={(e) => e.stopPropagation()}
        onPointerMove={(e) => { e.stopPropagation(); setGhost(null); }}
      >
        <span style={{ color: "var(--color-dc-text-muted)" }}>Click anywhere to place · scroll to move through history · Esc to cancel</span>
        <button onClick={() => resize(-1)} disabled={sizeIndex === 0} aria-label="Smaller" className="w-6 h-6 rounded disabled:opacity-40" style={buttonStyle}>−</button>
        <span className="w-10 text-center tabular-nums">{size}px</span>
        <button onClick={() => resize(1)} disabled={sizeIndex === DECORATION_SIZES.length - 1} aria-label="Larger" className="w-6 h-6 rounded disabled:opacity-40" style={buttonStyle}>+</button>
        <div role="radiogroup" aria-label="Opacity" className="flex items-center gap-0.5">
          {DECORATION_OPACITIES.map((value) => (
            <button
              key={value}
              role="radio"
              aria-checked={opacity === value}
              onClick={() => { setOpacity(value); saveOpacity(value); }}
              title={value === 100 ? "Fully visible" : value === 35 ? "Faint, keeps text easy to read" : undefined}
              className="px-1.5 h-6 rounded tabular-nums"
              style={opacity === value ? { backgroundColor: "var(--color-dc-brand)", color: "#fff" } : buttonStyle}
            >
              {value}%
            </button>
          ))}
        </div>
        <button onClick={onCancel} className="px-2 h-6 rounded" style={buttonStyle}>Cancel</button>
        {error && <span style={{ color: "var(--color-dc-red, #ed4245)" }}>{error}</span>}
      </div>
    </div>,
    document.body,
  );
}
