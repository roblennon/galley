import { describe, expect, it } from 'vitest';
import { applyBatch, parse } from '../src/index.js';
import type { PatchBatch } from '../src/index.js';
import { fenceAfter, readFixture, readRepoFile } from './helpers.js';

/** Spec examples double as test fixtures: SPEC.md §13's fenced blocks must
 * stay byte-identical to the conformance fixtures, and the library must
 * reproduce them end to end. */
describe('SPEC §13 examples stay in sync with conformance fixtures', () => {
  const spec = readRepoFile('SPEC.md');
  const doc = fenceAfter(spec, '### 13.1');
  const clean = fenceAfter(spec, '### 13.2');
  const batchJson = fenceAfter(spec, '### 13.3');
  const result = fenceAfter(spec, '### 13.4');
  const marginalia = fenceAfter(spec, '### 13.5');

  it('§13.1 matches the parse and apply fixtures', () => {
    const parseFx = readFixture<{ input: string }>('parse/spec-13.json');
    const applyFx = readFixture<{ input: string }>('apply/spec-13.json');
    expect(parseFx.input).toBe(doc);
    expect(applyFx.input).toBe(doc);
  });

  it('§13.2 is the byte-exact clean text of §13.1', () => {
    const fx = readFixture<{ cleanText: string }>('parse/spec-13.json');
    expect(fx.cleanText).toBe(clean);
    expect(parse(doc).cleanText).toBe(clean);
  });

  it('§13.3 matches the apply fixture batch', () => {
    const fx = readFixture<{ batch: PatchBatch }>('apply/spec-13.json');
    expect(fx.batch).toEqual(JSON.parse(batchJson));
  });

  it('applying §13.3 to §13.1 yields §13.4 byte-exactly', () => {
    const fx = readFixture<{ output: string }>('apply/spec-13.json');
    expect(fx.output).toBe(result);
    const { text } = applyBatch(doc, JSON.parse(batchJson) as PatchBatch);
    expect(text).toBe(result);
  });

  it('§13.5 carries the resolved comment body the library reports', () => {
    const { report } = applyBatch(doc, JSON.parse(batchJson) as PatchBatch);
    const resolved = report.resolved[0]!;
    expect(resolved.id).toBe('a3f');
    expect(marginalia).toContain(resolved.body);
  });
});
