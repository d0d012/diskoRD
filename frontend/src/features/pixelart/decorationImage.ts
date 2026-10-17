import { decodeDoc, type PixelArtDoc } from "./lib/doc";
import { drawArt } from "./render";

export const DECORATION_SIZES = [32, 48, 64, 96, 128] as const;
/** Offset bounds from the anchor message's top; must match decoration.MinY/MaxY on the server. */
export const DECORATION_MIN_Y = -256;
export const DECORATION_MAX_Y = 1024;

export const DECORATION_OPACITY = 0.35;

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
