import { parse } from './parse.js';
import type { Issue } from './types.js';

/**
 * Answer "is this document well-formed?" (distinct from conformance, which
 * asks whether an implementation is correct). Returns every issue found;
 * `valid` is false when any issue is an error.
 */
export function validate(text: string): { valid: boolean; issues: Issue[] } {
  const { issues } = parse(text);
  return {
    valid: issues.every((i) => i.severity !== 'error'),
    issues,
  };
}
