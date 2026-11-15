import { ERASER_RADIUS_PX, MAX_CHANGES_PER_COMMAND, MAX_COMMAND_BYTES } from '../../contract';
import type { BoardObject, Change, ObjectId, Point, StrokeObject, StrokePoint } from '../../contract';
import { enforceStrokeLimits, erasePolyline, eraserTouches, getBounds, normalizePoints } from '../../core';
import { filterVisibleObjects } from '../../state';
import { EMPTY_PREVIEW, clearPreview, commandBytes, createChange, deleteChange, safeDispatch, updateChange } from '../objects';
import type { Gesture, PointerSample, ToolContext } from '../types';

/** Keep each write comfortably inside the server's per-command limits. */
const ERASE_BATCH_CHANGES = Math.floor(MAX_CHANGES_PER_COMMAND / 2);
const ERASE_BATCH_BYTES = Math.floor(MAX_COMMAND_BYTES / 2);

interface Erased {
  readonly original: StrokeObject;
  /** Surviving runs in world space. */
  pieces: (readonly StrokePoint[])[];
}

function worldPoints(stroke: StrokeObject): StrokePoint[] {
  return stroke.points.map(point => ({ x: point.x + stroke.x, y: point.y + stroke.y, pressure: point.pressure }));
}

/** Half the rendered stroke width, so touching the ink's edge erases it. */
function halfWidth(stroke: StrokeObject): number {
  return (getBounds(stroke).w - stroke.w) / 2;
}

function strokeFrom(original: StrokeObject, id: ObjectId, createdBy: string, version: number, piece: readonly StrokePoint[]): StrokeObject {
  const { points, bounds } = normalizePoints(piece);
  return enforceStrokeLimits({ ...original, id, createdBy, version, ...bounds, points });
}

/**
 * Area eraser. Only pen strokes are affected, and only where the eraser
 * touches them: a stroke cut in the middle becomes two strokes. The longest
 * surviving piece stays the original object (same id and author); further
 * pieces are new strokes with the same rank and style. Nothing is sent until
 * the pointer is released, then one command (split only if it would exceed the
 * per-command limits) carries every update, create and delete.
 */
export function createEraserGesture(ctx: ToolContext, start: PointerSample): Gesture {
  const { runtime, store, session } = ctx;
  const radius = ERASER_RADIUS_PX / Math.max(runtime.getCamera().zoom, 0.01);
  const erased = new Map<ObjectId, Erased>();
  const previewIds = new Map<ObjectId, ObjectId[]>();
  let last: Point = start.world;
  let done = false;

  function candidates(a: Point, b: Point): StrokeObject[] {
    const minX = Math.min(a.x, b.x) - radius;
    const maxX = Math.max(a.x, b.x) + radius;
    const minY = Math.min(a.y, b.y) - radius;
    const maxY = Math.max(a.y, b.y) + radius;
    const visible = filterVisibleObjects(store.getObjectsInRank(), session);
    const hits: StrokeObject[] = [];
    for (const object of visible) {
      if (object.kind !== 'stroke' || erased.has(object.id)) continue;
      const bounds = getBounds(object);
      if (bounds.x > maxX || bounds.x + bounds.w < minX || bounds.y > maxY || bounds.y + bounds.h < minY) continue;
      hits.push(object);
    }
    return hits;
  }

  function sweep(to: Point): void {
    const a = last;
    last = to;
    let changed = false;
    // Strokes already being erased are cut again from their surviving pieces.
    for (const entry of erased.values()) {
      const half = halfWidth(entry.original);
      const next: (readonly StrokePoint[])[] = [];
      for (const piece of entry.pieces) {
        const runs = erasePolyline(piece, a, to, radius + half, radius);
        if (runs.length !== 1 || runs[0] !== piece) changed = true;
        next.push(...runs);
      }
      entry.pieces = next;
    }
    for (const stroke of candidates(a, to)) {
      const points = worldPoints(stroke);
      const reach = radius + halfWidth(stroke);
      if (!eraserTouches(points, a, to, reach)) continue;
      erased.set(stroke.id, { original: stroke, pieces: erasePolyline(points, a, to, reach, radius) });
      changed = true;
    }
    if (changed) preview();
  }

  function preview(): void {
    const objects: BoardObject[] = [];
    for (const [id, entry] of erased) {
      let ids = previewIds.get(id);
      if (!ids) previewIds.set(id, ids = []);
      entry.pieces.forEach((piece, index) => {
        while (ids!.length <= index) ids!.push(ctx.newId());
        objects.push(strokeFrom(entry.original, ids![index], entry.original.createdBy, 0, piece));
      });
    }
    runtime.setPreview({ ...EMPTY_PREVIEW, objects, hiddenIds: [...erased.keys()] });
  }

  function commit(): void {
    const changes: Change[] = [];
    for (const entry of erased.values()) {
      const current = store.getObject(entry.original.id);
      if (!current || current.kind !== 'stroke') continue;
      if (entry.pieces.length === 0) {
        changes.push(deleteChange(current));
        continue;
      }
      // The longest survivor keeps the original identity and author.
      const pieces = [...entry.pieces].sort((x, y) => y.length - x.length);
      const kept = strokeFrom(current, current.id, current.createdBy, current.version, pieces[0]);
      changes.push(updateChange(current, { x: kept.x, y: kept.y, w: kept.w, h: kept.h, points: kept.points }));
      for (const piece of pieces.slice(1)) {
        changes.push(createChange(strokeFrom(current, ctx.newId(), ctx.userId, 0, piece)));
      }
    }
    let batch: Change[] = [];
    for (const change of changes) {
      if (batch.length > 0 && (batch.length >= ERASE_BATCH_CHANGES || commandBytes([...batch, change]) > ERASE_BATCH_BYTES)) {
        safeDispatch(store, batch, 'Erase', ctx.notify);
        batch = [];
      }
      batch.push(change);
    }
    if (batch.length > 0) safeDispatch(store, batch, 'Erase', ctx.notify);
  }

  sweep(start.world);
  return {
    kind: 'erasing',
    move(sample, coalesced) {
      if (done) return;
      if (coalesced && coalesced.length > 0) for (const item of coalesced) sweep(item.world);
      else sweep(sample.world);
    },
    end(sample) {
      if (done) return;
      done = true;
      sweep(sample.world);
      // Selection may point at strokes that no longer exist or have changed shape.
      const touched = new Set(erased.keys());
      const selection = session.getState().selectedIds;
      if (selection.some(id => touched.has(id))) session.setSelectedIds(selection.filter(id => !touched.has(id)));
      commit();
      clearPreview(runtime);
    },
    cancel() {
      if (done) return;
      done = true;
      clearPreview(runtime);
    },
  };
}
