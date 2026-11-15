import { describe, expect, it } from 'vitest';
import { createHarness, frameObject, rectObject, sample } from './testUtils';
import { createTranslateGesture, createResizeGesture } from './tools/select';
import { createCreationGesture } from './tools/create';
import { snapState } from '../render/overlays/snapState';
import { nudgeSelection } from './shortcuts';

function setup() {
  const moving = rectObject({ x: 0, y: 0, w: 40, h: 40 });
  const target = rectObject({ x: 200, y: 200, w: 100, h: 100, createdBy: '00000000-0000-4000-8000-000000000002' });
  const h = createHarness([moving, target]);
  snapState(h.runtime).viewport = { x: 0, y: 0, w: 1000, h: 800 };
  return { ...h, moving, target };
}
describe('tool snapping', () => {
  it('previews and commits one snapped selection translation, Alt bypasses immediately', () => {
    const h = setup();
    const gesture = createTranslateGesture(h.ctx, [h.moving.id], sample({ x: 0, y: 0 }), [h.moving.id]);
    const point = sample({ x: 157, y: 50 });
    gesture.move(point);
    expect(h.runtime.getPreview().objects[0].x).toBe(160);
    expect(snapState(h.runtime).guides).toHaveLength(1);
    gesture.move({ ...point, altKey: true });
    expect(h.runtime.getPreview().objects[0].x).toBe(157);
    expect(snapState(h.runtime).guides).toEqual([]);
    gesture.end(point);
    expect(h.store.getObject(h.moving.id)?.x).toBe(160);
    expect(h.dispatch).toHaveBeenCalledTimes(1);
  });
  it('moves a frame and its carried objects by one snapped delta without self-snapping', () => {
    const frame = frameObject({ w: 100, h: 100 });
    const child = rectObject({ x: 10, y: 10, w: 20, h: 20 });
    const target = rectObject({ x: 200, y: 200 });
    const h = createHarness([frame, child, target]);
    snapState(h.runtime).viewport = { x: 0, y: 0, w: 1000, h: 800 };
    const gesture = createTranslateGesture(h.ctx, [frame.id], sample({ x: 0, y: 0 }), [frame.id]);
    gesture.end(sample({ x: 97, y: 150 }));
    expect(h.store.getObject(frame.id)?.x).toBe(100);
    expect(h.store.getObject(child.id)?.x).toBe(110);
    expect(h.store.getObject(target.id)?.x).toBe(200);
    expect(h.dispatch).toHaveBeenCalledTimes(1);
  });
  it('snaps resize edge and centre with fixed opposite anchor', () => {
    const h = setup();
    const gesture = createResizeGesture(h.ctx, h.moving, 'e', sample({ x: 40, y: 20 }));
    gesture.move(sample({ x: 197, y: 20 }));
    expect(h.runtime.getPreview().objects[0]).toMatchObject({ x: 0, w: 200 });
    gesture.end(sample({ x: 397, y: 20 }));
    expect(h.store.getObject(h.moving.id)).toMatchObject({ x: 0, w: 400 });
  });
  it.each(['rect', 'ellipse', 'frame'] as const)('snaps %s drawing', tool => {
    const h = setup();
    const gesture = createCreationGesture(h.ctx, tool, sample({ x: 80, y: 80 }));
    gesture.move(sample({ x: 197, y: 143 }));
    expect(h.runtime.getPreview().objects[0]).toMatchObject({ x: 80, w: 120 });
    gesture.end(sample({ x: 197, y: 143 }));
    expect(h.store.getObjectsInRank().find(o => o.version === 0)?.w).toBe(120);
  });
  it('snaps click-sized sticky placement', () => {
    const h = setup();
    createCreationGesture(h.ctx, 'sticky', sample({ x: 197, y: 180 })).end(sample({ x: 197, y: 180 }));
    const sticky = h.store.getObjectsInRank().find(o => o.version === 0)!;
    // Sticky origin is centred around the press; its centre aligns to target edge.
    expect(sticky.x + sticky.w / 2).toBe(200);
  });
  it('never snaps arrow-key nudges', () => {
    const h = setup();
    h.session.setSelectedIds([h.moving.id]);
    nudgeSelection(h.ctx, 157, 50);
    nudgeSelection(h.ctx, 1, 0);
    expect(h.store.getObject(h.moving.id)?.x).toBe(158);
    expect(snapState(h.runtime).guides).toEqual([]);
  });
  it('keeps Shift-square drawing constrained while snapping', () => {
    const h = setup();
    const gesture = createCreationGesture(h.ctx, 'rect', sample({ x: 80, y: 80 }));
    gesture.move(sample({ x: 197, y: 140 }, { shiftKey: true }));
    expect(h.runtime.getPreview().objects[0]).toMatchObject({ w: 120, h: 120 });
  });
  it.each(['hidden', 'offscreen'])('excludes %s targets', mode => {
    const h = setup();
    if (mode === 'hidden') h.session.toggleHideAuthor(h.target.createdBy);
    else snapState(h.runtime).viewport = { x: 0, y: 0, w: 50, h: 50 };
    const gesture = createTranslateGesture(h.ctx, [h.moving.id], sample({ x: 0, y: 0 }), [h.moving.id]);
    gesture.end(sample({ x: 157, y: 50 }));
    expect(h.store.getObject(h.moving.id)?.x).toBe(157);
  });
});
