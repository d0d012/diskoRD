import {
  DEFAULT_LINE_LENGTH, DEFAULT_TEXT_WIDTH, LINE_SNAP_DEGREES, MIN_RESIZE_SIZE, MIN_SHAPE_DRAG_DISTANCE_PX,
} from '../../contract';
import type { BoardObject, Point, ToolId } from '../../contract';
import {
  EMPTY_PREVIEW, centredRect, clearPreview, createChange, defaultShapeSize, makeFrame, makeLine,
  makeShape, makeSticky, makeText, rectFromPoints, safeDispatch, screenDistance, topRanks,
} from '../objects';
import type { Gesture, PointerSample, ToolContext } from '../types';

export type CreationTool = Extract<ToolId, 'rect' | 'ellipse' | 'frame' | 'sticky' | 'text' | 'line' | 'arrow'>;

export const CREATION_TOOLS: readonly CreationTool[] = ['rect', 'ellipse', 'frame', 'sticky', 'text', 'line', 'arrow'];

export function isCreationTool(tool: ToolId): tool is CreationTool {
  return (CREATION_TOOLS as readonly ToolId[]).includes(tool);
}

/** Pen and arrow stay active after use; every other tool returns to select. */
export function staysActive(tool: ToolId): boolean {
  return tool === 'pen' || tool === 'arrow';
}

function snapDirection(anchor: Point, point: Point): Point {
  const dx = point.x - anchor.x;
  const dy = point.y - anchor.y;
  const length = Math.hypot(dx, dy);
  const step = (LINE_SNAP_DEGREES * Math.PI) / 180;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: anchor.x + Math.cos(angle) * length, y: anchor.y + Math.sin(angle) * length };
}

/** Square the drag rectangle around `start` (Shift on shapes/frames). */
function squareEnd(start: Point, point: Point): Point {
  const size = Math.max(Math.abs(point.x - start.x), Math.abs(point.y - start.y));
  return { x: start.x + Math.sign(point.x - start.x || 1) * size, y: start.y + Math.sign(point.y - start.y || 1) * size };
}

/**
 * Build the object a creation gesture would produce. `dragged` is false when
 * the pointer travelled less than MIN_SHAPE_DRAG_DISTANCE_PX on screen: then
 * the default-sized object is created at the press point instead of a speck.
 * The object id is fixed by the caller so preview and commit share it.
 */
export function buildCreation(
  ctx: ToolContext,
  tool: CreationTool,
  start: Point,
  current: Point,
  dragged: boolean,
  shiftKey: boolean,
  id: string,
): BoardObject {
  const fixedId = { ...ctx, newId: () => id };
  const frame = tool === 'frame';
  const [rank] = topRanks(ctx.store, 1, frame);
  switch (tool) {
    case 'rect':
    case 'ellipse':
    case 'frame': {
      let bounds;
      if (dragged) {
        const rect = rectFromPoints(start, shiftKey ? squareEnd(start, current) : current);
        // A purely horizontal/vertical drag must not produce a zero-extent box.
        bounds = { ...rect, w: Math.max(rect.w, MIN_RESIZE_SIZE), h: Math.max(rect.h, MIN_RESIZE_SIZE) };
      } else {
        const size = defaultShapeSize(tool);
        bounds = centredRect(start, size.w, size.h);
      }
      return tool === 'frame' ? makeFrame(fixedId, bounds, rank) : makeShape(fixedId, tool, bounds, rank);
    }
    case 'sticky':
      // Decision: stickies have one base size; a drag only places them.
      return makeSticky(fixedId, start, rank);
    case 'text': {
      const width = dragged ? Math.max(Math.abs(current.x - start.x), 1) : DEFAULT_TEXT_WIDTH;
      const origin = dragged ? { x: Math.min(start.x, current.x), y: Math.min(start.y, current.y) } : start;
      return makeText(fixedId, origin, width, rank);
    }
    case 'line':
    case 'arrow': {
      const end = dragged
        ? (shiftKey ? snapDirection(start, current) : current)
        : { x: start.x + DEFAULT_LINE_LENGTH, y: start.y };
      return makeLine(fixedId, tool, start, end, rank);
    }
  }
}

/** Shared tail of every creation: select it, maybe edit it, maybe return to select. */
export function afterCreate(ctx: ToolContext, tool: ToolId, object: BoardObject): void {
  const { session } = ctx;
  session.setSelectedIds([object.id]);
  if (!staysActive(tool)) session.setTool('select');
  if (object.kind === 'text' || object.kind === 'sticky') session.setEditingId(object.id);
}

export function createCreationGesture(ctx: ToolContext, tool: CreationTool, start: PointerSample): Gesture {
  const { runtime, store } = ctx;
  const id = ctx.newId();
  let dragged = false;
  let done = false;

  function build(sample: PointerSample): BoardObject {
    return buildCreation(ctx, tool, start.world, sample.world, dragged, sample.shiftKey, id);
  }

  return {
    kind: 'creating',
    move(sample) {
      if (done) return;
      if (!dragged && screenDistance(sample.screen, start.screen) < MIN_SHAPE_DRAG_DISTANCE_PX) return;
      dragged = true;
      runtime.setPreview({ ...EMPTY_PREVIEW, objects: [build(sample)] });
    },
    end(sample) {
      if (done) return;
      done = true;
      if (!dragged && screenDistance(sample.screen, start.screen) >= MIN_SHAPE_DRAG_DISTANCE_PX) dragged = true;
      const object = build(sample);
      const opId = safeDispatch(store, [createChange(object)], 'Create', ctx.notify);
      clearPreview(runtime);
      if (opId) afterCreate(ctx, tool, object);
    },
    cancel() {
      if (done) return;
      done = true;
      clearPreview(runtime);
    },
  };
}

/** Double-click on empty canvas: a default text object at the point, in edit mode. */
export function createTextAt(ctx: ToolContext, world: Point): BoardObject | null {
  const [rank] = topRanks(ctx.store, 1, false);
  const object = makeText(ctx, world, DEFAULT_TEXT_WIDTH, rank);
  if (!safeDispatch(ctx.store, [createChange(object)], 'Create', ctx.notify)) return null;
  afterCreate(ctx, 'text', object);
  return object;
}
