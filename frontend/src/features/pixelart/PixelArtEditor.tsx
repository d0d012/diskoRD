import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  MAX_COLORS, SIZES, TRANSPARENT, createArt, floodFill, isEmpty, linePoints, mirrorPoints, paint,
  pixelPerfect, rectPoints, resize, type Art, type Point,
} from "./lib/art";
import { decodeDoc, encodeDoc } from "./lib/doc";
import { downscale, quantizeNewPalette, quantizeToPalette, type Fit, type Rgba } from "./lib/importImage";
import { artToPng, downloadBlob, drawArt, loadImageRgba, shareScale } from "./render";

const DISPLAY = 448; // px; divisible by every canvas size
const HISTORY_LIMIT = 100;
const DRAFT_KEY = "diskord.pixelart.draft";
const MAX_IMPORT_BYTES = 8 * 1024 * 1024;

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

interface ImportState {
  rgba: Rgba;
  fit: Fit;
  palette: "keep" | "new";
  colors: number;
}

interface Props {
  onSend: (file: File) => Promise<void>;
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
    // Storage blocked; the draft just isn't kept.
  }
}

/** Small indexed-color pixel art editor: draw, import, export and send to a channel. */
export function PixelArtEditor({ onSend, onClose }: Props) {
  const [art, setArt] = useState<Art>(loadDraft);
  const [past, setPast] = useState<Art[]>([]);
  const [future, setFuture] = useState<Art[]>([]);
  const [tool, setTool] = useState<Tool>("pencil");
  const [color, setColor] = useState(1);
  const [mirror, setMirror] = useState(false);
  const [grid, setGrid] = useState(true);
  const [importing, setImporting] = useState<ImportState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokeRef = useRef<Stroke | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const preview = useMemo(() => {
    if (!importing) return null;
    const rgba = downscale(importing.rgba, art.size, importing.fit);
    return importing.palette === "keep"
      ? quantizeToPalette(rgba, art.size, art.palette)
      : quantizeNewPalette(rgba, art.size, importing.colors);
  }, [importing, art.size, art.palette]);

  const shown = preview ?? art;

  useEffect(() => {
    if (canvasRef.current) drawArt(canvasRef.current, shown);
  }, [shown]);

  useEffect(() => {
    if (!strokeRef.current) saveDraft(art);
  }, [art]);

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

  // ── Drawing ──────────────────────────────────────────────────────────────

  function cellAt(e: React.PointerEvent): Point {
    const rect = e.currentTarget.getBoundingClientRect();
    return [
      Math.floor(((e.clientX - rect.left) / rect.width) * art.size),
      Math.floor(((e.clientY - rect.top) / rect.height) * art.size),
    ];
  }

  /** Re-applies the whole stroke on top of the snapshot taken at pointer down. */
  function renderStroke(stroke: Stroke): Art {
    let points: Point[];
    if (stroke.tool === "line") points = linePoints(...stroke.start, ...stroke.points[stroke.points.length - 1]);
    else if (stroke.tool === "rect") points = rectPoints(...stroke.start, ...stroke.points[stroke.points.length - 1]);
    else if (stroke.value === TRANSPARENT) points = stroke.points;
    else points = pixelPerfect(stroke.points);
    return paint(stroke.before, mirror ? mirrorPoints(points, art.size) : points, stroke.value);
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
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
    const stroke = strokeRef.current;
    if (!stroke) return;
    const cell = cellAt(e);
    const last = stroke.points[stroke.points.length - 1];
    if (last[0] === cell[0] && last[1] === cell[1]) return;
    // Fill the gap between pointer samples so fast strokes stay connected.
    if (stroke.tool === "pencil") stroke.points.push(...linePoints(...last, ...cell).slice(1));
    else stroke.points.push(cell);
    setArt(renderStroke(stroke));
  }

  function handlePointerUp() {
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
        const imported = decodeDoc(JSON.parse(await file.text()));
        commit(imported);
        setColor(1);
        return;
      }
      setImporting({ rgba: await loadImageRgba(file), fit: "contain", palette: "new", colors: 16 });
    } catch (err) {
      showError(err instanceof Error && err.message.length < 60 ? err.message : "Could not read that file.");
    }
  }

  function applyImport() {
    if (!preview) return;
    commit(preview);
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
    if (busy || isEmpty(art)) return;
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

  const latest = useRef({ onClose, undo, redo, importing, setImporting });
  latest.current = { onClose, undo, redo, importing, setImporting };
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const l = latest.current;
      if (e.key === "Escape") {
        e.stopPropagation();
        if (l.importing) l.setImporting(null);
        else l.onClose();
        return;
      }
      if (e.target instanceof HTMLInputElement) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && key === "z") { e.preventDefault(); if (e.shiftKey) l.redo(); else l.undo(); return; }
      if (mod && key === "y") { e.preventDefault(); l.redo(); return; }
      if (mod) return;
      const match = TOOLS.find((t) => t.key === key);
      if (match) setTool(match.id);
      else if (key === "m") setMirror((m) => !m);
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // ── UI ───────────────────────────────────────────────────────────────────

  const cell = DISPLAY / art.size;
  const buttonStyle = { backgroundColor: "var(--color-dc-bg-secondary)", color: "var(--color-dc-text-normal)" };

  return createPortal(
    <div
      className="fixed inset-0 z-[10002] flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.7)" }}
      role="dialog"
      aria-modal="true"
      aria-label="Pixel art"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="max-w-full max-h-full overflow-auto rounded-lg shadow-2xl p-5" style={{ backgroundColor: "var(--color-dc-bg-primary)" }}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold" style={{ color: "var(--color-dc-header-primary)" }}>Pixel art</h3>
          <button onClick={onClose} aria-label="Close" className="p-1 rounded hover:bg-[var(--color-dc-bg-modifier-hover)]" style={{ color: "var(--color-dc-interactive-normal)" }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M18.3 5.71 12 12l6.3 6.29-1.41 1.42L10.59 13.4 4.29 19.7 2.88 18.3 9.17 12 2.88 5.71 4.29 4.3l6.3 6.29 6.29-6.3z" />
            </svg>
          </button>
        </div>

        <div className="flex gap-4 flex-wrap">
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
                style={{
                  backgroundColor: tool === t.id ? "var(--color-dc-brand)" : "var(--color-dc-bg-secondary)",
                  color: tool === t.id ? "#fff" : "var(--color-dc-interactive-normal)",
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d={t.icon} /></svg>
              </button>
            ))}
            <div className="h-px my-1" style={{ backgroundColor: "var(--color-dc-bg-modifier-selected)" }} />
            <button
              onClick={() => setMirror((m) => !m)}
              title="Mirror horizontally (M)"
              aria-label="Mirror"
              aria-pressed={mirror}
              className="w-9 h-9 rounded text-xs font-bold"
              style={{ backgroundColor: mirror ? "var(--color-dc-brand)" : "var(--color-dc-bg-secondary)", color: mirror ? "#fff" : "var(--color-dc-interactive-normal)" }}
            >
              ⇋
            </button>
            <button
              onClick={() => setGrid((g) => !g)}
              title="Show grid"
              aria-label="Grid"
              aria-pressed={grid}
              className="w-9 h-9 rounded text-xs font-bold"
              style={{ backgroundColor: grid ? "var(--color-dc-brand)" : "var(--color-dc-bg-secondary)", color: grid ? "#fff" : "var(--color-dc-interactive-normal)" }}
            >
              #
            </button>
          </div>

          {/* Canvas */}
          <div
            className="relative touch-none select-none rounded overflow-hidden"
            style={{
              width: DISPLAY,
              height: DISPLAY,
              cursor: importing ? "default" : "crosshair",
              background: "repeating-conic-gradient(#3a3c42 0% 25%, #2e3035 0% 50%) 0 0 / 16px 16px",
            }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onContextMenu={(e) => e.preventDefault()}
            data-testid="pixel-canvas"
          >
            <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" style={{ imageRendering: "pixelated" }} />
            {grid && cell >= 7 && (
              <div
                className="absolute inset-0 pointer-events-none"
                style={{
                  backgroundImage: "linear-gradient(to right, rgba(255,255,255,0.07) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.07) 1px, transparent 1px)",
                  backgroundSize: `${cell}px ${cell}px`,
                }}
              />
            )}
          </div>

          {/* Side panel */}
          <div className="w-48 flex flex-col gap-3 text-sm" style={{ color: "var(--color-dc-text-normal)" }}>
            {importing ? (
              <ImportOptions state={importing} onChange={setImporting} onApply={applyImport} onCancel={() => setImporting(null)} />
            ) : (
              <>
                <label className="flex items-center justify-between gap-2">
                  <span className="text-xs uppercase font-bold" style={{ color: "var(--color-dc-text-muted)" }}>Size</span>
                  <select
                    value={art.size}
                    onChange={(e) => commit(resize(art, Number(e.target.value)))}
                    className="rounded px-2 py-1 text-sm"
                    style={buttonStyle}
                  >
                    {SIZES.map((s) => <option key={s} value={s}>{s}×{s}</option>)}
                  </select>
                </label>

                <div>
                  <div className="text-xs uppercase font-bold mb-1" style={{ color: "var(--color-dc-text-muted)" }}>Palette</div>
                  <div className="grid grid-cols-8 gap-1" role="radiogroup" aria-label="Palette">
                    {art.palette.map((c, i) => (
                      <button
                        key={i}
                        role="radio"
                        aria-checked={color === i + 1}
                        aria-label={`Color ${c}`}
                        onClick={() => { setColor(i + 1); if (tool === "eraser" || tool === "picker") setTool("pencil"); }}
                        className="w-5 h-5 rounded-sm"
                        style={{ backgroundColor: c, outline: color === i + 1 ? "2px solid #fff" : "1px solid rgba(0,0,0,0.4)", outlineOffset: color === i + 1 ? 1 : 0 }}
                      />
                    ))}
                    {art.palette.length < MAX_COLORS && (
                      <button onClick={addSwatch} aria-label="Add color" title="Add color" className="w-5 h-5 rounded-sm text-xs leading-none" style={buttonStyle}>+</button>
                    )}
                  </div>
                  <label className="flex items-center gap-2 mt-2 text-xs" style={{ color: "var(--color-dc-text-muted)" }}>
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

                <button
                  onClick={send}
                  disabled={busy || isEmpty(art)}
                  className="mt-auto rounded py-2 font-medium text-white disabled:opacity-50"
                  style={{ backgroundColor: "var(--color-dc-brand)" }}
                >
                  {busy ? "Sending…" : "Send to chat"}
                </button>
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

function ImportOptions({ state, onChange, onApply, onCancel }: {
  state: ImportState;
  onChange: (s: ImportState) => void;
  onApply: () => void;
  onCancel: () => void;
}) {
  const muted = { color: "var(--color-dc-text-muted)" };
  const buttonStyle = { backgroundColor: "var(--color-dc-bg-secondary)", color: "var(--color-dc-text-normal)" };
  return (
    <>
      <div className="text-xs uppercase font-bold" style={muted}>Import preview</div>
      <fieldset className="flex flex-col gap-1">
        <legend className="text-xs mb-1" style={muted}>Fit</legend>
        {(["contain", "cover"] as const).map((fit) => (
          <label key={fit} className="flex items-center gap-2">
            <input type="radio" name="fit" checked={state.fit === fit} onChange={() => onChange({ ...state, fit })} />
            {fit === "contain" ? "Fit whole image" : "Crop to square"}
          </label>
        ))}
      </fieldset>
      <fieldset className="flex flex-col gap-1">
        <legend className="text-xs mb-1" style={muted}>Colors</legend>
        <label className="flex items-center gap-2">
          <input type="radio" name="palette" checked={state.palette === "new"} onChange={() => onChange({ ...state, palette: "new" })} />
          New palette from image
        </label>
        {state.palette === "new" && (
          <label className="flex items-center gap-2 pl-5 text-xs" style={muted}>
            <input
              type="range"
              min={2}
              max={MAX_COLORS}
              value={state.colors}
              onChange={(e) => onChange({ ...state, colors: Number(e.target.value) })}
              className="flex-1 accent-[var(--color-dc-brand)]"
              aria-label="Number of colors"
            />
            {state.colors}
          </label>
        )}
        <label className="flex items-center gap-2">
          <input type="radio" name="palette" checked={state.palette === "keep"} onChange={() => onChange({ ...state, palette: "keep" })} />
          Keep my palette
        </label>
      </fieldset>
      <p className="text-xs" style={muted}>Only import images you have the right to use.</p>
      <div className="flex gap-1 mt-auto">
        <button onClick={onCancel} className="flex-1 rounded py-2" style={buttonStyle}>Cancel</button>
        <button onClick={onApply} className="flex-1 rounded py-2 font-medium text-white" style={{ backgroundColor: "var(--color-dc-brand)" }}>Apply</button>
      </div>
    </>
  );
}
