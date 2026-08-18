import type { Issue } from './types.js';

export type TokenKind =
  | 'highlight'
  | 'comment'
  | 'insertion'
  | 'deletion'
  | 'substitution';

export interface RawToken {
  kind: TokenKind;
  /** UTF-16 offsets into the scanned string, inclusive of delimiters. */
  start: number;
  end: number;
  /** Text between the delimiters. */
  content: string;
}

const MARKS: { opener: string; kind: TokenKind; closer: string }[] = [
  { opener: '{==', kind: 'highlight', closer: '==}' },
  { opener: '{>>', kind: 'comment', closer: '<<}' },
  { opener: '{++', kind: 'insertion', closer: '++}' },
  { opener: '{--', kind: 'deletion', closer: '--}' },
  { opener: '{~~', kind: 'substitution', closer: '~~}' },
];

/**
 * Linear scan for CriticMarkup marks. No nesting (SPEC §6.2): each mark runs
 * to the first occurrence of its closer. Unclosed marks are reported and left
 * as prose. `reportIndex` converts a UTF-16 offset in `text` to the issue
 * index recorded on emitted issues.
 */
export function scan(
  text: string,
  issues: Issue[],
  reportIndex: (utf16: number) => number,
): RawToken[] {
  const tokens: RawToken[] = [];
  let i = 0;
  while (i < text.length) {
    const idx = text.indexOf('{', i);
    if (idx < 0) break;
    const mark = MARKS.find((m) => text.startsWith(m.opener, idx));
    if (!mark) {
      i = idx + 1;
      continue;
    }
    const close = text.indexOf(mark.closer, idx + 3);
    if (close < 0) {
      issues.push({
        severity: 'error',
        code: 'unclosed-mark',
        message: `Unclosed ${mark.kind} mark; treated as prose`,
        index: reportIndex(idx),
      });
      i = idx + 3;
      continue;
    }
    tokens.push({
      kind: mark.kind,
      start: idx,
      end: close + 3,
      content: text.slice(idx + 3, close),
    });
    i = close + 3;
  }
  return tokens;
}
