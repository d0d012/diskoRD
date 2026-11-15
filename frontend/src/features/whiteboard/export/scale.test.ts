import { describe, expect, it } from 'vitest';
import { EXPORT_MAX_SIDE, EXPORT_PADDING, EXPORT_SCALE, planExport } from './scale';

describe('planExport', () => {
  it('pads by 32 world units and rasterizes at 2x by default', () => {
    const plan = planExport({ x: 0, y: 0, w: 100, h: 50 });
    expect(plan.originX).toBe(-EXPORT_PADDING);
    expect(plan.originY).toBe(-EXPORT_PADDING);
    expect(plan.width).toBe(100 + EXPORT_PADDING * 2);
    expect(plan.height).toBe(50 + EXPORT_PADDING * 2);
    expect(plan.scale).toBe(EXPORT_SCALE);
    expect(plan.pixelWidth).toBe(plan.width * EXPORT_SCALE);
    expect(plan.pixelHeight).toBe(plan.height * EXPORT_SCALE);
  });

  it('caps the long side at 8192px by reducing the scale', () => {
    const plan = planExport({ x: 0, y: 0, w: 10000, h: 5000 });
    expect(plan.scale).toBeLessThan(EXPORT_SCALE);
    expect(Math.max(plan.pixelWidth, plan.pixelHeight)).toBe(EXPORT_MAX_SIDE);
    expect(plan.pixelWidth).toBe(EXPORT_MAX_SIDE);
  });

  it('honours custom padding, scale and cap', () => {
    const plan = planExport({ x: 10, y: 20, w: 8, h: 4 }, { padding: 0, scale: 4, maxSide: 40 });
    expect(plan.originX).toBe(10);
    expect(plan.originY).toBe(20);
    expect(plan.width).toBe(8);
    expect(plan.height).toBe(4);
    expect(plan.scale).toBe(4);
    expect(plan.pixelWidth).toBe(32);
    expect(plan.pixelHeight).toBe(16);
  });

  it('never emits zero-size output for a degenerate (zero-extent) bounds', () => {
    const plan = planExport({ x: 5, y: 5, w: 0, h: 0 });
    expect(plan.width).toBeGreaterThanOrEqual(1);
    expect(plan.height).toBeGreaterThanOrEqual(1);
    expect(plan.pixelWidth).toBeGreaterThanOrEqual(1);
    expect(plan.pixelHeight).toBeGreaterThanOrEqual(1);
  });
});
