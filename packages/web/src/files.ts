export type LineEnding = 'lf' | 'crlf' | 'mixed';

export interface LocalDocument {
  name: string;
  text: string;
  lineEnding: LineEnding;
  bom: boolean;
}

export interface WritableSourceHandle {
  getFile(): Promise<File>;
  createWritable(): Promise<{
    write(data: string): Promise<void>;
    close(): Promise<void>;
  }>;
  queryPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
}

export interface SourceFingerprint {
  modifiedAt: number;
  size: number;
  sha256: string;
}

export async function fingerprintFile(file: File): Promise<SourceFingerprint> {
  const bytes = await file.arrayBuffer();
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return {
    modifiedAt: file.lastModified,
    size: file.size,
    sha256: Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join(''),
  };
}

export async function readMarkdownFile(file: File): Promise<LocalDocument> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const bom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bom ? bytes.slice(3) : bytes);
  const crlfCount = decoded.match(/\r\n/g)?.length ?? 0;
  const bareLfCount = decoded.replace(/\r\n/g, '').match(/\n/g)?.length ?? 0;
  const bareCrCount = decoded.replace(/\r\n/g, '').match(/\r/g)?.length ?? 0;
  const lineEnding: LineEnding =
    crlfCount > 0 && bareLfCount === 0 && bareCrCount === 0
      ? 'crlf'
      : crlfCount === 0 && bareCrCount === 0
        ? 'lf'
        : 'mixed';
  return {
    name: file.name,
    text: decoded.replace(/\r\n?/g, '\n'),
    lineEnding,
    bom,
  };
}

export function serializeDocument(document: LocalDocument, text: string): string {
  const lineEnding = document.lineEnding === 'crlf' ? '\r\n' : '\n';
  const normalized = text.replace(/\r\n?/g, '\n');
  return `${document.bom ? '\uFEFF' : ''}${
    lineEnding === '\n' ? normalized : normalized.replace(/\n/g, lineEnding)
  }`;
}

export function downloadMarkdown(document: LocalDocument, text: string): void {
  const blob = new Blob([serializeDocument(document, text)], {
    type: 'text/markdown;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement('a');
  anchor.href = url;
  anchor.download = document.name || 'annotated.md';
  anchor.hidden = true;
  window.document.body.append(anchor);
  anchor.click();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
    anchor.remove();
  }, 1000);
}

export async function saveToWritableSource(
  handle: WritableSourceHandle,
  document: LocalDocument,
  text: string,
  expectedFingerprint: SourceFingerprint | null,
): Promise<
  | { ok: true; fingerprint: SourceFingerprint }
  | { ok: false; reason: 'permission' | 'conflict' }
> {
  let permission = await handle.queryPermission({ mode: 'readwrite' });
  if (permission !== 'granted') {
    permission = await handle.requestPermission({ mode: 'readwrite' });
  }
  if (permission !== 'granted') return { ok: false, reason: 'permission' };

  const current = await handle.getFile();
  const currentFingerprint = await fingerprintFile(current);
  if (
    expectedFingerprint !== null &&
    (currentFingerprint.modifiedAt !== expectedFingerprint.modifiedAt ||
      currentFingerprint.size !== expectedFingerprint.size ||
      currentFingerprint.sha256 !== expectedFingerprint.sha256)
  ) {
    return { ok: false, reason: 'conflict' };
  }
  const writable = await handle.createWritable();
  await writable.write(serializeDocument(document, text));
  await writable.close();
  return { ok: true, fingerprint: await fingerprintFile(await handle.getFile()) };
}
