import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BoardObject, StickyObject } from '../../contract';
import { FRAME_LABEL_HEIGHT, STICKY_MIN_FONT_SIZE, STICKY_PREFERRED_FONT_SIZE } from '../../contract';
import { frameLabelBounds } from '../../core';
import { fitSticky } from '../../editing';
import { fakeMeasurer } from '../../editing/fakeMeasurer';
import { allObjects, arrow, frame, image, rect, sticky, stroke, text } from '../testObjects';
import { BoardObjectView } from './BoardObjectView';
import { arrowHead, stickyTilt, strokePath } from './presentation';
import { setTextMeasurerForTests } from './textFit';

beforeEach(() => setTextMeasurerForTests(fakeMeasurer));
afterEach(() => setTextMeasurerForTests(null));

function mount(object: BoardObject = rect) {
  const { container } = render(<BoardObjectView object={object} />);
  return container.querySelector<HTMLDivElement>('[data-wb-object-id]')!;
}

describe('object components', () => {
  it.each(allObjects.map(object => [object.kind, object] as const))('%s renders the DOM protocol and world geometry', (_kind, object) => {
    const node = mount(object);
    expect(node.dataset.wbObjectId).toBe(object.id);
    expect(node.dataset.wbKind).toBe(object.kind);
    expect(node.style.transform).toBe(`translate(${object.x}px, ${object.y}px)`);
    expect(node.style.width).toBe(`${object.w}px`);
    expect(node.style.height).toBe(`${object.h}px`);
  });

  it('colours stroke-bearing kinds through palette CSS variables, never raw values', () => {
    expect(mount(rect).style.color).toBe('var(--wb-colour-blue)');
    expect(mount(text).style.color).toBe('var(--wb-colour-orange)');
    const shape = mount(rect).querySelector('rect')!;
    expect(shape.getAttribute('fill-opacity')).toBe('0.15');
    expect(shape.getAttribute('stroke-width')).toBe('2');
  });

  it('draws a stroke as a perfect-freehand outline, cached by point geometry', () => {
    const path = mount(stroke).querySelector('path')!.getAttribute('d')!;
    expect(path).toMatch(/^M.+Z$/);
    expect(strokePath({ ...stroke, x: 999 })).toBe(path);
    expect(strokePath({ ...stroke, points: [...stroke.points] })).toBe(path);
    expect(strokePath({ ...stroke, preset: 'marker' })).not.toBe(path);
  });

  it('puts the arrowhead at the end and stops the shaft at its base', () => {
    const node = mount(arrow);
    const head = arrowHead(arrow.start, arrow.end, 4);
    expect(node.querySelector('path')!.getAttribute('d')).toBe(head.path);
    expect(node.querySelector('line')!.getAttribute('x2')).toBe(String(head.base.x));
    expect(head.path).toContain(`L${arrow.end.x},${arrow.end.y}L`);
    expect(arrowHead({ x: 0, y: 0 }, { x: 0, y: 0 }, 2).path).toBe('');
  });

  it('renders text with the editor font size and line height', () => {
    const node = mount(text).querySelector<HTMLElement>('[data-wb-text]')!;
    expect(node.textContent).toBe(text.text);
    expect(node.style.fontSize).toBe('32px');
    expect(node.style.lineHeight).toBe('1.25');
    expect(node.style.fontWeight).toBe('700');
    expect(node.style.textAlign).toBe('center');
  });

  it('auto-fits sticky text exactly as the editor does and exposes a deterministic tilt', () => {
    const long: StickyObject = { ...sticky, text: 'a much longer note '.repeat(12) };
    for (const object of [sticky, long]) {
      const node = mount(object);
      const note = node.querySelector<HTMLElement>('.wb-root__sticky')!;
      const body = node.querySelector<HTMLElement>('[data-wb-text]')!;
      const expected = fitSticky(fakeMeasurer, { text: object.text, width: object.w, minHeight: 200 }).fontSize;
      expect(body.style.fontSize).toBe(`${expected}px`);
      expect(body.style.lineHeight).toBe('1.1');
      expect(note.style.padding).toBe('16px');
      expect(note.dataset.tone).toBe('mint');
      expect(note.style.getPropertyValue('--wb-sticky-tilt')).toBe(`${stickyTilt(object.id)}deg`);
    }
    expect(fitSticky(fakeMeasurer, { text: long.text, width: 200 }).fontSize).toBeLessThan(STICKY_PREFERRED_FONT_SIZE);
    expect(fitSticky(fakeMeasurer, { text: long.text, width: 200 }).fontSize).toBeGreaterThanOrEqual(STICKY_MIN_FONT_SIZE);
  });

  it('keeps sticky tilt within ±1.5deg and stable per id', () => {
    for (const id of ['a', 'b', 'sticky-1', '00000000-0000-4000-8000-000000000001']) {
      expect(Math.abs(stickyTilt(id))).toBeLessThanOrEqual(1.5);
      expect(stickyTilt(id)).toBe(stickyTilt(id));
    }
  });

  it('renders an image as a cropped <img> honouring the pixelated flag', () => {
    const img = mount(image).querySelector('img')!;
    expect(img.getAttribute('src')).toBe(image.url);
    // Half the source width is visible in 100 world units, so the full image is 200 wide, shifted left by 50.
    expect(img.style.left).toBe('-50px');
    expect(img.style.width).toBe('200px');
    expect(img.style.imageRendering).toBe('pixelated');
    expect(mount({ ...image, id: 'smooth', pixelated: false }).querySelector('img')!.style.imageRendering).toBe('auto');
  });

  it('places the frame label outside the top-left corner using the hit-test geometry', () => {
    const label = mount(frame).querySelector<HTMLElement>('[data-wb-frame-label]')!;
    const bounds = frameLabelBounds(frame);
    expect(label.dataset.wbFrameLabel).toBe(frame.id);
    expect(label.style.top).toBe(`${-FRAME_LABEL_HEIGHT}px`);
    expect(label.style.left).toBe('0px');
    expect(label.style.width).toBe(`${bounds.w}px`);
    expect(label.style.height).toBe(`${bounds.h}px`);
    expect(label.textContent).toContain('Sprint');
  });

  it('hides only the text while editing and marks a lifted sticky', () => {
    const { container } = render(<BoardObjectView object={sticky} editing lifted />);
    expect(container.querySelector<HTMLElement>('[data-wb-text]')!.style.visibility).toBe('hidden');
    expect(container.querySelector<HTMLElement>('.wb-root__sticky')!.dataset.lifted).toBe('true');
  });
});
