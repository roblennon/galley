import { RangeSetBuilder } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { planDecorations, type DecoPlanItem } from '@galley/codemirror';
export { planDecorations } from '@galley/codemirror';
export type { DecoPlanItem } from '@galley/codemirror';

class ChipWidget extends WidgetType {
  constructor(
    private readonly id: string | null,
    private readonly body: string,
  ) {
    super();
  }
  override eq(other: ChipWidget): boolean {
    return other.id === this.id && other.body === this.body;
  }
  override toDOM(): HTMLElement {
    const el = document.createElement('span');
    el.className = 'galley-chip';
    el.textContent = this.id ?? '•';
    if (this.body) el.setAttribute('aria-label', this.body);
    if (this.body) el.setAttribute('title', this.body);
    return el;
  }
}

class NoteWidget extends WidgetType {
  constructor(
    private readonly id: string | null,
    private readonly body: string,
    private readonly scope: string,
  ) {
    super();
  }
  override eq(other: NoteWidget): boolean {
    return (
      other.id === this.id && other.body === this.body && other.scope === this.scope
    );
  }
  override toDOM(): HTMLElement {
    const el = document.createElement('span');
    el.className = `galley-note galley-note-${this.scope}`;
    const chip = document.createElement('span');
    chip.className = 'galley-chip';
    chip.textContent = this.id ?? '•';
    el.appendChild(chip);
    el.appendChild(document.createTextNode(' ' + this.body));
    return el;
  }
}

function toDecorations(plan: DecoPlanItem[]): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const item of plan) {
    if (item.kind === 'hide') {
      builder.add(item.from, item.to, Decoration.replace({}));
    } else if (item.kind === 'anchor') {
      builder.add(
        item.from,
        item.to,
        Decoration.mark({ class: 'galley-anchor' }),
      );
    } else if (item.kind === 'chip') {
      builder.add(
        item.from,
        item.to,
        Decoration.replace({
          widget: new ChipWidget(item.id ?? null, item.body ?? ''),
        }),
      );
    } else if (item.kind === 'note') {
      builder.add(
        item.from,
        item.to,
        Decoration.replace({
          widget: new NoteWidget(
            item.id ?? null,
            item.body ?? '',
            item.scope ?? 'block',
          ),
        }),
      );
    } else {
      builder.add(
        item.from,
        item.to,
        Decoration.mark({ class: 'galley-edit-mark' }),
      );
    }
  }
  return builder.finish();
}

/** Live Preview extension; `isEnabled` is read on every rebuild so the
 * toggle command only needs to trigger a reconfigure. */
export function galleyEditorExtension(isEnabled: () => boolean) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      lastEnabled: boolean;
      constructor(view: EditorView) {
        this.lastEnabled = isEnabled();
        this.decorations = this.build(view);
      }
      update(update: ViewUpdate): void {
        const enabled = isEnabled();
        if (
          update.docChanged ||
          update.selectionSet ||
          enabled !== this.lastEnabled
        ) {
          this.lastEnabled = enabled;
          this.decorations = this.build(update.view);
        }
      }
      build(view: EditorView): DecorationSet {
        if (!isEnabled()) return Decoration.none;
        const text = view.state.doc.toString();
        if (!text.includes('{')) return Decoration.none;
        const selections = view.state.selection.ranges.map((r) => ({
          from: r.from,
          to: r.to,
        }));
        try {
          return toDecorations(planDecorations(text, selections));
        } catch {
          return Decoration.none;
        }
      }
    },
    { decorations: (v) => v.decorations },
  );
}
