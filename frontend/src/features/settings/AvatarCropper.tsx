import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const VIEWPORT = 280;
const OUTPUT = 512;
const MAX_ZOOM = 4;

interface Props {
  file: File;
  /** Dialog heading; defaults to "Edit Image". */
  title?: string;
  onCancel: () => void;
  onApply: (cropped: File) => void;
}

interface Offset {
  x: number;
  y: number;
}

/** Keeps the image covering the whole crop viewport. */
function clamp(offset: Offset, width: number, height: number): Offset {
  return {
    x: Math.min(0, Math.max(VIEWPORT - width, offset.x)),
    y: Math.min(0, Math.max(VIEWPORT - height, offset.y)),
  };
}

/** Lets the user pan and zoom an image inside a circular mask, then exports a square WebP. */
export function AvatarCropper({ file, title = "Edit Image", onCancel, onApply }: Props) {
  const [src, setSrc] = useState<string | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 });
  const [applying, setApplying] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<{ pointerX: number; pointerY: number; start: Offset } | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Scale at zoom 1 makes the shorter side fill the viewport.
  const baseScale = natural ? Math.max(VIEWPORT / natural.w, VIEWPORT / natural.h) : 1;
  const scale = baseScale * zoom;
  const width = natural ? natural.w * scale : VIEWPORT;
  const height = natural ? natural.h * scale : VIEWPORT;

  /** Zoom 1, image centered. */
  function fit(w: number, h: number) {
    const s = Math.max(VIEWPORT / w, VIEWPORT / h);
    setNatural({ w, h });
    setZoom(1);
    setOffset({ x: (VIEWPORT - w * s) / 2, y: (VIEWPORT - h * s) / 2 });
  }

  function handleLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    fit(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight);
  }

  /** Zooms around a point in viewport coordinates so that point stays put. */
  function zoomTo(nextZoom: number, focusX = VIEWPORT / 2, focusY = VIEWPORT / 2) {
    if (!natural) return;
    const z = Math.min(MAX_ZOOM, Math.max(1, nextZoom));
    const nextScale = baseScale * z;
    const ratio = nextScale / scale;
    const next = {
      x: focusX - (focusX - offset.x) * ratio,
      y: focusY - (focusY - offset.y) * ratio,
    };
    setZoom(z);
    setOffset(clamp(next, natural.w * nextScale, natural.h * nextScale));
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { pointerX: e.clientX, pointerY: e.clientY, start: offset };
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    setOffset(clamp(
      { x: drag.start.x + e.clientX - drag.pointerX, y: drag.start.y + e.clientY - drag.pointerY },
      width,
      height,
    ));
  }

  function handlePointerUp() {
    dragRef.current = null;
  }


  async function handleApply() {
    const img = imgRef.current;
    if (!img || !natural) return;
    setApplying(true);
    const side = VIEWPORT / scale;
    const target = Math.min(OUTPUT, Math.round(side));
    const canvas = document.createElement("canvas");
    canvas.width = target;
    canvas.height = target;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setApplying(false);
      return;
    }
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, -offset.x / scale, -offset.y / scale, side, side, 0, 0, target, target);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.9));
    setApplying(false);
    if (blob) onApply(new File([blob], "avatar.webp", { type: "image/webp" }));
  }

  // Wheel zoom needs a non-passive listener so the page behind doesn't scroll.
  const viewportRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(zoomTo);
  zoomRef.current = zoomTo;
  const zoomValueRef = useRef(zoom);
  zoomValueRef.current = zoom;
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const rect = el!.getBoundingClientRect();
      zoomRef.current(zoomValueRef.current * (e.deltaY < 0 ? 1.1 : 1 / 1.1), e.clientX - rect.left, e.clientY - rect.top);
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Esc cancels the cropper without closing the settings modal underneath.
  const latest = useRef({ onCancel, handleApply });
  latest.current = { onCancel, handleApply };
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        latest.current.onCancel();
      } else if (e.key === "Enter") {
        e.stopPropagation();
        void latest.current.handleApply();
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  return createPortal(
    <div
      className="fixed inset-0 z-[10002] flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.7)" }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="w-[360px] rounded-lg overflow-hidden shadow-2xl" style={{ backgroundColor: "var(--color-dc-bg-primary)" }}>
        <div className="px-5 pt-5 pb-3">
          <h3 className="text-lg font-semibold" style={{ color: "var(--color-dc-header-primary)" }}>{title}</h3>
          <p className="text-xs mt-0.5" style={{ color: "var(--color-dc-text-muted)" }}>
            Drag to reposition, scroll or use the slider to zoom.
          </p>
        </div>

        <div className="flex justify-center px-5">
          <div
            ref={viewportRef}
            className="relative overflow-hidden rounded-lg cursor-grab active:cursor-grabbing touch-none select-none"
            style={{ width: VIEWPORT, height: VIEWPORT, backgroundColor: "var(--color-dc-bg-tertiary)" }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          >
            {src && (
              <img
                ref={imgRef}
                src={src}
                alt=""
                draggable={false}
                onLoad={handleLoad}
                className="absolute max-w-none pointer-events-none"
                style={{
                  left: offset.x,
                  top: offset.y,
                  width,
                  height,
                  visibility: natural ? "visible" : "hidden",
                }}
              />
            )}
            {/* Circular mask */}
            <div
              className="absolute inset-0 rounded-full pointer-events-none"
              style={{ boxShadow: "0 0 0 9999px rgba(0,0,0,0.6)", border: "2px solid rgba(255,255,255,0.85)" }}
            />
          </div>
        </div>

        <div className="flex items-center gap-3 px-5 pt-4">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ color: "var(--color-dc-text-muted)" }} aria-hidden="true">
            <path d="M19 5H5v14h14V5zm-2 12H7l3-4 2 2.5 2-3 3 4.5z" />
          </svg>
          <input
            type="range"
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            value={zoom}
            onChange={(e) => zoomTo(Number(e.target.value))}
            className="flex-1 accent-[var(--color-dc-brand)]"
            aria-label="Zoom"
          />
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style={{ color: "var(--color-dc-text-muted)" }} aria-hidden="true">
            <path d="M19 5H5v14h14V5zm-2 12H7l3-4 2 2.5 2-3 3 4.5z" />
          </svg>
        </div>

        <div className="flex items-center justify-between gap-2 px-5 py-4 mt-4" style={{ backgroundColor: "var(--color-dc-bg-secondary)" }}>
          <button
            type="button"
            onClick={() => natural && fit(natural.w, natural.h)}
            className="text-sm hover:underline"
            style={{ color: "var(--color-dc-text-muted)" }}
          >
            Reset
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={onCancel} className="px-4 h-9 rounded text-sm hover:underline" style={{ color: "var(--color-dc-text-normal)" }}>
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleApply()}
              disabled={!natural || applying}
              className="px-4 h-9 rounded text-sm font-medium text-white hover:brightness-110 disabled:opacity-60"
              style={{ backgroundColor: "var(--color-dc-brand)" }}
            >
              {applying ? "Applying…" : "Apply"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
