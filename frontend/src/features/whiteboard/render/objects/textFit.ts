import { STICKY_BASE_HEIGHT } from '../../contract';
import type { StickyObject, TextObject } from '../../contract';
import { fitSticky, fitText, sharedTextMeasurer } from '../../editing';
import type { TextMeasurer } from '../../editing';

/**
 * Renderer side of the editor's auto-fit. The editor and the renderer call the
 * SAME fitSticky/fitText helpers with the same inputs, so a note's font size does
 * not jump when editing starts or ends. One hidden probe (inside its own
 * `.wb-root`, so it resolves the same --wb-font-* tokens) serves every board.
 */
const MAX_CACHE_ENTRIES = 2_000;
const cache = new Map<string, number>();
let override: TextMeasurer | null = null;

function measurer(): TextMeasurer {
  return override ?? sharedTextMeasurer();
}

/** Same minimum box as the editor: the note never fits against more than its base height. */
export function stickyFontSize(object: StickyObject): number {
  const minHeight = Math.min(object.h, STICKY_BASE_HEIGHT);
  const key = `${object.w}|${minHeight}|${object.text}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const { fontSize } = fitSticky(measurer(), { text: object.text, width: object.w, minHeight });
  if (cache.size >= MAX_CACHE_ENTRIES) cache.clear();
  cache.set(key, fontSize);
  return fontSize;
}

const noMeasure: TextMeasurer = () => 0;
/** Text objects keep their persisted measured height; only the size step is derived. */
export function textFontSize(object: TextObject): number {
  return fitText(noMeasure, {
    text: object.text, width: object.w, size: object.style.size, bold: object.style.bold, italic: object.style.italic,
  }).fontSize;
}

/** Web fonts changed metrics: forget every fit so the next paint re-measures. */
export function invalidateTextFits(): void {
  cache.clear();
}

/** Tests only: swap the DOM measurer for a deterministic one (null restores it). */
export function setTextMeasurerForTests(measure: TextMeasurer | null): void {
  override = measure;
  cache.clear();
}
