import { describe, expect, it } from 'vitest';
import type { FrameObject, RectObject } from '../contract';
import { exportRegion } from './region';

function rect(id: string, x: number, y: number, w: number, h: number): RectObject {
  return { id, kind: 'rect', rank: `1:${id}`, version: 1, createdBy: 'u', x, y, w, h, style: { colour: 'ink', weight: 'thin', fill: 'none' } };
}

function frame(id: string, x: number, y: number, w: number, h: number, label: string): FrameObject {
  return { id, kind: 'frame', rank: `0:${id}`, version: 1, createdBy: 'u', x, y, w, h, label, style: { colour: 'gray', weight: 'thin' } };
}

describe('exportRegion', () => {
  it('exports the whole board when nothing is selected', () => {
    const objects = [frame('f', 0, 0, 100, 100, 'A'), rect('r1', 10, 10, 20, 20), rect('r2', 50, 50, 20, 20)];
    const region = exportRegion({ objects, selectedIds: [], channelName: 'design' });
    expect(region).not.toBeNull();
    expect(region!.mode).toBe('board');
    expect(region!.clip).toBeNull();
    expect(region!.objects).toEqual(objects);
    expect(region!.name).toBe('design');
  });

  it('exports the current selection', () => {
    const objects = [rect('r1', 10, 10, 20, 20), rect('r2', 50, 50, 20, 20)];
    const region = exportRegion({ objects, selectedIds: ['r2'], channelName: 'design' });
    expect(region!.mode).toBe('selection');
    expect(region!.clip).toBeNull();
    expect(region!.objects.map(o => o.id)).toEqual(['r2']);
    expect(region!.name).toBe('design');
  });

  it('exports a single selected frame clipped to its bounds with centre-contained contents', () => {
    const f = frame('f', 0, 0, 100, 100, 'Sprint');
    const inside = rect('inside', 40, 40, 20, 20);   // centre 50,50
    const outside = rect('outside', 200, 200, 20, 20); // centre 210,210
    const objects = [f, inside, outside, frame('other', -500, -500, 10, 10, 'Other')];
    const region = exportRegion({ objects, selectedIds: ['f'], channelName: 'design' });
    expect(region!.mode).toBe('frame');
    expect(region!.clip).toEqual({ x: 0, y: 0, w: 100, h: 100 });
    expect(region!.bounds).toEqual({ x: 0, y: 0, w: 100, h: 100 });
    expect(region!.objects.map(o => o.id)).toEqual(['inside']);
    expect(region!.name).toBe('Sprint');
  });

  it('falls back to the channel name when the frame label is blank', () => {
    const f = frame('f', 0, 0, 100, 100, '   ');
    const inside = rect('inside', 40, 40, 20, 20);
    const region = exportRegion({ objects: [f, inside], selectedIds: ['f'], channelName: 'design' });
    expect(region!.name).toBe('design');
  });

  it('returns null for an empty frame or an empty board', () => {
    expect(exportRegion({ objects: [frame('f', 0, 0, 100, 100, 'A')], selectedIds: ['f'], channelName: 'd' })).toBeNull();
    expect(exportRegion({ objects: [], selectedIds: [], channelName: 'd' })).toBeNull();
  });
});
