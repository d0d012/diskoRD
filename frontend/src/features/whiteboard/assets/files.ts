import { MAX_IMAGE_BYTES, MAX_IMAGE_DIMENSION, MAX_IMAGE_MEGAPIXELS, MAX_IMAGE_PIXELS } from '../contract';
import type { Point } from '../contract';

/** Messages shown to the user; kept here so every entry point says the same thing. */
export const IMAGE_MESSAGES = {
  notImage: 'That file is not an image',
  svg: 'SVG images are not supported',
  empty: 'That file is empty',
  unreadable: 'That image could not be read',
  tooManyAssets: 'This board has too many images',
  boardFull: 'This board is full',
  tooLargeBytes: `That image is too large (max ${MAX_IMAGE_BYTES / (1024 * 1024)} MB)`,
  tooLargePixels: `That image is too large (max ${MAX_IMAGE_MEGAPIXELS} megapixels)`,
} as const;

export interface ImageSize {
  readonly width: number;
  readonly height: number;
}

function isSvg(file: Blob): boolean {
  if (file.type === 'image/svg+xml') return true;
  const name = (file as { name?: unknown }).name;
  return typeof name === 'string' && /\.svgz?$/i.test(name);
}

/** Cheap checks that need no decoding. Returns the user-facing problem, or null. */
export function checkImageFile(file: Blob): string | null {
  if (isSvg(file)) return IMAGE_MESSAGES.svg;
  // Clipboard blobs sometimes have no type: decoding decides for those.
  if (file.type !== '' && !file.type.startsWith('image/')) return IMAGE_MESSAGES.notImage;
  if (file.size === 0) return IMAGE_MESSAGES.empty;
  if (file.size > MAX_IMAGE_BYTES) return IMAGE_MESSAGES.tooLargeBytes;
  return null;
}

/** Whether natural dimensions are inside the contract (per axis and in total pixels). */
export function checkImageSize({ width, height }: ImageSize): string | null {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) return IMAGE_MESSAGES.unreadable;
  if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION || width * height > MAX_IMAGE_PIXELS) {
    return IMAGE_MESSAGES.tooLargePixels;
  }
  return null;
}

const DECODE_TIMEOUT_MS = 20_000;

/** Natural pixel size of an image blob, by decoding it in an <img>. Rejects when it cannot be decoded. */
export function decodeImageSize(file: Blob): Promise<ImageSize> {
  return new Promise<ImageSize>((resolve, reject) => {
    if (typeof URL.createObjectURL !== 'function' || typeof Image === 'undefined') {
      reject(new Error(IMAGE_MESSAGES.unreadable));
      return;
    }
    const url = URL.createObjectURL(file);
    const image = new Image();
    // A decode that never settles must not wedge the whole batch.
    const timer = setTimeout(() => image.onerror?.(new Event('error')), DECODE_TIMEOUT_MS);
    const done = () => { clearTimeout(timer); image.onload = null; image.onerror = null; URL.revokeObjectURL?.(url); };
    image.onload = () => { done(); resolve({ width: image.naturalWidth, height: image.naturalHeight }); };
    image.onerror = () => { done(); reject(new Error(IMAGE_MESSAGES.unreadable)); };
    image.src = url;
  });
}

/** Share of the visible area a freshly added image may fill at most. */
export const MAX_DEFAULT_VIEWPORT_SHARE = 0.4;
/** World-unit gap between images added in one batch. */
export const BATCH_GAP = 16;

/**
 * Default display size: the natural size, scaled down (never up) so it fits in
 * at most 40% of the visible world area on each axis.
 */
export function defaultDisplaySize(natural: ImageSize, visible: { readonly w: number; readonly h: number }): { w: number; h: number } {
  const limitW = Math.max(1, visible.w * MAX_DEFAULT_VIEWPORT_SHARE);
  const limitH = Math.max(1, visible.h * MAX_DEFAULT_VIEWPORT_SHARE);
  const scale = Math.min(1, limitW / natural.width, limitH / natural.height);
  return { w: Math.max(1, natural.width * scale), h: Math.max(1, natural.height * scale) };
}

/** Left-to-right row: first item's top-left at `origin`, `BATCH_GAP` between items. */
export function layoutRow(sizes: readonly { readonly w: number; readonly h: number }[], origin: Point): Point[] {
  let x = origin.x;
  return sizes.map(size => {
    const at = { x, y: origin.y };
    x += size.w + BATCH_GAP;
    return at;
  });
}

export function rowExtent(sizes: readonly { readonly w: number; readonly h: number }[]): { w: number; h: number } {
  const w = sizes.reduce((sum, size) => sum + size.w, 0) + BATCH_GAP * Math.max(0, sizes.length - 1);
  return { w, h: sizes.reduce((max, size) => Math.max(max, size.h), 0) };
}

/** Runs `worker` over `items` with at most `limit` in flight; never rejects (workers handle their own errors). */
export async function runPool<T>(items: readonly T[], limit: number, worker: (item: T, index: number) => Promise<void>): Promise<void> {
  let next = 0;
  async function lane(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      await worker(items[index], index).catch(() => undefined);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
}
