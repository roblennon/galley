import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));

export function readRepoFile(relPath: string): string {
  return readFileSync(root + relPath, 'utf8');
}

export function readFixture<T>(relPath: string): T {
  return JSON.parse(readRepoFile('conformance/' + relPath)) as T;
}

/**
 * Every `.json` fixture in a conformance directory, sorted by file name.
 * Directories are globbed rather than named one by one so a fixture added by a
 * third-party implementer — or by us — is picked up without touching the suite.
 * An empty directory is an error: a silently-empty conformance run is worse
 * than a missing one.
 */
export function readFixtureDir<T>(dir: string): { file: string; fixture: T }[] {
  const files = readdirSync(root + 'conformance/' + dir)
    .filter((f) => f.endsWith('.json'))
    .sort();
  if (files.length === 0) {
    throw new Error(`no conformance fixtures found in conformance/${dir}`);
  }
  return files.map((file) => ({
    file: `${dir}/${file}`,
    fixture: readFixture<T>(`${dir}/${file}`),
  }));
}

/** Assert a parse/apply result's issues against a fixture's `expectedIssues`.
 * Absent means "no issues at all"; present means exactly these, in any order. */
export function expectIssues(
  actual: readonly { code: string; severity: string }[],
  expected: readonly { code: string; severity: string }[] | undefined,
): void {
  const norm = (xs: readonly { code: string; severity: string }[]) =>
    xs
      .map((i) => `${i.severity}:${i.code}`)
      .sort()
      .join(', ');
  if (expected === undefined) {
    if (actual.length !== 0) {
      throw new Error(
        `expected a clean parse, got: ${norm(actual)} (add "expectedIssues" to the fixture if this is intended)`,
      );
    }
    return;
  }
  if (norm(actual) !== norm(expected)) {
    throw new Error(
      `issues do not match the fixture\n  expected: ${norm(expected)}\n  actual:   ${norm(actual)}`,
    );
  }
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
