import type { FillMode, PaletteColour, StickyTone, TextAlignment, TextSize } from '../contract';
import { TEXT_SIZE_WORLD_UNITS } from '../contract/limits';
import { DEFAULT_STYLE_DEFAULTS } from '../state/sessionStore';
import type { TemplateItem } from './templates';


export function frame(label: string, x: number, y: number, w = 560, h = 560): TemplateItem {
  return { kind: 'frame', label, x, y, w, h };
}
export function sticky(text: string, tone: StickyTone, x: number, y: number): TemplateItem {
  return { kind: 'sticky', text, tone, x, y, w: 200, h: 200 };
}
/**
 * Deterministic text height (no DOM at import time): wraps by an average glyph
 * width, so heights are identical in the app, the gallery preview and tests.
 */
export function estimateTextHeight(value: string, w: number, size: TextSize, bold: boolean): number {
  const px = TEXT_SIZE_WORLD_UNITS[size];
  const perLine = Math.max(1, Math.floor(w / (px * (bold ? 0.58 : 0.54))));
  const lines = value.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / perLine)), 0);
  return Math.ceil(lines * px * 1.25);
}
export function text(value: string, x: number, y: number, w = 480, size: TextSize = 'M', bold = false, colour: PaletteColour = 'ink', align: TextAlignment = 'left'): TemplateItem {
  const style = { ...DEFAULT_STYLE_DEFAULTS.text, size, bold, colour, align };
  return { kind: 'text', text: value, x, y, w, h: estimateTextHeight(value, w, size, bold), style };
}
/** Centred text whose box is centred on (cx, cy). */
export function centred(value: string, cx: number, cy: number, w: number, size: TextSize = 'M', bold = false, colour: PaletteColour = 'ink'): TemplateItem {
  const h = estimateTextHeight(value, w, size, bold);
  return text(value, cx - w / 2, Math.round(cy - h / 2), w, size, bold, colour, 'center');
}
export function shape(kind: 'rect' | 'ellipse', x: number, y: number, w: number, h: number, colour: PaletteColour = 'blue', fill: FillMode = 'tint'): TemplateItem {
  return { kind, x, y, w, h, colour, fill };
}
export function connector(kind: 'line' | 'arrow', x1: number, y1: number, x2: number, y2: number, colour: PaletteColour = 'blue'): TemplateItem {
  const x = Math.min(x1, x2); const y = Math.min(y1, y2);
  return { kind, x, y, w: Math.abs(x2 - x1), h: Math.abs(y2 - y1), start: { x: x1 - x, y: y1 - y }, end: { x: x2 - x, y: y2 - y }, colour };
}
/** Frame-with-two-stickies columns on a 320 pitch: 40 padding on every side. */
export function columns(labels: readonly string[], samples: readonly (readonly [string, string])[], tones: readonly StickyTone[]): TemplateItem[] {
  return labels.flatMap((label, i) => [
    frame(label, i * 320, 160, 280, 520),
    sticky(samples[i][0], tones[i % tones.length], i * 320 + 40, 200),
    sticky(samples[i][1], tones[i % tones.length], i * 320 + 40, 440),
  ]);
}
