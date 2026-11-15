import { describe, expect, it } from 'vitest';
import type { BoardObject } from '../contract';
import { rankPrefix } from '../core';
import { copySelection, pasteObjects } from './clipboard';
import { expandFrameSelection } from './frameCopy';
import { duplicateSelection } from './shortcuts';
import { createHarness, frameObject, rectObject } from './testUtils';

function frame(id: string, x: number, y: number, w: number, h: number, rank = '0:a0'): BoardObject {
  return frameObject({ id, x, y, w, h, rank });
}

function rect(id: string, x: number, y: number, w = 100, h = 100, rank = '1:a0'): BoardObject {
  return rectObject({ id, x, y, w, h, rank });
}

describe('expandFrameSelection', () => {
  it('includes the non-frame objects whose centre is inside a selected frame, in rank order', () => {
    const f = frame('f', 0, 0, 400, 300);
    const inside = rect('inside', 50, 50);
    const outside = rect('outside', 500, 500);
    expect(expandFrameSelection([f, inside, outside], ['f']).map(object => object.id)).toEqual(['f', 'inside']);
  });

  it('dedupes children that were also selected directly', () => {
    const f = frame('f', 0, 0, 400, 300);
    const child = rect('child', 50, 50);
    expect(expandFrameSelection([f, child], ['f', 'child']).map(object => object.id)).toEqual(['f', 'child']);
  });

  it('never pulls nested frames, but does pull objects inside both', () => {
    const outer = frame('outer', 0, 0, 1000, 1000, '0:a0');
    const inner = frame('inner', 100, 100, 400, 300, '0:a1');
    const child = rect('child', 150, 150); // centre (200,200): inside outer and inner
    // Frames never contain frames, so the outer frame carries the child but not `inner`.
    expect(expandFrameSelection([outer, inner, child], ['outer']).map(object => object.id)).toEqual(['outer', 'child']);
    // Selecting the inner frame too brings it (and the child, still once) along.
    expect(expandFrameSelection([outer, inner, child], ['outer', 'inner']).map(object => object.id)).toEqual(['outer', 'inner', 'child']);
  });

  it('dedupes a child shared by two overlapping selected frames', () => {
    const a = frame('a', 0, 0, 400, 300, '0:a0');
    const b = frame('b', 300, 200, 400, 300, '0:a1');
    const shared = rect('shared', 250, 250); // centre (300,300): inside a and b
    const onlyA = rect('onlyA', 50, 50);
    expect(expandFrameSelection([a, b, shared, onlyA], ['a', 'b']).map(object => object.id))
      .toEqual(['a', 'b', 'shared', 'onlyA']);
  });
});

describe('frame copy/duplicate', () => {
  it('duplicate carries a frame\'s children, mints new ids, keeps bands and selects the copies', () => {
    const f = frame('f', 0, 0, 400, 300, '0:a0');
    const child = rect('child', 50, 50, 100, 100, '1:a0');
    const other = rect('other', 900, 900, 100, 100, '1:a5');
    const h = createHarness([f, child, other]);
    h.session.setSelectedIds([f.id]);

    expect(duplicateSelection(h.ctx)).toBe(true);

    const copies = h.store.getObjectsInRank().filter(object => object.version === 0);
    expect(copies).toHaveLength(2);
    const frameCopy = copies.find(object => object.kind === 'frame')!;
    const childCopy = copies.find(object => object.kind === 'rect')!;
    expect(frameCopy.id).not.toBe(f.id);
    expect(childCopy.id).not.toBe(child.id);
    expect(rankPrefix(frameCopy.rank)).toBe('0');
    expect(rankPrefix(childCopy.rank)).toBe('1');
    expect(frameCopy).toMatchObject({ x: 16, y: 16 });
    expect(childCopy).toMatchObject({ x: 66, y: 66 });
    expect(h.session.getState().selectedIds).toEqual(copies.map(object => object.id));
  });

  it('does not duplicate a child that is also selected directly', () => {
    const f = frame('f', 0, 0, 400, 300, '0:a0');
    const child = rect('child', 50, 50, 100, 100, '1:a0');
    const h = createHarness([f, child]);
    h.session.setSelectedIds([f.id, child.id]);

    expect(duplicateSelection(h.ctx)).toBe(true);

    const copies = h.store.getObjectsInRank().filter(object => object.version === 0);
    expect(copies).toHaveLength(2);
  });

  it('copy then paste carries a frame\'s children and keeps their relative positions', () => {
    const f = frame('f', 100, 100, 400, 300, '0:a0');
    const child = rect('child', 150, 150, 100, 100, '1:a0');
    const h = createHarness([f, child]);
    h.session.setSelectedIds([f.id]);

    const clip = copySelection(h.ctx)!;
    expect(clip.objects.map(object => object.id)).toEqual(['f', 'child']);

    const ids = pasteObjects(h.ctx, clip, { x: 1000, y: 1000 })!;
    expect(ids).toHaveLength(2);
    const frameCopy = h.store.getObject(ids[0])!;
    const childCopy = h.store.getObject(ids[1])!;
    expect(frameCopy.kind).toBe('frame');
    expect(childCopy.kind).toBe('rect');
    expect(frameCopy.id).not.toBe(f.id);
    expect(childCopy.id).not.toBe(child.id);
    expect(childCopy.x - frameCopy.x).toBe(child.x - f.x);
    expect(childCopy.y - frameCopy.y).toBe(child.y - f.y);
    expect(h.session.getState().selectedIds).toEqual(ids);
  });
});
