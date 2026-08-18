import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));

export function readRepoFile(relPath: string): string {
  return readFileSync(root + relPath, 'utf8');
}

export function readFixture<T>(relPath: string): T {
  return JSON.parse(readRepoFile('conformance/' + relPath)) as T;
}

/** Content of the first fenced code block after `heading` in `md`,
 * including the trailing newline. */
export function fenceAfter(md: string, heading: string): string {
  const h = md.indexOf(heading);
  if (h < 0) throw new Error(`heading not found: ${heading}`);
  const fence = md.indexOf('```', h);
  if (fence < 0) throw new Error(`no fence after: ${heading}`);
  const open = md.indexOf('\n', fence);
  const close = md.indexOf('\n```', open);
  if (close < 0) throw new Error(`unclosed fence after: ${heading}`);
  return md.slice(open + 1, close + 1);
}

/** Code-point slice, for asserting anchors without touching internals. */
export function cpSlice(s: string, start: number, end: number): string {
  return [...s].slice(start, end).join('');
}

/** Code-point offset of the first occurrence of `needle` in `s`. */
export function cpIndexOf(s: string, needle: string): number {
  const idx = s.indexOf(needle);
  if (idx < 0) throw new Error(`needle not found: ${needle}`);
  return [...s.slice(0, idx)].length;
}
