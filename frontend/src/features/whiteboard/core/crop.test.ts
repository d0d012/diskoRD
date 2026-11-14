import { describe, expect, it } from 'vitest';
import {
  clampCrop, cropFromSourceRect, displayedSourceRect, resizeCrop, sourcePixelRect,
} from './crop';

describe('clampCrop', () => {
  it('passes a valid crop through', () => {
    expect(clampCrop({ x: 0.2, y: 0.2, w: 0.5, h: 0.5 })).toEqual({ x: 0.2, y: 0.2, w: 0.5, h: 0.5 });
  });

  it('clamps overflowing edges into [0,1]', () => {
    const out = clampCrop({ x: 0.9, y: 0.9, w: 0.5, h: 0.5 });
    expect(out.x).toBe(0.9);
    expect(out.y).toBe(0.9);
    expect(out.w).toBeCloseTo(0.1, 10);
    expect(out.h).toBeCloseTo(0.1, 10);
    expect(clampCrop({ x: -0.5, y: -0.5, w: 2, h: 2 })).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it('enforces the minimum crop size', () => {
    expect(clampCrop({ x: 0.5, y: 0.5, w: 0.001, h: 0.001 })).toEqual({ x: 0.5, y: 0.5, w: 0.01, h: 0.01 });
  });

  it('accepts a custom minimum size', () => {
    expect(clampCrop({ x: 0.5, y: 0.5, w: 0.1, h: 0.1 }, 0.25)).toEqual({ x: 0.5, y: 0.5, w: 0.25, h: 0.25 });
  });
});

describe('displayedSourceRect / cropFromSourceRect', () => {
  const size = { w: 200, h: 100 };
  const source = { width: 1000, height: 500 };

  it('maps the full crop to the object bounds', () => {
    expect(displayedSourceRect({ x: 0, y: 0, w: 1, h: 1 }, size, source)).toEqual({ x: 0, y: 0, w: 200, h: 100 });
  });

  it('offsets the source rect for a partial crop', () => {
    expect(displayedSourceRect({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, size, source)).toEqual({ x: -100, y: -50, w: 400, h: 200 });
  });

  it('round-trips through the inverse', () => {
    const displayed = displayedSourceRect({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, size, source);
    expect(cropFromSourceRect(displayed, size)).toEqual({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 });
  });
});

describe('sourcePixelRect', () => {
  it('converts a normalized crop to source pixels', () => {
    expect(sourcePixelRect({ x: 0.25, y: 0.5, w: 0.5, h: 0.25 }, { width: 800, height: 600 }))
      .toEqual({ x: 200, y: 300, w: 400, h: 150 });
  });
});

describe('resizeCrop', () => {
  const size = { w: 200, h: 100 };

  it('moves the east boundary', () => {
    expect(resizeCrop({ x: 0, y: 0, w: 1, h: 1 }, 'e', { x: 150, y: 0 }, size)).toEqual({ x: 0, y: 0, w: 0.75, h: 1 });
  });

  it('never flips when the west boundary is dragged past the east', () => {
    expect(resizeCrop({ x: 0, y: 0, w: 1, h: 1 }, 'w', { x: 150, y: 0 }, size)).toEqual({ x: 0.75, y: 0, w: 0.25, h: 1 });
    expect(resizeCrop({ x: 0, y: 0, w: 1, h: 1 }, 'w', { x: -100, y: 0 }, size)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it('leaves the crop unchanged when the corner is at its current boundary', () => {
    expect(resizeCrop({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, 'se', { x: 200, y: 100 }, size))
      .toEqual({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 });
  });

  it('enforces the minimum crop size on an inward drag', () => {
    const out = resizeCrop({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 }, 'e', { x: 0, y: 0 }, size);
    expect(out.x).toBe(0.5);
    expect(out.y).toBe(0.5);
    expect(out.w).toBeCloseTo(0.01, 10);
    expect(out.h).toBe(0.5);
  });
});
