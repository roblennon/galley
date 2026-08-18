import type { Range } from './types.js';

export interface Edit {
  s: number;
  e: number;
  L: number;
  replace: string;
  index: number;
  attributed: Set<string>;
}

/** Sum of length deltas for edits ending at or before `p` (original coords). */
export function shiftPoint(p: number, edits: Edit[]): number {
  let delta = 0;
  for (const ed of edits) {
    if (ed.e <= p) delta += ed.L - (ed.e - ed.s);
  }
  return p + delta;
}

/** Map a point through edits, clamping points inside a replaced region to the
 * end of the replacement. */
export function clampPoint(p: number, edits: Edit[]): number {
  for (const ed of edits) {
    if (ed.s < p && p < ed.e) {
      return shiftPoint(ed.s, edits) + ed.L;
    }
  }
  return shiftPoint(p, edits);
}

export type Transformed =
  | { destroyed: Edit }
  | { range: Range; modified: boolean };

/** Anchor transformation per SPEC §10.1. `edits` are disjoint, ascending, in
 * original clean-text coordinates. */
export function transformRange(r: Range, edits: Edit[]): Transformed {
  let { start: a, end: b } = r;
  if (a === b) {
    for (const ed of edits) {
      if (ed.s < a && a < ed.e) return { destroyed: ed };
    }
    const p = shiftPoint(a, edits);
    return { range: { start: p, end: p }, modified: false };
  }
  for (const ed of edits) {
    if (ed.s <= a && b <= ed.e) return { destroyed: ed };
  }
  let modified = false;
  let clippedBy: Edit | null = null;
  for (const ed of edits) {
    if (a > ed.s && a < ed.e) {
      a = ed.e;
      modified = true;
      clippedBy = clippedBy ?? ed;
    }
    if (b > ed.s && b < ed.e) {
      b = ed.s;
      modified = true;
      clippedBy = clippedBy ?? ed;
    }
  }
  if (a >= b) return { destroyed: clippedBy ?? edits[0]! };
  return {
    range: { start: shiftPoint(a, edits), end: shiftPoint(b, edits) },
    modified,
  };
}

