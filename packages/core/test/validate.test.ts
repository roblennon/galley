import { describe, expect, it } from 'vitest';
import { validate } from '../src/index.js';

describe('validate', () => {
  it('accepts a well-formed document', () => {
    const { valid, issues } = validate(
      'Fine prose {==here==}{>>[v1a] check<<}.\n',
    );
    expect(valid).toBe(true);
    expect(issues).toEqual([]);
  });

  it('rejects malformed syntax with errors, keeps warnings non-fatal', () => {
    const malformed = validate('bad {==highlight with no comment==} here\n');
    expect(malformed.valid).toBe(false);

    const warned = validate('{==[ab] text==}{>>[cd] note<<}\n');
    expect(warned.valid).toBe(true);
    expect(warned.issues.some((i) => i.severity === 'warning')).toBe(true);
  });
});
