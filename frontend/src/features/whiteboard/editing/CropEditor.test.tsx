import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImageObject } from '../contract';
import { createBoardStore } from '../state/boardStore';
import { createSessionStore } from '../state/sessionStore';
import { createRuntime } from '../render/runtime';
import { resizeCrop } from '../core/crop';
import { CropEditor } from './CropEditor';

const image: ImageObject = {
  id: 'i1', kind: 'image', createdBy: 'me', version: 1, rank: '1:a0',
  x: 100, y: 200, w: 200, h: 100, assetId: 'asset', url: '/uploads/test.png',
  width: 800, height: 400, crop: { x: .25, y: .25, w: .5, h: .5 }, pixelated: false,
};

function setup() {
  const store = createBoardStore({ boardId: 'b', userId: 'me' });
  store.hydrate({ seq: 1, objects: [image] });
  const session = createSessionStore();
  const runtime = createRuntime();
  const dispatch = vi.spyOn(store, 'dispatch');
  const view = render(<div data-wb-viewport="" tabIndex={0}>
    <div data-wb-world=""><div data-wb-object-id="i1" /></div>
    <CropEditor store={store} session={session} runtime={runtime} />
  </div>);
  act(() => session.setCroppingId('i1'));
  const root = () => screen.getByRole('dialog', { name: 'Crop image' });
  const window = () => view.container.querySelector<HTMLElement>('[data-crop-window]')!;
  return { store, session, runtime, dispatch, view, root, window };
}

function dragHandle(container: HTMLElement, handle = 'e', x = 250, y = 250): void {
  fireEvent.pointerDown(container.querySelector(`[data-crop-handle="${handle}"]`)!, { pointerId: 1, button: 0, clientX: 300, clientY: 250 });
  fireEvent.pointerMove(document, { pointerId: 1, clientX: x, clientY: y });
  fireEvent.pointerUp(document, { pointerId: 1, clientX: x, clientY: y });
}

describe('CropEditor', () => {
  beforeEach(() => {
    // jsdom does not provide PointerEvent in every supported version.
    vi.stubGlobal('PointerEvent', MouseEvent);
    vi.useFakeTimers();
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('renders 8 square handles and hides the original without using the shared preview', () => {
    const { root, view, runtime, session } = setup();
    expect(root().hasAttribute('data-wb-ui')).toBe(true);
    expect(view.container.querySelectorAll('[data-crop-handle]')).toHaveLength(8);
    expect(view.container.querySelector('[data-wb-object-id]')?.hasAttribute('data-wb-crop-original')).toBe(true);
    expect(runtime.getPreview()).toEqual({ objects: [], hiddenIds: [], marquee: null });
    act(() => session.setCroppingId(null));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(view.container.querySelector('[data-wb-crop-original]')).toBeNull();
  });

  it('handle drag writes nothing; Enter commits exactly one crop + bounds update', () => {
    const { view, root, dispatch, store, session } = setup();
    dragHandle(view.container);
    expect(dispatch).not.toHaveBeenCalled();
    expect(store.getObject('i1')).toEqual(image);
    fireEvent.keyDown(root(), { key: 'Enter' });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0][0]).toEqual([{
      id: 'i1', action: 'update', expectedVersion: 1,
      patch: { x: 100, y: 200, w: 150, h: 100, crop: resizeCrop(image.crop, 'e', { x: 150, y: 50 }, image), pixelated: false },
    }]);
    expect(session.getState().croppingId).toBeNull();
    expect(document.activeElement).toBe(view.container.querySelector('[data-wb-viewport]'));
  });

  it('pans inside the window with clamping and no store writes until Done', () => {
    const { window, dispatch, store } = setup();
    fireEvent.pointerDown(window(), { button: 0, clientX: 150, clientY: 250 });
    fireEvent.pointerMove(document, { clientX: -1000, clientY: -1000 });
    fireEvent.pointerUp(document, { clientX: -1000, clientY: -1000 });
    expect(dispatch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(store.getObject('i1')).toMatchObject({ x: 100, y: 200, w: 200, h: 100, crop: { x: .5, y: .5, w: .5, h: .5 } });
  });

  it('Escape discards crop, reset and crisp changes and restores the original', () => {
    const { root, dispatch, store, session, view } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Reset crop' }));
    fireEvent.click(screen.getByRole('button', { name: 'Crisp pixels' }));
    fireEvent.keyDown(root(), { key: 'Escape' });
    expect(dispatch).not.toHaveBeenCalled();
    expect(store.getObject('i1')).toEqual(image);
    expect(session.getState().croppingId).toBeNull();
    expect(view.container.querySelector('[data-wb-cropping]')).toBeNull();
  });

  it('reset expands to the full source without rescaling, crisp is saved with the crop', () => {
    const { store, dispatch } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Reset crop' }));
    fireEvent.click(screen.getByRole('button', { name: 'Crisp pixels' }));
    expect(screen.getByRole('button', { name: 'Crisp pixels' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(store.getObject('i1')).toMatchObject({ x: 0, y: 150, w: 400, h: 200, crop: { x: 0, y: 0, w: 1, h: 1 }, pixelated: true });
  });

  it('outside press commits once and does not reach board pointer handlers', () => {
    const { dispatch } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Reset crop' }));
    const outside = vi.fn();
    document.body.addEventListener('pointerdown', outside);
    fireEvent.pointerDown(document.body);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(outside).not.toHaveBeenCalled();
    document.body.removeEventListener('pointerdown', outside);
  });

  it.each(['delete', 'update'] as const)('remote %s closes without writing a stale draft', action => {
    const { store, session, dispatch } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Reset crop' }));
    act(() => store.applyCommit({
      channelId: 'b', seq: 2, opId: 'remote', userId: 'other',
      changes: [action === 'delete' ? { id: 'i1', action, version: 2 } : { id: 'i1', action, version: 2, patch: { x: 500 } }],
    }));
    expect(session.getState().croppingId).toBeNull();
    expect(dispatch).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('paints source/window camera transforms without modifying the draft or store', () => {
    const { view, runtime, window, dispatch } = setup();
    const source = view.container.querySelector<HTMLElement>('.wb-crop-source')!;
    expect(source.style.transform).toBe('translate(0px, 150px)');
    expect(source.style.width).toBe('400px');
    act(() => { runtime.setCamera({ x: 20, y: 30, zoom: 2 }); vi.advanceTimersByTime(20); });
    expect(source.style.transform).toBe('translate(20px, 330px)');
    expect(window().style.transform).toBe('translate(220px, 430px)');
    expect(source.style.width).toBe('800px');
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('unmount cancels rather than commits, and a missing id is cleared', () => {
    const { view, dispatch } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Reset crop' }));
    view.unmount();
    expect(dispatch).not.toHaveBeenCalled();
    const store = createBoardStore({ boardId: 'b', userId: 'me' });
    const session = createSessionStore({ croppingId: 'missing' });
    render(<CropEditor store={store} session={session} runtime={createRuntime()} />);
    expect(session.getState().croppingId).toBeNull();
  });
});
