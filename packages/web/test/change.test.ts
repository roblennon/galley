import { describe, expect, it } from 'vitest';
import { minimalTextChange } from '../src/change.js';

describe('minimalTextChange', () => {
  it('returns one localized replacement', () => {
    expect(minimalTextChange('alpha beta omega', 'alpha fresh omega')).toEqual({
      from: 6,
      to: 10,
      insert: 'fresh',
    });
  });

  it('handles insertions, deletions, and no-op changes', () => {
    expect(minimalTextChange('ab', 'aXb')).toEqual({ from: 1, to: 1, insert: 'X' });
    expect(minimalTextChange('aXb', 'ab')).toEqual({ from: 1, to: 2, insert: '' });
    expect(minimalTextChange('same', 'same')).toBeNull();
  });

  it('keeps UTF-16 boundaries intact around astral characters', () => {
    expect(minimalTextChange('A 🌿 thought', 'A {==🌿==} thought')).toEqual({
      from: 2,
      to: 4,
      insert: '{==🌿==}',
    });
  });
});
