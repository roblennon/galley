import type { Range } from './types.js';

/**
 * Segment clean text into blocks: maximal runs of non-blank lines. Ranges are
 * code points and exclude the trailing line terminator. Blank = only
 * spaces/tabs.
 */
export function blockRanges(cleanText: string): Range[] {
  const ranges: Range[] = [];
  let offset = 0; // code points
  let current: Range | null = null;
  for (const line of cleanText.split('\n')) {
    let len = 0;
    for (const _ of line) len++;
    const blank = /^[ \t]*$/.test(line);
    if (blank) {
      if (current) {
        ranges.push(current);
        current = null;
      }
    } else if (current) {
      current.end = offset + len;
    } else {
      current = { start: offset, end: offset + len };
    }
    offset += len + 1; // '\n'
  }
  if (current) ranges.push(current);
  return ranges;
}

/** The block containing `offset`, or null if it falls between blocks. */
export function blockContaining(blocks: Range[], offset: number): Range | null {
  for (const b of blocks) {
    if (offset >= b.start && offset <= b.end) return b;
  }
  return null;
}

/** The nearest block at or before `offset` (for block-comment attachment). */
export function blockAtOrBefore(blocks: Range[], offset: number): Range | null {
  let best: Range | null = null;
  for (const b of blocks) {
    if (b.start <= offset && (best === null || b.start > best.start)) best = b;
  }
  return best;
}
