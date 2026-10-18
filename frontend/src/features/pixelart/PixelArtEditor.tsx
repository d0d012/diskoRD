import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  MAX_BRUSH, MAX_COLORS, SIZES, TRANSPARENT, createArt, floodFill, isEmpty, linePoints, mirrorPoints, paint,
  pixelPerfect, rectPoints, resize, stampPoints, type Art, type Point,
} from "./lib/art";
import { decodeDoc, encodeDoc } from "./lib/doc";
import { renderImport, suggestImport, type ImportState, type Rgba } from "./lib/importImage";
import { artToPng, downloadBlob, drawArt, loadImageRgba, shareScale } from "./render";

const HISTORY_LIMIT = 100;
const DRAFT_KEY = "diskord.pixelart.draft";
const MAX_IMPORT_BYTES = 8 * 1024 * 1024;
/** Zoom steps, relative to "whole canvas fits the view". */
const ZOOMS = [1, 1.5, 2, 3, 4, 6, 8, 12, 16];
/** Cells never get bigger than this when zooming in. */
const MAX_CELL_PX = 48;

type Tool = "pencil" | "eraser" | "fill" | "picker" | "line" | "rect";

const TOOLS: { id: Tool; label: string; key: string; icon: string }[] = [
  { id: "pencil", label: "Pencil", key: "b", icon: "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zm17.71-10.21a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z" },
  { id: "eraser", label: "Eraser", key: "e", icon: "M16.24 3.56l4.95 4.94a2 2 0 0 1 0 2.83L12 20.52H21v2H8.5l-5.69-5.69a2 2 0 0 1 0-2.83L13.41 3.56a2 2 0 0 1 2.83 0zM4.22 15.58 8.9 20.27h.27l3.54-3.54-4.95-4.95-3.54 3.8z" },
  { id: "fill", label: "Fill", key: "g", icon: "M16.56 8.94 7.62 0 6.21 1.41l2.38 2.38-5.15 5.15a1.49 1.49 0 0 0 0 2.12l5.5 5.5c.29.29.68.44 1.06.44s.77-.15 1.06-.44l5.5-5.5c.59-.58.59-1.53 0-2.12zM5.21 10 10 5.21 14.79 10H5.21zM19 11.5s-2 2.17-2 3.5a2 2 0 0 0 4 0c0-1.33-2-3.5-2-3.5z" },
  { id: "picker", label: "Color picker", key: "i", icon: "M20.71 5.63l-2.34-2.34a1 1 0 0 0-1.41 0l-3.12 3.12-1.93-1.91-1.41 1.41 1.42 1.42L3 16.25V21h4.75l8.92-8.92 1.42 1.42 1.41-1.41-1.92-1.92 3.12-3.12a1 1 0 0 0 .01-1.42zM6.92 19 5 17.08l8.06-8.06 1.92 1.92L6.92 19z" },
  { id: "line", label: "Line", key: "l", icon: "M3.5 19.09 19.09 3.5l1.41 1.41L4.91 20.5z" },
  { id: "rect", label: "Rectangle", key: "u", icon: "M3 3h18v18H3V3zm2 2v14h14V5H5z" },
];

interface Stroke {
  before: Art;
  start: Point;
  points: Point[];
  value: number;
  tool: Tool;
}

interface Pan {
  x: number;
  y: number;
  left: number;
  top: number;
}

interface Props {
  /** Sends the art to the chat as a PNG. */
  onSend?: (file: File) => Promise<void>;
  /** Hands the art back to be dropped somewhere in the chat as a decoration. */
  onPlace?: (art: Art) => void;
  onClose: () => void;
}

function loadDraft(): Art {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) return decodeDoc(JSON.parse(raw));
  } catch {
    // Missing, corrupt or blocked storage: start fresh.
  }
  return createArt();
}

function saveDraft(art: Art) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(encodeDoc(art)));
  } catch {
    // Storage blocked or full; the draft just isn't kept.
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/** Square canvas area that fits the window next to the tool and side panels. */
function viewSize(): number {
  if (typeof window === "undefined") return 448;
  return Math.round(clamp(Math.min(window.innerWidth - 400, window.innerHeight - 190), 288, 640));
}

function rgbaThumb(src: Rgba): string | null {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = src.width;
    canvas.height = src.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.putImageData(new ImageData(new Uint8ClampedArray(src.data), src.width, src.height), 0, 0);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

/** Indexed-color pixel art editor: draw, import, export, send to a channel or place in it. */
export function PixelArtEditor({ onSend, onPlace, onClose }: Props) {
  const [art, setArt] = useState<Art>(loadDraft);
  const [past, setPast] = useState<Art[]>([]);
  const [future, setFuture] = useState<Art[]>([]);
  const [tool, setTool] = useState<Tool>("pencil");
  const [color, setColor] = useState(1);
  const [brush, setBrush] = useState(1);
  const [mirror, setMirror] = useState(false);
  const [grid, setGrid] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [view, setView] = useState(viewSize);
  const [hover, setHover] = useState<Point | null>(null);
  const [importing, setImporting] = useState<ImportState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const strokeRef = useRef<Stroke | null>(null);
  const panRef = useRef<Pan | null>(null);
  const spaceRef = useRef(false);
  const zoomAnchorRef = useRef<{ fx: number; fy: number; x: number; y: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Deferred so dragging the color slider stays smooth on big canvases.
  const deferredImport = useDeferredValue(importing);
  const imported = useMemo(
    () => (deferredImport ? renderImport(deferredImport, art.palette) : null),
    [deferredImport, art.palette],
  );
  const shown = imported?.art ?? art;
  const size = shown.size;

  const baseCell = view / size;
  const maxZoom = Math.max(1, MAX_CELL_PX / baseCell);
  const cell = baseCell * Math.min(zoom, maxZoom);
  const contentPx = Math.round(size * cell);

  useEffect(() => {
    if (canvasRef.current) drawArt(canvasRef.current, shown);
  }, [shown]);

  useEffect(() => {
    if (!strokeRef.current) saveDraft(art);
  }, [art]);

  useEffect(() => {
    const onResize = () => setView(viewSize());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Keep the point under the cursor in place when zooming.
  useLayoutEffect(() => {
    const anchor = zoomAnchorRef.current;
    const vp = viewportRef.current;
    const content = contentRef.current;
    zoomAnchorRef.current = null;
    if (!anchor || !vp || !content) return;
    const rect = content.getBoundingClientRect();
    vp.scrollLeft += rect.left + anchor.fx * rect.width - anchor.x;
    vp.scrollTop += rect.top + anchor.fy * rect.height - anchor.y;
  }, [zoom]);

  function commit(next: Art, before = art) {
    if (next === before) return;
    setPast((p) => [...p.slice(-(HISTORY_LIMIT - 1)), before]);
    setFuture([]);
    setArt(next);
  }

  function undo() {
    if (!past.length) return;
    setFuture((f) => [art, ...f]);
    setArt(past[past.length - 1]);
    setPast((p) => p.slice(0, -1));
  }

  function redo() {
    if (!future.length) return;
    setPast((p) => [...p, art]);
    setArt(future[0]);
    setFuture((f) => f.slice(1));
  }

  function showError(message: string) {
    setError(message);
    setTimeout(() => setError(""), 4000);
  }

  // ── View ─────────────────────────────────────────────────────────────────

  function zoomTo(next: number, clientX?: number, clientY?: number) {
    const target = clamp(next, 1, maxZoom);
    const content = contentRef.current;
    if (content && clientX !== undefined && clientY !== undefined) {
      const rect = content.getBoundingClientRect();
      zoomAnchorRef.current = {
        fx: rect.width ? (clientX - rect.left) / rect.width : 0.5,
        fy: rect.height ? (clientY - rect.top) / rect.height : 0.5,
        x: clientX,
        y: clientY,
      };
    }
    setZoom(target);
  }

  function zoomStep(direction: 1 | -1, clientX?: number, clientY?: number) {
    const current = Math.min(zoom, maxZoom);
    const next = direction > 0
      ? ZOOMS.find((z) => z > current + 0.01) ?? maxZoom
      : [...ZOOMS].reverse().find((z) => z < current - 0.01) ?? 1;
    zoomTo(next, clientX, clientY);
  }

  // Ctrl/⌘ + wheel zooms (non-passive so the page doesn't zoom or scroll).
  const zoomStepRef = useRef(zoomStep);
  useEffect(() => {
    zoomStepRef.current = zoomStep;
  });
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    function onWheel(e: WheelEvent) {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoomStepRef.current(e.deltaY < 0 ? 1 : -1, e.clientX, e.clientY);
    }
    vp.addEventListener("wheel", onWheel, { passive: false });
    return () => vp.removeEventListener("wheel", onWheel);
  }, []);

  // ── Drawing ──────────────────────────────────────────────────────────────

  function cellAt(e: React.PointerEvent): Point {
    const rect = e.currentTarget.getBoundingClientRect();
    return [
      clamp(Math.floor(((e.clientX - rect.left) / rect.width) * size), 0, size - 1),
      clamp(Math.floor(((e.clientY - rect.top) / rect.height) * size), 0, size - 1),
    ];
  }

  /** Re-applies the whole stroke on top of the snapshot taken at pointer down. */
  function renderStroke(stroke: Stroke): Art {
    let points: Point[];
    const end = stroke.points[stroke.points.length - 1];
    if (stroke.tool === "line") points = linePoints(...stroke.start, ...end);
    else if (stroke.tool === "rect") points = rectPoints(...stroke.start, ...end);
    // Pixel-perfect only makes sense for 1px freehand strokes.
    else if (stroke.value === TRANSPARENT || brush > 1) points = stroke.points;
    else points = pixelPerfect(stroke.points);
    points = stampPoints(points, brush);
    return paint(stroke.before, mirror ? mirrorPoints(points, art.size) : points, stroke.value);
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const vp = viewportRef.current;
    // Middle button or Space + drag pans the view.
    if (vp && (e.button === 1 || spaceRef.current)) {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      panRef.current = { x: e.clientX, y: e.clientY, left: vp.scrollLeft, top: vp.scrollTop };
      return;
    }
    if (importing || (e.button !== 0 && e.button !== 2)) return;
    const [x, y] = cellAt(e);
    if (tool === "picker") {
      const value = art.pixels[y * art.size + x];
      if (value !== TRANSPARENT) { setColor(value); setTool("pencil"); }
      return;
    }
    // Right button always erases, like most pixel editors.
    const value = e.button === 2 || tool === "eraser" ? TRANSPARENT : color;
    if (tool === "fill") {
      const filled = floodFill(art, x, y, value);
      commit(mirror ? floodFill(filled, art.size - 1 - x, y, value) : filled);
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    const stroke: Stroke = { before: art, start: [x, y], points: [[x, y]], value, tool: tool === "eraser" ? "pencil" : tool };
    strokeRef.current = stroke;
    setArt(renderStroke(stroke));
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const pan = panRef.current;
    const vp = viewportRef.current;
    if (pan && vp) {
      vp.scrollLeft = pan.left - (e.clientX - pan.x);
      vp.scrollTop = pan.top - (e.clientY - pan.y);
      return;
    }
    const at = cellAt(e);
    if (!hover || hover[0] !== at[0] || hover[1] !== at[1]) setHover(at);
    const stroke = strokeRef.current;
    if (!stroke) return;
    const last = stroke.points[stroke.points.length - 1];
    if (last[0] === at[0] && last[1] === at[1]) return;
    // Fill the gap between pointer samples so fast strokes stay connected.
    if (stroke.tool === "pencil") stroke.points.push(...linePoints(...last, ...at).slice(1));
    else stroke.points.push(at);
    setArt(renderStroke(stroke));
  }

  function handlePointerUp() {
    panRef.current = null;
    const stroke = strokeRef.current;
    if (!stroke) return;
    strokeRef.current = null;
    const result = renderStroke(stroke);
    const changed = result.pixels.some((p, i) => p !== stroke.before.pixels[i]);
    if (changed) commit(result, stroke.before);
    else setArt(stroke.before);
  }

  // ── Palette ──────────────────────────────────────────────────────────────

  function setSwatch(hex: string) {
    const palette = [...art.palette];
    palette[color - 1] = hex;
    commit({ ...art, palette });
  }

  function addSwatch() {
    if (art.palette.length >= MAX_COLORS) return;
    commit({ ...art, palette: [...art.palette, art.palette[color - 1]] });
    setColor(art.palette.length + 1);
  }

  // ── Import / export / send ──────────────────────────────────────────────

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      showError("File exceeds 8MB limit.");
      return;
    }
    try {
      if (file.name.endsWith(".json")) {
        const doc = decodeDoc(JSON.parse(await file.text()));
        commit(doc);
        setColor(1);
        setZoom(1);
        return;
      }
      const suggestion = suggestImport(await loadImageRgba(file));
      setImporting({
        ...suggestion,
        thumb: rgbaThumb(suggestion.source),
        palette: "new",
        colors: "all",
      });
      setZoom(1);
    } catch (err) {
      showError(err instanceof Error && err.message.length < 60 ? err.message : "Could not read that file.");
    }
  }

  function applyImport() {
    if (!importing) return;
    // Render from the latest options, not the deferred preview.
    commit(renderImport(importing, art.palette).art);
    setColor(1);
    setImporting(null);
  }

  async function exportPng(scale: number) {
    try {
      downloadBlob(await artToPng(art, scale), `pixel-art-${art.size * scale}.png`);
    } catch {
      showError("Export failed.");
    }
  }

  function exportDoc() {
    downloadBlob(new Blob([JSON.stringify(encodeDoc(art))], { type: "application/json" }), "pixel-art.pixel.json");
  }

  async function send() {
    if (busy || isEmpty(art) || !onSend) return;
    setBusy(true);
    try {
      const blob = await artToPng(art, shareScale(art));
      await onSend(new File([blob], "pixel-art.png", { type: "image/png" }));
      onClose();
    } catch {
      showError("Could not send. Try again.");
    } finally {
      setBusy(false);
    }
  }

  // ── Keyboard ─────────────────────────────────────────────────────────────

  const latest = useRef({ onClose, undo, redo, importing, zoomStep });
  useEffect(() => {
    latest.current = { onClose, undo, redo, importing, zoomStep };
  });
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const l = latest.current;
      if (e.key === "Escape") {
        e.stopPropagation();
        if (l.importing) setImporting(null);
        else l.onClose();
        return;
      }
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && key === "z") { e.preventDefault(); if (e.shiftKey) l.redo(); else l.undo(); return; }
      if (mod && key === "y") { e.preventDefault(); l.redo(); return; }
      if (mod) return;
      if (e.key === " ") { e.preventDefault(); spaceRef.current = true; return; }
      if (key === "[") { setBrush((b) => Math.max(1, b - 1)); return; }
      if (key === "]") { setBrush((b) => Math.min(MAX_BRUSH, b + 1)); return; }
      if (key === "+" || key === "=") { l.zoomStep(1); return; }
      if (key === "-") { l.zoomStep(-1); return; }
      if (key === "0") { setZoom(1); return; }
      const match = TOOLS.find((t) => t.key === key);
      if (match) setTool(match.id);
      else if (key === "m") setMirror((m) => !m);
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.key === " ") spaceRef.current = false;
    }
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKeyUp, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKeyUp, true);
    };
  }, []);

  // ── UI ───────────────────────────────────────────────────────────────────

  const buttonStyle = { backgroundColor: "var(--color-dc-bg-secondary)", color: "var(--color-dc-text-normal)" };
  const muted = { color: "var(--color-dc-text-muted)" };
  const toggleStyle = (on: boolean) => ({
    backgroundColor: on ? "var(--color-dc-brand)" : "var(--color-dc-bg-secondary)",
    color: on ? "#fff" : "var(--color-dc-interactive-normal)",
  });
  const brushTools = tool === "pencil" || tool === "eraser" || tool === "line" || tool === "rect";
  const hoverSpan = brushTools ? brush : 1;
  const hoverOffset = brushTools ? -Math.floor((brush - 1) / 2) : 0;

  return createPortal(
    <div
      className="fixed inset-0 z-[10002] flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.7)" }}
      role="dialog"
      aria-modal="true"
      aria-label="Pixel art"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="max-w-full max-h-full overflow-auto rounded-lg shadow-2xl p-4" style={{ backgroundColor: "var(--color-dc-bg-primary)" }}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold" style={{ color: "var(--color-dc-header-primary)" }}>Pixel art</h3>
          <button onClick={onClose} aria-label="Close" className="p-1 rounded hover:bg-[var(--color-dc-bg-modifier-hover)]" style={{ color: "var(--color-dc-interactive-normal)" }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M18.3 5.71 12 12l6.3 6.29-1.41 1.42L10.59 13.4 4.29 19.7 2.88 18.3 9.17 12 2.88 5.71 4.29 4.3l6.3 6.29 6.29-6.3z" />
            </svg>
          </button>
        </div>

        <div className="flex gap-3 flex-wrap">
          {/* Tools */}
          <div className="flex flex-col gap-1" role="toolbar" aria-label="Tools">
            {TOOLS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTool(t.id)}
                title={`${t.label} (${t.key.toUpperCase()})`}
                aria-label={t.label}
                aria-pressed={tool === t.id}
                className="w-9 h-9 rounded flex items-center justify-center"
                style={toggleStyle(tool === t.id)}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d={t.icon} /></svg>
              </button>
            ))}
            <div className="h-px my-1" style={{ backgroundColor: "var(--color-dc-bg-modifier-selected)" }} />
            <button
              onClick={() => setBrush((b) => (b % MAX_BRUSH) + 1)}
              title="Brush size ([ and ])"
              aria-label={`Brush size ${brush}`}
              className="w-9 h-9 rounded flex items-center justify-center"
              style={buttonStyle}
            >
              <span className="rounded-sm" style={{ width: 4 + brush * 3, height: 4 + brush * 3, backgroundColor: "currentColor" }} />
            </button>
            <button
              onClick={() => setMirror((m) => !m)}
              title="Mirror horizontally (M)"
              aria-label="Mirror"
              aria-pressed={mirror}
              className="w-9 h-9 rounded text-xs font-bold"
              style={toggleStyle(mirror)}
            >
              ⇋
            </button>
            <button
              onClick={() => setGrid((g) => !g)}
              title="Show grid"
              aria-label="Grid"
              aria-pressed={grid}
              className="w-9 h-9 rounded text-xs font-bold"
              style={toggleStyle(grid)}
            >
              #
            </button>
          </div>

          {/* Canvas */}
          <div className="flex flex-col gap-1.5">
            <div
              ref={viewportRef}
              className="flex overflow-auto rounded"
              style={{ width: view, height: view, backgroundColor: "var(--color-dc-bg-tertiary)" }}
            >
              <div
                ref={contentRef}
                className="relative touch-none select-none flex-shrink-0 m-auto"
                style={{
                  width: contentPx,
                  height: contentPx,
                  cursor: spaceRef.current || panRef.current ? "grab" : importing ? "default" : "crosshair",
                  background: "repeating-conic-gradient(#3a3c42 0% 25%, #2e3035 0% 50%) 0 0 / 16px 16px",
                }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                onPointerLeave={() => setHover(null)}
                onContextMenu={(e) => e.preventDefault()}
                data-testid="pixel-canvas"
              >
                <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" style={{ imageRendering: "pixelated" }} />
                {grid && cell >= 6 && (
                  <div
                    className="absolute inset-0 pointer-events-none"
                    style={{
                      backgroundImage: "linear-gradient(to right, rgba(255,255,255,0.07) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.07) 1px, transparent 1px)",
                      backgroundSize: `${cell}px ${cell}px`,
                    }}
                  />
                )}
                {hover && !importing && tool !== "picker" && (
                  <div
                    className="absolute pointer-events-none"
                    data-testid="brush-preview"
                    style={{
                      left: (hover[0] + hoverOffset) * cell,
                      top: (hover[1] + hoverOffset) * cell,
                      width: hoverSpan * cell,
                      height: hoverSpan * cell,
                      backgroundColor: tool === "eraser" ? "transparent" : art.palette[color - 1],
                      opacity: tool === "eraser" ? 1 : 0.6,
                      outline: "1px solid rgba(255,255,255,0.8)",
                      boxShadow: "0 0 0 1px rgba(0,0,0,0.6)",
                    }}
                  />
                )}
              </div>
            </div>

            {/* Status bar */}
            <div className="flex items-center gap-2 text-xs tabular-nums" style={muted}>
              <span className="w-16">{hover ? `${hover[0]}, ${hover[1]}` : "—"}</span>
              <span className="flex-1">{size}×{size}{brushTools && brush > 1 ? ` · brush ${brush}` : ""}</span>
              <button onClick={() => zoomStep(-1)} disabled={zoom <= 1} aria-label="Zoom out" title="Zoom out (−)" className="w-6 h-6 rounded disabled:opacity-40" style={buttonStyle}>−</button>
              <button onClick={() => setZoom(1)} title="Fit (0)" className="px-1.5 h-6 rounded min-w-12" style={buttonStyle}>{Math.round(Math.min(zoom, maxZoom) * 100)}%</button>
              <button onClick={() => zoomStep(1)} disabled={zoom >= maxZoom} aria-label="Zoom in" title="Zoom in (+, Ctrl/⌘ + wheel)" className="w-6 h-6 rounded disabled:opacity-40" style={buttonStyle}>+</button>
            </div>
          </div>

          {/* Side panel */}
          <div className="w-56 flex flex-col gap-3 text-sm" style={{ color: "var(--color-dc-text-normal)" }}>
            {importing ? (
              <ImportOptions
                state={importing}
                sourceColors={imported?.sourceColors ?? null}
                resultColors={imported?.art.palette.length ?? null}
                onChange={setImporting}
                onApply={applyImport}
                onCancel={() => setImporting(null)}
              />
            ) : (
              <>
                <label className="flex items-center justify-between gap-2">
                  <span className="text-xs uppercase font-bold" style={muted}>Size</span>
                  <select
                    value={art.size}
                    onChange={(e) => { commit(resize(art, Number(e.target.value))); setZoom(1); }}
                    className="rounded px-2 py-1 text-sm"
                    style={buttonStyle}
                  >
                    {SIZES.map((s) => <option key={s} value={s}>{s}×{s}</option>)}
                  </select>
                </label>

                <div>
                  <div className="flex items-baseline justify-between mb-1">
                    <span className="text-xs uppercase font-bold" style={muted}>Palette</span>
                    <span className="text-xs tabular-nums" style={muted}>{art.palette.length}/{MAX_COLORS}</span>
                  </div>
                  <div className="grid grid-cols-8 gap-1 max-h-40 overflow-y-auto p-0.5" role="radiogroup" aria-label="Palette">
                    {art.palette.map((c, i) => (
                      <button
                        key={i}
                        role="radio"
                        aria-checked={color === i + 1}
                        aria-label={`Color ${c}`}
                        title={c}
                        onClick={() => { setColor(i + 1); if (tool === "eraser" || tool === "picker") setTool("pencil"); }}
                        className="w-5 h-5 rounded-sm"
                        style={{ backgroundColor: c, outline: color === i + 1 ? "2px solid #fff" : "1px solid rgba(0,0,0,0.4)", outlineOffset: color === i + 1 ? 1 : 0 }}
                      />
                    ))}
                    {art.palette.length < MAX_COLORS && (
                      <button onClick={addSwatch} aria-label="Add color" title="Add color" className="w-5 h-5 rounded-sm text-xs leading-none" style={buttonStyle}>+</button>
                    )}
                  </div>
                  <label className="flex items-center gap-2 mt-2 text-xs" style={muted}>
                    <input
                      type="color"
                      value={art.palette[color - 1] ?? "#000000"}
                      onChange={(e) => setSwatch(e.target.value)}
                      className="w-8 h-6 bg-transparent cursor-pointer"
                      aria-label="Edit selected color"
                    />
                    Edit selected color
                  </label>
                </div>

                <div className="flex gap-1">
                  <button onClick={undo} disabled={!past.length} className="flex-1 rounded py-1 disabled:opacity-40" style={buttonStyle} title="Undo (Ctrl+Z)">Undo</button>
                  <button onClick={redo} disabled={!future.length} className="flex-1 rounded py-1 disabled:opacity-40" style={buttonStyle} title="Redo (Ctrl+Shift+Z)">Redo</button>
                  <button onClick={() => commit(createArt(art.size, art.palette))} disabled={isEmpty(art)} className="flex-1 rounded py-1 disabled:opacity-40" style={buttonStyle}>Clear</button>
                </div>

                <div className="flex flex-col gap-1">
                  <input ref={fileRef} type="file" accept="image/*,.json" className="hidden" onChange={handleImportFile} />
                  <button onClick={() => fileRef.current?.click()} className="rounded py-1" style={buttonStyle}>Import image or .pixel.json</button>
                  <div className="flex gap-1">
                    <button onClick={() => exportPng(1)} className="flex-1 rounded py-1 text-xs" style={buttonStyle} title="Download PNG at native size">PNG ×1</button>
                    <button onClick={() => exportPng(shareScale(art))} className="flex-1 rounded py-1 text-xs" style={buttonStyle} title="Download 512px PNG">PNG 512</button>
                    <button onClick={exportDoc} className="flex-1 rounded py-1 text-xs" style={buttonStyle} title="Download editable file">.json</button>
                  </div>
                </div>

                <p className="text-[11px] leading-snug" style={muted}>
                  Right-click erases · Space+drag pans · Ctrl/⌘+wheel zooms · [ ] brush size
                </p>

                <div className="mt-auto flex flex-col gap-1">
                  {onPlace && (
                    <button
                      onClick={() => onPlace(art)}
                      disabled={busy || isEmpty(art)}
                      title="Drop it anywhere in the chat's history as a decoration"
                      className="rounded py-2 font-medium disabled:opacity-50"
                      style={onSend ? buttonStyle : { backgroundColor: "var(--color-dc-brand)", color: "#fff" }}
                    >
                      Place in chat
                    </button>
                  )}
                  {onSend && (
                    <button
                      onClick={send}
                      disabled={busy || isEmpty(art)}
                      className="rounded py-2 font-medium text-white disabled:opacity-50"
                      style={{ backgroundColor: "var(--color-dc-brand)" }}
                    >
                      {busy ? "Sending…" : "Send to chat"}
                    </button>
                  )}
                </div>
              </>
            )}
            {error && <p className="text-xs" style={{ color: "var(--color-dc-red, #ed4245)" }}>{error}</p>}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ImportOptions({ state, sourceColors, resultColors, onChange, onApply, onCancel }: {
  state: ImportState;
  sourceColors: number | null;
  resultColors: number | null;
  onChange: (s: ImportState) => void;
  onApply: () => void;
  onCancel: () => void;
}) {
  const muted = { color: "var(--color-dc-text-muted)" };
  const buttonStyle = { backgroundColor: "var(--color-dc-bg-secondary)", color: "var(--color-dc-text-normal)" };
  const { source } = state;
  const fitsOneToOne = Math.max(source.width, source.height) <= state.size;
  const exact = state.palette === "new" && state.colors === "all" && sourceColors !== null && sourceColors <= MAX_COLORS
    && (state.fit === "actual" || state.sharp);

  function setSize(size: number) {
    const fits = Math.max(source.width, source.height) <= size;
    // 1:1 only works when the image fits; otherwise fall back to scaling.
    onChange({ ...state, size, fit: state.fit === "actual" && !fits ? "contain" : state.fit });
  }

  function chip(active: boolean) {
    return active ? { backgroundColor: "var(--color-dc-brand)", color: "#fff" } : buttonStyle;
  }

  return (
    <>
      <div className="text-xs uppercase font-bold" style={muted}>Import</div>

      <div className="flex gap-2 items-center">
        <div
          className="w-16 h-16 rounded flex items-center justify-center overflow-hidden flex-shrink-0"
          style={{ background: "repeating-conic-gradient(#3a3c42 0% 25%, #2e3035 0% 50%) 0 0 / 8px 8px" }}
        >
          {state.thumb && <img src={state.thumb} alt="Original" className="max-w-full max-h-full" style={{ imageRendering: "pixelated" }} />}
        </div>
        <div className="text-xs leading-snug" style={muted}>
          <div style={{ color: "var(--color-dc-text-normal)" }}>Original</div>
          {state.scale > 1
            ? <>Pixel art, {source.width}×{source.height} (saved at ×{state.scale})</>
            : <>{source.width}×{source.height}</>}
          {sourceColors !== null && <div>{sourceColors >= 4096 ? "4096+" : sourceColors} colors at this size</div>}
        </div>
      </div>

      <label className="flex items-center justify-between gap-2">
        <span className="text-xs" style={muted}>Canvas</span>
        <select value={state.size} onChange={(e) => setSize(Number(e.target.value))} className="rounded px-2 py-1 text-sm" style={buttonStyle} aria-label="Canvas size">
          {SIZES.map((s) => <option key={s} value={s}>{s}×{s}</option>)}
        </select>
      </label>

      <div className="flex flex-col gap-1">
        <span className="text-xs" style={muted}>Fit</span>
        <div className="flex gap-1" role="radiogroup" aria-label="Fit">
          {([["actual", "1:1"], ["contain", "Fit"], ["cover", "Crop"]] as const).map(([fit, label]) => (
            <button
              key={fit}
              role="radio"
              aria-checked={state.fit === fit}
              disabled={fit === "actual" && !fitsOneToOne}
              title={fit === "actual" ? (fitsOneToOne ? "One image pixel per canvas pixel" : "Image is bigger than the canvas") : fit === "contain" ? "Scale the whole image into the canvas" : "Fill the canvas, cropping the edges"}
              onClick={() => onChange({ ...state, fit })}
              className="flex-1 rounded py-1 text-xs disabled:opacity-40"
              style={chip(state.fit === fit)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {state.fit !== "actual" && (
        <div className="flex flex-col gap-1">
          <span className="text-xs" style={muted}>Scaling</span>
          <div className="flex gap-1" role="radiogroup" aria-label="Scaling">
            {([[true, "Sharp"], [false, "Smooth"]] as const).map(([sharp, label]) => (
              <button
                key={label}
                role="radio"
                aria-checked={state.sharp === sharp}
                title={sharp ? "Keeps hard pixel edges and the original colors (pixel art, logos)" : "Blends pixels when shrinking (photos, gradients)"}
                onClick={() => onChange({ ...state, sharp })}
                className="flex-1 rounded py-1 text-xs"
                style={chip(state.sharp === sharp)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <span className="text-xs" style={muted}>Colors</span>
        <div className="flex gap-1" role="radiogroup" aria-label="Colors">
          <button role="radio" aria-checked={state.palette === "new" && state.colors === "all"} onClick={() => onChange({ ...state, palette: "new", colors: "all" })} className="flex-1 rounded py-1 text-xs" style={chip(state.palette === "new" && state.colors === "all")} title={`Keep every color, up to ${MAX_COLORS}`}>
            All
          </button>
          <button role="radio" aria-checked={state.palette === "new" && state.colors !== "all"} onClick={() => onChange({ ...state, palette: "new", colors: Math.min(16, Math.max(2, (sourceColors ?? 16) - 1)) })} className="flex-1 rounded py-1 text-xs" style={chip(state.palette === "new" && state.colors !== "all")} title="Reduce to fewer colors for a more retro look">
            Fewer
          </button>
          <button role="radio" aria-checked={state.palette === "keep"} onClick={() => onChange({ ...state, palette: "keep" })} className="flex-1 rounded py-1 text-xs" style={chip(state.palette === "keep")} title="Use the colors already in your palette">
            Mine
          </button>
        </div>
        {state.palette === "new" && state.colors !== "all" && (
          <label className="flex items-center gap-2 text-xs" style={muted}>
            <input
              type="range"
              min={2}
              max={MAX_COLORS}
              value={state.colors}
              onChange={(e) => onChange({ ...state, colors: Number(e.target.value) })}
              className="flex-1 accent-[var(--color-dc-brand)]"
              aria-label="Number of colors"
            />
            <span className="w-5 text-right tabular-nums">{state.colors}</span>
          </label>
        )}
      </div>

      <p className="text-xs leading-snug" style={muted}>
        {exact
          ? "Exact copy: every pixel and color is kept."
          : resultColors !== null
            ? `Result uses ${resultColors} color${resultColors === 1 ? "" : "s"}${sourceColors !== null && sourceColors > MAX_COLORS && state.palette === "new" && state.colors === "all" ? ` (palette holds at most ${MAX_COLORS})` : ""}.`
            : ""}
      </p>
      <p className="text-[11px]" style={muted}>Only import images you have the right to use.</p>
      <div className="flex gap-1 mt-auto">
        <button onClick={onCancel} className="flex-1 rounded py-2" style={buttonStyle}>Cancel</button>
        <button onClick={onApply} className="flex-1 rounded py-2 font-medium text-white" style={{ backgroundColor: "var(--color-dc-brand)" }}>Apply</button>
      </div>
    </>
  );
}
