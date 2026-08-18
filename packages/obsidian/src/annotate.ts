import {
  addComment,
  type AddCommentOptions,
} from '@galley/core';
export { computeTarget } from '@galley/codemirror';
export type { Target } from '@galley/codemirror';

/** The slice of Obsidian's Editor this module needs; kept minimal so the
 * headless smoke harness can drive it with a plain object. */
export interface EditorLike {
  getValue(): string;
  setValue(text: string): void;
  posToOffset(pos: { line: number; ch: number }): number;
  offsetToPos(offset: number): { line: number; ch: number };
  getCursor(which: 'from' | 'to'): { line: number; ch: number };
  setCursor(pos: { line: number; ch: number }): void;
}

/** Insert a comment and update the editor, restoring the cursor to the end
 * of the inserted syntax. Returns core's error message on rejection. */
export function insertComment(
  editor: EditorLike,
  at: AddCommentOptions['at'],
  body: string,
): { ok: true; id: string } | { ok: false; error: string } {
  const before = editor.getValue();
  let result: { text: string; id: string };
  try {
    result = addComment(before, { body, at });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const after = result.text;
  editor.setValue(after);
  // Span comments insert in two places ('{==' and '==}{>>…<<}'), so anchor
  // the cursor to the end of the last changed region via the common suffix.
  let firstDiff = 0;
  const max = Math.min(before.length, after.length);
  while (firstDiff < max && before[firstDiff] === after[firstDiff]) firstDiff++;
  let suffix = 0;
  while (
    suffix < max - firstDiff &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) {
    suffix++;
  }
  editor.setCursor(editor.offsetToPos(after.length - suffix));
  return { ok: true, id: result.id };
}
