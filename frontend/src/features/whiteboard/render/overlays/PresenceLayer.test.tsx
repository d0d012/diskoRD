import { Profiler } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CURSOR_IDLE_FADE_MS } from '../../contract';
import type { PresenceParticipant } from '../../contract';
import { BOARD, createHarness, rectObject } from '../../input/testUtils';
import { Viewport } from '../Viewport';
import { PresenceLayer } from './PresenceLayer';
import { fakePresenceAdapter, participant } from './presenceTestUtils';

let frames = new Map<number, FrameRequestCallback>();
let frameId = 0;
function flush(ms = 0): void {
  act(() => {
    if (ms) vi.advanceTimersByTime(ms);
    const queued = [...frames.values()];
    frames.clear();
    queued.forEach(callback => callback(performance.now()));
  });
}
beforeEach(() => {
  vi.useFakeTimers();
  frames = new Map();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id); });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 600 });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight;
});
function setup(initial: readonly PresenceParticipant[] = [participant()]) {
  const object = rectObject({ x: 10, y: 20 });
  const h = createHarness([object]);
  const fake = fakePresenceAdapter(initial);
  const rendered = vi.fn();
  const view = render(<Viewport store={h.store} session={h.session} runtime={h.runtime}>
    <Profiler id="presence" onRender={rendered}><PresenceLayer adapter={fake.adapter} store={h.store} runtime={h.runtime} selfUserId="self" /></Profiler>
  </Viewport>);
  flush();
  const cursor = () => view.container.querySelector<HTMLElement>('[data-wb-presence-user="remote"] [data-wb-remote-cursor]')!;
  const ghost = () => view.container.querySelector<HTMLElement>('[data-wb-remote-ghost]');
  return { ...h, ...view, fake, rendered, object, cursor, ghost };
}

describe('PresenceLayer', () => {
  it('renders one pixel cursor per remote member, with palette colour and name', () => {
    const v = setup([participant(), participant({ userId: 'self' }), participant({ userId: 'r2', name: 'Grace', colourIndex: 6 })]);
    expect(v.container.querySelectorAll('[data-wb-remote-cursor]')).toHaveLength(2);
    expect(v.cursor().parentElement!.style.getPropertyValue('--wb-cursor-color')).toBe('var(--wb-colour-red)');
    expect(v.cursor()).toHaveTextContent('Ada');
    expect(v.cursor().querySelector('svg')).toHaveAttribute('shape-rendering', 'crispEdges');
    expect(v.cursor().style.transform).toBe('translate(20px, 30px)');
    expect(v.cursor().hidden).toBe(false);
  });

  it('interpolates samples and camera changes in rAF, without a React render', () => {
    const v = setup();
    const renders = v.rendered.mock.calls.length;
    const cursor = v.cursor();
    act(() => {
      v.fake.emit([participant({ cursor: { x: 100, y: 50 } })]);
      v.fake.emit([participant({ cursor: { x: 120, y: 70 } })]);
      v.runtime.setCamera({ x: 10, y: 20, zoom: 2 });
    });
    // A scene rAF plus a presence rAF, not one presence rAF per sample.
    expect(frames.size).toBe(2);
    expect(cursor.style.transform).toBe('translate(20px, 30px)');
    flush(40);
    expect(cursor.style.transform).toBe('translate(150px, 120px)');
    flush(40);
    expect(cursor.style.transform).toBe('translate(250px, 160px)');
    expect(v.cursor()).toBe(cursor);
    expect(v.rendered).toHaveBeenCalledTimes(renders);
  });

  it('updates typing status without re-rendering; null and outside cursors are hidden', () => {
    const v = setup();
    const renders = v.rendered.mock.calls.length;
    act(() => v.fake.emit([participant({ editingId: 'text' })]));
    flush();
    expect(v.cursor().querySelector('[data-wb-cursor-status]')).toHaveTextContent('typing…');
    act(() => v.fake.emit([participant({ cursor: null })])); flush();
    expect(v.cursor().hidden).toBe(true);
    expect(v.cursor().querySelector('[data-wb-cursor-status]')).toBeEmptyDOMElement();
    act(() => v.fake.emit([participant({ cursor: { x: 900, y: 30 } })])); flush();
    expect(v.cursor().hidden).toBe(true);
    expect(v.rendered).toHaveBeenCalledTimes(renders);
  });

  it('fades after the contract idle time (CURSOR_IDLE_FADE_MS) without movement, hides at 60s, and wakes on motion', () => {
    const v = setup();
    flush(CURSOR_IDLE_FADE_MS - 1);
    expect(v.cursor().style.opacity).toBe('1');
    flush(1);
    expect(v.cursor().style.opacity).toBe('0.35');
    // Editing/selection heartbeats do not count as cursor movement.
    act(() => v.fake.emit([participant({ editingId: 'text' })])); flush();
    expect(v.cursor().style.opacity).toBe('0.35');
    flush(60_000 - CURSOR_IDLE_FADE_MS);
    expect(v.cursor().hidden).toBe(true);
    act(() => v.fake.emit([participant({ cursor: { x: 40, y: 50 } })])); flush(80);
    expect(v.cursor().hidden).toBe(false);
    expect(v.cursor().style.opacity).toBe('1');
  });

  it('draws remote selections with a name and follows geometry/camera changes', () => {
    const v = setup();
    act(() => v.fake.emit([participant({ selectedIds: [v.object.id] })])); flush();
    const selection = v.container.querySelector<HTMLElement>('[data-wb-remote-selection]')!;
    expect(selection).toHaveTextContent('Ada');
    expect(selection.style.transform).toBe('translate(10px, 20px)');
    expect(selection.style.width).toBe('100px');
    act(() => v.runtime.setCamera({ x: 5, y: 10, zoom: 2 })); flush();
    expect(selection.style.transform).toBe('translate(25px, 50px)');
    expect(selection.style.width).toBe('200px');
    act(() => v.fake.emit([participant()])); flush();
    expect(v.container.querySelector('[data-wb-remote-selection]')).toBeNull();
  });

  it.each(['end', 'leave', 'commit'] as const)('renders isolated drag ghosts without mutating live nodes; clears on %s', reason => {
    const v = setup();
    const live = v.container.querySelector<HTMLElement>(`[data-wb-world] [data-wb-object-id="${v.object.id}"]`)!;
    const originalTransform = live.style.transform;
    const dragging = participant({ selectedIds: [v.object.id], drag: { ids: [v.object.id], dx: 50, dy: 60 } });
    act(() => v.fake.emit([dragging])); flush();
    expect(v.ghost()).not.toBeNull();
    expect(v.ghost()!.parentElement!.style.transform).toBe('translate(50px, 60px) scale(1)');
    expect(live.style.transform).toBe(originalTransform);
    expect(v.store.getObject(v.object.id)).toMatchObject({ x: 10, y: 20 });
    if (reason === 'end') act(() => v.fake.emit([participant()]));
    else if (reason === 'leave') act(() => v.fake.emit([]));
    else act(() => {
      const commit = {
        channelId: BOARD, opId: 'op', seq: 2, userId: 'remote',
        changes: [{ id: v.object.id, action: 'update' as const, version: 2, patch: { x: 60, y: 80 } }],
      };
      v.fake.commit(commit);
      v.store.applyCommit(commit);
    });
    flush();
    expect(v.ghost()).toBeNull();
    if (reason !== 'leave') expect(v.container.querySelector<HTMLElement>('[data-wb-remote-ghosts]')!.style.transform).toBe('');
    if (reason === 'commit') {
      act(() => v.fake.emit([{ ...dragging, cursor: { x: 90, y: 90 } }])); flush();
      expect(v.ghost()).toBeNull(); // delayed drag samples cannot double the commit
      expect(live.style.transform).toBe('translate(60px, 80px)');
    } else expect(live.style.transform).toBe(originalTransform);
  });

  it('clears ghosts on snapshot geometry changes, including a commit before first rAF', () => {
    const v = setup();
    const drag = participant({ drag: { ids: [v.object.id], dx: 10, dy: 20 } });
    act(() => {
      v.fake.emit([drag]);
      v.fake.commit({ channelId: BOARD, opId: 'op', seq: 2, userId: 'remote', changes: [{ id: v.object.id, action: 'delete', version: 2 }] });
    }); flush();
    expect(v.ghost()).toBeNull();
    act(() => { v.fake.emit([participant()]); }); flush();
    act(() => { v.fake.emit([drag]); }); flush();
    expect(v.ghost()).not.toBeNull();
    act(() => v.store.hydrate({ seq: 2, objects: [{ ...v.object, version: 2, x: 50 }] })); flush();
    expect(v.ghost()).toBeNull();
  });

  it('suppresses a ghost when a snapshot arrives before its first paint', () => {
    const v = setup();
    act(() => {
      v.fake.emit([participant({ drag: { ids: [v.object.id], dx: 50, dy: 60 } })]);
      v.store.hydrate({ seq: 2, objects: [{ ...v.object, version: 2, x: 60, y: 80 }] });
    }); flush();
    expect(v.ghost()).toBeNull();
  });

  it('respects reduced motion by snapping samples without an interpolation loop', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
    const v = setup();
    act(() => v.fake.emit([participant({ cursor: { x: 100, y: 150 } })])); flush();
    expect(v.cursor().style.transform).toBe('translate(100px, 150px)');
    expect(frames.size).toBe(0);
  });

  it('clears an ended gesture even when a new drag of the same ids starts before rAF', () => {
    const v = setup();
    const drag = participant({ drag: { ids: [v.object.id], dx: 50, dy: 60 } });
    act(() => v.fake.emit([drag])); flush();
    const first = v.ghost();
    act(() => { v.fake.emit([participant()]); v.fake.emit([drag]); }); flush();
    expect(v.ghost()).not.toBeNull();
    expect(v.ghost()).not.toBe(first);
    expect(v.container.querySelectorAll('[data-wb-remote-ghost]')).toHaveLength(1);
  });

  it('unsubscribes and cancels scheduled work on unmount', () => {
    const v = setup();
    v.unmount();
    expect(v.fake.listenerCount()).toBe(0);
    expect(frames.size).toBe(0);
  });
});
