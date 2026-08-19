import { ItemView, MarkdownView, WorkspaceLeaf } from 'obsidian';
import { removeComment } from '@galleymd/core';
import { buildPanelModel } from '@galleymd/codemirror';
export { buildPanelModel } from '@galleymd/codemirror';
export type { PanelItem } from '@galleymd/codemirror';
import type GalleyPlugin from './main.js';

export const PANEL_VIEW_TYPE = 'galley-comments';

export class CommentsPanelView extends ItemView {
  private readonly plugin: GalleyPlugin;

  constructor(leaf: WorkspaceLeaf, plugin: GalleyPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  override getViewType(): string {
    return PANEL_VIEW_TYPE;
  }
  override getDisplayText(): string {
    return 'Galley comments';
  }
  override getIcon(): string {
    return 'message-square-text';
  }

  override async onOpen(): Promise<void> {
    this.render();
  }

  render(): void {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass('galley-panel');

    const mdView =
      this.plugin.app.workspace.getActiveViewOfType(MarkdownView) ??
      this.plugin.lastMarkdownView;
    if (!mdView || !mdView.file) {
      container.createEl('p', {
        text: 'Open a note to see its comments.',
        cls: 'galley-panel-empty',
      });
      return;
    }
    const editor = mdView.editor;
    const { items, errorCount } = buildPanelModel(editor.getValue());

    const header = container.createDiv({ cls: 'galley-panel-header' });
    header.createEl('h4', { text: `Comments (${items.length})` });
    const addDoc = header.createEl('button', { text: '+ doc note' });
    addDoc.addEventListener('click', () => {
      this.plugin.openDocumentNoteModal(editor);
    });

    if (errorCount > 0) {
      container.createEl('p', {
        text: `${errorCount} annotation syntax error(s) — run Validate for details.`,
        cls: 'galley-panel-errors',
      });
    }
    if (items.length === 0) {
      container.createEl('p', {
        text: 'No comments yet. Select text, right-click, and choose “Add comment”.',
        cls: 'galley-panel-empty',
      });
      return;
    }

    const list = container.createDiv({ cls: 'galley-panel-list' });
    for (const item of items) {
      const card = list.createDiv({ cls: 'galley-panel-item' });
      const meta = card.createDiv({ cls: 'galley-panel-meta' });
      const idBtn = meta.createEl('button', {
        cls: 'galley-panel-id',
        text: item.id ?? '•',
        attr: {
          title: item.jump
            ? `${item.scope} comment — click to jump to it`
            : `${item.scope} comment`,
        },
      });
      if (item.jump) {
        const jump = item.jump;
        idBtn.addEventListener('click', () => {
          editor.setSelection(
            editor.offsetToPos(jump.from),
            editor.offsetToPos(jump.to),
          );
          editor.scrollIntoView(
            { from: editor.offsetToPos(jump.from), to: editor.offsetToPos(jump.to) },
            true,
          );
        });
      }
      if (item.id !== null) {
        const id = item.id;
        const removeBtn = meta.createEl('button', {
          cls: 'galley-panel-remove',
          text: '✕',
          attr: { 'aria-label': 'Remove comment', title: 'Remove comment' },
        });
        removeBtn.addEventListener('click', () => {
          const result = removeComment(editor.getValue(), { id });
          if (result.removed) editor.setValue(result.text);
          this.render();
        });
      }
      card.createDiv({ cls: 'galley-panel-snippet', text: `“${item.snippet}”` });
      card.createDiv({ cls: 'galley-panel-body', text: item.body });
    }
  }
}
