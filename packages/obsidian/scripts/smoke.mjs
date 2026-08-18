/**
 * Headless smoke test: load the built bundle with a stubbed `obsidian`
 * module (Obsidian's loader wraps main.js as CJS the same way) and exercise
 * every registered command surface that can run without a real editor.
 */
import { createRequire } from 'node:module';
import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Module = require('module');

const notices = [];
class Plugin {
  constructor(app, manifest) {
    this.app = app;
    this.manifest = manifest;
    this.commands = [];
  }
  addCommand(c) {
    this.commands.push(c);
    return c;
  }
  registerView() {}
  registerEditorExtension() {}
  registerMarkdownPostProcessor() {}
  registerEvent() {}
  addRibbonIcon() {}
}
class Notice {
  constructor(msg) {
    notices.push(String(msg));
  }
}
const stub = {
  Plugin,
  Notice,
  MarkdownView: class MarkdownView {},
  ItemView: class ItemView {
    constructor(leaf) {
      this.leaf = leaf;
    }
  },
  Modal: class Modal {
    constructor(app) {
      this.app = app;
      this.contentEl = null;
    }
    open() {}
    close() {}
  },
  Setting: class Setting {
    setName() {
      return this;
    }
    addDropdown() {
      return this;
    }
    addButton() {
      return this;
    }
  },
  Editor: class Editor {},
  setIcon: () => {},
};

/** Line/ch ↔ offset math matching CodeMirror's model. */
class FakeEditor {
  constructor(text) {
    this.text = text;
    this.selFrom = 0;
    this.selTo = 0;
    this.cursorOffset = 0;
  }
  getValue() {
    return this.text;
  }
  setValue(t) {
    this.text = t;
  }
  posToOffset(p) {
    const lines = this.text.split('\n');
    let o = 0;
    for (let i = 0; i < p.line; i++) o += lines[i].length + 1;
    return o + p.ch;
  }
  offsetToPos(o) {
    const before = this.text.slice(0, o).split('\n');
    return { line: before.length - 1, ch: before[before.length - 1].length };
  }
  getCursor(which) {
    return this.offsetToPos(which === 'from' ? this.selFrom : this.selTo);
  }
  setCursor(p) {
    this.cursorOffset = this.posToOffset(p);
  }
}

const cmViewStub = {
  Decoration: {
    mark: (spec) => ({ spec }),
    replace: (spec) => ({ spec }),
    none: [],
  },
  WidgetType: class WidgetType {},
  ViewPlugin: { fromClass: (cls, opts) => ({ cls, opts }) },
  EditorView: class EditorView {},
};
const cmStateStub = {
  RangeSetBuilder: class RangeSetBuilder {
    add() {}
    finish() {
      return [];
    }
  },
};

const origLoad = Module._load;
Module._load = (req, ...rest) => {
  if (req === 'obsidian') return stub;
  if (req === '@codemirror/view') return cmViewStub;
  if (req === '@codemirror/state') return cmStateStub;
  return origLoad(req, ...rest);
};

// package.json is type:module, so require() the bundle via a .cjs copy.
const pkgRoot = fileURLToPath(new URL('..', import.meta.url));
const tmp = mkdtempSync(path.join(tmpdir(), 'galley-smoke-'));
const bundle = path.join(tmp, 'main.cjs');
copyFileSync(path.join(pkgRoot, 'dist', 'main.js'), bundle);

const mod = require(bundle);
const PluginClass = mod.default ?? mod;
assert.equal(typeof PluginClass, 'function', 'bundle exports a plugin class');

const fakeApp = {
  workspace: {
    on: () => ({}),
    getActiveViewOfType: () => null,
    getLeavesOfType: () => [],
    getRightLeaf: () => null,
    revealLeaf: () => {},
    updateOptions: () => {},
  },
};
const plugin = new PluginClass(fakeApp, { id: 'galley' });
plugin.onload();
assert.ok(plugin.commands.length >= 1, 'commands registered');

const command = (id) => {
  const c = plugin.commands.find((x) => x.id === id);
  assert.ok(c, `command ${id} registered`);
  return c;
};

// validate-annotations against a valid and a malformed document
const runValidate = (text) => {
  notices.length = 0;
  command('validate-annotations').editorCallback({ getValue: () => text });
  return notices[0] ?? '';
};
assert.match(runValidate('Fine {==here==}{>>[v1a] ok<<}.\n'), /no annotation issues/);
assert.match(runValidate('bad {==no comment==} here\n'), /1 error/);

// --- annotate flow: computeTarget + insertComment through the plugin ---
const { computeTarget, insertComment } = mod;

// span from a plain selection
{
  const ed = new FakeEditor('The quick brown fox jumps.\n');
  const t = computeTarget(ed.text, 4, 15); // 'quick brown'
  assert.equal(t.kind, 'span');
  const r = insertComment(ed, t.at, 'too fast?');
  assert.ok(r.ok);
  assert.match(ed.text, /\{==quick brown==\}\{>>\[[a-z2-9]{3,8}\] too fast\?<<\}/);
  // cursor sits at the end of the inserted syntax
  assert.equal(ed.text.slice(0, ed.cursorOffset).endsWith('<<}'), true);
}

// selection endpoints inside existing syntax snap inward to prose
{
  const doc = 'Alpha {==bravo==}{>>[x1x] hm<<} charlie delta.\n';
  const t = computeTarget(doc, doc.indexOf('{>>') + 2, doc.indexOf('delta') + 5);
  assert.equal(t.kind, 'span');
  const ed = new FakeEditor(doc);
  const r = insertComment(ed, t.at, 'second note');
  assert.ok(r.ok, r.ok ? '' : r.error);
  assert.match(ed.text, /\{== charlie delta==\}/);
}

// collapsed cursor: point and paragraph variants
{
  const doc = 'First para line.\n\nSecond para here.\n';
  const t = computeTarget(doc, doc.indexOf('here.') + 5, doc.indexOf('here.') + 5);
  assert.equal(t.kind, 'collapsed');
  assert.equal(t.pointValid, true);
  assert.equal(t.blockSnippet, 'Second para here.');
  // cursor on the blank line between paragraphs: point impossible, block
  // targets the paragraph ABOVE
  const between = computeTarget(doc, doc.indexOf('\n\n') + 1, doc.indexOf('\n\n') + 1);
  assert.equal(between.kind, 'collapsed');
  assert.equal(between.pointValid, false);
  assert.equal(between.blockSnippet, 'First para line.');
  const ed1 = new FakeEditor(doc);
  assert.ok(insertComment(ed1, t.point, 'beat').ok);
  assert.match(ed1.text, /here\.\{>>\[[a-z2-9]+\] beat<<\}/);
  const ed2 = new FakeEditor(doc);
  assert.ok(insertComment(ed2, t.block, 'expand').ok);
  assert.match(ed2.text, /Second para here\.\n\n\{>>\[[a-z2-9]+\] expand<<\}\n/);
}

// document note through the plugin's shared commit path — success is
// silent (the document change is the feedback), failures toast
{
  const ed = new FakeEditor('Body text.\n');
  notices.length = 0;
  plugin.commit(ed, 'document', 'overall: shorten');
  assert.equal(notices.length, 0);
  assert.match(ed.text, /^\{>>\[[a-z2-9]+\] overall: shorten<<\}\n\nBody text\.\n$/);
}

// core guards surface as error notices, document untouched
{
  const ed = new FakeEditor('Body text.\n');
  notices.length = 0;
  plugin.commit(ed, { offset: 4 }, 'bad <<} body');
  assert.match(notices[0], /closing delimiter/);
  assert.equal(ed.text, 'Body text.\n');
}

// --- decoration plan ---
const { planDecorations, splitReadingSegments } = mod;
{
  const doc =
    'The {==bold==}{>>[a1b] why<<} claim.{>>[p2c] beat<<}\n\nPara.\n\n{>>[b3d] expand<<}\n\nCut {--this --}word.\n';
  const plan = planDecorations(doc, [{ from: 0, to: 0 }]);
  const kinds = plan.map((p) => p.kind);
  assert.deepEqual(kinds, ['hide', 'anchor', 'chip', 'chip', 'note', 'edit']);
  const anchor = plan.find((p) => p.kind === 'anchor');
  assert.equal(doc.slice(anchor.from, anchor.to), 'bold');
  const note = plan.find((p) => p.kind === 'note');
  assert.equal(note.body, 'expand');
  // touching an annotation with the selection reveals it (drops its decos)
  const touchedPlan = planDecorations(doc, [{ from: doc.indexOf('[a1b]'), to: doc.indexOf('[a1b]') }]);
  assert.equal(touchedPlan.filter((p) => p.kind === 'hide').length, 0);
  assert.ok(touchedPlan.some((p) => p.kind === 'chip')); // p2c still rendered
}

// --- reading-mode segmentation ---
{
  const segs = splitReadingSegments(
    'A {==big==}{>>[q1w] why big?<<} idea{>>[z2x] hm<<} and {--old --}{++new ++}text {~~was~>is~~} here.',
  );
  const kinds = segs.map((s) => s.kind);
  assert.deepEqual(kinds, [
    'text', 'anchor', 'text', 'comment', 'text', 'deletion', 'insertion',
    'text', 'substitution', 'text',
  ]);
  const anchor = segs.find((s) => s.kind === 'anchor');
  assert.equal(anchor.text, 'big');
  assert.equal(anchor.id, 'q1w');
  assert.equal(anchor.body, 'why big?');
  assert.equal(splitReadingSegments('no marks here'), null);
}

// --- panel model ---
const { buildPanelModel } = mod;
{
  const doc =
    '{>>[d1a] overall tighten<<}\n\nThe {==first==}{>>[s2b] really?<<} claim.{>>[p3c] beat<<}\n\nPara two here.\n\n{>>[b4d] expand this<<}\n';
  const { items, errorCount } = buildPanelModel(doc);
  assert.equal(errorCount, 0);
  assert.deepEqual(
    items.map((i) => [i.id, i.scope]),
    [
      ['d1a', 'document'],
      ['s2b', 'span'],
      ['p3c', 'point'],
      ['b4d', 'block'],
    ],
  );
  const span = items.find((i) => i.id === 's2b');
  assert.equal(span.snippet, 'first');
  assert.ok(span.jump && doc.slice(span.jump.from, span.jump.to) === 'first');
  const block = items.find((i) => i.id === 'b4d');
  assert.equal(block.snippet, 'Para two here.');
  const point = items.find((i) => i.id === 'p3c');
  assert.ok(point.jump && point.jump.from === point.jump.to);
  // point jump lands in prose, not inside annotation syntax
  assert.ok(doc.slice(point.jump.from - 1, point.jump.from).match(/[a-z.]/i));
}

// --- patch batch flow ---
{
  const doc = 'The {==old phrasing==}{>>[w1x] modernize<<} stays. Nothing else.{>>[y2z] ok as is?<<}\n';
  const batch = {
    spec: 1,
    responses: [
      { comment: 'w1x', status: 'patched' },
      { comment: 'y2z', status: 'no-change-needed' },
    ],
    patches: [
      { type: 'span', find: 'old phrasing', replace: 'fresh wording', comments: ['w1x'] },
    ],
  };
  // fenced clipboard content with surrounding prose
  const clip = 'Here you go!\n```json\n' + JSON.stringify(batch, null, 2) + '\n```\nDone.';
  const ed = new FakeEditor(doc);
  notices.length = 0;
  plugin.applyBatchFromText(ed, clip);
  // tracked changes: proposal lands as an edit mark, prose untouched
  assert.match(ed.text, /\{~~old phrasing~>fresh wording~~\}/);
  assert.doesNotMatch(ed.text, /w1x/); // resolved, left the document
  assert.match(ed.text, /\{>>\[y2z\] ok as is\?<<\}/); // untouched
  assert.match(notices[0], /1 patch\(es\) applied, 0 rejected, 1 comment\(s\) resolved/);
  // accept-all lands the proposal
  command('accept-all-changes').editorCallback(ed);
  assert.match(ed.text, /The fresh wording stays\./);
  assert.doesNotMatch(ed.text, /~~/);
  // reject path: re-apply tracked, then reject-all restores the prose
  const ed3 = new FakeEditor(doc);
  plugin.applyBatchFromText(ed3, clip);
  command('reject-all-changes').editorCallback(ed3);
  assert.match(ed3.text, /The old phrasing stays\./);

  // malformed clipboard rejected without touching the document
  const ed2 = new FakeEditor(doc);
  notices.length = 0;
  plugin.applyBatchFromText(ed2, 'not json at all');
  assert.equal(ed2.text, doc);
  assert.match(notices[0], /no JSON object/);
}

console.log(
  `smoke ✓ plugin loads, ${plugin.commands.length} command(s):`,
  plugin.commands.map((c) => c.id).join(', '),
);
console.log('smoke ✓ annotate flow: span, snap, point, block, document, guard');
console.log('smoke ✓ decorations plan + reading-mode segmentation');
console.log('smoke ✓ panel model: scopes, snippets, jump targets');
console.log('smoke ✓ patch batch: fenced JSON applied, garbage rejected');
