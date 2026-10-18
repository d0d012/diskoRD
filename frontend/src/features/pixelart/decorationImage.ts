import { decodeDoc, type PixelArtDoc } from "./lib/doc";
import { drawArt } from "./render";

export const DECORATION_SIZES = [32, 48, 64, 96, 128, 192, 256] as const;
/** Offset bounds from the anchor message's top; must match decoration.MinY/MaxY on the server. */
export const DECORATION_MIN_Y = -256;
export const DECORATION_MAX_Y = 1024;

/** Opacity presets in percent; the first is the original faint default. */
export const DECORATION_OPACITIES = [35, 60, 100] as const;
export const DEFAULT_DECORATION_OPACITY = 35;

// Each distinct piece is rasterized once per session, however many times it appears.
const urlCache = new Map<string, string | null>();

/** Data URL of a doc at native size (CSS scales it), or null if it can't be drawn. */
export function docImageUrl(doc: PixelArtDoc): string | null {
  const key = `${doc.width}|${doc.palette.join(",")}|${doc.frames[0]}`;
  const cached = urlCache.get(key);
  if (cached !== undefined) return cached;
  let url: string | null = null;
  try {
    const canvas = document.createElement("canvas");
    drawArt(canvas, decodeDoc(doc));
    url = canvas.getContext("2d") ? canvas.toDataURL("image/png") : null;
  } catch {
    url = null; // corrupt doc or no canvas: skip it rather than break the message
  }
  urlCache.set(key, url);
  return url;
}

/** Left offset that keeps a piece inside the row: x=0 is flush left, x=100 flush right. */
export function decorationLeft(x: number, size: number): string {
  return `calc(${x}% - ${(size * x) / 100}px)`;
}

export interface TrimmedImage {
  url: string;
  /** Size of the non-transparent area, in art pixels. */
  width: number;
  height: number;
}

const trimCache = new Map<string, TrimmedImage | null>();

/**
 * The art cropped to its non-transparent pixels, so a small character drawn in
 * the corner of a big canvas shows at a useful size. Cached per doc.
 */
export function trimmedImage(doc: PixelArtDoc): TrimmedImage | null {
  const key = `${doc.width}|${doc.palette.join(",")}|${doc.frames[0]}`;
  const cached = trimCache.get(key);
  if (cached !== undefined) return cached;
  let result: TrimmedImage | null = null;
  try {
    const art = decodeDoc(doc);
    let minX = art.size, minY = art.size, maxX = -1, maxY = -1;
    for (let y = 0; y < art.size; y++) {
      for (let x = 0; x < art.size; x++) {
        if (!art.pixels[y * art.size + x]) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    if (maxX >= 0) {
      const full = document.createElement("canvas");
      drawArt(full, art);
      const width = maxX - minX + 1;
      const height = maxY - minY + 1;
      const crop = document.createElement("canvas");
      crop.width = width;
      crop.height = height;
      const ctx = crop.getContext("2d");
      if (ctx) {
        ctx.drawImage(full, minX, minY, width, height, 0, 0, width, height);
        result = { url: crop.toDataURL("image/png"), width, height };
      }
    }
  } catch {
    result = null;
  }
  trimCache.set(key, result);
  return result;
}

/**
 * Display scale for fitting w×h art pixels into a box: whole numbers when
 * enlarging (crisp pixels), exact fractions when it has to shrink.
 */
export function fitScale(width: number, height: number, boxWidth: number, boxHeight: number): number {
  const scale = Math.min(boxWidth / width, boxHeight / height);
  return scale >= 1 ? Math.floor(scale) : scale;
}

