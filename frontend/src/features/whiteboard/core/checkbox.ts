export interface ParsedCheckboxLine {
  readonly checked: boolean;
  /** Leading whitespace and optional bullet before `[ ]`, e.g. `"- "` or `""`. */
  readonly bullet: string;
  /** Text after `]` (trimmed of the single leading space after `]`). */
  readonly label: string;
}

const CHECKBOX_LINE_RE = /^([ \t]*(?:[-*][ \t]+)?)\[([ xX])\](?:[ \t]+(.*))?$/;

export function parseCheckboxLine(line: string): ParsedCheckboxLine | null {
  const match = CHECKBOX_LINE_RE.exec(line);
  if (!match) return null;
  return {
    bullet: match[1],
    checked: match[2].toLowerCase() === 'x',
    label: match[3] ?? '',
  };
}

export function hasCheckboxLines(text: string): boolean {
  if (!text.includes('[')) return false;
  return text.split('\n').some(line => CHECKBOX_LINE_RE.test(line));
}

/**
 * Toggles the checkbox on `lineIndex` between `[ ]` and `[x]`.
 * Returns the updated full text, or `null` if `lineIndex` is not a checkbox line.
 */
export function toggleCheckboxLine(text: string, lineIndex: number): string | null {
  const lines = text.split('\n');
  if (lineIndex < 0 || lineIndex >= lines.length) return null;
  const parsed = parseCheckboxLine(lines[lineIndex]);
  if (!parsed) return null;
  const mark = parsed.checked ? ' ' : 'x';
  const suffix = parsed.label.length > 0 ? ` ${parsed.label}` : '';
  lines[lineIndex] = `${parsed.bullet}[${mark}]${suffix}`;
  return lines.join('\n');
}

/**
 * Smart Enter continuation for checkbox lines in the text editor:
 * - On an empty checkbox line (`- [ ] `), Enter exits the list by clearing the prefix.
 * - On a non-empty checkbox line (`- [ ] task`), Enter inserts a newline with a fresh unchecked prefix.
 */
export function continueCheckboxOnEnter(
  text: string,
  selectionStart: number,
  selectionEnd: number,
): { readonly text: string; readonly caret: number } | null {
  if (selectionStart !== selectionEnd) return null;
  const lineStart = selectionStart === 0 ? 0 : text.lastIndexOf('\n', selectionStart - 1) + 1;
  const nextNewline = text.indexOf('\n', selectionStart);
  const lineEnd = nextNewline === -1 ? text.length : nextNewline;
  const line = text.slice(lineStart, lineEnd);
  const parsed = parseCheckboxLine(line);
  if (!parsed) return null;
  const prefixLength = parsed.bullet.length + 3 + (line.slice(parsed.bullet.length + 3).startsWith(' ') ? 1 : 0);
  if (selectionStart < lineStart + prefixLength) return null;
  if (parsed.label.trim() === '') {
    const nextText = text.slice(0, lineStart) + text.slice(lineEnd);
    return { text: nextText, caret: lineStart };
  }
  const insert = `\n${parsed.bullet}[ ] `;
  const nextText = text.slice(0, selectionStart) + insert + text.slice(selectionEnd);
  return { text: nextText, caret: selectionStart + insert.length };
}
