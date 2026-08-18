import { describe, expect, it } from 'vitest';
import {
  applyBatch,
  exportFinalText,
  parse,
  recompose,
  resolveEditMarks,
} from '../src/index.js';

const doc =
  'The {==old phrasing==}{>>[w1x] modernize<<} stays. Cut this too.{>>[y2z] trim?<<}\n';
const batch = {
  spec: 1,
  responses: [
    { comment: 'w1x', status: 'patched' as const },
    { comment: 'y2z', status: 'patched' as const },
  ],
  patches: [
    { type: 'span' as const, find: 'old phrasing', replace: 'fresh wording', comments: ['w1x'] },
    { type: 'span' as const, find: ' this too', replace: '', comments: ['y2z'] },
  ],
};

describe('tracked changes: fresh-eyes probes', () => {
  it('accepts a mark nested inside a highlight without disturbing the anchor', () => {
    const nested = '{==Use {~~old~>new~~} wording==}{>>[s1] keep this focused<<}\n';
    const r = resolveEditMarks(nested, { action: 'accept' });
    expect(r.text).toBe('{==Use new wording==}{>>[s1] keep this focused<<}\n');
    const p = parse(r.text);
    expect(p.cleanText).toBe('Use new wording\n');
    expect(p.issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('is a no-op when the selected index does not exist', () => {
    const src = 'Keep {++this++}.\n';
    expect(resolveEditMarks(src, { action: 'accept', only: 9 })).toEqual({
      text: src,
      resolved: 0,
    });
  });

  it('partial accept transforms survivors; accept inside a span anchor grows it', () => {
    const d1 = 'Aaa {~~one~>ONE~~} bbb {--gone --}ccc {==dd==}{>>[k1] hm<<} end.\n';
    const r1 = resolveEditMarks(d1, { action: 'accept', only: 0 });
    const p1 = parse(r1.text);
    expect(recompose(p1).text).toBe(r1.text);
    expect(p1.editMarks).toHaveLength(1);
    expect(p1.comments[0]!.id).toBe('k1');
    const d2 = 'x {==alpha {~~beta~>BETA2~~} gamma==}{>>[q2] note<<} y\n';
    const r2 = resolveEditMarks(d2, { action: 'accept' });
    expect(r2.text).toContain('{==alpha BETA2 gamma==}');
    expect(parse(r2.text).comments[0]!.scope).toBe('span');
  });

  it('tracked-then-accept equals destructive application', () => {
    const d = 'Alpha bravo charlie.{>>[z9] tighten<<}\n';
    const b = { spec: 1, responses: [{ comment: 'z9', status: 'patched' as const }], patches: [{ type: 'span' as const, find: 'bravo ', replace: '', comments: ['z9'] }] };
    const tracked = applyBatch(d, b, { asEditMarks: true });
    const destructive = applyBatch(d, b);
    expect(exportFinalText(tracked.text).text).toBe(parse(destructive.text).cleanText);
  });
});

describe('applyBatch as edit marks (tracked changes)', () => {
  it('inserts substitution/deletion marks, resolves attributed comments, round-trips', () => {
    const { text, report } = applyBatch(doc, batch, { asEditMarks: true });
    expect(text).toContain('{~~old phrasing~>fresh wording~~}');
    expect(text).toContain('{-- this too--}');
    // w1x's anchor is covered by its attributed patch → resolved; y2z is a
    // point after the deleted range, so it stays open (same as destructive).
    expect(report.resolved.map((r) => r.id)).toEqual(['w1x']);
    expect(text).toContain('{>>[y2z] trim?<<}');
    expect(report.applied).toHaveLength(2);
    // Clean text is untouched in tracked mode (marks carry the proposal).
    expect(parse(text).cleanText).toBe(parse(doc).cleanText);
    expect(recompose(parse(text)).text).toBe(text);
  });

  it('accept-all yields the patched text; reject-all restores the original prose', () => {
    const { text: tracked } = applyBatch(doc, batch, { asEditMarks: true });
    const accepted = resolveEditMarks(tracked, { action: 'accept' });
    expect(parse(accepted.text).cleanText).toBe(
      'The fresh wording stays. Cut.\n',
    );
    const rejectedAll = resolveEditMarks(tracked, { action: 'reject' });
    expect(parse(rejectedAll.text).cleanText).toBe(parse(doc).cleanText);
    expect(parse(rejectedAll.text).editMarks).toHaveLength(0);
  });

  it('resolves a single mark by index, leaving the rest tracked', () => {
    const { text: tracked } = applyBatch(doc, batch, { asEditMarks: true });
    const one = resolveEditMarks(tracked, { action: 'accept', only: 0 });
    expect(one.resolved).toBe(1);
    const p = parse(one.text);
    expect(p.editMarks).toHaveLength(1);
    expect(p.cleanText).toContain('fresh wording');
    expect(p.cleanText).toContain('Cut this too.');
  });

  it('exportFinalText accepts everything and strips all annotation', () => {
    const { text: tracked } = applyBatch(doc, batch, { asEditMarks: true });
    const final = exportFinalText(tracked);
    expect(final.text).toBe('The fresh wording stays. Cut.\n');
    expect(final.text).not.toMatch(/\{/);
  });

  it('rejects a tracked patch that would nest with an existing edit mark', () => {
    const marked = 'Keep {--this --}word.\n';
    const { text, report } = applyBatch(marked, {
      spec: 1,
      responses: [],
      patches: [{ type: 'span', find: 'this word', replace: 'X', reason: 'x' }],
    }, { asEditMarks: true });
    expect(report.rejected[0]!.code).toBe('conflict');
    expect(text).toBe(marked);
  });
});
