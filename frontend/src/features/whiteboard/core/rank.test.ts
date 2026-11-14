import { describe, expect, it } from 'vitest';
import { MAX_RANK_SUFFIX_LENGTH, RANK_ALPHABET, RANK_PATTERN } from '../contract/limits';
import {
  bringToFront, compareRank, compareRanked, generateKeyBetween, generateNKeysBetween,
  rankBetween, rankBetweenMany, sendToBack,
} from './rank';

describe('generateKeyBetween', () => {
  it('returns the documented first/prepend/append/midpoint keys', () => {
    expect(generateKeyBetween(null, null)).toBe('a0');
    expect(generateKeyBetween(null, 'a0')).toBe('Zz');
    expect(generateKeyBetween('a0', null)).toBe('a1');
    expect(generateKeyBetween('a0', 'a1')).toBe('a0V');
  });

  it('keeps a sequence strictly ordered and unique under repeated insertion', () => {
    const list = ['a0'];
    for (let i = 0; i < 5; i++) list.push(generateKeyBetween(list[list.length - 1], null));
    for (let i = 0; i < 5; i++) list.unshift(generateKeyBetween(null, list[0]));
    for (let round = 0; round < 4; round++) {
      for (let i = 0; i < list.length - 1; i += 2) {
        list.splice(i + 1, 0, generateKeyBetween(list[i], list[i + 1]));
      }
    }
    for (let i = 0; i < list.length - 1; i++) {
      expect(list[i] < list[i + 1]).toBe(true);
    }
  });

  it('emits only bounded backend-compatible ranks, or reports exhaustion before emitting one', () => {
    let upper = 'a1';
    let exhausted = false;
    for (let i = 0; i < 1_000; i++) {
      try {
        upper = generateKeyBetween('a0', upper);
        expect(upper.length).toBeLessThanOrEqual(MAX_RANK_SUFFIX_LENGTH);
        expect([...upper].every(char => RANK_ALPHABET.includes(char))).toBe(true);
        expect(new RegExp(RANK_PATTERN).test(`1:${upper}`)).toBe(true);
      } catch (error) {
        expect(error).toBeInstanceOf(RangeError);
        exhausted = true;
        break;
      }
    }
    expect(exhausted).toBe(true);
    expect(generateNKeysBetween(null, null, 5_000).every(key => new RegExp(RANK_PATTERN).test(`0:${key}`))).toBe(true);
  });

  it('rejects noncanonical suffixes accepted by the old backend alphabet-only regex', () => {
    for (const suffix of ['a', '9x', 'a0!', 'a0V0', `a0${'V'.repeat(63)}`, `A${'0'.repeat(26)}`]) {
      expect(() => generateKeyBetween(suffix, null)).toThrow();
      expect(() => rankBetween(`1:${suffix}`, null)).toThrow();
    }
    for (const rank of ['2:a0', '1::a0', 'a0']) expect(() => rankBetween(rank, null)).toThrow();
  });

  it('rejects inverted or equal bounds', () => {
    expect(() => generateKeyBetween('a1', 'a0')).toThrow();
    expect(() => generateKeyBetween('a0', 'a0')).toThrow();
  });
});

describe('generateNKeysBetween', () => {
  it('returns the documented even spacing', () => {
    expect(generateNKeysBetween(null, null, 2)).toEqual(['a0', 'a1']);
    expect(generateNKeysBetween(null, 'a0', 2)).toEqual(['Zy', 'Zz']);
    expect(generateNKeysBetween('a0', null, 2)).toEqual(['a1', 'a2']);
    expect(generateNKeysBetween('a0', 'a1', 2)).toEqual(['a0G', 'a0V']);
  });

  it('returns n ascending keys strictly between the bounds', () => {
    const cases: Array<[string | null, string | null, number]> = [
      [null, null, 0], [null, null, 5], ['a0', null, 4], [null, 'a0', 4], ['a0', 'a1', 3],
    ];
    for (const [a, b, n] of cases) {
      const keys = generateNKeysBetween(a, b, n);
      expect(keys).toHaveLength(n);
      let previous: string | null = a;
      for (const key of keys) {
        if (previous !== null) expect(previous < key).toBe(true);
        previous = key;
      }
      if (b !== null) expect(previous! < b).toBe(true);
    }
  });

  it('rejects a non-integer or negative n', () => {
    expect(() => generateNKeysBetween(null, null, -1)).toThrow();
    expect(() => generateNKeysBetween(null, null, 1.5)).toThrow();
  });
});

describe('rankBetween / rankBetweenMany', () => {
  it('mints full ranks with the right prefix', () => {
    expect(rankBetween(null, null)).toBe('1:a0');
    expect(rankBetween(null, '1:a0')).toBe('1:Zz');
    expect(rankBetween('1:a0', null)).toBe('1:a1');
    expect(rankBetween('1:a0', '1:a1')).toBe('1:a0V');
    expect(rankBetween('0:a0', null)).toBe('0:a1');
    expect(rankBetweenMany(null, null, 3, '0')).toEqual(['0:a0', '0:a1', '0:a2']);
  });

  it('rejects bounds across the frame partition', () => {
    expect(() => rankBetween('0:a0', '1:a1')).toThrow();
    expect(() => rankBetweenMany('0:a0', '1:a1', 2)).toThrow();
  });
});

describe('compareRank / compareRanked', () => {
  it('orders frames before everything else, then by suffix', () => {
    expect(compareRank('0:zzz', '1:a0')).toBe(-1);
    expect(compareRank('1:a0', '1:a1')).toBe(-1);
    expect(compareRank('1:a1', '1:a0')).toBe(1);
    expect(compareRank('1:a0', '1:a0')).toBe(0);
  });

  it('breaks ties by id in code-unit order', () => {
    expect(compareRanked({ id: 'a', rank: '1:a0' }, { id: 'b', rank: '1:a0' })).toBe(-1);
    expect(compareRanked({ id: 'b', rank: '1:a0' }, { id: 'a', rank: '1:a1' })).toBe(-1);
  });
});

describe('bringToFront / sendToBack', () => {
  const a = { id: 'a', rank: '1:a0' };
  const b = { id: 'b', rank: '1:a1' };
  const c = { id: 'c', rank: '1:a2' };
  const d = { id: 'd', rank: '1:a3' };
  const ordered = [a, b, c, d];

  it('moves a selection to the front preserving relative order', () => {
    const [newB, newC] = bringToFront([b, c], ordered);
    expect(compareRank(newB, newC)).toBe(-1);
    expect(compareRank('1:a3', newB)).toBe(-1);
    expect(compareRank('1:a3', newC)).toBe(-1);
  });

  it('moves a selection to the back preserving relative order', () => {
    const [newB, newC] = sendToBack([b, c], ordered);
    expect(compareRank(newB, newC)).toBe(-1);
    expect(compareRank(newB, '1:a0')).toBe(-1);
    expect(compareRank(newC, '1:a0')).toBe(-1);
  });

  it('never crosses the frame partition', () => {
    const f1 = { id: 'f1', rank: '0:a0' };
    const f2 = { id: 'f2', rank: '0:a1' };
    const s1 = { id: 's1', rank: '1:a0' };
    const s2 = { id: 's2', rank: '1:a1' };
    const result = bringToFront([f1, s1], [f1, f2, s1, s2]);
    expect(result).toEqual(['0:a2', '1:a2']);
    expect(compareRank(result[0], result[1])).toBe(-1);
  });

  it('handles an empty selection', () => {
    expect(bringToFront([], ordered)).toEqual([]);
    expect(sendToBack([], ordered)).toEqual([]);
  });
});
