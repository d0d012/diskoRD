import { isHexColour, pickerHexForColour, pickerHexForStickyTone, resolveStickyToneCss } from '../core';

/** --wb-canvas (the board's navy background). */
export const BOARD_CANVAS = '#15171e';

/** --wb-font-ui / --font-family-discord stack. */
export const APP_FONT = '"gg sans", "Inter", "Noto Sans", "Helvetica Neue", Helvetica, Arial, sans-serif';
/** --wb-font-handwriting stack (bundled Caveat). */
export const HANDWRITING_FONT = '"Caveat", cursive';
/** --wb-font-pixel stack (bundled Silkscreen). */
export const PIXEL_FONT = '"Silkscreen", ui-monospace, monospace';

/** --wb-frame-border: 35% blurple over transparent. */
export const FRAME_BORDER = 'rgba(88, 101, 242, 0.35)';
/** --wb-frame-chip-bg / --wb-primary. */
export const FRAME_CHIP_BG = '#5865f2';
/** --color-dc-text-normal. */
export const FRAME_TITLE = '#f2f3f5';

/** --wb-sticky-*-ink tones for the named sticky colours. */
const STICKY_INK_HEX: Readonly<Record<string, string>> = {
  yellow: '#422e03',
  pink: '#3e0b16',
  mint: '#053820',
  sky: '#023347',
};

/** Resolve a palette/hex ink id to a concrete hex for standalone rendering. */
export function inkHex(colour: string): string {
  return pickerHexForColour(colour);
}

export function stickyFillHex(tone: string): string {
  return pickerHexForStickyTone(tone);
}

/** Ink colour on a sticky note, matching the tone (custom hex derives contrast ink). */
export function stickyInkHex(tone: string): string {
  if (isHexColour(tone)) return resolveStickyToneCss(tone).ink;
  return STICKY_INK_HEX[tone] ?? STICKY_INK_HEX.yellow;
}

/** The note's adhesive band: the fill darkened 8%, like `color-mix(… 92%, #000)`. */
export function darken(hex: string, factor: number): string {
  const r = Math.round(parseInt(hex.slice(1, 3), 16) * factor);
  const g = Math.round(parseInt(hex.slice(3, 5), 16) * factor);
  const b = Math.round(parseInt(hex.slice(5, 7), 16) * factor);
  return `rgb(${r},${g},${b})`;
}
