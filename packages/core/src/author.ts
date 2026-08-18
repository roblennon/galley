import { parse } from './parse.js';
import { recompose } from './recompose.js';
import { blockRanges, blockAtOrBefore, blockContaining } from './blocks.js';
import { cpLength, cpSlice } from './unicode.js';
import { generateId } from './id.js';
import type { Comment, Range } from './types.js';

export type CommentTarget =
  | { start: number; end: number }
  | { offset: number }
  | { block: number }
  | 'document';

export interface AddCommentOptions {
  body: string;
  /** Span `{start, end}`, point `{offset}`, `{block: offset}` for the block
   * containing that offset, or 'document'. Offsets are code points over
   * clean text. */
  at: CommentTarget;
  /** Explicit identifier; generated when omitted. */
  id?: string;
  /** Passed through to `generateId` (SPEC §5.1 merge safety). */
  sessionPrefix?: string;
}

const ID_RE = /^[A-Za-z0-9]{1,8}$/;

function intersects(a: Range, b: Range): boolean {
  return a.start < b.end && b.start < a.end;
}

function boundaryInside(p: number, r: Range): boolean {
  return p > r.start && p < r.end;
}

/**
 * Insert a comment into an annotated document. The adapter decides where the
 * user meant; this decides what the bytes become. Enforces the anchoring
 * rules of SPEC §6.2 and throws on violations.
 */
export function addComment(
  text: string,
  options: AddCommentOptions,
): { text: string; id: string; comment: Comment } {
  const { body, at } = options;
  if (typeof body !== 'string') throw new Error('body must be a string');
  if (body.includes('<<}')) {
    throw new Error(
      "comment body cannot contain the comment closing delimiter '<<}' (SPEC §6.1)",
    );
  }

  const parsed = parse(text);
  const clean = parsed.cleanText;
  const len = cpLength(clean);
  const blocks = blockRanges(clean);

  const existing = new Set<string>();
  for (const c of parsed.comments) if (c.id !== null) existing.add(c.id);

  let id: string;
  if (options.id !== undefined) {
    if (!ID_RE.test(options.id)) {
      throw new Error(
        `invalid identifier '${options.id}': must match [A-Za-z0-9]{1,8} (SPEC §5.1)`,
      );
    }
    if (existing.has(options.id)) {
      throw new Error(`identifier '${options.id}' already exists in document`);
    }
    id = options.id;
  } else {
    ({ id } = generateId({
      existing,
      ...(options.sessionPrefix !== undefined
        ? { sessionPrefix: options.sessionPrefix }
        : {}),
    }));
  }

  const comment: Comment = {
    id,
    scope: 'point',
    body,
    anchor: { start: 0, end: 0 },
    flags: [],
  };

  if (at === 'document') {
    comment.scope = 'document';
    comment.anchor = { start: 0, end: len };
  } else if ('block' in at) {
    if (at.block < 0 || at.block > len) {
      throw new Error(`block target offset ${at.block} out of range`);
    }
    const block =
      blockContaining(blocks, at.block) ?? blockAtOrBefore(blocks, at.block);
    if (!block) throw new Error('document has no block to attach to');
    // The comment's line reinserts just past the block; that point must not
    // fall inside an existing anchor or edit mark, or recomposition would
    // nest the note inside it.
    const insertion =
      block.end < len && cpSlice(clean, block.end, block.end + 1) === '\n'
        ? block.end + 1
        : block.end;
    for (const c of parsed.comments) {
      if (c.scope === 'span' && boundaryInside(insertion, c.anchor)) {
        throw new Error(
          'block comment would land inside an existing anchor (SPEC §6.2)',
        );
      }
    }
    for (const m of parsed.editMarks) {
      if (boundaryInside(insertion, m.range)) {
        throw new Error(
          'block comment would land inside an edit mark (SPEC §6.3)',
        );
      }
    }
    comment.scope = 'block';
    comment.anchor = { ...block };
  } else if ('offset' in at) {
    if (at.offset < 0 || at.offset > len) {
      throw new Error(`point offset ${at.offset} out of range`);
    }
    // A bare mark with newlines (or document edges) on both sides would
    // re-parse as a block or document comment — the format cannot represent
    // a point between paragraphs (SPEC §6.1).
    const prev = at.offset === 0 ? '\n' : cpSlice(clean, at.offset - 1, at.offset);
    const next = at.offset === len ? '\n' : cpSlice(clean, at.offset, at.offset + 1);
    if (prev === '\n' && next === '\n') {
      throw new Error(
        'a point comment cannot anchor between paragraphs; use a block or document comment (SPEC §6.1)',
      );
    }
    for (const c of parsed.comments) {
      if (c.scope === 'span' && boundaryInside(at.offset, c.anchor)) {
        throw new Error('point anchor would nest inside an existing anchor (SPEC §6.2)');
      }
    }
    for (const m of parsed.editMarks) {
      if (boundaryInside(at.offset, m.range)) {
        throw new Error('point anchor would fall inside an edit mark (SPEC §6.3)');
      }
    }
    comment.scope = 'point';
    comment.anchor = { start: at.offset, end: at.offset };
  } else {
    const { start, end } = at;
    if (!(start >= 0 && end <= len && start < end)) {
      throw new Error(`invalid span [${start}, ${end}) over clean text of length ${len}`);
    }
    const anchorText = cpSlice(clean, start, end);
    if (/\n[ \t]*\n/.test(anchorText)) {
      throw new Error('anchor must not cross a block boundary (SPEC §6.2)');
    }
    if (anchorText.includes('==}')) {
      throw new Error(
        "anchor text cannot contain the highlight closing delimiter '==}' (SPEC §6.2)",
      );
    }
    for (const c of parsed.comments) {
      if (c.scope === 'span' && intersects({ start, end }, c.anchor)) {
        throw new Error('anchors must not overlap or nest (SPEC §6.2)');
      }
      if (
        c.scope === 'point' &&
        boundaryInside(c.anchor.start, { start, end })
      ) {
        throw new Error('anchor would nest an existing point comment (SPEC §6.2)');
      }
    }
    for (const m of parsed.editMarks) {
      if (boundaryInside(start, m.range) || boundaryInside(end, m.range)) {
        throw new Error('anchor must not begin or end inside an edit mark (SPEC §6.3)');
      }
    }
    comment.scope = 'span';
    comment.anchor = { start, end };
  }

  const { text: outText } = recompose({
    cleanText: clean,
    frontmatter: parsed.frontmatter,
    comments: [...parsed.comments, comment],
    editMarks: parsed.editMarks,
  });
  return { text: outText, id, comment };
}
