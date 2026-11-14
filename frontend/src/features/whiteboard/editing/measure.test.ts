import { describe, expect, it } from 'vitest';
import { STICKY_BASE_HEIGHT, STICKY_MIN_FONT_SIZE, STICKY_PREFERRED_FONT_SIZE } from '../contract/limits';
import { fitSticky, fitText, STICKY_PADDING, TEXT_LINE_HEIGHT } from './measure';
import { fakeMeasurer } from './fakeMeasurer';

describe('fitSticky', () => {
  it('keeps the preferred size for short text and the base height', () => {
    expect(fitSticky(fakeMeasurer, { text: 'hi', width: 200 })).toEqual({
      fontSize: STICKY_PREFERRED_FONT_SIZE, height: STICKY_BASE_HEIGHT, fits: true,
    });
  });

  it('shrinks stepwise to the largest size that fits', () => {
    const text = 'x'.repeat(220);
    const fit = fitSticky(fakeMeasurer, { text, width: 200 });
    expect(fit.fontSize).toBeLessThan(STICKY_PREFERRED_FONT_SIZE);
    expect(fit.fontSize).toBeGreaterThanOrEqual(STICKY_MIN_FONT_SIZE);
    expect(fit.height).toBe(STICKY_BASE_HEIGHT);
    const bigger = fakeMeasurer({
      text, width: 200 - 2 * STICKY_PADDING, fontSize: fit.fontSize + 1, lineHeight: 1.1, font: 'handwriting', bold: true, italic: false,
    });
    expect(bigger).toBeGreaterThan(STICKY_BASE_HEIGHT - 2 * STICKY_PADDING);
  });

  it('stops at the minimum size, then grows the height downward', () => {
    const fit = fitSticky(fakeMeasurer, { text: 'line\n'.repeat(40), width: 200 });
    expect(fit.fontSize).toBe(STICKY_MIN_FONT_SIZE);
    expect(fit.fits).toBe(false);
    expect(fit.height).toBeGreaterThan(STICKY_BASE_HEIGHT);
    expect(fit.height).toBe(Math.ceil(41 * STICKY_MIN_FONT_SIZE * 1.1 + 2 * STICKY_PADDING));
  });

  it('shrinks back when text is removed', () => {
    const grown = fitSticky(fakeMeasurer, { text: 'line\n'.repeat(40), width: 200 });
    const small = fitSticky(fakeMeasurer, { text: 'line', width: 200 });
    expect(small.height).toBeLessThan(grown.height);
    expect(small.height).toBe(STICKY_BASE_HEIGHT);
  });
});

describe('fitText', () => {
  it('uses the size step and at least one line', () => {
    expect(fitText(fakeMeasurer, { text: '', width: 240, size: 'M', bold: false, italic: false }))
      .toEqual({ fontSize: 24, height: Math.ceil(24 * TEXT_LINE_HEIGHT) });
  });

  it('reflows to the width and grows in height', () => {
    const narrow = fitText(fakeMeasurer, { text: 'x'.repeat(100), width: 120, size: 'S', bold: true, italic: false });
    const wide = fitText(fakeMeasurer, { text: 'x'.repeat(100), width: 1200, size: 'S', bold: true, italic: false });
    expect(narrow.height).toBeGreaterThan(wide.height);
  });
});
