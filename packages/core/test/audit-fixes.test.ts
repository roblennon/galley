import { describe, expect, it } from 'vitest';
import {
  applyBatch,
  parse,
  recompose,
  validate,
  SPEC_VERSION,
} from '../src/index.js';
import type { Comment, PatchBatch } from '../src/index.js';
import { readRepoFile } from './helpers.js';

/**
 * One test per finding from the pre-publish audit, asserting the fixed
 * behavior. Each names the guard it pins so a future refactor that drops it
 * fails here rather than in a user's document.
 */

const point = (over: Partial<Comment> = {}): Comment => ({
  id: 'a1a',
  scope: 'point',
  body: 'note',
  anchor: { start: 5, end: 5 },
  flags: [],
  ...over,
});

describe('recompose refuses to emit a comment that would not parse back (SPEC §6.1)', () => {
  const base = parse('Hello world.\n');

  it('throws on a body containing the closing delimiter', () => {
    expect(() =>
      recompose({ ...base, comments: [point({ body: 'bad <<} body' })] }),
    ).toThrow(/closing delimiter/);
  });

  it('throws on an identifier that is not well-formed', () => {
    expect(() =>
      recompose({ ...base, comments: [point({ id: 'has.dot' })] }),
    ).toThrow(/not a valid identifier/);
    expect(() =>
      recompose({ ...base, comments: [point({ id: 'toolongidentifier' })] }),
    ).toThrow(/not a valid identifier/);
  });

  it('throws on an anchor outside the clean text', () => {
    expect(() =>
      recompose({
        ...base,
        comments: [point({ scope: 'span', anchor: { start: 5, end: 900 } })],
      }),
    ).toThrow(/out of range/);
    expect(() =>
      recompose({
        ...base,
        comments: [point({ anchor: { start: -1, end: -1 } })],
      }),
    ).toThrow(/out of range/);
  });

  it('still emits a well-formed comment (the guards are not blanket)', () => {
    const { text } = recompose({ ...base, comments: [point()] });
    expect(text).toBe('Hello{>>[a1a] note<<} world.\n');
  });
});

describe('applyBatch input hardening', () => {
  it('rejects a find containing an unpaired surrogate, leaving the document intact', () => {
    const doc = 'Emoji 😀 here.{>>[s1s] note<<}\n';
    const { text, report } = applyBatch(doc, {
      spec: 1,
      responses: [{ comment: 's1s', status: 'declined' }],
      patches: [{ type: 'span', find: '\uD83D', replace: 'X', reason: 'x' }],
    });
    expect(text).toBe(doc);
    expect(report.applied).toEqual([]);
    expect(report.rejected).toEqual([
      {
        index: 0,
        code: 'invalid-patch',
        message:
          'find contains an unpaired surrogate and cannot match document text',
      },
    ]);
    // The whole astral character does match, so the guard is surrogate-specific.
    const ok = applyBatch(doc, {
      spec: 1,
      responses: [{ comment: 's1s', status: 'declined' }],
      patches: [{ type: 'span', find: '😀', replace: 'X', reason: 'x' }],
    });
    expect(ok.report.applied).toHaveLength(1);
  });

  it('rejects a blank line in replace when the match lands inside an anchor', () => {
    const doc = 'x {==abc==}{>>[b1b] note<<} y\n';
    const { text, report } = applyBatch(doc, {
      spec: 1,
      responses: [{ comment: 'b1b', status: 'patched' }],
      patches: [
        { type: 'span', find: 'b', replace: 'Q\n\nR', comments: ['b1b'] },
      ],
    });
    expect(text).toBe(doc);
    expect(report.rejected[0]).toMatchObject({
      index: 0,
      code: 'invalid-patch',
    });
    expect(report.rejected[0]!.message).toMatch(/block boundary/);
    expect(validate(text)).toEqual({ valid: true, issues: [] });
  });

  it('rejects a blank line in replace when the match lands inside an edit mark', () => {
    const doc = 'Keep {--this --}word.\n';
    const { text, report } = applyBatch(doc, {
      spec: 1,
      responses: [],
      patches: [{ type: 'span', find: 'his', replace: 'Q\n\nR', reason: 'x' }],
    });
    expect(text).toBe(doc);
    expect(report.rejected[0]!.code).toBe('invalid-patch');
    expect(validate(text).valid).toBe(true);
  });

  // A skeptic pass caught the first version of this guard rejecting every
  // paragraph split in any document carrying a document-level note, because a
  // document anchor spans the whole file. Only a span anchor can be split.
  it('allows a paragraph split in a document that has a document-scope comment', () => {
    const doc = '{>>[d1d] overall<<}\n\nHello world.\n';
    const { text, report } = applyBatch(doc, {
      spec: 1,
      responses: [{ comment: 'd1d', status: 'declined' }],
      patches: [{ type: 'span', find: 'Hello', replace: 'Hi\n\nthere', reason: 'split' }],
    });
    expect(report.rejected).toEqual([]);
    expect(report.applied).toHaveLength(1);
    expect(validate(text).valid).toBe(true);
  });

  it('allows a paragraph split that lands inside a block comment\u2019s own block', () => {
    const doc = 'One two three.\n\n{>>[b1] note<<}\n';
    const { text, report } = applyBatch(doc, {
      spec: 1,
      responses: [{ comment: 'b1', status: 'declined' }],
      patches: [{ type: 'span', find: 'two', replace: 'X\n\nY', reason: 'split' }],
    });
    expect(report.rejected).toEqual([]);
    expect(validate(text).valid).toBe(true);
    expect(text).toContain('[b1]');
  });

  it('allows a blank line in replace outside any annotation', () => {
    const doc = 'Alpha bravo.\n\nKeep {--this --}word.\n';
    const { text, report } = applyBatch(doc, {
      spec: 1,
      responses: [],
      patches: [{ type: 'span', find: 'bravo', replace: 'B\n\nC', reason: 'x' }],
    });
    expect(report.rejected).toEqual([]);
    expect(validate(text).valid).toBe(true);
  });

  it('rejects a block patch that names a document-scoped comment (SPEC §8.4)', () => {
    const doc = '{>>[d1d] overall<<}\n\nHello world.\n';
    const { text, report } = applyBatch(doc, {
      spec: 1,
      responses: [{ comment: 'd1d', status: 'patched' }],
      patches: [{ type: 'block', comment: 'd1d', replace: 'New.' }],
    });
    expect(text).toBe(doc);
    expect(report.applied).toEqual([]);
    expect(report.rejected[0]).toMatchObject({
      index: 0,
      code: 'invalid-patch',
    });
    expect(report.rejected[0]!.message).toMatch(/document-scoped/);
  });

  it('refuses the whole batch when the document has duplicate identifiers (SPEC §5.1)', () => {
    const doc = 'a{>>[x1] one<<} b{>>[x1] two<<}\n';
    const { text, report } = applyBatch(doc, {
      spec: 1,
      responses: [{ comment: 'x1', status: 'patched' }],
      patches: [
        { type: 'span', find: 'a', replace: 'A', reason: 'x' },
        { type: 'span', find: 'b', replace: 'B', reason: 'y' },
      ],
    });
    expect(text).toBe(doc);
    expect(report.applied).toEqual([]);
    expect(report.rejected.map((r) => r.index)).toEqual([0, 1]);
    expect(report.rejected[0]!.message).toMatch(/duplicate identifiers/);
    expect(report.issues.some((i) => i.code === 'duplicate-id')).toBe(true);
  });

  it('rejects null patches, null responses, and a throwing type without throwing', () => {
    const doc = 'Plain text.{>>[n1n] note<<}\n';
    const hostile = {
      type: {
        toString() {
          throw new Error('boom');
        },
      },
      find: 'Plain',
      replace: 'X',
    };
    const batch = {
      spec: 1,
      responses: [null],
      patches: [null, hostile],
    } as unknown as PatchBatch;

    let result: ReturnType<typeof applyBatch>;
    expect(() => {
      result = applyBatch(doc, batch);
    }).not.toThrow();

    expect(result!.text).toBe(doc);
    expect(result!.report.applied).toEqual([]);
    expect(result!.report.rejected).toEqual([
      { index: 0, code: 'invalid-patch', message: 'patch is not an object' },
      {
        index: 1,
        code: 'invalid-patch',
        message: 'unknown patch type [object]',
      },
    ]);
    expect(
      result!.report.responseIssues.some((i) => i.code === 'unknown-comment'),
    ).toBe(true);
  });

  it('matches a CRLF find against a CRLF document (SPEC §7 normalization)', () => {
    const doc = 'alpha\r\nbravo here.{>>[c1c] note<<}\r\n';
    const { text, report } = applyBatch(doc, {
      spec: 1,
      responses: [{ comment: 'c1c', status: 'patched' }],
      patches: [
        {
          type: 'span',
          find: 'alpha\r\nbravo',
          replace: 'A B',
          comments: ['c1c'],
        },
      ],
    });
    expect(report.rejected).toEqual([]);
    expect(report.applied).toHaveLength(1);
    expect(text).toBe('A B here.{>>[c1c] note<<}\n');
  });
});

describe('report.answeredInline (SPEC §10.2)', () => {
  it('names a comment whose attributed patch edited within its surviving anchor', () => {
    const doc = 'alpha {==bravo charlie==}{>>[ai1] tighten<<} delta.\n';
    const { text, report } = applyBatch(doc, {
      spec: 1,
      responses: [{ comment: 'ai1', status: 'patched' }],
      patches: [
        { type: 'span', find: 'bravo', replace: 'BRAVO', comments: ['ai1'] },
      ],
    });
    expect(text).toBe('alpha {==BRAVO charlie==}{>>[ai1] tighten<<} delta.\n');
    // The anchor survived, so the comment neither resolved nor went unaddressed:
    // answeredInline is the only place it is reported.
    expect(report.answeredInline).toEqual(['ai1']);
    expect(report.resolved).toEqual([]);
    expect(report.unaddressed).toEqual([]);
    expect(report.orphaned).toEqual([]);
  });

  it('is empty when the attributed patch destroys the anchor (that is resolved)', () => {
    const doc = 'alpha {==bravo charlie==}{>>[ai2] tighten<<} delta.\n';
    const { report } = applyBatch(doc, {
      spec: 1,
      responses: [{ comment: 'ai2', status: 'patched' }],
      patches: [
        {
          type: 'span',
          find: 'bravo charlie',
          replace: 'brief',
          comments: ['ai2'],
        },
      ],
    });
    expect(report.answeredInline).toEqual([]);
    expect(report.resolved.map((r) => r.id)).toEqual(['ai2']);
  });
});

describe('SPEC_VERSION is exported and tracks SPEC.md', () => {
  it('equals the spec version SPEC.md declares', () => {
    const spec = readRepoFile('SPEC.md');
    const m = /\*\*Spec version:\*\*\s*(\d+)/.exec(spec);
    expect(m, 'SPEC.md must declare "**Spec version:** N"').not.toBeNull();
    expect(SPEC_VERSION).toBe(Number(m![1]));
  });
});

/** Guards that existed but had no test: reverting each one left the suite
 * green, which is the definition of coverage that only looks like protection.
 * Each of these was confirmed to fail with its guard removed. */
describe('guards the mutation audit found untested', () => {
  it('recompose rejects an out-of-range placement position', () => {
    const layer = parse('Hello world.\n');
    layer.comments.push({
      id: 'a1a',
      scope: 'block',
      body: 'note',
      anchor: { start: 0, end: 12 },
      flags: [],
      placement: { pos: 900, before: '\n', after: '\n' },
    } as Comment);
    // Without the check, cpU16[900] is undefined, slice runs to the end, and
    // the document body is emitted twice.
    expect(() => recompose(layer)).toThrow(/placement position/);
  });

  it('rejects a find longer than the cap rather than scanning for it', () => {
    const { report } = applyBatch('Alpha bravo charlie.\n', {
      spec: 1,
      responses: [],
      patches: [{ type: 'span', find: 'q'.repeat(5000), replace: 'x', reason: 'r' }],
    });
    expect(report.rejected).toHaveLength(1);
    expect(report.rejected[0]!.code).toBe('invalid-patch');
    expect(report.rejected[0]!.message).toMatch(/code points/);
  });

  it('rejects a replace that would write an unpaired surrogate', () => {
    const { text, report } = applyBatch('Emoji \u{1F600} here.\n', {
      spec: 1,
      responses: [],
      patches: [{ type: 'span', find: ' here', replace: '\uD83D', reason: 'r' }],
    });
    expect(report.rejected[0]!.code).toBe('invalid-patch');
    // It would not survive being written as UTF-8, and no later patch could
    // match it to remove it.
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(text)).toBe(false);
  });

  it('rejects a tracked edit whose own range spans a block boundary', () => {
    const doc = 'Para one.\n\nPara two.\n';
    const { text, report } = applyBatch(
      doc,
      {
        spec: 1,
        responses: [],
        patches: [
          { type: 'span', find: 'one.\n\nPara two', replace: 'one. Para two', reason: 'j' },
        ],
      },
      { asEditMarks: true },
    );
    // The edit's extent becomes the mark, and an edit mark must not span a
    // block boundary (SPEC §6.3).
    expect(report.rejected[0]!.code).toBe('conflict');
    expect(text).toBe(doc);
    expect(validate(text).valid).toBe(true);
  });

  it('rejects comments given as a bare string instead of an array', () => {
    const { report } = applyBatch('Alpha {==bravo==}{>>[a1] n<<} charlie.\n', {
      spec: 1,
      responses: [{ comment: 'a1', status: 'patched' }],
      patches: [
        { type: 'span', find: 'bravo', replace: 'X', comments: 'a1' },
      ],
    } as unknown as PatchBatch);
    // Silently accepted before, as an unattributed patch: the comment never
    // resolved and the patch lost precedence, with nothing reported.
    expect(report.rejected[0]!.code).toBe('invalid-patch');
  });

  it('does not throw on a null or non-object batch', () => {
    const doc = 'Alpha bravo.\n';
    for (const bad of [null, undefined, 'nope', 42]) {
      expect(() => applyBatch(doc, bad as unknown as PatchBatch)).not.toThrow();
    }
  });

  it('answeredInline names a comment only when an applied edit fell inside its anchor', () => {
    const doc = 'The quick brown fox jumps over it.\n';
    const withComment = applyBatch(doc, { spec: 1, responses: [], patches: [] });
    expect(withComment.report.answeredInline).toEqual([]);

    const annotated = 'The {==quick brown fox==}{>>[b1] tighten<<} jumps.\n';
    const rejectedPatch = applyBatch(annotated, {
      spec: 1,
      responses: [{ comment: 'b1', status: 'patched' }],
      patches: [{ type: 'span', find: 'NOT PRESENT', replace: 'x', comments: ['b1'] }],
    });
    // A rejected patch must not report its comment as answered.
    expect(rejectedPatch.report.rejected).toHaveLength(1);
    expect(rejectedPatch.report.answeredInline).toEqual([]);

    const inside = applyBatch(annotated, {
      spec: 1,
      responses: [{ comment: 'b1', status: 'patched' }],
      patches: [{ type: 'span', find: 'brown', replace: 'red', comments: ['b1'] }],
    });
    expect(inside.report.answeredInline).toEqual(['b1']);
  });
});

describe('byte order marks', () => {
  const BOM = '﻿';

  it('does not let a BOM shift offsets or hide frontmatter', () => {
    const doc = `${BOM}---\ntitle: x\n---\n\nBody {==here==}{>>[a1b] why<<}.\n`;
    const parsed = parse(doc);
    expect(parsed.bom).toBe(true);
    expect(parsed.frontmatter).not.toBeNull();
    expect(parsed.cleanText.startsWith('Body')).toBe(true);
    // Byte-exact including the mark itself.
    expect(recompose(parsed).text).toBe(doc);
  });

  it('keeps a leading document comment at document scope', () => {
    expect(parse(`${BOM}{>>[d1d] doc note<<}\n\nBody.\n`).comments[0]!.scope).toBe(
      'document',
    );
  });

  it('preserves the mark through applyBatch', () => {
    const doc = `${BOM}Body {==here==}{>>[a1b] why<<}.\n`;
    const { text } = applyBatch(doc, {
      spec: 1,
      responses: [{ comment: 'a1b', status: 'patched' }],
      patches: [{ type: 'span', find: 'here', replace: 'there', comments: ['a1b'] }],
    });
    expect(text.charCodeAt(0)).toBe(0xfeff);
  });

  it('does not invent a mark for documents that never had one', () => {
    expect(recompose(parse('Plain.\n')).text).toBe('Plain.\n');
  });
});

/** Stacked block comments after a run of blank lines. parse recorded each
 * comment's position against clean text as it stood at that moment, so a later
 * one truncating further left an earlier position past the end. Pre-existing on
 * main, and on the publish path. */
describe('stacked block comments', () => {
  it('does not throw on a paragraph followed by two block comments', () => {
    expect(() =>
      parse('Alpha.\n\n\n{>>[a1] one<<}\n{>>[b2] two<<}\n'),
    ).not.toThrow();
  });

  it('round-trips them without reordering or injecting mid-word', () => {
    const doc = ' extra\n\n\n{>>[b1] note<<}\n{>>[b2] note<<}\nShort.\n';
    // Previously emitted the second comment first and spliced the other into
    // the middle of "Short."
    expect(recompose(parse(doc)).text).toBe(doc);
  });

  it('appends only one separator when several block comments land at the end', () => {
    const doc = 'kilo rewritten.';
    const layer = parse(doc);
    for (const id of ['c1', 'c2']) {
      layer.comments.push({
        id,
        scope: 'block',
        body: 'note',
        anchor: { start: 0, end: doc.length },
        flags: [],
      } as Comment);
    }
    // SPEC §7 allows exactly one trailing newline here; each comment used to
    // re-add the separator computed against the original text.
    expect(parse(recompose(layer).text).cleanText).toBe('kilo rewritten.\n');
  });
});
