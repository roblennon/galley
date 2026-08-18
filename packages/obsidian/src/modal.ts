import { App, Modal, Setting } from 'obsidian';

export interface CommentPromptOptions {
  title: string;
  /** Muted context line under the title (e.g. the target paragraph). */
  hint?: string;
  /** Offered only for collapsed-cursor comments. */
  scopeChoice?: { point: string; block: string };
  /** Default scope when a chooser is shown. */
  defaultScope?: 'point' | 'block';
  onSubmit(body: string, scope: 'point' | 'block'): void;
}

/** Minimal comment composer: textarea, optional scope choice, Enter to
 * confirm, Shift+Enter for a newline, Esc to cancel. */
export class CommentModal extends Modal {
  private body = '';
  private scopeValue: 'point' | 'block' = 'point';
  private readonly options: CommentPromptOptions;

  constructor(app: App, options: CommentPromptOptions) {
    super(app);
    this.options = options;
  }

  override onOpen(): void {
    const { contentEl } = this;
    if (this.options.defaultScope) this.scopeValue = this.options.defaultScope;
    contentEl.createEl('h3', { text: this.options.title });
    if (this.options.hint) {
      contentEl.createEl('p', {
        text: this.options.hint,
        cls: 'galley-modal-hint',
      });
    }

    if (this.options.scopeChoice) {
      new Setting(contentEl)
        .setName('Attach to')
        .addDropdown((dd) => {
          dd.addOption('point', this.options.scopeChoice!.point);
          dd.addOption('block', this.options.scopeChoice!.block);
          dd.setValue(this.scopeValue);
          dd.onChange((v) => {
            this.scopeValue = v === 'block' ? 'block' : 'point';
          });
        });
    }

    const input = contentEl.createEl('textarea', {
      cls: 'galley-comment-input',
      attr: { rows: '4', placeholder: 'Comment… (Enter to confirm)' },
    });
    input.addEventListener('input', () => {
      this.body = input.value;
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.submit();
      }
    });

    new Setting(contentEl)
      .addButton((b) =>
        b
          .setButtonText('Comment')
          .setCta()
          .onClick(() => this.submit()),
      )
      .addButton((b) => b.setButtonText('Cancel').onClick(() => this.close()));

    queueMicrotask(() => input.focus());
  }

  private submit(): void {
    const body = this.body.trim();
    if (body === '') return;
    this.close();
    this.options.onSubmit(body, this.scopeValue);
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
