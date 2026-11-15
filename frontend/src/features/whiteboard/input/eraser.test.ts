import { describe, expect, it } from 'vitest';
import { ERASER_RADIUS_PX } from '../contract';
import type { BoardObject, Change, StrokeObject } from '../contract';
import { createHarness, rectObject, sample } from './testUtils';
import type { Harness } from './testUtils';
import { beginGesture } from './tools';
import type { PointerDownInfo, PointerSample } from './types';

const OTHER = '00000000-0000-4000-8000-0000000000ff';

function stroke(id: string, x: number, y: number, points: [number, number][], overrides: Partial<StrokeObject> = {}): StrokeObject {
  const xs = points.map(p => p[0]);
  const ys = points.map(p => p[1]);
  return {
    id, kind: 'stroke', rank: '1:a0', version: 1, createdBy: OTHER, x, y,
    w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys),
    points: points.map(([px, py]) => ({ x: px, y: py, pressure: 0.5 })),
    preset: 'pen', style: { colour: 'ink', weight: 'thin' }, ...overrides,
  };
}

function down(s: PointerSample): PointerDownInfo {
  return { sample: s, button: 0, handle: null, frameLabelId: null, spaceHeld: false };
}

function erase(h: Harness, path: [number, number][]): void {
  h.session.setTool('eraser');
  const gesture = beginGesture(h.ctx, down(sample({ x: path[0][0], y: path[0][1] })))!;
  for (const [x, y] of path.slice(1, -1)) gesture.move(sample({ x, y }));
  const end = path[path.length - 1];
  gesture.end(sample({ x: end[0], y: end[1] }));
}

function changes(h: Harness): Change[] {
  return h.dispatch.mock.calls.flatMap(call => call[0] as Change[]);
}

const LINE_ID = '30000000-0000-4000-8000-000000000001';

describe('eraser', () => {
  it('cuts a stroke where it is touched: the original keeps one side, a new stroke gets the other', () => {
    const h = createHarness([stroke(LINE_ID, 0, 0, [[0, 0], [200, 0]])]);
    erase(h, [[100, -40], [100, 40]]);
    expect(h.dispatch).toHaveBeenCalledTimes(1);
    const list = changes(h);
    expect(list.map(change => change.action).sort()).toEqual(['create', 'update']);
    const update = list.find(change => change.action === 'update')!;
    const create = list.find(change => change.action === 'create')!;
    expect(update.id).toBe(LINE_ID);
    const after = h.store.getObject(LINE_ID) as StrokeObject;
    const created = create.action === 'create' ? create.body as StrokeObject : null;
    expect(created).toMatchObject({ kind: 'stroke', createdBy: h.ctx.userId, rank: '1:a0', preset: 'pen' });
    // Together the two pieces cover the line except a gap around x = 100.
    const spans = [after, created!].map(piece => [piece.x, piece.x + piece.w]).sort((a, b) => a[0] - b[0]);
    expect(spans[0][0]).toBe(0);
    expect(spans[0][1]).toBeLessThan(100 - ERASER_RADIUS_PX + 2);
    expect(spans[1][0]).toBeGreaterThan(100 + ERASER_RADIUS_PX - 2);
    expect(spans[1][1]).toBe(200);
    expect(after.createdBy).toBe(OTHER);
    expect(h.runtime.getPreview().objects).toHaveLength(0);
    expect(h.session.getState().tool).toBe('eraser');
  });

  it('deletes a stroke that is rubbed out completely', () => {
    const h = createHarness([stroke(LINE_ID, 0, 0, [[0, 0], [40, 0]])]);
    erase(h, [[-10, 0], [20, 0], [50, 0]]);
    expect(changes(h)).toEqual([expect.objectContaining({ id: LINE_ID, action: 'delete' })]);
    expect(h.store.getObject(LINE_ID)).toBeUndefined();
  });

  it('removes a dot and leaves shapes and untouched strokes alone', () => {
    const dotId = '30000000-0000-4000-8000-000000000002';
    const farId = '30000000-0000-4000-8000-000000000003';
    const rect = rectObject({ x: -20, y: -20, w: 40, h: 40 }) as BoardObject;
    const h = createHarness([
      stroke(dotId, 0, 0, [[0, 0]]), stroke(farId, 500, 500, [[0, 0], [50, 0]]), rect,
    ]);
    erase(h, [[0, 0], [1, 0]]);
    expect(changes(h)).toEqual([expect.objectContaining({ id: dotId, action: 'delete' })]);
    expect(h.store.getObject(rect.id)).toBeDefined();
    expect(h.store.getObject(farId)).toBeDefined();
  });

  it('dispatches nothing when the eraser touches no stroke', () => {
    const h = createHarness([stroke(LINE_ID, 0, 0, [[0, 0], [200, 0]])]);
    erase(h, [[0, 300], [200, 300]]);
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it('previews the cut live and hides the original while erasing; cancel restores it', () => {
    const h = createHarness([stroke(LINE_ID, 0, 0, [[0, 0], [200, 0]])]);
    h.session.setTool('eraser');
    const gesture = beginGesture(h.ctx, down(sample({ x: 100, y: -40 })))!;
    gesture.move(sample({ x: 100, y: 40 }));
    const preview = h.runtime.getPreview();
    expect(preview.hiddenIds).toEqual([LINE_ID]);
    expect(preview.objects).toHaveLength(2);
    gesture.cancel();
    expect(h.runtime.getPreview().objects).toHaveLength(0);
    expect(h.dispatch).not.toHaveBeenCalled();
    expect((h.store.getObject(LINE_ID) as StrokeObject).w).toBe(200);
  });

  it('two passes over one stroke in a single gesture leave three pieces in one command', () => {
    const h = createHarness([stroke(LINE_ID, 0, 0, [[0, 0], [300, 0]])]);
    erase(h, [[100, -40], [100, 40], [200, 40], [200, -40]]);
    expect(h.dispatch).toHaveBeenCalledTimes(1);
    const list = changes(h);
    expect(list.filter(change => change.action === 'update')).toHaveLength(1);
    expect(list.filter(change => change.action === 'create')).toHaveLength(2);
  });

  it('reaches further when zoomed out, since the eraser is sized in screen pixels', () => {
    const h = createHarness([stroke(LINE_ID, 0, 0, [[0, 0], [2000, 0]])], { zoom: 0.1 });
    erase(h, [[1000, 100], [1000, 101]]);
    // 12 px at 10% zoom is 120 world units, so a pass 100 units away still cuts.
    expect(changes(h).some(change => change.action === 'update')).toBe(true);
  });

  it('drops the erased stroke from the selection', () => {
    const h = createHarness([stroke(LINE_ID, 0, 0, [[0, 0], [200, 0]])]);
    h.session.setSelectedIds([LINE_ID]);
    erase(h, [[100, -40], [100, 40]]);
    expect(h.session.getState().selectedIds).toEqual([]);
  });
});
