import { describe, expect, it } from 'vitest';
import { parse } from '../src/index.js';
import { cpIndexOf, cpSlice, readFixture } from './helpers.js';

interface ParseFixture {
  name: string;
  input: string;
  cleanText: string;
  frontmatter: string | null;
  comments: {
    id: string;
    scope: string;
    body: string;
    anchorText: string;
  }[];
  editMarks: { kind: string; original: string; proposed: string }[];
}

describe('parse: conformance fixture', () => {
  const fx = readFixture<ParseFixture>('parse/spec-13.json');

  it('decomposes into the expected clean text and frontmatter', () => {
    const result = parse(fx.input);
    expect(result.cleanText).toBe(fx.cleanText);
    expect(result.frontmatter).toBe(fx.frontmatter);
    expect(result.issues).toEqual([]);
  });

  it('produces the expected comments with correct anchors', () => {
    const result = parse(fx.input);
    expect(result.comments).toHaveLength(fx.comments.length);
    fx.comments.forEach((expected, i) => {
      const actual = result.comments[i]!;
      expect(actual.id).toBe(expected.id);
      expect(actual.scope).toBe(expected.scope);
      expect(actual.body).toBe(expected.body);
      expect(
        cpSlice(result.cleanText, actual.anchor.start, actual.anchor.end),
      ).toBe(expected.anchorText);
    });
  });

  it('produces the expected edit marks', () => {
    const result = parse(fx.input);
    expect(
      result.editMarks.map((m) => ({
        kind: m.kind,
        original: m.original,
        proposed: m.proposed,
      })),
    ).toEqual(fx.editMarks);
  });
});

describe('parse: scope classification (SPEC §6.1)', () => {
  it('classifies a bare inline comment as a point with a zero-width anchor', () => {
    const text = 'She left.{>>[c2k] beat here<<} The door stayed open.\n';
    const result = parse(text);
    expect(result.cleanText).toBe('She left. The door stayed open.\n');
    const c = result.comments[0]!;
    expect(c.scope).toBe('point');
    expect(c.anchor.start).toBe(c.anchor.end);
    expect(c.anchor.start).toBe(cpIndexOf(result.cleanText, ' The door'));
  });

  it('classifies a comment alone on a line after content as block scope', () => {
    const text = 'A paragraph.\n\n{>>[b1x] cut this<<}\n\nNext paragraph.\n';
    const result = parse(text);
    expect(result.cleanText).toBe('A paragraph.\n\nNext paragraph.\n');
    const c = result.comments[0]!;
    expect(c.scope).toBe('block');
    expect(cpSlice(result.cleanText, c.anchor.start, c.anchor.end)).toBe(
      'A paragraph.',
    );
  });

  it('classifies a comment before any content as document scope', () => {
    const text = '{>>[d1x] overall note<<}\n\n# Title\n\nBody.\n';
    const result = parse(text);
    expect(result.cleanText).toBe('# Title\n\nBody.\n');
    const c = result.comments[0]!;
    expect(c.scope).toBe('document');
    expect(c.anchor).toEqual({ start: 0, end: [...result.cleanText].length });
  });

  it('attaches an empty-bodied identified comment to the preceding edit mark', () => {
    const text = 'It was {--largely --}{>>[a3f]<<}fine.\n';
    const result = parse(text);
    expect(result.cleanText).toBe('It was largely fine.\n');
    expect(result.editMarks[0]!.commentId).toBe('a3f');
    expect(result.comments[0]!.carrier).toBe(true);
  });
});

describe('parse: offsets are Unicode code points (SPEC §7)', () => {
  it('counts astral characters as one code point', () => {
    const text = 'The 🦄 pony {==sparkles==}{>>[u7q] whimsy<<} at dawn.\n';
    const result = parse(text);
    expect(result.cleanText).toBe('The 🦄 pony sparkles at dawn.\n');
    const anchor = result.comments[0]!.anchor;
    expect(anchor.start).toBe(cpIndexOf(result.cleanText, 'sparkles'));
    // The UTF-16 index differs, proving code-point counting.
    expect(result.cleanText.indexOf('sparkles')).toBe(anchor.start + 1);
    expect(cpSlice(result.cleanText, anchor.start, anchor.end)).toBe(
      'sparkles',
    );
  });

  it('normalizes CRLF line endings before computing offsets', () => {
    expect(parse('alpha\r\nbravo\r\n').cleanText).toBe('alpha\nbravo\n');
  });
});

describe('parse: malformed syntax (SPEC §11)', () => {
  it('reports an unclosed mark and treats it as prose', () => {
    const result = parse('bad {>>never closed\n');
    expect(result.issues.some((i) => i.code === 'unclosed-mark')).toBe(true);
    expect(result.cleanText).toBe('bad {>>never closed\n');
  });

  it('reports a highlight with no comment and preserves it as prose', () => {
    const result = parse('some {==text==} here\n');
    expect(
      result.issues.some((i) => i.code === 'highlight-without-comment'),
    ).toBe(true);
    expect(result.cleanText).toBe('some {==text==} here\n');
    expect(result.comments).toHaveLength(0);
  });

  it('reports a substitution missing its arrow and treats it as prose', () => {
    const result = parse('fix {~~nope~~} this\n');
    expect(
      result.issues.some((i) => i.code === 'substitution-missing-arrow'),
    ).toBe(true);
    expect(result.cleanText).toBe('fix {~~nope~~} this\n');
  });

  it('reports duplicate identifiers', () => {
    const result = parse('a{>>[x1] one<<} b{>>[x1] two<<}\n');
    expect(result.issues.some((i) => i.code === 'duplicate-id')).toBe(true);
  });

  it('warns when an identifier-like prefix appears inside a highlight', () => {
    const result = parse('{==[ab] text==}{>>[cd] note<<}\n');
    expect(
      result.issues.some(
        (i) => i.code === 'identifier-in-content' && i.severity === 'warning',
      ),
    ).toBe(true);
    // The bracketed text stays in the anchor as content.
    expect(result.cleanText).toBe('[ab] text\n');
  });

  it('reports an anchor that crosses a block boundary', () => {
    const result = parse('{==one\n\ntwo==}{>>[e1r] spans blocks<<}\n');
    expect(result.issues.some((i) => i.code === 'anchor-crosses-block')).toBe(
      true,
    );
  });
});
