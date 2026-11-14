import { describe, expect, it } from 'vitest';
import type { RectObject } from '../contract';
import { computeVisibleSet, cullingBounds, SpatialGrid } from './culling';
import { frame, rect } from './testObjects';

function at(id: string, x: number, y: number, w = 10, h = 10): RectObject {
  return { ...rect, id, x, y, w, h };
}

describe('culling', () => {
  it('returns only objects intersecting the query, across cells', () => {
    const grid = new SpatialGrid();
    for (const object of [at('near', 10, 10), at('edge', 1020, 10), at('far', 5000, 5000)]) grid.set(object);
    expect([...grid.query({ x: 0, y: 0, w: 1025, h: 100 })].sort()).toEqual(['edge', 'near']);
  });

  it('moves and deletes entries incrementally', () => {
    const grid = new SpatialGrid();
    grid.set(at('a', 10, 10));
    grid.set(at('a', 5000, 5000));
    expect(grid.query({ x: 0, y: 0, w: 100, h: 100 }).size).toBe(0);
    expect(grid.query({ x: 4990, y: 4990, w: 50, h: 50 })).toEqual(new Set(['a']));
    grid.delete('a');
    expect(grid.query({ x: 4990, y: 4990, w: 50, h: 50 }).size).toBe(0);
  });

  it('handles oversized objects and queries without allocating huge cell ranges', () => {
    const grid = new SpatialGrid();
    grid.set(at('huge', -1_000_000, -1_000_000, 2_000_000, 2_000_000));
    grid.set(at('small', 0, 0));
    expect(grid.query({ x: 100, y: 100, w: 1, h: 1 })).toEqual(new Set(['huge']));
    expect(grid.query({ x: -9_000_000, y: -9_000_000, w: 18_000_000, h: 18_000_000 })).toEqual(new Set(['huge', 'small']));
  });

  it('includes a frame through its outside label', () => {
    const grid = new SpatialGrid();
    grid.set(frame);
    // The label strip lies entirely above frame.y.
    expect(grid.query({ x: frame.x, y: frame.y - 20, w: 10, h: 10 })).toEqual(new Set([frame.id]));
  });

  it('computes the visible set with screen-sized overscan at any zoom', () => {
    expect(cullingBounds({ x: 0, y: 0, zoom: 1 }, 800, 600)).toEqual({ x: -100, y: -100, w: 1000, h: 800 });
    expect(cullingBounds({ x: 0, y: 0, zoom: 0.5 }, 800, 600)).toEqual({ x: -200, y: -200, w: 2000, h: 1600 });
  });

  it('applies preview drafts, replacements and hidden ids', () => {
    const grid = new SpatialGrid();
    grid.set(at('a', 10, 10));
    grid.set(at('b', 20, 20));
    grid.set(at('c', 30, 30));
    const view = { x: 0, y: 0, w: 500, h: 500 };
    const visible = computeVisibleSet(grid, view, [at('draft', 40, 40), at('b', 9000, 9000), at('c', 50, 50)], ['a', 'c']);
    // a hidden; b moved offscreen by its preview; c hidden but replaced by its preview.
    expect([...visible].sort()).toEqual(['c', 'draft']);
  });
});
