import type { Point } from '../../contract';
import type { Gesture, PointerDownInfo, ToolContext } from '../types';
import { objectAt } from '../objects';
import { isSoftLocked } from '../presence';
import { startCropping } from '../shortcuts';
import { createCreationGesture, createTextAt, isCreationTool } from './create';
import { createLaserGesture } from './laser';
import { createPanGesture } from './pan';
import { createPenGesture } from './pen';
import { beginSelect } from './select';

export * from './create';
export * from './laser';
export * from './pan';
export * from './pen';
export * from './select';

/**
 * The tool state machine's entry point: map a pointer-down to a gesture
 * (or null when the press does nothing). Middle button and Space always pan.
 */
export function beginGesture(ctx: ToolContext, down: PointerDownInfo): Gesture | null {
  if (down.button === 1 || (down.button === 0 && down.spaceHeld)) return createPanGesture(ctx, down.sample);
  if (down.button !== 0) return null;
  const tool = ctx.session.getState().tool;
  if (tool === 'hand') return createPanGesture(ctx, down.sample);
  if (tool === 'pen') return createPenGesture(ctx, down.sample);
  if (tool === 'laser') return createLaserGesture(ctx, down.sample);
  if (tool === 'image') {
    // 'image' only means "the picker is open": a press on the board dismisses it.
    ctx.session.setTool('select');
    return null;
  }
  if (isCreationTool(tool)) return createCreationGesture(ctx, tool, down.sample);
  return beginSelect(ctx, down);
}

/**
 * Double-click with the select tool: edit a text/sticky under the pointer,
 * crop an image under it, or create (and edit) a text object on empty canvas.
 * Returns true if handled.
 */
export function handleDoubleClick(ctx: ToolContext, world: Point): boolean {
  if (ctx.session.getState().tool !== 'select') return false;
  const hit = objectAt(ctx, world);
  if (hit) {
    if (hit.kind === 'image') return startCropping(ctx, hit.id);
    if (hit.kind !== 'text' && hit.kind !== 'sticky') return false;
    if (isSoftLocked(ctx, [hit.id], 'editing')) return true;
    ctx.session.setSelectedIds([hit.id]);
    ctx.session.setEditingId(hit.id);
    return true;
  }
  return createTextAt(ctx, world) !== null;
}
