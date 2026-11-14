import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FRAME_HEIGHT, DEFAULT_FRAME_WIDTH, DEFAULT_LINE_LENGTH, DEFAULT_SHAPE_HEIGHT, DEFAULT_SHAPE_WIDTH,
  MAX_CHANGES_PER_COMMAND, STICKY_BASE_WIDTH,
} from '../contract';
import type { ArrowObject, BoardObject, FrameObject, StrokeObject, TextObject } from '../contract';
import { rankPrefix } from '../core';
import { EMPTY_PREVIEW } from './objects';
import { createHarness, frameObject, lineObject, rectObject, sample, textObject } from './testUtils';
import type { Harness } from './testUtils';
import { beginGesture, handleDoubleClick } from './tools';
import type { Gesture, PointerDownInfo, PointerSample } from './types';

function down(s: PointerSample, extra: Partial<PointerDownInfo> = {}): PointerDownInfo {
  return { sample: s, button: 0, handle: null, frameLabelId: null, spaceHeld: false, ...extra };
}

function drag(h: Harness, from: PointerSample, path: PointerSample[], extra: Partial<PointerDownInfo> = {}): Gesture {
  const gesture = beginGesture(h.ctx, down(from, extra));
  if (!gesture) throw new Error('no gesture');
  for (const point of path.slice(0, -1)) gesture.move(point);
  gesture.end(path[path.length - 1] ?? from);
  return gesture;
}

function created(h: Harness): BoardObject[] {
  return h.store.getObjectsInRank().filter(object => object.version === 0);
}

function expectPreviewCleared(h: Harness): void {
  expect(h.runtime.getPreview()).toEqual(EMPTY_PREVIEW);
}

describe('creation tools', () => {
  it('drag creates a rect from the drag rectangle with one dispatch, then returns to select', () => {
    const h = createHarness();
    h.session.setTool('rect');
    drag(h, sample({ x: 10, y: 20 }), [sample({ x: 50, y: 60 }), sample({ x: 110, y: 80 })]);
    expect(h.dispatch).toHaveBeenCalledTimes(1);
    const [rect] = created(h);
    expect(rect).toMatchObject({ kind: 'rect', x: 10, y: 20, w: 100, h: 60, style: h.session.getState().styleDefaults.shape });
    expect(rankPrefix(rect.rank)).toBe('1');
    expect(h.session.getState()).toMatchObject({ tool: 'select', selectedIds: [rect.id], editingId: null });
    expect(h.runtime.previews.length).toBeGreaterThan(1);
    expectPreviewCleared(h);
  });

  it('a drag under the minimum distance creates the default-sized object centred on the press', () => {
    const h = createHarness();
    h.session.setTool('ellipse');
    drag(h, sample({ x: 100, y: 100 }), [sample({ x: 103, y: 102 })]);
    expect(created(h)[0]).toMatchObject({
      kind: 'ellipse', w: DEFAULT_SHAPE_WIDTH, h: DEFAULT_SHAPE_HEIGHT,
      x: 100 - DEFAULT_SHAPE_WIDTH / 2, y: 100 - DEFAULT_SHAPE_HEIGHT / 2,
    });
  });

  it('the minimum distance is in screen pixels, not world units', () => {
    const h = createHarness([], { zoom: 4 });
    h.session.setTool('rect');
    // 3 world units at zoom 4 = 12 screen px: a real drag.
    drag(h, sample({ x: 0, y: 0 }, {}, 4), [sample({ x: 3, y: 3 }, {}, 4)]);
    expect(created(h)[0]).toMatchObject({ w: 3, h: 3 });
  });

  it('Shift squares shapes', () => {
    const h = createHarness();
    h.session.setTool('rect');
    drag(h, sample({ x: 0, y: 0 }), [sample({ x: 100, y: 40 }, { shiftKey: true })]);
    expect(created(h)[0]).toMatchObject({ w: 100, h: 100 });
  });

  it('frames go to the frame rank band and default to the frame size', () => {
    const h = createHarness([rectObject({ rank: '1:a5' })]);
    h.session.setTool('frame');
    drag(h, sample({ x: 0, y: 0 }), [sample({ x: 0, y: 0 })]);
    const frame = created(h)[0] as FrameObject;
    expect(frame).toMatchObject({ kind: 'frame', w: DEFAULT_FRAME_WIDTH, h: DEFAULT_FRAME_HEIGHT });
    expect(rankPrefix(frame.rank)).toBe('0');
  });

  it('new objects rank above everything in their band', () => {
    const h = createHarness([rectObject({ rank: '1:a5' }), rectObject({ rank: '1:Zz' })]);
    h.session.setTool('rect');
    drag(h, sample({ x: 0, y: 0 }), [sample({ x: 0, y: 0 })]);
    const ordered = h.store.getObjectsInRank();
    expect(ordered[ordered.length - 1].version).toBe(0);
  });

  it('sticky and text creation start editing', () => {
    for (const tool of ['sticky', 'text'] as const) {
      const h = createHarness();
      h.session.setTool(tool);
      drag(h, sample({ x: 300, y: 300 }), [sample({ x: 300, y: 300 })]);
      const object = created(h)[0];
      expect(object.kind).toBe(tool);
      if (tool === 'sticky') expect(object).toMatchObject({ x: 300 - STICKY_BASE_WIDTH / 2, text: '' });
      expect(h.session.getState()).toMatchObject({ tool: 'select', editingId: object.id, selectedIds: [object.id] });
    }
  });

  it('arrow stays active, click creates the default length, Shift snaps to 15 degrees', () => {
    const h = createHarness();
    h.session.setTool('arrow');
    drag(h, sample({ x: 0, y: 0 }), [sample({ x: 1, y: 1 })]);
    expect(created(h)[0]).toMatchObject({ kind: 'arrow', w: DEFAULT_LINE_LENGTH, h: 0 });
    expect(h.session.getState().tool).toBe('arrow');

    drag(h, sample({ x: 0, y: 0 }), [sample({ x: 100, y: 3 }, { shiftKey: true })]);
    const arrows = created(h) as ArrowObject[];
    const snapped = arrows.find(arrow => arrow.w !== DEFAULT_LINE_LENGTH)!;
    expect(snapped.h).toBeCloseTo(0, 9);
    expect(snapped.end.x).toBeGreaterThan(snapped.start.x);
  });

  it('line returns to select', () => {
    const h = createHarness();
    h.session.setTool('line');
    drag(h, sample({ x: 0, y: 0 }), [sample({ x: 40, y: 30 })]);
    expect(created(h)[0]).toMatchObject({ kind: 'line', x: 0, y: 0, w: 40, h: 30, start: { x: 0, y: 0 }, end: { x: 40, y: 30 } });
    expect(h.session.getState().tool).toBe('select');
  });

  it('cancel dispatches nothing and clears the preview', () => {
    const h = createHarness();
    h.session.setTool('rect');
    const gesture = beginGesture(h.ctx, down(sample({ x: 0, y: 0 })))!;
    gesture.move(sample({ x: 50, y: 50 }));
    expect(h.runtime.getPreview().objects).toHaveLength(1);
    gesture.cancel();
    gesture.end(sample({ x: 60, y: 60 }));
    expect(h.dispatch).not.toHaveBeenCalled();
    expectPreviewCleared(h);
    expect(h.session.getState().tool).toBe('rect');
  });

  it("image tool ('picker open') returns to select on a board press without a gesture", () => {
    const h = createHarness();
    h.session.setTool('image');
    expect(beginGesture(h.ctx, down(sample({ x: 0, y: 0 })))).toBeNull();
    expect(h.session.getState().tool).toBe('select');
  });
});

describe('pen', () => {
  it('collects coalesced samples with pressure, previews live and stays active', () => {
    const h = createHarness();
    h.session.setTool('pen');
    const gesture = beginGesture(h.ctx, down(sample({ x: 0, y: 0 }, { pressure: 0.2 })))!;
    gesture.move(sample({ x: 20, y: 0 }), [sample({ x: 10, y: 5 }, { pressure: 0.9 }), sample({ x: 20, y: 0 })]);
    const live = h.runtime.getPreview().objects[0] as StrokeObject;
    expect(live.points).toHaveLength(3);
    expect(live.points[1].pressure).toBe(0.9);
    gesture.move(sample({ x: 30, y: 10 }));
    gesture.end(sample({ x: 40, y: 0 }));
    expect(h.dispatch).toHaveBeenCalledTimes(1);
    const stroke = created(h)[0] as StrokeObject;
    expect(stroke).toMatchObject({ kind: 'stroke', x: 0, y: 0, w: 40, h: 10, preset: 'pen' });
    expect(stroke.points[0]).toEqual({ x: 0, y: 0, pressure: 0.2 });
    expect(h.session.getState().tool).toBe('pen');
    expectPreviewCleared(h);
  });

  it('simplifies long strokes under the point limit', () => {
    const h = createHarness();
    h.session.setTool('pen');
    const gesture = beginGesture(h.ctx, down(sample({ x: 0, y: 0 })))!;
    for (let i = 1; i < 5000; i++) gesture.move(sample({ x: i, y: Math.sin(i / 3) * 40 }));
    gesture.end(sample({ x: 5000, y: 0 }));
    const stroke = created(h)[0] as StrokeObject;
    expect(stroke.points.length).toBeLessThanOrEqual(2048);
    expect(new TextEncoder().encode(JSON.stringify(stroke)).byteLength).toBeLessThanOrEqual(32 * 1024);
  });

  it('a click draws a dot', () => {
    const h = createHarness();
    h.session.setTool('pen');
    drag(h, sample({ x: 5, y: 5 }), [sample({ x: 5, y: 5 })]);
    expect(created(h)[0]).toMatchObject({ kind: 'stroke', x: 5, y: 5, w: 0, h: 0 });
  });

  it('cancel discards the stroke', () => {
    const h = createHarness();
    h.session.setTool('pen');
    const gesture = beginGesture(h.ctx, down(sample({ x: 0, y: 0 })))!;
    gesture.move(sample({ x: 10, y: 10 }));
    gesture.cancel();
    expect(h.dispatch).not.toHaveBeenCalled();
    expectPreviewCleared(h);
  });
});

describe('select: click, shift-click, marquee', () => {
  it('click selects the topmost object, click on empty clears', () => {
    const below = rectObject({ rank: '1:a0' });
    const above = rectObject({ rank: '1:a1', x: 50, y: 50 });
    const h = createHarness([below, above]);
    drag(h, sample({ x: 60, y: 60 }), [sample({ x: 60, y: 60 })]);
    expect(h.session.getState().selectedIds).toEqual([above.id]);
    drag(h, sample({ x: 500, y: 500 }), [sample({ x: 500, y: 500 })]);
    expect(h.session.getState().selectedIds).toEqual([]);
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it('shift-click toggles membership', () => {
    const a = rectObject();
    const b = rectObject({ x: 200, rank: '1:a1' });
    const h = createHarness([a, b]);
    drag(h, sample({ x: 10, y: 10 }), [sample({ x: 10, y: 10 })]);
    drag(h, sample({ x: 210, y: 10 }, { shiftKey: true }), [sample({ x: 210, y: 10 }, { shiftKey: true })]);
    expect(h.session.getState().selectedIds).toEqual([a.id, b.id]);
    drag(h, sample({ x: 10, y: 10 }, { shiftKey: true }), [sample({ x: 10, y: 10 }, { shiftKey: true })]);
    expect(h.session.getState().selectedIds).toEqual([b.id]);
  });

  it('clicking one member of a multi-selection selects only it', () => {
    const a = rectObject();
    const b = rectObject({ x: 200, rank: '1:a1' });
    const h = createHarness([a, b]);
    h.session.setSelectedIds([a.id, b.id]);
    drag(h, sample({ x: 10, y: 10 }), [sample({ x: 10, y: 10 })]);
    expect(h.session.getState().selectedIds).toEqual([a.id]);
  });

  it('marquee selects intersecting objects and frames only when fully enclosed', () => {
    const frame = frameObject({ x: 0, y: 0, w: 400, h: 300 });
    const inside = rectObject({ x: 20, y: 20, w: 40, h: 40 });
    const h = createHarness([frame, inside]);
    // Starts inside the frame's interior: a marquee, not a frame drag.
    const gesture = beginGesture(h.ctx, down(sample({ x: 10, y: 10 })))!;
    expect(gesture.kind).toBe('marquee');
    gesture.move(sample({ x: 100, y: 100 }));
    expect(h.runtime.getPreview().marquee).toEqual({ x: 10, y: 10, w: 90, h: 90 });
    gesture.end(sample({ x: 100, y: 100 }));
    expect(h.session.getState().selectedIds).toEqual([inside.id]);
    expectPreviewCleared(h);

    drag(h, sample({ x: -10, y: -10 }), [sample({ x: 100, y: 100 }), sample({ x: 410, y: 310 })]);
    expect(h.session.getState().selectedIds).toEqual([frame.id, inside.id]);
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it('shift-marquee adds to the selection; cancel keeps it', () => {
    const a = rectObject();
    const b = rectObject({ x: 300, rank: '1:a1' });
    const h = createHarness([a, b]);
    h.session.setSelectedIds([a.id]);
    drag(h, sample({ x: 290, y: -10 }, { shiftKey: true }), [sample({ x: 320, y: 20 }, { shiftKey: true })]);
    expect(h.session.getState().selectedIds).toEqual([a.id, b.id]);
    const gesture = beginGesture(h.ctx, down(sample({ x: 1000, y: 1000 })))!;
    gesture.move(sample({ x: 1100, y: 1100 }));
    gesture.cancel();
    expect(h.session.getState().selectedIds).toEqual([a.id, b.id]);
    expectPreviewCleared(h);
  });
});

describe('select: translate', () => {
  it('drag moves the selection with one dispatch and undo restores', () => {
    const a = rectObject();
    const b = rectObject({ x: 200, rank: '1:a1' });
    const h = createHarness([a, b]);
    h.session.setSelectedIds([a.id, b.id]);
    const gesture = beginGesture(h.ctx, down(sample({ x: 10, y: 10 })))!;
    expect(gesture.kind).toBe('translating');
    for (let i = 1; i <= 10; i++) gesture.move(sample({ x: 10 + i * 5, y: 10 + i * 2 }));
    expect(h.runtime.getPreview().objects.map(o => [o.id, o.x])).toEqual([[a.id, 50], [b.id, 250]]);
    expect(h.store.getObject(a.id)!.x).toBe(0); // store untouched mid-gesture
    gesture.end(sample({ x: 60, y: 30 }));
    expect(h.dispatch).toHaveBeenCalledTimes(1);
    expect(h.store.getObject(a.id)).toMatchObject({ x: 50, y: 20 });
    expect(h.store.getObject(b.id)).toMatchObject({ x: 250, y: 20 });
    expectPreviewCleared(h);

    h.ackAll();
    expect(h.store.undo()).not.toBeNull();
    expect(h.store.getObject(a.id)).toMatchObject({ x: 0, y: 0 });
    expect(h.store.getObject(b.id)).toMatchObject({ x: 200, y: 0 });
  });

  it('dragging an unselected object selects and moves only it', () => {
    const a = rectObject();
    const b = rectObject({ x: 200, rank: '1:a1' });
    const h = createHarness([a, b]);
    h.session.setSelectedIds([b.id]);
    drag(h, sample({ x: 10, y: 10 }), [sample({ x: 30, y: 10 })]);
    expect(h.session.getState().selectedIds).toEqual([a.id]);
    expect(h.store.getObject(a.id)!.x).toBe(20);
    expect(h.store.getObject(b.id)!.x).toBe(200);
  });

  it('cancel dispatches nothing', () => {
    const a = rectObject();
    const h = createHarness([a]);
    const gesture = beginGesture(h.ctx, down(sample({ x: 10, y: 10 })))!;
    gesture.move(sample({ x: 80, y: 80 }));
    gesture.cancel();
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(h.store.getObject(a.id)!.x).toBe(0);
    expectPreviewCleared(h);
  });

  it('dragging a frame by its border carries objects whose centre is inside at pointer-down', () => {
    const frame = frameObject({ x: 0, y: 0, w: 400, h: 300 });
    const inside = rectObject({ x: 20, y: 20, w: 40, h: 40 });
    const straddling = rectObject({ x: 380, y: 20, w: 100, h: 40, rank: '1:a1' }); // centre outside
    const otherFrame = frameObject({ x: 50, y: 50, w: 50, h: 50, rank: '0:a1' });
    const h = createHarness([frame, inside, straddling, otherFrame]);
    drag(h, sample({ x: 0, y: 150 }), [sample({ x: 50, y: 150 }), sample({ x: 100, y: 160 })]);
    expect(h.dispatch).toHaveBeenCalledTimes(1);
    expect(h.store.getObject(frame.id)).toMatchObject({ x: 100, y: 10 });
    expect(h.store.getObject(inside.id)).toMatchObject({ x: 120, y: 30 });
    expect(h.store.getObject(straddling.id)).toMatchObject({ x: 380 });
    expect(h.store.getObject(otherFrame.id)).toMatchObject({ x: 50 }); // never nested frames
  });

  it('a frame can be dragged by its label (data-wb-frame-label)', () => {
    const frame = frameObject({ x: 0, y: 0 });
    const h = createHarness([frame]);
    drag(h, sample({ x: 5000, y: 5000 }), [sample({ x: 5010, y: 5000 })], { frameLabelId: frame.id });
    expect(h.store.getObject(frame.id)).toMatchObject({ x: 10 });
  });

  it('refuses a move larger than MAX_CHANGES_PER_COMMAND instead of splitting it', () => {
    const frame = frameObject({ x: 0, y: 0, w: 1000, h: 1000 });
    const many = Array.from({ length: MAX_CHANGES_PER_COMMAND }, (_, i) =>
      rectObject({ x: i, y: i, w: 10, h: 10, rank: '1:a0' }));
    const h = createHarness([frame, ...many]);
    drag(h, sample({ x: 0, y: 500 }), [sample({ x: 100, y: 500 })]);
    expect(h.dispatch).not.toHaveBeenCalled();
    expect(h.store.getObject(frame.id)!.x).toBe(0);
    expectPreviewCleared(h);
  });
});

describe('select: resize and endpoints', () => {
  it('handle drag resizes the single selected object, Shift keeps aspect', () => {
    const a = rectObject({ w: 100, h: 50 });
    const h = createHarness([a]);
    h.session.setSelectedIds([a.id]);
    const gesture = beginGesture(h.ctx, down(sample({ x: 100, y: 50 }), { handle: 'se' }))!;
    expect(gesture.kind).toBe('resizing');
    gesture.move(sample({ x: 200, y: 60 }));
    expect(h.runtime.getPreview().objects[0]).toMatchObject({ w: 200, h: 60 });
    gesture.end(sample({ x: 200, y: 60 }, { shiftKey: true }));
    expect(h.dispatch).toHaveBeenCalledTimes(1);
    expect(h.store.getObject(a.id)).toMatchObject({ x: 0, y: 0, w: 200, h: 100 });
    expectPreviewCleared(h);
  });

  it('text corner handles step the size', () => {
    const t = textObject({ w: 200, h: 34 }) as TextObject;
    const h = createHarness([t]);
    h.session.setSelectedIds([t.id]);
    drag(h, sample({ x: 200, y: 34 }), [sample({ x: 400, y: 68 })], { handle: 'se' });
    expect((h.store.getObject(t.id) as TextObject).style.size).toBe('XL');
  });

  it('endpoint drag moves one end, Shift snaps to 15 degrees', () => {
    const arrow = lineObject();
    const h = createHarness([arrow]);
    h.session.setSelectedIds([arrow.id]);
    const gesture = beginGesture(h.ctx, down(sample({ x: 100, y: 0 }), { handle: 'end' }))!;
    expect(gesture.kind).toBe('endpoint-dragging');
    gesture.move(sample({ x: 100, y: 10 }, { shiftKey: true }));
    gesture.end(sample({ x: 100, y: 10 }, { shiftKey: true }));
    const result = h.store.getObject(arrow.id) as ArrowObject;
    expect(result.h).toBeCloseTo(0, 9);
    expect(result.start).toEqual({ x: 0, y: 0 });
  });

  it('a handle that does not apply to the kind falls back to selection behaviour', () => {
    const arrow = lineObject();
    const h = createHarness([arrow]);
    h.session.setSelectedIds([arrow.id]);
    const gesture = beginGesture(h.ctx, down(sample({ x: 50, y: 0 }), { handle: 'se' }))!;
    expect(gesture.kind).toBe('translating');
  });

  it('cancel and click-without-drag dispatch nothing', () => {
    const a = rectObject();
    const h = createHarness([a]);
    h.session.setSelectedIds([a.id]);
    drag(h, sample({ x: 100, y: 100 }), [sample({ x: 100, y: 100 })], { handle: 'se' });
    const gesture = beginGesture(h.ctx, down(sample({ x: 100, y: 100 }), { handle: 'se' }))!;
    gesture.move(sample({ x: 300, y: 300 }));
    gesture.cancel();
    expect(h.dispatch).not.toHaveBeenCalled();
    expectPreviewCleared(h);
  });
});

describe('hand and double-click', () => {
  it('hand tool pans the camera without dispatching', () => {
    const h = createHarness();
    h.session.setTool('hand');
    drag(h, sample({ x: 0, y: 0 }), [sample({ x: 30, y: 40 })]);
    expect(h.runtime.getCamera()).toEqual({ x: 30, y: 40, zoom: 1 });
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it('space and middle button pan with any tool', () => {
    const h = createHarness();
    h.session.setTool('rect');
    expect(beginGesture(h.ctx, down(sample({ x: 0, y: 0 }), { spaceHeld: true }))!.kind).toBe('panning');
    expect(beginGesture(h.ctx, down(sample({ x: 0, y: 0 }), { button: 1 }))!.kind).toBe('panning');
    expect(beginGesture(h.ctx, down(sample({ x: 0, y: 0 }), { button: 2 }))).toBeNull();
  });

  it('double-click on empty canvas creates a text object in edit mode; on text edits it', () => {
    const t = textObject({ x: 500, y: 500 });
    const h = createHarness([t]);
    expect(handleDoubleClick(h.ctx, { x: 10, y: 10 })).toBe(true);
    const text = created(h)[0];
    expect(text).toMatchObject({ kind: 'text', x: 10, y: 10, text: '' });
    expect(h.session.getState().editingId).toBe(text.id);
    h.session.setEditingId(null);
    expect(handleDoubleClick(h.ctx, { x: 510, y: 510 })).toBe(true);
    expect(h.session.getState().editingId).toBe(t.id);
  });

  it('double-click on a shape does nothing', () => {
    const h = createHarness([rectObject()]);
    expect(handleDoubleClick(h.ctx, { x: 10, y: 10 })).toBe(false);
    expect(h.dispatch).not.toHaveBeenCalled();
  });
});
