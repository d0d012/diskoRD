import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  MAX_BRUSH, MAX_COLORS, SIZES, TRANSPARENT, createArt, floodFill, isEmpty, linePoints, mirrorPoints, paint,
  pixelPerfect, rectPoints, resize, stampPoints, type Art, type Point,
} from "./lib/art";
import { decodeDoc, encodeDoc } from "./lib/doc";
import { renderImport, suggestImport, type ImportState, type Rgba } from "./lib/importImage";
import { artToPng, downloadBlob, drawArt, loadImageRgba, shareScale } from "./render";
import { Icon } from "./Icon";
import type { IconName } from "./iconPaths";

const HISTORY_LIMIT = 100;
const DRAFT_KEY = "diskord.pixelart.draft";
const MAX_IMPORT_BYTES = 8 * 1024 * 1024;
/** Zoom steps, relative to "whole canvas fits the view". */
const ZOOMS = [1, 1.5, 2, 3, 4, 6, 8, 12, 16];
/** Cells never get bigger than this when zooming in. */
const MAX_CELL_PX = 48;

type Tool = "pencil" | "eraser" | "fill" | "picker" | "line" | "rect";

const TOOLS: { id: Tool; label: string; key: string; icon: IconName }[] = [
  { id: "pencil", label: "Pencil", key: "b", icon: "pencil" },
  { id: "eraser", label: "Eraser", key: "e", icon: "eraser" },
  { id: "fill", label: "Fill", key: "g", icon: "fill" },
  { id: "picker", label: "Color picker", key: "i", icon: "picker" },
  { id: "line", label: "Line", key: "l", icon: "line" },
  { id: "rect", label: "Rectangle", key: "u", icon: "rect" },
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
  /** Opens the user's gallery (shown when provided). */
  onOpenGallery?: () => void;
  /** Saves the current art to the gallery (shown when provided). */
  onSaveToGallery?: (art: Art) => void;
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
export function PixelArtEditor({ onSend, onPlace, onOpenGallery, onSaveToGallery, onClose }: Props) {
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
  /** Space held or a pan in progress: shows the grab cursor. */
  const [panning, setPanning] = useState(false);
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
  const exportRef = useRef<HTMLDivElement>(null);
  const [exportOpen, setExportOpen] = useState(false);
  /** The art from before a Clear, while its undo toast is showing. */
  const [clearedFrom, setClearedFrom] = useState<Art | null>(null);

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
      setPanning(true);
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
    if (panRef.current) {
      panRef.current = null;
      setPanning(spaceRef.current);
    }
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

  function clearCanvas() {
    if (isEmpty(art)) return;
    setClearedFrom(art);
    commit(createArt(art.size, art.palette));
  }

  function undoClear() {
    undo();
    setClearedFrom(null);
  }

  // The clear toast goes away on its own, or as soon as the art changes again.
  useEffect(() => {
    if (!clearedFrom) return;
    const timer = setTimeout(() => setClearedFrom(null), 6000);
    return () => clearTimeout(timer);
  }, [clearedFrom]);

  // Close the export menu on any outside click.
  useEffect(() => {
    if (!exportOpen) return;
    function onDown(e: MouseEvent) {
      if (!exportRef.current?.contains(e.target as Node)) setExportOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [exportOpen]);

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
      if (e.key === " ") { e.preventDefault(); spaceRef.current = true; setPanning(true); return; }
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
      if (e.key === " ") {
        spaceRef.current = false;
        setPanning(false);
      }
    }
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKeyUp, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKeyUp, true);
    };
  }, []);

  // ── UI ───────────────────────────────────────────────────────────────────

  const brushTools = tool === "pencil" || tool === "eraser" || tool === "line" || tool === "rect";
  const hoverSpan = brushTools ? brush : 1;
  const hoverOffset = brushTools ? -Math.floor((brush - 1) / 2) : 0;
  const empty = isEmpty(art);
  const actionsDisabled = busy || empty || !!importing;

  return createPortal(
    <div
      className="fixed inset-0 z-[10002] flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.7)" }}
      role="dialog"
      aria-modal="true"
      aria-label="Pixel art"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="max-w-full max-h-full overflow-auto rounded-xl shadow-2xl flex flex-col"
        style={{ backgroundColor: "var(--color-dc-bg-primary)", border: "1px solid var(--color-dc-bg-modifier-selected)" }}
      >
        {/* Top bar */}
        <div className="flex items-center gap-1.5 px-4 py-2.5 border-b" style={{ borderColor: "var(--color-dc-bg-modifier-selected)" }}>
          <h3 className="text-[15px] font-semibold mr-1" style={{ color: "var(--color-dc-header-primary)" }}>Pixel art</h3>
          <select
            value={art.size}
            onChange={(e) => { commit(resize(art, Number(e.target.value))); setZoom(1); }}
            disabled={!!importing}
            aria-label="Canvas size"
            title="Canvas size"
            className="rounded-md px-2 py-1 text-xs cursor-pointer disabled:opacity-50"
            style={{ backgroundColor: "var(--color-dc-bg-secondary)", color: "var(--color-dc-text-normal)" }}
          >
            {SIZES.map((s) => <option key={s} value={s}>{s} × {s}</option>)}
          </select>
          <span className="w-px h-5 mx-1.5" style={{ backgroundColor: "var(--color-dc-bg-modifier-selected)" }} />
          <IconButton icon="undo" label="Undo" shortcut="Ctrl+Z" onClick={undo} disabled={!past.length} />
          <IconButton icon="redo" label="Redo" shortcut="Ctrl+Shift+Z" onClick={redo} disabled={!future.length} />
          <div className="flex-1" />
          <IconButton icon="gallery" label="My art" onClick={() => onOpenGallery?.()} hidden={!onOpenGallery} />
          <IconButton icon="save" label="Save to gallery" onClick={() => onSaveToGallery?.(art)} disabled={empty} hidden={!onSaveToGallery} />
          {(onOpenGallery || onSaveToGallery) && <span className="w-px h-5 mx-1.5" style={{ backgroundColor: "var(--color-dc-bg-modifier-selected)" }} />}
          <TextButton label="−" ariaLabel="Zoom out" title="Zoom out (−)" onClick={() => zoomStep(-1)} disabled={zoom <= 1} />
          <button onClick={() => setZoom(1)} title="Fit to view (0)" className="px-1.5 h-7 rounded-md text-xs tabular-nums min-w-12 hover:bg-[var(--color-dc-bg-modifier-hover)]" style={{ color: "var(--color-dc-text-muted)" }}>
            {Math.round(Math.min(zoom, maxZoom) * 100)}%
          </button>
          <TextButton label="+" ariaLabel="Zoom in" title="Zoom in (+, Ctrl/⌘ + wheel)" onClick={() => zoomStep(1)} disabled={zoom >= maxZoom} />
          <span className="w-px h-5 mx-1.5" style={{ backgroundColor: "var(--color-dc-bg-modifier-selected)" }} />
          <IconButton icon="close" label="Close" shortcut="Esc" onClick={onClose} />
        </div>

        <div className="flex gap-4 p-4 flex-wrap">
          {/* Tool rail */}
          <div className="flex flex-col gap-1 p-1 rounded-lg self-start" role="toolbar" aria-label="Tools" style={{ backgroundColor: "var(--color-dc-bg-secondary)" }}>
            {TOOLS.map((t) => (
              <RailButton key={t.id} icon={t.icon} label={t.label} hint={t.key.toUpperCase()} active={tool === t.id} onClick={() => setTool(t.id)} />
            ))}
            <span className="h-px mx-1 my-1" style={{ backgroundColor: "var(--color-dc-bg-modifier-selected)" }} />
            <RailButton icon="mirror" label="Mirror" hint="M" active={mirror} onClick={() => setMirror((m) => !m)} />
            <RailButton icon="grid" label="Grid" active={grid} onClick={() => setGrid((g) => !g)} />
          </div>

          {/* Canvas */}
          <div className="flex flex-col gap-1.5">
            <div
              ref={viewportRef}
              className="flex overflow-auto rounded-lg"
              style={{ width: view, height: view, backgroundColor: "var(--color-dc-bg-tertiary)" }}
            >
              <div
                ref={contentRef}
                className="relative touch-none select-none flex-shrink-0 m-auto"
                style={{
                  width: contentPx,
                  height: contentPx,
                  cursor: panning ? "grab" : importing ? "default" : "crosshair",
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
                {empty && !importing && !hover && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 pointer-events-none" style={{ color: "var(--color-dc-text-muted)" }}>
                    <Icon name="brush" size={26} />
                    <span className="text-sm">Start drawing, or import an image</span>
                  </div>
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
            <div className="flex items-center gap-3 text-[11px] tabular-nums px-0.5" style={{ width: view, color: "var(--color-dc-text-muted)" }}>
              <span className="flex-shrink-0">{hover ? `${hover[0]}, ${hover[1]}` : `${size} × ${size}`}</span>
              <span className="ml-auto truncate" title="Right-click erases · Space + drag pans · [ ] brush size">
                Right-click erases · Space + drag pans · [ ] brush size
              </span>
            </div>
          </div>

          {/* Side panel */}
          <div className="w-52 flex flex-col gap-4 text-sm" style={{ color: "var(--color-dc-text-normal)" }}>
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
                <Section title="Color" aside={`${art.palette.length}/${MAX_COLORS}`}>
                  <label className="flex items-center gap-2.5 mb-2.5 cursor-pointer" title="Edit selected color">
                    <span
                      className="relative w-10 h-10 rounded-lg overflow-hidden flex-shrink-0"
                      style={{ backgroundColor: art.palette[color - 1], boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.15)" }}
                    >
                      <input
                        type="color"
                        value={art.palette[color - 1] ?? "#000000"}
                        onChange={(e) => setSwatch(e.target.value)}
                        className="absolute inset-0 opacity-0 cursor-pointer"
                        aria-label="Edit selected color"
                      />
                    </span>
                    <span className="flex flex-col leading-tight">
                      <span className="font-mono text-xs">{art.palette[color - 1]}</span>
                      <span className="text-[11px]" style={{ color: "var(--color-dc-text-muted)" }}>Click to edit</span>
                    </span>
                  </label>
                  <div className="grid grid-cols-8 gap-1 max-h-36 overflow-y-auto p-0.5" role="radiogroup" aria-label="Palette">
                    {art.palette.map((c, i) => (
                      <button
                        key={i}
                        role="radio"
                        aria-checked={color === i + 1}
                        aria-label={`Color ${c}`}
                        title={c}
                        onClick={() => { setColor(i + 1); if (tool === "eraser" || tool === "picker") setTool("pencil"); }}
                        className="w-5 h-5 rounded"
                        style={{ backgroundColor: c, outline: color === i + 1 ? "2px solid #fff" : "1px solid rgba(0,0,0,0.35)", outlineOffset: color === i + 1 ? 1 : 0 }}
                      />
                    ))}
                    {art.palette.length < MAX_COLORS && (
                      <button
                        onClick={addSwatch}
                        aria-label="Add color"
                        title="Add color"
                        className="w-5 h-5 rounded text-xs leading-none hover:bg-[var(--color-dc-bg-modifier-hover)]"
                        style={{ border: "1px dashed var(--color-dc-text-muted)", color: "var(--color-dc-text-muted)" }}
                      >
                        +
                      </button>
                    )}
                  </div>
                </Section>

                {brushTools && (
                  <Section title="Brush" aside="[ ]">
                    <div className="flex gap-1" role="radiogroup" aria-label="Brush size">
                      {Array.from({ length: MAX_BRUSH }, (_, i) => i + 1).map((b) => (
                        <button
                          key={b}
                          role="radio"
                          aria-checked={brush === b}
                          aria-label={`Brush ${b}`}
                          onClick={() => setBrush(b)}
                          className="w-9 h-9 rounded-md flex items-center justify-center hover:bg-[var(--color-dc-bg-modifier-hover)]"
                          style={brush === b ? { backgroundColor: "var(--color-dc-brand)", color: "#fff" } : { color: "var(--color-dc-interactive-normal)" }}
                        >
                          <span style={{ width: 2 + b * 3, height: 2 + b * 3, backgroundColor: "currentColor" }} />
                        </button>
                      ))}
                    </div>
                  </Section>
                )}

                <Section title="File">
                  <input ref={fileRef} type="file" accept="image/*,.json" className="hidden" onChange={handleImportFile} />
                  <div className="flex gap-1.5">
                    <PanelButton icon="upload" label="Import" title="Import an image or a .pixel.json file" onClick={() => fileRef.current?.click()} />
                    <div className="relative flex-1" ref={exportRef}>
                      <PanelButton icon="download" label="Export" title="Download your art" onClick={() => setExportOpen((o) => !o)} trailing="chevronDown" />
                      {exportOpen && (
                        <div
                          role="menu"
                          className="absolute left-0 right-0 top-full mt-1 z-10 rounded-md py-1 shadow-xl text-xs"
                          style={{ backgroundColor: "var(--color-dc-bg-floating)" }}
                        >
                          {([
                            ["PNG, original size", () => exportPng(1)],
                            [`PNG, ${art.size * shareScale(art)}px`, () => exportPng(shareScale(art))],
                            ["Editable .pixel.json", exportDoc],
                          ] as const).map(([label, run]) => (
                            <button
                              key={label}
                              role="menuitem"
                              onClick={() => { setExportOpen(false); void run(); }}
                              className="w-full text-left px-2.5 py-1.5 hover:bg-[var(--color-dc-brand)] hover:text-white"
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </Section>
              </>
            )}
            {error && <p className="text-xs" style={{ color: "var(--color-dc-red, #ed4245)" }}>{error}</p>}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center gap-2 px-4 py-3 border-t flex-wrap" style={{ borderColor: "var(--color-dc-bg-modifier-selected)" }}>
          <button
            onClick={clearCanvas}
            disabled={empty || !!importing}
            className="flex items-center gap-1.5 px-2.5 h-8 rounded-md text-xs font-medium disabled:opacity-40 hover:bg-[rgba(237,66,69,0.12)]"
            style={{ color: "var(--color-dc-red, #ed4245)" }}
          >
            <Icon name="trash" size={16} />
            Clear canvas
          </button>
          {clearedFrom && (
            <span className="flex items-center gap-2 text-xs px-2.5 h-8 rounded-md" role="status" style={{ backgroundColor: "var(--color-dc-bg-secondary)", color: "var(--color-dc-text-normal)" }}>
              Canvas cleared
              <button onClick={undoClear} className="font-medium hover:underline" style={{ color: "var(--color-dc-text-link, #00a8fc)" }}>Undo</button>
            </span>
          )}
          <div className="flex-1" />
          {onPlace && (
            <ActionButton
              icon="sticker"
              title="Stick in chat"
              subtitle="Behind messages, like a sticker"
              onClick={() => onPlace(art)}
              disabled={actionsDisabled}
              primary={!onSend}
            />
          )}
          {onSend && (
            <ActionButton
              icon="send"
              title={busy ? "Sending…" : "Send as message"}
              subtitle="Posts it as an image"
              onClick={send}
              disabled={actionsDisabled}
              primary
            />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Section({ title, aside, children }: { title: string; aside?: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-baseline justify-between mb-2">
        <h4 className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--color-dc-text-muted)" }}>{title}</h4>
        {aside && <span className="text-[11px] tabular-nums" style={{ color: "var(--color-dc-text-muted)" }}>{aside}</span>}
      </div>
      {children}
    </section>
  );
}

function IconButton({ icon, label, shortcut, onClick, disabled, hidden }: {
  icon: IconName;
  label: string;
  shortcut?: string;
  onClick: () => void;
  disabled?: boolean;
  hidden?: boolean;
}) {
  if (hidden) return null;
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={shortcut ? `${label} (${shortcut})` : label}
      className="w-8 h-8 rounded-md flex items-center justify-center hover:bg-[var(--color-dc-bg-modifier-hover)] disabled:opacity-35 disabled:hover:bg-transparent"
      style={{ color: "var(--color-dc-interactive-normal)" }}
    >
      <Icon name={icon} />
    </button>
  );
}

function TextButton({ label, ariaLabel, title, onClick, disabled }: {
  label: string;
  ariaLabel: string;
  title: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      title={title}
      className="w-7 h-7 rounded-md text-base leading-none hover:bg-[var(--color-dc-bg-modifier-hover)] disabled:opacity-35 disabled:hover:bg-transparent"
      style={{ color: "var(--color-dc-interactive-normal)" }}
    >
      {label}
    </button>
  );
}

function RailButton({ icon, label, hint, active, onClick }: {
  icon: IconName;
  label: string;
  hint?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={hint ? `${label} (${hint})` : label}
      aria-label={label}
      aria-pressed={active}
      className={`relative w-9 h-9 rounded-md flex items-center justify-center transition-colors ${active ? "" : "hover:bg-[var(--color-dc-bg-modifier-hover)]"}`}
      style={active ? { backgroundColor: "var(--color-dc-brand)", color: "#fff" } : { color: "var(--color-dc-interactive-normal)" }}
    >
      <Icon name={icon} />
      {hint && <span className="absolute right-0.5 bottom-0 text-[9px] font-semibold leading-none opacity-60">{hint}</span>}
    </button>
  );
}

function PanelButton({ icon, label, title, onClick, trailing }: {
  icon: IconName;
  label: string;
  title: string;
  onClick: () => void;
  trailing?: IconName;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="w-full flex items-center justify-center gap-1.5 h-8 rounded-md text-xs font-medium hover:brightness-110"
      style={{ backgroundColor: "var(--color-dc-bg-secondary)", color: "var(--color-dc-text-normal)" }}
    >
      <Icon name={icon} size={16} />
      {label}
      {trailing && <Icon name={trailing} size={14} />}
    </button>
  );
}

function ActionButton({ icon, title, subtitle, onClick, disabled, primary }: {
  icon: IconName;
  title: string;
  subtitle: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={title}
      className="flex items-center gap-2.5 pl-3 pr-4 py-1.5 rounded-lg text-left transition-[filter] hover:brightness-110 disabled:opacity-45 disabled:hover:brightness-100"
      style={primary
        ? { backgroundColor: "var(--color-dc-brand)", color: "#fff" }
        : { backgroundColor: "var(--color-dc-bg-secondary)", color: "var(--color-dc-text-normal)", boxShadow: "inset 0 0 0 1px var(--color-dc-bg-modifier-selected)" }}
    >
      <Icon name={icon} size={20} />
      <span className="flex flex-col leading-tight">
        <span className="text-sm font-medium">{title}</span>
        <span className="text-[11px]" style={{ opacity: 0.75 }}>{subtitle}</span>
      </span>
    </button>
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
