import { describe, expect, it } from 'vitest';
import { applyBatch, parse } from '../src/index.js';

const parseOut = (text: string): [string | null, string][] =>
  parse(text).comments.map((c) => [c.id, c.scope]);
import type { PatchBatch } from '../src/index.js';
import { readFixture } from './helpers.js';

interface ApplyFixture {
  name: string;
  input: string;
  batch: PatchBatch;
  output: string;
  report: {
    appliedIndices: number[];
    rejected: unknown[];
    resolved: { id: string; body: string }[];
    orphaned: string[];
    unaddressed: string[];
  };
}

function respond(
  ids: string[],
  status: 'patched' | 'no-change-needed' | 'declined' = 'no-change-needed',
): PatchBatch['responses'] {
  return ids.map((comment) => ({ comment, status }));
}

describe('applyBatch: conformance fixture (SPEC §13 end to end)', () => {
  const fx = readFixture<ApplyFixture>('apply/spec-13.json');

  it('produces the §13.4 document and report', () => {
    const { text, report } = applyBatch(fx.input, fx.batch);
    expect(text).toBe(fx.output);
    expect(report.applied.map((a) => a.index)).toEqual(
      fx.report.appliedIndices,
    );
    expect(report.rejected).toEqual(fx.report.rejected);
    expect(report.resolved).toEqual(fx.report.resolved);
    expect(report.orphaned).toEqual(fx.report.orphaned);
    expect(report.unaddressed).toEqual(fx.report.unaddressed);
    expect(report.responseIssues).toEqual([]);
  });
});

describe('applyBatch: anchor transformation (SPEC §10.1)', () => {
  const doc =
    'alpha bravo {==charlie delta==}{>>[aa1] tighten<<} echo foxtrot.\n';

  it('shifts an anchor after an earlier edit', () => {
    const { text } = applyBatch(doc, {
      spec: 1,
      responses: respond(['aa1']),
      patches: [{ type: 'span', find: 'alpha', replace: 'al', reason: 'trim' }],
    });
    expect(text).toBe(
      'al bravo {==charlie delta==}{>>[aa1] tighten<<} echo foxtrot.\n',
    );
  });

  it('leaves an anchor before a later edit unchanged', () => {
    const { text } = applyBatch(doc, {
      spec: 1,
      responses: respond(['aa1']),
      patches: [
        { type: 'span', find: 'foxtrot', replace: 'foxtrot indeed', reason: 'x' },
      ],
    });
    expect(text).toContain('{==charlie delta==}{>>[aa1] tighten<<}');
  });

  it('grows an anchor containing an edit', () => {
    const { text, report } = applyBatch(doc, {
      spec: 1,
      responses: respond(['aa1']),
      patches: [
        { type: 'span', find: 'charlie', replace: 'charles', reason: 'name' },
      ],
    });
    expect(text).toContain('{==charles delta==}{>>[aa1] tighten<<}');
    expect(report.anchorModified).toEqual([]);
  });

  it('clamps a partially overlapped anchor and flags it', () => {
    const { text, report } = applyBatch(doc, {
      spec: 1,
      responses: respond(['aa1']),
      patches: [
        { type: 'span', find: 'delta echo', replace: 'd-echo', reason: 'x' },
      ],
    });
    expect(text).toContain('{==charlie ==}{>>[aa1] tighten<<}');
    expect(report.anchorModified).toEqual(['aa1']);
  });

  it('resolves a comment destroyed by a patch attributed to it', () => {
    const { text, report } = applyBatch(doc, {
      spec: 1,
      responses: respond(['aa1'], 'patched'),
      patches: [
        {
          type: 'span',
          find: 'charlie delta',
          replace: 'charles',
          comments: ['aa1'],
        },
      ],
    });
    expect(text).toBe('alpha bravo charles echo foxtrot.\n');
    expect(report.resolved).toEqual([{ id: 'aa1', body: 'tighten' }]);
    expect(report.orphaned).toEqual([]);
  });

  it('orphans a comment destroyed by an unattributed patch', () => {
    const { text, report } = applyBatch(doc, {
      spec: 1,
      responses: respond(['aa1']),
      patches: [
        {
          type: 'span',
          find: 'bravo charlie delta echo',
          replace: 'a new middle',
          reason: 'rewrite',
        },
      ],
    });
    expect(report.orphaned).toEqual(['aa1']);
    // Demoted to a block comment attached where the anchor formerly began.
    expect(text).toBe(
      'alpha a new middle foxtrot.\n\n{>>[aa1] tighten<<}\n',
    );
  });

  it('shifts a point comment with preceding edits, destroys it only when strictly contained', () => {
    const pointDoc = 'one two three{>>[pp1] beat<<} four.\n';
    const shifted = applyBatch(pointDoc, {
      spec: 1,
      responses: respond(['pp1']),
      patches: [{ type: 'span', find: 'two', replace: '2', reason: 'x' }],
    });
    expect(shifted.text).toBe('one 2 three{>>[pp1] beat<<} four.\n');

    const destroyed = applyBatch(pointDoc, {
      spec: 1,
      responses: respond(['pp1']),
      patches: [
        { type: 'span', find: 'ee fou', replace: 'ee-fou', reason: 'x' },
      ],
    });
    expect(destroyed.report.orphaned).toEqual(['pp1']);
  });
});

describe('applyBatch: locating and matching (SPEC §8.3)', () => {
  it('rejects a failed match with the closest candidate, never fuzzy-applies', () => {
    const doc = 'We recieve strong signals.{>>[m1k] check<<}\n';
    const { text, report } = applyBatch(doc, {
      spec: 1,
      responses: respond(['m1k']),
      patches: [
        { type: 'span', find: 'We receive strong', replace: 'X', reason: 'typo' },
      ],
    });
    expect(text).toBe(doc);
    expect(report.rejected).toHaveLength(1);
    expect(report.rejected[0]!.code).toBe('no-match');
    expect(report.rejected[0]!.closest).toContain('recieve');
  });

  it('rejects an ambiguous find with no referenced comment', () => {
    const doc = 'the word here.\n\nAlso the word there.{>>[q2m] hm<<}\n';
    const { report } = applyBatch(doc, {
      spec: 1,
      responses: respond(['q2m']),
      patches: [
        { type: 'span', find: 'the word', replace: 'a word', reason: 'x' },
      ],
    });
    expect(report.rejected[0]!.code).toBe('ambiguous');
  });

  it("disambiguates within a referenced comment's block", () => {
    const doc = 'the word here.\n\nAlso the word there.{>>[q2m] hm<<}\n';
    const { text } = applyBatch(doc, {
      spec: 1,
      responses: respond(['q2m'], 'patched'),
      patches: [
        {
          type: 'span',
          find: 'the word',
          replace: 'a word',
          comments: ['q2m'],
        },
      ],
    });
    expect(text).toBe('the word here.\n\nAlso a word there.{>>[q2m] hm<<}\n');
  });

  it('replaces the block of the named comment for a block patch, resolving it', () => {
    const doc = 'Para one, verbose and slow.\n\n{>>[bb1] rewrite tighter<<}\n';
    const { text, report } = applyBatch(doc, {
      spec: 1,
      responses: respond(['bb1'], 'patched'),
      patches: [{ type: 'block', comment: 'bb1', replace: 'Para one, tight.' }],
    });
    expect(text).toBe('Para one, tight.\n');
    expect(report.resolved).toEqual([{ id: 'bb1', body: 'rewrite tighter' }]);
  });
});

describe('applyBatch: replacement text is clean text (SPEC §8.3)', () => {
  it('rejects a replace that would inject annotation syntax', () => {
    const doc = 'Plain text target here.{>>[q1w] note<<}\n';
    const { text, report } = applyBatch(doc, {
      spec: 1,
      responses: respond(['q1w'], 'patched'),
      patches: [
        {
          type: 'span',
          find: 'target',
          replace: '{==sneaky==}{>>[zzz] injected<<}',
          comments: ['q1w'],
        },
      ],
    });
    expect(text).toBe(doc);
    expect(report.rejected[0]).toMatchObject({ index: 0, code: 'invalid-patch' });
  });
});

describe('applyBatch: review-pass regressions', () => {
  it('rejects a replace containing a mark closer, which would clip an anchor', () => {
    const doc = 'x {==abc==}{>>[s1a] note<<} y\n';
    const { text, report } = applyBatch(doc, {
      spec: 1,
      responses: respond(['s1a']),
      patches: [{ type: 'span', find: 'b', replace: 'Q==}R', reason: 'evil' }],
    });
    expect(text).toBe(doc);
    expect(report.rejected[0]!.code).toBe('invalid-patch');
  });

  it('re-derives a document comment over patched text instead of orphaning it', () => {
    const doc = '{>>[d1b] overall<<}\n\nHello world.\n';
    const { text, report } = applyBatch(doc, {
      spec: 1,
      responses: respond(['d1b']),
      patches: [
        { type: 'span', find: 'Hello world.', replace: 'Goodbye.', reason: 'x' },
      ],
    });
    expect(text).toBe('{>>[d1b] overall<<}\n\nGoodbye.\n');
    expect(report.orphaned).toEqual([]);
  });

  it('demotes a point comment stranded between paragraphs, with a report entry', () => {
    const doc = 'A\n\n{>>[p1c] beat here<<}B\n';
    const { text, report } = applyBatch(doc, {
      spec: 1,
      responses: respond(['p1c']),
      patches: [{ type: 'span', find: 'B', replace: '', reason: 'cut' }],
    });
    expect(report.anchorModified).toEqual(['p1c']);
    const reparsed = parseOut(text);
    expect(reparsed).toEqual([['p1c', 'block']]);
  });

  it('applies a patch whose only overlap is with a rejected patch', () => {
    const doc = '0123456789abcdefghij{>>[c1d] hm<<}\n';
    const { report } = applyBatch(doc, {
      spec: 1,
      responses: respond(['c1d'], 'patched'),
      patches: [
        { type: 'span', find: '0123456789', replace: 'X', comments: ['c1d'] },
        { type: 'span', find: '89ab', replace: 'Y', reason: 'a' },
        { type: 'span', find: 'bcde', replace: 'Z', reason: 'b' },
      ],
    });
    expect(report.rejected.map((r) => r.index)).toEqual([1]);
    expect(report.applied.map((a) => a.index)).toEqual([0, 2]);
  });
});

describe('applyBatch: conflicts (SPEC §10)', () => {
  const doc = 'shared target text here.{>>[c3p] note<<}\n';

  it('prefers a comment-attributed patch over a reason-only overlap', () => {
    const { text, report } = applyBatch(doc, {
      spec: 1,
      responses: respond(['c3p'], 'patched'),
      patches: [
        { type: 'span', find: 'target text', replace: 'reason-only', reason: 'x' },
        {
          type: 'span',
          find: 'shared target',
          replace: 'attributed win',
          comments: ['c3p'],
        },
      ],
    });
    expect(report.rejected[0]).toMatchObject({ index: 0, code: 'conflict' });
    expect(text).toContain('attributed win');
  });

  it('rejects all overlapping patches when none takes precedence', () => {
    const { text, report } = applyBatch(doc, {
      spec: 1,
      responses: respond(['c3p']),
      patches: [
        { type: 'span', find: 'target text', replace: 'one', reason: 'a' },
        { type: 'span', find: 'shared target', replace: 'two', reason: 'b' },
      ],
    });
    expect(text).toBe(doc);
    expect(report.rejected.map((r) => r.code)).toEqual([
      'conflict',
      'conflict',
    ]);
  });
});

describe('applyBatch: response coverage (SPEC §8.2)', () => {
  const doc = 'text.{>>[r1a] one<<} more.{>>[r2b] two<<}\n';

  it('reports a missing response as a generator failure', () => {
    const { report } = applyBatch(doc, {
      spec: 1,
      responses: respond(['r1a']),
      patches: [],
    });
    expect(report.responseIssues).toMatchObject([
      { code: 'missing-response', comment: 'r2b' },
    ]);
  });

  it('reports duplicate, unknown, and invalid-status responses', () => {
    const { report } = applyBatch(doc, {
      spec: 1,
      responses: [
        { comment: 'r1a', status: 'declined' },
        { comment: 'r1a', status: 'declined' },
        { comment: 'zzz', status: 'declined' },
        { comment: 'r2b', status: 'maybe' as never },
      ],
      patches: [],
    });
    const codes = report.responseIssues.map((i) => i.code).sort();
    expect(codes).toEqual([
      'duplicate-response',
      'invalid-status',
      'unknown-comment',
    ]);
  });

  it('lists comments not referenced by any patch as unaddressed', () => {
    const { report } = applyBatch(doc, {
      spec: 1,
      responses: respond(['r1a', 'r2b']),
      patches: [],
    });
    expect(report.unaddressed.sort()).toEqual(['r1a', 'r2b']);
  });
});
