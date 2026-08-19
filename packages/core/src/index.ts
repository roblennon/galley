export { parse, normalizeLineEndings, splitCommentContent } from './parse.js';
export { recompose } from './recompose.js';
export { applyBatch } from './apply.js';
export type { ApplyOptions } from './apply.js';
export { resolveEditMarks, exportFinalText } from './marks.js';
export type { ResolveMarksOptions } from './marks.js';
export { addComment } from './author.js';
export type { AddCommentOptions, CommentTarget } from './author.js';
export { removeComment } from './remove.js';
export { validate } from './validate.js';
export { SPEC_VERSION } from './types.js';
export { AI_REVIEW_PREAMBLE } from './prompt.js';
export { generateId, existingIds, ID_ALPHABET } from './id.js';
export type { GenerateIdOptions } from './id.js';
export { blockRanges } from './blocks.js';
export { rawToClean, snapRawToClean, cleanToRaw } from './sourcemap.js';
export { cpLength, cpSlice, cpToUtf16, utf16ToCp } from './unicode.js';
// Explicit, not `export *`: with a wildcard, anything later added to types.ts
// would become permanent public API by accident (GAL-REV-010).
export type {
  Scope,
  Range,
  IssueSeverity,
  Issue,
  EditKind,
  SourceRange,
  SourceSegment,
  CommentSource,
  EditMark,
  CommentPlacement,
  Comment,
  ParseResult,
  ResponseStatus,
  CommentResponse,
  SpanPatch,
  BlockPatch,
  Patch,
  PatchBatch,
  AppliedPatch,
  RejectedPatch,
  ResponseIssue,
  ApplyReport,
} from './types.js';
