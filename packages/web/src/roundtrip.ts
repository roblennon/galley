import { cpSlice, parse, type PatchBatch } from '@galley/core';

export function createDemoBatch(text: string): PatchBatch | null {
  const parsed = parse(text);
  const comments = parsed.comments.filter((comment) => !comment.carrier && comment.id !== null);
  const target = comments.find((comment) => comment.scope === 'span');
  if (!target?.id) return null;
  const anchor = cpSlice(parsed.cleanText, target.anchor.start, target.anchor.end);
  if (!anchor) return null;
  return {
    spec: 1,
    responses: comments.map((comment) => ({
      comment: comment.id!,
      status: comment.id === target.id ? 'patched' : 'no-change-needed',
      note:
        comment.id === target.id
          ? 'Sample response for demonstrating the patch workflow.'
          : 'Left unchanged by the sample response.',
    })),
    patches: [
      {
        type: 'span',
        find: anchor,
        replace: `${anchor} — revised`,
        comments: [target.id],
      },
    ],
  };
}
