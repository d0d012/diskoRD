import { MAX_COLORS, SIZES, TRANSPARENT, type Art } from "./art";

export interface Rgba {
  width: number;
  height: number;
  /** RGBA bytes, row major. */
  data: Uint8ClampedArray;
}

/**
 * contain: scale the whole image into the canvas (letterboxed with transparency).
 * cover: scale to fill the canvas, cropping the overflow.
 * actual: no scaling, one source pixel per canvas pixel, centered.
 */
export type Fit = "contain" | "cover" | "actual";

/** Pixels below this alpha become transparent. */
const ALPHA_CUTOFF = 128;
/** k-means runs on at most this many pixels; mapping still covers every pixel. */
const KMEANS_SAMPLE = 16384;

/**
 * Resamples the source into a width×height RGBA buffer.
 * sharp: take the pixel at the center of each area (keeps pixel art crisp, exact colors).
 * smooth: average each area (better for photos and gradients).
 */
export function resample(src: Rgba, width: number, height: number, fit: Fit, sharp = false): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);

  if (fit === "actual") {
    const ox = Math.floor((width - src.width) / 2);
    const oy = Math.floor((height - src.height) / 2);
    for (let y = 0; y < src.height; y++) {
      const ty = y + oy;
      if (ty < 0 || ty >= height) continue;
      for (let x = 0; x < src.width; x++) {
        const tx = x + ox;
        if (tx < 0 || tx >= width) continue;
        const i = (y * src.width + x) * 4;
        out.set(src.data.subarray(i, i + 4), (ty * width + tx) * 4);
      }
    }
    return out;
  }

  // Source pixels per canvas pixel, the same on both axes so shapes don't stretch.
  const step = fit === "cover"
    ? Math.min(src.width / width, src.height / height)
    : Math.max(src.width / width, src.height / height);
  const originX = (src.width - width * step) / 2;
  const originY = (src.height - height * step) / 2;

  for (let ty = 0; ty < height; ty++) {
    for (let tx = 0; tx < width; tx++) {
      const o = (ty * width + tx) * 4;
      if (sharp) {
        const sx = Math.floor(originX + (tx + 0.5) * step);
        const sy = Math.floor(originY + (ty + 0.5) * step);
        if (sx < 0 || sy < 0 || sx >= src.width || sy >= src.height) continue; // letterbox
        const i = (sy * src.width + sx) * 4;
        out.set(src.data.subarray(i, i + 4), o);
        continue;
      }
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
      if (n === 0 || a === 0) continue; // letterbox or fully transparent
      out[o] = r / a;
      out[o + 1] = g / a;
      out[o + 2] = b / a;
      out[o + 3] = a / n;
    }
  }
  return out;
}

/** Same pixel, treating every transparent pixel as equal. */
function samePixel(d: Uint8ClampedArray, i: number, j: number): boolean {
  const ta = d[i + 3] < ALPHA_CUTOFF;
  const tb = d[j + 3] < ALPHA_CUTOFF;
  if (ta || tb) return ta && tb;
  return d[i] === d[j] && d[i + 1] === d[j + 1] && d[i + 2] === d[j + 2];
}

/**
 * Detects pixel art saved at an integer zoom (e.g. a 32×32 sprite exported at
 * 512×512): the largest block size ≤ 64 that divides both sides and where every
 * block is a single color. Returns 1 for photos and native-size art.
 */
export function detectPixelScale(src: Rgba): number {
  const limit = Math.min(64, src.width, src.height);
  for (let s = limit; s >= 2; s--) {
    if (src.width % s || src.height % s) continue;
    let uniform = true;
    for (let y = 0; y < src.height && uniform; y++) {
      const by = y - (y % s);
      for (let x = 0; x < src.width; x++) {
        const corner = (by * src.width + (x - (x % s))) * 4;
        if (!samePixel(src.data, (y * src.width + x) * 4, corner)) { uniform = false; break; }
      }
    }
    if (uniform) return s;
  }
  return 1;
}

/** Shrinks block-scaled pixel art back to one pixel per block (lossless when blocks are uniform). */
export function unscale(src: Rgba, scale: number): Rgba {
  if (scale <= 1) return src;
  const width = src.width / scale;
  const height = src.height / scale;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * scale * src.width + x * scale) * 4;
      data.set(src.data.subarray(i, i + 4), (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

/** Number of distinct opaque colors, counting up to `cap`. */
export function countColors(rgba: Uint8ClampedArray, cap = 4096): number {
  const seen = new Set<number>();
  for (let o = 0; o < rgba.length && seen.size < cap; o += 4) {
    if (rgba[o + 3] >= ALPHA_CUTOFF) seen.add((rgba[o] << 16) | (rgba[o + 1] << 8) | rgba[o + 2]);
  }
  return seen.size;
}

export interface ImportSuggestion {
  /** The image to import from: block-scaled pixel art is already reduced to 1:1. */
  source: Rgba;
  /** Block size found in the original (1 = none). */
  scale: number;
  width: number;
  height: number;
  fit: Fit;
  sharp: boolean;
}

/**
 * Picks settings that reproduce the image as faithfully as the editor allows:
 * small or block-scaled pixel art goes in 1:1 on the smallest canvas that fits,
 * anything bigger is scaled down smoothly.
 */
export function suggestImport(src: Rgba): ImportSuggestion {
  const scale = detectPixelScale(src);
  const source = unscale(src, scale);
  const longest = Math.max(source.width, source.height);
  const fitting = SIZES.find((s) => s >= longest);
  if (fitting !== undefined && (scale > 1 || longest <= 128)) {
    return { source, scale, width: fitting, height: fitting, fit: "actual", sharp: true };
  }
  return { source, scale, width: 64, height: 64, fit: "contain", sharp: false };
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
  for (let i = 0; i < colors.length; i++) {
    const d = distance(colors[i], r, g, b);
    if (d < bestDistance) { bestDistance = d; best = i; }
  }
  return best;
}

/** Maps every opaque pixel to the nearest palette color. */
export function quantizeToPalette(rgba: Uint8ClampedArray, width: number, height: number, palette: string[]): Art {
  const colors = palette.map(hexToRgb);
  const pixels = new Uint8Array(width * height);
  for (let i = 0; i < pixels.length; i++) {
    const o = i * 4;
    pixels[i] = rgba[o + 3] < ALPHA_CUTOFF ? TRANSPARENT : nearest(colors, rgba[o], rgba[o + 1], rgba[o + 2]) + 1;
  }
  return { width, height, palette: [...palette], pixels };
}

/**
 * Builds a palette of at most `k` colors and maps the pixels to it. When the
 * image has k colors or fewer they are kept exactly. Otherwise k-means runs,
 * seeded with the most common color plus repeatedly the color farthest from the
 * seeds so far, which keeps small but distinct details (eyes, outlines) alive.
 */
export function quantizeNewPalette(rgba: Uint8ClampedArray, width: number, height: number, k: number, iterations = 8): Art {
  const counts = new Map<number, number>();
  for (let o = 0; o < rgba.length; o += 4) {
    if (rgba[o + 3] < ALPHA_CUTOFF) continue;
    const key = (rgba[o] << 16) | (rgba[o + 1] << 8) | rgba[o + 2];
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (counts.size === 0) return quantizeToPalette(rgba, width, height, ["#000000"]);

  const k2 = Math.min(k, MAX_COLORS);
  const byFrequency = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const rgb = (key: number) => [(key >> 16) & 255, (key >> 8) & 255, key & 255];

  if (counts.size <= k2) {
    return quantizeToPalette(rgba, width, height, byFrequency.map(([key]) => rgbToHex(...(rgb(key) as [number, number, number]))));
  }

  // Weighted sample of distinct colors keeps iterations cheap on 256×256 photos.
  const stride = Math.max(1, Math.ceil(byFrequency.length / KMEANS_SAMPLE));
  const sample = byFrequency.filter((_, i) => i % stride === 0).map(([key, n]) => ({ c: rgb(key), n }));

  const centers: number[][] = [sample[0].c];
  const closest = sample.map((s) => distance(centers[0], s.c[0], s.c[1], s.c[2]));
  while (centers.length < k2) {
    let far = 0;
    for (let i = 1; i < sample.length; i++) if (closest[i] > closest[far]) far = i;
    if (closest[far] === 0) break;
    centers.push([...sample[far].c]);
    for (let i = 0; i < sample.length; i++) {
      closest[i] = Math.min(closest[i], distance(sample[far].c, sample[i].c[0], sample[i].c[1], sample[i].c[2]));
    }
  }

  for (let iter = 0; iter < iterations; iter++) {
    const sums = centers.map(() => [0, 0, 0, 0]);
    for (const { c, n } of sample) {
      const s = sums[nearest(centers, c[0], c[1], c[2])];
      s[0] += c[0] * n; s[1] += c[1] * n; s[2] += c[2] * n; s[3] += n;
    }
    for (let i = 0; i < centers.length; i++) {
      const s = sums[i];
      if (s[3]) centers[i] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]];
    }
  }
  const palette = [...new Set(centers.map((c) => rgbToHex(c[0], c[1], c[2])))];
  return quantizeToPalette(rgba, width, height, palette);
}

/** Options of an image import in progress. */
export interface ImportState {
  /** Image to import, already reduced to 1:1 when it was upscaled pixel art. */
  source: Rgba;
  /** Block size detected in the original file (1 = none). */
  scale: number;
  /** Data URL of the source for the side-by-side comparison, when a canvas is available. */
  thumb: string | null;
  width: number;
  height: number;
  fit: Fit;
  sharp: boolean;
  palette: "new" | "keep";
  /** "all" keeps every color up to the palette limit; a number reduces to that many. */
  colors: "all" | number;
}

/** Renders the import preview for the current options. */
export function renderImport(state: ImportState, myPalette: string[]): { art: Art; sourceColors: number } {
  const rgba = resample(state.source, state.width, state.height, state.fit, state.sharp);
  const sourceColors = countColors(rgba);
  const art = state.palette === "keep"
    ? quantizeToPalette(rgba, state.width, state.height, myPalette)
    : quantizeNewPalette(rgba, state.width, state.height, state.colors === "all" ? MAX_COLORS : state.colors);
  return { art, sourceColors };
}
