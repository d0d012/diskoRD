import { describe, expect, it } from 'vitest';
import type { BoardObject, FrameObject } from '../contract/types';
import { objectsInsideFrame } from './frames';

function frameObject(id: string, x: number, y: number, w: number, h: number): FrameObject {
  return { id, kind: 'frame', rank: `0:${id}`, version: 1, createdBy: 'u1', x, y, w, h, label: id, style: { colour: 'ink', weight: 'thin' } };
}

function objectAt(id: string, x: number, y: number, w: number, h: number, kind: BoardObject['kind'] = 'rect'): BoardObject {
  const base = { id, kind, rank: `1:${id}`, version: 1, createdBy: 'u1', x, y, w, h };
  switch (kind) {
    case 'rect':
      return { ...base, kind: 'rect', style: { colour: 'ink', weight: 'thin', fill: 'none' } };
    case 'ellipse':
      return { ...base, kind: 'ellipse', style: { colour: 'ink', weight: 'thin', fill: 'none' } };
    case 'line':
      return { ...base, kind: 'line', start: { x: 0, y: 0 }, end: { x: w, y: h }, style: { colour: 'ink', weight: 'thin' } };
    case 'arrow':
      return { ...base, kind: 'arrow', start: { x: 0, y: 0 }, end: { x: w, y: h }, style: { colour: 'ink', weight: 'thin' } };
    case 'text':
      return { ...base, kind: 'text', text: id, style: { colour: 'ink', size: 'M', font: 'app', bold: false, italic: false, align: 'left' } };
    case 'sticky':
      return { ...base, kind: 'sticky', text: id, style: { tone: 'yellow', font: 'handwriting' } };
    case 'image':
      return { ...base, kind: 'image', assetId: 'asset', url: 'u', width: 100, height: 100, crop: { x: 0, y: 0, w: 1, h: 1 }, pixelated: false };
    case 'stroke':
      return { ...base, kind: 'stroke', points: [{ x: 0, y: 0, pressure: 0.5 }, { x: w, y: h, pressure: 0.5 }], preset: 'pen', style: { colour: 'ink', weight: 'thin' } };
    case 'frame':
      return frameObject(id, x, y, w, h);
  }
}

describe('objectsInsideFrame', () => {
  const frame = frameObject('f', 0, 0, 100, 100);

  it('collects ids whose centre lies inside the frame', () => {
    const inside = objectAt('inside', 25, 25, 50, 50);
    const outside = objectAt('outside', 150, 150, 50, 50);
    expect(objectsInsideFrame(frame, [inside, outside])).toEqual(['inside']);
  });

  it('treats a centre exactly on the border as inside', () => {
    const onEdge = objectAt('edge', 0, 25, 0, 50); // centre at (0, 50)
    expect(objectsInsideFrame(frame, [onEdge])).toEqual(['edge']);
  });

  it('excludes frames, including the frame itself', () => {
    const innerFrame = frameObject('inner', 25, 25, 50, 50);
    expect(objectsInsideFrame(frame, [frame, innerFrame])).toEqual([]);
  });

  it('moves every non-frame kind by its centre', () => {
    const objects: BoardObject[] = [
      objectAt('r', 0, 0, 100, 100, 'rect'),
      objectAt('e', 0, 0, 100, 100, 'ellipse'),
      objectAt('l', 0, 0, 100, 100, 'line'),
      objectAt('a', 0, 0, 100, 100, 'arrow'),
      objectAt('t', 0, 0, 100, 100, 'text'),
      objectAt('s', 0, 0, 100, 100, 'sticky'),
      objectAt('i', 0, 0, 100, 100, 'image'),
      objectAt('st', 0, 0, 100, 100, 'stroke'),
    ];
    expect(objectsInsideFrame(frame, objects)).toEqual(['r', 'e', 'l', 'a', 't', 's', 'i', 'st']);
  });

  it('returns an empty list for empty input', () => {
    expect(objectsInsideFrame(frame, [])).toEqual([]);
  });
});
