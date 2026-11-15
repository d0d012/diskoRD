import type { BoardObject, BoardStore, ObjectId, Rect, UserId } from '../contract';

export const REGION_CELL_SIZE = 500;
/** Objects smaller than this on both axes are dots and specks. */
export const TINY_OBJECT_SIZE = 16;
/** This many tiny marks in one cell make the cell a drawing, not clutter. */
export const DENSE_TINY_PER_CELL = 8;
export const SCATTERED_MAX_OBJECTS = 3;
export const SCATTERED_MAX_SIZE = 200;

export interface AuthorRegion {
  readonly id: string;
  readonly authorId: UserId;
  readonly bounds: Rect;
  readonly rect: Rect;
  readonly objectCount: number;
  readonly objectIds: readonly ObjectId[];
  readonly scattered: boolean;
}

export interface AuthorRegions {
  readonly authorId: UserId;
  readonly userId: UserId;
  readonly objectCount: number;
  /** Normal (non-scattered) regions sorted by objectCount descending. */
  readonly regions: readonly AuthorRegion[];
  /** Loose specks, plus small isolated groups (<= 3 objects and bounding box < 200x200). */
  readonly scatteredRegions: readonly AuthorRegion[];
  /** Total objects across all scattered regions for this author. */
  readonly scatteredObjectCount: number;
  /** Every region (normal + scattered) sorted by objectCount descending. */
  readonly allRegions: readonly AuthorRegion[];
}

// Large rectangles use cell-range comparisons instead of enumerating an
// unbounded number of cells. Never truncate their occupied range.
const MAX_INDEXED_CELLS = 1_024;

export function isScatteredRegion(
  objectCount: number,
  bounds: Rect,
  maxObjects = SCATTERED_MAX_OBJECTS,
  maxSize = SCATTERED_MAX_SIZE,
): boolean {
  return objectCount <= maxObjects && bounds.w < maxSize && bounds.h < maxSize;
}

function compareRegions(a: AuthorRegion, b: AuthorRegion): number {
  if (b.objectCount !== a.objectCount) return b.objectCount - a.objectCount;
  if (a.bounds.y !== b.bounds.y) return a.bounds.y - b.bounds.y;
  return a.bounds.x - b.bounds.x;
}

interface CellRange {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

function buildRegion(authorId: UserId, members: readonly BoardObject[], forceScattered: boolean): AuthorRegion {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const objectIds: ObjectId[] = [];
  for (const obj of members) {
    const x0 = Math.min(obj.x, obj.x + obj.w);
    const x1 = Math.max(obj.x, obj.x + obj.w);
    const y0 = Math.min(obj.y, obj.y + obj.h);
    const y1 = Math.max(obj.y, obj.y + obj.h);
    if (x0 < minX) minX = x0;
    if (y0 < minY) minY = y0;
    if (x1 > maxX) maxX = x1;
    if (y1 > maxY) maxY = y1;
    objectIds.push(obj.id);
  }
  const bounds: Rect = Object.freeze({ x: minX, y: minY, w: maxX - minX, h: maxY - minY });
  return Object.freeze({
    id: `${authorId}:${minX},${minY},${bounds.w},${bounds.h}`,
    authorId,
    bounds,
    rect: bounds,
    objectCount: members.length,
    objectIds: Object.freeze(objectIds),
    scattered: forceScattered || isScatteredRegion(members.length, bounds),
  });
}

/**
 * Regions are connected components (8-neighbour, `cellSize` grid) of
 * SUBSTANTIAL cells: cells holding a non-tiny object or at least
 * DENSE_TINY_PER_CELL tiny ones, so a drawing made of dots still counts.
 * Tiny marks beside a substantial cell join its region; every other tiny mark
 * is scattered, so sprinkled specks cannot hide inside a real drawing or
 * bridge two drawings into one.
 */
export function clusterAuthorRegions(
  authorId: UserId,
  objects: readonly BoardObject[],
  cellSize = REGION_CELL_SIZE,
): AuthorRegions {
  if (!Number.isFinite(cellSize) || cellSize <= 0) throw new Error('Invalid region cell size');
  const count = objects.length;
  const parents = objects.map((_, i) => i);
  function root(index: number): number {
    while (parents[index] !== index) {
      parents[index] = parents[parents[index]];
      index = parents[index];
    }
    return index;
  }
  function join(a: number, b: number): void {
    parents[root(a)] = root(b);
  }

  const ranges: CellRange[] = objects.map(obj => ({
    minX: Math.floor(Math.min(obj.x, obj.x + obj.w) / cellSize),
    maxX: Math.floor(Math.max(obj.x, obj.x + obj.w) / cellSize),
    minY: Math.floor(Math.min(obj.y, obj.y + obj.h) / cellSize),
    maxY: Math.floor(Math.max(obj.y, obj.y + obj.h) / cellSize),
  }));
  const tiny = objects.map(obj => Math.max(Math.abs(obj.w), Math.abs(obj.h)) < TINY_OBJECT_SIZE);
  // A tiny mark is assigned to the single cell of its top-left corner.
  const tinyCell = (i: number): string => `${ranges[i].minX},${ranges[i].minY}`;
  const tinyPerCell = new Map<string, number>();
  for (let i = 0; i < count; i++) {
    if (tiny[i]) tinyPerCell.set(tinyCell(i), (tinyPerCell.get(tinyCell(i)) ?? 0) + 1);
  }
  const substantial = objects.map((_, i) => !tiny[i] || (tinyPerCell.get(tinyCell(i)) ?? 0) >= DENSE_TINY_PER_CELL);

  // Pass 1: union substantial objects sharing a cell or any of its neighbours.
  const cellMap = new Map<string, number>();
  const large: number[] = [];
  for (let i = 0; i < count; i++) {
    if (!substantial[i]) continue;
    const range = tiny[i] ? { minX: ranges[i].minX, maxX: ranges[i].minX, minY: ranges[i].minY, maxY: ranges[i].minY } : ranges[i];
    if ((range.maxX - range.minX + 1) * (range.maxY - range.minY + 1) > MAX_INDEXED_CELLS) {
      large.push(i);
      continue;
    }
    for (let cx = range.minX; cx <= range.maxX; cx++) {
      for (let cy = range.minY; cy <= range.maxY; cy++) {
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            const neighbour = cellMap.get(`${cx + dx},${cy + dy}`);
            if (neighbour !== undefined) join(i, neighbour);
          }
        }
        cellMap.set(`${cx},${cy}`, i);
      }
    }
  }
  // Oversized objects are compared by cell range instead of enumerating cells.
  for (const i of large) {
    const a = ranges[i];
    for (let j = 0; j < count; j++) {
      if (!substantial[j] || j === i) continue;
      const b = ranges[j];
      if (a.minX <= b.maxX + 1 && b.minX <= a.maxX + 1 &&
          a.minY <= b.maxY + 1 && b.minY <= a.maxY + 1) join(i, j);
    }
  }

  // Pass 2: loose tiny marks either attach to an adjacent drawing or are
  // scattered. Attached marks are never registered, so they cannot chain.
  const scatteredCells = new Map<string, number>();
  const scattered: boolean[] = new Array<boolean>(count).fill(false);
  for (let i = 0; i < count; i++) {
    if (substantial[i]) continue;
    const cx = ranges[i].minX;
    const cy = ranges[i].minY;
    let anchor: number | undefined;
    for (let dx = -1; dx <= 1 && anchor === undefined; dx++) {
      for (let dy = -1; dy <= 1 && anchor === undefined; dy++) {
        anchor = cellMap.get(`${cx + dx},${cy + dy}`);
      }
    }
    if (anchor === undefined) {
      for (const j of large) {
        const b = ranges[j];
        if (cx >= b.minX - 1 && cx <= b.maxX + 1 && cy >= b.minY - 1 && cy <= b.maxY + 1) {
          anchor = j;
          break;
        }
      }
    }
    if (anchor !== undefined) {
      join(i, anchor);
      continue;
    }
    scattered[i] = true;
  }
  // Scattered marks that sit together form one stop when cycling through them.
  for (let i = 0; i < count; i++) {
    if (!scattered[i]) continue;
    const cx = ranges[i].minX;
    const cy = ranges[i].minY;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const neighbour = scatteredCells.get(`${cx + dx},${cy + dy}`);
        if (neighbour !== undefined) join(i, neighbour);
      }
    }
    scatteredCells.set(`${cx},${cy}`, i);
  }

  const components = new Map<number, BoardObject[]>();
  const componentScattered = new Map<number, boolean>();
  for (let i = 0; i < count; i++) {
    const key = root(i);
    const component = components.get(key);
    if (component) component.push(objects[i]);
    else components.set(key, [objects[i]]);
    if (scattered[i]) componentScattered.set(key, true);
  }
  const rawRegions: AuthorRegion[] = [];
  for (const [key, members] of components) {
    rawRegions.push(buildRegion(authorId, members, componentScattered.get(key) === true));
  }

  rawRegions.sort(compareRegions);
  const regions = Object.freeze(rawRegions.filter(r => !r.scattered));
  const scatteredRegions = Object.freeze(rawRegions.filter(r => r.scattered));
  const scatteredObjectCount = scatteredRegions.reduce((sum, r) => sum + r.objectCount, 0);

  return Object.freeze({
    authorId,
    userId: authorId,
    objectCount: count,
    regions,
    scatteredRegions,
    scatteredObjectCount,
    allRegions: Object.freeze(rawRegions),
  });
}

const defaultCache = new WeakMap<readonly BoardObject[], readonly AuthorRegions[]>();

export function computeAuthorRegions(
  objects: readonly BoardObject[],
  cellSize = REGION_CELL_SIZE,
): readonly AuthorRegions[] {
  if (cellSize === REGION_CELL_SIZE) {
    const cached = defaultCache.get(objects);
    if (cached) return cached;
  }

  const byAuthor = new Map<UserId, BoardObject[]>();
  for (let i = 0; i < objects.length; i++) {
    const obj = objects[i];
    let list = byAuthor.get(obj.createdBy);
    if (!list) {
      list = [];
      byAuthor.set(obj.createdBy, list);
    }
    list.push(obj);
  }

  const summaries: AuthorRegions[] = [];
  for (const [authorId, authorObjects] of byAuthor) {
    summaries.push(clusterAuthorRegions(authorId, authorObjects, cellSize));
  }

  summaries.sort((a, b) => {
    if (b.objectCount !== a.objectCount) return b.objectCount - a.objectCount;
    return a.authorId < b.authorId ? -1 : a.authorId > b.authorId ? 1 : 0;
  });

  const frozen = Object.freeze(summaries);
  if (cellSize === REGION_CELL_SIZE) {
    defaultCache.set(objects, frozen);
  }
  return frozen;
}

export function getAuthorRegions(store: Pick<BoardStore, 'getObjectsInRank'>): readonly AuthorRegions[] {
  return computeAuthorRegions(store.getObjectsInRank());
}
