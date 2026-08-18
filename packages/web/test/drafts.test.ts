import { describe, expect, it } from 'vitest';
import { planEvictions, selectRecoveryDraft, type RecoveryDraft } from '../src/drafts.js';

function draft(overrides: Partial<RecoveryDraft>): RecoveryDraft {
  return {
    key: 'draft:test',
    name: 'story.md',
    text: 'changed',
    exportedText: 'original',
    lineEnding: 'lf',
    bom: false,
    updatedAt: 1,
    ...overrides,
  };
}

describe('selectRecoveryDraft', () => {
  it('restores the newest unsaved tab without discarding another tab draft', () => {
    const olderDirty = draft({ key: 'draft:a', updatedAt: 2 });
    const newerDirty = draft({ key: 'draft:b', text: 'newest', updatedAt: 4 });
    const newestClean = draft({
      key: 'draft:c',
      text: 'downloaded',
      exportedText: 'downloaded',
      updatedAt: 5,
    });

    expect(selectRecoveryDraft([newerDirty, newestClean, olderDirty])).toBe(newerDirty);
  });

  it('returns null when every tab is current', () => {
    expect(
      selectRecoveryDraft([
        draft({ text: 'same', exportedText: 'same', updatedAt: 2 }),
      ]),
    ).toBeNull();
  });

  it('ignores the legacy singleton after versioned tab records exist', () => {
    const legacy = draft({ key: 'current', updatedAt: 9 });
    const current = draft({
      key: 'draft:new',
      text: 'same',
      exportedText: 'same',
      updatedAt: 10,
    });

    expect(selectRecoveryDraft([legacy, current])).toBeNull();
  });
});

describe('planEvictions', () => {
  it('evicts clean records before dirty ones regardless of age', () => {
    const oldDirty = draft({ key: 'draft:dirty', updatedAt: 1 });
    const cleanRecords = Array.from({ length: 10 }, (_, index) =>
      draft({
        key: `draft:clean-${index}`,
        text: 'same',
        exportedText: 'same',
        updatedAt: 10 + index,
      }),
    );

    const evicted = planEvictions([oldDirty, ...cleanRecords], 10);

    expect(evicted).toEqual(['draft:clean-0']);
  });

  it('evicts the oldest dirty records when every record is dirty', () => {
    const records = Array.from({ length: 12 }, (_, index) =>
      draft({ key: `draft:${index}`, updatedAt: index }),
    );

    expect(planEvictions(records, 10).sort()).toEqual(['draft:0', 'draft:1']);
  });

  it('evicts nothing under the cap', () => {
    expect(planEvictions([draft({ key: 'draft:a' })], 10)).toEqual([]);
  });
});
