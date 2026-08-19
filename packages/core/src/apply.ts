import { parse, normalizeLineEndings } from './parse.js';
import { recompose } from './recompose.js';
import { blockRanges, blockAtOrBefore, blockContaining } from './blocks.js';
import { cpLength, cpSlice, cpToUtf16, utf16ToCp, buildCpIndex } from './unicode.js';
import { shiftPoint, clampPoint, transformRange, type Edit } from './transform.js';
import type {
  ApplyReport,
  Comment,
  EditMark,
  PatchBatch,
  Range,
  RejectedPatch,
  ResponseIssue,
} from './types.js';

const VALID_STATUSES = new Set([
  'patched',
  'no-change-needed',
  'needs-input',
  'declined',
]);

/** Patches are expressed against clean text (SPEC §7, §8.3); replacement
 * text containing annotation syntax — opener, closer, or the substitution
 * arrow — could materialize marks or clip existing ones on recomposition. */
const MARK_SYNTAX = /\{==|\{>>|\{\+\+|\{--|\{~~|==\}|<<\}|\+\+\}|--\}|~~\}|~>/;

/** Closest candidate for a failed find, by per-code-point similarity
 * (SPEC §8.3 requires reporting one; matching itself is never fuzzy). */
/** Hard ceiling on `find`. SPEC §8.3 says SHOULD NOT exceed 200 characters;
 * a patch batch is untrusted input, so this is the point where a generous
 * multiple of that becomes a rejection rather than a scan that never ends. */
const MAX_FIND_CP = 4096;

/** Cost ceiling for the closest-candidate scan. Reporting a near-miss is a
 * diagnostic (SPEC §8.3), never a match, so declining to compute one on a very
 * large document is a fair trade against a multi-minute stall. */
const MAX_CANDIDATE_SCAN_CP = 200_000;

function closestCandidate(cl: readonly string[], find: string): string {
  if (cl.length > MAX_CANDIDATE_SCAN_CP) return '';
  const fl = [...find];
  if (fl.length === 0 || cl.length <= fl.length) return cl.join('');
  let best = 0;
  let bestScore = -1;
  for (let i = 0; i + fl.length <= cl.length; i++) {
    let score = 0;
    for (let j = 0; j < fl.length; j++) {
      if (cl[i + j] === fl[j]) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return cl.slice(best, best + fl.length).join('');
}

/** True when `s` contains a surrogate that is not part of a valid pair. Such a
 * string cannot occur as code points in the document, so matching it would be
 * matching text that is not there (GAL-REV-008). */
function hasUnpairedSurrogate(s: string): boolean {
  return /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);
}

/** True when applying `replace` inside an anchor or edit mark would introduce a
 * block boundary there, which SPEC §6.2 and §6.3 forbid (GAL-REV-009). */
function introducesBlockBoundary(replace: string): boolean {
  return /\n[ \t]*\n/.test(replace);
}

/** True when a span patch's match lands strictly inside an existing comment
 * anchor or edit mark, where a new block boundary would break SPEC §6.2/§6.3. */
/** Ranges of the annotations a [start,end) edit falls within. Only a SPAN
 * anchor can be split by a new block boundary — a point anchor is zero-width, a
 * block anchor IS a block so splitting it re-anchors the comment, and a
 * document anchor covers the file. */
function enclosingAnnotations(
  start: number,
  end: number,
  comments: readonly Comment[],
  marks: readonly EditMark[],
): Range[] {
  const out: Range[] = [];
  for (const c of comments) {
    if (c.scope !== 'span') continue;
    if (c.anchor.start < end && start < c.anchor.end) out.push(c.anchor);
  }
  for (const m of marks) {
    if (m.range.start < end && start < m.range.end) out.push(m.range);
  }
  return out;
}

/** Would applying `replace` over [start,end) leave a blank line inside any
 * annotation it touches? Testing `replace` alone was not enough: a replacement
 * ending in a single newline fuses with a newline already present in the anchor
 * and forms a blank line there, producing a document validate() rejects. */
function splitsAnnotation(
  clean: string,
  start: number,
  end: number,
  replace: string,
  comments: readonly Comment[],
  marks: readonly EditMark[],
): boolean {
  const enclosing = enclosingAnnotations(start, end, comments, marks);
  for (const r of enclosing) {
    const head = cpSlice(clean, r.start, Math.max(r.start, start));
    const tail = cpSlice(clean, Math.min(r.end, end), r.end);
    if (introducesBlockBoundary(head + replace + tail)) return true;
  }
  return false;
}

/** Describe an untrusted value for an error message without invoking its own
 * toString, which may itself throw (GAL-REV-033). */
function describe(v: unknown): string {
  const t = typeof v;
  if (v === null) return 'null';
  if (t === 'string') return JSON.stringify(v);
  if (t === 'number' || t === 'boolean' || t === 'undefined') return String(v);
  return `[${t}]`;
}

function findAllCp(
  clean: string,
  find: string,
  cpAt?: (utf16: number) => number,
): number[] {
  const out: number[] = [];
  // Converting each hit with utf16ToCp walked the whole string per match, so a
  // short `find` on a large document was quadratic: 24s on 200 KB. The shared
  // index makes each conversion O(1).
  const toCp = cpAt ?? ((u: number) => utf16ToCp(clean, u));
  let idx = clean.indexOf(find);
  while (idx >= 0) {
    out.push(toCp(idx));
    idx = clean.indexOf(find, idx + 1);
  }
  return out;
}

/**
 * Apply a patch batch to an annotated document (SPEC §10): decompose, locate
 * against the original clean text, validate, apply right-to-left, transform
 * anchors, recompose. Comments are never destroyed — they resolve, re-anchor,
 * or orphan.
 */
export interface ApplyOptions {
  /** Insert kept patches as inline edit marks (tracked changes) instead of
   * applying them destructively. Attributed comments still resolve; the
   * human accepts or rejects the marks afterward (resolveEditMarks). */
  asEditMarks?: boolean;
}

export function applyBatch(
  text: string,
  batch: PatchBatch,
  options: ApplyOptions = {},
): { text: string; report: ApplyReport } {
  const parsed = parse(text);
  const clean = parsed.cleanText;
  const blocks = blockRanges(clean);
  const patches = Array.isArray(batch.patches) ? batch.patches : [];
  const responses = Array.isArray(batch.responses) ? batch.responses : [];

  const byId = new Map<string, Comment>();
  for (const c of parsed.comments) {
    if (c.id !== null && !byId.has(c.id)) byId.set(c.id, c);
  }

  // Response coverage (SPEC §8.2): exactly one response per presented comment.
  const responseIssues: ResponseIssue[] = [];
  const seenResponses = new Set<string>();
  for (const r of responses) {
    if (r === null || typeof r !== 'object' || typeof r.comment !== 'string') {
      responseIssues.push({
        code: 'unknown-comment',
        message: `response entry is not a valid response object`,
        comment: '',
      });
      continue;
    }
    if (!byId.has(r.comment)) {
      responseIssues.push({
        code: 'unknown-comment',
        message: `Response for unknown comment [${r.comment}]`,
        comment: r.comment,
      });
      continue;
    }
    if (seenResponses.has(r.comment)) {
      responseIssues.push({
        code: 'duplicate-response',
        message: `Multiple responses for comment [${r.comment}]`,
        comment: r.comment,
      });
    }
    seenResponses.add(r.comment);
    if (!VALID_STATUSES.has(r.status)) {
      responseIssues.push({
        code: 'invalid-status',
        message: `Invalid status '${String(r.status)}' for comment [${r.comment}]`,
        comment: r.comment,
      });
    }
  }
  for (const id of byId.keys()) {
    if (!seenResponses.has(id)) {
      responseIssues.push({
        code: 'missing-response',
        message: `No response for comment [${id}] (generator failure, SPEC §8.2)`,
        comment: id,
      });
    }
  }

  // SPEC §5.1 requires identifiers be unique within a document. parse reports a
  // duplicate as an error, and applying anyway can retire the wrong comment,
  // since only the first per id is addressable (GAL-REV-018).
  const duplicateIds = parsed.issues.filter((x) => x.code === 'duplicate-id');
  if (duplicateIds.length > 0) {
    return {
      text,
      report: {
        applied: [], rejected: patches.map((_, index) => ({
          index,
          code: 'invalid-patch' as const,
          message: 'document contains duplicate identifiers; resolve them before applying a batch (SPEC §5.1)',
        })),
        resolved: [], orphaned: [], anchorModified: [],
        unaddressed: [...byId.keys()],
        answeredInline: [], responseIssues, editMarksDropped: 0,
        issues: parsed.issues,
      },
    };
  }

  // A document comment's anchor is the whole file, so treating it as "the block
  // containing the anchor" would let one patch replace everything, while the
  // named comment itself survives (document comments are exempt from
  // destruction). SPEC §8.4 does not contemplate this (GAL-REV-017).
  const isDocumentScoped = (id: string) => byId.get(id)?.scope === 'document';

  const blockOfComment = (c: Comment): Range | null => {
    if (c.scope === 'block' || c.scope === 'document') return { ...c.anchor };
    return (
      blockContaining(blocks, c.anchor.start) ??
      blockAtOrBefore(blocks, c.anchor.start)
    );
  };

  // One code-point view of the clean text, shared by every candidate report in
  // this batch; rebuilding it per patch made many small rejections quadratic.
  const cleanCp: readonly string[] = [...clean];
  const cleanCpAt = buildCpIndex(clean);

  // Locate every patch against the original clean text (SPEC §10 step 2).
  const rejected: RejectedPatch[] = [];
  const located: Edit[] = [];
  for (let i = 0; i < patches.length; i++) {
    let p = patches[i]!;
    // A batch is untrusted input. These shapes are all valid JSON and used to
    // escape as an uncaught TypeError rather than a rejection (GAL-REV-033).
    if (p === null || typeof p !== 'object') {
      rejected.push({
        index: i,
        code: 'invalid-patch',
        message: 'patch is not an object',
      });
      continue;
    }
    if (p.type !== 'span' && p.type !== 'block') {
      rejected.push({
        index: i,
        code: 'invalid-patch',
        message: `unknown patch type ${describe((p as { type?: unknown }).type)}`,
      });
      continue;
    }
    const attributed = new Set(Array.isArray(p.comments) ? p.comments : []);
    if (typeof p.replace === 'string' && MARK_SYNTAX.test(p.replace)) {
      rejected.push({
        index: i,
        code: 'invalid-patch',
        message:
          'replace is clean text and must not contain annotation syntax (SPEC §8.3)',
      });
      continue;
    }
    if (p.type === 'span') {
      if (
        typeof p.find !== 'string' ||
        p.find === '' ||
        typeof p.replace !== 'string'
      ) {
        rejected.push({
          index: i,
          code: 'invalid-patch',
          message: 'Span patch requires non-empty find and a replace string',
        });
        continue;
      }
      // The document is normalized to \n (SPEC §7); a find quoted from a CRLF
      // source therefore could not match, and the closest candidate rendered
      // identically to the input — a retry loop that can never converge.
      p = { ...p, find: normalizeLineEndings(p.find), replace: normalizeLineEndings(p.replace) };
      if (cpLength(p.find) > MAX_FIND_CP) {
        rejected.push({
          index: i,
          code: 'invalid-patch',
          message: `find exceeds ${MAX_FIND_CP} code points; use a block patch for whole-paragraph rewrites (SPEC §8.3)`,
        });
        continue;
      }
      if (hasUnpairedSurrogate(p.find)) {
        rejected.push({
          index: i,
          code: 'invalid-patch',
          message: `find contains an unpaired surrogate and cannot match document text`,
        });
        continue;
      }
      if (hasUnpairedSurrogate(p.replace)) {
        rejected.push({
          index: i,
          code: 'invalid-patch',
          message: `replace contains an unpaired surrogate; it would not survive being written as UTF-8, and no later patch could match it to remove it`,
        });
        continue;
      }
      const matches = findAllCp(clean, p.find, cleanCpAt);
      if (matches.length === 0) {
        rejected.push({
          index: i,
          code: 'no-match',
          message: `find does not match the clean text exactly`,
          closest: closestCandidate(cleanCp, p.find),
        });
        continue;
      }
      let startCp: number;
      if (matches.length === 1) {
        startCp = matches[0]!;
      } else {
        // Disambiguate within the blocks of referenced comments (SPEC §8.3).
        const candidateBlocks: Range[] = [];
        for (const id of attributed) {
          const c = byId.get(id);
          if (c) {
            const b = blockOfComment(c);
            if (b) candidateBlocks.push(b);
          }
        }
        const findLen = cpLength(p.find);
        const inBlocks = matches.filter((m) =>
          candidateBlocks.some((b) => m >= b.start && m + findLen <= b.end),
        );
        if (inBlocks.length === 1) {
          startCp = inBlocks[0]!;
        } else {
          rejected.push({
            index: i,
            code: 'ambiguous',
            message: `find matches ${matches.length} locations; ambiguous matches are rejected (SPEC §8.3)`,
          });
          continue;
        }
      }
      const endCp = startCp + cpLength(p.find);
      if (
        splitsAnnotation(clean, startCp, endCp, p.replace, parsed.comments, parsed.editMarks)
      ) {
        rejected.push({
          index: i,
          code: 'invalid-patch',
          message: `replace introduces a block boundary inside an anchor or edit mark (SPEC §6.2, §6.3); use a block patch to split a paragraph`,
        });
        continue;
      }
      located.push({
        s: startCp,
        e: endCp,
        L: cpLength(p.replace),
        replace: p.replace,
        index: i,
        attributed,
      });
    } else if (p.type === 'block') {
      // Block replacements were written raw while span replacements were
      // normalized, so a block patch could put CRLF into clean text, breaking
      // SPEC §7 normalization and the byte-exact round trip — with validate()
      // reporting the result clean.
      p = { ...p, replace: typeof p.replace === 'string' ? normalizeLineEndings(p.replace) : p.replace };
      if (typeof p.comment !== 'string' || typeof p.replace !== 'string') {
        rejected.push({
          index: i,
          code: 'invalid-patch',
          message: 'Block patch requires a comment id and a replace string',
        });
        continue;
      }
      if (isDocumentScoped(p.comment)) {
        rejected.push({
          index: i,
          code: 'invalid-patch',
          message: `Block patch names document-scoped comment [${p.comment}]; its anchor is the whole file, so there is no block to replace (SPEC §8.4)`,
        });
        continue;
      }
      const c = byId.get(p.comment);
      if (!c) {
        rejected.push({
          index: i,
          code: 'unknown-comment',
          message: `Block patch names unknown comment [${p.comment}]`,
        });
        continue;
      }
      const b = blockOfComment(c);
      if (!b || b.start === b.end) {
        rejected.push({
          index: i,
          code: 'invalid-patch',
          message: `Comment [${p.comment}] has no block to replace`,
        });
        continue;
      }
      attributed.add(p.comment);
      located.push({
        s: b.start,
        e: b.end,
        L: cpLength(p.replace),
        replace: p.replace,
        index: i,
        attributed,
      });
    } else {
      rejected.push({
        index: i,
        code: 'invalid-patch',
        message: `Unknown patch type '${String((p as { type?: unknown }).type)}'`,
      });
    }
  }

  // Validate: overlapping patches conflict (SPEC §10 step 3). Two phases so
  // rejection never cascades transitively: comment-attributed patches settle
  // among themselves first, then reason-only patches lose to accepted ones
  // and to each other. A patch that only overlaps rejected patches applies.
  located.sort((a, b) => a.s - b.s || a.e - b.e);
  const overlapping = (a: Edit, b: Edit): boolean => a.s < b.e && b.s < a.e;
  const conflicted = new Map<Edit, string>();
  const attributedPatches = located.filter((e) => e.attributed.size > 0);
  const reasonPatches = located.filter((e) => e.attributed.size === 0);
  for (let a = 0; a < attributedPatches.length; a++) {
    for (let b = a + 1; b < attributedPatches.length; b++) {
      if (overlapping(attributedPatches[a]!, attributedPatches[b]!)) {
        const msg =
          'Overlaps another comment-attributed patch; neither takes precedence (SPEC §10)';
        conflicted.set(attributedPatches[a]!, msg);
        conflicted.set(attributedPatches[b]!, msg);
      }
    }
  }
  const kept: Edit[] = attributedPatches.filter((e) => !conflicted.has(e));
  const reasonSurvivors: Edit[] = [];
  for (const r of reasonPatches) {
    if (kept.some((a) => overlapping(a, r))) {
      conflicted.set(
        r,
        'Overlaps a comment-attributed patch, which takes precedence (SPEC §10)',
      );
    } else {
      reasonSurvivors.push(r);
    }
  }
  for (let a = 0; a < reasonSurvivors.length; a++) {
    for (let b = a + 1; b < reasonSurvivors.length; b++) {
      if (overlapping(reasonSurvivors[a]!, reasonSurvivors[b]!)) {
        const msg =
          'Overlaps another patch; neither takes precedence (SPEC §10)';
        conflicted.set(reasonSurvivors[a]!, msg);
        conflicted.set(reasonSurvivors[b]!, msg);
      }
    }
  }
  kept.push(...reasonSurvivors.filter((e) => !conflicted.has(e)));
  for (const [edit, message] of conflicted) {
    rejected.push({ index: edit.index, code: 'conflict', message });
  }
  kept.sort((a, b) => a.s - b.s);

  if (options.asEditMarks) {
    return applyAsEditMarks(parsed, kept, rejected, {
      patches,
      byId,
      responseIssues,
    });
  }

  // Apply in descending order of start offset (SPEC §10 step 4).
  let newClean = clean;
  for (let k = kept.length - 1; k >= 0; k--) {
    const ed = kept[k]!;
    const sU = cpToUtf16(newClean, ed.s);
    const eU = cpToUtf16(newClean, ed.e);
    newClean = newClean.slice(0, sU) + ed.replace + newClean.slice(eU);
  }
  const newBlocks = blockRanges(newClean);
  const newLen = cpLength(newClean);

  // Transform anchors (SPEC §10.1).
  const resolved: { id: string; body: string }[] = [];
  const orphaned: string[] = [];
  const anchorModified: string[] = [];
  let editMarksDropped = 0;

  const newMarks: EditMark[] = [];
  const droppedMarkIds = new Set<string>();
  for (const m of parsed.editMarks) {
    const t = transformRange(m.range, kept);
    if ('destroyed' in t) {
      editMarksDropped++;
      if (m.commentId !== null) droppedMarkIds.add(m.commentId);
      continue;
    }
    const range = t.range;
    const { source: _staleMarkSource, ...restMark } = m;
    newMarks.push({
      ...restMark,
      range,
      original: m.kind === 'insertion' ? '' : cpSlice(newClean, range.start, range.end),
    });
  }

  const newComments: Comment[] = [];
  for (const c of parsed.comments) {
    if (c.scope === 'document') {
      // A document comment's anchor is derived (the whole file); it re-derives
      // over the new text and is never destroyed by a patch (SPEC §6.1).
      const { source: _s, ...rest } = c;
      newComments.push({ ...rest, anchor: { start: 0, end: newLen }, flags: [...c.flags] });
      continue;
    }
    const t = transformRange(c.anchor, kept);
    if ('destroyed' in t) {
      if (c.id !== null && t.destroyed.attributed.has(c.id)) {
        resolved.push({ id: c.id, body: c.body });
        continue; // resolved: leaves the document layer (SPEC §10.1)
      }
      // Orphaned: demote to block scope at the block where the anchor
      // formerly began, flagged anchor-lost (SPEC §10.1).
      const posNew = clampPoint(Math.max(c.anchor.start, t.destroyed.s), kept);
      const block =
        blockContaining(newBlocks, posNew) ??
        blockAtOrBefore(newBlocks, posNew) ?? { start: 0, end: 0 };
      const out: Comment = {
        id: c.id,
        scope: 'block',
        body: c.body,
        anchor: { ...block },
        flags: [...c.flags.filter((f) => f !== 'anchor-lost'), 'anchor-lost'],
      };
      if (c.bodySep !== undefined) out.bodySep = c.bodySep;
      if (c.id !== null) orphaned.push(c.id);
      newComments.push(out);
      continue;
    }
    // Source ranges describe the pre-patch document; re-parse for fresh ones.
    const { source: _staleSource, ...restComment } = c;
    const out: Comment = { ...restComment, anchor: t.range, flags: [...c.flags] };
    if (t.modified && !out.flags.includes('anchor-modified')) {
      out.flags.push('anchor-modified');
      if (c.id !== null) anchorModified.push(c.id);
    }
    if (c.carrier && c.id !== null && droppedMarkIds.has(c.id)) {
      delete out.carrier;
      out.scope = 'point';
      out.anchor = { start: out.anchor.end, end: out.anchor.end };
    }
    if (out.scope === 'point' && !out.carrier) {
      // A point stranded between paragraphs by the patch is unrepresentable
      // inline (its bare mark would re-parse as a block comment); demote it
      // deterministically and report it (SPEC §6.1).
      const pos = out.anchor.start;
      const prev = pos === 0 ? '\n' : cpSlice(newClean, pos - 1, pos);
      const next = pos === newLen ? '\n' : cpSlice(newClean, pos, pos + 1);
      if (prev === '\n' && next === '\n') {
        const block = blockAtOrBefore(newBlocks, pos) ?? { start: 0, end: 0 };
        out.scope = 'block';
        out.anchor = { ...block };
        delete out.placement;
        if (!out.flags.includes('anchor-modified')) {
          out.flags.push('anchor-modified');
          if (c.id !== null) anchorModified.push(c.id);
        }
      }
    }
    if (c.scope === 'block') {
      const pos = clampPoint(c.placement?.pos ?? c.anchor.end, kept);
      const block = blockAtOrBefore(newBlocks, pos) ?? { start: 0, end: 0 };
      out.anchor = { ...block };
      if (c.placement) {
        // `before`/`after` are literal whitespace captured from the document as
        // it was parsed, replayed verbatim on recomposition. That is exactly
        // right for a document nothing touched, and wrong once a patch has
        // rewritten the surrounding text: replaying stale separators adds or
        // drops blank lines, which can even change the comment's scope on
        // reparse. When an edit lands in that neighbourhood, drop the recorded
        // whitespace and let recompose apply conventional spacing.
        const from = c.placement.pos - c.placement.before.length;
        const to = c.placement.pos + c.placement.after.length;
        const disturbed = kept.some((ed) => ed.s <= to && from <= ed.e);
        if (disturbed) delete out.placement;
        else out.placement = { ...c.placement, pos };
      }
    }
    newComments.push(out);
  }

  const { text: outText } = recompose({
    cleanText: newClean,
    frontmatter: parsed.frontmatter,
    comments: newComments,
    editMarks: newMarks,
  });

  // Comments not referenced by any patch in the batch (SPEC §10.2).
  const referenced = new Set<string>();
  for (const p of patches) {
    if (p === null || typeof p !== 'object') continue;
    if (Array.isArray(p.comments)) for (const id of p.comments) referenced.add(id);
    if (p.type === 'block' && typeof p.comment === 'string') {
      referenced.add(p.comment);
    }
  }
  const unaddressed = [...byId.keys()].filter((id) => !referenced.has(id));
  // Referenced, and still in the document: the patch edited within the anchor
  // rather than destroying it, so the comment never resolved (GAL-REV-012).
  const survivingIds = new Set(
    newComments.map((c) => c.id).filter((id): id is string => id !== null),
  );
  // Only edits that were actually APPLIED, and only where the edit fell inside
  // the comment's own anchor. Deriving this from `referenced` named comments
  // whose patches were rejected — the document untouched, and the report
  // telling an adapter the note had been handled.
  const answeredInline = [...survivingIds].filter((id) => {
    const c = byId.get(id);
    if (!c) return false;
    return kept.some(
      (ed) =>
        ed.attributed.has(id) &&
        ed.s >= c.anchor.start &&
        ed.e <= c.anchor.end &&
        c.anchor.start !== c.anchor.end,
    );
  });

  const report: ApplyReport = {
    applied: kept
      .sort((a, b) => a.index - b.index)
      .map((e) => ({
        index: e.index,
        type: patches[e.index]!.type,
        range: { start: e.s, end: e.e },
      })),
    rejected: rejected.sort((a, b) => a.index - b.index),
    resolved,
    orphaned,
    anchorModified,
    unaddressed,
    answeredInline,
    responseIssues,
    editMarksDropped,
    issues: parsed.issues,
  };
  return { text: outText, report };
}

/** Tracked-changes application: clean text stays untouched; kept patches
 * become inline edit marks. Attributed comments resolve now (their question
 * is answered by a visible proposal); comments whose anchors sit inside a
 * new mark orphan as usual. */
function applyAsEditMarks(
  parsed: ReturnType<typeof parse>,
  kept: Edit[],
  rejected: RejectedPatch[],
  ctx: {
    patches: PatchBatch['patches'];
    byId: Map<string, Comment>;
    responseIssues: ResponseIssue[];
  },
): { text: string; report: ApplyReport } {
  const clean = parsed.cleanText;
  const resolved: { id: string; body: string }[] = [];
  const orphaned: string[] = [];
  const anchorModified: string[] = [];
  const blocks = blockRanges(clean);

  const overlapsRange = (s: number, e: number, r: Range): boolean =>
    s < r.end && r.start < e;
  const containsRange = (s: number, e: number, r: Range): boolean =>
    s <= r.start && r.end <= e;

  // A new mark may not nest with an existing mark, and may not partially
  // overlap a surviving anchor (SPEC §6.2/§6.3) — those patches reject.
  const accepted: Edit[] = [];
  for (const ed of kept) {
    const nestsMark = parsed.editMarks.some(
      (m) => overlapsRange(ed.s, ed.e, m.range),
    );
    // An edit that CONTAINS the anchor resolves the comment, and one that sits
    // wholly INSIDE it edits within the anchored text; both are fine and both
    // are excluded below. What is left is an edit straddling one boundary,
    // which cannot be wrapped in an edit mark without interleaving the mark
    // with the highlight. That is invalid whether or not the patch is
    // attributed to the comment — the previous attribution exemption only ever
    // reached this straddle case, and let it through.
    // The edit's own extent becomes the mark in tracked mode, so a range that
    // spans a blank line yields a mark crossing a block boundary (SPEC §6.3).
    const spansBlock = introducesBlockBoundary(cpSlice(clean, ed.s, ed.e));
    const clipsAnchor = parsed.comments.some(
      (c) =>
        c.scope === 'span' &&
        overlapsRange(ed.s, ed.e, c.anchor) &&
        !containsRange(ed.s, ed.e, c.anchor) &&
        !(c.anchor.start <= ed.s && ed.e <= c.anchor.end),
    );
    if (spansBlock) {
      rejected.push({
        index: ed.index,
        code: 'conflict',
        message:
          'Tracked change would span a block boundary; an edit mark must not (SPEC §6.3)',
      });
      continue;
    }
    if (nestsMark || clipsAnchor) {
      rejected.push({
        index: ed.index,
        code: 'conflict',
        message: nestsMark
          ? 'Would nest with an existing edit mark (SPEC §6.3)'
          : 'Would partially overlap an existing anchor (SPEC §6.2)',
      });
    } else {
      accepted.push(ed);
    }
  }

  const newComments: Comment[] = [];
  for (const c of parsed.comments) {
    const destroying = accepted.find(
      (ed) =>
        c.scope !== 'document' &&
        containsRange(ed.s, ed.e, c.anchor) &&
        !(c.anchor.start === c.anchor.end &&
          (c.anchor.start <= ed.s || c.anchor.start >= ed.e)),
    );
    if (destroying && c.id !== null && destroying.attributed.has(c.id)) {
      resolved.push({ id: c.id, body: c.body });
      continue;
    }
    if (destroying && (c.scope === 'span' || c.scope === 'point')) {
      const { source: _s, ...rest } = c;
      const block =
        blockContaining(blocks, c.anchor.start) ??
        blockAtOrBefore(blocks, c.anchor.start) ?? { start: 0, end: 0 };
      newComments.push({
        ...rest,
        scope: 'block',
        anchor: { ...block },
        flags: [...c.flags.filter((f) => f !== 'anchor-lost'), 'anchor-lost'],
      });
      if (c.id !== null) orphaned.push(c.id);
      continue;
    }
    newComments.push(c);
  }

  const newMarks: EditMark[] = [
    ...parsed.editMarks,
    ...accepted.map(
      (ed): EditMark => ({
        kind: ed.replace === '' ? 'deletion' : 'substitution',
        range: { start: ed.s, end: ed.e },
        original: cpSlice(clean, ed.s, ed.e),
        proposed: ed.replace,
        commentId: null,
      }),
    ),
  ];

  const { text: outText } = recompose({
    cleanText: clean,
    frontmatter: parsed.frontmatter,
    comments: newComments,
    editMarks: newMarks,
  });

  const referenced = new Set<string>();
  for (const p of ctx.patches) {
    if (p === null || typeof p !== 'object') continue;
    if (Array.isArray(p.comments)) for (const id of p.comments) referenced.add(id);
    if (p.type === 'block' && typeof p.comment === 'string') referenced.add(p.comment);
  }
  const survivingIds = new Set(
    newComments.map((c) => c.id).filter((id): id is string => id !== null),
  );
  const answeredInline = [...survivingIds].filter((id) => {
    const c = ctx.byId.get(id);
    if (!c) return false;
    return accepted.some(
      (ed) =>
        ed.attributed.has(id) &&
        ed.s >= c.anchor.start &&
        ed.e <= c.anchor.end &&
        c.anchor.start !== c.anchor.end,
    );
  });

  const report: ApplyReport = {
    applied: accepted
      .sort((a, b) => a.index - b.index)
      .map((e) => ({
        index: e.index,
        type: ctx.patches[e.index]!.type,
        range: { start: e.s, end: e.e },
      })),
    rejected: rejected.sort((a, b) => a.index - b.index),
    resolved,
    orphaned,
    anchorModified,
    unaddressed: [...ctx.byId.keys()].filter((id) => !referenced.has(id)),
    answeredInline,
    responseIssues: ctx.responseIssues,
    editMarksDropped: 0,
    issues: parsed.issues,
  };
  return { text: outText, report };
}
