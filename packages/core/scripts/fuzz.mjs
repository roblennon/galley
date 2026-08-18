/** Seeded property fuzzer for @galley/core (node scripts/fuzz.mjs [N]).
 * Found the zero-width and same-position recompose ordering bugs that the
 * example-based suite missed. Invariants:
 *  A. addComment-built docs: no error issues; byte-exact round trip;
 *     sourceMap tiles clean text with byte-identical segments; ids unique;
 *     removeComment removes exactly one comment and preserves clean text.
 *  B. applyBatch: id conservation (resolved ∪ surviving == original, disjoint);
 *     output round-trips; output has no error issues.
 *  C. ANY input string: parse never throws and recompose(parse(x)) === normalized x.
 */
import {
  addComment, applyBatch, cpLength, cpSlice, normalizeLineEndings,
  parse, recompose, removeComment,
} from '../dist/index.js';

const mulberry32 = (a) => () => {
  a |= 0; a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

let rnd = Math.random;
const ri = (n) => Math.floor(rnd() * n);
const pick = (arr) => arr[ri(arr.length)];

const WORDS = ['alpha', 'bravo', 'charlie', 'delta', 'écho', 'fox🦊trot', 'golf',
  'hotel', 'india', 'jülíet', 'kilo', '“lima”', 'mike—dash', 'nov{ember',
  'oscar}', 'papa.', 'qu?ebec', 'rome=o', 'sier~ra', 'tang+o'];
const BODIES = ['tighten this', 'why?', 'cite a source', 'cut or commit',
  'love it', 'expand — feels thin', 'check the math', 'restructure'];

function randomCleanDoc() {
  const blocks = [];
  const nBlocks = 1 + ri(5);
  for (let b = 0; b < nBlocks; b++) {
    const words = [];
    const n = 3 + ri(12);
    for (let w = 0; w < n; w++) words.push(pick(WORDS));
    let text = words.join(' ') + '.';
    if (ri(4) === 0) text = '## ' + text;
    blocks.push(text);
  }
  let doc = blocks.join('\n\n') + (ri(4) ? '\n' : '');
  if (ri(3) === 0) doc = '---\nannotation-spec: 1\n---\n\n' + doc;
  return doc;
}

function randomAnnotate(doc, ops) {
  for (let i = 0; i < ops; i++) {
    const parsed = parse(doc);
    const len = cpLength(parsed.cleanText);
    if (len < 2) break;
    const kind = ri(4);
    try {
      if (kind === 0) {
        const start = ri(len - 1);
        const end = start + 1 + ri(Math.min(30, len - start - 1));
        doc = addComment(doc, { body: pick(BODIES), at: { start, end } }).text;
      } else if (kind === 1) {
        doc = addComment(doc, { body: pick(BODIES), at: { offset: ri(len + 1) } }).text;
      } else if (kind === 2) {
        doc = addComment(doc, { body: pick(BODIES), at: { block: ri(len) } }).text;
      } else {
        doc = addComment(doc, { body: pick(BODIES), at: 'document' }).text;
      }
    } catch {
      /* guard rejections are fine */
    }
  }
  return doc;
}

function assertEq(a, b, msg, ctx) {
  if (a !== b) {
    throw new Error(`${msg}\n--- actual ---\n${JSON.stringify(a)}\n--- expected ---\n${JSON.stringify(b)}\n--- ctx ---\n${ctx}`);
  }
}

function checkParsedInvariants(doc, label) {
  const p = parse(doc);
  const errs = p.issues.filter((i) => i.severity === 'error');
  if (errs.length) throw new Error(`${label}: unexpected errors ${JSON.stringify(errs)}\ndoc=${JSON.stringify(doc)}`);
  assertEq(recompose(p).text, doc, `${label}: round trip failed`, JSON.stringify(doc));
  // sourceMap tiles clean text, byte-identical
  let covered = 0;
  for (const s of p.sourceMap) {
    assertEq(s.clean, covered, `${label}: sourceMap gap`, JSON.stringify(doc));
    assertEq(
      doc.slice(s.raw, s.raw + s.length),
      p.cleanText.slice(s.clean, s.clean + s.length),
      `${label}: segment mismatch`, JSON.stringify(doc));
    covered += s.length;
  }
  assertEq(covered, p.cleanText.length, `${label}: sourceMap incomplete`, JSON.stringify(doc));
  const ids = p.comments.filter((c) => c.id).map((c) => c.id);
  assertEq(new Set(ids).size, ids.length, `${label}: duplicate ids`, JSON.stringify(doc));
  return p;
}

function randomBatch(p) {
  const ids = p.comments.filter((c) => c.id !== null).map((c) => c.id);
  const statuses = ['patched', 'no-change-needed', 'needs-input', 'declined'];
  const responses = ids.map((id) => ({ comment: id, status: pick(statuses) }));
  const patches = [];
  const nPatches = ri(4);
  const clean = p.cleanText;
  const cleanLen = cpLength(clean);
  for (let i = 0; i < nPatches; i++) {
    if (ids.length > 0 && ri(3) === 0) {
      patches.push({ type: 'block', comment: pick(ids), replace: pick(WORDS) + ' rewritten.' });
    } else if (cleanLen > 10) {
      const start = ri(cleanLen - 5);
      const flen = 2 + ri(Math.min(25, cleanLen - start - 2));
      const find = cpSlice(clean, start, start + flen);
      if (find.includes('\n\n') || find.trim() === '') continue;
      const replace = ri(5) === 0 ? '' : pick(WORDS) + ' ' + pick(WORDS);
      const patch = { type: 'span', find, replace };
      if (ids.length && ri(2) === 0) patch.comments = [pick(ids)];
      else patch.reason = 'fuzz';
      patches.push(patch);
    }
  }
  return { spec: 1, responses, patches };
}

function checkApply(doc, label) {
  const before = parse(doc);
  const beforeIds = new Set(before.comments.filter((c) => c.id !== null).map((c) => c.id));
  const batch = randomBatch(before);
  const { text: out, report } = applyBatch(doc, batch);
  const after = parse(out);
  const afterErrs = after.issues.filter((i) => i.severity === 'error');
  if (afterErrs.length) throw new Error(`${label}: apply produced errors ${JSON.stringify(afterErrs)}\ndoc=${JSON.stringify(doc)}\nbatch=${JSON.stringify(batch)}\nout=${JSON.stringify(out)}`);
  assertEq(recompose(after).text, out, `${label}: apply output round trip`, JSON.stringify({ doc, batch }));
  const afterIds = new Set(after.comments.filter((c) => c.id !== null).map((c) => c.id));
  const resolvedIds = new Set(report.resolved.map((r) => r.id));
  for (const id of beforeIds) {
    const inAfter = afterIds.has(id);
    const inResolved = resolvedIds.has(id);
    if (inAfter === inResolved) {
      throw new Error(`${label}: id conservation violated for [${id}] (inDoc=${inAfter}, resolved=${inResolved})\ndoc=${JSON.stringify(doc)}\nbatch=${JSON.stringify(batch)}\nout=${JSON.stringify(out)}`);
    }
  }
  for (const id of afterIds) {
    if (!beforeIds.has(id)) throw new Error(`${label}: phantom id [${id}]\nbatch=${JSON.stringify(batch)}`);
  }
}

function randomJunk() {
  const bits = ['{==', '==}', '{>>', '<<}', '{--', '--}', '{++', '++}', '{~~', '~~}', '~>',
    '[a3f] ', 'plain text ', '\n', '\n\n', '---\n', 'word ', '{', '}', '==', '🦄 ', ' '];
  let s = '';
  const n = 1 + ri(40);
  for (let i = 0; i < n; i++) s += pick(bits);
  return s;
}

let failures = 0;
const report = (e, seed, cls) => {
  failures++;
  console.error(`\n=== FAILURE class ${cls} seed ${seed} ===\n${e.message.slice(0, 1200)}`);
};

const N = Number(process.argv[2] ?? 1500);
for (let seed = 1; seed <= N; seed++) {
  rnd = mulberry32(seed);
  try {
    const doc = randomAnnotate(randomCleanDoc(), 1 + ri(6));
    const p = checkParsedInvariants(doc, `A(seed ${seed})`);
    const withId = p.comments.filter((c) => c.id !== null);
    if (withId.length > 0) {
      const victim = pick(withId);
      const removed = removeComment(doc, { id: victim.id });
      if (!removed.removed) throw new Error(`A(seed ${seed}): removeComment missed [${victim.id}]`);
      const rp = checkParsedInvariants(removed.text, `A-rm(seed ${seed})`);
      assertEq(rp.cleanText, p.cleanText, `A-rm(seed ${seed}): clean text changed on remove`, JSON.stringify(doc));
      assertEq(rp.comments.filter((c) => !c.carrier).length, p.comments.filter((c) => !c.carrier).length - 1,
        `A-rm(seed ${seed}): comment count`, JSON.stringify(doc));
    }
  } catch (e) { report(e, seed, 'A'); }
  try {
    const doc = randomAnnotate(randomCleanDoc(), 1 + ri(5));
    checkApply(doc, `B(seed ${seed})`);
  } catch (e) { report(e, seed, 'B'); }
  try {
    const junk = randomJunk();
    const norm = normalizeLineEndings(junk);
    const p = parse(junk);
    assertEq(recompose(p).text, norm, `C(seed ${seed}): junk round trip`, JSON.stringify(junk));
  } catch (e) { report(e, seed, 'C'); }
  if (failures > 12) { console.error('aborting: too many failures'); break; }
}
console.log(failures === 0 ? `\nALL INVARIANTS HELD over ${N} seeds × 3 classes` : `\n${failures} failures`);
process.exit(failures === 0 ? 0 : 1);
