import { describe, expect, it } from 'vitest';
import { deriveSaveState, saveStateView, type SaveStateInput } from '../src/save-state.js';

function input(overrides: Partial<SaveStateInput>): SaveStateInput {
  return {
    dirty: false,
    hasHandle: false,
    hasExported: false,
    isSample: false,
    lastEvent: null,
    ...overrides,
  };
}

describe('deriveSaveState', () => {
  it('walks the sample lifecycle: pristine, edited, undone', () => {
    expect(deriveSaveState(input({ isSample: true }))).toBe('sample');
    expect(deriveSaveState(input({ isSample: true, dirty: true }))).toBe('unsaved');
    // Undo back to pristine returns to sample, never "downloaded copy is current".
    expect(deriveSaveState(input({ isSample: true }))).toBe('sample');
  });

  it('reports a freshly opened file as ready with or without a handle', () => {
    expect(deriveSaveState(input({ lastEvent: 'opened', hasHandle: true }))).toBe('ready');
    expect(deriveSaveState(input({ lastEvent: 'opened' }))).toBe('ready');
  });

  it('never claims a copy exists for an unexported file returned to baseline', () => {
    expect(deriveSaveState(input({}))).toBe('ready');
  });

  it('claims current only after an export actually happened', () => {
    expect(deriveSaveState(input({ hasExported: true }))).toBe('current');
  });

  it('reports saved through a handle once edits are written', () => {
    expect(deriveSaveState(input({ hasHandle: true, hasExported: true }))).toBe('saved');
  });

  it('keeps a restored dirty draft labeled recovered until the next edit', () => {
    expect(deriveSaveState(input({ dirty: true, lastEvent: 'recovered' }))).toBe('recovered');
    expect(deriveSaveState(input({ dirty: true, lastEvent: null }))).toBe('unsaved');
  });

  it('separates download-started from confirmed-current', () => {
    const started = deriveSaveState(
      input({ lastEvent: 'download-started', hasExported: true }),
    );
    expect(started).toBe('download-started');
    expect(saveStateView(started, false).label).toBe('Started');
  });

  it('labels a restored already-downloaded draft honestly', () => {
    const state = deriveSaveState(
      input({ lastEvent: 'restored-downloaded', hasExported: true }),
    );
    expect(state).toBe('restored-downloaded');
    expect(saveStateView(state, false).detail).toContain('already started');
  });

  it('dirty always wins over any stale event except recovered', () => {
    expect(
      deriveSaveState(input({ dirty: true, lastEvent: 'download-started' })),
    ).toBe('unsaved');
    expect(
      deriveSaveState(input({ dirty: true, hasHandle: true, hasExported: true })),
    ).toBe('unsaved');
  });
});

describe('saveStateView', () => {
  it('tells handle users about their source file and others about downloads', () => {
    expect(saveStateView('unsaved', true).detail).toContain('Unsaved changes');
    expect(saveStateView('unsaved', false).detail).toContain('Not downloaded');
    expect(saveStateView('ready', true).detail).toBe('Source file opened');
    expect(saveStateView('ready', false).detail).toBe('Original file unchanged');
  });
});
