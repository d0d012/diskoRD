import type { Point, StrokePoint } from '../contract';

/**
 * Area eraser geometry. A stroke is a polyline of world-space points; the
 * eraser is a capsule (segment `a`-`b` with `radius`). Erasing removes the
 * parts of the polyline inside the capsule and returns the surviving runs.
 * Pure: no store, no DOM.
 */

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

/** Cheap conservative reject: can segment p-q come within `radius` of a-b at all? */
function mayTouch(p: Point, q: Point, a: Point, b: Point, radius: number): boolean {
  return Math.min(p.x, q.x) - radius <= Math.max(a.x, b.x) && Math.max(p.x, q.x) + radius >= Math.min(a.x, b.x) &&
    Math.min(p.y, q.y) - radius <= Math.max(a.y, b.y) && Math.max(p.y, q.y) + radius >= Math.min(a.y, b.y);
}

export function pathLength(points: readonly Point[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i++) length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return length;
}

/** True when the capsule a-b touches the polyline anywhere. */
export function eraserTouches(points: readonly Point[], a: Point, b: Point, radius: number): boolean {
  if (points.length === 1) return distanceToSegment(points[0], a, b) <= radius;
  for (let i = 1; i < points.length; i++) {
    if (!mayTouch(points[i - 1], points[i], a, b, radius)) continue;
    const length = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    const steps = Math.max(1, Math.ceil(length / Math.max(radius / 2, 0.5)));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const sample = { x: points[i - 1].x + (points[i].x - points[i - 1].x) * t, y: points[i - 1].y + (points[i].y - points[i - 1].y) * t };
      if (distanceToSegment(sample, a, b) <= radius) return true;
    }
  }
  return false;
}

/**
 * Remove the parts of `points` within `radius` of segment a-b. Returns the
 * surviving runs in order; an untouched polyline comes back as one run that
 * is the SAME array (identity tells the caller nothing changed). Segments
 * near the eraser are sampled every radius/2 so a long straight segment is
 * cut where it is touched instead of vanishing whole. Runs shorter than
 * `minLength` are leftover specks and are dropped.
 */
export function erasePolyline(
  points: readonly StrokePoint[], a: Point, b: Point, radius: number, minLength = 0,
): (readonly StrokePoint[])[] {
  if (points.length === 0) return [];
  if (points.length === 1) return distanceToSegment(points[0], a, b) <= radius ? [] : [points];
  if (!eraserTouches(points, a, b, radius)) return [points];

  const step = Math.max(radius / 2, 0.5);
  const runs: StrokePoint[][] = [];
  let run: StrokePoint[] = [];
  function close(): void {
    if (run.length > 0) runs.push(run);
    run = [];
  }
  function keep(point: StrokePoint): void {
    const last = run[run.length - 1];
    if (!last || last.x !== point.x || last.y !== point.y) run.push(point);
  }

  if (distanceToSegment(points[0], a, b) > radius) keep(points[0]);
  for (let i = 1; i < points.length; i++) {
    const p = points[i - 1];
    const q = points[i];
    if (!mayTouch(p, q, a, b, radius)) {
      keep(q);
      continue;
    }
    const length = Math.hypot(q.x - p.x, q.y - p.y);
    const steps = Math.max(1, Math.ceil(length / step));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const sample: StrokePoint = s === steps ? q : {
        x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t, pressure: p.pressure + (q.pressure - p.pressure) * t,
      };
      if (distanceToSegment(sample, a, b) <= radius) close();
      else keep(sample);
    }
  }
  close();
  return runs.filter(candidate => candidate.length > 1 ? pathLength(candidate) >= minLength : minLength <= 0);
}
