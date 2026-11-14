import { describe, expect, it } from 'vitest';
import type {
  BoardObject, FrameObject, RectObject, StrokeObject, StrokeStyle, TextObject,
} from '../contract/types';
import {
  frameLabelBounds, getBounds, hitTestMarquee, hitTestPoint, rectContains,
  rectContainsRect, rectsIntersect, topmostObjectAtPoint, unionBounds,
} from './geometry';

const thin: StrokeStyle = { colour: 'ink', weight: 'thin' };
const thick: StrokeStyle = { colour: 'ink', weight: 'thick' };

function rectObject(id: string, x: number, y: number, w: number, h: number, style: StrokeStyle = thin): RectObject {
  return { id, kind: 'rect', rank: `1:${id}`, version: 1, createdBy: 'u1', x, y, w, h, style: { ...style, fill: 'none' } };
}

function strokeObject(points: Array<[number, number]>): StrokeObject {
  return {
    id: 's1', kind: 'stroke', rank: '1:s1', version: 1, createdBy: 'u1',
    x: 0, y: 0, w: 0, h: 0,
    points: points.map(([x, y]) => ({ x, y, pressure: 0.5 })),
    preset: 'pen', style: thin,
  };
}

function frameObject(id: string, x: number, y: number, w: number, h: number, label: string): FrameObject {
  return { id, kind: 'frame', rank: `0:${id}`, version: 1, createdBy: 'u1', x, y, w, h, label, style: thin };
}

describe('getBounds', () => {
  it('expands rect/ellipse by half the stroke width', () => {
    expect(getBounds(rectObject('r', 10, 20, 100, 50))).toEqual({ x: 9, y: 19, w: 102, h: 52 });
    expect(getBounds(rectObject('r', 10, 20, 100, 50, thick))).toEqual({ x: 8, y: 18, w: 104, h: 54 });
    expect(getBounds({ ...rectObject('e', 0, 0, 100, 50), kind: 'ellipse' })).toEqual({ x: -1, y: -1, w: 102, h: 52 });
  });

  it('computes stroke bounds from points plus width', () => {
    const stroke: StrokeObject = {
      ...strokeObject([[0, 0], [10, 0], [10, 10]]),
      x: 5, y: 5, w: 10, h: 10,
    };
    expect(getBounds(stroke)).toEqual({ x: 4, y: 4, w: 12, h: 12 });
    expect(getBounds({ ...stroke, preset: 'marker' })).toEqual({ x: 2, y: 2, w: 16, h: 16 });
  });

  it('computes line/arrow bounds from endpoints', () => {
    const line = { id: 'l1', kind: 'line' as const, rank: '1:l1', version: 1, createdBy: 'u1', x: 0, y: 0, w: 100, h: 0, start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, style: thin };
    expect(getBounds(line)).toEqual({ x: -1, y: -1, w: 102, h: 2 });
  });

  it('includes the frame label chip', () => {
    expect(getBounds(frameObject('f', 0, 0, 640, 400, 'Frame'))).toEqual({ x: -1, y: -24, w: 642, h: 425 });
  });

  it('returns raw bounds for text/sticky/image', () => {
    const text: TextObject = { id: 't1', kind: 'text', rank: '1:t1', version: 1, createdBy: 'u1', x: 1, y: 2, w: 240, h: 24, text: 'hi', style: { colour: 'ink', size: 'M', font: 'app', bold: false, italic: false, align: 'left' } };
    expect(getBounds(text)).toEqual({ x: 1, y: 2, w: 240, h: 24 });
  });
});

describe('frameLabelBounds', () => {
  it('is deterministic and sits outside the top-left edge', () => {
    // 5 chars * 7.7 = 38.5 + 20 padding = 58.5 width.
    const label = frameLabelBounds(frameObject('f', 0, 0, 640, 400, 'Frame'));
    expect(label.x).toBe(0);
    expect(label.y).toBe(-24);
    expect(label.w).toBeCloseTo(58.5, 10);
    expect(label.h).toBe(24);
  });
});

describe('unionBounds', () => {
  it('unions rectangles', () => {
    expect(unionBounds([{ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 }])).toEqual({ x: 0, y: 0, w: 15, h: 15 });
  });

  it('returns the zero rect for empty input', () => {
    expect(unionBounds([])).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });
});

describe('rectsIntersect', () => {
  it('detects overlap', () => {
    expect(rectsIntersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })).toBe(true);
  });

  it('treats touching edges as intersecting (closed)', () => {
    expect(rectsIntersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 })).toBe(true);
  });

  it('rejects disjoint rects', () => {
    expect(rectsIntersect({ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 20, w: 10, h: 10 })).toBe(false);
  });

  it('handles zero-extent rects', () => {
    expect(rectsIntersect({ x: 5, y: 5, w: 0, h: 0 }, { x: 0, y: 0, w: 10, h: 10 })).toBe(true);
  });
});

describe('rectContains / rectContainsRect', () => {
  it('contains points inclusively', () => {
    expect(rectContains({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5 })).toBe(true);
    expect(rectContains({ x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 0 })).toBe(true);
    expect(rectContains({ x: 0, y: 0, w: 10, h: 10 }, { x: 11, y: 5 })).toBe(false);
  });

  it('contains rects inclusively', () => {
    expect(rectContainsRect({ x: 0, y: 0, w: 10, h: 10 }, { x: 2, y: 2, w: 4, h: 4 })).toBe(true);
    expect(rectContainsRect({ x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 0, w: 10, h: 10 })).toBe(true);
    expect(rectContainsRect({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 })).toBe(false);
  });
});

describe('hitTestPoint', () => {
  it('hits a rect interior and tolerance band', () => {
    const rect = rectObject('r', 0, 0, 100, 50);
    expect(hitTestPoint(rect, { x: 50, y: 25 }, 0)).toBe(true);
    expect(hitTestPoint(rect, { x: -0.5, y: 25 }, 0)).toBe(false);
    expect(hitTestPoint(rect, { x: -0.5, y: 25 }, 2)).toBe(true);
  });

  it('hits an ellipse precisely (inclusive boundary)', () => {
    const ellipse = { ...rectObject('e', 0, 0, 100, 50), kind: 'ellipse' as const };
    expect(hitTestPoint(ellipse, { x: 50, y: 25 }, 0)).toBe(true);
    expect(hitTestPoint(ellipse, { x: 100, y: 25 }, 0)).toBe(true);
    expect(hitTestPoint(ellipse, { x: 101, y: 25 }, 0)).toBe(false);
    expect(hitTestPoint(ellipse, { x: 101, y: 25 }, 5)).toBe(true);
  });

  it('hits a line by segment distance', () => {
    const line = { id: 'l1', kind: 'line' as const, rank: '1:l1', version: 1, createdBy: 'u1', x: 0, y: 0, w: 100, h: 0, start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, style: thin };
    expect(hitTestPoint(line, { x: 50, y: 1 }, 0)).toBe(true);
    expect(hitTestPoint(line, { x: 50, y: 1.5 }, 0)).toBe(false);
    expect(hitTestPoint(line, { x: 50, y: 1.5 }, 0.5)).toBe(true);
    expect(hitTestPoint(line, { x: 50, y: 3 }, 0)).toBe(false);
  });

  it('hits a stroke by polyline distance', () => {
    const stroke: StrokeObject = {
      ...strokeObject([[0, 0], [10, 0], [10, 10]]),
      w: 10, h: 10,
    };
    expect(hitTestPoint(stroke, { x: 5, y: 1 }, 0)).toBe(true);
    expect(hitTestPoint(stroke, { x: 5, y: 1.5 }, 0)).toBe(false);
    expect(hitTestPoint(stroke, { x: 5, y: 3 }, 2)).toBe(true);
  });

  it('hits a frame only on its border or label, never its interior', () => {
    const frame = frameObject('f', 0, 0, 100, 50, 'F');
    expect(hitTestPoint(frame, { x: 50, y: 25 }, 0)).toBe(false); // interior
    expect(hitTestPoint(frame, { x: 0, y: 25 }, 0)).toBe(true); // left border
    expect(hitTestPoint(frame, { x: 50, y: 0 }, 0)).toBe(true); // top border
    expect(hitTestPoint(frame, { x: 10, y: -5 }, 0)).toBe(true); // label chip
    expect(hitTestPoint(frame, { x: 10, y: 25 }, 0)).toBe(false); // interior
  });

  it('hits text/sticky/image by expanded rect', () => {
    const text: TextObject = { id: 't1', kind: 'text', rank: '1:t1', version: 1, createdBy: 'u1', x: 0, y: 0, w: 240, h: 24, text: 'hi', style: { colour: 'ink', size: 'M', font: 'app', bold: false, italic: false, align: 'left' } };
    expect(hitTestPoint(text, { x: 120, y: 12 }, 0)).toBe(true);
    expect(hitTestPoint(text, { x: 250, y: 12 }, 0)).toBe(false);
    expect(hitTestPoint(text, { x: 250, y: 12 }, 20)).toBe(true);
  });
});

describe('hitTestMarquee', () => {
  it('selects ordinary objects by intersecting bounds', () => {
    expect(hitTestMarquee(rectObject('r', 0, 0, 100, 50), { x: 0, y: 0, w: 50, h: 25 })).toBe(true);
    expect(hitTestMarquee(rectObject('r', 0, 0, 100, 50), { x: 200, y: 200, w: 10, h: 10 })).toBe(false);
  });

  it('selects frames only when fully enclosed', () => {
    const frame = frameObject('f', 0, 0, 100, 50, 'Frame');
    expect(hitTestMarquee(frame, { x: 0, y: 0, w: 100, h: 50 })).toBe(true);
    expect(hitTestMarquee(frame, { x: -1, y: -1, w: 102, h: 52 })).toBe(true);
    expect(hitTestMarquee(frame, { x: 0, y: 0, w: 50, h: 50 })).toBe(false);
  });
});

describe('topmostObjectAtPoint', () => {
  it('returns the last (topmost) hit in rank order', () => {
    const a = rectObject('a', 0, 0, 100, 100);
    const b = rectObject('b', 50, 0, 100, 100);
    const objects: BoardObject[] = [a, b];
    expect(topmostObjectAtPoint(objects, { x: 60, y: 50 }, 0)?.id).toBe('b');
    expect(topmostObjectAtPoint(objects, { x: 10, y: 50 }, 0)?.id).toBe('a');
  });

  it('returns undefined on a miss or empty input', () => {
    expect(topmostObjectAtPoint([rectObject('a', 0, 0, 100, 100)], { x: 500, y: 500 }, 0)).toBeUndefined();
    expect(topmostObjectAtPoint([], { x: 0, y: 0 }, 0)).toBeUndefined();
  });
});
