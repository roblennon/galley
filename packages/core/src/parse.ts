import { scan, type RawToken } from './tokenize.js';
import { buildCpIndex, cpLength, utf16ToCp } from './unicode.js';
import { blockRanges, blockAtOrBefore } from './blocks.js';
import type {
  Comment,
  EditKind,
  EditMark,
  Issue,
  ParseResult,
  Scope,
} from './types.js';

const ID_PREFIX = /^\[([A-Za-z0-9]{1,8})\]( |$)/;

export function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

/** Split a comment mark's inner content into identifier and body
 * (SPEC §5.1). For adapters that handle raw comment content (e.g. rendered
 * text nodes) without needing offsets. */
export function splitCommentContent(content: string): {
  id: string | null;
  body: string;
} {
  const { id, body } = parseCommentContent(content);
  return { id, body };
}

function parseCommentContent(content: string): {
  id: string | null;
  body: string;
  bodySep: string;
} {
  const m = ID_PREFIX.exec(content);
  if (!m) return { id: null, body: content, bodySep: '' };
  return { id: m[1]!, body: content.slice(m[0].length), bodySep: m[2]! };
}

interface IComment {
  id: string | null;
  scope: Scope;
  body: string;
  bodySep: string;
  /** UTF-16 anchor into clean text; null until resolved (block/document). */
  aU: [number, number] | null;
  placementU?: { posU: number; before: string; after: string };
  /** Index into marks[] when this comment is an edit-mark id carrier. */
  carrierOf?: number;
  /** Body-local raw ranges of the comment's syntax. */
  srcExtent: [number, number];
  srcOpen?: [number, number];
  srcAnchor?: [number, number];
  srcTail?: [number, number];
}

interface IMark {
  kind: EditKind;
  aU: [number, number];
  original: string;
  proposed: string;
  commentId: string | null;
  /** Body-local raw range of the mark's syntax. */
  src: [number, number];
}

/**
 * Parse an annotated document into clean text plus an annotation layer
 * (SPEC §7). Line endings are normalized to '\n' first; all public offsets
 * are Unicode code points over clean text.
 */
export function parse(text: string): ParseResult {
  const full = normalizeLineEndings(text);

  // Frontmatter: delimiters plus immediately following blank lines (SPEC §7).
  let frontmatter: string | null = null;
  let body = full;
  const fm = /^---\n[\s\S]*?\n---(?:\n|$)/.exec(full);
  if (fm) {
    let end = fm[0].length;
    for (;;) {
      const blank = /^[ \t]*\n/.exec(full.slice(end));
      if (!blank) break;
      end += blank[0].length;
    }
    frontmatter = full.slice(0, end);
    body = full.slice(end);
  }
  const fmU16 = frontmatter?.length ?? 0;

  const issues: Issue[] = [];
  const reportIndex = (u16: number) => utf16ToCp(full, fmU16 + u16);
  const tokens = scan(body, issues, reportIndex);

  let clean = '';
  const comments: IComment[] = [];
  const marks: IMark[] = [];

  // Verbatim raw↔clean segments (body-local raw offsets; shifted past the
  // frontmatter on output). Every clean chunk is copied unchanged from the
  // raw document, so each segment is 1:1.
  const segments: { raw: number; clean: number; length: number }[] = [];
  const emit = (rawLocal: number, text: string): void => {
    if (text.length === 0) return;
    const last = segments[segments.length - 1];
    if (
      last &&
      last.raw + last.length === rawLocal &&
      last.clean + last.length === clean.length
    ) {
      last.length += text.length;
    } else {
      segments.push({ raw: rawLocal, clean: clean.length, length: text.length });
    }
    clean += text;
  };
  const truncateCleanTo = (newLen: number): void => {
    while (segments.length > 0) {
      const last = segments[segments.length - 1]!;
      if (last.clean >= newLen) {
        segments.pop();
      } else {
        last.length = Math.min(last.length, newLen - last.clean);
        break;
      }
    }
    clean = clean.slice(0, newLen);
  };

  const emitEdit = (tok: RawToken, baseU16: number): IMark | null => {
    const kind = tok.kind as EditKind;
    const content = tok.content;
    if (ID_PREFIX.test(content)) {
      issues.push({
        severity: 'warning',
        code: 'identifier-in-content',
        message:
          'Identifier-like prefix inside an edit mark is ordinary content (SPEC §11)',
        index: reportIndex(baseU16 + tok.start),
      });
    }
    let original: string;
    let proposed: string;
    if (kind === 'insertion') {
      original = '';
      proposed = content;
    } else if (kind === 'deletion') {
      original = content;
      proposed = '';
    } else {
      const j = content.indexOf('~>');
      if (j < 0) {
        issues.push({
          severity: 'error',
          code: 'substitution-missing-arrow',
          message: "Substitution without '~>'; treated as prose",
          index: reportIndex(baseU16 + tok.start),
        });
        return null;
      }
      original = content.slice(0, j);
      proposed = content.slice(j + 2);
    }
    if (/\n[ \t]*\n/.test(original)) {
      issues.push({
        severity: 'error',
        code: 'edit-mark-crosses-block',
        message: 'An edit mark must not span a block boundary (SPEC §6.3)',
        index: reportIndex(baseU16 + tok.start),
      });
    }
    const start = clean.length;
    emit(baseU16 + tok.start + 3, original);
    const mark: IMark = {
      kind,
      aU: [start, clean.length],
      original,
      proposed,
      commentId: null,
      src: [baseU16 + tok.start, baseU16 + tok.end],
    };
    marks.push(mark);
    return mark;
  };

  /** Emit highlight content: prose plus inner edit marks. */
  const emitHighlightContent = (content: string, baseU16: number): void => {
    const inner = scan(content, issues, (u16) => reportIndex(baseU16 + u16));
    let p = 0;
    for (const tok of inner) {
      emit(baseU16 + p, content.slice(p, tok.start));
      if (
        tok.kind === 'insertion' ||
        tok.kind === 'deletion' ||
        tok.kind === 'substitution'
      ) {
        if (emitEdit(tok, baseU16) === null) {
          emit(baseU16 + tok.start, content.slice(tok.start, tok.end));
        }
      } else {
        issues.push({
          severity: 'warning',
          code: 'mark-inside-highlight',
          message: `A ${tok.kind} mark inside a highlight is ordinary content`,
          index: reportIndex(baseU16 + tok.start),
        });
        emit(baseU16 + tok.start, content.slice(tok.start, tok.end));
      }
      p = tok.end;
    }
    emit(baseU16 + p, content.slice(p));
  };

  let pos = 0;
  let prevAdj: { markIndex: number; end: number } | null = null;

  for (let t = 0; t < tokens.length; t++) {
    const tok = tokens[t]!;
    if (tok.start < pos) continue; // consumed inside a preceding construct
    emit(pos, body.slice(pos, tok.start));
    if (tok.start > pos) prevAdj = null;
    pos = tok.start;

    if (tok.kind === 'highlight') {
      const next = tokens[t + 1];
      if (next && next.kind === 'comment' && next.start === tok.end) {
        if (ID_PREFIX.test(tok.content)) {
          issues.push({
            severity: 'warning',
            code: 'identifier-in-content',
            message:
              'Identifier-like prefix inside a highlight is ordinary content (SPEC §11)',
            index: reportIndex(tok.start),
          });
        }
        const startU = clean.length;
        emitHighlightContent(tok.content, tok.start + 3);
        const endU = clean.length;
        if (/\n[ \t]*\n/.test(clean.slice(startU))) {
          issues.push({
            severity: 'error',
            code: 'anchor-crosses-block',
            message: 'An anchor must not cross a block boundary (SPEC §6.2)',
            index: reportIndex(tok.start),
          });
        }
        const { id, body: cbody, bodySep } = parseCommentContent(next.content);
        comments.push({
          id,
          scope: 'span',
          body: cbody,
          bodySep,
          aU: [startU, endU],
          srcExtent: [tok.start, next.end],
          srcOpen: [tok.start, tok.start + 3],
          srcAnchor: [tok.start + 3, tok.end - 3],
          srcTail: [tok.end - 3, next.end],
        });
        pos = next.end;
        t++;
        prevAdj = null;
      } else {
        issues.push({
          severity: 'error',
          code: 'highlight-without-comment',
          message:
            'Highlight not immediately followed by a comment; treated as prose (SPEC §6.1)',
          index: reportIndex(tok.start),
        });
        emit(tok.start, body.slice(tok.start, tok.end));
        pos = tok.end;
        prevAdj = null;
      }
      continue;
    }

    if (tok.kind === 'comment') {
      const { id, body: cbody, bodySep } = parseCommentContent(tok.content);
      const lineStart = body.lastIndexOf('\n', tok.start - 1) + 1;
      const nlIdx = body.indexOf('\n', tok.end);
      const hadNL = nlIdx >= 0;
      const lineEnd = hadNL ? nlIdx : body.length;
      const beforeOnLine = body.slice(lineStart, tok.start);
      const afterOnLine = body.slice(tok.end, lineEnd);
      const alone =
        /^[ \t]*$/.test(beforeOnLine) && /^[ \t]*$/.test(afterOnLine);
      const cleanBlank = /^\s*$/.test(clean);
      const sepMatch = /\n([ \t]*)\n([ \t]*)$/.exec(clean);

      // Document/block classification must not orphan offsets already
      // recorded into the whitespace it would consume: a document comment
      // resets clean text entirely, and a block comment trims the blank
      // separator. If any earlier annotation is anchored there, this mark
      // reads as a point comment instead.
      const anchoredMax = Math.max(
        0,
        ...marks.map((m) => m.aU[1]),
        ...comments.map((c) => (c.aU === null ? 0 : c.aU[1])),
      );
      const docSafe = cleanBlank && anchoredMax === 0 && marks.length === 0;
      const blockSafe = sepMatch !== null && sepMatch.index + 1 >= anchoredMax;

      if (alone && (docSafe || (!cleanBlank && blockSafe))) {
        if (docSafe && cleanBlank) {
          // Document comment: before any block content (SPEC §6.1).
          const before = clean;
          truncateCleanTo(0);
          let after = afterOnLine + (hadNL ? '\n' : '');
          let newPos = hadNL ? lineEnd + 1 : lineEnd;
          if (hadNL && newPos < body.length) {
            // Absorb one following blank line.
            const nl2 = body.indexOf('\n', newPos);
            const nextLine = body.slice(newPos, nl2 < 0 ? body.length : nl2);
            if (/^[ \t]*$/.test(nextLine) && (nl2 >= 0 || nextLine.length > 0)) {
              after += nextLine + (nl2 >= 0 ? '\n' : '');
              newPos = nl2 >= 0 ? nl2 + 1 : body.length;
            }
          }
          comments.push({
            id,
            scope: 'document',
            body: cbody,
            bodySep,
            aU: null,
            placementU: { posU: 0, before, after },
            srcExtent: [tok.start, tok.end],
          });
          pos = newPos;
        } else {
          // Block comment: trim the blank-line separator from clean (SPEC §7).
          const m = sepMatch!;
          truncateCleanTo(m.index + 1);
          const before = m[1]! + '\n' + m[2]!;
          const after = afterOnLine + (hadNL ? '\n' : '');
          comments.push({
            id,
            scope: 'block',
            body: cbody,
            bodySep,
            aU: null,
            placementU: { posU: clean.length, before, after },
            srcExtent: [tok.start, tok.end],
          });
          pos = hadNL ? lineEnd + 1 : lineEnd;
        }
        prevAdj = null;
        continue;
      }

      if (prevAdj && prevAdj.end === tok.start && id !== null && cbody === '') {
        // Empty-bodied comment referencing the preceding edit mark (SPEC §6.3).
        const markIndex = prevAdj.markIndex;
        marks[markIndex]!.commentId = id;
        comments.push({
          id,
          scope: 'point',
          body: '',
          bodySep,
          aU: null,
          carrierOf: markIndex,
          srcExtent: [tok.start, tok.end],
        });
        pos = tok.end;
        prevAdj = null;
        continue;
      }

      comments.push({
        id,
        scope: 'point',
        body: cbody,
        bodySep,
        aU: [clean.length, clean.length],
        srcExtent: [tok.start, tok.end],
      });
      pos = tok.end;
      prevAdj = null;
      continue;
    }

    // Edit mark at top level.
    const mark = emitEdit(tok, 0);
    if (mark === null) {
      emit(tok.start, body.slice(tok.start, tok.end));
      prevAdj = null;
    } else {
      prevAdj = { markIndex: marks.length - 1, end: tok.end };
    }
    pos = tok.end;
  }
  emit(pos, body.slice(pos));

  // Convert UTF-16 offsets to code points and finalize anchors.
  const cpAt = buildCpIndex(clean);
  const cleanCpLen = cpLength(clean);
  const blocks = blockRanges(clean);

  const shift = (r: [number, number]) => ({
    start: r[0] + fmU16,
    end: r[1] + fmU16,
  });

  const editMarks: EditMark[] = marks.map((m) => ({
    kind: m.kind,
    range: { start: cpAt(m.aU[0]), end: cpAt(m.aU[1]) },
    original: m.original,
    proposed: m.proposed,
    commentId: m.commentId,
    source: shift(m.src),
  }));

  const outComments: Comment[] = comments.map((c) => {
    const out: Comment = {
      id: c.id,
      scope: c.scope,
      body: c.body,
      anchor: { start: 0, end: 0 },
      flags: [],
    };
    if (c.bodySep === ' ' || c.body !== '') out.bodySep = c.bodySep;
    out.source = { extent: shift(c.srcExtent) };
    if (c.srcOpen && c.srcAnchor && c.srcTail) {
      out.source.open = shift(c.srcOpen);
      out.source.anchorRaw = shift(c.srcAnchor);
      out.source.tail = shift(c.srcTail);
    }
    if (c.carrierOf !== undefined) {
      out.carrier = true;
      out.anchor = { ...editMarks[c.carrierOf]!.range };
    } else if (c.scope === 'span' || c.scope === 'point') {
      out.anchor = { start: cpAt(c.aU![0]), end: cpAt(c.aU![1]) };
    } else if (c.scope === 'document') {
      out.anchor = { start: 0, end: cleanCpLen };
      out.placement = {
        pos: 0,
        before: c.placementU!.before,
        after: c.placementU!.after,
      };
    } else {
      const posCp = cpAt(c.placementU!.posU);
      const block = blockAtOrBefore(blocks, posCp);
      out.anchor = block ? { ...block } : { start: 0, end: 0 };
      out.placement = {
        pos: posCp,
        before: c.placementU!.before,
        after: c.placementU!.after,
      };
    }
    return out;
  });

  // Duplicate identifiers (SPEC §5.1).
  const seen = new Set<string>();
  for (const c of outComments) {
    if (c.id === null) continue;
    if (seen.has(c.id)) {
      issues.push({
        severity: 'error',
        code: 'duplicate-id',
        message: `Duplicate identifier [${c.id}]`,
      });
    }
    seen.add(c.id);
  }

  return {
    cleanText: clean,
    frontmatter,
    comments: outComments,
    editMarks,
    issues,
    sourceMap: segments.map((s) => ({
      raw: s.raw + fmU16,
      clean: s.clean,
      length: s.length,
    })),
  };
}
