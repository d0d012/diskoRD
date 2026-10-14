import { useRef, useState } from "react";
import { MAX_SOUND_SECONDS, PEAK_RESOLUTION } from "../../lib/soundboardUpload";
import { clampSelection, formatClipTime } from "./soundClip";

/** Main waveform window; longer files also get an overview strip. */
const VIEW_SECONDS = 45;
const BARS = 96;
const OVERVIEW_BARS = 72;

interface Props {
  duration: number;
  /** Peaks at PEAK_RESOLUTION seconds per bucket (see computePeaks). */
  peaks: Float32Array;
  start: number;
  end: number;
  onChange: (start: number, end: number) => void;
  /** Current preview position in seconds, or null when not playing. */
  playhead?: number | null;
  disabled?: boolean;
}

type DragMode = "start" | "end" | "move" | "overview";

/** Downsamples peaks covering [from, to) seconds into `count` bars (0..1). */
function bars(peaks: Float32Array, from: number, to: number, count: number): number[] {
  const out: number[] = [];
  const span = (to - from) / count;
  for (let i = 0; i < count; i++) {
    const a = Math.floor((from + i * span) / PEAK_RESOLUTION);
    const b = Math.max(a + 1, Math.floor((from + (i + 1) * span) / PEAK_RESOLUTION));
    let peak = 0;
    for (let j = a; j < b && j < peaks.length; j++) peak = Math.max(peak, peaks[j]);
    out.push(peak);
  }
  const loudest = Math.max(...out, 0.0001);
  return out.map((v) => v / loudest);
}

/** Discord-style clip picker: drag the edges to trim, drag the middle to move. */
export function SoundTrimmer({ duration, peaks, start, end, onChange, playhead = null, disabled }: Props) {
  const view = Math.min(VIEW_SECONDS, duration);
  const hasOverview = duration > VIEW_SECONDS;
  const [viewStart, setViewStart] = useState(0);
  const mainRef = useRef<HTMLDivElement>(null);
  const overviewRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: DragMode; x: number; start: number; end: number } | null>(null);

  // Keep the selection visible in the main window (adjusting state during render).
  if (hasOverview && (start < viewStart || end > viewStart + view)) {
    const centered = (start + end) / 2 - view / 2;
    setViewStart(Math.min(Math.max(0, centered), duration - view));
  }

  const pct = (t: number) => `${((t - viewStart) / view) * 100}%`;
  const overviewPct = (t: number) => `${(t / duration) * 100}%`;

  function apply(mode: "start" | "end" | "move", s: number, e: number) {
    const [ns, ne] = clampSelection(mode, s, e, duration);
    if (ns !== start || ne !== end) onChange(ns, ne);
  }

  function onPointerDown(mode: DragMode, e: React.PointerEvent) {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (mode === "overview" && overviewRef.current) {
      // Jump the selection so it is centered where the strip was pressed.
      const rect = overviewRef.current.getBoundingClientRect();
      const at = ((e.clientX - rect.left) / rect.width) * duration;
      const length = end - start;
      const [ns, ne] = clampSelection("move", at - length / 2, at + length / 2, duration);
      onChange(ns, ne);
      drag.current = { mode, x: e.clientX, start: ns, end: ne };
      return;
    }
    drag.current = { mode, x: e.clientX, start, end };
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const overview = d.mode === "overview";
    const el = overview ? overviewRef.current : mainRef.current;
    if (!el) return;
    const seconds = ((e.clientX - d.x) / el.getBoundingClientRect().width) * (overview ? duration : view);
    if (d.mode === "start") apply("start", d.start + seconds, d.end);
    else if (d.mode === "end") apply("end", d.start, d.end + seconds);
    else apply("move", d.start + seconds, d.end + seconds);
  }

  function onPointerUp() {
    drag.current = null;
  }

  function onKey(mode: "start" | "end" | "move", e: React.KeyboardEvent) {
    if (disabled) return;
    const step = e.shiftKey ? 1 : 0.1;
    const delta = e.key === "ArrowLeft" || e.key === "ArrowDown" ? -step : e.key === "ArrowRight" || e.key === "ArrowUp" ? step : 0;
    if (!delta) return;
    e.preventDefault();
    if (mode === "start") apply("start", start + delta, end);
    else if (mode === "end") apply("end", start, end + delta);
    else apply("move", start + delta, end + delta);
  }

  const mainBars = bars(peaks, viewStart, viewStart + view, BARS);
  const overviewBars = hasOverview ? bars(peaks, 0, duration, OVERVIEW_BARS) : [];
  const length = end - start;
  const handle = "absolute top-0 bottom-0 w-3 -ml-1.5 flex items-center justify-center cursor-ew-resize focus:outline-none group";

  return (
    <div className={`flex flex-col gap-1.5 select-none ${disabled ? "opacity-60" : ""}`}>
      {hasOverview && (
        <div
          ref={overviewRef}
          className="relative h-5 rounded bg-black/30 overflow-hidden cursor-pointer touch-none"
          onPointerDown={(e) => onPointerDown("overview", e)}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          aria-hidden="true"
        >
          <div className="absolute inset-0 flex items-center gap-px px-px">
            {overviewBars.map((v, i) => (
              <span key={i} className="flex-1 rounded-full bg-white/25" style={{ height: `${Math.max(8, v * 100)}%` }} />
            ))}
          </div>
          <div className="absolute top-0 bottom-0 border border-white/30 rounded-sm" style={{ left: overviewPct(viewStart), width: overviewPct(view) }} />
          <div className="absolute top-0 bottom-0 bg-[var(--color-dc-brand)]/60" style={{ left: overviewPct(start), width: overviewPct(length) }} />
        </div>
      )}

      <div
        ref={mainRef}
        className="relative h-16 rounded bg-black/30 overflow-hidden touch-none"
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="absolute inset-0 flex items-center gap-px px-px" aria-hidden="true">
          {mainBars.map((v, i) => {
            const t = viewStart + ((i + 0.5) / BARS) * view;
            const inside = t >= start && t <= end;
            return (
              <span
                key={i}
                className="flex-1 rounded-full"
                style={{ height: `${Math.max(6, v * 90)}%`, backgroundColor: inside ? "var(--color-dc-brand, #5865f2)" : "rgba(255,255,255,0.22)" }}
              />
            );
          })}
        </div>

        {/* Selection body */}
        <div
          role="group"
          tabIndex={disabled ? -1 : 0}
          aria-label={`Selected clip, ${formatClipTime(start)} to ${formatClipTime(end)}. Use arrow keys to move it.`}
          className="absolute top-0 bottom-0 border-y-2 border-[var(--color-dc-brand)] bg-[var(--color-dc-brand)]/10 cursor-grab active:cursor-grabbing focus:outline-none focus-visible:bg-[var(--color-dc-brand)]/20"
          style={{ left: pct(start), width: `${(length / view) * 100}%` }}
          onPointerDown={(e) => onPointerDown("move", e)}
          onKeyDown={(e) => onKey("move", e)}
        />

        {playhead !== null && playhead >= viewStart && playhead <= viewStart + view && (
          <div className="absolute top-0 bottom-0 w-0.5 bg-white pointer-events-none" style={{ left: pct(playhead) }} aria-hidden="true" />
        )}

        {(["start", "end"] as const).map((edge) => (
          <div
            key={edge}
            role="slider"
            tabIndex={disabled ? -1 : 0}
            aria-label={edge === "start" ? "Clip start" : "Clip end"}
            aria-valuemin={0}
            aria-valuemax={Math.round(duration * 10) / 10}
            aria-valuenow={Math.round((edge === "start" ? start : end) * 10) / 10}
            aria-valuetext={formatClipTime(edge === "start" ? start : end)}
            className={handle}
            style={{ left: pct(edge === "start" ? start : end) }}
            onPointerDown={(e) => onPointerDown(edge, e)}
            onKeyDown={(e) => onKey(edge, e)}
          >
            <span className="h-full w-1.5 rounded-sm bg-[var(--color-dc-brand)] group-focus-visible:ring-2 group-focus-visible:ring-white" />
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between text-[11px] tabular-nums opacity-80">
        <span>{formatClipTime(start)} – {formatClipTime(end)}</span>
        <span className={length >= MAX_SOUND_SECONDS - 0.05 ? "font-semibold" : ""}>
          {length.toFixed(1)}s / {MAX_SOUND_SECONDS}s
        </span>
      </div>
    </div>
  );
}
