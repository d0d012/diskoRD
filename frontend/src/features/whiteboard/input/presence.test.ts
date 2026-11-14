import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BoardObject } from '../contract';
import { participant } from '../render/overlays/presenceTestUtils';
import { createInputController } from './controller';
import { createPresenceSender } from './presence';
import { createHarness, frameObject, rectObject, textObject, USER } from './testUtils';
import type { InputPresence } from './types';

const disposers: (() => void)[] = [];
afterEach(() => { disposers.splice(0).forEach(dispose => dispose()); document.body.innerHTML = ''; vi.restoreAllMocks(); });
function setup(objects: BoardObject[] = [rectObject()]) {
  const h = createHarness(objects);
  const element = document.createElement('div');
  element.dataset.wbViewport = '';
  document.body.appendChild(element);
  const send = vi.fn();
  let others = [participant()];
  const presence: InputPresence = { send, getParticipants: () => others };
  const notice = vi.fn();
  const controller = createInputController({ element, ...h, userId: USER, presence, onNotice: notice });
  disposers.push(() => controller.dispose());
  function pointer(type: string, x = 10, y = 10, target: Element = element): void {
    target.dispatchEvent(new PointerEvent(type, { pointerId: 1, button: 0, clientX: x, clientY: y, bubbles: true, cancelable: true }));
  }
  function key(key: string): void { element.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); }
  return { ...h, element, send, notice, pointer, key, controller, others(next: typeof others) { others = next; } };
}

describe('controller presence', () => {
  it('sends world cursor values and null on leave, deduplicating equal samples', () => {
    const v = setup();
    v.runtime.setCamera({ x: 10, y: 20, zoom: 2 });
    v.pointer('pointermove', 30, 60);
    expect(v.send).toHaveBeenLastCalledWith({ cursor: { x: 10, y: 20 } });
    const count = v.send.mock.calls.length;
    v.pointer('pointermove', 30, 60);
    expect(v.send).toHaveBeenCalledTimes(count);
    v.pointer('pointerleave');
    expect(v.send).toHaveBeenLastCalledWith({ cursor: null });
    v.pointer('pointerleave');
    expect(v.send).toHaveBeenCalledTimes(count + 1);
  });

  it('still advertises the cursor over an editor without starting a gesture', () => {
    const v = setup();
    const editor = document.createElement('textarea');
    v.element.appendChild(editor);
    v.pointer('pointermove', 70, 90, editor);
    expect(v.send).toHaveBeenLastCalledWith({ cursor: { x: 70, y: 90 } });
    v.pointer('pointerdown', 70, 90, editor);
    v.pointer('pointerup', 70, 90, editor);
    expect(v.dispatch).not.toHaveBeenCalled();
  });

  it('sends selection and editing starts/ends, including externally started sessions', () => {
    const t = textObject();
    const v = setup([t]);
    v.session.setSelectedIds([t.id]);
    expect(v.send).toHaveBeenLastCalledWith({ selectedIds: [t.id] });
    const count = v.send.mock.calls.length;
    v.session.setSelectedIds([t.id]);
    expect(v.send).toHaveBeenCalledTimes(count);
    v.element.focus(); v.key('Enter');
    expect(v.send).toHaveBeenLastCalledWith({ editingId: t.id });
    v.session.setEditingId(null);
    expect(v.send).toHaveBeenLastCalledWith({ editingId: null });
    v.session.setSelectedIds([]);
    expect(v.send).toHaveBeenLastCalledWith({ selectedIds: [] });
  });

  it('advertises move deltas, includes frame contents and writes once on pointer-up', () => {
    const f = frameObject(); const r = rectObject({ x: 20, y: 20 });
    const v = setup([f, r]);
    const label = document.createElement('span'); label.dataset.wbFrameLabel = f.id; v.element.appendChild(label);
    v.pointer('pointerdown', 0, 0, label);
    v.pointer('pointermove', 50, 60);
    expect(v.send).toHaveBeenLastCalledWith({ drag: { ids: [f.id, r.id], dx: 50, dy: 60 } });
    v.pointer('pointermove', 100, 120);
    expect(v.dispatch).not.toHaveBeenCalled();
    expect(v.send).toHaveBeenLastCalledWith({ drag: { ids: [f.id, r.id], dx: 100, dy: 120 } });
    v.pointer('pointerup', 100, 120);
    expect(v.send).toHaveBeenLastCalledWith({ drag: null });
    expect(v.send.mock.calls.filter(([fields]) => fields.drag === null)).toHaveLength(1);
    expect(v.dispatch).toHaveBeenCalledTimes(1);
    expect(v.store.getObject(r.id)).toMatchObject({ x: 120, y: 140 });
  });

  it.each(['pointercancel', 'lostpointercapture', 'escape', 'blur', 'dispose'])('clears drag on %s without writing', reason => {
    const v = setup();
    v.pointer('pointerdown'); v.pointer('pointermove', 50, 50);
    if (reason === 'escape') v.key('Escape');
    else if (reason === 'blur') window.dispatchEvent(new Event('blur'));
    else if (reason === 'dispose') v.controller.dispose();
    else v.pointer(reason, 50, 50);
    expect(v.send.mock.calls.some(([fields]) => fields.drag === null)).toBe(true);
    expect(v.dispatch).not.toHaveBeenCalled();
    expect(v.runtime.getPreview().objects).toHaveLength(0);
  });

  it('soft locks refuse movement and resize, including a locked frame member', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const f = frameObject(); const r = rectObject();
    const v = setup([f, r]);
    v.others([participant({ drag: { ids: [r.id], dx: 5, dy: 5 } })]);
    v.pointer('pointerdown'); v.pointer('pointermove', 50, 50); v.pointer('pointerup', 50, 50);
    expect(v.notice).toHaveBeenLastCalledWith('refused', 'Ada is moving this');
    expect(v.dispatch).not.toHaveBeenCalled();
    expect(v.runtime.getPreview().objects).toHaveLength(0);
    v.session.setSelectedIds([r.id]);
    const handle = document.createElement('div'); handle.dataset.wbHandle = 'se'; v.element.appendChild(handle);
    v.pointer('pointerdown', 100, 100, handle); v.pointer('pointermove', 150, 150); v.pointer('pointerup', 150, 150);
    expect(v.dispatch).not.toHaveBeenCalled();
    const label = document.createElement('div'); label.dataset.wbFrameLabel = f.id; v.element.appendChild(label);
    v.pointer('pointerdown', 0, 0, label); v.pointer('pointermove', 50, 50); v.pointer('pointerup', 50, 50);
    expect(v.dispatch).not.toHaveBeenCalled();
    expect(v.notice).toHaveBeenCalledTimes(3);
  });

  it('also honours moving locks for keyboard nudges', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const r = rectObject(); const v = setup([r]);
    v.others([participant({ drag: { ids: [r.id], dx: 5, dy: 5 } })]);
    v.session.setSelectedIds([r.id]); v.element.focus(); v.key('ArrowRight');
    expect(v.dispatch).not.toHaveBeenCalled();
    expect(v.notice).toHaveBeenLastCalledWith('refused', 'Ada is moving this');
  });

  it('soft locks block editing by Enter and double-click but ignore self', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const t = textObject(); const v = setup([t]);
    v.others([participant({ editingId: t.id })]);
    v.session.setSelectedIds([t.id]); v.element.focus(); v.key('Enter');
    expect(v.session.getState().editingId).toBeNull();
    v.element.dispatchEvent(new MouseEvent('dblclick', { clientX: 10, clientY: 10, bubbles: true }));
    expect(v.session.getState().editingId).toBeNull();
    expect(v.notice).toHaveBeenLastCalledWith('refused', 'Ada is editing this');
    v.others([participant({ userId: USER, editingId: t.id })]);
    v.key('Enter');
    expect(v.session.getState().editingId).toBe(t.id);
  });
});

it('deduplicates individual fields across packets, preserving explicit clears', () => {
  const send = vi.fn(); const sender = createPresenceSender(send);
  sender({ cursor: { x: 1, y: 2 }, editingId: 't' });
  sender({ cursor: { x: 1, y: 2 }, editingId: 't' });
  expect(send).toHaveBeenCalledTimes(1);
  sender({ editingId: null });
  sender({ cursor: { x: 1, y: 2 } });
  expect(send).toHaveBeenCalledTimes(2);
  sender({ cursor: null, selectedIds: [] });
  expect(send).toHaveBeenLastCalledWith({ cursor: null, selectedIds: [] });
});
