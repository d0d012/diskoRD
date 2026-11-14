import { describe, expect, it } from 'vitest';
import type {
  ImageObject, LineObject, RectObject, StrokeObject, TextObject,
} from '../contract/types';
import {
  resizeBox, resizeImage, resizeLine, resizeObject, resizeStroke, resizeText,
} from './resize';

function rectObject(id: string, x: number, y: number, w: number, h: number): RectObject {
  return { id, kind: 'rect', rank: `1:${id}`, version: 1, createdBy: 'u1', x, y, w, h, style: { colour: 'ink', weight: 'thin', fill: 'none' } };
}

function strokeObject(x: number, y: number, w: number, h: number, points: Array<[number, number]>): StrokeObject {
  return {
    id: 's1', kind: 'stroke', rank: '1:s1', version: 1, createdBy: 'u1',
    x, y, w, h,
    points: points.map(([px, py]) => ({ x: px, y: py, pressure: 0.5 })),
    preset: 'pen', style: { colour: 'ink', weight: 'thin' },
  };
}

function lineObject(): LineObject {
  return { id: 'l1', kind: 'line', rank: '1:l1', version: 1, createdBy: 'u1', x: 0, y: 0, w: 100, h: 0, start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, style: { colour: 'ink', weight: 'thin' } };
}

function textObject(size: 'S' | 'M' | 'L' | 'XL' = 'M'): TextObject {
  return { id: 't1', kind: 'text', rank: '1:t1', version: 1, createdBy: 'u1', x: 0, y: 0, w: 240, h: 24, text: 'hi', style: { colour: 'ink', size, font: 'app', bold: false, italic: false, align: 'left' } };
}

function imageObject(): ImageObject {
  return { id: 'i1', kind: 'image', rank: '1:i1', version: 1, createdBy: 'u1', x: 0, y: 0, w: 200, h: 100, assetId: 'asset', url: 'u', width: 1000, height: 500, crop: { x: 0, y: 0, w: 1, h: 1 }, pixelated: false };
}

describe('resizeBox', () => {
  it('grows a box from the SE handle', () => {
    expect(resizeBox({ x: 0, y: 0, w: 100, h: 50 }, 'se', { x: 150, y: 100 }, { minWidth: 1, minHeight: 1, keepAspect: false }))
      .toEqual({ x: 0, y: 0, w: 150, h: 100 });
  });

  it('moves the opposite edge from the NW handle', () => {
    expect(resizeBox({ x: 100, y: 100, w: 100, h: 50 }, 'nw', { x: 50, y: 80 }, { minWidth: 1, minHeight: 1, keepAspect: false }))
      .toEqual({ x: 50, y: 80, w: 150, h: 70 });
  });

  it('never flips when dragged past the opposite edge', () => {
    expect(resizeBox({ x: 0, y: 0, w: 100, h: 50 }, 'nw', { x: 500, y: 500 }, { minWidth: 1, minHeight: 1, keepAspect: false }))
      .toEqual({ x: 99, y: 49, w: 1, h: 1 });
    expect(resizeBox({ x: 0, y: 0, w: 100, h: 50 }, 'e', { x: -20, y: 0 }, { minWidth: 1, minHeight: 1, keepAspect: false }))
      .toEqual({ x: 0, y: 0, w: 1, h: 50 });
  });

  it('enforces the minimum size on shrink', () => {
    expect(resizeBox({ x: 0, y: 0, w: 100, h: 50 }, 'e', { x: 5, y: 0 }, { minWidth: 1, minHeight: 1, keepAspect: false }))
      .toEqual({ x: 0, y: 0, w: 5, h: 50 });
  });

  it('keeps aspect on a corner drag (dominant axis wins)', () => {
    expect(resizeBox({ x: 0, y: 0, w: 200, h: 100 }, 'se', { x: 400, y: 150 }, { minWidth: 1, minHeight: 1, keepAspect: true }))
      .toEqual({ x: 0, y: 0, w: 400, h: 200 });
  });

  it('keeps aspect on an edge drag, growing symmetrically about the other axis', () => {
    expect(resizeBox({ x: 0, y: 0, w: 200, h: 100 }, 'e', { x: 400, y: 0 }, { minWidth: 1, minHeight: 1, keepAspect: true }))
      .toEqual({ x: 0, y: -50, w: 400, h: 200 });
  });

  it('keeps aspect while respecting the minimum size', () => {
    expect(resizeBox({ x: 0, y: 0, w: 200, h: 100 }, 'se', { x: 1, y: 1 }, { minWidth: 1, minHeight: 1, keepAspect: true }))
      .toEqual({ x: 0, y: 0, w: 2, h: 1 });
  });
});

describe('resizeStroke', () => {
  it('scales points and bounds together', () => {
    const { bounds, points } = resizeStroke(strokeObject(0, 0, 10, 10, [[0, 0], [10, 10]]), 'se', { x: 20, y: 20 });
    expect(bounds).toEqual({ x: 0, y: 0, w: 20, h: 20 });
    expect(points).toEqual([{ x: 0, y: 0, pressure: 0.5 }, { x: 20, y: 20, pressure: 0.5 }]);
  });

  it('keeps a zero axis at zero', () => {
    const stroke = strokeObject(0, 0, 0, 10, [[0, 0], [0, 10]]);
    const { bounds, points } = resizeStroke(stroke, 'e', { x: 30, y: 0 });
    expect(bounds).toEqual({ x: 0, y: 0, w: 0, h: 10 });
    expect(points).toEqual([{ x: 0, y: 0, pressure: 0.5 }, { x: 0, y: 10, pressure: 0.5 }]);
  });
});

describe('resizeLine', () => {
  it('moves the end endpoint and re-tightens bounds', () => {
    const { bounds, start, end } = resizeLine(lineObject(), 'end', { x: 100, y: 100 }, false);
    expect(bounds).toEqual({ x: 0, y: 0, w: 100, h: 100 });
    expect(start).toEqual({ x: 0, y: 0 });
    expect(end).toEqual({ x: 100, y: 100 });
  });

  it('moves the start endpoint and preserves direction', () => {
    const line: LineObject = { ...lineObject(), x: 0, y: 0, w: 100, h: 100, start: { x: 0, y: 0 }, end: { x: 100, y: 100 } };
    const { bounds, start, end } = resizeLine(line, 'start', { x: 50, y: 0 }, false);
    expect(bounds).toEqual({ x: 50, y: 0, w: 50, h: 100 });
    expect(start).toEqual({ x: 0, y: 0 });
    expect(end).toEqual({ x: 50, y: 100 });
  });

  it('snaps the angle to 15 degrees', () => {
    const { end } = resizeLine(lineObject(), 'end', { x: 100, y: 50 }, true);
    // 26.565deg -> 30deg at the same length (sqrt(12500) ~ 111.8034).
    expect(end.x).toBeCloseTo(96.8246, 4);
    expect(end.y).toBeCloseTo(55.9017, 4);
  });
});

describe('resizeText', () => {
  it('reflows width on east/west handles without changing size', () => {
    const east = resizeText(textObject(), 'e', { x: 300, y: 0 }, { minWidth: 1 });
    expect(east).toEqual({ bounds: { x: 0, y: 0, w: 300, h: 24 }, size: 'M' });

    const west = resizeText(textObject(), 'w', { x: 10, y: 0 }, { minWidth: 1 });
    expect(west).toEqual({ bounds: { x: 10, y: 0, w: 230, h: 24 }, size: 'M' });
  });

  it('steps the size from a corner drag', () => {
    // Drag the SE corner to double the diagonal -> target font 48 -> XL.
    const { bounds, size } = resizeText(textObject('M'), 'se', { x: 480, y: 48 }, { minWidth: 1 });
    expect(size).toBe('XL');
    expect(bounds.x).toBe(0);
    expect(bounds.y).toBe(0);
    expect(bounds.w).toBeCloseTo(240 * (48 / 24), 5);
    expect(bounds.h).toBeCloseTo(24 * (48 / 24), 5);
  });

  it('clamps a corner drag inward at size S', () => {
    const { bounds, size } = resizeText(textObject('M'), 'se', { x: 0, y: 0 }, { minWidth: 1 });
    expect(size).toBe('S');
    expect(bounds.w).toBeCloseTo(240 * (16 / 24), 5);
    expect(bounds.h).toBeCloseTo(24 * (16 / 24), 5);
  });
});

describe('resizeImage', () => {
  it('keeps the cropped source aspect ratio', () => {
    expect(resizeImage(imageObject(), 'se', { x: 400, y: 300 }, { minSize: 1 }))
      .toEqual({ x: 0, y: 0, w: 600, h: 300 });
  });

  it('uses the source crop ratio, not the current visible bounds', () => {
    const reCropped: ImageObject = {
      ...imageObject(), w: 200, h: 200, width: 1000, height: 1000, crop: { x: 0, y: 0, w: 0.5, h: 1 },
    };
    // source aspect (1000*0.5)/(1000*1) = 0.5 -> portrait 1:2.
    expect(resizeImage(reCropped, 'se', { x: 300, y: 300 }, { minSize: 1 }))
      .toEqual({ x: 0, y: 0, w: 300, h: 600 });
  });
});

describe('resizeObject dispatch', () => {
  const options = { minSize: 1, keepAspect: false, snap: false };

  it('resizes a rect via box result', () => {
    const result = resizeObject(rectObject('r', 0, 0, 100, 50), 'se', { x: 150, y: 100 }, options);
    expect(result).toEqual({ kind: 'box', bounds: { x: 0, y: 0, w: 150, h: 100 } });
  });

  it('resizes a stroke via stroke result', () => {
    const result = resizeObject(strokeObject(0, 0, 10, 10, [[0, 0], [10, 10]]), 'se', { x: 20, y: 20 }, options);
    expect(result.kind).toBe('stroke');
  });

  it('moves a line endpoint', () => {
    const result = resizeObject(lineObject(), 'end', { x: 100, y: 100 }, { ...options, snap: true });
    expect(result.kind).toBe('line');
  });

  it('rejects invalid handle/kind combinations', () => {
    const sticky = { id: 'st1', kind: 'sticky' as const, rank: '1:st1', version: 1, createdBy: 'u1', x: 0, y: 0, w: 200, h: 200, text: 'x', style: { tone: 'yellow' as const, font: 'handwriting' as const } };
    expect(() => resizeObject(lineObject(), 'nw', { x: 0, y: 0 }, options)).toThrow();
    expect(() => resizeObject(imageObject(), 'e', { x: 0, y: 0 }, options)).toThrow();
    expect(() => resizeObject(textObject(), 'n', { x: 0, y: 0 }, options)).toThrow();
    expect(() => resizeObject(sticky, 'se', { x: 0, y: 0 }, options)).toThrow();
  });
});
