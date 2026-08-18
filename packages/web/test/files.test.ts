import { describe, expect, it } from 'vitest';
import {
  fingerprintFile,
  readMarkdownFile,
  saveToWritableSource,
  serializeDocument,
  type WritableSourceHandle,
} from '../src/files.js';

describe('local Markdown boundaries', () => {
  it('normalizes CRLF internally and restores it on export', async () => {
    const file = new File(['alpha\r\nbeta\r\n'], 'draft.md', { type: 'text/markdown' });
    const document = await readMarkdownFile(file);
    expect(document.lineEnding).toBe('crlf');
    expect(document.text).toBe('alpha\nbeta\n');
    expect(serializeDocument(document, 'alpha\nrevised\n')).toBe('alpha\r\nrevised\r\n');
  });

  it('preserves a UTF-8 BOM on export', async () => {
    const file = new File([new Uint8Array([0xef, 0xbb, 0xbf]), 'hello\n'], 'bom.md');
    const document = await readMarkdownFile(file);
    expect(document.bom).toBe(true);
    expect(serializeDocument(document, document.text)).toBe('\uFEFFhello\n');
  });

  it('refuses to overwrite a source that changed externally', async () => {
    let writes = 0;
    const handle = {
      queryPermission: async () => 'granted',
      requestPermission: async () => 'granted',
      getFile: async () => new File(['new'], 'draft.md', { lastModified: 11 }),
      createWritable: async () => ({
        write: async () => {
          writes++;
        },
        close: async () => undefined,
      }),
    } as WritableSourceHandle;
    const original = new File(['old'], 'draft.md', { lastModified: 11 });
    const result = await saveToWritableSource(
      handle,
      { name: 'draft.md', text: 'old\n', lineEnding: 'lf', bom: false },
      'new\n',
      await fingerprintFile(original),
    );
    expect(result).toEqual({ ok: false, reason: 'conflict' });
    expect(writes).toBe(0);
  });

  it('writes serialized content only after permission and freshness checks', async () => {
    let stored = '';
    let modifiedAt = 11;
    const handle = {
      queryPermission: async () => 'prompt',
      requestPermission: async () => 'granted',
      getFile: async () => new File([stored], 'draft.md', { lastModified: modifiedAt }),
      createWritable: async () => ({
        write: async (data: string) => {
          stored = data;
        },
        close: async () => {
          modifiedAt = 12;
        },
      }),
    } as WritableSourceHandle;
    const original = new File([stored], 'draft.md', { lastModified: modifiedAt });
    const result = await saveToWritableSource(
      handle,
      { name: 'draft.md', text: 'old\n', lineEnding: 'crlf', bom: true },
      'new\nline\n',
      await fingerprintFile(original),
    );
    expect(result).toMatchObject({
      ok: true,
      fingerprint: { modifiedAt: 12, size: 14 },
    });
    expect(stored).toBe('\uFEFFnew\r\nline\r\n');
  });
});
