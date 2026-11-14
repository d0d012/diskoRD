import { describe, expect, it } from 'vitest';
import { createScene, intersects, readOptions, SpatialGrid } from './scene';
import { summarize } from './runtime';

describe('throwaway benchmark workload', () => {
  it('uses plan defaults and explicit query overrides', () => {
    expect(readOptions('')).toEqual({ n: 2000, cull: true, willchange: true, auto: false });
    expect(readOptions('?n=300&cull=0&willchange=0&auto=1')).toEqual({ n: 300, cull: false, willchange: false, auto: true });
    for (const n of ['NaN', '-1', '1.5', 'Infinity']) expect(readOptions(`?n=${n}`).n).toBe(2000);
    expect(readOptions('?n=0').n).toBe(0);
  });

  it('generates a deterministic exact mix, filled outlines and actual bitmaps', () => {
    const objects = createScene(2000);
    expect(createScene(2000)).toEqual(objects);
    const counts = Object.fromEntries(['sticky', 'text', 'shape', 'stroke', 'image', 'frame'].map((kind) => [kind, objects.filter((object) => object.kind === kind).length]));
    expect(counts).toEqual({ sticky: 600, text: 300, shape: 400, stroke: 500, image: 140, frame: 60 });
    expect(objects.slice(0, 60).every((object) => object.kind === 'frame')).toBe(true);
    for (const object of objects) {
      if (object.kind === 'stroke') {
        expect(object.pointCount).toBeGreaterThanOrEqual(100);
        expect(object.pointCount).toBeLessThanOrEqual(400);
        expect(object.path?.match(/[ML]/g)).toHaveLength(object.pointCount!);
        expect(object.path?.endsWith('Z')).toBe(true);
      }
      if (object.kind === 'image') {
        const bytes = atob(object.src!.split(',')[1]);
        expect(bytes.slice(0, 2)).toBe('BM');
        expect(bytes.length).toBe(54 + 32 * 32 * 3);
      }
    }
  });

  it('matches brute-force culling, preserves stack order, deduplicates cells and pins drags', () => {
    const objects = createScene(500);
    const grid = new SpatialGrid(objects);
    const pinned = new Set([0, 299]);
    for (let i = -1; i < 12; i++) {
      const bounds = { x: i * 900, y: i * 700, width: 1800, height: 1300 };
      expect(grid.query(bounds)).toEqual(objects.filter((object) => intersects(object, bounds)));
      expect(grid.query(bounds, pinned)).toEqual(objects.filter((object) => intersects(object, bounds) || pinned.has(object.id)));
    }
    expect(new SpatialGrid([]).query({ x: 0, y: 0, width: 100, height: 100 })).toEqual([]);
  });

  it('reports elapsed-time FPS, nearest-rank percentiles and mounted counts', () => {
    expect(summarize([10, 20, 30, 40], [20, 30, 40, 10])).toEqual({
      durationMs: 100, frames: 4, avgFps: 40,
      p95FrameMs: 40, p99FrameMs: 40, worstFrameMs: 40, framesOver20Ms: 2,
      mountedObjects: { min: 10, max: 40, avg: 25, end: 10 },
    });
    const stats = summarize(Array.from({ length: 100 }, (_, index) => index + 1), [1]);
    expect(stats.p95FrameMs).toBe(95);
    expect(stats.p99FrameMs).toBe(99);
  });
});
