/** Maximum length of the sanitized name segment inside an export filename. */
export const EXPORT_NAME_MAX_LENGTH = 64;

/**
 * Turns a channel/frame name into a safe, single filename segment. Unicode
 * letters and digits are kept (Turkish glyphs included); anything else becomes
 * a hyphen. Empty after cleaning, so callers can fall back to a bare board name.
 */
export function sanitizeFileNamePart(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, EXPORT_NAME_MAX_LENGTH);
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** Local calendar date, `YYYY-MM-DD`. */
export function formatExportDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * `board-<channel or frame name>-<date>.png`. An empty name degrades to
 * `board-<date>.png` instead of a double hyphen.
 */
export function exportFilename(name: string, date: Date = new Date()): string {
  const part = sanitizeFileNamePart(name);
  const datePart = formatExportDate(date);
  return part ? `board-${part}-${datePart}.png` : `board-${datePart}.png`;
}
