import { STICKY_BASE_HEIGHT } from '../contract';
import { fitSticky } from '../editing';
import type { TextMeasurer } from '../editing';
import { wrapText } from './wrap';
import type { TextMeasure } from './wrap';

/**
 * Sticky auto-fit shared by the SVG builder and the canvas rasterizer. The
 * caller supplies a width measure bound to handwriting-bold at a given font
 * size; the line count (from `wrapText`) times line-height gives the wrapped
 * height the same way the editor's DOM measurer does.
 */
export function stickyFontSize(
  text: string,
  width: number,
  minHeight: number,
  measureAt: (fontSize: number) => TextMeasure,
): number {
  const measurer: TextMeasurer = ({ text: value, width: contentWidth, fontSize, lineHeight }) => {
    const lines = wrapText(value, Math.max(contentWidth, 1), measureAt(fontSize));
    return lines.length * fontSize * lineHeight;
  };
  return fitSticky(measurer, { text, width, minHeight }).fontSize;
}

/** Same minimum box as the renderer: never fit against more than the base height. */
export function stickyMinHeight(height: number): number {
  return Math.min(height, STICKY_BASE_HEIGHT);
}
