import { MIN_CROP_SIZE } from '../contract/limits';
import type { Point, Rect, ResizeHandleId } from '../contract/types';

/**
 * Normalized crop math for images. A crop is a Rect in [0,1]^2: x/y >= 0 and
 * x+w <= 1, y+h <= 1. The object's visible bounds (w x h world units) always
 * show exactly the cropped region, so in crop mode the full natural image is
 * drawn at the uniform scale that maps the crop region onto {0,0,w,h}; the
 * crop rectangle itself is therefore always {0,0,w,h} and dragging one of its
 * handles moves that boundary through the underlying source image.
 */

export { MIN_CROP_SIZE };

export interface CropSize {
  readonly w: number;
  readonly h: number;
}

export interface CropSource {
  readonly width: number;
  readonly height: number;
}

function clampUnit(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value;
}

/** Clamp a normalized crop into [0,1]^2 with a minimum size and no flipping. */
export function clampCrop(crop: Rect, minSize: number = MIN_CROP_SIZE): Rect {
  const min = Math.min(0.5, Math.max(0, minSize));
  const x = clampUnit(crop.x, 0, 1 - min);
  const y = clampUnit(crop.y, 0, 1 - min);
  const w = clampUnit(crop.w, min, 1 - x);
  const h = clampUnit(crop.h, min, 1 - y);
  return { x, y, w, h };
}

/**
 * The full natural image's rectangle in object-local units during crop mode:
 * the crop region maps exactly onto the object's visible bounds {0,0,w,h}.
 */
export function displayedSourceRect(crop: Rect, size: CropSize, source: CropSource): Rect {
  const scale = size.w / (crop.w * source.width);
  return {
    // `0 - ...` keeps a zero crop offset as +0 rather than -0.
    x: 0 - crop.x * source.width * scale,
    y: 0 - crop.y * source.height * scale,
    w: source.width * scale,
    h: source.height * scale,
  };
}

/** Inverse of `displayedSourceRect` for a given object size (clamped). */
export function cropFromSourceRect(displayed: Rect, size: CropSize): Rect {
  return clampCrop({
    x: -displayed.x / displayed.w,
    y: -displayed.y / displayed.h,
    w: size.w / displayed.w,
    h: size.h / displayed.h,
  });
}

/** The crop expressed in natural source pixels. */
export function sourcePixelRect(crop: Rect, source: CropSource): Rect {
  return {
    x: crop.x * source.width,
    y: crop.y * source.height,
    w: crop.w * source.width,
    h: crop.h * source.height,
  };
}

/**
 * Resize the crop in crop mode. `pointer` is in object-local units (the crop
 * rectangle is {0,0,size.w,size.h}); the returned crop is clamped to [0,1]
 * with `minSize`, keeping the opposite boundary fixed and never flipping.
 */
export function resizeCrop(
  crop: Rect,
  handle: ResizeHandleId,
  pointer: Point,
  size: CropSize,
  minSize: number = MIN_CROP_SIZE,
): Rect {
  const min = Math.min(0.5, Math.max(0, minSize));
  const moveLeft = handle === 'nw' || handle === 'w' || handle === 'sw';
  const moveRight = handle === 'ne' || handle === 'e' || handle === 'se';
  const moveTop = handle === 'nw' || handle === 'n' || handle === 'ne';
  const moveBottom = handle === 'se' || handle === 's' || handle === 'sw';

  const left = crop.x;
  const right = crop.x + crop.w;
  const top = crop.y;
  const bottom = crop.y + crop.h;

  // Map the pointer's object-local position onto normalized source space.
  const u = crop.x + (size.w > 0 ? (pointer.x / size.w) * crop.w : 0);
  const v = crop.y + (size.h > 0 ? (pointer.y / size.h) * crop.h : 0);

  let nextLeft = left;
  let nextRight = right;
  let nextTop = top;
  let nextBottom = bottom;

  if (moveLeft) nextLeft = clampUnit(u, 0, right - min);
  if (moveRight) nextRight = clampUnit(u, left + min, 1);
  if (moveTop) nextTop = clampUnit(v, 0, bottom - min);
  if (moveBottom) nextBottom = clampUnit(v, top + min, 1);

  return { x: nextLeft, y: nextTop, w: nextRight - nextLeft, h: nextBottom - nextTop };
}
