import { describe, expect, it } from 'vitest';
import { exportFilename, formatExportDate, sanitizeFileNamePart } from './filename';

describe('sanitizeFileNamePart', () => {
  it('replaces separators and punctuation with single hyphens', () => {
    expect(sanitizeFileNamePart('My Board!')).toBe('My-Board');
    expect(sanitizeFileNamePart('  design   board  ')).toBe('design-board');
    expect(sanitizeFileNamePart('a//b\\c')).toBe('a-b-c');
  });

  it('keeps Turkish letters and digits', () => {
    expect(sanitizeFileNamePart('ğşı çöü İ 42')).toBe('ğşı-çöü-İ-42');
  });

  it('returns an empty string when nothing usable remains', () => {
    expect(sanitizeFileNamePart('///')).toBe('');
    expect(sanitizeFileNamePart('')).toBe('');
  });
});

describe('formatExportDate', () => {
  it('formats a local date as YYYY-MM-DD', () => {
    expect(formatExportDate(new Date(2025, 0, 5))).toBe('2025-01-05');
    expect(formatExportDate(new Date(2025, 11, 31))).toBe('2025-12-31');
  });
});

describe('exportFilename', () => {
  it('builds board-<name>-<date>.png', () => {
    expect(exportFilename('Design', new Date(2025, 0, 5))).toBe('board-Design-2025-01-05.png');
  });

  it('omits the name segment when it is blank', () => {
    expect(exportFilename('', new Date(2025, 0, 5))).toBe('board-2025-01-05.png');
    expect(exportFilename('///', new Date(2025, 0, 5))).toBe('board-2025-01-05.png');
  });
});
