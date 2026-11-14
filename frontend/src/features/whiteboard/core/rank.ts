import { FRAME_RANK_PREFIX, MAX_RANK_SUFFIX_LENGTH, OBJECT_RANK_PREFIX, RANK_ALPHABET, RANK_PATTERN } from '../contract/limits';
import type { Rank } from '../contract/types';

/**
 * Fractional rank keys. A Rank is `prefix + ':' + suffix` where prefix is '0'
 * for frames and '1' for everything else; the suffix is a non-empty base-62
 * fractional key generated here. Ranks compare by JS code-unit order (never
 * localeCompare), then by id. Reordering never crosses the frame partition.
 *
 * The base-62 fractional algorithm is a port of the MIT/CC0 ordering used by
 * rocicorp/fractional-indexing (and the rocicorp/fracdex Go port): a
 * variable-length integer head plus a fractional tail, with the "trailing
 * zero" rule so there is always room to insert between any two keys.
 */

export type RankPrefix = '0' | '1';

export interface RankedId {
  readonly id: string;
  readonly rank: Rank;
}

const BASE_62_DIGITS = RANK_ALPHABET;
const rankPattern = new RegExp(RANK_PATTERN);
const SMALLEST_INT = 'A00000000000000000000000000';
const ZERO_KEY = 'a0';
const RANK_PREFIXES: readonly RankPrefix[] = ['0', '1'];

export function rankPrefix(rank: Rank): RankPrefix {
  if (!rankPattern.test(rank)) throw new Error(`invalid rank: ${rank}`);
  validateOrderKey(rank.slice(2));
  return rank.startsWith(FRAME_RANK_PREFIX) ? '0' : '1';
}

export function rankSuffix(rank: Rank): string {
  return rank.slice(2);
}

/** Code-unit comparison of two ranks (never localeCompare). */
export function compareRank(a: Rank, b: Rank): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Rank comparison with the object id as the tie-breaker. */
export function compareRanked(a: RankedId, b: RankedId): number {
  const rank = compareRank(a.rank, b.rank);
  if (rank !== 0) return rank;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function getIntLen(head: string): number {
  const code = head.charCodeAt(0);
  if (code >= 0x61 && code <= 0x7a) return code - 0x61 + 2; // a-z
  if (code >= 0x41 && code <= 0x5a) return 0x5a - code + 2; // A-Z
  throw new Error(`invalid order key head: ${head}`);
}

function getIntPart(key: string): string {
  const length = getIntLen(key[0]);
  if (length > key.length) throw new Error(`invalid order key: ${key}`);
  return key.slice(0, length);
}

function validateInt(intPart: string): void {
  if (intPart.length !== getIntLen(intPart[0])) {
    throw new Error(`invalid integer part of order key: ${intPart}`);
  }
}

function validateOrderKey(key: string): void {
  if (!key.length || key.length > MAX_RANK_SUFFIX_LENGTH ||
    [...key].some(char => !BASE_62_DIGITS.includes(char))) throw new Error(`invalid order key: ${key}`);
  if (key === SMALLEST_INT) throw new Error(`invalid order key: ${key}`);
  const intPart = getIntPart(key);
  if (key.slice(intPart.length).endsWith('0')) throw new Error(`invalid order key: ${key}`);
}

function incrementInt(value: string): string {
  validateInt(value);
  const head = value[0];
  const digits = value.slice(1).split('');
  let carry = true;
  for (let i = digits.length - 1; carry && i >= 0; i--) {
    const digit = BASE_62_DIGITS.indexOf(digits[i]) + 1;
    if (digit === BASE_62_DIGITS.length) digits[i] = '0';
    else {
      digits[i] = BASE_62_DIGITS[digit];
      carry = false;
    }
  }
  if (carry) {
    if (head === 'Z') return ZERO_KEY;
    if (head === 'z') return '';
    const nextHead = String.fromCharCode(head.charCodeAt(0) + 1);
    if (nextHead > 'a') digits.push('0');
    else digits.shift();
    return nextHead + digits.join('');
  }
  return head + digits.join('');
}

function decrementInt(value: string): string {
  validateInt(value);
  const head = value[0];
  const digits = value.slice(1).split('');
  let borrow = true;
  for (let i = digits.length - 1; borrow && i >= 0; i--) {
    const digit = BASE_62_DIGITS.indexOf(digits[i]) - 1;
    if (digit === -1) digits[i] = BASE_62_DIGITS[BASE_62_DIGITS.length - 1];
    else {
      digits[i] = BASE_62_DIGITS[digit];
      borrow = false;
    }
  }
  if (borrow) {
    if (head === 'a') return 'Z' + BASE_62_DIGITS[BASE_62_DIGITS.length - 1];
    if (head === 'A') return '';
    const nextHead = String.fromCharCode(head.charCodeAt(0) - 1);
    if (nextHead < 'Z') digits.push(BASE_62_DIGITS[BASE_62_DIGITS.length - 1]);
    else digits.shift();
    return nextHead + digits.join('');
  }
  return head + digits.join('');
}

function midpoint(a: string, b: string): string {
  if (b !== '') {
    let i = 0;
    for (; i < b.length; i++) {
      const c = a.length > i ? a[i] : '0';
      if (c !== b[i]) break;
    }
    if (i > 0) {
      if (i > a.length) return b.slice(0, i) + midpoint('', b.slice(i));
      return b.slice(0, i) + midpoint(a.slice(i), b.slice(i));
    }
  }
  const digitA = a !== '' ? BASE_62_DIGITS.indexOf(a[0]) : 0;
  const digitB = b !== '' ? BASE_62_DIGITS.indexOf(b[0]) : BASE_62_DIGITS.length;
  if (digitB - digitA > 1) {
    return BASE_62_DIGITS[Math.round(0.5 * (digitA + digitB))];
  }
  if (b.length > 1) return b.slice(0, 1);
  const restA = a.length > 0 ? a.slice(1) : '';
  return BASE_62_DIGITS[digitA] + midpoint(restA, '');
}

/** Bounded wire-compatible key; exhausted gaps throw, never emit >64 digits. */
export function generateKeyBetween(a: string | null, b: string | null): string {
  const key = generateUnboundedKeyBetween(a, b);
  if (key.length > MAX_RANK_SUFFIX_LENGTH) throw new RangeError('rank space exhausted');
  return key;
}

function generateUnboundedKeyBetween(a: string | null, b: string | null): string {
  const aa = a ?? '';
  const bb = b ?? '';
  if (aa !== '') validateOrderKey(aa);
  if (bb !== '') validateOrderKey(bb);
  if (aa !== '' && bb !== '' && aa >= bb) throw new Error(`${aa} >= ${bb}`);

  if (aa === '') {
    if (bb === '') return ZERO_KEY;
    const intB = getIntPart(bb);
    const fracB = bb.slice(intB.length);
    if (intB === SMALLEST_INT) return intB + midpoint('', fracB);
    if (intB < bb) return intB;
    const decremented = decrementInt(intB);
    if (decremented === '') throw new Error('range underflow');
    return decremented;
  }

  if (bb === '') {
    const intA = getIntPart(aa);
    const fracA = aa.slice(intA.length);
    const incremented = incrementInt(intA);
    if (incremented === '') return intA + midpoint(fracA, '');
    return incremented;
  }

  const intA = getIntPart(aa);
  const fracA = aa.slice(intA.length);
  const intB = getIntPart(bb);
  const fracB = bb.slice(intB.length);
  if (intA === intB) return intA + midpoint(fracA, fracB);
  const incremented = incrementInt(intA);
  if (incremented === '') throw new Error('range overflow');
  if (incremented < bb) return incremented;
  return intA + midpoint(fracA, '');
}

/** `n` evenly spaced base-62 keys strictly between `a` and `b` (null = open). */
export function generateNKeysBetween(a: string | null, b: string | null, n: number): string[] {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`generateNKeysBetween: n must be a non-negative integer, got ${n}`);
  }
  if (n === 0) return [];
  if (n === 1) return [generateKeyBetween(a, b)];

  const aa = a ?? '';
  const bb = b ?? '';
  if (bb === '') {
    const result: string[] = [];
    let current = generateKeyBetween(aa, null);
    result.push(current);
    for (let i = 1; i < n; i++) {
      current = generateKeyBetween(current, null);
      result.push(current);
    }
    return result;
  }
  if (aa === '') {
    const result: string[] = [];
    let current = generateKeyBetween(null, bb);
    result.push(current);
    for (let i = 1; i < n; i++) {
      current = generateKeyBetween(null, current);
      result.push(current);
    }
    return result.reverse();
  }

  const middle = Math.floor(n / 2);
  const center = generateKeyBetween(aa, bb);
  return [
    ...generateNKeysBetween(aa, center, middle),
    center,
    ...generateNKeysBetween(center, bb, n - middle - 1),
  ];
}

/**
 * A Rank strictly between `after` and `before` (null = open end of the
 * partition). Both bounds must share a partition; when both are null the
 * `fallbackPrefix` (default '1') is used.
 */
export function rankBetween(
  after: Rank | null,
  before: Rank | null,
  fallbackPrefix: RankPrefix = '1',
): Rank {
  if (after !== null && before !== null && rankPrefix(after) !== rankPrefix(before)) {
    throw new Error('rankBetween: bounds must share the same partition');
  }
  const prefix = after !== null ? rankPrefix(after) : before !== null ? rankPrefix(before) : fallbackPrefix;
  const a = after !== null ? rankSuffix(after) : null;
  const b = before !== null ? rankSuffix(before) : null;
  return `${prefix === '0' ? FRAME_RANK_PREFIX : OBJECT_RANK_PREFIX}${generateKeyBetween(a, b)}`;
}

/** `n` distinct ranks strictly between `after` and `before`, ascending. */
export function rankBetweenMany(
  after: Rank | null,
  before: Rank | null,
  n: number,
  fallbackPrefix: RankPrefix = '1',
): Rank[] {
  if (after !== null && before !== null && rankPrefix(after) !== rankPrefix(before)) {
    throw new Error('rankBetweenMany: bounds must share the same partition');
  }
  const prefix = after !== null ? rankPrefix(after) : before !== null ? rankPrefix(before) : fallbackPrefix;
  const a = after !== null ? rankSuffix(after) : null;
  const b = before !== null ? rankSuffix(before) : null;
  return generateNKeysBetween(a, b, n).map((suffix) => `${prefix}:${suffix}`);
}

function reorderSelection(
  selection: readonly RankedId[],
  ordered: readonly RankedId[],
  toFront: boolean,
): Rank[] {
  const result: Rank[] = new Array(selection.length);
  const minRank: Partial<Record<RankPrefix, Rank>> = {};
  const maxRank: Partial<Record<RankPrefix, Rank>> = {};

  for (const item of ordered) {
    const prefix = rankPrefix(item.rank);
    const currentMin = minRank[prefix];
    const currentMax = maxRank[prefix];
    if (currentMin === undefined || compareRank(item.rank, currentMin) < 0) minRank[prefix] = item.rank;
    if (currentMax === undefined || compareRank(item.rank, currentMax) > 0) maxRank[prefix] = item.rank;
  }

  for (const prefix of RANK_PREFIXES) {
    const indices: number[] = [];
    for (let i = 0; i < selection.length; i++) {
      if (rankPrefix(selection[i].rank) === prefix) indices.push(i);
    }
    if (indices.length === 0) continue;

    indices.sort((a, b) => compareRanked(selection[a], selection[b]));

    const max = maxRank[prefix];
    const min = minRank[prefix];
    const keys = toFront
      ? generateNKeysBetween(max !== undefined ? rankSuffix(max) : null, null, indices.length)
      : generateNKeysBetween(null, min !== undefined ? rankSuffix(min) : null, indices.length);

    indices.forEach((index, k) => {
      result[index] = `${prefix}:${keys[k]}`;
    });
  }
  return result;
}

/**
 * New ranks moving `selection` to the front of their own partition (frames
 * stay behind non-frames), preserving the selection's relative order.
 * `ordered` is the full board in any order; only its per-partition min/max
 * ranks are used. The result is aligned with `selection`.
 */
export function bringToFront(selection: readonly RankedId[], ordered: readonly RankedId[]): Rank[] {
  return reorderSelection(selection, ordered, true);
}

/** New ranks moving `selection` to the back of their own partition. */
export function sendToBack(selection: readonly RankedId[], ordered: readonly RankedId[]): Rank[] {
  return reorderSelection(selection, ordered, false);
}
