/** Reading-mode transform: convert annotation syntax inside rendered text
 * nodes into styled elements. Pure segmentation is separated from DOM
 * assembly so the smoke harness can test it. Marks split across element
 * boundaries (e.g. emphasis inside an anchor) are left as-is in v1. */

export type ReadingSegment =
  | { kind: 'text'; text: string }
  | { kind: 'anchor'; text: string; id: string | null; body: string }
  | { kind: 'comment'; id: string | null; body: string }
  | { kind: 'deletion'; text: string }
  | { kind: 'insertion'; text: string }
  | { kind: 'substitution'; from: string; to: string };

import { splitCommentContent } from '@galleymd/core';

const PATTERN =
  /\{==([\s\S]*?)==\}\{>>([\s\S]*?)<<\}|\{>>([\s\S]*?)<<\}|\{--([\s\S]*?)--\}|\{\+\+([\s\S]*?)\+\+\}|\{~~([\s\S]*?)~>([\s\S]*?)~~\}/g;

export function splitReadingSegments(text: string): ReadingSegment[] | null {
  if (!/\{==|\{>>|\{--|\{\+\+|\{~~/.test(text)) return null;
  const out: ReadingSegment[] = [];
  let last = 0;
  PATTERN.lastIndex = 0;
  for (let m = PATTERN.exec(text); m !== null; m = PATTERN.exec(text)) {
    if (m.index > last) out.push({ kind: 'text', text: text.slice(last, m.index) });
    if (m[1] !== undefined) {
      const { id, body } = splitCommentContent(m[2]!);
      out.push({ kind: 'anchor', text: m[1], id, body });
    } else if (m[3] !== undefined) {
      const { id, body } = splitCommentContent(m[3]);
      out.push({ kind: 'comment', id, body });
    } else if (m[4] !== undefined) {
      out.push({ kind: 'deletion', text: m[4] });
    } else if (m[5] !== undefined) {
      out.push({ kind: 'insertion', text: m[5] });
    } else {
      out.push({ kind: 'substitution', from: m[6]!, to: m[7]! });
    }
    last = m.index + m[0].length;
  }
  if (out.length === 0) return null;
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}

function chip(doc: Document, id: string | null, body: string): HTMLElement {
  const el = doc.createElement('span');
  el.className = 'galley-chip';
  el.textContent = id ?? '•';
  if (body) {
    el.setAttribute('title', body);
    el.setAttribute('aria-label', body);
  }
  return el;
}

export function processReadingElement(root: HTMLElement): void {
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const targets: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (/\{==|\{>>|\{--|\{\+\+|\{~~/.test(n.nodeValue ?? '')) {
      targets.push(n as Text);
    }
  }
  for (const node of targets) {
    const segments = splitReadingSegments(node.nodeValue ?? '');
    if (!segments) continue;
    const frag = doc.createDocumentFragment();
    for (const seg of segments) {
      if (seg.kind === 'text') {
        frag.appendChild(doc.createTextNode(seg.text));
      } else if (seg.kind === 'anchor') {
        const mark = doc.createElement('mark');
        mark.className = 'galley-anchor';
        mark.textContent = seg.text;
        frag.appendChild(mark);
        frag.appendChild(chip(doc, seg.id, seg.body));
      } else if (seg.kind === 'comment') {
        const note = doc.createElement('span');
        note.className = 'galley-note';
        note.appendChild(chip(doc, seg.id, ''));
        note.appendChild(doc.createTextNode(' ' + seg.body));
        frag.appendChild(note);
      } else if (seg.kind === 'deletion') {
        const del = doc.createElement('del');
        del.className = 'galley-deletion';
        del.textContent = seg.text;
        frag.appendChild(del);
      } else if (seg.kind === 'insertion') {
        const ins = doc.createElement('ins');
        ins.className = 'galley-insertion';
        ins.textContent = seg.text;
        frag.appendChild(ins);
      } else {
        const del = doc.createElement('del');
        del.className = 'galley-deletion';
        del.textContent = seg.from;
        const ins = doc.createElement('ins');
        ins.className = 'galley-insertion';
        ins.textContent = seg.to;
        frag.appendChild(del);
        frag.appendChild(ins);
      }
    }
    node.replaceWith(frag);
  }
}
