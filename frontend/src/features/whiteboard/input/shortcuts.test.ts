import { describe, expect, it } from 'vitest';
import { MAX_TEXT_LENGTH } from '../contract';
import type { BoardObject, TextObject } from '../contract';
import { compareRank, rankPrefix } from '../core';
import { copySelection, pasteObjects, pasteText, sanitizeText } from './clipboard';
import {
  deleteSelection, duplicateSelection, editSelection, isComposing, isGuardedElement, matchShortcut,
  nudgeSelection, reorderSelection, selectAll,
} from './shortcuts';
import type { KeyInput } from './shortcuts';
import { createHarness, frameObject, rectObject, textObject } from './testUtils';
import { cameraForWheel, cameraToFit, normalizeWheel } from './wheel';

function key(key: string, extra: Partial<KeyInput> = {}): KeyInput {
  return { key, code: '', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...extra };
}

describe('matchShortcut', () => {
  it('maps tool keys and ignores them with modifiers', () => {
    expect(matchShortcut(key('v'))).toEqual({ type: 'tool', tool: 'select' });
    expect(matchShortcut(key('O'))).toEqual({ type: 'tool', tool: 'ellipse' });
    expect(matchShortcut(key('f'))).toEqual({ type: 'tool', tool: 'frame' });
    expect(matchShortcut(key('i'))).toEqual({ type: 'image' });
    expect(matchShortcut(key('v', { altKey: true }))).toBeNull();
    expect(matchShortcut(key('q'))).toBeNull();
  });

  it('maps edit commands with Ctrl or Cmd', () => {
    for (const mod of [{ ctrlKey: true }, { metaKey: true }]) {
      expect(matchShortcut(key('z', mod))).toEqual({ type: 'undo' });
      expect(matchShortcut(key('Z', { ...mod, shiftKey: true }))).toEqual({ type: 'redo' });
      expect(matchShortcut(key('a', mod))).toEqual({ type: 'select-all' });
      expect(matchShortcut(key('d', mod))).toEqual({ type: 'duplicate' });
      expect(matchShortcut(key('c', mod))).toEqual({ type: 'copy' });
      expect(matchShortcut(key('v', mod))).toBeNull(); // paste goes through the paste event
    }
    expect(matchShortcut(key('y', { ctrlKey: true }))).toEqual({ type: 'redo' });
  });

  it('maps nudges, ordering, delete, escape and zoom to fit', () => {
    expect(matchShortcut(key('ArrowLeft'))).toEqual({ type: 'nudge', dx: -1, dy: 0 });
    expect(matchShortcut(key('ArrowDown', { shiftKey: true }))).toEqual({ type: 'nudge', dx: 0, dy: 10 });
    expect(matchShortcut(key('['))).toEqual({ type: 'send-to-back' });
    expect(matchShortcut(key(']'))).toEqual({ type: 'bring-to-front' });
    expect(matchShortcut(key('Backspace'))).toEqual({ type: 'delete' });
    expect(matchShortcut(key('Delete'))).toEqual({ type: 'delete' });
    expect(matchShortcut(key('Escape'))).toEqual({ type: 'escape' });
    expect(matchShortcut(key('Enter'))).toEqual({ type: 'edit' });
    expect(matchShortcut(key('!', { code: 'Digit1', shiftKey: true }))).toEqual({ type: 'zoom-to-fit' });
  });

  it('detects IME composition', () => {
    expect(isComposing(key('a', { isComposing: true }))).toBe(true);
    expect(isComposing(key('Process'))).toBe(true);
    expect(isComposing(key('a', { keyCode: 229 }))).toBe(true);
    expect(isComposing(key('a'))).toBe(false);
  });

  it('guards inputs, textareas, contenteditable and data-wb-ui subtrees', () => {
    document.body.innerHTML = `
      <div id="canvas"></div><input id="input"><textarea id="ta"></textarea>
      <div contenteditable="true"><span id="ce"></span></div>
      <div data-wb-ui><button id="btn"></button></div>`;
    expect(isGuardedElement(document.getElementById('canvas'))).toBe(false);
    for (const id of ['input', 'ta', 'ce', 'btn']) expect(isGuardedElement(document.getElementById(id))).toBe(true);
    expect(isGuardedElement(null)).toBe(false);
  });
});

describe('selection commands', () => {
  function board(): { h: ReturnType<typeof createHarness>; a: BoardObject; b: BoardObject } {
    const a = rectObject({ rank: '1:a0' });
    const b = rectObject({ x: 200, rank: '1:a1' });
    return { h: createHarness([a, b]), a, b };
  }

  it('delete removes the selection in one command and clears it; undo restores', () => {
    const { h, a, b } = board();
    h.session.setSelectedIds([a.id, b.id]);
    expect(deleteSelection(h.ctx)).toBe(true);
    expect(h.dispatch).toHaveBeenCalledTimes(1);
    expect(h.store.getObjectIds()).toEqual([]);
    expect(h.session.getState().selectedIds).toEqual([]);
    h.ackAll();
    h.store.undo();
    expect(h.store.getObjectIds()).toHaveLength(2);
  });

  it('select all, nudge and reorder', () => {
    const { h, a, b } = board();
    selectAll(h.ctx);
    expect(h.session.getState().selectedIds).toEqual([a.id, b.id]);
    nudgeSelection(h.ctx, 10, -1);
    expect(h.store.getObject(b.id)).toMatchObject({ x: 210, y: -1 });
    h.session.setSelectedIds([a.id]);
    reorderSelection(h.ctx, true);
    expect(h.store.getObjectIds()).toEqual([b.id, a.id]);
    reorderSelection(h.ctx, false);
    expect(h.store.getObjectIds()).toEqual([a.id, b.id]);
    expect(h.dispatch).toHaveBeenCalledTimes(3);
  });

  it('duplicate mints new ids and top ranks, keeps frames in their band and selects the copies', () => {
    const frame = frameObject();
    const a = rectObject({ rank: '1:a0' });
    const top = rectObject({ rank: '1:a5', x: 900 });
    const h = createHarness([frame, a, top]);
    h.session.setSelectedIds([frame.id, a.id]);
    expect(duplicateSelection(h.ctx)).toBe(true);
    const copies = h.store.getObjectsInRank().filter(object => object.version === 0);
    expect(copies).toHaveLength(2);
    expect(copies.every(copy => copy.id !== frame.id && copy.id !== a.id)).toBe(true);
    const frameCopy = copies.find(copy => copy.kind === 'frame')!;
    const rectCopy = copies.find(copy => copy.kind === 'rect')!;
    expect(rankPrefix(frameCopy.rank)).toBe('0');
    expect(compareRank(rectCopy.rank, top.rank)).toBe(1);
    expect(rectCopy).toMatchObject({ x: 16, y: 16 });
    expect(h.session.getState().selectedIds).toEqual(copies.map(copy => copy.id));
  });

  it('enter edits a single selected text or sticky only', () => {
    const t = textObject();
    const r = rectObject();
    const h = createHarness([t, r]);
    h.session.setSelectedIds([r.id]);
    expect(editSelection(h.ctx)).toBe(false);
    h.session.setSelectedIds([t.id]);
    expect(editSelection(h.ctx)).toBe(true);
    expect(h.session.getState().editingId).toBe(t.id);
  });
});

describe('clipboard', () => {
  it('copy then paste at the cursor centres fresh copies there', () => {
    const a = rectObject({ x: 0, y: 0, w: 100, h: 100 });
    const h = createHarness([a]);
    h.session.setSelectedIds([a.id]);
    const clip = copySelection(h.ctx)!;
    const ids = pasteObjects(h.ctx, clip, { x: 1000, y: 1000 })!;
    expect(ids).toHaveLength(1);
    expect(ids[0]).not.toBe(a.id);
    const copy = h.store.getObject(ids[0])!;
    // rect bounds include half the stroke width; the centre is unaffected.
    expect(copy.x + copy.w / 2).toBeCloseTo(1000);
    expect(copy.y + copy.h / 2).toBeCloseTo(1000);
  });

  it('paste without a cursor cascades', () => {
    const a = rectObject();
    const h = createHarness([a]);
    h.session.setSelectedIds([a.id]);
    const clip = copySelection(h.ctx)!;
    pasteObjects(h.ctx, clip, null);
    pasteObjects(h.ctx, clip, null);
    const xs = h.store.getObjectsInRank().map(object => object.x).sort((x, y) => x - y);
    expect(xs).toEqual([0, 16, 32]);
  });

  it('pasted text becomes a selected text object, sanitised', () => {
    const h = createHarness();
    const id = pasteText(h.ctx, 'one\r\ntwo\0', { x: 5, y: 6 })!;
    const text = h.store.getObject(id) as TextObject;
    expect(text).toMatchObject({ kind: 'text', x: 5, y: 6, text: 'one\ntwo' });
    expect(h.session.getState().selectedIds).toEqual([id]);
    expect(pasteText(h.ctx, '   ', { x: 0, y: 0 })).toBeNull();
    expect(Array.from(sanitizeText('ğ'.repeat(MAX_TEXT_LENGTH + 5)))).toHaveLength(MAX_TEXT_LENGTH);
  });

  it('copy text carries text and sticky contents', () => {
    const t = textObject({ text: 'hello' });
    const h = createHarness([t]);
    h.session.setSelectedIds([t.id]);
    expect(copySelection(h.ctx)!.text).toBe('hello');
  });
});

describe('wheel and zoom', () => {
  const wheel = { deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, metaKey: false, shiftKey: false };

  it('normalises line and page deltas', () => {
    expect(normalizeWheel({ ...wheel, deltaY: 3, deltaMode: 1 }, 800)).toEqual({ x: 0, y: 48 });
    expect(normalizeWheel({ ...wheel, deltaY: 1, deltaMode: 2 }, 800)).toEqual({ x: 0, y: 800 });
    expect(normalizeWheel({ ...wheel, deltaY: 10, shiftKey: true }, 800)).toEqual({ x: 10, y: 0 });
  });

  it('plain wheel pans', () => {
    expect(cameraForWheel({ x: 0, y: 0, zoom: 2 }, { ...wheel, deltaX: 5, deltaY: 20 }, { x: 0, y: 0 }, 800))
      .toEqual({ x: -5, y: -20, zoom: 2 });
  });

  it('ctrl/meta wheel zooms around the cursor, keeping the world point fixed', () => {
    const camera = { x: 37, y: -12, zoom: 1.3 };
    const cursor = { x: 420, y: 260 };
    const worldBefore = { x: (cursor.x - camera.x) / camera.zoom, y: (cursor.y - camera.y) / camera.zoom };
    for (const mod of [{ ctrlKey: true }, { metaKey: true }]) {
      const next = cameraForWheel(camera, { ...wheel, ...mod, deltaY: -8 }, cursor, 800);
      expect(next.zoom).toBeGreaterThan(camera.zoom);
      expect((cursor.x - next.x) / next.zoom).toBeCloseTo(worldBefore.x, 9);
      expect((cursor.y - next.y) / next.zoom).toBeCloseTo(worldBefore.y, 9);
    }
    // A coarse mouse notch is clamped to one comfortable step; zoom stays within limits.
    const big = cameraForWheel({ x: 0, y: 0, zoom: 1 }, { ...wheel, ctrlKey: true, deltaY: 1000 }, cursor, 800);
    expect(big.zoom).toBeCloseTo(Math.exp(-0.4));
    expect(cameraForWheel({ x: 0, y: 0, zoom: 4 }, { ...wheel, ctrlKey: true, deltaY: -40 }, cursor, 800).zoom).toBe(4);
  });

  it('zoom to fit frames every object, null on an empty board', () => {
    expect(cameraToFit([], { x: 0, y: 0, w: 800, h: 600 })).toBeNull();
    const camera = cameraToFit([rectObject({ x: 1000, y: 1000, w: 200, h: 100 })], { x: 0, y: 0, w: 800, h: 600 })!;
    expect((400 - camera.x) / camera.zoom).toBeCloseTo(1100);
  });
});
