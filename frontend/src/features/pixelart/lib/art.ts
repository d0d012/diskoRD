/**
 * Pixel art in indexed color: each pixel is 0 (transparent) or 1..palette.length,
 * pointing at palette[value - 1]. Arts are treated as immutable snapshots so the
 * undo history can keep them by reference.
 */
export interface Art {
  size: number;
  palette: string[];
  pixels: Uint8Array;
}

export const SIZES = [16, 32, 64] as const;
export const MAX_COLORS = 32;
export const TRANSPARENT = 0;

/** Our own 16-color starter palette. */
export const DEFAULT_PALETTE = [
  "#000000", "#ffffff", "#7f7f7f", "#c3c3c3",
  "#e53935", "#ff8a65", "#fdd835", "#ffcc80",
  "#43a047", "#a5d6a7", "#1e88e5", "#90caf9",
  "#8e24aa", "#f48fb1", "#8d6e63", "#3e2723",
];

export type Point = readonly [number, number];

export function createArt(size = 32, palette = DEFAULT_PALETTE): Art {
  return { size, palette: [...palette], pixels: new Uint8Array(size * size) };
}

export function isEmpty(art: Art): boolean {
  return art.pixels.every((p) => p === TRANSPARENT);
}

/** Returns a copy with `value` written at each in-bounds point. */
export function paint(art: Art, points: readonly Point[], value: number): Art {
  const pixels = art.pixels.slice();
  for (const [x, y] of points) {
    if (x >= 0 && y >= 0 && x < art.size && y < art.size) pixels[y * art.size + x] = value;
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

/** Adds the horizontal mirror of each point. */
export function mirrorPoints(points: readonly Point[], size: number): Point[] {
  return [...points, ...points.map(([x, y]) => [size - 1 - x, y] as const)];
}

/** 4-way flood fill of the region containing (x, y). */
export function floodFill(art: Art, x: number, y: number, value: number): Art {
  const { size } = art;
  if (x < 0 || y < 0 || x >= size || y >= size) return art;
  const target = art.pixels[y * size + x];
  if (target === value) return art;
  const pixels = art.pixels.slice();
  const stack = [y * size + x];
  while (stack.length) {
    const i = stack.pop()!;
    if (pixels[i] !== target) continue;
    pixels[i] = value;
    const px = i % size;
    if (px > 0) stack.push(i - 1);
    if (px < size - 1) stack.push(i + 1);
    if (i >= size) stack.push(i - size);
    if (i < size * (size - 1)) stack.push(i + size);
  }
  return { ...art, pixels };
}

/** Nearest-neighbour resample to a new canvas size. */
export function resize(art: Art, size: number): Art {
  if (size === art.size) return art;
  const pixels = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sx = Math.floor((x * art.size) / size);
      const sy = Math.floor((y * art.size) / size);
      pixels[y * size + x] = art.pixels[sy * art.size + sx];
    }
  }
  return { ...art, size, pixels };
}
