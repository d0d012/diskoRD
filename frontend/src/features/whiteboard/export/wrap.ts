export type TextMeasure = (text: string) => number;

interface Token {
  readonly text: string;
  readonly space: boolean;
}

function tokenize(paragraph: string): Token[] {
  const tokens: Token[] = [];
  const matches = paragraph.match(/\S+|\s+/g);
  if (!matches) return tokens;
  for (const text of matches) tokens.push({ text, space: /^\s+$/.test(text) });
  return tokens;
}

/**
 * Breaks a single line that is already wider than `width`. Leading whitespace
 * stays on the head line (pre-wrap), and the over-long word is broken at the
 * widest prefix that still fits. If even one character cannot fit, it is still
 * emitted alone so every line always makes progress.
 */
function breakOversizedLine(line: string, width: number, measure: TextMeasure): { head: string; tail: string } {
  const leadingMatch = /^\s*/.exec(line);
  const leading = leadingMatch ? leadingMatch[0] : '';
  const word = line.slice(leading.length);
  let head = leading;
  let consumed = 0;
  for (let i = 1; i <= word.length; i++) {
    const candidate = leading + word.slice(0, i);
    if (measure(candidate) <= width) {
      head = candidate;
      consumed = i;
    } else {
      break;
    }
  }
  if (consumed === 0 && word.length > 0) {
    // A single character is wider than the line: emit it rather than looping.
    return { head: leading + word.charAt(0), tail: word.slice(1) };
  }
  return { head, tail: word.slice(consumed) };
}

/**
 * Mirrors the board's `white-space: pre-wrap` + `overflow-wrap: break-word`
 * text layout: newlines are preserved (including empty and trailing lines),
 * wrapping prefers spaces, and words wider than the line break mid-word.
 * `measure` returns the width of a run in the same units as `width`.
 */
export function wrapText(text: string, width: number, measure: TextMeasure): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (paragraph === '') {
      lines.push('');
      continue;
    }
    let line = '';
    for (const token of tokenize(paragraph)) {
      if (token.space) {
        // Spaces never force a break on their own; a trailing run just ends up
        // at the end of the line (invisible), matching pre-wrap.
        line += token.text;
        continue;
      }
      const candidate = line + token.text;
      if (measure(candidate) <= width || line.trim() === '') {
        line = candidate;
      } else {
        lines.push(line.trimEnd());
        line = token.text;
      }
      while (measure(line) > width) {
        const split = breakOversizedLine(line, width, measure);
        lines.push(split.head);
        line = split.tail;
        if (line === '') break;
      }
    }
    if (line !== '') lines.push(line.trimEnd());
  }
  return lines;
}
