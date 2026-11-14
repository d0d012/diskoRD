import { StrictMode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StickyObject, TextObject } from '../contract';
import { createBoardStore } from '../state/boardStore';
import { createSessionStore } from '../state/sessionStore';
import { TextEditor } from './TextEditor';
import { fakeMeasurer } from './fakeMeasurer';

const text: TextObject = {
  id: 't1', kind: 'text', rank: '1:a', version: 1, createdBy: 'me', x: 10, y: 20, w: 240, h: 30,
  text: 'hello', style: { colour: 'ink', size: 'M', font: 'app', bold: false, italic: false, align: 'left' },
};
const sticky: StickyObject = {
  id: 's1', kind: 'sticky', rank: '1:b', version: 1, createdBy: 'me', x: 0, y: 0, w: 200, h: 200,
  text: '', style: { tone: 'pink', font: 'handwriting' },
};

function setup() {
  const store = createBoardStore({ boardId: 'b', userId: 'me' });
  store.hydrate({ seq: 1, objects: [text, sticky] });
  const session = createSessionStore();
  let camera = { x: 0, y: 0, zoom: 1 };
  const listeners = new Set<(c: typeof camera) => void>();
  const runtime = {
    getCamera: () => camera,
    setCamera: (c: typeof camera) => { camera = c; listeners.forEach(l => l(c)); },
    subscribeCamera: (l: (c: typeof camera) => void) => { listeners.add(l); return () => listeners.delete(l); },
    screenToWorld: (p: { x: number; y: number }) => ({ x: (p.x - camera.x) / camera.zoom, y: (p.y - camera.y) / camera.zoom }),
    worldToScreen: (p: { x: number; y: number }) => ({ x: p.x * camera.zoom + camera.x, y: p.y * camera.zoom + camera.y }),
    getPreview: () => ({ objects: [], hiddenIds: [], marquee: null }),
    setPreview: () => undefined,
    subscribePreview: () => () => undefined,
  };
  const dispatch = vi.spyOn(store, 'dispatch');
  const view = render(<TextEditor store={store} session={session} runtime={runtime} measurer={fakeMeasurer} />);
  return { store, session, runtime, dispatch, view };
}
const area = () => screen.getByRole('textbox') as HTMLTextAreaElement;
function type(value: string): void {
  area().value = value;
  fireEvent.input(area());
}

describe('TextEditor', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('renders only for the editing id and carries data-wb-ui', () => {
    const { session, view } = setup();
    expect(screen.queryByRole('textbox')).toBeNull();
    act(() => session.setEditingId('t1'));
    expect(area().value).toBe('hello');
    expect(view.container.querySelector('[data-wb-ui]')).not.toBeNull();
    expect(document.activeElement).toBe(area());
    act(() => session.setEditingId(null));
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('closes on an id with nothing editable behind it', () => {
    const { session } = setup();
    act(() => session.setEditingId('missing'));
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(session.getState().editingId).toBeNull();
  });

  it('positions itself in screen space and follows the camera', () => {
    const { session, runtime } = setup();
    act(() => session.setEditingId('t1'));
    const wrap = area().parentElement!;
    expect(wrap.style.transform).toBe('translate(10px, 20px) scale(1)');
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(cb => { cb(0); return 1; });
    act(() => runtime.setCamera({ x: 100, y: 0, zoom: 2 }));
    expect(wrap.style.transform).toBe('translate(120px, 40px) scale(2)');
  });

  it('commits on the debounce, not per keystroke', () => {
    const { session, dispatch, store } = setup();
    act(() => session.setEditingId('t1'));
    type('hello w'); type('hello wo'); type('hello world');
    expect(dispatch).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(499); });
    expect(dispatch).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect((store.getObject('t1') as TextObject).text).toBe('hello world');
    expect(session.getState().editingId).toBe('t1');
  });

  it('commits immediately on blur and closes', () => {
    const { session, dispatch, store } = setup();
    act(() => session.setEditingId('t1'));
    type('changed');
    fireEvent.blur(area());
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect((store.getObject('t1') as TextObject).text).toBe('changed');
    expect(session.getState().editingId).toBeNull();
  });

  it('does not commit during composition, then commits after it ends', () => {
    const { session, dispatch } = setup();
    act(() => session.setEditingId('t1'));
    fireEvent.compositionStart(area());
    type('hellょ');
    act(() => { vi.advanceTimersByTime(2000); });
    expect(dispatch).not.toHaveBeenCalled();
    fireEvent.keyDown(area(), { key: 'Enter', ctrlKey: true, isComposing: true });
    fireEvent.keyDown(area(), { key: 'Escape', isComposing: true });
    expect(session.getState().editingId).toBe('t1');
    fireEvent.compositionEnd(area());
    act(() => { vi.advanceTimersByTime(500); });
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('finishes on Escape and on Ctrl/Cmd+Enter, but Enter and Shift+Enter do not', () => {
    const { session, dispatch } = setup();
    act(() => session.setEditingId('t1'));
    fireEvent.keyDown(area(), { key: 'Enter' });
    fireEvent.keyDown(area(), { key: 'Enter', shiftKey: true });
    expect(session.getState().editingId).toBe('t1');
    type('one');
    fireEvent.keyDown(area(), { key: 'Escape' });
    expect(session.getState().editingId).toBeNull();
    expect(dispatch).toHaveBeenCalledTimes(1);
    act(() => session.setEditingId('t1'));
    type('two');
    fireEvent.keyDown(area(), { key: 'Enter', metaKey: true });
    expect(session.getState().editingId).toBeNull();
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it('deletes an empty text object on finish but not on the debounce', () => {
    const { session, store } = setup();
    act(() => session.setEditingId('t1'));
    type('');
    act(() => { vi.advanceTimersByTime(600); });
    expect(store.getObject('t1')).toBeDefined();
    fireEvent.blur(area());
    expect(store.getObject('t1')).toBeUndefined();
    expect(session.getState().editingId).toBeNull();
  });

  it('keeps an empty sticky, and grows it when the text needs more room', () => {
    const { session, store } = setup();
    act(() => session.setEditingId('s1'));
    fireEvent.blur(area());
    expect(store.getObject('s1')).toBeDefined();
    act(() => session.setEditingId('s1'));
    type('line\n'.repeat(40));
    expect(area().style.fontSize).toBe('14px');
    expect(area().parentElement!.style.height).not.toBe('200px');
    const shown = area().parentElement!.style.height;
    fireEvent.blur(area());
    const saved = store.getObject('s1') as StickyObject;
    expect(saved.h).toBeGreaterThan(200);
    expect(`${saved.h}px`).toBe(shown);
  });

  it('uses the object style: handwriting and tone ink for sticky, size and weight for text', () => {
    const { session } = setup();
    act(() => session.setEditingId('s1'));
    expect(area().style.color).toBe('var(--wb-sticky-pink-ink)');
    expect(area().style.fontFamily).toContain('--wb-font-handwriting');
    act(() => session.setEditingId('t1'));
    expect(area().style.fontSize).toBe('24px');
    expect(area().style.fontFamily).toContain('--wb-font-ui');
  });

  it('closes on Escape even when the textarea never received focus', () => {
    const focus = vi.spyOn(HTMLTextAreaElement.prototype, 'focus').mockImplementation(() => undefined);
    try {
      const { session } = setup();
      act(() => session.setEditingId('t1'));
      expect(document.activeElement).not.toBe(area());
      fireEvent.keyDown(document.body, { key: 'Escape' });
      expect(session.getState().editingId).toBeNull();
    } finally {
      focus.mockRestore();
    }
  });

  it('finishes on Escape for a just-created (version 0) sticky and keeps it', () => {
    const { store, session, dispatch } = setup();
    const id = 's-new';
    store.dispatch([{
      id, action: 'create', expectedVersion: 0,
      body: { id, kind: 'sticky', rank: '1:c', version: 0, createdBy: 'me', x: 0, y: 0, w: 200, h: 200, text: '', style: { tone: 'pink', font: 'handwriting' } },
    }]);
    dispatch.mockClear();
    act(() => session.setEditingId(id));
    expect(area().value).toBe('');
    fireEvent.keyDown(area(), { key: 'Escape' });
    expect(session.getState().editingId).toBeNull();
    expect(store.getObject(id)).toBeDefined(); // empty sticky stays on the board
    expect(dispatch).not.toHaveBeenCalled(); // nothing changed to commit
  });

  it('finishes exactly once under StrictMode double effects', () => {
    const store = createBoardStore({ boardId: 'b', userId: 'me' });
    store.hydrate({ seq: 1, objects: [text] });
    const session = createSessionStore();
    let camera = { x: 0, y: 0, zoom: 1 };
    const listeners = new Set<(c: typeof camera) => void>();
    const runtime = {
      getCamera: () => camera,
      setCamera: (c: typeof camera) => { camera = c; listeners.forEach(l => l(c)); },
      subscribeCamera: (l: (c: typeof camera) => void) => { listeners.add(l); return () => listeners.delete(l); },
      screenToWorld: (p: { x: number; y: number }) => ({ x: (p.x - camera.x) / camera.zoom, y: (p.y - camera.y) / camera.zoom }),
      worldToScreen: (p: { x: number; y: number }) => ({ x: p.x * camera.zoom + camera.x, y: p.y * camera.zoom + camera.y }),
      getPreview: () => ({ objects: [], hiddenIds: [], marquee: null }),
      setPreview: () => undefined,
      subscribePreview: () => () => undefined,
    };
    const dispatch = vi.spyOn(store, 'dispatch');
    render(
      <StrictMode>
        <TextEditor store={store} session={session} runtime={runtime} measurer={fakeMeasurer} />
      </StrictMode>,
    );
    act(() => session.setEditingId('t1'));
    type('changed');
    fireEvent.keyDown(area(), { key: 'Escape' });
    expect(session.getState().editingId).toBeNull();
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});
