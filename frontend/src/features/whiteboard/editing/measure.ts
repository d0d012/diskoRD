import {
  STICKY_BASE_HEIGHT, STICKY_MIN_FONT_SIZE, STICKY_PREFERRED_FONT_SIZE, TEXT_SIZE_WORLD_UNITS,
} from '../contract/limits';
import type { FontKind, TextSize } from '../contract/types';

/** Line-height ratios shared by the editor and (by agreement) the renderer. */
export const TEXT_LINE_HEIGHT = 1.25;
export const STICKY_LINE_HEIGHT = 1.1;
/** Mirrors --wb-sticky-padding (world units, all four sides). */
export const STICKY_PADDING = 16;

export interface TextMeasureRequest {
  readonly text: string;
  /** Content width in world units (padding already removed). */
  readonly width: number;
  readonly fontSize: number;
  /** Ratio of font size. */
  readonly lineHeight: number;
  readonly font: FontKind;
  readonly bold: boolean;
  readonly italic: boolean;
}

/** Returns the wrapped content height in world units for the request. */
export type TextMeasurer = (request: TextMeasureRequest) => number;

export interface StickyFitInput {
  readonly text: string;
  readonly width: number;
  /** The note never gets shorter than this; defaults to the 200 base height. */
  readonly minHeight?: number;
}

export interface StickyFit {
  readonly fontSize: number;
  readonly height: number;
  /** False when even the minimum font overflowed and the note had to grow. */
  readonly fits: boolean;
}

/**
 * Largest integer font size from the preferred size down to the minimum at which
 * the text fits the note's minimum box; below that the note grows downward at
 * the minimum size. Deterministic from the text alone, so nothing jumps on commit.
 */
export function fitSticky(measure: TextMeasurer, input: StickyFitInput): StickyFit {
  const minHeight = input.minHeight ?? STICKY_BASE_HEIGHT;
  const contentWidth = Math.max(input.width - 2 * STICKY_PADDING, 1);
  const available = minHeight - 2 * STICKY_PADDING;
  const measureAt = (fontSize: number): number => measure({
    text: input.text, width: contentWidth, fontSize, lineHeight: STICKY_LINE_HEIGHT,
    font: 'handwriting', bold: true, italic: false,
  });
  for (let fontSize = STICKY_PREFERRED_FONT_SIZE; fontSize > STICKY_MIN_FONT_SIZE; fontSize--) {
    if (measureAt(fontSize) <= available) return { fontSize, height: minHeight, fits: true };
  }
  const needed = Math.ceil(measureAt(STICKY_MIN_FONT_SIZE) + 2 * STICKY_PADDING);
  return needed <= minHeight
    ? { fontSize: STICKY_MIN_FONT_SIZE, height: minHeight, fits: true }
    : { fontSize: STICKY_MIN_FONT_SIZE, height: needed, fits: false };
}

export interface TextFitInput {
  readonly text: string;
  readonly width: number;
  readonly size: TextSize;
  readonly bold: boolean;
  readonly italic: boolean;
}

/** Text objects reflow to their width; the height is the measured height (>= one line). */
export function fitText(measure: TextMeasurer, input: TextFitInput): { fontSize: number; height: number } {
  const fontSize = TEXT_SIZE_WORLD_UNITS[input.size];
  const oneLine = fontSize * TEXT_LINE_HEIGHT;
  const measured = measure({
    text: input.text, width: Math.max(input.width, 1), fontSize, lineHeight: TEXT_LINE_HEIGHT,
    font: 'app', bold: input.bold, italic: input.italic,
  });
  return { fontSize, height: Math.ceil(Math.max(measured, oneLine)) };
}

export interface DomTextMeasurer extends TextMeasurer {
  dispose(): void;
}

/** DOM-backed measurer: an invisible pre-wrap box inside `host`, sharing its CSS tokens. */
export function createDomTextMeasurer(host: HTMLElement): DomTextMeasurer {
  const probe = host.ownerDocument.createElement('div');
  probe.setAttribute('aria-hidden', 'true');
  Object.assign(probe.style, {
    position: 'absolute', left: '0', top: '0', visibility: 'hidden', pointerEvents: 'none',
    whiteSpace: 'pre-wrap', overflowWrap: 'break-word', wordBreak: 'normal', boxSizing: 'content-box',
    padding: '0', margin: '0', border: '0',
  });
  host.appendChild(probe);
  const measurer = ((request: TextMeasureRequest): number => {
    probe.style.width = `${request.width}px`;
    probe.style.fontSize = `${request.fontSize}px`;
    probe.style.lineHeight = String(request.lineHeight);
    probe.style.fontFamily = request.font === 'handwriting' ? 'var(--wb-font-handwriting, "Caveat", cursive)' : 'var(--wb-font-ui, sans-serif)';
    probe.style.fontWeight = request.bold ? '700' : '400';
    probe.style.fontStyle = request.italic ? 'italic' : 'normal';
    // Zero-width space keeps a trailing newline's empty last line, as a textarea does.
    probe.textContent = `${request.text}\u200b`;
    return probe.getBoundingClientRect().height;
  }) as DomTextMeasurer;
  measurer.dispose = () => { probe.remove(); };
  return measurer;
}

let sharedMeasurer: DomTextMeasurer | null = null;
let sharedOverride: TextMeasurer | null = null;

/**
 * One hidden probe (inside its own `.wb-root`, so it resolves the same
 * --wb-font-* tokens) shared by every board, for code that has no editor surface.
 */
export function sharedTextMeasurer(): TextMeasurer {
  if (sharedOverride) return sharedOverride;
  if (!sharedMeasurer) {
    const host = document.createElement('div');
    host.className = 'wb-root';
    host.setAttribute('aria-hidden', 'true');
    host.dataset.wbMeasureHost = '';
    Object.assign(host.style, {
      position: 'fixed', left: '0', top: '0', width: '0', height: '0',
      overflow: 'hidden', visibility: 'hidden', pointerEvents: 'none',
    });
    document.body.append(host);
    sharedMeasurer = createDomTextMeasurer(host);
  }
  return sharedMeasurer;
}

/** Tests only: swap the shared DOM measurer for a deterministic one (null restores it). */
export function setSharedTextMeasurerForTests(measure: TextMeasurer | null): void {
  sharedOverride = measure;
}

export interface TextHeightInput {
  readonly text: string;
  readonly w: number;
  readonly style: { readonly size: TextSize; readonly bold: boolean; readonly italic: boolean };
}

/**
 * The persisted height `h` of a text object: the editor's own fit. Owned by the
 * editing package; every writer of text/width/size (editor commit, creation,
 * paste, reflow resize, style change) uses this so outline and hit box match
 * what is drawn.
 */
export function textObjectHeight(object: TextHeightInput, measure: TextMeasurer = sharedTextMeasurer()): number {
  return fitText(measure, {
    text: object.text, width: object.w, size: object.style.size, bold: object.style.bold, italic: object.style.italic,
  }).height;
}
