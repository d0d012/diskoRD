import { LINE_SNAP_DEGREES, MIN_RESIZE_SIZE, MIN_TEXT_WIDTH, TEXT_SIZE_WORLD_UNITS } from '../contract/limits';
import type {
  ArrowObject, BoardObject, EndpointHandleId, HandleId, ImageObject, LineObject,
  Point, Rect, ResizeHandleId, StrokeObject, StrokePoint, TextObject, TextSize,
} from '../contract/types';

/**
 * Resize math, pure and deterministic. Resizing never flips an object: edges
 * clamp at the opposite anchor so sizes stay non-negative (minimum `minSize`).
 * Aspect lock follows Shift for shapes and is always on for images. Lines and
 * arrows move one endpoint with optional 15-degree angle snap. Text width
 * handles reflow (width only) while corner handles step the S/M/L/XL size.
 */

export { MIN_RESIZE_SIZE, MIN_TEXT_WIDTH };
const TEXT_SIZES = ['S', 'M', 'L', 'XL'] as const;

export interface ResizeBoxOptions {
  readonly minWidth: number;
  readonly minHeight: number;
  readonly keepAspect: boolean;
  /** Target width/height ratio when keepAspect; defaults to box.w/box.h. */
  readonly aspectRatio?: number;
}

function isCorner(handle: ResizeHandleId): boolean {
  return handle === 'nw' || handle === 'ne' || handle === 'se' || handle === 'sw';
}

/**
 * Resize an axis-aligned box by one of its 8 handles to `pointer` (world
 * position). The opposite corner/edge stays fixed; no flipping occurs.
 */
export function resizeBox(box: Rect, handle: ResizeHandleId, pointer: Point, options: ResizeBoxOptions): Rect {
  const { minWidth, minHeight, keepAspect } = options;
  const aspect = options.aspectRatio ?? (box.w > 0 && box.h > 0 ? box.w / box.h : 1);
  const moveLeft = handle === 'nw' || handle === 'w' || handle === 'sw';
  const moveRight = handle === 'ne' || handle === 'e' || handle === 'se';
  const moveTop = handle === 'nw' || handle === 'n' || handle === 'ne';
  const moveBottom = handle === 'se' || handle === 's' || handle === 'sw';

  const fixedLeft = box.x;
  const fixedRight = box.x + box.w;
  const fixedTop = box.y;
  const fixedBottom = box.y + box.h;

  // Signed proposed sizes from the dragged edges; negative means the pointer
  // crossed the anchor. Clamp to zero so edges never flip.
  let rawWidth = box.w;
  if (moveLeft) rawWidth = fixedRight - pointer.x;
  else if (moveRight) rawWidth = pointer.x - fixedLeft;

  let rawHeight = box.h;
  if (moveTop) rawHeight = fixedBottom - pointer.y;
  else if (moveBottom) rawHeight = pointer.y - fixedTop;

  const clampedWidth = moveLeft || moveRight ? Math.max(rawWidth, 0) : rawWidth;
  const clampedHeight = moveTop || moveBottom ? Math.max(rawHeight, 0) : rawHeight;

  let width = clampedWidth;
  let height = clampedHeight;

  if (keepAspect) {
    if (moveLeft || moveRight) {
      width = clampedWidth;
      height = width / aspect;
      if (moveTop || moveBottom) {
        const widthFromHeight = clampedHeight * aspect;
        if (widthFromHeight > width) {
          width = widthFromHeight;
          height = clampedHeight;
        }
      }
    } else {
      height = clampedHeight;
      width = height * aspect;
    }

    if (width <= 0 || height <= 0) {
      // Fully collapsed: restore the minimum box (never flip past the anchor).
      width = Math.max(minWidth, minHeight * aspect);
      height = width / aspect;
    } else {
      const scale = Math.max(1, minWidth / width, minHeight / height);
      width *= scale;
      height *= scale;
    }
  } else {
    width = Math.max(width, minWidth);
    height = Math.max(height, minHeight);
  }

  let x: number;
  if (moveLeft) x = fixedRight - width;
  else if (moveRight) x = fixedLeft;
  else x = keepAspect ? fixedLeft + (box.w - width) / 2 : fixedLeft;

  let y: number;
  if (moveTop) y = fixedBottom - height;
  else if (moveBottom) y = fixedTop;
  else y = keepAspect ? fixedTop + (box.h - height) / 2 : fixedTop;

  return { x, y, w: width, h: height };
}

/**
 * Resize a stroke: scale the local points by the new/old extent ratio. A zero
 * axis stays zero (its points remain at 0 rather than being scaled).
 */
export function resizeStroke(
  stroke: StrokeObject,
  handle: ResizeHandleId,
  pointer: Point,
): { bounds: Rect; points: readonly StrokePoint[] } {
  const resized = resizeBox(stroke, handle, pointer, {
    minWidth: 0,
    minHeight: 0,
    keepAspect: false,
  });
  // A zero centreline axis cannot be expanded by scaling: keep tight bounds
  // and its world position, rather than invent an empty extent around it.
  const bounds = {
    x: stroke.w === 0 ? stroke.x : resized.x,
    y: stroke.h === 0 ? stroke.y : resized.y,
    w: stroke.w === 0 ? 0 : resized.w,
    h: stroke.h === 0 ? 0 : resized.h,
  };
  const sx = stroke.w > 0 ? bounds.w / stroke.w : 1;
  const sy = stroke.h > 0 ? bounds.h / stroke.h : 1;
  const points = stroke.points.map((p) => ({
    x: p.x * sx,
    y: p.y * sy,
    pressure: p.pressure,
  }));
  return { bounds, points };
}

function snapAngle(point: Point, anchor: Point, stepDegrees: number): Point {
  const dx = point.x - anchor.x;
  const dy = point.y - anchor.y;
  const length = Math.hypot(dx, dy);
  const step = (stepDegrees * Math.PI) / 180;
  const snapped = Math.round(Math.atan2(dy, dx) / step) * step;
  return {
    x: anchor.x + Math.cos(snapped) * length,
    y: anchor.y + Math.sin(snapped) * length,
  };
}

/**
 * Move one endpoint of a line/arrow to `pointer` (world). With `snap`, the
 * direction from the fixed endpoint snaps to LINE_SNAP_DEGREES. Start/end
 * direction is preserved and the bounds are re-tightened to the endpoints.
 */
export function resizeLine(
  line: LineObject | ArrowObject,
  handle: EndpointHandleId,
  pointer: Point,
  snap: boolean,
): { bounds: Rect; start: Point; end: Point } {
  const startWorld = { x: line.x + line.start.x, y: line.y + line.start.y };
  const endWorld = { x: line.x + line.end.x, y: line.y + line.end.y };

  let nextStart = startWorld;
  let nextEnd = endWorld;
  if (handle === 'end') {
    nextEnd = snap ? snapAngle(pointer, startWorld, LINE_SNAP_DEGREES) : pointer;
  } else {
    nextStart = snap ? snapAngle(pointer, endWorld, LINE_SNAP_DEGREES) : pointer;
  }

  const minX = Math.min(nextStart.x, nextEnd.x);
  const minY = Math.min(nextStart.y, nextEnd.y);
  const bounds = {
    x: minX,
    y: minY,
    w: Math.abs(nextStart.x - nextEnd.x),
    h: Math.abs(nextStart.y - nextEnd.y),
  };
  return {
    bounds,
    start: { x: nextStart.x - minX, y: nextStart.y - minY },
    end: { x: nextEnd.x - minX, y: nextEnd.y - minY },
  };
}

function nearestTextSize(targetFont: number): TextSize {
  let best: TextSize = 'S';
  let bestDiff = Infinity;
  for (const size of TEXT_SIZES) {
    const diff = Math.abs(TEXT_SIZE_WORLD_UNITS[size] - targetFont);
    // On an exact tie, prefer the larger size for a natural outward drag.
    if (diff < bestDiff || (diff === bestDiff && TEXT_SIZE_WORLD_UNITS[size] > TEXT_SIZE_WORLD_UNITS[best])) {
      best = size;
      bestDiff = diff;
    }
  }
  return best;
}

/**
 * Resize text. East/west handles change only the width (reflow); the height is
 * re-measured later and stays untouched here. Corner handles step the size
 * (S/M/L/XL) from the drag scale and scale the box proportionally about the
 * fixed opposite corner.
 */
export function resizeText(
  text: TextObject,
  handle: ResizeHandleId,
  pointer: Point,
  options: { minWidth: number },
): { bounds: Rect; size: TextSize } {
  const { minWidth } = options;

  if (handle === 'e' || handle === 'w') {
    let width: number;
    let x: number;
    if (handle === 'e') {
      width = Math.max(pointer.x - text.x, minWidth);
      x = text.x;
    } else {
      width = Math.max(text.x + text.w - pointer.x, minWidth);
      x = text.x + text.w - width;
    }
    return { bounds: { x, y: text.y, w: width, h: text.h }, size: text.style.size };
  }

  const moveLeft = handle === 'nw' || handle === 'sw';
  const moveTop = handle === 'nw' || handle === 'ne';
  const anchor = { x: moveLeft ? text.x + text.w : text.x, y: moveTop ? text.y + text.h : text.y };
  const corner = { x: moveLeft ? text.x : text.x + text.w, y: moveTop ? text.y : text.y + text.h };

  const startDistance = Math.hypot(corner.x - anchor.x, corner.y - anchor.y) || 1;
  const scale = Math.hypot(pointer.x - anchor.x, pointer.y - anchor.y) / startDistance;

  const oldFont = TEXT_SIZE_WORLD_UNITS[text.style.size];
  const size = nearestTextSize(oldFont * scale);
  const ratio = TEXT_SIZE_WORLD_UNITS[size] / oldFont;

  const width = Math.max(text.w * ratio, minWidth);
  const height = text.h * ratio;
  return {
    bounds: {
      x: moveLeft ? anchor.x - width : anchor.x,
      y: moveTop ? anchor.y - height : anchor.y,
      w: width,
      h: height,
    },
    size,
  };
}

/**
 * Resize an image: aspect-locked corners only, using the cropped source ratio
 * `(width * crop.w) / (height * crop.h)` — not the current visible bounds, so
 * a re-cropped image keeps its true source aspect when scaled.
 */
export function resizeImage(
  image: ImageObject,
  handle: ResizeHandleId,
  pointer: Point,
  options: { minSize: number },
): Rect {
  return resizeBox(image, handle, pointer, {
    minWidth: options.minSize,
    minHeight: options.minSize,
    keepAspect: true,
    aspectRatio: (image.width * image.crop.w) / (image.height * image.crop.h),
  });
}

export interface ResizeOptions {
  /** Minimum width/height in world units (also the text reflow minimum). */
  readonly minSize: number;
  /** Shift on shapes; ignored for images (always locked). */
  readonly keepAspect: boolean;
  /** Shift on lines/arrows: snap to 15 degrees. */
  readonly snap: boolean;
}

export type ResizeResult =
  | { readonly kind: 'box'; readonly bounds: Rect }
  | { readonly kind: 'stroke'; readonly bounds: Rect; readonly points: readonly StrokePoint[] }
  | { readonly kind: 'line'; readonly bounds: Rect; readonly start: Point; readonly end: Point }
  | { readonly kind: 'text'; readonly bounds: Rect; readonly size: TextSize };

function asResizeHandle(handle: HandleId): ResizeHandleId {
  if (handle === 'start' || handle === 'end') {
    throw new Error(`resizeObject: expected a resize handle, got ${handle}`);
  }
  return handle;
}

/** Dispatch to the correct resize for an object kind. */
export function resizeObject(
  object: BoardObject,
  handle: HandleId,
  pointer: Point,
  options: ResizeOptions,
): ResizeResult {
  switch (object.kind) {
    case 'rect':
    case 'ellipse':
    case 'frame':
      return {
        kind: 'box',
        bounds: resizeBox(object, asResizeHandle(handle), pointer, {
          minWidth: options.minSize,
          minHeight: options.minSize,
          keepAspect: options.keepAspect,
        }),
      };
    case 'image': {
      const resizeHandle = asResizeHandle(handle);
      if (!isCorner(resizeHandle)) {
        throw new Error(`resizeObject: image supports corner handles only, got ${handle}`);
      }
      return { kind: 'box', bounds: resizeImage(object, resizeHandle, pointer, { minSize: options.minSize }) };
    }
    case 'stroke':
      return {
        kind: 'stroke',
        ...resizeStroke(object, asResizeHandle(handle), pointer),
      };
    case 'line':
    case 'arrow': {
      if (handle !== 'start' && handle !== 'end') {
        throw new Error(`resizeObject: expected an endpoint handle, got ${handle}`);
      }
      return { kind: 'line', ...resizeLine(object, handle, pointer, options.snap) };
    }
    case 'text': {
      const resizeHandle = asResizeHandle(handle);
      if (resizeHandle === 'n' || resizeHandle === 's') {
        throw new Error(`resizeObject: text has no n/s handle, got ${handle}`);
      }
      return { kind: 'text', ...resizeText(object, resizeHandle, pointer, { minWidth: options.minSize }) };
    }
    case 'sticky':
      throw new Error('resizeObject: sticky is not resizable');
  }
}
