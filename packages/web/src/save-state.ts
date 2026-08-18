/**
 * The save-state badge is the app's truthfulness contract: it must never
 * claim text is safe when it is not. Deriving the state and its wording in
 * one place keeps that promise checkable instead of scattered across call
 * sites.
 */

export type SaveState =
  | 'sample'
  | 'ready'
  | 'unsaved'
  | 'recovered'
  | 'restored-downloaded'
  | 'download-started'
  | 'saved'
  | 'current';

/**
 * The last user-visible document event. Any edit clears it, so states like
 * `recovered` and `download-started` describe the moment, not the document
 * forever.
 */
export type SaveEvent =
  | 'opened'
  | 'recovered'
  | 'restored-downloaded'
  | 'download-started'
  | null;

export interface SaveStateInput {
  /** Editor text differs from the last exported/saved text. */
  dirty: boolean;
  /** A writable source-file handle is attached (Chromium open). */
  hasHandle: boolean;
  /** A download or source save happened at least once for this document. */
  hasExported: boolean;
  /** The document began as the built-in sample rather than a user file. */
  isSample: boolean;
  lastEvent: SaveEvent;
}

export function deriveSaveState(input: SaveStateInput): SaveState {
  if (input.dirty) {
    return input.lastEvent === 'recovered' ? 'recovered' : 'unsaved';
  }
  if (input.lastEvent === 'restored-downloaded') return 'restored-downloaded';
  if (input.lastEvent === 'download-started') return 'download-started';
  if (input.hasHandle) return input.lastEvent === 'opened' ? 'ready' : 'saved';
  if (input.hasExported) return 'current';
  return input.isSample ? 'sample' : 'ready';
}

export interface SaveStateView {
  label: string;
  detail: string;
}

export function saveStateView(state: SaveState, hasHandle: boolean): SaveStateView {
  switch (state) {
    case 'sample':
      return { label: 'Sample', detail: 'Sample document · contents stay on this device' };
    case 'ready':
      return {
        label: 'Ready',
        detail: hasHandle ? 'Source file opened' : 'Original file unchanged',
      };
    case 'unsaved':
      return {
        label: 'Unsaved',
        detail: hasHandle
          ? 'Unsaved changes · recovery stored locally'
          : 'Not downloaded · recovery stored locally',
      };
    case 'recovered':
      return { label: 'Recovered', detail: 'Recovered locally · download to keep' };
    case 'restored-downloaded':
      return {
        label: 'Current',
        detail: 'Restored · a download of this text was already started',
      };
    case 'download-started':
      return {
        label: 'Started',
        detail: 'Download started · copy should appear in Downloads',
      };
    case 'saved':
      return { label: 'Saved', detail: 'Saved to source file' };
    case 'current':
      return { label: 'Current', detail: 'Downloaded copy is current' };
  }
}
