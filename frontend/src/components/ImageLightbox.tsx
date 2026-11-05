import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { openExternal } from "../lib/externalLinks";

export interface LightboxImage { src: string; alt: string }
interface Props {
  images: LightboxImage[];
  index: number;
  onChange?: (index: number) => void;
  onClose: () => void;
  returnFocus?: HTMLElement | null;
  variant?: "gallery" | "avatar";
}
interface View { zoom: number; x: number; y: number }
const fit: View = { zoom: 1, x: 0, y: 0 };

/** Key the gesture surface so navigation also clears active pointers and transforms. */
export function ImageLightbox(props: Props) {
  return <Viewer key={`${props.index}:${props.images[props.index].src}`} {...props} />;
}

function Viewer({ images, index, onChange, onClose, returnFocus, variant = "gallery" }: Props) {
  const image = images[index];
  const avatar = variant === "avatar";
  const stage = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const backdropGesture = useRef(false);
  const viewRef = useRef(fit);
  const [view, setView] = useState(fit);
  const [dragging, setDragging] = useState(false);
  const [upscaled, setUpscaled] = useState(false);

  function update(next: View) {
    const bounds = stage.current!.getBoundingClientRect();
    const width = img.current!.offsetWidth;
    const height = img.current!.offsetHeight;
    const maxX = Math.max(0, (width * next.zoom - bounds.width) / 2);
    const maxY = Math.max(0, (height * next.zoom - bounds.height) / 2);
    const clamped = {
      zoom: next.zoom,
      x: Math.max(-maxX, Math.min(maxX, next.x)),
      y: Math.max(-maxY, Math.min(maxY, next.y)),
    };
    viewRef.current = clamped;
    setView(clamped);
  }

  function zoomAt(zoom: number, x: number, y: number) {
    const old = viewRef.current;
    const bounds = stage.current!.getBoundingClientRect();
    zoom = Math.max(1, Math.min(8, zoom));
    const ratio = zoom / old.zoom;
    update({ zoom,
      x: (x - bounds.left - bounds.width / 2) * (1 - ratio) + old.x * ratio,
      y: (y - bounds.top - bounds.height / 2) * (1 - ratio) + old.y * ratio,
    });
  }

  function zoomCenter(factor: number) {
    const bounds = stage.current!.getBoundingClientRect();
    zoomAt(viewRef.current.zoom * factor, bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
  }

  useEffect(() => {
    const previous = document.body.style.overflow;
    const focus = returnFocus ?? document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();
    return () => { document.body.style.overflow = previous; focus?.focus(); };
  }, [returnFocus]);

  useEffect(() => {
    function key(e: KeyboardEvent) {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        onChange?.((index + (e.key === "ArrowLeft" ? images.length - 1 : 1)) % images.length);
      }
      if (e.key === "Tab") {
        const buttons = closeButton.current?.closest('[role="dialog"]')?.querySelectorAll<HTMLElement>('button, a[href]');
        if (!buttons?.length) return;
        const first = buttons[0], last = buttons[buttons.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [index, images.length, onChange, onClose]);

  useEffect(() => {
    const element = stage.current!;
    if (avatar) return;
    // Native non-passive listener is necessary for ctrl+wheel / trackpad pinch.
    function wheel(e: WheelEvent) {
      e.preventDefault();
      const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? element.clientHeight : 1);
      zoomAt(viewRef.current.zoom * Math.exp(-delta * 0.01), e.clientX, e.clientY);
    }
    function resize() { update(viewRef.current); }
    element.addEventListener("wheel", wheel, { passive: false });
    window.addEventListener("resize", resize);
    return () => { element.removeEventListener("wheel", wheel); window.removeEventListener("resize", resize); };
    // Gesture functions operate on refs, not render-time state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={avatar ? image.alt : "Image viewer"}
      data-avatar-lightbox={avatar ? "" : undefined}
      className={`fixed inset-0 z-[10003] flex items-center justify-center ${avatar ? "flex-col gap-3 p-6 lightbox-in" : ""}`}
      style={{ backgroundColor: avatar ? "rgba(0,0,0,0.85)" : "rgba(0,0,0,.9)" }}
      onMouseDown={e => { if (avatar && e.target === e.currentTarget) onClose(); }}
      onClick={e => { if (!avatar && e.target === e.currentTarget) onClose(); }}>
      <div ref={stage} className={avatar ? "flex items-center justify-center" : "absolute inset-0 flex items-center justify-center overflow-hidden"}
        style={avatar ? { width: "min(512px, 80vw, 75vh)", height: "min(512px, 80vw, 75vh)", touchAction: "none" } : { touchAction: "none" }}
        onClick={e => { if (!avatar && e.target === e.currentTarget && backdropGesture.current) onClose(); }}
        onDoubleClick={e => { if (!avatar) zoomAt(view.zoom === 1 ? 2 : 1, e.clientX, e.clientY); }}
        onPointerDown={e => {
          if (avatar || e.button !== 0) return;
          backdropGesture.current = e.target === e.currentTarget && viewRef.current.zoom === 1;
          if (backdropGesture.current) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          setDragging(true);
        }}
        onPointerMove={e => {
          const old = pointers.current.get(e.pointerId);
          if (!old) return;
          const before = [...pointers.current.values()];
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          const after = [...pointers.current.values()];
          if (before.length === 2) {
            const distance = (p: typeof before) => Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
            const center = (p: typeof before) => ({ x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 });
            const a = center(before), b = center(after);
            if (distance(before) > 0) zoomAt(viewRef.current.zoom * distance(after) / distance(before), a.x, a.y);
            update({ ...viewRef.current, x: viewRef.current.x + b.x - a.x, y: viewRef.current.y + b.y - a.y });
          } else if (before.length === 1 && viewRef.current.zoom > 1) {
            update({ ...viewRef.current, x: viewRef.current.x + e.clientX - old.x, y: viewRef.current.y + e.clientY - old.y });
          }
        }}
        onPointerUp={e => { pointers.current.delete(e.pointerId); setDragging(pointers.current.size > 0); }}
        onPointerCancel={e => { pointers.current.delete(e.pointerId); setDragging(pointers.current.size > 0); }}
        onLostPointerCapture={e => { pointers.current.delete(e.pointerId); setDragging(pointers.current.size > 0); }}>
        <img ref={img} src={image.src} alt={image.alt} draggable={false}
          onLoad={e => setUpscaled(e.currentTarget.offsetWidth > e.currentTarget.naturalWidth || e.currentTarget.offsetHeight > e.currentTarget.naturalHeight)}
          className={`object-contain select-none ${avatar ? "w-full h-full rounded-lg shadow-2xl" : "max-w-[90vw] max-h-[90vh]"}`}
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`, imageRendering: upscaled || view.zoom > 1 ? "pixelated" : "auto", cursor: avatar ? "auto" : view.zoom > 1 ? dragging ? "grabbing" : "grab" : "zoom-in" }} />
      </div>
      {avatar ? <div className="flex items-center gap-4 text-sm" style={{ color: "rgba(255,255,255,0.75)" }}>
        <a href={image.src} target="_blank" rel="noreferrer" className="hover:underline">Open original</a>
        <button ref={closeButton} type="button" onClick={onClose} className="hover:underline">Close</button>
      </div> : <>
        <div className="absolute top-4 right-4 flex gap-2 text-white">
          <button aria-label="Zoom out" onClick={() => zoomCenter(1 / 1.25)}>−</button>
          <button aria-label="Zoom in" onClick={() => zoomCenter(1.25)}>+</button>
          <button onClick={() => navigator.clipboard?.writeText(image.src)}>Copy link</button>
          <button onClick={() => openExternal(image.src)}>Open in browser</button>
          <button ref={closeButton} aria-label="Close image viewer" onClick={onClose}>×</button>
        </div>
        {images.length > 1 && <div className="absolute bottom-5 flex items-center gap-4 text-white">
          <button aria-label="Previous image" onClick={() => onChange?.((index + images.length - 1) % images.length)}>‹</button>
          <span>{index + 1} / {images.length}</span>
          <button aria-label="Next image" onClick={() => onChange?.((index + 1) % images.length)}>›</button>
        </div>}
      </>}
    </div>, document.body,
  );
}
