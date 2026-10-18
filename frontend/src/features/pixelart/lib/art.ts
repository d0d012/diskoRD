/**
 * Pixel art in indexed color: each pixel is 0 (transparent) or 1..palette.length,
 * pointing at palette[value - 1]. Arts are treated as immutable snapshots so the
 * undo history can keep them by reference.
 */
export interface Art {
  width: number;
  height: number;
  palette: string[];
  pixels: Uint8Array;
}

/** Square canvas sides. */
export const SIZES = [16, 32, 64, 128, 256] as const;

/** Canvas shapes the editor offers and the server accepts. */
export interface CanvasPreset {
  width: number;
  height: number;
  label: string;
  /** Banners fill the 300×96 profile banner at an exact zoom. */
  banner?: { zoom: number };
}

export const CANVAS_PRESETS: CanvasPreset[] = [
  ...SIZES.map((s) => ({ width: s, height: s, label: `${s} × ${s}` })),
  { width: 100, height: 32, label: "Banner · 100 × 32", banner: { zoom: 3 } },
  { width: 150, height: 48, label: "Banner, detailed · 150 × 48", banner: { zoom: 2 } },
];

export function findPreset(width: number, height: number): CanvasPreset | undefined {
  return CANVAS_PRESETS.find((p) => p.width === width && p.height === height);
}

export function presetKey(p: { width: number; height: number }): string {
  return `${p.width}x${p.height}`;
}
/** Pixels are stored as bytes, so up to 255 would fit; 64 keeps the palette UI usable. */
export const MAX_COLORS = 64;
export const MAX_BRUSH = 4;
export const TRANSPARENT = 0;

/** Our own 16-color starter palette. */
export const DEFAULT_PALETTE = [
  "#000000", "#ffffff", "#7f7f7f", "#c3c3c3",
  "#e53935", "#ff8a65", "#fdd835", "#ffcc80",
  "#43a047", "#a5d6a7", "#1e88e5", "#90caf9",
  "#8e24aa", "#f48fb1", "#8d6e63", "#3e2723",
];

export type Point = readonly [number, number];

export function createArt(width = 32, height = width, palette = DEFAULT_PALETTE): Art {
  return { width, height, palette: [...palette], pixels: new Uint8Array(width * height) };
}

export function isEmpty(art: Art): boolean {
  return art.pixels.every((p) => p === TRANSPARENT);
}

/** Returns a copy with `value` written at each in-bounds point. */
export function paint(art: Art, points: readonly Point[], value: number): Art {
  const pixels = art.pixels.slice();
  for (const [x, y] of points) {
    if (x >= 0 && y >= 0 && x < art.width && y < art.height) pixels[y * art.width + x] = value;
  }
  return { ...art, pixels };
}

/** Bresenham line, both endpoints included. */
export function linePoints(x0: number, y0: number, x1: number, y1: number): Point[] {
  const points: Point[] = [];
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    points.push([x, y]);
    if (x === x1 && y === y1) return points;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
}

/** Rectangle outline between two corners. */
export function rectPoints(x0: number, y0: number, x1: number, y1: number): Point[] {
  const [left, right] = [Math.min(x0, x1), Math.max(x0, x1)];
  const [top, bottom] = [Math.min(y0, y1), Math.max(y0, y1)];
  const points: Point[] = [];
  for (let x = left; x <= right; x++) {
    points.push([x, top]);
    if (bottom !== top) points.push([x, bottom]);
  }
  for (let y = top + 1; y < bottom; y++) {
    points.push([left, y]);
    if (right !== left) points.push([right, y]);
  }
  return points;
}

/**
 * Removes the corner pixel of every L-shaped step so freehand strokes stay one
 * pixel thin, and drops consecutive duplicates.
 */
export function pixelPerfect(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && last[0] === p[0] && last[1] === p[1]) continue;
    out.push(p);
    if (out.length < 3) continue;
    const [a, b, c] = out.slice(-3);
    const elbow = (a[0] === b[0] || a[1] === b[1]) && (b[0] === c[0] || b[1] === c[1]);
    if (elbow && a[0] !== c[0] && a[1] !== c[1]) out.splice(out.length - 2, 1);
  }
  return out;
}

/** Expands each point into a brush×brush square centered on it (top-left biased for even sizes). */
export function stampPoints(points: readonly Point[], brush: number): Point[] {
  if (brush <= 1) return [...points];
  const from = -Math.floor((brush - 1) / 2);
  const out: Point[] = [];
  for (const [x, y] of points) {
    for (let dy = 0; dy < brush; dy++) {
      for (let dx = 0; dx < brush; dx++) out.push([x + from + dx, y + from + dy]);
    }
  }
  return out;
}

/** Adds the horizontal mirror of each point. */
export function mirrorPoints(points: readonly Point[], width: number): Point[] {
  return [...points, ...points.map(([x, y]) => [width - 1 - x, y] as const)];
}

/** 4-way flood fill of the region containing (x, y). */
export function floodFill(art: Art, x: number, y: number, value: number): Art {
  const { width, height } = art;
  if (x < 0 || y < 0 || x >= width || y >= height) return art;
  const target = art.pixels[y * width + x];
  if (target === value) return art;
  const pixels = art.pixels.slice();
  const stack = [y * width + x];
  while (stack.length) {
    const i = stack.pop()!;
    if (pixels[i] !== target) continue;
    pixels[i] = value;
    const px = i % width;
    if (px > 0) stack.push(i - 1);
    if (px < width - 1) stack.push(i + 1);
    if (i >= width) stack.push(i - width);
    if (i < width * (height - 1)) stack.push(i + width);
  }
  return { ...art, pixels };
}

/** Nearest-neighbour resample to a new canvas size. */
export function resize(art: Art, width: number, height = width): Art {
  if (width === art.width && height === art.height) return art;
  const pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sx = Math.floor((x * art.width) / width);
      const sy = Math.floor((y * art.height) / height);
      pixels[y * width + x] = art.pixels[sy * art.width + sx];
    }
  }
  return { ...art, width, height, pixels };
}
