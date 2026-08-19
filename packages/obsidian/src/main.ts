import { Editor, MarkdownView, Notice, Plugin } from 'obsidian';
import { validate } from '@galleymd/core';
import { computeTarget, insertComment, type EditorLike } from './annotate.js';
import { CommentModal } from './modal.js';
import { galleyEditorExtension, planDecorations } from './decorations.js';
import { processReadingElement, splitReadingSegments } from './reading.js';
import {
  buildPanelModel,
  CommentsPanelView,
  PANEL_VIEW_TYPE,
} from './panel.js';
import {
  AI_REVIEW_PREAMBLE,
  extractBatchJson,
  summarizeReport,
} from './batch.js';
import { applyBatch, exportFinalText, parse, resolveEditMarks } from '@galleymd/core';
import { ReportModal } from './report.js';

export default class GalleyPlugin extends Plugin {
  /** Live Preview annotation rendering; toggled by command. */
  renderAnnotations = true;

  /** Last markdown view seen; the panel reads it when the panel itself is
   * the active leaf (clicking the panel would otherwise blank it). */
  lastMarkdownView: MarkdownView | null = null;

  onload(): void {
    this.registerEditorExtension(
      galleyEditorExtension(() => this.renderAnnotations),
    );
    this.registerMarkdownPostProcessor((el) => processReadingElement(el));

    this.registerView(
      PANEL_VIEW_TYPE,
      (leaf) => new CommentsPanelView(leaf, this),
    );
    this.addRibbonIcon('message-square-text', 'Galley comments', () => {
      void this.openPanel();
    });
    this.addCommand({
      id: 'open-comments-panel',
      name: 'Open comments panel',
      callback: () => void this.openPanel(),
    });
    this.registerEvent(
      this.app.workspace.on('editor-change', () => this.refreshPanel()),
    );
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', () => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (view) this.lastMarkdownView = view;
        this.refreshPanel();
      }),
    );

    this.addCommand({
      id: 'toggle-annotation-rendering',
      name: 'Toggle annotation markup rendering',
      callback: () => {
        this.renderAnnotations = !this.renderAnnotations;
        this.app.workspace.updateOptions();
        new Notice(
          `Galley: annotations ${this.renderAnnotations ? 'rendered' : 'shown as raw markup'}.`,
        );
      },
    });

    this.addCommand({
      id: 'add-comment',
      name: 'Add comment (selection or cursor)',
      editorCallback: (editor: Editor) => this.addCommentFlow(editor),
    });

    // Right-click path: hotkeys collide with OS-level services on some
    // machines (macOS binds Cmd+Alt+M to "Open man Page in Terminal").
    this.registerEvent(
      this.app.workspace.on('editor-menu', (menu, editor) => {
        menu.addItem((item) =>
          item
            .setTitle('Add comment')
            .setIcon('message-square-plus')
            .setSection('selection')
            .onClick(() => this.addCommentFlow(editor)),
        );
        // Cursor inside a proposed change: offer accept/reject for it.
        const offset = editor.posToOffset(editor.getCursor('from'));
        const markIndex = parse(editor.getValue()).editMarks.findIndex(
          (m) =>
            m.source && offset >= m.source.start && offset <= m.source.end,
        );
        if (markIndex >= 0) {
          menu.addItem((item) =>
            item
              .setTitle('Accept this change')
              .setIcon('check')
              .setSection('selection')
              .onClick(() => this.resolveMarks(editor, 'accept', markIndex)),
          );
          menu.addItem((item) =>
            item
              .setTitle('Reject this change')
              .setIcon('x')
              .setSection('selection')
              .onClick(() => this.resolveMarks(editor, 'reject', markIndex)),
          );
        }
      }),
    );

    this.addCommand({
      id: 'add-document-note',
      name: 'Add document-level note',
      editorCallback: (editor: Editor) => this.openDocumentNoteModal(editor),
    });

    this.addCommand({
      id: 'copy-for-ai-review',
      name: 'Copy document for AI review',
      editorCallback: (editor: Editor) => {
        void navigator.clipboard
          .writeText(AI_REVIEW_PREAMBLE + editor.getValue())
          .then(() =>
            new Notice('Galley: document + instructions copied. Paste to your AI editor.'),
          );
      },
    });

    this.addCommand({
      id: 'apply-patch-batch',
      name: 'Apply patch batch from clipboard',
      editorCallback: (editor: Editor) => {
        void navigator.clipboard.readText().then((clip) => {
          this.applyBatchFromText(editor, clip);
        });
      },
    });

    this.addCommand({
      id: 'accept-all-changes',
      name: 'Accept all proposed changes',
      editorCallback: (editor: Editor) => this.resolveMarks(editor, 'accept'),
    });
    this.addCommand({
      id: 'reject-all-changes',
      name: 'Reject all proposed changes',
      editorCallback: (editor: Editor) => this.resolveMarks(editor, 'reject'),
    });
    this.addCommand({
      id: 'export-final-version',
      name: 'Export final version (accept edits, strip annotations)',
      editorCallback: (editor: Editor, view) => {
        const folder = view?.file?.parent?.path;
        const base = view?.file?.basename ?? 'untitled';
        void this.exportFinal(
          editor,
          folder && folder !== '/' ? `${folder}/${base}` : base,
        );
      },
    });

    this.addCommand({
      id: 'validate-annotations',
      name: 'Validate annotations in current note',
      editorCallback: (editor: Editor) => {
        const { valid, issues } = validate(editor.getValue());
        if (valid && issues.length === 0) {
          new Notice('Galley: no annotation issues.');
        } else {
          const errors = issues.filter((i) => i.severity === 'error');
          new Notice(
            `Galley: ${errors.length} error(s), ${
              issues.length - errors.length
            } warning(s) — ${issues
              .slice(0, 3)
              .map((i) => i.code)
              .join(', ')}`,
            8000,
          );
        }
      },
    });

    console.log('galley: plugin loaded');
  }

  private addCommentFlow(editor: Editor): void {
    const text = editor.getValue();
    if (text.includes('\r')) {
      new Notice('Galley: this file has CR line endings; not supported.');
      return;
    }
    const from = editor.posToOffset(editor.getCursor('from'));
    const to = editor.posToOffset(editor.getCursor('to'));
    const target = computeTarget(text, from, to);
    if (target.kind === 'span') {
      new CommentModal(this.app, {
        title: 'Comment on selection',
        onSubmit: (body) => this.commit(editor, target.at, body),
      }).open();
    } else if (!target.pointValid) {
      // Cursor is between paragraphs: only a paragraph comment makes sense.
      new CommentModal(this.app, {
        title: 'Comment on paragraph',
        hint: `Attaches to: “${target.blockSnippet}”`,
        onSubmit: (body) => this.commit(editor, target.block, body),
      }).open();
    } else {
      new CommentModal(this.app, {
        title: 'Add comment',
        hint: `Paragraph: “${target.blockSnippet}”`,
        scopeChoice: {
          point: 'This exact spot',
          block: 'This paragraph',
        },
        onSubmit: (body, scope) =>
          this.commit(editor, scope === 'block' ? target.block : target.point, body),
      }).open();
    }
  }

  /** Shared insert path; public so the headless smoke harness can drive it. */
  commit(
    editor: EditorLike,
    at: Parameters<typeof insertComment>[1] | 'document',
    body: string,
  ): void {
    // Success is visible in the document itself; only failures toast.
    const result = insertComment(editor, at === 'document' ? 'document' : at, body);
    if (!result.ok) {
      new Notice(`Galley: ${result.error}`, 8000);
    }
  }

  /** Apply a clipboard patch batch; public seam for the smoke harness. */
  applyBatchFromText(editor: EditorLike, clip: string): void {
    const extracted = extractBatchJson(clip);
    if (!extracted.ok) {
      new Notice(`Galley: ${extracted.error}`, 8000);
      return;
    }
    // Tracked changes: proposals land as inline edit marks for human review.
    const { text, report } = applyBatch(editor.getValue(), extracted.batch, {
      asEditMarks: true,
    });
    if (report.applied.length > 0) editor.setValue(text);
    const summary = summarizeReport(report);
    new Notice(`Galley: ${summary.headline}`);
    if (summary.sections.length > 0) {
      new ReportModal(this.app, summary).open();
    }
  }

  resolveMarks(
    editor: EditorLike,
    action: 'accept' | 'reject',
    only?: number,
  ): void {
    const result = resolveEditMarks(editor.getValue(), {
      action,
      ...(only !== undefined ? { only } : {}),
    });
    if (result.resolved === 0) {
      new Notice('Galley: no proposed changes in this note.');
      return;
    }
    editor.setValue(result.text);
  }

  async exportFinal(editor: EditorLike, basename: string): Promise<void> {
    const final = exportFinalText(editor.getValue());
    let path = `${basename} (final).md`;
    let n = 2;
    while (this.app.vault.getAbstractFileByPath(path)) {
      path = `${basename} (final ${n}).md`;
      n++;
    }
    const file = await this.app.vault.create(path, final.text);
    await this.app.workspace.getLeaf('tab').openFile(file);
  }

  openDocumentNoteModal(editor: EditorLike): void {
    new CommentModal(this.app, {
      title: 'Document note',
      onSubmit: (body) => this.commit(editor, 'document', body),
    }).open();
  }

  async openPanel(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(PANEL_VIEW_TYPE)[0];
    if (existing) {
      this.app.workspace.revealLeaf(existing);
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: PANEL_VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  onunload(): void {
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
  }

  private refreshTimer: number | null = null;
  refreshPanel(): void {
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      for (const leaf of this.app.workspace.getLeavesOfType(PANEL_VIEW_TYPE)) {
        const view = leaf.view;
        if (view instanceof CommentsPanelView) view.render();
      }
    }, 400);
  }

  protected activeMarkdownView(): MarkdownView | null {
    return this.app.workspace.getActiveViewOfType(MarkdownView);
  }
}

export {
  buildPanelModel,
  computeTarget,
  insertComment,
  planDecorations,
  splitReadingSegments,
};
