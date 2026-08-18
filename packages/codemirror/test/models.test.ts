import { describe, expect, it } from 'vitest';
import {
  buildPanelModel,
  computeTarget,
  planDecorations,
} from '../src/index.js';

describe('computeTarget', () => {
  it('maps an astral Unicode selection from UTF-16 to code points', () => {
    const text = 'A 🚀 bright idea.\n';
    const from = text.indexOf('🚀');
    const to = text.indexOf(' idea');

    expect(computeTarget(text, from, to)).toEqual({
      kind: 'span',
      at: { start: 2, end: 10 },
    });
  });

  it('reports collapsed point and paragraph context', () => {
    const text = 'First paragraph.\n\nSecond paragraph.\n';
    const offset = text.indexOf('\n\n') + 1;
    expect(computeTarget(text, offset, offset)).toMatchObject({
      kind: 'collapsed',
      pointValid: false,
      blockSnippet: 'First paragraph.',
    });
  });
});

describe('planDecorations', () => {
  const text =
    'The {==claim==}{>>[a1b] support?<<} stays.{>>[p2c] beat<<}\n\n' +
    'Paragraph.\n\n{>>[b3d] expand<<}\n\nCut {--this --}word.\n';

  it('plans span, point, block, and edit decorations', () => {
    expect(planDecorations(text, [{ from: 0, to: 0 }]).map((item) => item.kind))
      .toEqual(['hide', 'anchor', 'chip', 'chip', 'note', 'edit']);
  });

  it('emits raw UTF-16 offsets, not code points', () => {
    const astral = 'A 🚀 {==claim==}{>>[a1b] check<<} lands.\n';
    const plan = planDecorations(astral, [{ from: 0, to: 0 }]);
    const anchor = plan.find((item) => item.kind === 'anchor');
    expect(astral.slice(anchor!.from, anchor!.to)).toBe('claim');
  });

  it('reveals only the annotation touched by the selection', () => {
    const cursor = text.indexOf('[a1b]');
    const plan = planDecorations(text, [{ from: cursor, to: cursor }]);
    expect(plan.some((item) => item.kind === 'hide')).toBe(false);
    expect(plan.some((item) => item.kind === 'chip' && item.id === 'p2c')).toBe(true);
  });
});

describe('buildPanelModel', () => {
  it('builds snippets and raw jump ranges for each visible comment scope', () => {
    const text =
      '{>>[d1a] overall<<}\n\nThe {==🚀 first==}{>>[s2b] really?<<} claim.' +
      '{>>[p3c] beat<<}\n\nParagraph two.\n\n{>>[b4d] expand<<}\n';
    const { items, errorCount } = buildPanelModel(text);

    expect(errorCount).toBe(0);
    expect(items.map(({ id, scope }) => [id, scope])).toEqual([
      ['d1a', 'document'],
      ['s2b', 'span'],
      ['p3c', 'point'],
      ['b4d', 'block'],
    ]);
    const span = items.find((item) => item.id === 's2b')!;
    expect(span.snippet).toBe('🚀 first');
    expect(span.jump && text.slice(span.jump.from, span.jump.to)).toBe('🚀 first');
    expect(items.find((item) => item.id === 'b4d')?.snippet).toBe('Paragraph two.');
    const point = items.find((item) => item.id === 'p3c')!;
    expect(point.jump?.from).toBe(point.jump?.to);
  });
});
