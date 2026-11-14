import { describe, expect, it } from 'vitest';
import { MAX_ZOOM, MIN_ZOOM } from '../contract/limits';
import {
  clampZoom, fitToBounds, screenToWorld, visibleWorldRect, worldToScreen, zoomAt,
} from './camera';

describe('screenToWorld / worldToScreen', () => {
  const camera = { x: 100, y: 50, zoom: 2 };

  it('round-trips a point', () => {
    const world = screenToWorld({ x: 300, y: 250 }, camera);
    expect(world).toEqual({ x: 100, y: 100 });
    expect(worldToScreen(world, camera)).toEqual({ x: 300, y: 250 });
  });

  it('handles the identity camera', () => {
    const identity = { x: 0, y: 0, zoom: 1 };
    expect(screenToWorld({ x: 7, y: -3 }, identity)).toEqual({ x: 7, y: -3 });
    expect(worldToScreen({ x: 7, y: -3 }, identity)).toEqual({ x: 7, y: -3 });
  });

  it('does not mutate its inputs', () => {
    const world = { x: 5, y: 6 };
    const frozen = Object.freeze(world);
    const out = worldToScreen(frozen, camera);
    expect(out).not.toBe(frozen);
  });
});

describe('clampZoom', () => {
  it('clamps below and above the limits', () => {
    expect(clampZoom(0)).toBe(MIN_ZOOM);
    expect(clampZoom(-5)).toBe(MIN_ZOOM);
    expect(clampZoom(0.05)).toBe(MIN_ZOOM);
    expect(clampZoom(2)).toBe(2);
    expect(clampZoom(100)).toBe(MAX_ZOOM);
  });

  it('passes the exact limits through', () => {
    expect(clampZoom(MIN_ZOOM)).toBe(MIN_ZOOM);
    expect(clampZoom(MAX_ZOOM)).toBe(MAX_ZOOM);
  });
});

describe('zoomAt', () => {
  it('keeps the world point under the cursor fixed', () => {
    const camera = { x: 40, y: 30, zoom: 2 };
    const cursor = { x: 160, y: 90 };
    const worldBefore = screenToWorld(cursor, camera);
    const next = zoomAt(camera, cursor, 3);
    expect(next.zoom).toBe(3);
    expect(screenToWorld(cursor, next)).toEqual(worldBefore);
  });

  it('clamps the requested zoom', () => {
    const camera = { x: 0, y: 0, zoom: 1 };
    expect(zoomAt(camera, { x: 100, y: 100 }, 1e12).zoom).toBe(MAX_ZOOM);
    expect(zoomAt(camera, { x: 100, y: 100 }, -1).zoom).toBe(MIN_ZOOM);
  });
});

describe('fitToBounds', () => {
  it('fits and centers with padding', () => {
    const camera = fitToBounds({ x: 0, y: 0, w: 200, h: 100 }, { x: 0, y: 0, w: 800, h: 600 }, 40);
    // available 720x520 -> zoom = min(720/200, 520/100) = 3.6
    expect(camera.zoom).toBeCloseTo(3.6, 10);
    expect(camera.x).toBeCloseTo(400 - 100 * 3.6, 10);
    expect(camera.y).toBeCloseTo(300 - 50 * 3.6, 10);
  });

  it('respects an offset viewport origin', () => {
    const camera = fitToBounds({ x: 0, y: 0, w: 100, h: 100 }, { x: 10, y: 20, w: 400, h: 400 }, 0);
    expect(camera.zoom).toBe(4);
    expect(camera.x).toBeCloseTo(10 + 200 - 50 * 4, 10);
    expect(camera.y).toBeCloseTo(20 + 200 - 50 * 4, 10);
  });

  it('clamps zoom at the contract limits', () => {
    const tiny = fitToBounds({ x: 0, y: 0, w: 0.0001, h: 0.0001 }, { x: 0, y: 0, w: 1000, h: 1000 }, 0);
    expect(tiny.zoom).toBe(MAX_ZOOM);
    const huge = fitToBounds({ x: 0, y: 0, w: 1e9, h: 1e9 }, { x: 0, y: 0, w: 1000, h: 1000 }, 0);
    expect(huge.zoom).toBe(MIN_ZOOM);
  });

  it('handles degenerate bounds without NaN', () => {
    const bothZero = fitToBounds({ x: 5, y: 5, w: 0, h: 0 }, { x: 0, y: 0, w: 100, h: 100 }, 0);
    expect(bothZero.zoom).toBe(MAX_ZOOM);
    expect(Number.isFinite(bothZero.x)).toBe(true);
    expect(Number.isFinite(bothZero.y)).toBe(true);

    const flatX = fitToBounds({ x: 5, y: 5, w: 0, h: 100 }, { x: 0, y: 0, w: 400, h: 400 }, 0);
    expect(flatX.zoom).toBe(4);
  });

  it('clamps negative or oversized padding', () => {
    const negative = fitToBounds({ x: 0, y: 0, w: 100, h: 100 }, { x: 0, y: 0, w: 400, h: 400 }, -50);
    expect(negative.zoom).toBe(4);
    const oversized = fitToBounds({ x: 0, y: 0, w: 100, h: 100 }, { x: 0, y: 0, w: 100, h: 100 }, 1000);
    expect(Number.isFinite(oversized.zoom)).toBe(true);
  });
});

describe('visibleWorldRect', () => {
  it('maps viewport through the camera', () => {
    const rect = visibleWorldRect({ x: 10, y: 20, zoom: 2 }, { x: 0, y: 0, w: 100, h: 50 });
    expect(rect).toEqual({ x: -5, y: -10, w: 50, h: 25 });
  });

  it('accounts for viewport origin', () => {
    const rect = visibleWorldRect({ x: 0, y: 0, zoom: 0.5 }, { x: 100, y: 50, w: 200, h: 100 });
    expect(rect).toEqual({ x: 200, y: 100, w: 400, h: 200 });
  });
});
