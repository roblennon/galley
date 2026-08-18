import { describe, expect, it } from 'vitest';
import { parse, recompose } from '../src/index.js';
import { readFixture } from './helpers.js';

interface RoundtripFixture {
  documents: { name: string; text: string }[];
}

interface WithInput {
  input: string;
  output?: string;
}

describe('parse → recompose is a byte-exact round trip (SPEC §7)', () => {
  const docs = readFixture<RoundtripFixture>('roundtrip/documents.json');
  for (const doc of docs.documents) {
    it(doc.name, () => {
      expect(recompose(parse(doc.text)).text).toBe(doc.text);
    });
  }

  it('SPEC §13.1 document', () => {
    const fx = readFixture<WithInput>('parse/spec-13.json');
    expect(recompose(parse(fx.input)).text).toBe(fx.input);
  });

  it('SPEC §13.4 result document', () => {
    const fx = readFixture<Required<WithInput>>('apply/spec-13.json');
    expect(recompose(parse(fx.output)).text).toBe(fx.output);
  });
});
