import type { Runtime, SyncAdapter } from '../contract';
import { fitToBounds, visibleWorldRect } from '../core/camera';
import { getFollowStore } from '../state/followStore';

/** Camera/presence samples stay outside React; only the followed identity is state. */
export function attachFollow(element: HTMLElement, runtime: Runtime, adapter: SyncAdapter) {
  const store = getFollowStore(adapter);
  const win = element.ownerDocument.defaultView!;
  const reduced = win.matchMedia?.('(prefers-reduced-motion: reduce)');
  let frame = 0;
  let previousTime = 0;
  let writing = false;
  let disposed = false;
  const size = () => ({ x: 0, y: 0, w: element.clientWidth, h: element.clientHeight });
  const stop = () => store.getState().follow(null);
  const broadcast = () => {
    const rect = size();
    if (rect.w > 0 && rect.h > 0) adapter.sendPresence({ viewport: visibleWorldRect(runtime.getCamera(), rect) });
  };
  const target = () => adapter.getPresence().find(p => p.userId === store.getState().userId);
  function schedule() {
    if (!frame && !disposed && store.getState().userId) frame = win.requestAnimationFrame(tick);
  }
  function tick(time: number) {
    frame = 0;
    const person = target();
    if (!person?.viewport) { stop(); return; }
    const screen = size();
    if (screen.w <= 0 || screen.h <= 0) return;
    const desired = fitToBounds(person.viewport, screen, 0);
    const current = runtime.getCamera();
    // Time-based easing: stable on high-refresh displays, no jump after a suspended tab.
    const alpha = reduced?.matches ? 1 : 1 - Math.exp(-Math.min(64, previousTime ? time - previousTime : 16) / 70);
    previousTime = time;
    const done = Math.abs(current.x - desired.x) < .1 && Math.abs(current.y - desired.y) < .1 && Math.abs(current.zoom - desired.zoom) < .0001;
    writing = true;
    try {
      runtime.setCamera(done || alpha === 1 ? desired : {
        x: current.x + (desired.x - current.x) * alpha,
        y: current.y + (desired.y - current.y) * alpha,
        zoom: current.zoom + (desired.zoom - current.zoom) * alpha,
      });
    } finally { writing = false; }
    if (!done && alpha !== 1) schedule();
  }
  const offState = store.subscribe(() => {
    if (frame) win.cancelAnimationFrame(frame);
    frame = 0;
    previousTime = 0;
    schedule();
  });
  const offPresence = adapter.subscribePresence(() => {
    if (!store.getState().userId) return;
    if (!target()?.viewport) stop(); else schedule();
  });
  const offCamera = runtime.subscribeCamera(() => {
    if (!writing && store.getState().userId) stop();
    // The adapter coalesces non-cursor fields and throttles these to 5 Hz.
    broadcast();
  });
  const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') stop(); };
  const onPointer = (event: PointerEvent) => {
    if (event.pointerType === 'touch' || event.button === 1) stop();
  };
  element.addEventListener('wheel', stop, { capture: true, passive: true });
  element.addEventListener('gesturestart', stop, true);
  element.addEventListener('pointerdown', onPointer, true);
  win.addEventListener('keydown', onKey, true);
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => { broadcast(); schedule(); });
  observer?.observe(element);
  win.addEventListener('resize', broadcast);
  broadcast();
  schedule();
  return () => {
    disposed = true;
    offState(); offPresence(); offCamera(); observer?.disconnect();
    if (frame) win.cancelAnimationFrame(frame);
    stop();
    element.removeEventListener('wheel', stop, true);
    element.removeEventListener('gesturestart', stop, true);
    element.removeEventListener('pointerdown', onPointer, true);
    win.removeEventListener('keydown', onKey, true);
    win.removeEventListener('resize', broadcast);
  };
}
