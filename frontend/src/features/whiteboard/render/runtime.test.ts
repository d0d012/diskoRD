import { describe, expect, it, vi } from 'vitest';
import { MAX_ZOOM, MIN_ZOOM } from '../contract';
import { createRuntime } from './runtime';
import { rect, sticky } from './testObjects';

describe('createRuntime', () => {
  it('starts from the partial camera and clamps zoom to the contract limits', () => {
    expect(createRuntime().getCamera()).toEqual({ x: 0, y: 0, zoom: 1 });
    expect(createRuntime({ x: 5, zoom: 99 }).getCamera()).toEqual({ x: 5, y: 0, zoom: MAX_ZOOM });
    expect(createRuntime({ zoom: Number.NaN }).getCamera().zoom).toBe(1);
    const runtime = createRuntime();
    runtime.setCamera({ x: 1, y: 2, zoom: 0.001 });
    expect(runtime.getCamera()).toEqual({ x: 1, y: 2, zoom: MIN_ZOOM });
    runtime.setCamera({ x: 1.25, y: -3.5, zoom: 2 });
    expect(runtime.getCamera()).toEqual({ x: 1.25, y: -3.5, zoom: 2 }); // not rounded to pixels
  });

  it('notifies camera subscribers synchronously, skips no-ops and non-finite cameras, and unsubscribes', () => {
    const runtime = createRuntime();
    const listener = vi.fn();
    const off = runtime.subscribeCamera(listener);
    runtime.setCamera({ x: 10, y: 0, zoom: 1 });
    expect(listener).toHaveBeenCalledWith({ x: 10, y: 0, zoom: 1 });
    runtime.setCamera({ x: 10, y: 0, zoom: 1 });
    runtime.setCamera({ x: 10, y: 0, zoom: 50 });
    runtime.setCamera({ x: 10, y: 0, zoom: 60 }); // clamps to the same zoom: no-op
    expect(listener).toHaveBeenCalledTimes(2);
    runtime.setCamera({ x: Number.NaN, y: 0, zoom: 1 });
    expect(runtime.getCamera()).toEqual({ x: 10, y: 0, zoom: MAX_ZOOM });
    off();
    runtime.setCamera({ x: 0, y: 0, zoom: 1 });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('converts between screen and world with the current camera', () => {
    const runtime = createRuntime({ x: 100, y: 50, zoom: 2 });
    expect(runtime.worldToScreen({ x: 10, y: 10 })).toEqual({ x: 120, y: 70 });
    expect(runtime.screenToWorld({ x: 120, y: 70 })).toEqual({ x: 10, y: 10 });
  });

  it('replaces (never merges) the preview and notifies subscribers', () => {
    const runtime = createRuntime();
    expect(runtime.getPreview()).toEqual({ objects: [], hiddenIds: [], marquee: null });
    const listener = vi.fn();
    runtime.subscribePreview(listener);
    runtime.setPreview({ objects: [rect], hiddenIds: ['a'], marquee: { x: 0, y: 0, w: 5, h: 5 } });
    runtime.setPreview({ objects: [sticky], hiddenIds: [], marquee: null });
    expect(runtime.getPreview()).toEqual({ objects: [sticky], hiddenIds: [], marquee: null });
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith(runtime.getPreview());
    expect(Object.isFrozen(runtime.getPreview().objects)).toBe(true);
  });
});
