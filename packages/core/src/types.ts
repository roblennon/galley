/** Scope of a comment, determined by placement (SPEC §6.1). */
/** The spec version this library implements (SPEC §12 requires implementations
 * declare it). Independent of the package version. */
export const SPEC_VERSION = 1;

export type Scope = 'span' | 'point' | 'block' | 'document';

/**
 * Half-open range `[start, end)` in Unicode code points over clean text
 * (SPEC §7).
 */
export interface Range {
  start: number;
  end: number;
}

export type IssueSeverity = 'error' | 'warning';

/** A parse or validation finding. `index` is a code-point offset into the
 * normalized annotated document. */
export interface Issue {
  severity: IssueSeverity;
  code: string;
  message: string;
  index?: number;
}

export type EditKind = 'insertion' | 'deletion' | 'substitution';

/**
 * UTF-16 range into the normalized annotated document. Source ranges are an
 * implementation aid for editor adapters (decorations, selection mapping) —
 * they are not part of the spec's data model, and JS editors address
 * documents in UTF-16 code units.
 */
export interface SourceRange {
  start: number;
  end: number;
}

/** One verbatim-copied chunk: `length` UTF-16 units starting at `raw` in the
 * annotated document equal the same units starting at `clean` in clean text. */
export interface SourceSegment {
  raw: number;
  clean: number;
  length: number;
}

export interface CommentSource {
  /** Full raw extent of the comment's syntax (span: '{==' through '<<}'). */
  extent: SourceRange;
  /** Span comments: the '{==' opener. */
  open?: SourceRange;
  /** Span comments: raw range of the highlighted content. */
  anchorRaw?: SourceRange;
  /** Span comments: '==}' plus the comment mark. */
  tail?: SourceRange;
}

/** An inline insertion, deletion, or substitution (SPEC §6.3). `range` covers
 * the mark's original-text contribution to clean text (zero-width for
 * insertions). */
export interface EditMark {
  kind: EditKind;
  range: Range;
  /** Text the mark contributes to clean text ('' for insertions). */
  original: string;
  /** Text after applying the mark ('' for deletions). */
  proposed: string;
  /** Identifier of an empty-bodied comment attached immediately after the
   * mark, if any (SPEC §6.3). */
  commentId: string | null;
  /** Raw extent of the mark's syntax; present on parsed marks. */
  source?: SourceRange;
}

/** Reconstruction metadata for block and document comments: where the mark's
 * line reinserts into clean text, and the exact whitespace around it. */
export interface CommentPlacement {
  /** Code-point offset in clean text where the comment's line reinserts. */
  pos: number;
  /** Whitespace emitted before the mark on reinsertion. */
  before: string;
  /** Whitespace emitted after the mark on reinsertion. */
  after: string;
}

export interface Comment {
  id: string | null;
  scope: Scope;
  body: string;
  /**
   * Anchor over clean text. Span: the highlighted range. Point: zero-width.
   * Block: the range of the block the comment attaches to. Document: the
   * whole clean text.
   */
  anchor: Range;
  /** 'anchor-modified' | 'anchor-lost' (SPEC §10.1). */
  flags: string[];
  /** Present on block/document comments parsed from text; used for
   * byte-exact recomposition. Optional on hand-built comments. */
  placement?: CommentPlacement;
  /** Separator between `[id]` and body as parsed (' ' or ''). Recompose
   * default: ' ' when the body is non-empty. */
  bodySep?: string;
  /** True when this comment exists only to carry an identifier for the edit
   * mark it immediately follows; it is serialized with that mark. */
  carrier?: boolean;
  /** Raw ranges of this comment's syntax; present on parsed comments. */
  source?: CommentSource;
}

export interface ParseResult {
  /** The document with all annotation syntax removed (SPEC §7). */
  cleanText: string;
  /** True when the source began with a UTF-8 byte order mark. It is stripped
   * before parsing — left in place it shifts every offset by one, hides
   * frontmatter behind it, and turns a document comment into a point comment —
   * and restored by `recompose` so the round trip stays byte-exact. */
  bom: boolean;
  /** Raw YAML frontmatter including delimiters and trailing blank lines, or
   * null if absent. Not part of clean text. */
  frontmatter: string | null;
  comments: Comment[];
  editMarks: EditMark[];
  issues: Issue[];
  /** Verbatim raw↔clean segments (UTF-16, sorted); see `rawToClean` and
   * `cleanToRaw`. Offsets address the normalized annotated document. */
  sourceMap: SourceSegment[];
}

/** Response statuses (SPEC §8.2). */
export type ResponseStatus =
  | 'patched'
  | 'no-change-needed'
  | 'needs-input'
  | 'declined';

export interface CommentResponse {
  comment: string;
  status: ResponseStatus;
  note?: string;
}

export interface SpanPatch {
  type: 'span';
  find: string;
  replace: string;
  comments?: string[];
  reason?: string;
}

export interface BlockPatch {
  type: 'block';
  comment: string;
  replace: string;
  comments?: string[];
  reason?: string;
}

export type Patch = SpanPatch | BlockPatch;

export interface PatchBatch {
  spec: number;
  responses: CommentResponse[];
  patches: Patch[];
}

export interface AppliedPatch {
  /** Index into `batch.patches`. */
  index: number;
  type: Patch['type'];
  /** Located range in the original clean text (code points). */
  range: Range;
}

export interface RejectedPatch {
  index: number;
  code:
    | 'no-match'
    | 'ambiguous'
    | 'conflict'
    | 'unknown-comment'
    | 'invalid-patch';
  message: string;
  /** For 'no-match': the closest candidate text found (SPEC §8.3). */
  closest?: string;
}

export interface ResponseIssue {
  code:
    | 'missing-response'
    | 'duplicate-response'
    | 'unknown-comment'
    | 'invalid-status';
  message: string;
  comment?: string;
}

export interface ApplyReport {
  applied: AppliedPatch[];
  rejected: RejectedPatch[];
  /** Comments resolved by an attributed patch; bodies belong in marginalia. */
  resolved: { id: string; body: string }[];
  /** Comments orphaned by an unattributed patch (demoted to block scope,
   * flagged 'anchor-lost'). */
  orphaned: string[];
  /** Comments whose anchors were clipped to a surviving portion and flagged
   * 'anchor-modified' (SPEC §10.1). */
  anchorModified: string[];
  /** Identified comments not referenced by any patch in the batch. */
  unaddressed: string[];
  /** Comments a patch was attributed to whose anchor survived, so they remain
   * inline. The commonest editing shape — a rewrite *within* the anchored
   * sentence — lands here rather than in `resolved`, and an adapter needs to
   * know so it can decide whether the note still applies (SPEC §10.1). */
  answeredInline: string[];
  responseIssues: ResponseIssue[];
  /** Edit marks whose original text was overwritten by a patch. */
  editMarksDropped: number;
  /** Parse issues found in the input document. */
  issues: Issue[];
}
