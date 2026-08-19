# @galley/core

Editorial comments that live inside the Markdown file, so an AI editor can read
them next to the prose they are about.

```markdown
The company {==leveraged its synergies==}{>>[a3f] say what they actually did<<} last quarter.
```

That is a whole comment. No sidecar database, no proprietary container — the
note sits next to what it refers to, and the file is still Markdown. This
package is the reference implementation of
[the specification](https://github.com/roblennon/galley/blob/main/SPEC.md).

```sh
npm install @galley/core
```

## Example

```js
import { parse, applyBatch } from '@galley/core';

const doc = 'The company {==leveraged its synergies==}{>>[a3f] be concrete<<} last quarter.\n';

// What a model should see: the prose, with the notes in place.
const { cleanText, comments } = parse(doc);

// What a model sends back: edits that name the comment each one answers.
const { text, report } = applyBatch(doc, {
  spec: 1,
  responses: [{ comment: 'a3f', status: 'patched' }],
  patches: [{
    type: 'span',
    find: 'leveraged its synergies',
    replace: 'merged two sales teams',
    comments: ['a3f'],
  }],
});

report.applied;   // patches that were located and applied
report.rejected;  // patches that could not be placed, with the closest candidate
report.resolved;  // comments retired by an attributed edit
```

Patches are matched **exactly and never fuzzily**. A patch that cannot be placed
is rejected with its closest near-miss, so a wrong edit is never applied to the
wrong sentence. Every comment gets exactly one response, and a comment is never
destroyed by a patch — it is resolved, re-anchored, or orphaned.

## API

Reading and writing documents:

- `parse(text)` → clean text, comments, edit marks, frontmatter, a source map,
  and any issues found
- `recompose(layer)` → the annotated document; byte-exact for anything `parse`
  produced, and it refuses input it could not read back
- `addComment(text, options)` → insert a span, point, block, or document comment
- `removeComment(text, { id })` → take one out; returns `{ text, removed }`
- `validate(text)` → well-formedness issues for an annotated document

Applying generated edits:

- `applyBatch(text, batch, options?)` → apply a patch batch (SPEC §10) and
  return a report. Pass `{ asEditMarks: true }` for tracked-changes mode, where
  edits arrive as inline marks for review instead of being applied outright
- `resolveEditMarks(text, options)` → accept or reject tracked changes
- `exportFinalText(text)` → the finished document, all annotation removed

Identifiers and offsets:

- `generateId({ existing })` → mint a non-sequential id that does not collide
  with the ones you pass. SPEC §5.1 requires scanning the document first;
  `existingIds(text)` collects them
- `AI_REVIEW_PREAMBLE` → the reference prompt that teaches a model to emit a
  conforming batch. Versioned with the spec
- `SPEC_VERSION` → the spec version this library implements, independent of the
  package version
- `blockRanges`, `normalizeLineEndings`, `splitCommentContent`, `ID_ALPHABET`,
  and the `cp*` / `*RawToClean` helpers → block, line-ending, and offset
  arithmetic for editor adapters

All offsets are Unicode **code points** over clean text (SPEC §7). Line endings
are normalized to `\n`.

## Requirements

Node 20.19 or newer. ESM only — this package has no CommonJS build.

## Status

Pre-1.0. The format's shape is settled and the spec is at version 1, but minor
version bumps may still break the API. Package versions and the spec version
move independently.

## License

[Apache-2.0](LICENSE). The mark syntax is a constrained profile of
[CriticMarkup](http://criticmarkup.com/) — see [NOTICE](NOTICE).
