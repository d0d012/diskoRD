import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FollowView } from './FollowView';
import { Participants } from './Participants';
import { FollowPersonButton } from './FollowPersonButton';
import { createRuntime } from '../render/runtime';
import { fakePresenceAdapter, participant } from '../render/overlays/presenceTestUtils';
import { getFollowStore } from '../state/followStore';
import { fitToBounds } from '../core/camera';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function setup(reduced = false) {
  const callbacks = new Map<number, FrameRequestCallback>();
  let id = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callbacks.set(++id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', (key: number) => callbacks.delete(key));
  vi.stubGlobal('matchMedia', () => ({ matches: reduced }));
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
  const rect = { x: 100, y: 200, w: 400, h: 400 };
  const fake = fakePresenceAdapter([participant({ viewport: rect }), participant({ userId: 'self', name: 'Me' })]);
  const runtime = createRuntime();
  const view = render(<div data-wb-viewport=""><FollowView adapter={fake.adapter} runtime={runtime} /><Participants adapter={fake.adapter} selfUserId="self" /></div>);
  function tick(time = 16) {
    act(() => { const batch = [...callbacks.values()]; callbacks.clear(); batch.forEach(callback => callback(time)); });
  }
  return { ...fake, view, runtime, rect, tick, callbacks, store: getFollowStore(fake.adapter) };
}
describe('follow view', () => {
  it('provides a People-row follow toggle sharing the same session', () => {
    const fake = fakePresenceAdapter();
    const view = render(<FollowPersonButton adapter={fake.adapter} userId="remote" name="Ada" />);
    fireEvent.click(view.getByRole('button', { name: 'Follow Ada' }));
    expect(getFollowStore(fake.adapter).getState().userId).toBe('remote');
    fireEvent.click(view.getByRole('button', { name: 'Stop following Ada' }));
    expect(getFollowStore(fake.adapter).getState().userId).toBeNull();
  });
  it('broadcasts the visible world rectangle initially and after camera changes', () => {
    const s = setup();
    expect(s.adapter.sendPresence).toHaveBeenLastCalledWith({ viewport: { x: 0, y: 0, w: 800, h: 600 } });
    act(() => s.runtime.setCamera({ x: -100, y: -200, zoom: 2 }));
    expect(s.adapter.sendPresence).toHaveBeenLastCalledWith({ viewport: { x: 50, y: 100, w: 400, h: 300 } });
  });
  it('starts from an avatar, smoothly fits the remote rectangle, and stops via pill', () => {
    const s = setup();
    fireEvent.click(s.view.getByRole('button', { name: 'Ada' }));
    expect(s.view.getByText('Following Ada · Esc')).toBeInTheDocument();
    s.tick();
    const desired = fitToBounds(s.rect, { x: 0, y: 0, w: 800, h: 600 }, 0);
    expect(s.runtime.getCamera().zoom).toBeGreaterThan(1);
    expect(s.runtime.getCamera().zoom).toBeLessThan(desired.zoom);
    for (let i = 2; i < 100; i++) s.tick(i * 16);
    expect(s.runtime.getCamera()).toEqual(desired);
    fireEvent.click(s.view.getByRole('button', { name: 'Stop following Ada' }));
    expect(s.store.getState().userId).toBeNull();
    expect(s.view.queryByText('Following Ada · Esc')).toBeNull();
    expect(s.view.getByRole('button', { name: 'Me (you)' })).toBeDisabled();
  });
  it('tracks updated viewports with reduced motion and clamps zoom', () => {
    const s = setup(true);
    fireEvent.click(s.view.getByRole('button', { name: 'Ada' })); s.tick();
    expect(s.runtime.getCamera()).toEqual({ x: -50, y: -300, zoom: 1.5 });
    act(() => s.emit([participant({ viewport: { x: 0, y: 0, w: 1, h: 1 } })])); s.tick();
    expect(s.runtime.getCamera().zoom).toBe(4);
    act(() => s.emit([participant({ viewport: { x: 0, y: 0, w: 100000, h: 100000 } })])); s.tick();
    expect(s.runtime.getCamera().zoom).toBe(.1);
  });
  it.each(['escape', 'wheel', 'pinch', 'camera', 'expiry', 'leave'] as const)('stops on %s and cancels pending animation', reason => {
    const s = setup();
    fireEvent.click(s.view.getByRole('button', { name: 'Ada' }));
    const viewport = s.view.container.firstElementChild!;
    act(() => {
      if (reason === 'escape') fireEvent.keyDown(window, { key: 'Escape' });
      if (reason === 'wheel') fireEvent.wheel(viewport);
      if (reason === 'pinch') fireEvent(viewport, new Event('gesturestart', { bubbles: true }));
      if (reason === 'camera') s.runtime.setCamera({ x: 5, y: 5, zoom: 1 });
      if (reason === 'expiry') s.emit([participant({ viewport: null })]);
      if (reason === 'leave') s.emit([]);
    });
    expect(s.store.getState().userId).toBeNull();
    expect(s.callbacks.size).toBe(0);
  });
  it('isolates board sessions and cleans subscriptions/frames on unmount', () => {
    const s = setup();
    expect(getFollowStore(fakePresenceAdapter().adapter)).not.toBe(s.store);
    fireEvent.click(s.view.getByRole('button', { name: 'Ada' }));
    s.view.unmount();
    expect(s.callbacks.size).toBe(0);
    expect(s.listenerCount()).toBe(0);
    expect(s.store.getState().userId).toBeNull();
  });
});
