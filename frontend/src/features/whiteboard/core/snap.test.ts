import { describe, expect, it } from 'vitest';
import { selectionBounds, snapBounds, snapCandidates, snapResize } from './snap';
import { resizeBox } from './resize';
import type { Point, ResizeHandleId } from '../contract';

const box = { x: 100, y: 200, w: 80, h: 60 };
describe('snapBounds', () => {
  it.each([0, .5, 1])('aligns moving anchor %s to every target edge/centre', anchor => {
    for (const targetAnchor of [0, .5, 1]) {
      const moving = { x: box.x + box.w * targetAnchor - 20 * anchor + 3, y: 400, w: 20, h: 20 };
      const result = snapBounds(moving, [box], 1, { x: [anchor], y: [] });
      expect(result.dx).toBe(-3);
      expect(result.guides).toEqual([{ axis: 'x', value: box.x + box.w * targetAnchor, from: 200, to: 420 }]);
    }
  });
  it.each([.1, .5, 1, 2, 4])('uses six screen pixels at zoom %s (inclusive)', zoom => {
    const point = { x: 100 - 6 / zoom, y: 0, w: 0, h: 0 };
    expect(snapBounds(point, [box], zoom).dx).toBeCloseTo(6 / zoom);
    expect(snapBounds({ ...point, x: point.x - .001 }, [box], zoom).guides).toEqual([]);
  });
  it('snaps both axes, spanning the corrected moving box and target', () => {
    const result = snapBounds({ x: 97, y: 196, w: 20, h: 20 }, [box], 1);
    expect(result).toMatchObject({ dx: 3, dy: 4 });
    expect(result.guides).toEqual([{ axis: 'x', value: 100, from: 200, to: 260 }, { axis: 'y', value: 200, from: 100, to: 180 }]);
  });
  it('chooses nearest alignment, not first candidate', () => {
    expect(snapBounds({ x: 0, y: 0, w: 0, h: 0 }, [{ x: 5, y: 80, w: 0, h: 0 }, { x: -2, y: 80, w: 0, h: 0 }], 1).dx).toBe(-2);
  });
  it('ties are stable and inputs are untouched', () => {
    const moving = Object.freeze({ x: 0, y: 0, w: 0, h: 0 });
    expect(snapBounds(moving, [{ x: -2, y: 80, w: 0, h: 0 }, { x: 2, y: 80, w: 0, h: 0 }], 1).dx).toBe(-2);
  });
  it('handles empty candidates and restricted axes', () => {
    expect(snapBounds(box, [], 1)).toEqual({ dx: 0, dy: 0, guides: [] });
    expect(snapBounds(box, [box], 1, { x: [], y: [] }).guides).toEqual([]);
  });
});
describe('snapResize', () => {
  it.each(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as ResizeHandleId[])('snaps only active edges/centres for %s', handle => {
    const original = { x: 0, y: 0, w: 100, h: 100 };
    const pointer = { x: handle.includes('w') ? -17 : 117, y: handle.includes('n') ? -17 : 117 };
    const compute = (point: Point) => resizeBox(original, handle, point, { minWidth: 1, minHeight: 1, keepAspect: false });
    const target = { x: handle.includes('w') ? -20 : 120, y: handle.includes('n') ? -20 : 120, w: 0, h: 0 };
    const result = snapResize(compute(pointer), [target], 1, handle, pointer, compute);
    const actual = compute(result.point);
    expect(result.guides.length).toBe(handle.length === 2 ? 2 : 1);
    if (handle.includes('w')) { expect(actual.x).toBe(-20); expect(actual.x + actual.w).toBe(100); }
    if (handle.includes('e')) { expect(actual.w).toBe(120); expect(actual.x).toBe(0); }
    if (handle.includes('n')) { expect(actual.y).toBe(-20); expect(actual.y + actual.h).toBe(100); }
    if (handle.includes('s')) { expect(actual.h).toBe(120); expect(actual.y).toBe(0); }
  });
  it('doubles the edge adjustment when snapping the moving centre', () => {
    const pointer = { x: 197, y: 0 };
    const compute = (p: Point) => ({ x: 0, y: 0, w: p.x, h: 20 });
    const result = snapResize(compute(pointer), [{ x: 100, y: 200, w: 0, h: 0 }], 1, 'e', pointer, compute);
    expect(result.point.x).toBe(200);
    expect(result.guides[0].value).toBe(100);
  });
  it('does not force impossible min-size alignments or show false guides', () => {
    const pointer = { x: 5, y: 0 };
    const compute = (p: Point) => ({ x: 0, y: 0, w: Math.max(10, p.x), h: 20 });
    const result = snapResize(compute(pointer), [{ x: 8, y: 200, w: 0, h: 0 }], 1, 'e', pointer, compute);
    expect(result.point).toEqual(pointer); expect(result.guides).toEqual([]);
  });
  it('preserves aspect when independent axes cannot both align', () => {
    const pointer = { x: 117, y: 116 };
    const compute = (p: Point) => resizeBox({ x: 0, y: 0, w: 100, h: 100 }, 'se', p, { minWidth: 1, minHeight: 1, keepAspect: true });
    const result = snapResize(compute(pointer), [{ x: 120, y: 121, w: 0, h: 0 }], 1, 'se', pointer, compute);
    expect(result.guides).toHaveLength(1);
    const actual = compute(result.point);
    expect(actual.w).toBe(actual.h);
    for (const guide of result.guides) expect(guide.value).toBe(guide.axis === 'x' ? actual.w : actual.h);
  });
  it('leaves endpoint snapping out of scope', () => {
    const pointer = { x: 99, y: 200 };
    expect(snapResize(box, [box], 1, 'end', pointer, () => box)).toEqual({ point: pointer, guides: [] });
  });
});
describe('candidate budget and selection bounds', () => {
  it('includes intersections and margin, excludes distant objects', () => {
    const objects = [{ x: -100, y: 0, w: 101, h: 10 }, { x: 110, y: 0, w: 1, h: 1 }, { x: 111, y: 0, w: 1, h: 1 }];
    expect(snapCandidates(objects, { x: 0, y: 0, w: 100, h: 100 }, { x: 0, y: 0 }, 10)).toEqual(objects.slice(0, 2));
  });
  it('caps at 300 nearest, not input order', () => {
    const objects = Array.from({ length: 500 }, (_, x) => ({ x, y: 0, w: 0, h: 0 })).reverse();
    const result = snapCandidates(objects, { x: 0, y: 0, w: 500, h: 1 }, { x: 0, y: 0 }, 0);
    expect(result).toHaveLength(300); expect(result[0].x).toBe(0); expect(result[299].x).toBe(299);
  });
  it('unions selections with negative coordinates and zero extents', () => {
    expect(selectionBounds([{ x: -20, y: -10, w: 0, h: 0 }, { x: 0, y: 0, w: 50, h: 40 }])).toEqual({ x: -20, y: -10, w: 70, h: 50 });
    expect(selectionBounds([])).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });
});
