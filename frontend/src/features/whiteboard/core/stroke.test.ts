import { describe, expect, it } from 'vitest';
import type { StrokeObject, StrokePoint } from '../contract/types';
import { enforceStrokeLimits, normalizePoints, pointsByteLength, simplifyPoints } from './stroke';

function pt(x: number, y: number, pressure = 0.5): StrokePoint {
  return { x, y, pressure };
}

function makeStroke(points: StrokePoint[], extra: Partial<StrokeObject> = {}): StrokeObject {
  const normalized = normalizePoints(points);
  return {
    id: 's1', kind: 'stroke', rank: '1:s1', version: 1, createdBy: 'u1',
    x: normalized.bounds.x, y: normalized.bounds.y, w: normalized.bounds.w, h: normalized.bounds.h,
    points: normalized.points, preset: 'pen', style: { colour: 'ink', weight: 'thin' },
    ...extra,
  };
}

describe('simplifyPoints', () => {
  it('collapses collinear points to the endpoints', () => {
    const simplified = simplifyPoints([pt(0, 0), pt(1, 0), pt(2, 0), pt(3, 0)], 0.5);
    expect(simplified).toEqual([pt(0, 0), pt(3, 0)]);
  });

  it('keeps a spike beyond the tolerance', () => {
    const simplified = simplifyPoints([pt(0, 0), pt(1, 10), pt(2, 0)], 0.5);
    expect(simplified).toHaveLength(3);
  });

  it('handles empty and short inputs', () => {
    expect(simplifyPoints([], 1)).toEqual([]);
    expect(simplifyPoints([pt(1, 2)], 1)).toEqual([pt(1, 2)]);
    expect(simplifyPoints([pt(1, 2), pt(3, 4)], 1)).toEqual([pt(1, 2), pt(3, 4)]);
  });

  it('preserves order, endpoints and pressures', () => {
    const simplified = simplifyPoints([pt(0, 0, 0.2), pt(5, 5, 0.9), pt(10, 0, 0.5)], 0.5);
    expect(simplified[0]).toEqual(pt(0, 0, 0.2));
    expect(simplified[simplified.length - 1]).toEqual(pt(10, 0, 0.5));
    expect(simplified).toContainEqual(pt(5, 5, 0.9));
  });
});

describe('normalizePoints', () => {
  it('rebases to local coordinates and returns tight bounds', () => {
    const { points, bounds } = normalizePoints([pt(10, 20), pt(30, 40)]);
    expect(bounds).toEqual({ x: 10, y: 20, w: 20, h: 20 });
    expect(points).toEqual([pt(0, 0), pt(20, 20)]);
  });

  it('handles a single point and empty input', () => {
    expect(normalizePoints([pt(5, 5)])).toEqual({ points: [pt(0, 0)], bounds: { x: 5, y: 5, w: 0, h: 0 } });
    expect(normalizePoints([])).toEqual({ points: [], bounds: { x: 0, y: 0, w: 0, h: 0 } });
  });

  it('clamps pressure into [0,1] with 0.5 for non-finite', () => {
    const { points } = normalizePoints([pt(0, 0, -1), pt(10, 0, 2), pt(20, 0, Number.NaN), pt(30, 0, 0.7)]);
    expect(points.map((p) => p.pressure)).toEqual([0, 1, 0.5, 0.7]);
  });
});

describe('pointsByteLength', () => {
  it('measures the serialized JSON bytes', () => {
    expect(pointsByteLength([pt(0, 0)])).toBe(JSON.stringify([{ x: 0, y: 0, pressure: 0.5 }]).length);
    expect(pointsByteLength([])).toBe(2); // "[]"
  });
});

describe('enforceStrokeLimits', () => {
  it('caps the point count by raising the tolerance', () => {
    const zigzag = Array.from({ length: 100 }, (_, i) => pt(i, i % 2 === 0 ? 0 : 10));
    const result = enforceStrokeLimits(makeStroke(zigzag), { maxPoints: 8, tolerance: 0 });
    expect(result.points.length).toBeLessThanOrEqual(8);
    expect(result.points.length).toBeGreaterThanOrEqual(2);
  });

  it('caps the serialized body bytes by raising the tolerance', () => {
    const dense = Array.from({ length: 60 }, (_, i) => pt(12345.678901 + i, 98765.432109 - i));
    const result = enforceStrokeLimits(makeStroke(dense), { maxBytes: 300, tolerance: 0 });
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(300);
  });

  it('re-tightens bounds after simplification', () => {
    const stroke = makeStroke([pt(50, 0), pt(0, 50), pt(100, 50), pt(50, 100)]);
    const result = enforceStrokeLimits(stroke, { maxPoints: 2 });
    expect(result.points).toHaveLength(2);
    expect(result).toMatchObject({ x: 50, y: 0, w: 0, h:100 });
    expect(result.points).toEqual([pt(0, 0), pt(0, 100)]);
  });

  it('preserves a nonzero world origin while re-tightening local samples', () => {
    const stroke = makeStroke([pt(50, 200), pt(60, 210), pt(70, 220)]);
    const result = enforceStrokeLimits(stroke);
    expect(result).toMatchObject({ x: 50, y: 200, w: 20, h: 20 });
    expect(result.points).toEqual([pt(0, 0), pt(20, 20)]);
  });

  it('leaves an under-limit stroke untouched', () => {
    const stroke = makeStroke([pt(0, 0), pt(10, 0), pt(10, 10)]);
    const result = enforceStrokeLimits(stroke);
    expect(result.points).toHaveLength(3);
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
  });
});
