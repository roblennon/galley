import { App, Modal } from 'obsidian';
import type { ReportSummary } from './batch.js';

/** Post-apply report: what was applied, rejected, resolved, orphaned, or
 * left unanswered. Resolved bodies render here so nothing is silently lost
 * when a comment leaves the document. */
export class ReportModal extends Modal {
  private readonly summary: ReportSummary;

  constructor(app: App, summary: ReportSummary) {
    super(app);
    this.summary = summary;
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl('h3', { text: 'Patch batch report' });
    contentEl.createEl('p', { text: this.summary.headline });
    for (const section of this.summary.sections) {
      contentEl.createEl('h4', { text: section.title });
      const ul = contentEl.createEl('ul');
      for (const line of section.lines) {
        ul.createEl('li', { text: line });
      }
    }
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
