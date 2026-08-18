import { describe, expect, it } from 'vitest';
import {
  addComment,
  generateId,
  parse,
  removeComment,
  ID_ALPHABET,
} from '../src/index.js';

describe('addComment', () => {
  const doc = 'Hello brave world.\n';

  it('inserts a span comment that re-parses to the intended anchor', () => {
    const { text, id } = addComment(doc, {
      body: 'why brave?',
      at: { start: 6, end: 11 },
      id: 'q1w',
    });
    expect(id).toBe('q1w');
    expect(text).toBe('Hello {==brave==}{>>[q1w] why brave?<<} world.\n');
    const reparsed = parse(text);
    expect(reparsed.comments[0]!.scope).toBe('span');
    expect(reparsed.cleanText).toBe(doc);
  });

  it('inserts a point comment at an offset', () => {
    const { text } = addComment(doc, {
      body: 'hmm',
      at: { offset: 18 },
      id: 'p1x',
    });
    expect(text).toBe('Hello brave world.{>>[p1x] hmm<<}\n');
    expect(parse(text).comments[0]!.scope).toBe('point');
  });

  it('inserts a block comment after the block containing the offset', () => {
    const { text } = addComment(doc, {
      body: 'expand this',
      at: { block: 3 },
      id: 'b1y',
    });
    expect(text).toBe('Hello brave world.\n\n{>>[b1y] expand this<<}\n');
    expect(parse(text).comments[0]!.scope).toBe('block');
  });

  it('inserts a document comment before any content', () => {
    const { text } = addComment(doc, {
      body: 'overall: shorten',
      at: 'document',
      id: 'd1z',
    });
    expect(text).toBe('{>>[d1z] overall: shorten<<}\n\nHello brave world.\n');
    expect(parse(text).comments[0]!.scope).toBe('document');
  });

  it('generates an identifier when none is supplied', () => {
    const { text, id } = addComment(doc, {
      body: 'note',
      at: { offset: 5 },
    });
    expect(id).toMatch(/^[A-Za-z0-9]{3,8}$/);
    expect(text).toContain(`{>>[${id}] note<<}`);
  });

  it('rejects a span that crosses a block boundary', () => {
    const two = 'One para.\n\nTwo para.\n';
    expect(() =>
      addComment(two, { body: 'x', at: { start: 4, end: 15 } }),
    ).toThrow(/block boundary/);
  });

  it('rejects overlapping and nested anchors', () => {
    const { text } = addComment(doc, {
      body: 'first',
      at: { start: 6, end: 11 },
      id: 'f1r',
    });
    expect(() =>
      addComment(text, { body: 'second', at: { start: 8, end: 14 } }),
    ).toThrow(/overlap/);
    expect(() =>
      addComment(text, { body: 'inside', at: { offset: 8 } }),
    ).toThrow(/nest/);
  });

  it('rejects a body containing the comment closing delimiter', () => {
    expect(() =>
      addComment(doc, { body: 'weird <<} body', at: { offset: 5 } }),
    ).toThrow(/closing delimiter/);
  });

  it('rejects a span anchor whose text contains the highlight closer', () => {
    const tricky = 'math a==}b end.\n';
    expect(() =>
      addComment(tricky, { body: 'check', at: { start: 5, end: 9 } }),
    ).toThrow(/closing delimiter/);
  });

  it('rejects a duplicate or malformed identifier', () => {
    const { text } = addComment(doc, {
      body: 'first',
      at: { offset: 5 },
      id: 'e2e',
    });
    expect(() =>
      addComment(text, { body: 'again', at: { offset: 12 }, id: 'e2e' }),
    ).toThrow(/already exists/);
    expect(() =>
      addComment(doc, { body: 'bad', at: { offset: 5 }, id: 'has.dot' }),
    ).toThrow(/invalid identifier/);
  });
});

describe('removeComment', () => {
  it('removes a span comment together with its highlight', () => {
    const doc = 'Hello {==brave==}{>>[q1w] why?<<} world.\n';
    const { text, removed } = removeComment(doc, { id: 'q1w' });
    expect(removed).toBe(true);
    expect(text).toBe('Hello brave world.\n');
  });

  it('removes a block comment and its separator line', () => {
    const doc = 'A paragraph.\n\n{>>[b1x] cut<<}\n';
    const { text } = removeComment(doc, { id: 'b1x' });
    expect(text).toBe('A paragraph.\n');
  });

  it('keeps an edit mark whose id carrier is removed', () => {
    const doc = 'It was {--largely --}{>>[a3f]<<}fine.\n';
    const { text } = removeComment(doc, { id: 'a3f' });
    expect(text).toBe('It was {--largely --}fine.\n');
  });

  it('reports removed: false for an unknown id, text unchanged', () => {
    const doc = 'Plain.{>>[z9z] note<<}\n';
    const result = removeComment(doc, { id: 'nope' });
    expect(result.removed).toBe(false);
    expect(result.text).toBe(doc);
  });
});

describe('generateId (SPEC §5.1)', () => {
  it('draws from an alphabet without visually confusable characters', () => {
    for (const bad of ['l', 'I', '1', 'O', '0', 'o']) {
      expect(ID_ALPHABET).not.toContain(bad);
    }
  });

  it('never returns an identifier that already exists', () => {
    const { id } = generateId({ existing: ['aaa'], random: () => 0 });
    expect(id).not.toBe('aaa');
    expect(id).toBe('aaaa'); // grew after collision pressure at length 3
  });

  it('honors a session prefix', () => {
    const { id } = generateId({ sessionPrefix: 's' });
    expect(id).toMatch(/^s[a-z2-9]{2}$/);
  });
});
