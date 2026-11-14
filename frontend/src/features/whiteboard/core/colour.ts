import { HEX_COLOUR_PATTERN } from '../contract';
import type { HexColour } from '../contract';

const hexRe = new RegExp(HEX_COLOUR_PATTERN);

const PALETTE_HEX: Readonly<Record<string, string>> = {
  ink: '#ffffff',
  gray: '#94a3b8',
  red: '#ef4444',
  orange: '#f59e0b',
  yellow: '#ffd56b',
  green: '#22c55e',
  blue: '#38bdf8',
  purple: '#a855f7',
  pink: '#ff6b8b',
};

const STICKY_TONE_HEX: Readonly<Record<string, string>> = {
  yellow: '#ffd56b',
  pink: '#ff6b8b',
  mint: '#72f1b8',
  sky: '#70d6ff',
};

export function isHexColour(value: string): value is HexColour {
  return hexRe.test(value);
}

export function normalizeHexColour(value: string): HexColour | null {
  const trimmed = value.trim().toLowerCase();
  return isHexColour(trimmed) ? trimmed : null;
}

export function resolveInkCss(colour: string): string {
  return isHexColour(colour) ? colour : `var(--wb-colour-${colour})`;
}

export function resolveStickyToneCss(tone: string): { readonly fill: string; readonly ink: string } {
  if (!isHexColour(tone)) {
    return {
      fill: `var(--wb-sticky-${tone})`,
      ink: `var(--wb-sticky-${tone}-ink)`,
    };
  }
  const r = parseInt(tone.slice(1, 3), 16);
  const g = parseInt(tone.slice(3, 5), 16);
  const b = parseInt(tone.slice(5, 7), 16);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return {
    fill: tone,
    ink: yiq < 140 ? '#f8fafc' : '#241a08',
  };
}

export function pickerHexForColour(colour: string): string {
  if (isHexColour(colour)) return colour.toLowerCase();
  return PALETTE_HEX[colour] ?? '#ffffff';
}

export function pickerHexForStickyTone(tone: string): string {
  if (isHexColour(tone)) return tone.toLowerCase();
  return STICKY_TONE_HEX[tone] ?? '#ffd56b';
}
