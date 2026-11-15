import { describe, expect, it } from 'vitest';
import { wrapText } from './wrap';

const len = (text: string) => text.length;

describe('wrapText', () => {
  it('wraps on spaces to the measured width', () => {
    expect(wrapText('hello world', 5, len)).toEqual(['hello', 'world']);
    expect(wrapText('a bb ccc', 4, len)).toEqual(['a bb', 'ccc']);
  });

  it('breaks words wider than the line (break-word)', () => {
    expect(wrapText('abcdef', 3, len)).toEqual(['abc', 'def']);
    expect(wrapText('ab cd', 2, len)).toEqual(['ab', 'cd']);
  });

  it('preserves newlines, empty lines and a trailing newline', () => {
    expect(wrapText('a\nb', 10, len)).toEqual(['a', 'b']);
    expect(wrapText('a\n\nb', 10, len)).toEqual(['a', '', 'b']);
    expect(wrapText('a\n', 10, len)).toEqual(['a', '']);
  });

  it('keeps leading whitespace with a long word on the first line', () => {
    expect(wrapText('  abcdef', 3, len)).toEqual(['  a', 'bcd', 'ef']);
  });

  it('returns a single empty line for empty input', () => {
    expect(wrapText('', 10, len)).toEqual(['']);
  });
});
