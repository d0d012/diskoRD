import type { BoardObject, HandleId, Point, Rect } from '../contract';
import { selectionBounds, snapBounds, snapCandidates, snapResize } from '../core/snap';
import { filterVisibleObjects } from '../state';
import { setSnapGuides, snapState } from '../render/overlays/snapState';
import type { PointerSample, ToolContext } from './types';

/** Freeze candidate membership at pointer-down; never include carried frame contents. */
export function createToolSnapper(ctx: ToolContext, excluded: readonly string[], near: Point) {
  const camera = ctx.runtime.getCamera();
  const size = snapState(ctx.runtime).viewport;
  const viewport = { x: -camera.x / camera.zoom, y: -camera.y / camera.zoom, w: size.w / camera.zoom, h: size.h / camera.zoom };
  const ids = new Set(excluded);
  const candidates = snapCandidates(filterVisibleObjects(ctx.store.getObjectsInRank(), ctx.session).filter(o => !ids.has(o.id)), viewport, near, 64 / camera.zoom);
  function move(bounds: Rect, sample: PointerSample): Point {
    if (sample.altKey) { setSnapGuides(ctx.runtime, []); return { x: 0, y: 0 }; }
    const result = snapBounds(bounds, candidates, ctx.runtime.getCamera().zoom);
    setSnapGuides(ctx.runtime, result.guides);
    return { x: result.dx, y: result.dy };
  }
  function resize(bounds: Rect, handle: HandleId, sample: PointerSample, compute: (point: Point) => Rect): Point {
    if (sample.altKey || handle === 'start' || handle === 'end') { setSnapGuides(ctx.runtime, []); return sample.world; }
    const result = snapResize(bounds, candidates, ctx.runtime.getCamera().zoom, handle, sample.world, compute);
    setSnapGuides(ctx.runtime, result.guides);
    return result.point;
  }
  return { move, resize };
}

export function snapCreatedObject(object: BoardObject, sample: PointerSample, dragged: boolean, start: Point, snapper: ReturnType<typeof createToolSnapper>, rebuild: (point: Point) => BoardObject): BoardObject {
  if (!['rect', 'ellipse', 'frame', 'sticky'].includes(object.kind)) return object;
  if (!dragged || object.kind === 'sticky') {
    const delta = snapper.move(object, sample);
    return { ...object, x: object.x + delta.x, y: object.y + delta.y };
  }
  const handle = `${sample.world.y < start.y ? 'n' : 's'}${sample.world.x < start.x ? 'w' : 'e'}` as HandleId;
  return rebuild(snapper.resize(object, handle, sample, rebuild));
}

export function snapTranslation(originals: readonly BoardObject[], dx: number, dy: number, sample: PointerSample, snapper: ReturnType<typeof createToolSnapper>): Point {
  const bounds = selectionBounds(originals);
  return snapper.move({ ...bounds, x: bounds.x + dx, y: bounds.y + dy }, sample);
}
