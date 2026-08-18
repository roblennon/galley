import { describe, expect, it } from 'vitest';
import { applyBatch } from '@galley/core';
import { createDemoBatch } from '../src/roundtrip.js';

describe('sample AI round trip', () => {
  it('answers every comment and creates an attributable tracked edit', () => {
    const source =
      'A {==precise phrase==}{>>[a2b] make concrete<<} stays.{>>[c3d] add a beat<<}\n';
    const batch = createDemoBatch(source);
    expect(batch?.responses).toHaveLength(2);
    const result = applyBatch(source, batch!, { asEditMarks: true });
    expect(result.report.applied).toHaveLength(1);
    expect(result.report.responseIssues).toHaveLength(0);
    expect(result.text).toContain('{~~precise phrase~>precise phrase — revised~~}');
    expect(result.text).not.toContain('[a2b]');
    expect(result.text).toContain('[c3d]');
  });

  it('requires at least one identified span comment', () => {
    expect(createDemoBatch('Plain text.\n')).toBeNull();
  });
});
