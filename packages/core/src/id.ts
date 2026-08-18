import { parse } from './parse.js';

/** Generation alphabet: lowercase letters and digits, excluding visually
 * confusable characters (SPEC §5.1). */
export const ID_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';

export interface GenerateIdOptions {
  /** Identifiers already present; the generated id will not collide. */
  existing?: Iterable<string>;
  /** Total length, 1–8. Default 3, growing to 4+ under collision pressure. */
  length?: number;
  /** Reserved first character for merge safety (SPEC §5.1). */
  sessionPrefix?: string;
  /** Random source in [0, 1); injectable for tests. */
  random?: () => number;
}

/** Mint a non-sequential identifier that is unique against `existing`
 * (scan-then-pick: uniqueness by construction, SPEC §5.1). */
export function generateId(options: GenerateIdOptions = {}): { id: string } {
  const {
    existing = [],
    length = 3,
    sessionPrefix = '',
    random = Math.random,
  } = options;
  if (sessionPrefix.length > 1 || (sessionPrefix && !/^[A-Za-z0-9]$/.test(sessionPrefix))) {
    throw new Error('sessionPrefix must be a single alphanumeric character');
  }
  if (length < 1 || length > 8) {
    throw new Error('identifier length must be between 1 and 8');
  }
  const taken = existing instanceof Set ? existing : new Set(existing);
  for (let len = Math.max(length, sessionPrefix ? 2 : 1); len <= 8; len++) {
    const randomChars = len - sessionPrefix.length;
    // Enough attempts to make exhaustion at this length overwhelmingly
    // unlikely before growing.
    const attempts = 50;
    for (let a = 0; a < attempts; a++) {
      let id = sessionPrefix;
      for (let i = 0; i < randomChars; i++) {
        id += ID_ALPHABET[Math.floor(random() * ID_ALPHABET.length)];
      }
      if (!taken.has(id)) return { id };
    }
  }
  throw new Error('unable to generate a unique identifier');
}

/** All identifiers present in an annotated document. */
export function existingIds(text: string): { ids: string[] } {
  const result = parse(text);
  const ids: string[] = [];
  for (const c of result.comments) {
    if (c.id !== null) ids.push(c.id);
  }
  return { ids };
}
