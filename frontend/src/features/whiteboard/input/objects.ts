import {
  DEFAULT_FRAME_HEIGHT, DEFAULT_FRAME_WIDTH, DEFAULT_SHAPE_HEIGHT, DEFAULT_SHAPE_WIDTH,
  DEFAULT_TEXT_WIDTH, MAX_CHANGES_PER_COMMAND, MAX_COMMAND_BYTES, MAX_OBJECTS_PER_BOARD,
  MAX_OBJECTS_PER_USER, MAX_PLACEMENT_MARGIN, STICKY_BASE_HEIGHT, STICKY_BASE_WIDTH, TEXT_SIZE_WORLD_UNITS,
} from '../contract';
import type {
  BoardObject, BoardStore, Change, ObjectId, ObjectPatch, OpId, Point, Rank, Rect,
  RuntimePreview, Runtime, TextObject, StickyObject, FrameObject, LineObject, ArrowObject,
  RectObject, EllipseObject,
} from '../contract';
import { rankBetweenMany, rankPrefix, topmostObjectAtPoint } from '../core';
import { TEXT_LINE_HEIGHT, textObjectHeight } from '../editing/measure';
import { filterVisibleObjects } from '../state';
import type { BoardNoticeKind, BoardNotify } from '../state';
import type { ToolContext } from './types';

/**
 * Shared, pure-ish helpers for tools and shortcuts: object factories, ranks,
 * hit testing and the single guarded dispatch path.
 */

export const EMPTY_PREVIEW: RuntimePreview = Object.freeze({
  objects: Object.freeze([]) as readonly BoardObject[],
  hiddenIds: Object.freeze([]) as readonly ObjectId[],
  marquee: null,
});

/** Screen pixels a pointer may wander before a press becomes a drag. */
export const CLICK_SLOP_PX = 3;
/** Screen-pixel hit tolerance, converted to world units at the current zoom. */
export const HIT_TOLERANCE_PX = 4;
/** World-unit offset for duplicate and same-place paste. */
export const DUPLICATE_OFFSET = 16;
/** Decision: new frames get this label. */
export const DEFAULT_FRAME_LABEL = 'Frame';

export function clearPreview(runtime: Runtime): void {
  const current = runtime.getPreview();
  if (current.objects.length === 0 && current.hiddenIds.length === 0 && current.marquee === null) return;
  runtime.setPreview(EMPTY_PREVIEW);
}

export function hitTolerance(runtime: Runtime): number {
  return HIT_TOLERANCE_PX / runtime.getCamera().zoom;
}

export function objectAt(ctx: ToolContext, world: Point): BoardObject | undefined {
  const candidates = filterVisibleObjects(ctx.store.getObjectsInRank(), ctx.session);
  return topmostObjectAtPoint(candidates, world, hitTolerance(ctx.runtime));
}

export function screenDistance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function rectFromPoints(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

export function centredRect(centre: Point, w: number, h: number): Rect {
  return { x: centre.x - w / 2, y: centre.y - h / 2, w, h };
}

/** One line box, exactly as the editor/renderer lay text out. */
export function textLineHeight(size: TextObject['style']['size']): number {
  return TEXT_SIZE_WORLD_UNITS[size] * TEXT_LINE_HEIGHT;
}

/**
 * `n` ascending ranks above everything in a partition ('0' frames, '1' others),
 * so new objects land on top of their band.
 */
export function topRanks(store: BoardStore, n: number, frame: boolean): Rank[] {
  if (n <= 0) return [];
  const prefix = frame ? '0' : '1';
  const ordered = store.getObjectsInRank();
  let max: Rank | null = null;
  for (let i = ordered.length - 1; i >= 0; i--) {
    if (rankPrefix(ordered[i].rank) === prefix) {
      max = ordered[i].rank;
      break;
    }
  }
  return rankBetweenMany(max, null, n, prefix);
}

type Base = Pick<BoardObject, 'id' | 'rank' | 'version' | 'createdBy'>;

function base(ctx: ToolContext, rank: Rank): Base {
  return { id: ctx.newId(), rank, version: 0, createdBy: ctx.userId };
}

export function makeShape(ctx: ToolContext, kind: 'rect' | 'ellipse', bounds: Rect, rank: Rank): RectObject | EllipseObject {
  return { ...base(ctx, rank), kind, ...bounds, style: ctx.session.getState().styleDefaults.shape } as RectObject | EllipseObject;
}

export function makeFrame(ctx: ToolContext, bounds: Rect, rank: Rank): FrameObject {
  return {
    ...base(ctx, rank), kind: 'frame', ...bounds, label: DEFAULT_FRAME_LABEL,
    style: ctx.session.getState().styleDefaults.frame,
  };
}

export function makeSticky(ctx: ToolContext, centre: Point, rank: Rank): StickyObject {
  return {
    ...base(ctx, rank), kind: 'sticky', ...centredRect(centre, STICKY_BASE_WIDTH, STICKY_BASE_HEIGHT),
    text: '', style: ctx.session.getState().styleDefaults.sticky,
  };
}

/** Text objects get the editor's measured height (one line when empty). */
export function makeText(ctx: ToolContext, origin: Point, width: number, rank: Rank, text = ''): TextObject {
  const style = ctx.session.getState().styleDefaults.text;
  return {
    ...base(ctx, rank), kind: 'text', x: origin.x, y: origin.y, w: width,
    h: textObjectHeight({ text, w: width, style }), text, style,
  };
}

export function makeLine(ctx: ToolContext, kind: 'line' | 'arrow', start: Point, end: Point, rank: Rank): LineObject | ArrowObject {
  const bounds = rectFromPoints(start, end);
  return {
    ...base(ctx, rank), kind, ...bounds,
    start: { x: start.x - bounds.x, y: start.y - bounds.y },
    end: { x: end.x - bounds.x, y: end.y - bounds.y },
    style: ctx.session.getState().styleDefaults.stroke,
  } as LineObject | ArrowObject;
}

export function defaultShapeSize(kind: 'rect' | 'ellipse' | 'frame'): { w: number; h: number } {
  return kind === 'frame'
    ? { w: DEFAULT_FRAME_WIDTH, h: DEFAULT_FRAME_HEIGHT }
    : { w: DEFAULT_SHAPE_WIDTH, h: DEFAULT_SHAPE_HEIGHT };
}

export { DEFAULT_TEXT_WIDTH };

export function createChange(body: BoardObject): Change {
  return { id: body.id, action: 'create', expectedVersion: 0, body };
}

/** Update against the object's current visible version, as the store requires. */
export function updateChange(object: BoardObject, patch: ObjectPatch): Change {
  return { id: object.id, action: 'update', expectedVersion: object.version, patch };
}

export function deleteChange(object: BoardObject): Change {
  return { id: object.id, action: 'delete', expectedVersion: object.version };
}

export function translatePatch(object: BoardObject, dx: number, dy: number): ObjectPatch {
  return { x: object.x + dx, y: object.y + dy };
}

export function translated<T extends BoardObject>(object: T, dx: number, dy: number): T {
  return { ...object, x: object.x + dx, y: object.y + dy };
}

/** Refused-action reporting: always a dev console.warn, plus the UI notice if wired. */
export function reportRefusal(
  notify: BoardNotify | undefined, kind: BoardNoticeKind, message: string, detail?: unknown,
): void {
  if (import.meta.env.DEV) console.warn(`whiteboard: command refused (${kind}): ${message}`, ...(detail === undefined ? [] : [detail]));
  notify?.(kind, message);
}

export const TOO_MANY_CHANGES_MESSAGE = 'Too many objects selected for one action';

const commandEncoder = new TextEncoder();

/** UTF-8 JSON byte total of a command's create bodies plus update patches. */
export function commandBytes(changes: readonly Change[]): number {
  let bytes = 0;
  for (const change of changes) {
    if (change.action === 'create') bytes += commandEncoder.encode(JSON.stringify(change.body)).byteLength;
    else if (change.action === 'update') bytes += commandEncoder.encode(JSON.stringify(change.patch)).byteLength;
  }
  return bytes;
}

/**
 * The single dispatch path. Refuses (returns null) empty commands, commands
 * over MAX_CHANGES_PER_COMMAND or MAX_COMMAND_BYTES (never split into several
 * writes), creates that would exceed MAX_OBJECTS_PER_BOARD, and anything the
 * store rejects. Every refusal except an empty command is reported through `notify`.
 */
export function safeDispatch(store: BoardStore, changes: readonly Change[], label?: string, notify?: BoardNotify): OpId | null {
  if (changes.length === 0) return null;
  if (changes.length > MAX_CHANGES_PER_COMMAND) {
    reportRefusal(notify, 'too-many-changes', `${TOO_MANY_CHANGES_MESSAGE} (at most ${MAX_CHANGES_PER_COMMAND}).`);
    return null;
  }
  if (commandBytes(changes) > MAX_COMMAND_BYTES) {
    reportRefusal(notify, 'too-many-changes', `${TOO_MANY_CHANGES_MESSAGE} (at most 1 MB).`);
    return null;
  }
  const creates = changes.filter(change => change.action === 'create').length;
  const deletes = changes.filter(change => change.action === 'delete').length;
  if (creates > 0 && store.getObjectIds().length - deletes + creates > MAX_OBJECTS_PER_BOARD) {
    reportRefusal(notify, 'board-full', `This board is full (at most ${MAX_OBJECTS_PER_BOARD} objects).`);
    return null;
  }
  const allObjects = store.getObjectsInRank();
  if (creates > 0) {
    // Do not guess the actor from a create body: the store stamps its bound user.
    const currentUserId = store.getUserId?.();
    if (currentUserId) {
      let ownCount = 0;
      for (const obj of allObjects) {
        if (obj.createdBy === currentUserId) ownCount++;
      }
      let ownDeletes = 0;
      for (const change of changes) {
        if (change.action === 'delete' && store.getObject(change.id)?.createdBy === currentUserId) {
          ownDeletes++;
        }
      }
      if (ownCount - ownDeletes + creates > MAX_OBJECTS_PER_USER) {
        reportRefusal(notify, 'board-full', `You can hold at most ${MAX_OBJECTS_PER_USER} objects on a board.`);
        return null;
      }
    }
  }
  const placed: Rect[] = [];
  for (const change of changes) {
    if (change.action === 'create') {
      placed.push(change.body);
    } else if (change.action === 'update') {
      const current = store.getObject(change.id);
      if (!current) continue;
      const next = {
        x: change.patch.x ?? current.x, y: change.patch.y ?? current.y,
        w: change.patch.w ?? current.w, h: change.patch.h ?? current.h,
      };
      // The server compares resulting geometry, not the presence of patch keys.
      if (next.x !== current.x || next.y !== current.y || next.w !== current.w || next.h !== current.h) {
        placed.push(next);
      }
    }
  }
  // All touched objects are excluded from C, even deletes and style-only edits.
  const touchedIds = new Set(changes.map(change => change.id));
  const untouched = placed.length ? allObjects.filter(obj => !touchedIds.has(obj.id)) : [];
  if (untouched.length > 0) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const obj of untouched) {
      if (obj.x < minX) minX = obj.x;
      if (obj.y < minY) minY = obj.y;
      if (obj.x + obj.w > maxX) maxX = obj.x + obj.w;
      if (obj.y + obj.h > maxY) maxY = obj.y + obj.h;
    }
    const allowedMinX = minX - MAX_PLACEMENT_MARGIN;
    const allowedMinY = minY - MAX_PLACEMENT_MARGIN;
    const allowedMaxX = maxX + MAX_PLACEMENT_MARGIN;
    const allowedMaxY = maxY + MAX_PLACEMENT_MARGIN;
    // Containment of every resulting box is equivalent to containment of their union N.
    for (const next of placed) {
      if (next.x < allowedMinX || next.y < allowedMinY || next.x + next.w > allowedMaxX || next.y + next.h > allowedMaxY) {
        reportRefusal(notify, 'refused', 'Too far from existing content.');
        return null;
      }
    }
  }
  try {
    return store.dispatch(changes, label ? { label } : undefined);
  } catch (error) {
    reportRefusal(notify, 'refused', 'That change could not be applied.', error);
    return null;
  }
}

/** Existing objects for ids, in rank order, skipping ids that vanished. */
export function existingObjects(store: BoardStore, ids: readonly ObjectId[]): BoardObject[] {
  const wanted = new Set(ids);
  return store.getObjectsInRank().filter(object => wanted.has(object.id));
}

export function sameIds(a: readonly ObjectId[], b: readonly ObjectId[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}
