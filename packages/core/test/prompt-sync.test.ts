import { describe, expect, it } from 'vitest';
import { AI_REVIEW_PREAMBLE } from '../src/index.js';
import { readRepoFile } from './helpers.js';

/** The reference prompt is how a model learns to emit the format, so it is a
 * versioned artifact rather than adapter code. `prompts/review-request.md` is
 * the portable copy other implementations read; the exported constant is what
 * bundled adapters use. These tests keep the two honest, and keep the prompt
 * from teaching rules the spec does not have. */
describe('the reference prompt stays in sync', () => {
  const promptFile = readRepoFile('prompts/review-request.md');
  const spec = readRepoFile('SPEC.md');

  /** Body of prompts/review-request.md, after the YAML frontmatter. */
  const body = (() => {
    const end = promptFile.indexOf('\n---\n', 4);
    if (end < 0) throw new Error('prompt file has no frontmatter');
    return promptFile.slice(end + 5).replace(/^\n/, '');
  })();

  it('matches prompts/review-request.md byte for byte', () => {
    expect(body).toBe(AI_REVIEW_PREAMBLE);
  });

  it('declares the spec version it targets', () => {
    expect(promptFile).toMatch(/^---\nspec: 1\n/);
  });

  it('teaches exactly the response statuses SPEC §8 defines', () => {
    const specStatuses = [...spec.matchAll(/^\| `([a-z-]+)` \| /gm)].map((m) => m[1]!);
    expect(specStatuses).toEqual([
      'patched',
      'no-change-needed',
      'needs-input',
      'declined',
    ]);

    // The prompt's status union, read from the "status": line it teaches.
    const line = /"status":\s*([^,\n]+)/.exec(AI_REVIEW_PREAMBLE);
    if (!line) throw new Error('prompt no longer teaches a "status" field');
    const promptStatuses = line[1]!
      .split('|')
      .map((part) => part.trim().replace(/^"|"$/g, ''));

    // Neither direction may drift: no spec status missing, none invented.
    expect(promptStatuses).toEqual(specStatuses);
  });

  it('states the same find-length guidance as SPEC §8', () => {
    expect(spec).toContain('`find` SHOULD NOT exceed 200 characters');
    expect(AI_REVIEW_PREAMBLE).toContain('under 200 characters');
  });

  it('documents every mark type the spec defines', () => {
    for (const mark of ['{==', '{>>', '{--', '{++', '{~~']) {
      expect(AI_REVIEW_PREAMBLE).toContain(mark);
    }
  });
});
