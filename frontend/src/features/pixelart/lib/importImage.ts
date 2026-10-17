import { TRANSPARENT, type Art } from "./art";

export interface Rgba {
  width: number;
  height: number;
  /** RGBA bytes, row major. */
  data: Uint8ClampedArray;
}

export type Fit = "contain" | "cover";

/** Pixels below this alpha become transparent. */
const ALPHA_CUTOFF = 128;

/**
 * Area-averages the source into a size×size RGBA buffer. "cover" crops the
 * centered square; "contain" letterboxes with transparency. Exact for sprites
 * that are already pixel art at an integer scale.
 */
export function downscale(src: Rgba, size: number, fit: Fit): Uint8ClampedArray {
  const out = new Uint8ClampedArray(size * size * 4);
  const side = fit === "cover" ? Math.min(src.width, src.height) : Math.max(src.width, src.height);
  const originX = (src.width - side) / 2;
  const originY = (src.height - side) / 2;
  const step = side / size;

  for (let ty = 0; ty < size; ty++) {
    for (let tx = 0; tx < size; tx++) {
      const x0 = Math.max(0, Math.floor(originX + tx * step));
      const x1 = Math.min(src.width, Math.ceil(originX + (tx + 1) * step));
      const y0 = Math.max(0, Math.floor(originY + ty * step));
      const y1 = Math.min(src.height, Math.ceil(originY + (ty + 1) * step));
      // Weighted by alpha so transparent pixels don't darken edges.
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * src.width + x) * 4;
          const alpha = src.data[i + 3];
          r += src.data[i] * alpha;
          g += src.data[i + 1] * alpha;
          b += src.data[i + 2] * alpha;
          a += alpha;
          n++;
        }
      }
      const o = (ty * size + tx) * 4;
      if (n === 0 || a === 0) continue; // letterbox or fully transparent
      out[o] = r / a;
      out[o + 1] = g / a;
      out[o + 2] = b / a;
      out[o + 3] = a / n;
    }
  }
  return out;
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("");
}

function distance(a: readonly number[], r: number, g: number, b: number): number {
  // Weighted RGB distance, a cheap stand-in for perceptual difference.
  const dr = a[0] - r, dg = a[1] - g, db = a[2] - b;
  return 2 * dr * dr + 4 * dg * dg + 3 * db * db;
}

function nearest(colors: readonly (readonly number[])[], r: number, g: number, b: number): number {
  let best = 0;
  let bestDistance = Infinity;
  colors.forEach((c, i) => {
    const d = distance(c, r, g, b);
    if (d < bestDistance) { bestDistance = d; best = i; }
  });
  return best;
}

/** Maps every opaque pixel to the nearest palette color. */
export function quantizeToPalette(rgba: Uint8ClampedArray, size: number, palette: string[]): Art {
  const colors = palette.map(hexToRgb);
  const pixels = new Uint8Array(size * size);
  for (let i = 0; i < pixels.length; i++) {
    const o = i * 4;
    pixels[i] = rgba[o + 3] < ALPHA_CUTOFF ? TRANSPARENT : nearest(colors, rgba[o], rgba[o + 1], rgba[o + 2]) + 1;
  }
  return { size, palette: [...palette], pixels };
}

/**
 * Builds a palette of at most `k` colors with k-means over the opaque pixels,
 * seeded deterministically from evenly spaced samples. Then maps pixels to it.
 */
export function quantizeNewPalette(rgba: Uint8ClampedArray, size: number, k: number, iterations = 8): Art {
  const opaque: number[][] = [];
  for (let o = 0; o < rgba.length; o += 4) {
    if (rgba[o + 3] >= ALPHA_CUTOFF) opaque.push([rgba[o], rgba[o + 1], rgba[o + 2]]);
  }
  if (opaque.length === 0) return quantizeToPalette(rgba, size, ["#000000"]);

  const distinct = [...new Set(opaque.map((c) => rgbToHex(c[0], c[1], c[2])))];
  let centers: number[][];
  if (distinct.length <= k) {
    centers = distinct.map(hexToRgb);
  } else {
    centers = Array.from({ length: k }, (_, i) => [...opaque[Math.floor((i * opaque.length) / k)]]);
    for (let iter = 0; iter < iterations; iter++) {
      const sums = centers.map(() => [0, 0, 0, 0]);
      for (const c of opaque) {
        const s = sums[nearest(centers, c[0], c[1], c[2])];
        s[0] += c[0]; s[1] += c[1]; s[2] += c[2]; s[3]++;
      }
      centers = centers.map((center, i) => {
        const s = sums[i];
        return s[3] ? [s[0] / s[3], s[1] / s[3], s[2] / s[3]] : center;
      });
    }
  }
  const palette = [...new Set(centers.map((c) => rgbToHex(c[0], c[1], c[2])))];
  return quantizeToPalette(rgba, size, palette);
}
