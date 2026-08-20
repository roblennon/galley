import { parse } from '@galleymd/core';

export interface DecoPlanItem {
  /**
   * Raw UTF-16 offsets into the normalized annotated text. The editor
   * document must equal core's normalized text (LF line endings, no BOM) or
   * these ranges silently decorate the wrong characters.
   */
  from: number;
  to: number;
  kind: 'hide' | 'anchor' | 'chip' | 'note' | 'edit';
  id?: string | null;
  body?: string;
  scope?: string;
  editKind?: 'insertion' | 'deletion' | 'substitution';
  original?: string;
  proposed?: string;
}

/**
 * Build a DOM-independent decoration plan for the current selections.
 *
 * Any annotation touched by a selection or cursor is left undecorated so its
 * raw syntax shows — the Live Preview behavior that keeps hidden markup from
 * making cursor movement and deletion surprising.
 */
export function planDecorations(
  text: string,
  selections: { from: number; to: number }[],
): DecoPlanItem[] {
  const parsed = parse(text);
  const touched = (from: number, to: number): boolean =>
    selections.some((selection) => {
      if (selection.from === selection.to) {
        return from < selection.from && selection.from < to;
      }
      return selection.from < to && from < selection.to;
    });
  const plan: DecoPlanItem[] = [];

  for (const comment of parsed.comments) {
    const source = comment.source;
    if (!source || touched(source.extent.start, source.extent.end)) continue;
    if (comment.scope === 'span' && source.open && source.anchorRaw && source.tail) {
      plan.push({ from: source.open.start, to: source.open.end, kind: 'hide' });
      plan.push({
        from: source.anchorRaw.start,
        to: source.anchorRaw.end,
        kind: 'anchor',
      });
      plan.push({
        from: source.tail.start,
        to: source.tail.end,
        kind: 'chip',
        id: comment.id,
        body: comment.body,
      });
    } else if (comment.scope === 'point' || comment.carrier) {
      plan.push({
        from: source.extent.start,
        to: source.extent.end,
        kind: 'chip',
        id: comment.id,
        body: comment.body,
      });
    } else {
      plan.push({
        from: source.extent.start,
        to: source.extent.end,
        kind: 'note',
        id: comment.id,
        body: comment.body,
        scope: comment.scope,
      });
    }
  }
  for (const mark of parsed.editMarks) {
    if (!mark.source || touched(mark.source.start, mark.source.end)) continue;
    plan.push({
      from: mark.source.start,
      to: mark.source.end,
      kind: 'edit',
      editKind: mark.kind,
      original: mark.original,
      proposed: mark.proposed,
    });
  }
  return plan.sort((a, b) => a.from - b.from || a.to - b.to);
}
