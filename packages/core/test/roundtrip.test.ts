import { describe, expect, it } from 'vitest';
import { parse, recompose } from '../src/index.js';
import { readFixtureDir } from './helpers.js';

interface RoundtripFixture {
  documents: { name: string; text: string }[];
}

interface WithInput {
  name: string;
  input: string;
  output?: string;
}

describe('parse → recompose is a byte-exact round trip (SPEC §7)', () => {
  for (const { file, fixture } of readFixtureDir<RoundtripFixture>(
    'roundtrip',
  )) {
    for (const doc of fixture.documents) {
      it(`${file} — ${doc.name}`, () => {
        expect(recompose(parse(doc.text)).text).toBe(doc.text);
      });
    }
  }

  // Round-tripping is unconditional (SPEC §7): every document any other
  // fixture directory names must survive it too, malformed ones included.
  for (const dir of ['parse', 'apply']) {
    for (const { file, fixture } of readFixtureDir<WithInput>(dir)) {
      it(`${file} — input`, () => {
        expect(recompose(parse(fixture.input)).text).toBe(fixture.input);
      });
      if (fixture.output !== undefined) {
        it(`${file} — output`, () => {
          expect(recompose(parse(fixture.output!)).text).toBe(fixture.output);
        });
      }
    }
  }
});
