import { describe, expect, it } from 'vitest';
import { arrow, image, rect, sticky, text } from '../testObjects';
import { paintGrid, paintMarquee, paintSelection } from './paint';

function layer(): HTMLDivElement {
  return document.createElement('div');
}
const handleIds = (root: HTMLElement, id: string) =>
  Array.from(root.querySelectorAll<HTMLElement>(`[data-wb-selection-id="${id}"] [data-wb-handle]`), node => node.dataset.wbHandle);

describe('selection overlay', () => {
  it('shows eight square handles in screen space for a single selected box', () => {
    const root = layer();
    paintSelection(root, [rect], { x: 100, y: 50, zoom: 2 });
    expect(handleIds(root, rect.id)).toEqual(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']);
    const se = root.querySelector<HTMLElement>('[data-wb-handle="se"]')!;
    // (10 + 160) * 2 + 100, (20 + 100) * 2 + 50: positioned in screen pixels, not scaled.
    expect(se.style.transform).toBe('translate(440px, 290px) translate(-50%, -50%)');
    expect(se.className).toContain('wb-root__selection-handle');
    expect(se.hasAttribute('data-wb-object-id')).toBe(false);
    const box = root.querySelector<HTMLElement>('.wb-render-selection-box')!;
    expect(box.style.width).toBe('320px');
    expect(root.querySelector('[data-wb-size-readout]')!.textContent).toBe('160 × 100');
  });

  it('only offers the handles input can drag for each kind', () => {
    const root = layer();
    paintSelection(root, [arrow], { x: 0, y: 0, zoom: 1 });
    expect(handleIds(root, arrow.id)).toEqual(['start', 'end']);
    expect(root.querySelector<HTMLElement>('.wb-render-selection-box')!.hidden).toBe(true);
    expect(root.querySelector<HTMLElement>('[data-wb-handle="end"]')!.style.transform).toBe('translate(100px, 400px) translate(-50%, -50%)');
    paintSelection(root, [image], { x: 0, y: 0, zoom: 1 });
    expect(handleIds(root, image.id)).toEqual(['nw', 'ne', 'se', 'sw']);
    paintSelection(root, [text], { x: 0, y: 0, zoom: 1 });
    expect(handleIds(root, text.id)).toEqual(['nw', 'ne', 'e', 'se', 'sw', 'w']);
    paintSelection(root, [sticky], { x: 0, y: 0, zoom: 1 });
    expect(handleIds(root, sticky.id)).toEqual([]);
    expect(root.querySelectorAll('[data-wb-selection-id]')).toHaveLength(1);
  });

  it('outlines every object of a multi-selection without handles, and clears', () => {
    const root = layer();
    paintSelection(root, [rect, image], { x: 0, y: 0, zoom: 1 });
    expect(root.querySelectorAll('.wb-render-selection-box')).toHaveLength(2);
    expect(root.querySelectorAll('[data-wb-handle]')).toHaveLength(0);
    expect(root.querySelector('[data-wb-size-readout]')).toBeNull();
    paintSelection(root, [], { x: 0, y: 0, zoom: 1 });
    expect(root.children).toHaveLength(0);
  });
});

describe('grid and marquee', () => {
  it('writes the camera-dependent grid tokens', () => {
    const node = layer();
    paintGrid(node, { x: 30, y: 10, zoom: 0.5 });
    expect(node.style.getPropertyValue('--wb-zoom')).toBe('0.5');
    expect(node.style.getPropertyValue('--wb-grid-size')).toBe('12px');
    expect(node.style.getPropertyValue('--wb-grid-origin-x')).toBe('24px');
  });

  it('positions the marquee in screen space and hides it when cleared', () => {
    const node = layer();
    paintMarquee(node, { x: 10, y: 10, w: 20, h: 5 }, { x: 0, y: 0, zoom: 2 });
    expect(node.hidden).toBe(false);
    expect(node.style.transform).toBe('translate(20px, 20px)');
    expect(node.style.width).toBe('40px');
    paintMarquee(node, null, { x: 0, y: 0, zoom: 2 });
    expect(node.hidden).toBe(true);
  });
});
