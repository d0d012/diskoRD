import type { BoardObject, ObjectPatch, ToolId } from '../contract';
import { bringToFront, sendToBack } from '../core';
import { filterVisibleObjects } from '../state';
import {
  DUPLICATE_OFFSET, createChange, deleteChange, existingObjects, safeDispatch, sameIds, topRanks,
  translated, updateChange,
} from './objects';
import type { ToolContext } from './types';
import { isSoftLocked } from './presence';

export interface KeyInput {
  readonly key: string;
  readonly code: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly isComposing?: boolean;
  readonly keyCode?: number;
}

export type ShortcutAction =
  | { readonly type: 'tool'; readonly tool: Exclude<ToolId, 'image'> }
  | { readonly type: 'image' }
  | { readonly type: 'delete' }
  | { readonly type: 'select-all' }
  | { readonly type: 'duplicate' }
  | { readonly type: 'copy' }
  | { readonly type: 'cut' }
  | { readonly type: 'nudge'; readonly dx: number; readonly dy: number }
  | { readonly type: 'send-to-back' }
  | { readonly type: 'bring-to-front' }
  | { readonly type: 'undo' }
  | { readonly type: 'redo' }
  | { readonly type: 'zoom-to-fit' }
  | { readonly type: 'escape' }
  | { readonly type: 'edit' }
  | { readonly type: 'export' }
  | { readonly type: 'stamp' };

export const TOOL_KEYS: Readonly<Record<string, Exclude<ToolId, 'image' | 'stamp'>>> = {
  v: 'select', h: 'hand', p: 'pen', e: 'eraser', q: 'laser', s: 'sticky', r: 'rect', o: 'ellipse',
  l: 'line', a: 'arrow', t: 'text', f: 'frame',
};

export const NUDGE_STEP = 1;
export const NUDGE_STEP_LARGE = 10;

/** IME composition: never treat these keystrokes as shortcuts. */
export function isComposing(event: KeyInput): boolean {
  return event.isComposing === true || event.keyCode === 229 || event.key === 'Process';
}

/**
 * True when keyboard input belongs to something else: an input, textarea,
 * select, contenteditable, or anything inside `[data-wb-ui]` (toolbar,
 * popovers, the text editor).
 */
export function isGuardedElement(element: Element | null | undefined): boolean {
  if (!element || typeof element.closest !== 'function') return false;
  if (element.closest('[data-wb-ui]')) return true;
  if (element.closest('[data-wb-checkbox-line], [data-wb-reaction], [data-wb-reaction-trigger]')) return false;
  if (element.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]')) return true;
  return (element as HTMLElement).isContentEditable === true;
}

/** Pure key → action mapping; the controller applies guards first. */
export function matchShortcut(event: KeyInput): ShortcutAction | null {
  const mod = event.ctrlKey || event.metaKey;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;

  if (mod && !event.altKey) {
    if (key === 'z') return event.shiftKey ? { type: 'redo' } : { type: 'undo' };
    if (key === 'y' && !event.shiftKey) return { type: 'redo' };
    if (key === 'a' && !event.shiftKey) return { type: 'select-all' };
    if (key === 'd' && !event.shiftKey) return { type: 'duplicate' };
    if (key === 'c' && !event.shiftKey) return { type: 'copy' };
    if (key === 'x' && !event.shiftKey) return { type: 'cut' };
    if (key === 'e' && event.shiftKey) return { type: 'export' };
    return null;
  }
  if (mod || event.altKey) return null;

  if (event.shiftKey && event.code === 'Digit1') return { type: 'zoom-to-fit' };
  switch (event.key) {
    case 'Escape': return { type: 'escape' };
    case 'Delete':
    case 'Backspace': return { type: 'delete' };
    case 'Enter': return event.shiftKey ? null : { type: 'edit' };
    case '[': return { type: 'send-to-back' };
    case ']': return { type: 'bring-to-front' };
  }
  const step = event.shiftKey ? NUDGE_STEP_LARGE : NUDGE_STEP;
  switch (event.key) {
    case 'ArrowLeft': return { type: 'nudge', dx: -step, dy: 0 };
    case 'ArrowRight': return { type: 'nudge', dx: step, dy: 0 };
    case 'ArrowUp': return { type: 'nudge', dx: 0, dy: -step };
    case 'ArrowDown': return { type: 'nudge', dx: 0, dy: step };
  }
  if (event.shiftKey) return null;
  if (key === 'i') return { type: 'image' };
  if (key === 'k') return { type: 'stamp' };
  const tool = TOOL_KEYS[key];
  return tool ? { type: 'tool', tool } : null;
}

/* --------------------------------------------------------------- commands */

function selection(ctx: ToolContext): BoardObject[] {
  return existingObjects(ctx.store, ctx.session.getState().selectedIds);
}

export function deleteSelection(ctx: ToolContext): boolean {
  const objects = selection(ctx);
  if (objects.length === 0) return false;
  const ok = safeDispatch(ctx.store, objects.map(deleteChange), 'Delete', ctx.notify) !== null;
  if (ok) ctx.session.setSelectedIds([]);
  return ok;
}

export function selectAll(ctx: ToolContext): void {
  const ids = filterVisibleObjects(ctx.store.getObjectsInRank(), ctx.session).map(object => object.id);
  if (!sameIds(ids, ctx.session.getState().selectedIds)) ctx.session.setSelectedIds(ids);
}

export function nudgeSelection(ctx: ToolContext, dx: number, dy: number): boolean {
  const objects = selection(ctx);
  if (objects.length === 0 || isSoftLocked(ctx, objects.map(object => object.id), 'moving')) return false;
  return safeDispatch(
    ctx.store,
    objects.map(object => updateChange(object, { x: object.x + dx, y: object.y + dy } as ObjectPatch)),
    'Nudge',
    ctx.notify,
  ) !== null;
}

export function reorderSelection(ctx: ToolContext, toFront: boolean): boolean {
  const objects = selection(ctx);
  if (objects.length === 0) return false;
  const ranks = (toFront ? bringToFront : sendToBack)(objects, ctx.store.getObjectsInRank());
  const changes = objects.flatMap((object, index) =>
    ranks[index] === object.rank ? [] : [updateChange(object, { rank: ranks[index] })]);
  return safeDispatch(ctx.store, changes, toFront ? 'Bring to front' : 'Send to back', ctx.notify) !== null;
}

/** Enter crop mode on one image (selecting it). True when handled, including a soft-lock refusal. */
export function startCropping(ctx: ToolContext, id: string): boolean {
  if (isSoftLocked(ctx, [id], 'moving')) return true;
  ctx.session.setSelectedIds([id]);
  ctx.session.setCroppingId(id);
  return true;
}

export function editSelection(ctx: ToolContext): boolean {
  const ids = ctx.session.getState().selectedIds;
  if (ids.length !== 1) return false;
  const object = ctx.store.getObject(ids[0]);
  if (object?.kind === 'image') return startCropping(ctx, object.id);
  if (!object || (object.kind !== 'text' && object.kind !== 'sticky')) return false;
  if (isSoftLocked(ctx, [object.id], 'editing')) return true;
  ctx.session.setEditingId(object.id);
  return true;
}

/**
 * Re-create `sources` (any board's objects) as new objects: fresh ids
 * (contract: never reuse ids), version 0, ranks on top of their own band
 * preserving relative order, translated by (dx, dy). One command; selects
 * the copies. Returns the new ids, or null if refused.
 */
export function insertCopies(ctx: ToolContext, sources: readonly BoardObject[], dx: number, dy: number, label: string): string[] | null {
  if (sources.length === 0) return null;
  const frames = sources.filter(object => object.kind === 'frame');
  const others = sources.filter(object => object.kind !== 'frame');
  const frameRanks = topRanks(ctx.store, frames.length, true);
  const otherRanks = topRanks(ctx.store, others.length, false);
  const copies = [
    ...frames.map((object, index) => ({ object, rank: frameRanks[index] })),
    ...others.map((object, index) => ({ object, rank: otherRanks[index] })),
  ].map(({ object, rank }) => {
    const moved = translated(object, dx, dy);
    if (moved.kind === 'sticky' && 'reactions' in moved) {
      const rest = { ...moved };
      delete (rest as { reactions?: unknown }).reactions;
      return { ...rest, id: ctx.newId(), rank, version: 0, createdBy: ctx.userId } as BoardObject;
    }
    return { ...moved, id: ctx.newId(), rank, version: 0, createdBy: ctx.userId } as BoardObject;
  });
  if (!safeDispatch(ctx.store, copies.map(createChange), label, ctx.notify)) return null;
  const ids = copies.map(copy => copy.id);
  ctx.session.setSelectedIds(ids);
  return ids;
}

export function duplicateSelection(ctx: ToolContext): boolean {
  return insertCopies(ctx, selection(ctx), DUPLICATE_OFFSET, DUPLICATE_OFFSET, 'Duplicate') !== null;
}
