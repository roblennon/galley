import { describe, expect, it } from 'vitest';
import {
  addComment,
  applyBatch,
  blockRanges,
  existingIds,
  generateId,
  parse,
  recompose,
  splitCommentContent,
} from '../src/index.js';

/**
 * Guards that exist in the source but survived a mutation-testing pass: every
 * planted bug in the lines below went undetected by the example-based suite.
 * Each test here is written to fail if its guard is removed or weakened.
 */

describe('tracked changes: a patch may not clip one end of an anchor (SPEC §6.2)', () => {
  const doc = 'x {==abc==}{>>[s1a] note<<} y\n';
  const declined = [{ comment: 's1a', status: 'declined' as const }];

  it('rejects a patch straddling the start of an unattributed anchor', () => {
    const { text, report } = applyBatch(
      doc,
      {
        spec: 1,
        responses: declined,
        patches: [{ type: 'span', find: 'x ab', replace: 'Q', reason: 'evil' }],
      },
      { asEditMarks: true },
    );
    expect(text).toBe(doc);
    expect(report.rejected).toEqual([
      {
        index: 0,
        code: 'conflict',
        message: 'Would partially overlap an existing anchor (SPEC §6.2)',
      },
    ]);
    expect(report.applied).toEqual([]);
  });

  it('rejects a patch straddling the end of an unattributed anchor', () => {
    const { text, report } = applyBatch(
      doc,
      {
        spec: 1,
        responses: declined,
        patches: [{ type: 'span', find: 'bc y', replace: 'Q', reason: 'evil' }],
      },
      { asEditMarks: true },
    );
    expect(text).toBe(doc);
    expect(report.rejected[0]!.code).toBe('conflict');
    expect(report.applied).toEqual([]);
  });

  it('still accepts a patch fully inside the anchor (the guard is not blanket)', () => {
    const { text, report } = applyBatch(
      doc,
      {
        spec: 1,
        responses: declined,
        patches: [{ type: 'span', find: 'b', replace: 'Q', reason: 'ok' }],
      },
      { asEditMarks: true },
    );
    expect(report.rejected).toEqual([]);
    expect(report.applied).toHaveLength(1);
    expect(text).toContain('{~~b~>Q~~}');
  });
});

describe('replace may not contain the substitution arrow (SPEC §8.3)', () => {
  it("rejects a replace containing '~>', which would materialize a substitution", () => {
    const doc = 'Plain text target here.{>>[q1w] note<<}\n';
    const { text, report } = applyBatch(doc, {
      spec: 1,
      responses: [{ comment: 'q1w', status: 'patched' }],
      patches: [
        { type: 'span', find: 'target', replace: 'a ~> b', comments: ['q1w'] },
      ],
    });
    expect(text).toBe(doc);
    expect(report.rejected).toEqual([
      {
        index: 0,
        code: 'invalid-patch',
        message:
          'replace is clean text and must not contain annotation syntax (SPEC §8.3)',
      },
    ]);
  });
});

describe('parse: only an EMPTY identified comment carries an edit mark (SPEC §6.3)', () => {
  it('keeps a non-empty comment after an edit mark as an ordinary point comment', () => {
    const text = 'It was {--largely --}{>>[a3f] real note<<}fine.\n';
    const result = parse(text);
    expect(result.cleanText).toBe('It was largely fine.\n');
    const c = result.comments[0]!;
    expect(c.scope).toBe('point');
    expect(c.body).toBe('real note');
    expect(c.carrier).toBeUndefined();
    expect(c.anchor.start).toBe(c.anchor.end);
    // The mark keeps no id: it was not carried.
    expect(result.editMarks[0]!.commentId).toBeNull();
    expect(result.issues).toEqual([]);
    expect(recompose(result).text).toBe(text);
  });
});

describe('patch overlap is half-open: touching ranges both apply (SPEC §10)', () => {
  const doc = 'alpha bravo charlie delta.{>>[t1a] hm<<}\n';

  it('applies two comment-attributed patches whose ranges merely touch', () => {
    const { text, report } = applyBatch(doc, {
      spec: 1,
      responses: [{ comment: 't1a', status: 'patched' }],
      patches: [
        { type: 'span', find: 'alpha ', replace: 'A ', comments: ['t1a'] },
        { type: 'span', find: 'bravo', replace: 'B', comments: ['t1a'] },
      ],
    });
    expect(report.rejected).toEqual([]);
    expect(report.applied.map((a) => a.index)).toEqual([0, 1]);
    // Proof the ranges really abut: patch 0 ends where patch 1 starts.
    expect(report.applied[0]!.range.end).toBe(report.applied[1]!.range.start);
    expect(text).toBe('A B charlie delta.{>>[t1a] hm<<}\n');
  });

  it('applies two reason-only patches whose ranges merely touch', () => {
    const { text, report } = applyBatch(doc, {
      spec: 1,
      responses: [{ comment: 't1a', status: 'declined' }],
      patches: [
        { type: 'span', find: 'alpha ', replace: 'A ', reason: 'a' },
        { type: 'span', find: 'bravo', replace: 'B', reason: 'b' },
      ],
    });
    expect(report.rejected).toEqual([]);
    expect(report.applied.map((a) => a.index)).toEqual([0, 1]);
    expect(report.applied[0]!.range.end).toBe(report.applied[1]!.range.start);
    expect(text).toBe('A B charlie delta.{>>[t1a] hm<<}\n');
  });
});

describe('addComment: edit-mark guards (SPEC §6.3)', () => {
  const doc = 'Keep {--this --}word here.\n'; // clean: 'Keep this word here.\n', mark [5, 10)

  it('rejects a span anchor that begins inside an edit mark', () => {
    expect(() =>
      addComment(doc, { body: 'x', at: { start: 7, end: 14 }, id: 'g1a' }),
    ).toThrow(/must not begin or end inside an edit mark/);
  });

  it('rejects a span anchor that ends inside an edit mark', () => {
    expect(() =>
      addComment(doc, { body: 'x', at: { start: 0, end: 8 }, id: 'g1b' }),
    ).toThrow(/must not begin or end inside an edit mark/);
  });

  it('allows a span anchor that fully contains the mark (the guard is boundary-only)', () => {
    const { text } = addComment(doc, {
      body: 'x',
      at: { start: 0, end: 14 },
      id: 'g1d',
    });
    expect(parse(text).comments[0]!.scope).toBe('span');
  });

  it("rejects a block comment whose insertion point falls inside a mark", () => {
    // clean: 'Alpha beta\n \ngamma.\n'; the mark spans [6, 12), across the
    // newline that ends the first block, so the note's line would land inside it.
    const marked = 'Alpha {--beta\n --}\ngamma.\n';
    expect(parse(marked).editMarks[0]!.range).toEqual({ start: 6, end: 12 });
    expect(blockRanges(parse(marked).cleanText)[0]).toEqual({
      start: 0,
      end: 10,
    });
    expect(() =>
      addComment(marked, { body: 'x', at: { block: 8 }, id: 'g1c' }),
    ).toThrow(/inside an edit mark/);
  });
});

describe('parse: edit-mark issues (SPEC §6.3, §11)', () => {
  it('reports an edit mark that spans a block boundary as an error', () => {
    const result = parse('{--one\n\ntwo--}');
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'edit-mark-crosses-block',
        severity: 'error',
      }),
    );
    expect(result.cleanText).toBe('one\n\ntwo');
  });

  it('warns about an identifier-like prefix inside an edit mark and keeps it as content', () => {
    const result = parse('{--[ab] text--}');
    const issue = result.issues.find(
      (i) => i.code === 'identifier-in-content',
    );
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe('warning');
    expect(result.cleanText).toBe('[ab] text');
    expect(result.editMarks[0]!.original).toBe('[ab] text');
    // A warning, not an error: the document is still valid.
    expect(result.issues.every((i) => i.severity !== 'error')).toBe(true);
  });
});

describe('public exports with no other coverage', () => {
  it('splitCommentContent separates an identifier prefix from the body', () => {
    expect(splitCommentContent('[a3f] hello there')).toEqual({
      id: 'a3f',
      body: 'hello there',
    });
    expect(splitCommentContent('just a body')).toEqual({
      id: null,
      body: 'just a body',
    });
    // A bracketed token that is not a well-formed identifier stays body text.
    expect(splitCommentContent('[has.dot] note')).toEqual({
      id: null,
      body: '[has.dot] note',
    });
  });

  it('existingIds lists every identifier in the document, skipping anonymous comments', () => {
    const doc = 'a{>>[x1] one<<} b {==c==}{>>[y2] two<<} d{>>anon<<}\n';
    expect(existingIds(doc)).toEqual({ ids: ['x1', 'y2'] });
    expect(existingIds('no comments here\n')).toEqual({ ids: [] });
  });

  it('blockRanges segments clean text, including a document with no trailing newline', () => {
    expect(blockRanges('one two\n\nthree')).toEqual([
      { start: 0, end: 7 },
      { start: 9, end: 14 },
    ]);
    expect(blockRanges('one two\n\nthree\n')).toEqual([
      { start: 0, end: 7 },
      { start: 9, end: 14 },
    ]);
    // Blank means whitespace-only, and ranges exclude the line terminator.
    expect(blockRanges('a\n \nb')).toEqual([
      { start: 0, end: 1 },
      { start: 4, end: 5 },
    ]);
    expect(blockRanges('')).toEqual([]);
  });
});

describe('generateId: option validation (SPEC §5.1)', () => {
  it('rejects a session prefix that is not a single alphanumeric character', () => {
    expect(() => generateId({ sessionPrefix: 'ab' })).toThrow(
      /single alphanumeric/,
    );
    expect(() => generateId({ sessionPrefix: '-' })).toThrow(
      /single alphanumeric/,
    );
    expect(() => generateId({ sessionPrefix: '.' })).toThrow(
      /single alphanumeric/,
    );
    // The valid case still works, so the guard is not simply "always throw".
    expect(generateId({ sessionPrefix: '7' }).id).toMatch(/^7/);
  });

  it('rejects a length outside 1–8', () => {
    expect(() => generateId({ length: 0 })).toThrow(/between 1 and 8/);
    expect(() => generateId({ length: -1 })).toThrow(/between 1 and 8/);
    expect(() => generateId({ length: 9 })).toThrow(/between 1 and 8/);
    expect(generateId({ length: 1 }).id).toHaveLength(1);
    expect(generateId({ length: 8 }).id).toHaveLength(8);
  });
});
