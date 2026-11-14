import { DEFAULT_SIMPLIFY_TOLERANCE, MAX_OBJECT_BODY_BYTES, MAX_STROKE_POINTS } from '../contract/limits';
import type { Point, Rect, StrokeObject, StrokePoint } from '../contract/types';

/**
 * Stroke point processing. RDP simplifies the centreline to a tolerance (in
 * world units); `normalizePoints` rebases points to object-local coordinates
 * and returns the tight bounds; `enforceStrokeLimits` keeps the serialized
 * body under the byte cap and the point count under the point cap by raising
 * the tolerance until both hold.
 */

export { DEFAULT_SIMPLIFY_TOLERANCE };

export interface StrokeEnforceOptions {
  /** Starting RDP tolerance in world units. */
  readonly tolerance: number;
  /** Maximum point count after simplification. */
  readonly maxPoints: number;
  /** UTF-8 byte budget for the whole serialized stroke body. */
  readonly maxBytes: number;
  /** How much to raise the tolerance each time a limit is exceeded. */
  readonly toleranceStep: number;
}

function clampPressure(pressure: number): number {
  if (!Number.isFinite(pressure)) return 0.5;
  return Math.min(1, Math.max(0, pressure));
}

function perpendicularDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Ramer-Douglas-Peucker. Keeps the first and last points and any point whose
 * perpendicular distance from the running segment exceeds the tolerance.
 * Deterministic: output preserves input order and is a subset of the input.
 */
export function simplifyPoints(points: readonly StrokePoint[], tolerance: number): StrokePoint[] {
  if (points.length <= 2) return [...points];
  const epsilon = Math.max(0, tolerance);
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;

  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop() as [number, number];
    let maxDistance = 0;
    let index = -1;
    for (let i = start + 1; i < end; i++) {
      const distance = perpendicularDistance(points[i], points[start], points[end]);
      if (distance > maxDistance) {
        maxDistance = distance;
        index = i;
      }
    }
    if (maxDistance > epsilon && index !== -1) {
      keep[index] = true;
      stack.push([start, index], [index, end]);
    }
  }

  const result: StrokePoint[] = [];
  for (let i = 0; i < points.length; i++) {
    if (keep[i]) result.push(points[i]);
  }
  return result;
}

/** UTF-8 byte length of the serialized points array (ASCII-safe JSON). */
export function pointsByteLength(points: readonly StrokePoint[]): number {
  return JSON.stringify(points).length;
}

/**
 * Rebases world-space points to object-local coordinates and returns the tight
 * bounds. Empty input yields the zero rect and an empty array; pressure is
 * clamped to [0, 1] (0.5 for non-finite values).
 */
export function normalizePoints(points: readonly StrokePoint[]): { points: StrokePoint[]; bounds: Rect } {
  if (points.length === 0) return { points: [], bounds: { x: 0, y: 0, w: 0, h: 0 } };

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
    points: points.map((point) => ({
      x: point.x - minX,
      y: point.y - minY,
      pressure: clampPressure(point.pressure),
    })),
    bounds: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
  };
}

function rebuild(stroke: StrokeObject, points: readonly StrokePoint[]): StrokeObject {
  const { points: normalized, bounds } = normalizePoints(points.map(point => ({
    ...point, x: stroke.x + point.x, y: stroke.y + point.y,
  })));
  return {
    ...stroke,
    x: bounds.x,
    y: bounds.y,
    w: bounds.w,
    h: bounds.h,
    points: normalized,
  };
}

/**
 * Simplify `stroke` until both the point cap and the serialized whole-body
 * byte cap hold, re-normalizing points and bounds after each step. Cannot
 * reduce below the two endpoints; if even those exceed `maxBytes`, the
 * endpoint-only stroke is returned (the caller must reject it upstream).
 */
export function enforceStrokeLimits(
  stroke: StrokeObject,
  options?: Partial<StrokeEnforceOptions>,
): StrokeObject {
  const tolerance = options?.tolerance ?? DEFAULT_SIMPLIFY_TOLERANCE;
  const maxPoints = options?.maxPoints ?? MAX_STROKE_POINTS;
  const maxBytes = options?.maxBytes ?? MAX_OBJECT_BODY_BYTES;
  const step = options?.toleranceStep !== undefined && options.toleranceStep > 0
    ? options.toleranceStep
    : 1;

  let currentTolerance = Math.max(0, tolerance);
  let result = rebuild(stroke, simplifyPoints(stroke.points, currentTolerance));

  while (result.points.length > maxPoints || new TextEncoder().encode(JSON.stringify(result)).byteLength > maxBytes) {
    if (result.points.length <= 2) break;
    currentTolerance += step;
    result = rebuild(stroke, simplifyPoints(stroke.points, currentTolerance));
  }
  return result;
}
