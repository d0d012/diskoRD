import type { Art } from "./lib/art";
import { hexToRgb, type Rgba } from "./lib/importImage";

/** Writes the art at native size into a canvas (callers scale it with CSS). */
export function drawArt(canvas: HTMLCanvasElement, art: Art) {
  canvas.width = art.size;
  canvas.height = art.size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const image = ctx.createImageData(art.size, art.size);
  const colors = art.palette.map(hexToRgb);
  art.pixels.forEach((p, i) => {
    if (p === 0) return;
    const [r, g, b] = colors[p - 1];
    image.data.set([r, g, b, 255], i * 4);
  });
  ctx.putImageData(image, 0, 0);
}

/** Scale that brings any canvas size to a 512px export. */
export function shareScale(art: Art): number {
  return Math.max(1, Math.floor(512 / art.size));
}

/** Nearest-neighbour upscaled PNG of the art. */
export async function artToPng(art: Art, scale: number): Promise<Blob> {
  const source = document.createElement("canvas");
  drawArt(source, art);
  const out = document.createElement("canvas");
  out.width = art.size * scale;
  out.height = art.size * scale;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available.");
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(source, 0, 0, out.width, out.height);
  const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Could not render PNG.");
  return blob;
}

/**
 * Decodes any browser-supported image file into RGBA, capped to keep import
 * cheap. Scaling uses nearest-neighbour so upscaled pixel art keeps hard edges;
 * the importer does its own smoothing for photos.
 */
export async function loadImageRgba(file: File, maxSide = 2048): Promise<Rgba> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available.");
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return { width, height, data: ctx.getImageData(0, 0, width, height).data };
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
