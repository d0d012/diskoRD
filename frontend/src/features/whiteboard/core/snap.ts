import type { HandleId, Point, Rect } from '../contract';

export const SNAP_DISTANCE_PX = 6;
export const SNAP_CANDIDATE_LIMIT = 300;
export interface SnapGuide { axis: 'x' | 'y'; value: number; from: number; to: number }
export interface SnapMatch { delta: number; anchor: number; target: Rect; value: number }
export interface SnapResult { dx: number; dy: number; x?: SnapMatch; y?: SnapMatch; guides: SnapGuide[] }

/** Cull before sorting; deterministic nearest-first cap, in world coordinates. */
export function snapCandidates<T extends Rect>(objects: readonly T[], viewport: Rect, near: Point, margin: number, cap = SNAP_CANDIDATE_LIMIT): T[] {
  return objects.filter(o => o.x + o.w >= viewport.x - margin && o.x <= viewport.x + viewport.w + margin
    && o.y + o.h >= viewport.y - margin && o.y <= viewport.y + viewport.h + margin)
    .map((object, index) => ({ object, index, distance: Math.hypot(object.x + object.w / 2 - near.x, object.y + object.h / 2 - near.y) }))
    .sort((a, b) => a.distance - b.distance || a.index - b.index).slice(0, cap).map(entry => entry.object);
}

export function snapGuide(axis: 'x' | 'y', match: SnapMatch, bounds: Rect): SnapGuide {
  return { axis, value: match.value,
    from: Math.min(axis === 'x' ? bounds.y : bounds.x, axis === 'x' ? match.target.y : match.target.x),
    to: Math.max(axis === 'x' ? bounds.y + bounds.h : bounds.x + bounds.w, axis === 'x' ? match.target.y + match.target.h : match.target.x + match.target.w) };
}

/** Anchors are fractions of the moving box: edges 0/1 and centre .5. */
export function snapBounds(bounds: Rect, candidates: readonly Rect[], zoom: number,
  anchors: { x: readonly number[]; y: readonly number[] } = { x: [0, .5, 1], y: [0, .5, 1] }): SnapResult {
  const tolerance = SNAP_DISTANCE_PX / zoom;
  const result: SnapResult = { dx: 0, dy: 0, guides: [] };
  for (const axis of ['x', 'y'] as const) {
    const extent = axis === 'x' ? 'w' : 'h';
    let best: SnapMatch | undefined;
    for (const target of candidates) for (const targetAnchor of [0, .5, 1]) for (const anchor of anchors[axis]) {
      const value = target[axis] + target[extent] * targetAnchor;
      const delta = value - (bounds[axis] + bounds[extent] * anchor);
      if (Math.abs(delta) <= tolerance && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { delta, anchor, target, value };
    }
    if (best) { result[axis] = best; if (axis === 'x') result.dx = best.delta; else result.dy = best.delta; }
  }
  const moved = { ...bounds, x: bounds.x + result.dx, y: bounds.y + result.dy };
  for (const axis of ['x', 'y'] as const) if (result[axis]) result.guides.push(snapGuide(axis, result[axis], moved));
  return result;
}

/** Snap a resize without moving its fixed anchor or breaking aspect/min-size constraints. */
export function snapResize(bounds: Rect, candidates: readonly Rect[], zoom: number, handle: HandleId,
  pointer: Point, compute: (point: Point) => Rect): { point: Point; guides: SnapGuide[] } {
  if (handle === 'start' || handle === 'end') return { point: pointer, guides: [] };
  const result = snapBounds(bounds, candidates, zoom, {
    x: handle.includes('w') ? [0, .5] : handle.includes('e') ? [1, .5] : [],
    y: handle.includes('n') ? [0, .5] : handle.includes('s') ? [1, .5] : [],
  });
  const dx = result.dx * (result.x?.anchor === .5 ? 2 : 1);
  const dy = result.dy * (result.y?.anchor === .5 ? 2 : 1);
  // Aspect-locked corners can only satisfy one independent alignment. Try
  // each axis separately, and verify actual bounds after applying constraints.
  const options = [{ x: dx, y: dy }, { x: dx, y: 0 }, { x: 0, y: dy }].map(delta => {
    const point = { x: pointer.x + delta.x, y: pointer.y + delta.y };
    const actual = compute(point);
    const guides = (['x', 'y'] as const).flatMap(axis => {
      const match = result[axis];
      return match && Math.abs(actual[axis] + actual[axis === 'x' ? 'w' : 'h'] * match.anchor - match.value) < .01
        ? [snapGuide(axis, match, actual)] : [];
    });
    return { point, guides, distance: Math.hypot(delta.x, delta.y) };
  }).sort((a, b) => b.guides.length - a.guides.length || a.distance - b.distance);
  const best = options[0];
  return { point: best.guides.length ? best.point : pointer, guides: best.guides };
}

export function selectionBounds(objects: readonly Rect[]): Rect {
  if (!objects.length) return { x: 0, y: 0, w: 0, h: 0 };
  const x = Math.min(...objects.map(o => o.x)); const y = Math.min(...objects.map(o => o.y));
  return { x, y, w: Math.max(...objects.map(o => o.x + o.w)) - x, h: Math.max(...objects.map(o => o.y + o.h)) - y };
}
