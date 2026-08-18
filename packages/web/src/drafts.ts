import type { LineEnding, LocalDocument } from './files.js';

const DATABASE = 'galley-browser-lab';
const STORE = 'drafts';
const MAX_DRAFTS = 10;
const WRITER_ID =
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export interface RecoveryDraft {
  key: string;
  writerId?: string;
  name: string;
  text: string;
  exportedText: string;
  /**
   * The text a download was started for. Browsers cannot report whether the
   * user completed or cancelled the save dialog, so a downloaded draft stays
   * restorable (text !== exportedText) but the next session can tell the user
   * a copy probably already exists.
   */
  downloadedText?: string;
  lineEnding: LineEnding;
  bom: boolean;
  updatedAt: number;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open draft storage'));
  });
}

export async function saveRecoveryDraft(
  document: LocalDocument,
  text: string,
  exportedText: string,
  downloadedText?: string,
): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE, 'readwrite');
    const store = transaction.objectStore(STORE);
    store.put({
      key: `draft:${WRITER_ID}`,
      writerId: WRITER_ID,
      name: document.name,
      text,
      exportedText,
      ...(downloadedText === undefined ? {} : { downloadedText }),
      lineEnding: document.lineEnding,
      bom: document.bom,
      updatedAt: Date.now(),
    } satisfies RecoveryDraft);
    const allRequest = store.getAll();
    allRequest.onsuccess = () => {
      for (const key of planEvictions(allRequest.result as RecoveryDraft[], MAX_DRAFTS)) {
        store.delete(key);
      }
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Could not save draft'));
  });
  database.close();
}

export async function loadRecoveryDraft(): Promise<RecoveryDraft | null> {
  const database = await openDatabase();
  const result = await new Promise<RecoveryDraft[]>((resolve, reject) => {
    const request = database.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    request.onsuccess = () => resolve(request.result as RecoveryDraft[]);
    request.onerror = () => reject(request.error ?? new Error('Could not read draft'));
  });
  database.close();
  return selectRecoveryDraft(result);
}

/**
 * Delete one draft record by key. Used after this session adopts a restored
 * draft under its own writer id, so a draft never has two owners.
 */
export async function deleteRecoveryDraft(key: string): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).delete(key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Could not delete draft'));
  });
  database.close();
}

/**
 * Keys to delete when trimming to `max` records. A dirty draft is a user's
 * only copy of unexported text, so clean records are always evicted first.
 */
export function planEvictions(drafts: RecoveryDraft[], max: number): string[] {
  const byNewest = [...drafts].sort((a, b) => b.updatedAt - a.updatedAt);
  const dirty = byNewest.filter((draft) => draft.text !== draft.exportedText);
  const clean = byNewest.filter((draft) => draft.text === draft.exportedText);
  const keep = new Set([...dirty, ...clean].slice(0, max).map((draft) => draft.key));
  return drafts.map((draft) => draft.key).filter((key) => !keep.has(key));
}

export function selectRecoveryDraft(drafts: RecoveryDraft[]): RecoveryDraft | null {
  const versioned = drafts.filter((draft) => draft.key.startsWith('draft:'));
  const candidates = versioned.length > 0 ? versioned : drafts;
  return (
    candidates
      .filter((draft) => draft.text !== draft.exportedText)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null
  );
}
