import { act, render } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoardObject } from '../contract';
import { fakeMeasurer } from '../editing/fakeMeasurer';
import { createBoardStore } from '../state/boardStore';
import { createSessionStore } from '../state/sessionStore';
import { setTextMeasurerForTests } from './objects/textFit';
import { createRuntime } from './runtime';
import { frame, rect, sticky, text } from './testObjects';
import { Viewport } from './Viewport';

let frames: FrameRequestCallback[] = [];
function flush(): void {
  act(() => {
    for (let i = 0; i < 5 && frames.length; i++) {
      const queued = frames;
      frames = [];
      for (const callback of queued) callback(performance.now());
    }
  });
}

const sizes = { clientWidth: 2000, clientHeight: 1200 };
beforeEach(() => {
  // jsdom has no layout: give every element a desktop-sized viewport for culling.
  for (const [key, value] of Object.entries(sizes)) {
    Object.defineProperty(HTMLElement.prototype, key, { configurable: true, get: () => value });
  }
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  setTextMeasurerForTests(fakeMeasurer);
});
afterEach(() => {
  for (const key of Object.keys(sizes)) delete (HTMLElement.prototype as unknown as Record<string, unknown>)[key];
  vi.unstubAllGlobals();
  setTextMeasurerForTests(null);
});

function setup(objects: BoardObject[] = [frame, rect, sticky, text], flushFrames = true) {
  const store = createBoardStore({ boardId: 'b', userId: 'u1' });
  store.hydrate({ seq: 1, objects });
  const session = createSessionStore();
  const runtime = createRuntime();
  const ref = createRef<HTMLDivElement>();
  const view = render(
    <div style={{ width: 800, height: 600 }}>
      <Viewport ref={ref} store={store} session={session} runtime={runtime}><div data-testid="overlay" /></Viewport>
    </div>,
  );
  if (flushFrames) flush();
  const ids = () => Array.from(view.container.querySelectorAll<HTMLElement>('[data-wb-world] [data-wb-object-id]'), node => node.dataset.wbObjectId);
  const node = (id: string) => view.container.querySelector<HTMLElement>(`[data-wb-world] [data-wb-object-id="${id}"]`);
  return { store, session, runtime, ref, view, ids, node };
}

describe('Viewport', () => {
  it('exposes the viewport root and renders objects in rank order with children in the screen overlay', () => {
    const { ref, ids, view } = setup();
    expect(ref.current).toHaveClass('wb-root');
    expect(ref.current!.hasAttribute('data-wb-viewport')).toBe(true);
    expect(ids()).toEqual([frame.id, rect.id, text.id, sticky.id]);
    expect(view.getByTestId('overlay').closest('.wb-render-screen-overlay')).not.toBeNull();
    // Initial objects do not replay the pop-in.
    expect(view.container.querySelector('.wb-root__object-enter')).toBeNull();
  });

  it('writes the camera transform in one rAF and drops will-change after it settles', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const { runtime, view } = setup();
      const world = view.container.querySelector<HTMLElement>('[data-wb-world]')!;
      act(() => {
        runtime.setCamera({ x: 10, y: 20, zoom: 2 });
        runtime.setCamera({ x: 15, y: 20, zoom: 2 });
      });
      expect(frames).toHaveLength(1);
      flush();
      expect(world.style.transform).toBe('translate(15px, 20px) scale(2)');
      expect(world.style.willChange).toBe('transform');
      act(() => { vi.advanceTimersByTime(500); });
      flush();
      expect(world.style.willChange).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });

  it('updates author visibility without moving the camera and skips author checks on the default fast path', () => {
    const other = { ...rect, id: 'other', createdBy: 'other-user', rank: '2:b' };
    const { session, runtime, ids, view } = setup([rect, other]);
    const isHidden = vi.spyOn(session, 'isAuthorHidden');
    act(() => runtime.setCamera({ x: 10, y: 20, zoom: 1 }));
    flush();
    expect(isHidden).not.toHaveBeenCalled();
    act(() => session.toggleHideAuthor('other-user'));
    flush();
    expect(ids()).toEqual([rect.id]);
    act(() => session.toggleSoloAuthor('other-user'));
    flush();
    expect(ids()).toEqual([other.id]);
    act(() => session.showAllAuthors());
    flush();
    expect(ids()).toEqual([rect.id, other.id]);
    isHidden.mockClear();
    act(() => runtime.setCamera({ x: 20, y: 30, zoom: 1 }));
    flush();
    expect(isHidden).not.toHaveBeenCalled();
    view.unmount();
    frames = [];
    act(() => session.toggleHideAuthor('other-user'));
    expect(frames).toHaveLength(0);
  });

  it('re-renders and repaints only the changed object', () => {
    const { store, node } = setup();
    const before = node(text.id);
    store.dispatch([{ id: rect.id, action: 'update', expectedVersion: 1, patch: { x: 300 } }]);
    flush();
    expect(node(rect.id)!.style.transform).toBe('translate(300px, 20px)');
    expect(node(text.id)).toBe(before);
  });

  it('draws preview drafts and replacements without touching the store, and hides hidden ids', () => {
    const { store, runtime, ids, node } = setup();
    const dispatch = vi.spyOn(store, 'dispatch');
    act(() => {
      runtime.setPreview({
        objects: [{ ...rect, x: 500 }, { ...rect, id: 'draft', rank: '1:b0', x: 40 }],
        hiddenIds: [text.id],
        marquee: { x: 0, y: 0, w: 10, h: 10 },
      });
    });
    flush();
    expect(ids()).toEqual([frame.id, rect.id, sticky.id, 'draft']);
    expect(node(rect.id)!.style.transform).toBe('translate(500px, 20px)');
    expect(store.getObject(rect.id)!.x).toBe(10);
    expect(dispatch).not.toHaveBeenCalled();
    expect(document.querySelector<HTMLElement>('[data-wb-marquee]')!.hidden).toBe(false);
    act(() => { runtime.setPreview({ objects: [], hiddenIds: [], marquee: null }); });
    flush();
    expect(ids()).toEqual([frame.id, rect.id, text.id, sticky.id]);
    expect(node(rect.id)!.style.transform).toBe('translate(10px, 20px)');
  });

  it('lifts a sticky while a preview replaces it', () => {
    const { runtime, node } = setup();
    act(() => { runtime.setPreview({ objects: [{ ...sticky, x: 950 }], hiddenIds: [], marquee: null }); });
    flush();
    expect(node(sticky.id)!.querySelector<HTMLElement>('.wb-root__sticky')!.dataset.lifted).toBe('true');
    act(() => { runtime.setPreview({ objects: [], hiddenIds: [], marquee: null }); });
    flush();
    expect(node(sticky.id)!.querySelector<HTMLElement>('.wb-root__sticky')!.dataset.lifted).toBe('false');
  });

  it('suppresses the text of the object being edited', () => {
    const { session, node } = setup();
    act(() => { session.setEditingId(sticky.id); });
    flush();
    expect(node(sticky.id)!.querySelector<HTMLElement>('[data-wb-text]')!.style.visibility).toBe('hidden');
    act(() => { session.setEditingId(null); });
    flush();
    expect(node(sticky.id)!.querySelector<HTMLElement>('[data-wb-text]')!.style.visibility).toBe('');
  });

  it('shows the selection outline and handles for session.selectedIds', () => {
    const { session, view } = setup();
    act(() => { session.setSelectedIds([rect.id]); });
    flush();
    const handles = view.container.querySelectorAll<HTMLElement>('[data-wb-selection-layer] [data-wb-handle]');
    expect(Array.from(handles, handle => handle.dataset.wbHandle)).toEqual(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']);
    act(() => { session.setSelectedIds([]); });
    flush();
    expect(view.container.querySelectorAll('[data-wb-selection-layer] [data-wb-handle]')).toHaveLength(0);
  });

  it('pops in objects created after mount and culls offscreen objects', () => {
    const { store, ids, node } = setup([rect]);
    store.dispatch([{ id: 'new', action: 'create', expectedVersion: 0, body: { ...rect, id: 'new', version: 0, rank: '1:b0' } }]);
    flush();
    expect(node('new')!.querySelector('.wb-root__object-enter')).not.toBeNull();
    store.dispatch([{ id: 'far', action: 'create', expectedVersion: 0, body: { ...rect, id: 'far', version: 0, rank: '1:b1', x: 50_000 } }]);
    flush();
    expect(ids()).toEqual([rect.id, 'new']);
  });

  it('mounts newly visible objects in bounded batches and converges within a few frames', () => {
    const objects: BoardObject[] = Array.from({ length: 120 }, (_, i) => ({
      ...rect, id: `r${i}`, rank: `1:b${i}`, x: (i % 12) * 160, y: Math.floor(i / 12) * 100,
    }));
    const { ids } = setup(objects, false);
    const runFrames = (count: number) => act(() => {
      for (let i = 0; i < count && frames.length; i++) {
        const queued = frames;
        frames = [];
        for (const callback of queued) callback(performance.now());
      }
    });
    runFrames(1);
    const first = ids().length;
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(objects.length);
    runFrames(10);
    expect(ids()).toHaveLength(objects.length);
  });
});
