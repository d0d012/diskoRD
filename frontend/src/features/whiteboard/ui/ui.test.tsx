import type { ReactElement } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Camera, RectObject, StickyObject, Runtime } from '../contract';
import { createBoardNotices, createBoardStore, createSessionStore } from '../state';
import { BOARD_NOTICE_DURATION_MS, BoardNotice, Toolbar, StyleBar, UndoRedo, ZoomControl } from './index';

function makeRuntime(): Runtime {
  let camera: Camera = { x: 0, y: 0, zoom: 1 };
  const listeners = new Set<(c: Camera) => void>();
  return {
    getCamera: () => camera,
    setCamera: c => { camera = c; listeners.forEach(l => l(c)); },
    subscribeCamera: l => { listeners.add(l); return () => { listeners.delete(l); }; },
    screenToWorld: p => ({ x: (p.x - camera.x) / camera.zoom, y: (p.y - camera.y) / camera.zoom }),
    worldToScreen: p => ({ x: p.x * camera.zoom + camera.x, y: p.y * camera.zoom + camera.y }),
    getPreview: () => ({ objects: [], hiddenIds: [], marquee: null }),
    setPreview: () => undefined,
    subscribePreview: () => () => undefined,
  };
}

const rect: RectObject = {
  id: 'r1', kind: 'rect', rank: '1:a0', version: 1, createdBy: 'me', x: 0, y: 0, w: 100, h: 80,
  style: { colour: 'ink', weight: 'thin', fill: 'none' },
};
const sticky: StickyObject = {
  id: 's1', kind: 'sticky', rank: '1:a1', version: 1, createdBy: 'me', x: 200, y: 0, w: 200, h: 200,
  text: 'hi', style: { tone: 'yellow', font: 'handwriting' },
};

function setup() {
  const store = createBoardStore({ boardId: 'b', userId: 'me' });
  store.hydrate({ seq: 1, objects: [rect, sticky] });
  const session = createSessionStore();
  const runtime = makeRuntime();
  return { store, session, runtime };
}

afterEach(() => { vi.unstubAllGlobals(); });
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} });
});

describe('Toolbar', () => {
  it('lists the tools, the Image tool between Text and Frame, and marks the active one', () => {
    const props = setup();
    render(<Toolbar {...props} />);
    expect(screen.getByRole('toolbar', { name: 'Board tools' }).hasAttribute('data-wb-ui')).toBe(true);
    const names = screen.getAllByRole('button').map(button => button.getAttribute('aria-label'));
    expect(names.slice(names.indexOf('Text (T)'), names.indexOf('Frame (F)') + 1)).toEqual(['Text (T)', 'Image (I)', 'Frame (F)']);
    expect(screen.getByRole('button', { name: 'Image (I)' }).getAttribute('data-wb-tooltip')).toBe('Image · I');
    expect(screen.getByRole('button', { name: 'Select (V)' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Pen (P)' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('the Image tool marks the picker as open and a second click closes it', () => {
    const props = setup();
    render(<Toolbar {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Image (I)' }));
    expect(props.session.getState().tool).toBe('image');
    expect(screen.getByRole('button', { name: 'Image (I)' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Image (I)' }));
    expect(props.session.getState().tool).toBe('select');
  });

  it('the click that dismissed the picker does not reopen it', () => {
    const props = setup();
    render(<Toolbar {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Image (I)' }));
    props.session.setTool('select'); // the picker closed itself on pointer-down
    fireEvent.click(screen.getByRole('button', { name: 'Image (I)' }));
    expect(props.session.getState().tool).toBe('select');
  });

  it('switches tools on click and reflects session changes', () => {
    const props = setup();
    render(<Toolbar {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Rectangle (R)' }));
    expect(props.session.getState().tool).toBe('rect');
    expect(screen.getByRole('button', { name: 'Rectangle (R)' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Select (V)' }).getAttribute('aria-pressed')).toBe('false');
    act(() => props.session.setTool('hand'));
    expect(screen.getByRole('button', { name: 'Hand (H)' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('picks a sticky tone and activates the sticky tool', () => {
    const props = setup();
    render(<Toolbar {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'pink sticky (S)' }));
    expect(props.session.getState().tool).toBe('sticky');
    expect(props.session.getState().styleDefaults.sticky.tone).toBe('pink');
  });

  it('uses a roving tabindex with arrow-key navigation', () => {
    const props = setup();
    render(<Toolbar {...props} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons.filter(b => b.tabIndex === 0)).toHaveLength(1);
    const select = screen.getByRole('button', { name: 'Select (V)' });
    select.focus();
    fireEvent.keyDown(select, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Hand (H)' }));
    expect(screen.getAllByRole('button').filter(b => b.tabIndex === 0)).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Hand (H)' }).tabIndex).toBe(0);
    fireEvent.keyDown(document.activeElement as Element, { key: 'Home' });
    expect(document.activeElement).toBe(select);
  });
});

describe('StyleBar', () => {
  it('renders nothing without a selection', () => {
    const props = setup();
    render(<StyleBar {...props} />);
    expect(screen.queryByRole('toolbar', { name: 'Selection style' })).toBeNull();
  });

  it('shows only controls valid for the selection', () => {
    const props = setup();
    props.session.setSelectedIds(['r1']);
    const { rerender } = render(<StyleBar {...props} />);
    expect(screen.getByRole('group', { name: 'Ink colour' })).toBeTruthy();
    expect(screen.getByLabelText('Fill')).toBeTruthy();
    expect(screen.queryByLabelText('Text size')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Sticky tone' })).toBeNull();
    act(() => props.session.setSelectedIds(['s1']));
    rerender(<StyleBar {...props} />);
    expect(screen.getByRole('group', { name: 'Sticky tone' })).toBeTruthy();
    expect(screen.queryByLabelText('Fill')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Ink colour' })).toBeNull();
  });

  it('dispatches a style patch, reorders and deletes', () => {
    const props = setup();
    props.session.setSelectedIds(['r1']);
    render(<StyleBar {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'red ink' }));
    expect((props.store.getObject('r1') as RectObject).style.colour).toBe('red');
    fireEvent.change(screen.getByLabelText('Fill'), { target: { value: 'solid' } });
    expect((props.store.getObject('r1') as RectObject).style.fill).toBe('solid');
    fireEvent.click(screen.getByRole('button', { name: 'Bring to front' }));
    const order = props.store.getObjectsInRank().map(o => o.id);
    expect(order[order.length - 1]).toBe('r1');
    fireEvent.click(screen.getByRole('button', { name: 'Delete selection' }));
    expect(props.store.getObject('r1')).toBeUndefined();
    expect(props.session.getState().selectedIds).toEqual([]);
  });

  it('routes an over-limit refusal through the notice channel, not inline', () => {
    const notices = createBoardNotices();
    const store = createBoardStore({ boardId: 'b', userId: 'me' });
    const objects = Array.from({ length: 501 }, (_, i) => ({ ...rect, id: `r${i}`, rank: `1:b${i}` }));
    store.hydrate({ seq: 1, objects });
    const session = createSessionStore();
    session.setSelectedIds(objects.map(object => object.id));
    render(<StyleBar store={store} session={session} runtime={makeRuntime()} notify={notices.notify} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete selection' }));
    expect(notices.getLatest()).toMatchObject({ kind: 'too-many-changes' });
    expect(notices.getLatest()!.message).toContain('Too many objects selected');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('routes a refused style change through the notice channel', () => {
    const notices = createBoardNotices();
    const props = setup();
    vi.spyOn(props.store, 'dispatch').mockImplementation(() => { throw new Error('Invalid expectedVersion'); });
    props.session.setSelectedIds(['r1']);
    render(<StyleBar {...props} notify={notices.notify} />);
    fireEvent.click(screen.getByRole('button', { name: 'red ink' }));
    expect(notices.getLatest()).toMatchObject({ kind: 'refused' });
    expect(notices.getLatest()!.message).toBe('That change could not be applied.');
    expect(screen.queryByRole('status')).toBeNull();
  });
});

function inViewport(node: ReactElement) {
  return <div data-wb-viewport>{node}</div>;
}

describe('ZoomControl and UndoRedo', () => {
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 600 });
  });
  it('zooms in and out and shows the percentage without React camera state', () => {
    const props = setup();
    render(inViewport(<ZoomControl {...props} />));
    expect(screen.getByRole('button', { name: /Zoom to fit all/ }).textContent).toBe('100%');
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(props.runtime.getCamera().zoom).toBeCloseTo(1.2);
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(props.runtime.getCamera().zoom).toBeLessThan(1);
  });

  it('fits all objects when the percentage is clicked', () => {
    const props = setup();
    render(inViewport(<ZoomControl {...props} />));
    const before = props.runtime.getCamera();
    fireEvent.click(screen.getByRole('button', { name: /Zoom to fit all/ }));
    expect(props.runtime.getCamera()).not.toEqual(before);
  });

  it('enables undo/redo from live store state', () => {
    const props = setup();
    render(<UndoRedo {...props} />);
    const undo = screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement;
    const redo = screen.getByRole('button', { name: 'Redo' }) as HTMLButtonElement;
    expect(undo.disabled).toBe(true);
    act(() => {
      const opId = props.store.dispatch([{ id: 'r1', action: 'delete', expectedVersion: 1 }]);
      props.store.acknowledge(opId, { seq: 2, changes: [{ id: 'r1', action: 'delete', version: 2 }] });
    });
    expect(undo.disabled).toBe(false);
    fireEvent.click(undo);
    expect(props.store.getObject('r1')).toBeDefined();
    expect(redo.disabled).toBe(false);
  });
});

describe('BoardNotice', () => {
  it('shows the latest refused-action notice briefly, then clears it', () => {
    vi.useFakeTimers();
    try {
      const notices = createBoardNotices();
      render(<div className="wb-root"><BoardNotice notices={notices} /></div>);
      expect(screen.queryByRole('status')).toBeNull();
      act(() => notices.notify('too-many-changes', 'Too many objects selected for one action'));
      const status = screen.getByRole('status');
      expect(status).toHaveTextContent('Too many objects selected for one action');
      expect(status).toHaveAttribute('data-wb-ui');
      act(() => { vi.advanceTimersByTime(BOARD_NOTICE_DURATION_MS - 1); });
      act(() => notices.notify('board-full', 'This board is full'));
      // A newer notice restarts the timer.
      act(() => { vi.advanceTimersByTime(BOARD_NOTICE_DURATION_MS - 1); });
      expect(screen.getByRole('status')).toHaveTextContent('This board is full');
      act(() => { vi.advanceTimersByTime(1); });
      expect(screen.queryByRole('status')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
