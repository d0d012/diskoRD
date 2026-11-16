import { describe, expect, it } from 'vitest';
import { clipboardHtml, isBoardPaste, type BoardClipboard } from './clipboard';

const clip: BoardClipboard = { objects: [], text: 'Line one\nLine two', pastes: 0, token: 'tok-1' };

describe('board clipboard recognition', () => {
  it('recognises its own copy through the html marker even when the plain text changed', () => {
    expect(isBoardPaste(clip, 'something the OS rewrote', clipboardHtml(clip))).toBe(true);
  });

  it('recognises CRLF / trimmed rewrites of the plain text without html', () => {
    expect(isBoardPaste(clip, 'Line one\r\nLine two\r\n', '')).toBe(true);
    expect(isBoardPaste(clip, '  Line one\nLine two  ', '')).toBe(true);
  });

  it('treats other text or another copy as a plain text paste', () => {
    expect(isBoardPaste(clip, 'hello', '')).toBe(false);
    expect(isBoardPaste(clip, 'hello', clipboardHtml({ ...clip, token: 'other' }))).toBe(false);
  });

  it('escapes the readable html copy', () => {
    expect(clipboardHtml({ ...clip, text: '<b>&"' })).toContain('&lt;b&gt;&amp;&quot;');
  });
});
