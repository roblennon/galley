import { parse } from './parse.js';
import { recompose } from './recompose.js';
import { blockRanges, blockAtOrBefore, blockContaining } from './blocks.js';
import { cpLength } from './unicode.js';
import { transformRange, type Edit } from './transform.js';
import type { Comment } from './types.js';

export interface ResolveMarksOptions {
  action: 'accept' | 'reject';
  /** Restrict to the single edit mark at this index (parse order). */
  only?: number;
}

/**
 * Accept or reject edit marks (SPEC §6.3). Accepting replaces each mark with
 * its proposed text and transforms other anchors through the change;
 * rejecting keeps the original text. Either way the mark (and any id-carrier
 * comment) leaves the document.
 */
export function resolveEditMarks(
  text: string,
  options: ResolveMarksOptions,
): { text: string; resolved: number } {
  const parsed = parse(text);
  const targets = parsed.editMarks.filter(
    (_, i) => options.only === undefined || i === options.only,
  );
  if (targets.length === 0) return { text, resolved: 0 };
  const survivors = parsed.editMarks.filter((m) => !targets.includes(m));
  const carrierIds = new Set(
    targets.map((m) => m.commentId).filter((id): id is string => id !== null),
  );

  const edits: Edit[] =
    options.action === 'accept'
      ? targets
          .map((m, i) => ({
            s: m.range.start,
            e: m.range.end,
            L: cpLength(m.proposed),
            replace: m.proposed,
            index: i,
            attributed: new Set<string>(),
          }))
          .sort((a, b) => a.s - b.s)
      : [];

  let newClean = parsed.cleanText;
  for (let k = edits.length - 1; k >= 0; k--) {
    const ed = edits[k]!;
    const chars = [...newClean];
    newClean =
      chars.slice(0, ed.s).join('') + ed.replace + chars.slice(ed.e).join('');
  }
  const newBlocks = blockRanges(newClean);
  const newLen = cpLength(newClean);

  const comments: Comment[] = [];
  for (const c of parsed.comments) {
    if (c.carrier && c.id !== null && carrierIds.has(c.id)) continue;
    if (c.scope === 'document') {
      const { source: _s, ...rest } = c;
      comments.push({ ...rest, anchor: { start: 0, end: newLen } });
      continue;
    }
    const t = transformRange(c.anchor, edits);
    const { source: _s2, ...rest } = c;
    if ('destroyed' in t) {
      const block =
        blockAtOrBefore(newBlocks, t.destroyed.s) ?? { start: 0, end: 0 };
      comments.push({
        ...rest,
        scope: 'block',
        anchor: { ...block },
        flags: [...c.flags.filter((f) => f !== 'anchor-lost'), 'anchor-lost'],
      });
      continue;
    }
    if (c.scope === 'block') {
      const pos = c.placement?.pos ?? c.anchor.end;
      const t2 = transformRange({ start: pos, end: pos }, edits);
      const p = 'destroyed' in t2 ? t2.destroyed.s : t2.range.start;
      const block = blockAtOrBefore(newBlocks, p) ?? { start: 0, end: 0 };
      const out: Comment = { ...rest, anchor: { ...block } };
      if (c.placement) out.placement = { ...c.placement, pos: p };
      comments.push(out);
      continue;
    }
    comments.push({ ...rest, anchor: t.range, flags: [...c.flags] });
  }

  const marks = survivors.map((m) => {
    const t = transformRange(m.range, edits);
    const { source: _s, ...rest } = m;
    return 'destroyed' in t ? null : { ...rest, range: t.range };
  });

  const { text: out } = recompose({
    cleanText: newClean,
    frontmatter: parsed.frontmatter,
    comments,
    editMarks: marks.filter((m): m is NonNullable<typeof m> => m !== null),
  });
  return { text: out, resolved: targets.length };
}

/** The publishable final text: every edit mark accepted, every comment and
 * mark stripped. */
export function exportFinalText(text: string): { text: string } {
  const accepted = resolveEditMarks(text, { action: 'accept' });
  return { text: parse(accepted.text).cleanText };
}
