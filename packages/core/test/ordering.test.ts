import { describe, expect, it } from 'vitest';
import { addComment, parse, recompose, removeComment } from '../src/index.js';

/** Regressions found by the property fuzzer: recompose event ordering for
 * zero-width and same-position constructs, and authoring guards that keep
 * positional scope classification stable. */

const roundTrip = (doc: string): string => recompose(parse(doc)).text;

describe('recompose: zero-width constructs', () => {
  it('empty deletion round-trips', () => {
    const doc = 'keep {----}this.\n';
    expect(roundTrip(doc)).toBe(doc);
  });

  it('empty-original substitution round-trips', () => {
    const doc = 'add {~~~>new text~~} here.\n';
    expect(roundTrip(doc)).toBe(doc);
  });

  it('empty highlight span round-trips', () => {
    const doc = 'a {====}{>>[z1a] zero-width anchor<<} b.\n';
    expect(roundTrip(doc)).toBe(doc);
  });

  it('zero-width insertion at a span anchor end stays inside the highlight', () => {
    const doc = 'say {==less {++++}==}{>>[q2b] hm<<} now.\n';
    expect(roundTrip(doc)).toBe(doc);
  });
});

describe('recompose: same-position ordering across construct kinds', () => {
  it('an insertion mark followed by a point comment keeps document order', () => {
    const doc = 'word {++new ++}{>>plain note<<}tail.\n';
    expect(roundTrip(doc)).toBe(doc);
  });

  it('adding a point at offset 0 does not demote an existing document note', () => {
    const base = addComment('Body text.\n', {
      body: 'overall',
      at: 'document',
      id: 'd1c',
    }).text;
    const { text } = addComment(base, { body: 'start', at: { offset: 0 }, id: 'p2d' });
    const scopes = new Map(parse(text).comments.map((c) => [c.id, c.scope]));
    expect(scopes.get('d1c')).toBe('document');
    expect(scopes.get('p2d')).toBe('point');
    expect(roundTrip(text)).toBe(text);
  });
});

describe('addComment: placement nesting guards', () => {
  // The inside-an-anchor rejection path is exercised by the seeded fuzzer
  // (scripts/fuzz.mjs, part of `pnpm test`): it requires a multi-operation
  // construction that hand-built docs can't reach directly.

  it('allows a block comment whose line lands exactly at a span anchor start', () => {
    const doc = 'First line.\n{==\nsecond line==}{>>[s3e] c<<} more.\n';
    const { text } = addComment(doc, { body: 'note', at: { block: 2 }, id: 'b7j' });
    const parsed = parse(text);
    expect(parsed.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(parsed.comments.map((c) => [c.id, c.scope]).sort()).toEqual([
      ['b7j', 'block'],
      ['s3e', 'span'],
    ]);
    expect(recompose(parsed).text).toBe(text);
  });

  it('scope classification survives remove after adjacent additions', () => {
    let doc = addComment('Prose here.\n', {
      body: 'doc note',
      at: 'document',
      id: 'd5g',
    }).text;
    doc = addComment(doc, { body: 'lead', at: { offset: 0 }, id: 'p6h' }).text;
    const removed = removeComment(doc, { id: 'p6h' }).text;
    const parsed = parse(removed);
    expect(parsed.comments.map((c) => [c.id, c.scope])).toEqual([
      ['d5g', 'document'],
    ]);
    expect(parsed.cleanText).toBe('Prose here.\n');
  });
});
