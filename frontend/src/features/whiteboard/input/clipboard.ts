import { DEFAULT_TEXT_WIDTH, MAX_OBJECT_BODY_BYTES, MAX_TEXT_LENGTH } from '../contract';
import type { BoardObject, Point } from '../contract';
import { getBounds, unionBounds } from '../core';
import { DUPLICATE_OFFSET, createChange, existingObjects, makeText, safeDispatch, topRanks } from './objects';
import { insertCopies } from './shortcuts';
import type { ToolContext } from './types';

/**
 * In-memory board clipboard. Copy also writes plain text (the text of any
 * text/sticky objects) to the system clipboard through the copy event; a
 * later paste whose text equals that marker pastes the board objects, any
 * other text becomes a text object at the cursor. Image files on the system
 * clipboard never reach this module: the controller routes them to ingestion.
 */
export interface BoardClipboard {
  readonly objects: readonly BoardObject[];
  /** Plain text written to the system clipboard alongside the copy. */
  readonly text: string;
  /** How many times these objects have been pasted (cascades the offset). */
  pastes: number;
}

export function clipboardText(objects: readonly BoardObject[]): string {
  return objects.flatMap(object => object.kind === 'text' || object.kind === 'sticky' ? [object.text] : [])
    .filter(text => text !== '').join('\n\n');
}

export function copySelection(ctx: ToolContext): BoardClipboard | null {
  const objects = existingObjects(ctx.store, ctx.session.getState().selectedIds);
  if (objects.length === 0) return null;
  return { objects, text: clipboardText(objects), pastes: 0 };
}

/**
 * Paste board objects. With a cursor position the copies are centred on it;
 * without one they cascade by DUPLICATE_OFFSET from the originals.
 */
export function pasteObjects(ctx: ToolContext, clipboard: BoardClipboard, at: Point | null): string[] | null {
  let dx: number;
  let dy: number;
  if (at) {
    const bounds = unionBounds(clipboard.objects.map(getBounds));
    dx = at.x - (bounds.x + bounds.w / 2);
    dy = at.y - (bounds.y + bounds.h / 2);
  } else {
    const step = DUPLICATE_OFFSET * (clipboard.pastes + 1);
    dx = step;
    dy = step;
  }
  const ids = insertCopies(ctx, clipboard.objects, dx, dy, 'Paste');
  if (ids) clipboard.pastes++;
  return ids;
}

/** Normalise pasted text to the wire rules: LF newlines, no NUL, MAX_TEXT_LENGTH scalars. */
export function sanitizeText(text: string): string {
  const clean = text.replace(/\r\n?/g, '\n').replace(/\0/g, '');
  const scalars = Array.from(clean);
  return scalars.length > MAX_TEXT_LENGTH ? scalars.slice(0, MAX_TEXT_LENGTH).join('') : clean;
}

function bodyBytes(object: BoardObject): number {
  return new TextEncoder().encode(JSON.stringify(object)).byteLength;
}

/** Pasted plain text becomes a selected text object with its top-left at `at`. */
export function pasteText(ctx: ToolContext, text: string, at: Point): string | null {
  const clean = sanitizeText(text);
  if (clean.trim() === '') return null;
  const [rank] = topRanks(ctx.store, 1, false);
  const id = ctx.newId();
  const fixed = { ...ctx, newId: () => id };
  let scalars = Array.from(clean);
  let object = makeText(fixed, at, DEFAULT_TEXT_WIDTH, rank, clean);
  // The serialized body cap is stricter than the scalar cap for multi-byte text.
  while (bodyBytes(object) > MAX_OBJECT_BODY_BYTES && scalars.length > 1) {
    scalars = scalars.slice(0, Math.floor(scalars.length * 0.9));
    object = makeText(fixed, at, DEFAULT_TEXT_WIDTH, rank, scalars.join(''));
  }
  if (!safeDispatch(ctx.store, [createChange(object)], 'Paste', ctx.notify)) return null;
  ctx.session.setSelectedIds([object.id]);
  return object.id;
}

/**
 * Files carried by a paste/drop DataTransfer. Uses `files`, falling back to
 * `items` (some WebViews only fill one) -- never navigator.clipboard.read.
 * `imagesOnly` keeps just image/* entries (paste); drops pass every file on so
 * ingestion can say why a non-image was refused.
 */
export function filesOf(data: DataTransfer | null | undefined, imagesOnly: boolean): File[] {
  if (!data) return [];
  let files = Array.from(data.files ?? []);
  if (files.length === 0 && data.items) {
    files = Array.from(data.items).flatMap(item => {
      const file = item.kind === 'file' ? item.getAsFile() : null;
      return file ? [file] : [];
    });
  }
  return imagesOnly ? files.filter(file => file.type.startsWith('image/')) : files;
}

export function carriesFiles(data: DataTransfer | null | undefined): boolean {
  return !!data && Array.from(data.types ?? []).includes('Files');
}
