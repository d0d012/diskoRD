import { describe, expect, it } from 'vitest';
import type { BoardObject, RectObject, StrokeObject } from '../contract';
import { createBoardStore } from '../state';
import {
  REGION_CELL_SIZE,
  clusterAuthorRegions,
  computeAuthorRegions,
  getAuthorRegions,
} from './regions';

function makeRect(
  id: string,
  createdBy: string,
  x: number,
  y: number,
  w = 240,
  h = 240,
): RectObject {
  return {
    id,
    kind: 'rect',
    rank: `1:${id}`,
    version: 1,
    createdBy,
    x,
    y,
    w,
    h,
    style: { colour: 'ink', weight: 'thin', fill: 'none' },
  };
}

function makeDot(id: string, createdBy: string, x: number, y: number): StrokeObject {
  return {
    id,
    kind: 'stroke',
    rank: `1:${id}`,
    version: 1,
    createdBy,
    x,
    y,
    w: 2,
    h: 2,
    points: [{ x: 0, y: 0, pressure: 0.5 }],
    style: { colour: 'ink', weight: 'thin' },
    preset: 'pen',
  };
}

describe('spatial region clustering', () => {
  it('clusters a hundred pasted copies in one place into a single dense region', () => {
    const objects: BoardObject[] = [];
    for (let i = 0; i < 100; i++) {
      objects.push(makeRect(`r-${i}`, 'alice', 100 + (i % 10) * 16, 100 + Math.floor(i / 10) * 16, 120, 80));
    }
    const summary = clusterAuthorRegions('alice', objects);
    expect(summary.objectCount).toBe(100);
    expect(summary.regions).toHaveLength(1);
    expect(summary.scatteredRegions).toHaveLength(0);
    expect(summary.regions[0].objectCount).toBe(100);
    expect(summary.regions[0].bounds).toEqual({
      x: 100,
      y: 100,
      w: 9 * 16 + 120,
      h: 9 * 16 + 80,
    });
  });

  it('separates two far clusters and sorts regions by object count descending', () => {
    const near = [
      makeRect('n1', 'alice', 0, 0, 300, 300),
      makeRect('n2', 'alice', 400, 100, 300, 300),
    ];
    const far = [
      makeRect('f1', 'alice', 20_000, 20_000, 300, 300),
      makeRect('f2', 'alice', 20_500, 20_200, 300, 300),
      makeRect('f3', 'alice', 21_000, 20_400, 300, 300),
      makeRect('f4', 'alice', 21_200, 20_600, 300, 300),
    ];
    const summary = clusterAuthorRegions('alice', [...near, ...far]);
    expect(summary.regions).toHaveLength(2);
    expect(summary.regions[0].objectCount).toBe(4);
    expect(summary.regions[0].bounds.x).toBe(20_000);
    expect(summary.regions[1].objectCount).toBe(2);
    expect(summary.regions[1].bounds.x).toBe(0);
  });

  it('merges 8-neighbour connected grid cells into one region', () => {
    const first = makeRect('c1', 'alice', 100, 100, 250, 250);
    const diagonalNeighbour = makeRect('c2', 'alice', REGION_CELL_SIZE + 100, REGION_CELL_SIZE + 100, 250, 250);
    const summary = clusterAuthorRegions('alice', [first, diagonalNeighbour]);
    expect(summary.regions).toHaveLength(1);
    expect(summary.regions[0].objectCount).toBe(2);
  });

  it('collapses scattered small marks (<= 3 objects and < 200x200) separately from normal regions', () => {
    const mainCluster = [
      makeRect('m1', 'alice', 0, 0, 300, 250),
      makeRect('m2', 'alice', 200, 100, 300, 250),
    ];
    const scatteredDots = [
      makeDot('d1', 'alice', 10_000, 10_000),
      makeDot('d2', 'alice', -20_000, 15_000),
      makeDot('d3', 'alice', 50_000, -30_000),
      makeDot('d4', 'alice', 50_020, -30_010), // shares cell with d3 -> 2 objects, 22x12 box -> still scattered
    ];
    const summary = clusterAuthorRegions('alice', [...mainCluster, ...scatteredDots]);
    expect(summary.objectCount).toBe(6);
    expect(summary.regions).toHaveLength(1);
    expect(summary.regions[0].objectCount).toBe(2);
    expect(summary.scatteredRegions).toHaveLength(3);
    expect(summary.scatteredObjectCount).toBe(4);
  });

  it.each([4, 40, 2000])('connects both ends of an object spanning %i cells without truncation', cells => {
    const span = REGION_CELL_SIZE * cells;
    const objects = [
      makeRect('left', 'alice', -100, -100),
      makeRect('right', 'alice', span, span),
      makeRect('bridge', 'alice', 0, 0, span, span),
      makeRect('separate', 'alice', span + 10_000, span + 10_000),
    ];
    const summary = clusterAuthorRegions('alice', objects);
    expect(summary.allRegions).toHaveLength(2);
    expect(summary.regions[0].objectCount).toBe(3);
    expect(new Set(summary.regions[0].objectIds)).toEqual(new Set(['left', 'right', 'bridge']));
    expect(summary.regions.reduce((n, r) => n + r.objectCount, 0)).toBe(objects.length);
  });

  it('keeps a pasted block, a dense dot block and sprinkled dots apart (browser regression)', () => {
    const objects: BoardObject[] = [];
    for (let i = 0; i < 100; i++) {
      objects.push(makeRect(`copy-${i}`, 'guest', 4000 + (i % 10) * 30, 500 + Math.floor(i / 10) * 30, 60, 40));
    }
    for (let i = 0; i < 1387; i++) {
      objects.push(makeDot(`dense-${i}`, 'guest', 4000 + (i % 40) * 12, 2000 + Math.floor(i / 40) * 12));
    }
    for (let i = 0; i < 12; i++) {
      objects.push(makeDot(`loose-${i}`, 'guest', 1500 + i * 520, -1500 - (i % 4) * 700));
    }
    const summary = clusterAuthorRegions('guest', objects);
    expect(summary.regions.map(r => r.objectCount)).toEqual([1387, 100]);
    expect(summary.scatteredObjectCount).toBe(12);
    expect(summary.scatteredRegions.every(r => r.objectCount <= 3)).toBe(true);
  });

  it('treats a dashed line made of many dots as one drawing', () => {
    const dots = Array.from({ length: 40 }, (_, i) => makeDot(`dash-${i}`, 'alice', i * 30, 0));
    const summary = clusterAuthorRegions('alice', dots);
    expect(summary.regions).toHaveLength(1);
    expect(summary.regions[0].objectCount).toBe(40);
    expect(summary.scatteredRegions).toHaveLength(0);
  });

  it('merges drawings 600 apart but not drawings 2000 apart', () => {
    const close = clusterAuthorRegions('alice', [makeRect('a', 'alice', 0, 0), makeRect('b', 'alice', 840, 0)]);
    expect(close.regions).toHaveLength(1);
    const apart = clusterAuthorRegions('alice', [makeRect('a', 'alice', 0, 0), makeRect('b', 'alice', 2240, 0)]);
    expect(apart.regions).toHaveLength(2);
  });

  it('attaches a speck beside a drawing to it, but never lets specks bridge two drawings', () => {
    const left = makeRect('left', 'alice', 0, 0);
    const right = makeRect('right', 'alice', 3000, 0);
    const beside = makeDot('beside', 'alice', 600, 100);
    const bridge = [makeDot('s1', 'alice', 1200, 100), makeDot('s2', 'alice', 1700, 100), makeDot('s3', 'alice', 2200, 100)];
    const summary = clusterAuthorRegions('alice', [left, right, beside, ...bridge]);
    expect(summary.regions).toHaveLength(2);
    const leftRegion = summary.regions.find(r => r.objectIds.includes('left'));
    expect(leftRegion?.objectIds).toContain('beside');
    expect(leftRegion?.objectIds).not.toContain('right');
    expect(summary.scatteredObjectCount).toBe(3);
  });

  it('stays fast with a giant frame and a full board', () => {
    const objects: BoardObject[] = [makeRect('frame', 'alice', -50_000, -50_000, 100_000, 100_000)];
    for (let i = 0; i < 4999; i++) objects.push(makeDot(`d-${i}`, 'alice', (i % 70) * 900, Math.floor(i / 70) * 900));
    const started = performance.now();
    const summary = clusterAuthorRegions('alice', objects);
    expect(performance.now() - started).toBeLessThan(500);
    expect(summary.objectCount).toBe(5000);
  });

  it('groups and sorts mixed authors by total object count descending and memoises off the store', () => {
    const objects: BoardObject[] = [
      makeRect('a1', 'alice', 0, 0),
      makeRect('b1', 'bob', 0, 0),
      makeRect('b2', 'bob', 300, 0),
      makeRect('b3', 'bob', 600, 0),
      makeDot('c1', 'carol', 8_000, 8_000),
      makeRect('c2', 'carol', 0, 5_000),
    ];
    const store = createBoardStore({ boardId: 'b1', userId: 'alice' });
    store.hydrate({ seq: 1, objects });

    const first = getAuthorRegions(store);
    const second = computeAuthorRegions(store.getObjectsInRank());
    expect(second).toBe(first);
    expect(first.map(a => ({ id: a.authorId, count: a.objectCount }))).toEqual([
      { id: 'bob', count: 3 },
      { id: 'carol', count: 2 },
      { id: 'alice', count: 1 },
    ]);
    expect(first[1].regions).toHaveLength(1);
    expect(first[1].scatteredRegions).toHaveLength(1);
  });
});
