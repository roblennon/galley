import { describe, expect, it } from 'vitest';
import {
  cleanToRaw,
  normalizeLineEndings,
  parse,
  rawToClean,
  snapRawToClean,
} from '../src/index.js';
import { readFixture } from './helpers.js';

interface RoundtripFixture {
  documents: { name: string; text: string }[];
}

const allDocs = (): { name: string; text: string }[] => {
  const rt = readFixture<RoundtripFixture>('roundtrip/documents.json');
  const spec = readFixture<{ input: string }>('parse/spec-13.json');
  return [...rt.documents, { name: 'SPEC §13.1', text: spec.input }];
};

describe('sourceMap: verbatim raw↔clean segments', () => {
  for (const doc of allDocs()) {
    it(`every segment is byte-identical in both texts — ${doc.name}`, () => {
      const raw = normalizeLineEndings(doc.text);
      const { cleanText, sourceMap } = parse(raw);
      expect(sourceMap.length).toBeGreaterThan(0);
      let coveredClean = 0;
      for (const s of sourceMap) {
        expect(raw.slice(s.raw, s.raw + s.length)).toBe(
          cleanText.slice(s.clean, s.clean + s.length),
        );
        expect(s.clean).toBe(coveredClean);
        coveredClean += s.length;
      }
      // Segments tile the entire clean text with no gaps.
      expect(coveredClean).toBe(cleanText.length);
    });

    it(`cleanToRaw and rawToClean invert each other — ${doc.name}`, () => {
      const raw = normalizeLineEndings(doc.text);
      const { cleanText, sourceMap } = parse(raw);
      for (let c = 0; c <= cleanText.length; c += 3) {
        const r = cleanToRaw(sourceMap, c);
        expect(rawToClean(sourceMap, r)).toBe(c);
      }
    });
  }

  it('positions inside annotation syntax map to null and snap correctly', () => {
    const raw = 'She left.{>>[c2k] beat here<<} The door stayed open.\n';
    const { sourceMap } = parse(raw);
    const inside = raw.indexOf('beat');
    expect(rawToClean(sourceMap, inside)).toBeNull();
    // 'She left.' is 9 units of clean text before the mark.
    expect(snapRawToClean(sourceMap, inside, 'left')).toBe(9);
    expect(snapRawToClean(sourceMap, inside, 'right')).toBe(9);
    expect(rawToClean(sourceMap, 4)).toBe(4);
  });
});

describe('source ranges on parsed annotations', () => {
  it('span comments expose open, anchor, and tail raw ranges', () => {
    const raw = 'The {==bold==}{>>[a1b] why<<} claim.\n';
    const { comments } = parse(raw);
    const src = comments[0]!.source!;
    expect(raw.slice(src.open!.start, src.open!.end)).toBe('{==');
    expect(raw.slice(src.anchorRaw!.start, src.anchorRaw!.end)).toBe('bold');
    expect(raw.slice(src.tail!.start, src.tail!.end)).toBe(
      '==}{>>[a1b] why<<}',
    );
    expect(raw.slice(src.extent.start, src.extent.end)).toBe(
      '{==bold==}{>>[a1b] why<<}',
    );
  });

  it('bare comment marks and edit marks expose their extent', () => {
    const raw = 'One.{>>[p1q] note<<} Two {--gone --}three.\n';
    const { comments, editMarks } = parse(raw);
    const c = comments[0]!.source!;
    expect(raw.slice(c.extent.start, c.extent.end)).toBe('{>>[p1q] note<<}');
    const m = editMarks[0]!.source!;
    expect(raw.slice(m.start, m.end)).toBe('{--gone --}');
  });

  it('source offsets account for frontmatter', () => {
    const raw = '---\nannotation-spec: 1\n---\n\nBody.{>>[f2g] hm<<}\n';
    const { comments, sourceMap } = parse(raw);
    const src = comments[0]!.source!;
    expect(raw.slice(src.extent.start, src.extent.end)).toBe('{>>[f2g] hm<<}');
    expect(raw.slice(sourceMap[0]!.raw, sourceMap[0]!.raw + 5)).toBe('Body.');
    expect(sourceMap[0]!.clean).toBe(0);
  });
});
