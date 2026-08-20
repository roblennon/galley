import './styles.css';
import {
  addComment,
  applyBatch,
  exportFinalText,
  parse,
  removeComment,
  resolveEditMarks,
  AI_REVIEW_PREAMBLE,
} from '@galleymd/core';
import {
  buildPanelModel,
  computeTarget,
  extractBatchJson,
  summarizeReport,
  type ReportSummary,
} from '@galleymd/codemirror';
import { GalleyEditor, type SelectionSnapshot } from './editor.js';
import {
  downloadMarkdown,
  fingerprintFile,
  readMarkdownFile,
  saveToWritableSource,
  type LocalDocument,
  type SourceFingerprint,
  type WritableSourceHandle,
} from './files.js';
import { SAMPLE_DOCUMENT, SAMPLE_NAME } from './sample.js';
import { createDemoBatch } from './roundtrip.js';
import { deleteRecoveryDraft, loadRecoveryDraft, saveRecoveryDraft } from './drafts.js';
import { deriveSaveState, saveStateView, type SaveEvent } from './save-state.js';

declare global {
  interface Window {
    showOpenFilePicker?: (options?: {
      multiple?: boolean;
      types?: Array<{
        description: string;
        accept: Record<string, string[]>;
      }>;
    }) => Promise<WritableSourceHandle[]>;
  }
}

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('Missing #app');

root.innerHTML = `
  <main class="app-shell">
    <header class="topbar">
      <div class="brand">
        <span class="brand-name">Galley</span>
        <span class="file-name" id="file-name"></span>
      </div>
      <span class="save-state" id="save-state" data-dirty="false" data-tooltip="Sample document" role="status">Sample</span>
      <div class="toolbar-group" aria-label="Document actions">
        <input id="file-input" type="file" accept=".md,.markdown,text/markdown,text/plain" hidden />
        <button class="icon-button" id="mode-toggle" type="button" aria-label="Show Markdown source" data-tooltip="Show Markdown source" title="Show Markdown source"><span aria-hidden="true">&lt;/&gt;</span></button>
        <button class="icon-button" id="open-file" type="button" aria-label="Open Markdown" data-tooltip="Open Markdown" title="Open Markdown"><span aria-hidden="true">＋</span></button>
        <button class="icon-button" id="ai-review" type="button" aria-label="AI handoff" data-tooltip="AI handoff" title="AI handoff"><span aria-hidden="true">✦</span></button>
        <button class="icon-button" id="save-source" type="button" aria-label="Save to source file" data-tooltip="Save to source file" title="Save to source file" hidden><span aria-hidden="true">↥</span></button>
        <button class="icon-button accent-icon" id="download" type="button" aria-label="Download Markdown" data-tooltip="Download Markdown" data-tooltip-align="end" title="Download Markdown"><span aria-hidden="true">↓</span></button>
      </div>
      <a class="icon-button repo-link" href="https://github.com/roblennon/galley" target="_blank" rel="noreferrer" aria-label="Galley source and specification on GitHub" data-tooltip="Source and spec on GitHub" data-tooltip-align="end" title="Source and spec on GitHub"><svg viewBox="0 0 16 16" width="20" height="20" aria-hidden="true" focusable="false" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.4 7.4 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg></a>
    </header>
    <section class="workspace" id="workspace">
      <div class="editor-pane">
        <div class="editor-wrap">
          <div class="editor-host" id="editor"></div>
        </div>
      </div>
      <aside class="comments-panel" id="comments-panel" data-collapsed="false" aria-label="Document comments">
        <div class="panel-header">
          <button class="panel-toggle" id="panel-toggle" type="button" aria-expanded="true" aria-label="Collapse comments panel" data-tooltip="Collapse comments" title="Collapse comments">›</button>
          <h2>Comments</h2>
          <span class="count" id="comment-count">0</span>
        </div>
        <div class="panel-list" id="panel-list"></div>
      </aside>
    </section>
    <form class="comment-composer" id="comment-composer" hidden>
      <label for="comment-body">Comment on selection</label>
      <textarea id="comment-body" rows="3" placeholder="What should change here?"></textarea>
      <p class="composer-hint">Enter to save · Shift+Enter for a new line · Esc to cancel</p>
    </form>
    <div class="notice" id="notice" role="status" aria-live="polite" hidden></div>
    <dialog class="review-dialog" id="review-dialog">
      <div class="review-header">
        <div>
          <span class="eyebrow">Complete the loop</span>
          <h2>AI handoff</h2>
        </div>
        <button class="ghost dialog-close" id="review-close" type="button" aria-label="Close AI handoff">×</button>
      </div>
      <section class="review-step" aria-labelledby="review-step-one">
        <div class="review-step-heading">
          <span class="step-number">Step 1</span>
          <h3 id="review-step-one">Send comments to an AI</h3>
        </div>
        <p>These instructions ask an AI to address every comment and return edits in Galley’s structured patch format.</p>
        <label class="review-label" for="review-prompt">Instructions + annotated document</label>
        <textarea class="review-prompt" id="review-prompt" rows="5" readonly></textarea>
        <div class="review-actions review-step-actions">
          <button id="copy-review" type="button">Copy instructions + document</button>
        </div>
      </section>
      <section class="review-step" aria-labelledby="review-step-two">
        <div class="review-step-heading">
          <span class="step-number">Step 2</span>
          <h3 id="review-step-two">Paste the AI response</h3>
        </div>
        <p>Galley validates the structured patch before changing your document.</p>
        <label class="review-label" for="patch-input">AI patch response</label>
        <textarea class="patch-input" id="patch-input" rows="10" placeholder="Paste the JSON patch batch here…"></textarea>
        <div class="review-actions review-submit">
          <button id="demo-response" type="button">Run sample response</button>
          <button class="primary" id="apply-patch" type="button">Apply response</button>
        </div>
      </section>
      <section class="report" id="report" aria-live="polite" hidden></section>
      <section class="tracked-actions" id="tracked-actions" hidden>
        <h3>Review proposed changes</h3>
        <p>Applied patches remain visible as tracked edits until you accept or reject them.</p>
        <div class="review-actions">
          <button class="primary" id="accept-all" type="button">Accept all</button>
          <button id="reject-all" type="button">Reject all</button>
          <button id="download-final" type="button">Download clean final</button>
        </div>
      </section>
    </dialog>
  </main>
`;

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
}

const fileName = byId<HTMLSpanElement>('file-name');
const saveState = byId<HTMLSpanElement>('save-state');
const modeToggle = byId<HTMLButtonElement>('mode-toggle');
const fileInput = byId<HTMLInputElement>('file-input');
const openFile = byId<HTMLButtonElement>('open-file');
const aiReview = byId<HTMLButtonElement>('ai-review');
const saveSource = byId<HTMLButtonElement>('save-source');
const download = byId<HTMLButtonElement>('download');
const workspace = byId<HTMLElement>('workspace');
const panel = byId<HTMLElement>('comments-panel');
const panelToggle = byId<HTMLButtonElement>('panel-toggle');
const panelList = byId<HTMLDivElement>('panel-list');
const commentCount = byId<HTMLSpanElement>('comment-count');
const composer = byId<HTMLFormElement>('comment-composer');
const commentBody = byId<HTMLTextAreaElement>('comment-body');
const notice = byId<HTMLDivElement>('notice');
const reviewDialog = byId<HTMLDialogElement>('review-dialog');
const reviewClose = byId<HTMLButtonElement>('review-close');
const reviewPrompt = byId<HTMLTextAreaElement>('review-prompt');
const copyReview = byId<HTMLButtonElement>('copy-review');
const demoResponse = byId<HTMLButtonElement>('demo-response');
const patchInput = byId<HTMLTextAreaElement>('patch-input');
const applyPatch = byId<HTMLButtonElement>('apply-patch');
const report = byId<HTMLElement>('report');
const trackedActions = byId<HTMLElement>('tracked-actions');
const acceptAll = byId<HTMLButtonElement>('accept-all');
const rejectAll = byId<HTMLButtonElement>('reject-all');
const downloadFinal = byId<HTMLButtonElement>('download-final');

let localDocument: LocalDocument = {
  name: SAMPLE_NAME,
  text: SAMPLE_DOCUMENT,
  lineEnding: 'lf',
  bom: false,
};
let exportedText = SAMPLE_DOCUMENT;
let activeSelection: SelectionSnapshot | null = null;
let loadingDocument = false;
let noticeTimer: number | undefined;
let recoveryTimer: number | undefined;
let sourceHandle: WritableSourceHandle | null = null;
let sourceFingerprint: SourceFingerprint | null = null;
let documentGeneration = 0;
let saveInFlight = false;
let pendingFileInputOpen: { revision: number; generation: number } | null = null;
let lastEvent: SaveEvent = null;
let hasExported = false;
let isSample = true;

const editor = new GalleyEditor(byId<HTMLDivElement>('editor'), SAMPLE_DOCUMENT, {
  onChange(text) {
    renderPanel(text);
    updateTrackedActions();
    if (!loadingDocument) {
      lastEvent = null;
      updateSaveState();
      scheduleRecovery();
    }
  },
  onSelection(selection) {
    openComposer(selection);
  },
});

function showNotice(message: string): void {
  window.clearTimeout(noticeTimer);
  notice.textContent = message;
  notice.hidden = false;
  noticeTimer = window.setTimeout(() => {
    notice.hidden = true;
  }, 5200);
}

function isDirty(): boolean {
  return editor.text !== exportedText;
}

function updateSaveState(): void {
  const state = deriveSaveState({
    dirty: isDirty(),
    hasHandle: sourceHandle !== null,
    hasExported,
    isSample,
    lastEvent,
  });
  const view = saveStateView(state, sourceHandle !== null);
  saveState.dataset.dirty = String(isDirty());
  saveState.textContent = view.label;
  saveState.dataset.tooltip = view.detail;
  saveState.title = view.detail;
}

function scheduleRecovery(): void {
  window.clearTimeout(recoveryTimer);
  recoveryTimer = window.setTimeout(() => {
    recoveryTimer = undefined;
    void saveRecoveryDraft(localDocument, editor.text, exportedText).catch(() => {
      showNotice('Local draft recovery is unavailable. Download to keep your changes.');
    });
  }, 350);
}

async function restoreRecovery(): Promise<void> {
  const initialRevision = editor.currentRevision;
  const initialGeneration = documentGeneration;
  try {
    const draft = await loadRecoveryDraft();
    if (
      editor.currentRevision !== initialRevision ||
      documentGeneration !== initialGeneration ||
      isDirty()
    ) {
      return;
    }
    if (!draft || draft.text === draft.exportedText) return;
    localDocument = {
      name: draft.name,
      text: draft.text,
      lineEnding: draft.lineEnding,
      bom: draft.bom,
    };
    // A draft whose download was started is offered once more (the save dialog
    // may have been cancelled), then settles as current instead of nagging
    // every future session about text the user most likely already has.
    const downloadWasStarted = draft.downloadedText === draft.text;
    exportedText = downloadWasStarted ? draft.text : draft.exportedText;
    loadingDocument = true;
    editor.setText(draft.text);
    loadingDocument = false;
    fileName.textContent = draft.name;
    isSample = false;
    hasExported = downloadWasStarted;
    lastEvent = downloadWasStarted ? 'restored-downloaded' : 'recovered';
    updateSaveState();
    showNotice(
      downloadWasStarted
        ? 'Restored your last document. A download of it was already started.'
        : 'Recovered an unsaved local draft from this browser.',
    );
    // Claim the draft: rewrite it under this session's writer id, then delete
    // the original record so no later session re-offers already-handled text.
    void saveRecoveryDraft(localDocument, editor.text, exportedText)
      .then(() => deleteRecoveryDraft(draft.key))
      .catch(() => {});
  } catch {
    // Recovery is an enhancement. The editor remains usable when storage is blocked.
  }
}

async function confirmDocumentReplacement(): Promise<boolean> {
  return !isDirty() || window.confirm('This draft has unexported changes. Open another file anyway?');
}

function loadDocument(
  next: LocalDocument,
  handle: WritableSourceHandle | null,
  fingerprint: SourceFingerprint | null,
): void {
  documentGeneration += 1;
  localDocument = next;
  sourceHandle = handle;
  sourceFingerprint = fingerprint;
  saveSource.hidden = handle === null;
  exportedText = next.text;
  loadingDocument = true;
  editor.setText(next.text);
  loadingDocument = false;
  fileName.textContent = next.name;
  setMode(true);
  isSample = false;
  hasExported = false;
  lastEvent = 'opened';
  updateSaveState();
  void saveRecoveryDraft(localDocument, editor.text, exportedText).catch(() => {});
  if (next.lineEnding === 'mixed') {
    showNotice('This file uses mixed line endings. Downloads will use LF consistently.');
  } else if (next.lineEnding === 'crlf' || next.bom) {
    showNotice('Line endings and UTF-8 BOM will be preserved when you save or download.');
  }
}

async function openLocalDocument(): Promise<void> {
  if (!(await confirmDocumentReplacement())) return;
  const openSnapshot = {
    revision: editor.currentRevision,
    generation: documentGeneration,
  };
  if (!window.showOpenFilePicker) {
    pendingFileInputOpen = openSnapshot;
    fileInput.click();
    return;
  }
  try {
    const [handle] = await window.showOpenFilePicker({
      multiple: false,
      types: [
        {
          description: 'Markdown documents',
          accept: { 'text/markdown': ['.md', '.markdown'], 'text/plain': ['.txt'] },
        },
      ],
    });
    if (!handle) return;
    const file = await handle.getFile();
    if (
      (editor.currentRevision !== openSnapshot.revision ||
        documentGeneration !== openSnapshot.generation) &&
      !(await confirmDocumentReplacement())
    ) {
      return;
    }
    loadDocument(await readMarkdownFile(file), handle, await fingerprintFile(file));
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    showNotice(`Could not open that file: ${error instanceof Error ? error.message : error}`);
  }
}

async function saveToSource(): Promise<void> {
  const handle = sourceHandle;
  if (!handle || saveInFlight) return;
  const textToSave = editor.text;
  const documentToSave = { ...localDocument };
  const generation = documentGeneration;
  saveInFlight = true;
  saveSource.disabled = true;
  openFile.disabled = true;
  try {
    const result = await saveToWritableSource(
      handle,
      documentToSave,
      textToSave,
      sourceFingerprint,
    );
    if (!result.ok) {
      showNotice(
        result.reason === 'permission'
          ? 'Write permission was not granted. Download a copy instead.'
          : 'The source file changed outside Galley. Reopen it before saving.',
      );
      return;
    }
    if (sourceHandle !== handle || documentGeneration !== generation) {
      showNotice(`Saved ${documentToSave.name}; the open document has since changed.`);
      return;
    }
    sourceFingerprint = result.fingerprint;
    exportedText = textToSave;
    hasExported = true;
    lastEvent = null;
    updateSaveState();
    // The file write above succeeded; a failed draft write must not make this
    // save report as a failure.
    void saveRecoveryDraft(localDocument, editor.text, exportedText).catch(() => {});
    showNotice(
      editor.text === textToSave
        ? `Saved ${localDocument.name}.`
        : `Saved ${localDocument.name}. Newer edits remain unsaved.`,
    );
  } catch (error) {
    showNotice(`Could not save: ${error instanceof Error ? error.message : error}`);
  } finally {
    saveInFlight = false;
    saveSource.disabled = false;
    openFile.disabled = false;
  }
}

function positionComposer(selection: SelectionSnapshot): void {
  const width = Math.min(390, window.innerWidth - 32);
  const desiredLeft = selection.coords?.left ?? window.innerWidth / 2 - width / 2;
  const desiredTop = (selection.coords?.bottom ?? 120) + 10;
  composer.style.left = `${Math.max(16, Math.min(desiredLeft, window.innerWidth - width - 16))}px`;
  composer.style.top = `${Math.max(16, Math.min(desiredTop, window.innerHeight - 190))}px`;
}

function openComposer(selection: SelectionSnapshot): void {
  activeSelection = selection;
  commentBody.value = '';
  positionComposer(selection);
  composer.hidden = false;
  window.requestAnimationFrame(() => commentBody.focus());
}

function closeComposer(restoreFocus = true): void {
  composer.hidden = true;
  activeSelection = null;
  commentBody.value = '';
  if (restoreFocus) editor.focus();
}

function submitComment(): void {
  const selection = activeSelection;
  const body = commentBody.value.trim();
  if (!selection || !body) return;
  if (selection.revision !== editor.currentRevision) {
    closeComposer();
    showNotice('The document changed after that selection. Select the text again.');
    return;
  }
  const target = computeTarget(editor.text, selection.from, selection.to);
  if (target.kind !== 'span') {
    showNotice('Select prose rather than annotation syntax to leave a comment.');
    return;
  }
  try {
    const result = addComment(editor.text, { body, at: target.at });
    editor.applyText(result.text);
    closeComposer();
    showNotice(`Comment ${result.id} added.`);
  } catch (error) {
    showNotice(error instanceof Error ? error.message : String(error));
  }
}

function renderPanel(text = editor.text): void {
  const model = buildPanelModel(text);
  commentCount.textContent = String(model.items.length);
  panelList.replaceChildren();
  if (model.items.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'panel-empty';
    empty.textContent = 'Select text to add a comment.';
    panelList.append(empty);
    return;
  }
  for (const item of model.items) {
    const card = document.createElement('article');
    card.className = 'comment-card';

    const meta = document.createElement('div');
    meta.className = 'comment-meta';
    const idButton = document.createElement('button');
    idButton.type = 'button';
    idButton.className = 'comment-id';
    idButton.textContent = item.id ?? '•';
    idButton.title = item.jump ? 'Jump to comment anchor' : 'Comment has no source range';
    idButton.disabled = item.jump === null;
    if (item.jump) {
      idButton.addEventListener('click', () => editor.select(item.jump!.from, item.jump!.to));
    }
    const scope = document.createElement('span');
    scope.className = 'comment-scope';
    scope.textContent = item.scope;
    meta.append(idButton);
    if (item.scope !== 'span') meta.append(scope);

    if (item.id) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'comment-remove';
      remove.setAttribute('aria-label', `Remove comment ${item.id}`);
      remove.title = 'Remove comment';
      remove.textContent = '×';
      remove.addEventListener('click', () => {
        const result = removeComment(editor.text, { id: item.id! });
        if (result.removed) {
          editor.applyText(result.text);
          showNotice(`Comment ${item.id} removed. Undo is available.`);
        }
      });
      meta.append(remove);
    }

    const snippet = document.createElement('div');
    snippet.className = 'comment-snippet';
    snippet.textContent = `“${item.snippet}”`;
    const body = document.createElement('div');
    body.className = 'comment-body';
    body.textContent = item.body;
    card.append(meta, snippet, body);
    panelList.append(card);
  }
}

function updateTrackedActions(): void {
  trackedActions.hidden = parse(editor.text).editMarks.length === 0;
}

function renderReport(summary: ReportSummary): void {
  report.replaceChildren();
  const headline = document.createElement('p');
  headline.className = 'report-headline';
  headline.textContent = summary.headline;
  report.append(headline);
  for (const section of summary.sections) {
    const heading = document.createElement('h3');
    heading.textContent = section.title;
    const list = document.createElement('ul');
    for (const line of section.lines) {
      const item = document.createElement('li');
      item.textContent = line;
      list.append(item);
    }
    report.append(heading, list);
  }
  report.hidden = false;
}

function applyPatchResponse(input: string): void {
  const extracted = extractBatchJson(input);
  if (!extracted.ok) {
    showNotice(extracted.error);
    return;
  }
  try {
    const result = applyBatch(editor.text, extracted.batch, { asEditMarks: true });
    if (result.report.applied.length > 0) editor.applyText(result.text);
    renderReport(summarizeReport(result.report));
    updateTrackedActions();
    if (result.report.applied.length > 0) {
      showNotice('Patch response applied as tracked changes.');
    }
  } catch (error) {
    showNotice(error instanceof Error ? error.message : String(error));
  }
}

function setMode(focused: boolean): void {
  editor.setFocusedMode(focused);
  const label = focused ? 'Show Markdown source' : 'Show focused preview';
  modeToggle.setAttribute('aria-label', label);
  modeToggle.dataset.tooltip = label;
  modeToggle.title = label;
  modeToggle.firstElementChild!.textContent = focused ? '</>' : 'Aa';
}

composer.addEventListener('submit', (event) => {
  event.preventDefault();
  submitComment();
});
commentBody.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    submitComment();
  } else if (event.key === 'Escape') {
    event.preventDefault();
    closeComposer();
  }
});
// The composer can lose focus (a click back into the document) while staying
// open; these two paths make it dismissable from anywhere.
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !composer.hidden) {
    event.preventDefault();
    closeComposer();
  }
});
document.addEventListener('pointerdown', (event) => {
  if (!composer.hidden && !composer.contains(event.target as Node)) {
    closeComposer(false);
  }
});

modeToggle.addEventListener('click', () => {
  setMode(modeToggle.firstElementChild?.textContent === 'Aa');
});

aiReview.addEventListener('click', () => {
  report.hidden = true;
  updateTrackedActions();
  reviewPrompt.value = AI_REVIEW_PREAMBLE + editor.text;
  reviewDialog.showModal();
});
reviewClose.addEventListener('click', () => reviewDialog.close());
reviewDialog.addEventListener('click', (event) => {
  if (event.target === reviewDialog) reviewDialog.close();
});
copyReview.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(reviewPrompt.value);
    showNotice('Annotated document and instructions copied.');
  } catch {
    showNotice('Clipboard access was unavailable. Select and copy the document manually.');
  }
});
demoResponse.addEventListener('click', () => {
  const batch = createDemoBatch(editor.text);
  if (!batch) {
    showNotice('Add at least one span comment before running the sample response.');
    return;
  }
  patchInput.value = JSON.stringify(batch, null, 2);
  applyPatchResponse(patchInput.value);
});
applyPatch.addEventListener('click', () => applyPatchResponse(patchInput.value));
acceptAll.addEventListener('click', () => {
  const result = resolveEditMarks(editor.text, { action: 'accept' });
  if (result.resolved > 0) {
    editor.applyText(result.text);
    showNotice(`${result.resolved} proposed change(s) accepted.`);
  }
});
rejectAll.addEventListener('click', () => {
  const result = resolveEditMarks(editor.text, { action: 'reject' });
  if (result.resolved > 0) {
    editor.applyText(result.text);
    showNotice(`${result.resolved} proposed change(s) rejected.`);
  }
});
downloadFinal.addEventListener('click', () => {
  const finalName = localDocument.name.replace(/(?:\.md|\.markdown)?$/i, '.final.md');
  downloadMarkdown({ ...localDocument, name: finalName }, exportFinalText(editor.text).text);
  showNotice(`Download started for ${finalName} without comments or edit marks.`);
});

panelToggle.addEventListener('click', () => {
  const collapsed = panel.dataset.collapsed !== 'true';
  panel.dataset.collapsed = String(collapsed);
  workspace.classList.toggle('panel-collapsed', collapsed);
  panelToggle.setAttribute('aria-expanded', String(!collapsed));
  panelToggle.setAttribute('aria-label', `${collapsed ? 'Expand' : 'Collapse'} comments panel`);
  panelToggle.dataset.tooltip = `${collapsed ? 'Expand' : 'Collapse'} comments`;
  panelToggle.title = panelToggle.dataset.tooltip;
  panelToggle.textContent = collapsed ? '‹' : '›';
});

openFile.addEventListener('click', () => void openLocalDocument());
fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  fileInput.value = '';
  const openSnapshot = pendingFileInputOpen;
  pendingFileInputOpen = null;
  if (!file) return;
  try {
    const next = await readMarkdownFile(file);
    if (
      openSnapshot &&
      (editor.currentRevision !== openSnapshot.revision ||
        documentGeneration !== openSnapshot.generation) &&
      !(await confirmDocumentReplacement())
    ) {
      return;
    }
    loadDocument(next, null, null);
  } catch (error) {
    loadingDocument = false;
    showNotice(`Could not open that file: ${error instanceof Error ? error.message : error}`);
  }
});

saveSource.addEventListener('click', () => void saveToSource());

download.addEventListener('click', () => {
  // A browser cannot report whether the user cancels the save dialog, so the
  // recovery draft keeps its pre-download baseline and stays restorable even
  // though the visible state optimistically reads as exported.
  const priorExportedText = exportedText;
  downloadMarkdown(localDocument, editor.text);
  exportedText = editor.text;
  hasExported = true;
  lastEvent = 'download-started';
  updateSaveState();
  void saveRecoveryDraft(localDocument, editor.text, priorExportedText, editor.text).catch(
    () => {},
  );
  showNotice(`Download started for ${localDocument.name}.`);
});

window.addEventListener('beforeunload', (event) => {
  if (!isDirty()) return;
  event.preventDefault();
  event.returnValue = '';
});

window.addEventListener('pagehide', () => {
  // Best-effort flush of a pending debounced draft write; the last keystrokes
  // before a confirmed close should reach the recovery record when possible.
  if (recoveryTimer === undefined) return;
  window.clearTimeout(recoveryTimer);
  recoveryTimer = undefined;
  void saveRecoveryDraft(localDocument, editor.text, exportedText).catch(() => {});
});

fileName.textContent = SAMPLE_NAME;
renderPanel(SAMPLE_DOCUMENT);
updateSaveState();
void restoreRecovery();
