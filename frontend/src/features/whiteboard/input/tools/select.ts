import { MAX_CHANGES_PER_COMMAND, MIN_RESIZE_SIZE } from '../../contract';
import type { BoardObject, HandleId, ObjectId, ObjectPatch, Point, Rect } from '../../contract';
import { hitTestMarquee, objectsInsideFrame, resizeObject } from '../../core';
import { textObjectHeight } from '../../editing/measure';
import type { ResizeResult } from '../../core';
import {
  CLICK_SLOP_PX, EMPTY_PREVIEW, TOO_MANY_CHANGES_MESSAGE, clearPreview, existingObjects, objectAt, rectFromPoints,
  reportRefusal, safeDispatch, sameIds, screenDistance, translated, updateChange,
} from '../objects';
import type { Gesture, PointerDownInfo, PointerSample, ToolContext } from '../types';
import { isSoftLocked } from '../presence';

function refusedGesture(kind: Gesture['kind']): Gesture {
  return { kind, move() {}, end() {}, cancel() {} };
}

/**
 * Select tool. Pointer-down decides between:
 * - a handle (`data-wb-handle`) of a single selected object: resize / endpoint drag;
 * - an object hit by core geometry (frames only by label or border): select + translate;
 * - empty space (including a frame's interior): marquee.
 */
export function beginSelect(ctx: ToolContext, down: PointerDownInfo): Gesture {
  const { session, store } = ctx;
  const selected = session.getState().selectedIds;

  if (down.handle && selected.length === 1) {
    const object = store.getObject(selected[0]);
    if (object && canDragHandle(object, down.handle)) {
      return createResizeGesture(ctx, object, down.handle, down.sample);
    }
  }

  const labelled = down.frameLabelId ? store.getObject(down.frameLabelId) : undefined;
  const hit = labelled?.kind === 'frame' ? labelled : objectAt(ctx, down.sample.world);
  if (!hit) return createMarqueeGesture(ctx, down.sample);

  const alreadySelected = selected.includes(hit.id);
  let ids: readonly ObjectId[];
  let clickSelection: readonly ObjectId[];
  if (down.sample.shiftKey) {
    // Shift adds now; shift-click (no drag) on an already selected object removes it.
    ids = alreadySelected ? selected : [...selected, hit.id];
    clickSelection = alreadySelected ? selected.filter(id => id !== hit.id) : ids;
  } else {
    ids = alreadySelected ? selected : [hit.id];
    clickSelection = [hit.id];
  }
  if (!sameIds(ids, selected)) session.setSelectedIds(ids);
  return createTranslateGesture(ctx, ids, down.sample, clickSelection);
}

/** Whether `handle` is meaningful for this object kind (mirrors core/resize). */
export function canDragHandle(object: BoardObject, handle: HandleId): boolean {
  const endpoint = handle === 'start' || handle === 'end';
  switch (object.kind) {
    case 'line':
    case 'arrow':
      return endpoint;
    case 'sticky':
      return false;
    case 'text':
      return !endpoint && handle !== 'n' && handle !== 's';
    case 'image':
      return handle === 'nw' || handle === 'ne' || handle === 'se' || handle === 'sw';
    default:
      return !endpoint;
  }
}

/* ------------------------------------------------------------------ marquee */

export function createMarqueeGesture(ctx: ToolContext, start: PointerSample): Gesture {
  const { runtime, session, store } = ctx;
  const base = start.shiftKey ? session.getState().selectedIds : [];
  let dragging = false;
  let done = false;

  function marquee(sample: PointerSample): Rect {
    return rectFromPoints(start.world, sample.world);
  }

  return {
    kind: 'marquee',
    move(sample) {
      if (done) return;
      if (!dragging && screenDistance(sample.screen, start.screen) < CLICK_SLOP_PX) return;
      dragging = true;
      runtime.setPreview({ ...EMPTY_PREVIEW, marquee: marquee(sample) });
    },
    end(sample) {
      if (done) return;
      done = true;
      clearPreview(runtime);
      if (!dragging && screenDistance(sample.screen, start.screen) >= CLICK_SLOP_PX) dragging = true;
      if (!dragging) {
        if (!start.shiftKey) session.setSelectedIds([]);
        return;
      }
      const rect = marquee(sample);
      const hits = store.getObjectsInRank().filter(object => hitTestMarquee(object, rect)).map(object => object.id);
      session.setSelectedIds([...base, ...hits.filter(id => !base.includes(id))]);
    },
    cancel() {
      if (done) return;
      done = true;
      clearPreview(runtime);
    },
  };
}

/* ---------------------------------------------------------------- translate */

/**
 * Ids moved by dragging `ids`: the selection plus, for every selected frame,
 * the non-frame objects whose centre is inside it right now (pointer-down).
 */
export function collectMovedIds(objects: readonly BoardObject[], ids: readonly ObjectId[]): ObjectId[] {
  const wanted = new Set(ids);
  const moved = new Set<ObjectId>();
  for (const object of objects) {
    if (!wanted.has(object.id)) continue;
    moved.add(object.id);
    if (object.kind === 'frame') for (const inner of objectsInsideFrame(object, objects)) moved.add(inner);
  }
  return objects.filter(object => moved.has(object.id)).map(object => object.id);
}

export function createTranslateGesture(
  ctx: ToolContext,
  ids: readonly ObjectId[],
  start: PointerSample,
  clickSelection: readonly ObjectId[],
): Gesture {
  const { runtime, session, store } = ctx;
  const all = store.getObjectsInRank();
  const originals = existingObjects(store, collectMovedIds(all, ids));
  if (isSoftLocked(ctx, originals.map(object => object.id), 'moving')) return refusedGesture('translating');
  // Contract: refuse a move larger than one command instead of splitting it.
  const refused = originals.length > MAX_CHANGES_PER_COMMAND;
  let dragging = false;
  let done = false;
  let dx = 0;
  let dy = 0;

  function update(sample: PointerSample): void {
    dx = sample.world.x - start.world.x;
    dy = sample.world.y - start.world.y;
  }

  return {
    kind: 'translating',
    move(sample) {
      if (done) return;
      if (!dragging && screenDistance(sample.screen, start.screen) < CLICK_SLOP_PX) return;
      dragging = true;
      if (refused) return;
      update(sample);
      runtime.setPreview({ ...EMPTY_PREVIEW, objects: originals.map(object => translated(object, dx, dy)) });
      ctx.presence?.send({ drag: { ids: originals.map(object => object.id), dx, dy } });
    },
    end(sample) {
      if (done) return;
      done = true;
      if (!dragging && screenDistance(sample.screen, start.screen) >= CLICK_SLOP_PX) dragging = true;
      if (!dragging) {
        ctx.presence?.send({ drag: null });
        clearPreview(runtime);
        if (!sameIds(clickSelection, session.getState().selectedIds)) session.setSelectedIds(clickSelection);
        return;
      }
      if (refused) {
        reportRefusal(ctx.notify, 'too-many-changes', `${TOO_MANY_CHANGES_MESSAGE} (at most ${MAX_CHANGES_PER_COMMAND}).`);
      } else update(sample);
      const changes = refused || (dx === 0 && dy === 0) ? [] : originals.flatMap(original => {
        // Patch from what the user saw at pointer-down; version from the store now.
        const current = store.getObject(original.id);
        return current ? [updateChange(current, { x: original.x + dx, y: original.y + dy })] : [];
      });
      ctx.presence?.send({ drag: null });
      if (changes.length > 0) safeDispatch(store, changes, 'Move', ctx.notify);
      clearPreview(runtime);
    },
    cancel() {
      if (done) return;
      done = true;
      ctx.presence?.send({ drag: null });
      clearPreview(runtime);
    },
  };
}

/* ------------------------------------------------------------------- resize */

export function resizePatch(object: BoardObject, result: ResizeResult): ObjectPatch {
  const bounds = { x: result.bounds.x, y: result.bounds.y, w: result.bounds.w, h: result.bounds.h };
  switch (result.kind) {
    case 'box':
      return bounds;
    case 'stroke':
      return { ...bounds, points: result.points };
    case 'line':
      return { ...bounds, start: result.start, end: result.end };
    case 'text': {
      if (object.kind !== 'text') return bounds;
      const style = object.style.size !== result.size ? { ...object.style, size: result.size } : object.style;
      // Reflow/size step changes the wrapped height: re-measure it like the editor does.
      const h = textObjectHeight({ text: object.text, w: bounds.w, style });
      return style === object.style ? { ...bounds, h } : { ...bounds, h, style };
    }
  }
}

function applyPatch(object: BoardObject, patch: ObjectPatch): BoardObject {
  return { ...object, ...patch } as BoardObject;
}

function patchChanges(object: BoardObject, patch: ObjectPatch): boolean {
  const record = object as unknown as Record<string, unknown>;
  return Object.entries(patch).some(([key, value]) => JSON.stringify(record[key]) !== JSON.stringify(value));
}

export function createResizeGesture(
  ctx: ToolContext,
  object: BoardObject,
  handle: HandleId,
  start: PointerSample,
): Gesture {
  const { runtime, store } = ctx;
  const endpoint = handle === 'start' || handle === 'end';
  if (isSoftLocked(ctx, [object.id], 'moving')) return refusedGesture(endpoint ? 'endpoint-dragging' : 'resizing');
  // Offset between the grabbed point and the handle's exact position is ignored:
  // handles are small, and core/resize works from the pointer position.
  let patch: ObjectPatch | null = null;
  let dragging = false;
  let done = false;

  function compute(sample: PointerSample): ObjectPatch | null {
    try {
      const result = resizeObject(object, handle, sample.world as Point, {
        minSize: MIN_RESIZE_SIZE,
        keepAspect: sample.shiftKey,
        snap: sample.shiftKey,
      });
      return resizePatch(object, result);
    } catch {
      return null;
    }
  }

  return {
    kind: endpoint ? 'endpoint-dragging' : 'resizing',
    move(sample) {
      if (done) return;
      if (!dragging && screenDistance(sample.screen, start.screen) < CLICK_SLOP_PX) return;
      dragging = true;
      patch = compute(sample);
      if (patch) runtime.setPreview({ ...EMPTY_PREVIEW, objects: [applyPatch(object, patch)] });
    },
    end(sample) {
      if (done) return;
      done = true;
      if (!dragging && screenDistance(sample.screen, start.screen) >= CLICK_SLOP_PX) dragging = true;
      if (dragging) patch = compute(sample);
      const current = store.getObject(object.id);
      if (dragging && patch && current && patchChanges(current, patch)) {
        safeDispatch(store, [updateChange(current, patch)], endpoint ? 'Move endpoint' : 'Resize', ctx.notify);
      }
      clearPreview(runtime);
    },
    cancel() {
      if (done) return;
      done = true;
      clearPreview(runtime);
    },
  };
}
