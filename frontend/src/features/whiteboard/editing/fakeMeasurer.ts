import type { TextMeasurer } from './measure';

/** Every character is 0.5em wide; explicit newlines break lines. */
export const fakeMeasurer: TextMeasurer = ({ text, width, fontSize, lineHeight }) => {
  const perLine = Math.max(Math.floor(width / (fontSize * 0.5)), 1);
  const lines = text.split('\n').reduce((sum, line) => sum + Math.max(Math.ceil(line.length / perLine), 1), 0);
  return lines * fontSize * lineHeight;
};
