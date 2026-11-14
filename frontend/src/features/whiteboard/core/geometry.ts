import {
  FRAME_LABEL_CHAR_WIDTH, FRAME_LABEL_FONT_SIZE, FRAME_LABEL_HEIGHT, FRAME_LABEL_PADDING_X,
  MARKER_WIDTH_MULTIPLIER, STROKE_WEIGHT_WORLD_UNITS,
} from '../contract/limits';
import type {
  BoardObject, FrameObject, Point, Rect, StrokePreset, StrokeStyle,
} from '../contract/types';

/**
 * Pure geometry for board objects. Everything is in world units. Bounds are
 * the *visual* footprint: stroke-bearing kinds are expanded by half their
 * stroke width, and a frame includes its label chip. Hit tests use precise
 * shape distance (ellipse, segments, polylines) so a tolerance in world units
 * can be applied by the caller.
 */

/** Compatibility exports; contract/limits.ts owns these values. */
export { FRAME_LABEL_FONT_SIZE, FRAME_LABEL_HEIGHT, FRAME_LABEL_PADDING_X };

function strokeWidth(style: StrokeStyle, preset?: StrokePreset): number {
  const base = STROKE_WEIGHT_WORLD_UNITS[style.weight];
  return preset === 'marker' ? base * MARKER_WIDTH_MULTIPLIER : base;
}

function expandRect(rect: Rect, amount: number): Rect {
  return {
    x: rect.x - amount,
    y: rect.y - amount,
    w: rect.w + amount * 2,
    h: rect.h + amount * 2,
  };
}

function boundsOfPoints(points: readonly Point[], pad: number): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return {
    x: minX - pad,
    y: minY - pad,
    w: maxX - minX + pad * 2,
    h: maxY - minY + pad * 2,
  };
}

/**
 * The label chip of a frame: a deterministic rectangle outside the top-left
 * edge, matching the plan's frame chip placement. The render layer must
 * place the label to match this rectangle so hit-testing stays in sync.
 */
export function frameLabelBounds(frame: FrameObject): Rect {
  const textWidth = frame.label.length * FRAME_LABEL_CHAR_WIDTH;
  const width = Math.min(
    Math.max(textWidth + FRAME_LABEL_PADDING_X * 2, FRAME_LABEL_HEIGHT),
    frame.w,
  );
  return {
    x: frame.x,
    y: frame.y - FRAME_LABEL_HEIGHT,
    w: width,
    h: FRAME_LABEL_HEIGHT,
  };
}

/** Visual world bounds for any object kind, including stroke width. */
export function getBounds(object: BoardObject): Rect {
  switch (object.kind) {
    case 'stroke': {
      const half = strokeWidth(object.style, object.preset) / 2;
      const points = object.points.length > 0
        ? object.points.map((p) => ({ x: object.x + p.x, y: object.y + p.y }))
        : [{ x: object.x, y: object.y }];
      return boundsOfPoints(points, half);
    }
    case 'line':
    case 'arrow': {
      const half = strokeWidth(object.style) / 2;
      return boundsOfPoints(
        [
          { x: object.x + object.start.x, y: object.y + object.start.y },
          { x: object.x + object.end.x, y: object.y + object.end.y },
        ],
        half,
      );
    }
    case 'rect':
    case 'ellipse': {
      const half = strokeWidth(object.style) / 2;
      return expandRect(object, half);
    }
    case 'frame': {
      const half = strokeWidth(object.style) / 2;
      return unionBounds([expandRect(object, half), frameLabelBounds(object)]);
    }
    case 'text':
    case 'sticky':
    case 'image':
      return { x: object.x, y: object.y, w: object.w, h: object.h };
  }
}

/** Union of zero or more rectangles; an empty input yields the zero rect. */
export function unionBounds(bounds: readonly Rect[]): Rect {
  if (bounds.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const bound of bounds) {
    minX = Math.min(minX, bound.x);
    minY = Math.min(minY, bound.y);
    maxX = Math.max(maxX, bound.x + bound.w);
    maxY = Math.max(maxY, bound.y + bound.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * Closed-interval intersection so zero-extent rects (points/lines) still
 * intersect when they touch another rect.
 */
export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
}

/** Inclusive containment of a point in a rectangle. */
export function rectContains(rect: Rect, point: Point): boolean {
  return point.x >= rect.x
    && point.x <= rect.x + rect.w
    && point.y >= rect.y
    && point.y <= rect.y + rect.h;
}

/** Inclusive containment of `inner` inside `outer`. */
export function rectContainsRect(outer: Rect, inner: Rect): boolean {
  return inner.x >= outer.x
    && inner.y >= outer.y
    && inner.x + inner.w <= outer.x + outer.w
    && inner.y + inner.h <= outer.y + outer.h;
}

function pointInEllipse(point: Point, rect: Rect, tolerance: number): boolean {
  const rx = rect.w / 2 + tolerance;
  const ry = rect.h / 2 + tolerance;
  if (rx <= 0 || ry <= 0) return false;
  const dx = (point.x - (rect.x + rect.w / 2)) / rx;
  const dy = (point.y - (rect.y + rect.h / 2)) / ry;
  return dx * dx + dy * dy <= 1;
}

/** Distance from a point to a line segment. */
export function pointToSegmentDistance(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.min(1, Math.max(0, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq));
  const cx = a.x + t * dx;
  const cy = a.y + t * dy;
  return Math.hypot(point.x - cx, point.y - cy);
}

/** Distance from a point to a polyline (min over segments; dot handled). */
export function pointToPolylineDistance(point: Point, points: readonly Point[]): number {
  if (points.length === 0) return Infinity;
  if (points.length === 1) return Math.hypot(point.x - points[0].x, point.y - points[0].y);
  let min = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    min = Math.min(min, pointToSegmentDistance(point, points[i], points[i + 1]));
  }
  return min;
}

function nearRectBorder(point: Point, rect: Rect, distance: number): boolean {
  const outer = expandRect(rect, distance);
  if (!rectContains(outer, point)) return false;
  const inner = {
    x: rect.x + distance,
    y: rect.y + distance,
    w: rect.w - distance * 2,
    h: rect.h - distance * 2,
  };
  // A rect thinner than 2*distance has no interior to exclude.
  if (inner.w <= 0 || inner.h <= 0) return true;
  return !rectContains(inner, point);
}

function hitFrame(frame: FrameObject, point: Point, tolerance: number): boolean {
  if (rectContains(expandRect(frameLabelBounds(frame), tolerance), point)) return true;
  return nearRectBorder(point, frame, strokeWidth(frame.style) / 2 + tolerance);
}

/**
 * Precise point hit test with a tolerance in world units. Frames hit only on
 * their border or label chip, never their interior (so a drag inside starts a
 * marquee). Ellipses, lines/arrows and stroke polylines use exact distance.
 */
export function hitTestPoint(object: BoardObject, point: Point, tolerance: number): boolean {
  const tol = Math.max(0, tolerance);
  switch (object.kind) {
    case 'rect':
      return rectContains(expandRect(object, tol), point);
    case 'ellipse':
      return pointInEllipse(point, object, tol);
    case 'line':
    case 'arrow': {
      const half = strokeWidth(object.style) / 2 + tol;
      const start = { x: object.x + object.start.x, y: object.y + object.start.y };
      const end = { x: object.x + object.end.x, y: object.y + object.end.y };
      return pointToSegmentDistance(point, start, end) <= half;
    }
    case 'stroke': {
      const half = strokeWidth(object.style, object.preset) / 2 + tol;
      const points = object.points.map((p) => ({ x: object.x + p.x, y: object.y + p.y }));
      return pointToPolylineDistance(point, points) <= half;
    }
    case 'text':
    case 'sticky':
    case 'image':
      return rectContains(expandRect(object, tol), point);
    case 'frame':
      return hitFrame(object, point, tol);
  }
}

/**
 * Marquee selection: ordinary objects are selected when their visual bounds
 * intersect the marquee; frames only when the marquee fully encloses the
 * frame's rectangle.
 */
export function hitTestMarquee(object: BoardObject, marquee: Rect): boolean {
  if (object.kind === 'frame') return rectContainsRect(marquee, object);
  return rectsIntersect(marquee, getBounds(object));
}

/**
 * The visually topmost object at a point. `objects` must be in ascending rank
 * order (then id), as returned by the store's `getObjectsInRank`; the last
 * hit is the topmost and is returned first.
 */
export function topmostObjectAtPoint(
  objects: readonly BoardObject[],
  point: Point,
  tolerance: number,
): BoardObject | undefined {
  for (let i = objects.length - 1; i >= 0; i--) {
    if (hitTestPoint(objects[i], point, tolerance)) return objects[i];
  }
  return undefined;
}
