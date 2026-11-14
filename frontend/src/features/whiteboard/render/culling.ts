import type { BoardObject, ObjectId, Rect } from '../contract';
import { getBounds, rectsIntersect, visibleWorldRect } from '../core';
import type { Camera } from '../contract';

const CELL_SIZE = 512;
// Contract coordinates permit enormous frames; never allocate millions of cells.
const MAX_CELLS = 256;

function cellRange(bounds: Rect) {
  return { left: Math.floor(bounds.x / CELL_SIZE), right: Math.floor((bounds.x + bounds.w) / CELL_SIZE), top: Math.floor(bounds.y / CELL_SIZE), bottom: Math.floor((bounds.y + bounds.h) / CELL_SIZE) };
}
function keysFor(bounds: Rect): string[] | null {
  const { left, right, top, bottom } = cellRange(bounds);
  if ((right - left + 1) * (bottom - top + 1) > MAX_CELLS) return null;
  const keys: string[] = [];
  for (let x = left; x <= right; x++) for (let y = top; y <= bottom; y++) keys.push(`${x}:${y}`);
  return keys;
}

/** Incremental grid; oversized entries/queries use a bounded linear fallback. */
export class SpatialGrid {
  private cells = new Map<string, Set<ObjectId>>();
  private entries = new Map<ObjectId, { bounds: Rect; keys: string[] | null }>();
  private oversized = new Set<ObjectId>();

  set(object: BoardObject): void {
    this.delete(object.id);
    const bounds = getBounds(object);
    const keys = keysFor(bounds);
    this.entries.set(object.id, { bounds, keys });
    if (!keys) this.oversized.add(object.id);
    else for (const key of keys) {
      let cell = this.cells.get(key);
      if (!cell) this.cells.set(key, cell = new Set());
      cell.add(object.id);
    }
  }

  delete(id: ObjectId): void {
    const entry = this.entries.get(id);
    for (const key of entry?.keys ?? []) {
      const cell = this.cells.get(key)!;
      cell.delete(id);
      if (!cell.size) this.cells.delete(key);
    }
    this.oversized.delete(id);
    this.entries.delete(id);
  }

  query(bounds: Rect): Set<ObjectId> {
    const keys = keysFor(bounds);
    const candidates = keys ? new Set(this.oversized) : new Set(this.entries.keys());
    if (keys) for (const key of keys) for (const id of this.cells.get(key) ?? []) candidates.add(id);
    const result = new Set<ObjectId>();
    for (const id of candidates) if (rectsIntersect(this.entries.get(id)!.bounds, bounds)) result.add(id);
    return result;
  }
}

/** Overscan is screen-sized, including low zoom, as in the M0 benchmark. */
export function cullingBounds(camera: Camera, width: number, height: number): Rect {
  return visibleWorldRect(camera, { x: -100, y: -100, w: width + 200, h: height + 200 });
}

export function computeVisibleSet(grid: SpatialGrid, bounds: Rect, overrides: readonly BoardObject[] = [], hiddenIds: readonly ObjectId[] = []): Set<ObjectId> {
  const visible = grid.query(bounds);
  for (const id of hiddenIds) visible.delete(id);
  for (const object of overrides) {
    // A preview can replace a hidden original (the gesture protocol).
    visible.delete(object.id);
    if (rectsIntersect(getBounds(object), bounds)) visible.add(object.id);
  }
  return visible;
}
