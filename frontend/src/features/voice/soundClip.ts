import { MAX_SOUND_SECONDS } from "../../lib/soundboardUpload";

const MIN_CLIP_SECONDS = 0.2;

export function formatClipTime(seconds: number): string {
  const tenths = Math.max(0, Math.round(seconds * 10));
  const m = Math.floor(tenths / 600);
  const s = Math.floor((tenths % 600) / 10);
  return `${m}:${String(s).padStart(2, "0")}.${tenths % 10}`;
}

/** Keeps a selection inside the file and between MIN_CLIP_SECONDS and MAX_SOUND_SECONDS long. */
export function clampSelection(mode: "start" | "end" | "move", start: number, end: number, duration: number): [number, number] {
  const max = Math.min(MAX_SOUND_SECONDS, duration);
  const min = Math.min(MIN_CLIP_SECONDS, duration);
  if (mode === "move") {
    const length = Math.min(Math.max(end - start, min), max);
    const s = Math.min(Math.max(0, start), duration - length);
    return [s, s + length];
  }
  if (mode === "start") {
    const s = Math.min(Math.max(start, end - max, 0), end - min);
    return [s, end];
  }
  const e = Math.max(Math.min(end, start + max, duration), start + min);
  return [start, e];
}
