import {
  blockRanges,
  cpLength,
  cpSlice,
  parse,
  snapRawToClean,
  utf16ToCp,
  type AddCommentOptions,
} from '@galley/core';

export interface CollapsedContext {
  pointValid: boolean;
  blockSnippet: string;
}

export type Target =
  | { kind: 'span'; at: AddCommentOptions['at'] }
  | {
      kind: 'collapsed';
      point: AddCommentOptions['at'];
      block: AddCommentOptions['at'];
      /** False when the cursor sits between paragraphs, where a bare point
       * mark is unrepresentable (SPEC §6.1). */
      pointValid: boolean;
      /** Head of the paragraph the block option would attach to. */
      blockSnippet: string;
    };

/** Context for a collapsed selection: point validity and its block target. */
export function collapsedContext(cleanText: string, cp: number): CollapsedContext {
  const len = cpLength(cleanText);
  const prev = cp === 0 ? '\n' : cpSlice(cleanText, cp - 1, cp);
  const next = cp === len ? '\n' : cpSlice(cleanText, cp, cp + 1);
  const pointValid = !(prev === '\n' && next === '\n');
  const blocks = blockRanges(cleanText);
  const target =
    blocks.find((block) => cp >= block.start && cp <= block.end) ??
    [...blocks].reverse().find((block) => block.start <= cp) ??
    blocks[0];
  let blockSnippet = '';
  if (target) {
    const head = cpSlice(
      cleanText,
      target.start,
      Math.min(target.end, target.start + 42),
    );
    blockSnippet = target.end - target.start > 42 ? `${head}…` : head;
  }
  return { pointValid, blockSnippet };
}

/**
 * Map raw UTF-16 editor offsets to clean-text code-point targets.
 *
 * Selection ends snap inward (start rightward, end leftward) so a sloppy
 * selection that grazes an annotation's syntax still means the prose inside
 * it; a selection that collapses after snapping falls back to a point target.
 */
export function computeTarget(text: string, fromU16: number, toU16: number): Target {
  const { cleanText, sourceMap } = parse(text);
  if (fromU16 === toU16) {
    const cleanU16 = snapRawToClean(sourceMap, fromU16, 'left');
    const cp = utf16ToCp(cleanText, cleanU16);
    return {
      kind: 'collapsed',
      point: { offset: cp },
      block: { block: cp },
      ...collapsedContext(cleanText, cp),
    };
  }
  const startU16 = snapRawToClean(sourceMap, fromU16, 'right');
  const endU16 = snapRawToClean(sourceMap, toU16, 'left');
  if (endU16 <= startU16) {
    const cp = utf16ToCp(
      cleanText,
      snapRawToClean(sourceMap, fromU16, 'left'),
    );
    return {
      kind: 'collapsed',
      point: { offset: cp },
      block: { block: cp },
      ...collapsedContext(cleanText, cp),
    };
  }
  return {
    kind: 'span',
    at: {
      start: utf16ToCp(cleanText, startU16),
      end: utf16ToCp(cleanText, endU16),
    },
  };
}
