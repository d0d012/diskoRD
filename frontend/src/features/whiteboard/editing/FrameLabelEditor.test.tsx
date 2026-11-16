import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBoardStore } from '../state/boardStore';
import { createSessionStore } from '../state/sessionStore';
import { createRuntime } from '../render/runtime';
import { frame } from '../render/testObjects';
import { Viewport } from '../render/Viewport';
import { TextEditor } from './TextEditor';
import { FrameLabelEditor } from './FrameLabelEditor';
import { MAX_FRAME_LABEL_LENGTH } from '../contract/limits';
import type { SyncAdapter } from '../contract';

let frames: FrameRequestCallback[] = [];
function flush() {
  act(() => {
    for (let i = 0; i < 5 && frames.length; i++) {
      const queued = frames;
      frames = [];
      queued.forEach(callback => callback(performance.now()));
    }
  });
}
beforeEach(() => {
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
  vi.stubGlobal('cancelAnimationFrame', () => {});
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 2000 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 1200 });
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight;
});
function setup(adapter?: SyncAdapter) {
  const object = { ...frame, label: 'A very long frame name for a narrow frame', w: 60 };
  const store = createBoardStore({ boardId: 'b', userId: 'me' });
  store.hydrate({ seq: 1, objects: [object] });
  const session = createSessionStore();
  const runtime = createRuntime();
  const dispatch = vi.spyOn(store, 'dispatch');
  const view = render(<Viewport store={store} session={session} runtime={runtime}>
    <TextEditor store={store} session={session} runtime={runtime} />
    <FrameLabelEditor store={store} session={session} selfUserId="me" adapter={adapter} />
  </Viewport>);
  flush();
  const label = view.container.querySelector<HTMLElement>('[data-wb-frame-label]')!;
  const viewport = screen.getByLabelText('Board');
  function open() { fireEvent.doubleClick(label); return screen.getByRole('textbox', { name: 'Frame name' }) as HTMLInputElement; }
  return { object, store, session, runtime, dispatch, view, label, viewport, open };
}

describe('FrameLabelEditor', () => {
  it('exposes the full name as a native hover title and expands selected labels', () => {
    const { object, label, session, view } = setup();
    expect(label).toHaveAttribute('title', object.label);
    act(() => session.setSelectedIds([object.id]));
    flush();
    expect(view.container.querySelector('[data-wb-selected="true"] [data-wb-frame-title]')).toHaveTextContent(object.label);
    act(() => session.setSelectedIds([]));
    flush();
    expect(view.container.querySelector('[data-wb-selected="true"]')).toBeNull();
  });
  it('double-click opens a focused, fully selected inline input with editing presence', () => {
    const { open, object, session, label, dispatch } = setup();
    fireEvent.click(label);
    expect(screen.queryByRole('textbox')).toBeNull();
    const input = open();
    expect(input.parentElement).toBe(label);
    expect(input).toHaveFocus();
    expect(input.value).toBe(object.label);
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, object.label.length]);
    expect(input).toHaveAttribute('data-wb-ui');
    expect(session.getState().editingId).toBe(object.id);
    expect(dispatch).not.toHaveBeenCalled();
  });
  it.each(['Enter', 'blur'])('%s trims and commits exactly one undoable label update', method => {
    const { open, dispatch, object, session, store } = setup();
    const input = open();
    fireEvent.input(input, { target: { value: '  Renamed frame  ' } });
    if (method === 'blur') fireEvent.blur(input);
    else fireEvent.keyDown(input, { key: 'Enter' });
    expect(dispatch).toHaveBeenCalledExactlyOnceWith([
      { id: object.id, action: 'update', expectedVersion: object.version, patch: { label: 'Renamed frame' } },
    ], { label: 'Rename frame' });
    expect(store.getObject(object.id)).toMatchObject({ label: 'Renamed frame' });
    expect(session.getState().editingId).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });
  it.each(['Escape', 'empty', 'unchanged'])('%s preserves the old name without a write', method => {
    const { open, dispatch, session } = setup();
    const input = open();
    if (method !== 'unchanged') fireEvent.input(input, { target: { value: method === 'empty' ? '   ' : 'discard me' } });
    fireEvent.keyDown(input, { key: method === 'Escape' ? 'Escape' : 'Enter' });
    fireEvent.blur(input);
    expect(dispatch).not.toHaveBeenCalled();
    expect(session.getState().editingId).toBeNull();
  });
  it.each(['Enter', 'F2'])('%s opens only a single selected frame', key => {
    const { session, object, viewport } = setup();
    fireEvent.keyDown(viewport, { key });
    expect(screen.queryByRole('textbox')).toBeNull();
    act(() => session.setSelectedIds([object.id, 'other']));
    fireEvent.keyDown(viewport, { key });
    expect(screen.queryByRole('textbox')).toBeNull();
    act(() => session.setSelectedIds([object.id]));
    fireEvent.keyDown(viewport, { key });
    expect(screen.getByRole('textbox')).toHaveFocus();
  });
  it('bounds labels by Unicode scalars and ignores Enter during IME composition', () => {
    const { open, store, object, dispatch } = setup();
    const input = open();
    fireEvent.compositionStart(input);
    fireEvent.input(input, { target: { value: '😀'.repeat(MAX_FRAME_LABEL_LENGTH + 1) } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(dispatch).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(store.getObject(object.id)).toMatchObject({ label: '😀'.repeat(MAX_FRAME_LABEL_LENGTH) });
  });
  it('respects another participant’s editing soft lock', () => {
    const adapter = { getPresence: () => [{ userId: 'other', name: 'Friend', editingId: frame.id }] } as unknown as SyncAdapter;
    const { label, session, dispatch } = setup(adapter);
    fireEvent.doubleClick(label);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(session.getState().editingId).toBeNull();
    expect(dispatch).not.toHaveBeenCalled();
  });
  it('cleans editing presence on unmount without committing', () => {
    const { open, view, session, dispatch } = setup();
    const input = open();
    fireEvent.input(input, { target: { value: 'Unfinished' } });
    view.unmount();
    expect(session.getState().editingId).toBeNull();
    expect(dispatch).not.toHaveBeenCalled();
  });
  it('cancels if the frame is removed while editing', () => {
    const { open, store, session, dispatch } = setup();
    open();
    act(() => store.hydrate({ seq: 2, objects: [] }));
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(session.getState().editingId).toBeNull();
    expect(dispatch).not.toHaveBeenCalled();
  });
});
