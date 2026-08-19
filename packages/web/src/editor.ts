import { markdown } from '@codemirror/lang-markdown';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import {
  EditorState,
  RangeSetBuilder,
  StateEffect,
  StateField,
  type Extension,
} from '@codemirror/state';
import {
  Decoration,
  EditorView,
  drawSelection,
  highlightSpecialChars,
  keymap,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { planDecorations, type DecoPlanItem } from '@galleymd/codemirror';
import { minimalTextChange } from './change.js';

export interface SelectionSnapshot {
  from: number;
  to: number;
  revision: number;
  coords: { left: number; bottom: number } | null;
}

export interface EditorCallbacks {
  onChange(text: string): void;
  onSelection(selection: SelectionSnapshot): void;
}

const setFocusedMode = StateEffect.define<boolean>();
const editorSetup = [
  highlightSpecialChars(),
  history(),
  drawSelection(),
  syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
  keymap.of([...defaultKeymap, ...historyKeymap]),
];
const focusedModeField = StateField.define<boolean>({
  create: () => true,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setFocusedMode)) value = effect.value;
    }
    return value;
  },
});

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
    const element = document.createElement('span');
    element.className = 'galley-chip';
    element.textContent = this.id ?? '•';
    if (this.body) {
      element.title = this.body;
      element.setAttribute('aria-label', `Comment ${this.id ?? ''}: ${this.body}`);
    }
    return element;
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
    return other.id === this.id && other.body === this.body && other.scope === this.scope;
  }

  override toDOM(): HTMLElement {
    const element = document.createElement('span');
    element.className = `galley-note galley-note-${this.scope}`;
    const chip = document.createElement('span');
    chip.className = 'galley-chip';
    chip.textContent = this.id ?? '•';
    element.append(chip, document.createTextNode(` ${this.body}`));
    return element;
  }
}

function toDecorations(plan: DecoPlanItem[]): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const item of plan) {
    if (item.kind === 'hide') {
      builder.add(item.from, item.to, Decoration.replace({}));
    } else if (item.kind === 'anchor') {
      builder.add(item.from, item.to, Decoration.mark({ class: 'galley-anchor' }));
    } else if (item.kind === 'chip') {
      builder.add(
        item.from,
        item.to,
        Decoration.replace({ widget: new ChipWidget(item.id ?? null, item.body ?? '') }),
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

const galleyDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }

    update(update: ViewUpdate): void {
      if (update.docChanged || update.selectionSet || update.transactions.some((tr) =>
        tr.effects.some((effect) => effect.is(setFocusedMode)))) {
        this.decorations = this.build(update.view);
      }
    }

    private build(view: EditorView): DecorationSet {
      if (!view.state.field(focusedModeField)) return Decoration.none;
      const text = view.state.doc.toString();
      if (!text.includes('{')) return Decoration.none;
      try {
        return toDecorations(
          planDecorations(
            text,
            view.state.selection.ranges.map((range) => ({
              from: range.from,
              to: range.to,
            })),
          ),
        );
      } catch {
        return Decoration.none;
      }
    }
  },
  { decorations: (value) => value.decorations },
);

export class GalleyEditor {
  readonly view: EditorView;
  private revision = 0;
  private suppressNextSelection = false;
  private readonly extensions: Extension[];
  private readonly callbacks: EditorCallbacks;

  constructor(parent: HTMLElement, text: string, callbacks: EditorCallbacks) {
    this.callbacks = callbacks;
    this.extensions = [
      editorSetup,
      markdown(),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({
        'aria-label': 'Markdown document editor',
        spellcheck: 'true',
      }),
      focusedModeField,
      galleyDecorations,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          this.revision++;
          callbacks.onChange(update.state.doc.toString());
        }
        if (update.selectionSet && update.view.hasFocus) {
          if (this.suppressNextSelection) {
            this.suppressNextSelection = false;
            return;
          }
          const range = update.state.selection.main;
          if (!range.empty) {
            const coords = update.view.coordsAtPos(range.to);
            callbacks.onSelection({
              from: range.from,
              to: range.to,
              revision: this.revision,
              coords: coords ? { left: coords.left, bottom: coords.bottom } : null,
            });
          }
        }
      }),
    ];
    this.view = new EditorView({
      parent,
      state: EditorState.create({ doc: text, extensions: this.extensions }),
    });
  }

  get text(): string {
    return this.view.state.doc.toString();
  }

  get currentRevision(): number {
    return this.revision;
  }

  setText(text: string): void {
    this.view.setState(EditorState.create({ doc: text, extensions: this.extensions }));
    this.revision++;
    this.callbacks.onChange(text);
  }

  applyText(text: string, cursor?: number): boolean {
    const change = minimalTextChange(this.text, text);
    if (!change) return false;
    const anchor = cursor ?? change.from + change.insert.length;
    this.view.dispatch({
      changes: change,
      selection: { anchor: Math.min(anchor, text.length) },
      scrollIntoView: true,
      userEvent: 'input.galley',
    });
    return true;
  }

  setFocusedMode(enabled: boolean): void {
    this.view.dispatch({ effects: setFocusedMode.of(enabled) });
  }

  select(from: number, to: number): void {
    this.view.focus();
    this.suppressNextSelection = true;
    this.view.dispatch({
      selection: { anchor: from, head: to },
      scrollIntoView: true,
    });
  }

  focus(): void {
    this.view.focus();
  }

  destroy(): void {
    this.view.destroy();
  }
}
