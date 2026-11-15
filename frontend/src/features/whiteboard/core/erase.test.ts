import { describe, expect, it } from 'vitest';
import type { StrokePoint } from '../contract';
import { erasePolyline, eraserTouches, pathLength } from './erase';

function line(...xy: [number, number][]): StrokePoint[] {
  return xy.map(([x, y]) => ({ x, y, pressure: 0.5 }));
}

describe('erasePolyline', () => {
  it('returns the same array when the eraser does not touch the stroke', () => {
    const points = line([0, 0], [100, 0]);
    const runs = erasePolyline(points, { x: 50, y: 40 }, { x: 60, y: 40 }, 10);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toBe(points);
  });

  it('cuts a two-point straight line in the middle instead of removing it whole', () => {
    const runs = erasePolyline(line([0, 0], [100, 0]), { x: 50, y: -20 }, { x: 50, y: 20 }, 10);
    expect(runs).toHaveLength(2);
    const [left, right] = runs;
    expect(left[0]).toMatchObject({ x: 0, y: 0 });
    expect(left[left.length - 1].x).toBeLessThan(41);
    expect(left[left.length - 1].x).toBeGreaterThan(30);
    expect(right[0].x).toBeGreaterThan(59);
    expect(right[0].x).toBeLessThan(70);
    expect(right[right.length - 1]).toMatchObject({ x: 100, y: 0 });
  });

  it('trims an end and keeps the rest as one run', () => {
    const runs = erasePolyline(line([0, 0], [100, 0]), { x: 0, y: 0 }, { x: 0, y: 0 }, 10);
    expect(runs).toHaveLength(1);
    expect(runs[0][0].x).toBeGreaterThan(10);
    expect(runs[0][runs[0].length - 1].x).toBe(100);
  });

  it('removes a stroke that lies entirely inside the eraser', () => {
    expect(erasePolyline(line([0, 0], [5, 0], [10, 0]), { x: -20, y: 0 }, { x: 30, y: 0 }, 10)).toEqual([]);
  });

  it('erases a single dot only when it is within reach', () => {
    const dot = line([0, 0]);
    expect(erasePolyline(dot, { x: 5, y: 0 }, { x: 5, y: 0 }, 10)).toEqual([]);
    expect(erasePolyline(dot, { x: 50, y: 0 }, { x: 50, y: 0 }, 10)[0]).toBe(dot);
  });

  it('drops leftover specks shorter than minLength', () => {
    // The eraser leaves a 4-unit stub at the start of the line.
    const points = line([0, 0], [100, 0]);
    const kept = erasePolyline(points, { x: 14, y: 0 }, { x: 14, y: 0 }, 10, 0);
    expect(kept.length).toBe(2);
    const cleaned = erasePolyline(points, { x: 14, y: 0 }, { x: 14, y: 0 }, 10, 10);
    expect(cleaned.length).toBe(1);
    expect(cleaned[0][0].x).toBeGreaterThan(20);
  });

  it('interpolates pressure at the cut', () => {
    const points: StrokePoint[] = [{ x: 0, y: 0, pressure: 0 }, { x: 100, y: 0, pressure: 1 }];
    const [left] = erasePolyline(points, { x: 50, y: 0 }, { x: 50, y: 0 }, 10);
    const cut = left[left.length - 1];
    expect(cut.pressure).toBeCloseTo(cut.x / 100, 5);
  });

  it('sweeping along the whole stroke erases all of it', () => {
    const zigzag = line([0, 0], [50, 30], [100, 0], [150, 30], [200, 0]);
    expect(erasePolyline(zigzag, { x: -10, y: 15 }, { x: 210, y: 15 }, 30)).toEqual([]);
  });

  it('eraserTouches and pathLength agree with geometry', () => {
    expect(eraserTouches(line([0, 0], [100, 0]), { x: 50, y: 9 }, { x: 50, y: 9 }, 10)).toBe(true);
    expect(eraserTouches(line([0, 0], [100, 0]), { x: 50, y: 11 }, { x: 50, y: 11 }, 10)).toBe(false);
    expect(pathLength(line([0, 0], [3, 4], [3, 14]))).toBe(15);
  });
});
