import { cpLength } from './unicode.js';
import type { Comment, EditMark, ParseResult } from './types.js';

interface Emission {
  pos: number; // code points
  /** 0 = close, 1 = block/document line, 2 = point/zero-width insert,
   * 3 = open. Note lines sort before point inserts and opens: a note whose
   * position coincides with an inline mark belongs to the preceding block —
   * emitting it later would glue marks onto its line and reclassify scopes
   * on reparse. */
  prio: number;
  /** For closes: the construct's start; for opens: its end (nesting order). */
  mStart?: number;
  mEnd?: number;
  /** Raw source position of the construct — ties at equal (pos, prio) break
   * by original document order, not by comments-before-edit-marks push
   * order. Synthetic constructs (no source) sort last. */
  src: number;
  ord: number;
  text: string;
}

function serializeComment(c: Comment): string {
  if (c.id === null) return `{>>${c.body}<<}`;
  const sep = c.bodySep ?? (c.body !== '' ? ' ' : '');
  return `{>>[${c.id}]${sep}${c.body}<<}`;
}

/**
 * Reassemble an annotated document from clean text plus the annotation layer.
 * For results produced by `parse`, this is a byte-exact round trip (SPEC §7).
 * Hand-built comments without `placement` fall back to conventional spacing.
 */
export function recompose(
  result: Pick<
    ParseResult,
    'cleanText' | 'frontmatter' | 'comments' | 'editMarks'
  > &
    Partial<Pick<ParseResult, 'bom'>>,
): { text: string } {
  const clean = result.cleanText;
  const cleanLen = cpLength(clean);

  // SPEC §6.1: a tool MUST refuse to emit a mark that would parse differently
  // than intended, rather than write it and lose the difference. addComment
  // enforces this on the authoring path; recompose is the other way a comment
  // reaches a document, and it validated nothing (GAL-REV-007).
  for (const c of result.comments) {
    if (c.body.includes('<<}')) {
      throw new Error(
        `comment ${c.id === null ? '(anonymous)' : `[${c.id}]`} body contains the closing delimiter '<<}' and cannot be represented (SPEC §6.1)`,
      );
    }
    if (c.id !== null && !/^[A-Za-z0-9]{1,8}$/.test(c.id)) {
      throw new Error(
        `comment id '${c.id}' is not a valid identifier; it would be emitted as body text and the comment would stop being addressable (SPEC §5.1)`,
      );
    }
    if (c.placement && (c.placement.pos < 0 || c.placement.pos > cleanLen)) {
      throw new Error(
        `comment ${c.id === null ? '(anonymous)' : `[${c.id}]`} placement position ${c.placement.pos} is out of range for clean text of length ${cleanLen}`,
      );
    }
    if (
      c.anchor.start < 0 ||
      c.anchor.end < c.anchor.start ||
      c.anchor.end > cleanLen
    ) {
      throw new Error(
        `comment ${c.id === null ? '(anonymous)' : `[${c.id}]`} anchor [${c.anchor.start}, ${c.anchor.end}) is out of range for clean text of length ${cleanLen}`,
      );
    }
  }

  // Code point → UTF-16 index table for slicing.
  const cpU16 = new Uint32Array(cleanLen + 1);
  {
    let cp = 0;
    let i = 0;
    for (const ch of clean) {
      cpU16[cp] = i;
      i += ch.length;
      cp++;
    }
    cpU16[cleanLen] = clean.length;
  }
  const sliceCp = (a: number, b: number): string =>
    clean.slice(cpU16[a], cpU16[b]);
  const charAtCp = (cp: number): string =>
    cp >= 0 && cp < cleanLen ? sliceCp(cp, cp + 1) : '';

  const events: Emission[] = [];
  // Positions where a block comment has already been emitted with conventional
  // spacing, so later ones there do not each re-add the separator.
  const fallbackPositions = new Set<number>();
  let ord = 0;

  // Carrier comments are serialized by their edit mark.
  const markCarrierIds = new Set<string>();
  for (const m of result.editMarks) {
    if (m.commentId !== null) markCarrierIds.add(m.commentId);
  }
  const carrierSerById = new Map<string, string>();
  for (const c of result.comments) {
    if (c.carrier && c.id !== null && markCarrierIds.has(c.id)) {
      carrierSerById.set(c.id, serializeComment(c));
    }
  }

  for (const c of result.comments) {
    if (c.carrier && c.id !== null && markCarrierIds.has(c.id)) continue;
    const src = c.source?.extent.start ?? Number.MAX_SAFE_INTEGER;
    if (c.scope === 'span') {
      if (c.anchor.start === c.anchor.end) {
        // Zero-width constructs emit whole, or the close/open tiebreak
        // (correct for adjacent constructs) would reverse their delimiters.
        events.push({
          pos: c.anchor.start,
          prio: 2,
          src,
        ord: ord++,
          text: '{====}' + serializeComment(c),
        });
        continue;
      }
      events.push({
        pos: c.anchor.start,
        prio: 3,
        mEnd: c.anchor.end,
        src: c.source?.open?.start ?? src,
        ord: ord++,
        text: '{==',
      });
      events.push({
        pos: c.anchor.end,
        prio: 0,
        mStart: c.anchor.start,
        src: c.source?.tail?.start ?? src,
        ord: ord++,
        text: '==}' + serializeComment(c),
      });
    } else if (c.scope === 'point') {
      events.push({
        pos: c.anchor.end,
        prio: 2,
        src,
        ord: ord++,
        text: serializeComment(c),
      });
    } else if (c.scope === 'document') {
      const pos = c.placement?.pos ?? 0;
      const before = c.placement?.before ?? '';
      const after = c.placement?.after ?? '\n\n';
      events.push({
        pos,
        prio: 1,
        src,
        ord: ord++,
        text: before + serializeComment(c) + after,
      });
    } else {
      // block
      let pos: number;
      let before: string;
      let after: string;
      if (c.placement) {
        ({ pos, before, after } = c.placement);
      } else {
        pos =
          charAtCp(c.anchor.end) === '\n' ? c.anchor.end + 1 : c.anchor.end;
        // `before` is computed against the ORIGINAL text, so a second block
        // comment appended at the same position recomputes the same separator
        // and stacks another blank line. The first one already supplied it.
        before =
          pos === 0
            ? ''
            : fallbackPositions.has(pos)
              ? '\n'
              : charAtCp(pos - 1) === '\n'
                ? '\n'
                : '\n\n';
        after = '\n';
        fallbackPositions.add(pos);
      }
      events.push({
        pos,
        prio: 1,
        src,
        ord: ord++,
        text: before + serializeComment(c) + after,
      });
    }
  }

  for (const m of result.editMarks) {
    const src = m.source?.start ?? Number.MAX_SAFE_INTEGER;
    const idComment =
      m.commentId !== null
        ? (carrierSerById.get(m.commentId) ?? `{>>[${m.commentId}]<<}`)
        : '';
    if (m.kind === 'insertion') {
      events.push({
        pos: m.range.start,
        prio: 2,
        src,
        ord: ord++,
        text: `{++${m.proposed}++}` + idComment,
      });
    } else if (m.range.start === m.range.end) {
      // Zero-width deletion/substitution: emit whole (see span note above).
      const text =
        m.kind === 'deletion' ? '{----}' : `{~~~>${m.proposed}~~}`;
      events.push({
        pos: m.range.start,
        prio: 2,
        src,
        ord: ord++,
        text: text + idComment,
      });
    } else if (m.kind === 'deletion') {
      events.push({
        pos: m.range.start,
        prio: 3,
        mEnd: m.range.end,
        src,
        ord: ord++,
        text: '{--',
      });
      events.push({
        pos: m.range.end,
        prio: 0,
        mStart: m.range.start,
        src: m.source ? m.source.end - 3 : src,
        ord: ord++,
        text: '--}' + idComment,
      });
    } else {
      events.push({
        pos: m.range.start,
        prio: 3,
        mEnd: m.range.end,
        src,
        ord: ord++,
        text: '{~~',
      });
      events.push({
        pos: m.range.end,
        prio: 0,
        mStart: m.range.start,
        src: m.source ? m.source.end - 3 : src,
        ord: ord++,
        text: `~>${m.proposed}~~}` + idComment,
      });
    }
  }

  events.sort((a, b) => {
    if (a.pos !== b.pos) return a.pos - b.pos;
    // Raw source position is the literal original layout; it decides the
    // order only when BOTH events are parse-derived. Any pair involving a
    // synthetic construct (no source) uses the priority rules, which keep
    // new insertions well-formed (note lines before inline marks, closes
    // before opens).
    const bothReal =
      a.src !== Number.MAX_SAFE_INTEGER && b.src !== Number.MAX_SAFE_INTEGER;
    if (bothReal && a.src !== b.src) return a.src - b.src;
    if (a.prio !== b.prio) return a.prio - b.prio;
    if (a.prio === 0 && a.mStart !== b.mStart) {
      return (b.mStart ?? 0) - (a.mStart ?? 0); // inner closes first
    }
    if (a.prio === 3 && a.mEnd !== b.mEnd) {
      return (b.mEnd ?? 0) - (a.mEnd ?? 0); // outer opens first
    }
    if (a.src !== b.src) return a.src - b.src;
    return a.ord - b.ord;
  });

  let out = result.frontmatter ?? '';
  let cursor = 0;
  for (const e of events) {
    out += sliceCp(cursor, e.pos) + e.text;
    cursor = e.pos;
  }
  out += sliceCp(cursor, cleanLen);
  // Restored last, outside every offset calculation, so it never participates
  // in the arithmetic that made it a bug in the first place.
  return { text: result.bom ? '\uFEFF' + out : out };
}
