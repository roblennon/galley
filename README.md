# Galley

**Editorial comments that live inside the Markdown file, so an AI editor can read
them next to the prose they are about.**

A *galley* is the proof stage of a manuscript — the draft that exists to be marked
up. That is what this format is for.

```markdown
The company {==leveraged its synergies==}{>>[a3f] say what they actually did<<} last quarter.
```

That is a whole comment. No sidecar database, no proprietary container, no
tracked-changes XML. The note is in the text, next to what it refers to, and the
file is still Markdown.

---

## Why inline

Every other annotation tool stores comments out of band — a sidecar JSON file, a
row in a database, a layer the editor knows about and nothing else does. That is
fine when the reader is a person looking at a screen. It falls apart the moment
the reader is a language model, because you can hand it the prose or the notes,
but not the prose *with* the notes in the right places.

An annotated Galley document is self-describing. Paste it into any model with no
other context and the instructions are already sitting next to the sentences they
are about. That is the entire idea; everything else in this repository follows
from it.

The format is the artifact here. The library and the editors are reference
implementations — proof that the format is implementable and usable, not the
product.

## What it looks like

Comments carry scope by *where they sit*, not by extra syntax:

```markdown
She left without a word.{>>[c2k] we need a beat here<<} The door stayed open.

The quarter was difficult for reasons largely outside our control.

{>>[b7c] this whole paragraph is defensive — cut or commit<<}
```

A comment attached to highlighted text is a **span** comment. Inline with no
highlight, it is a **point** comment on that exact spot. Alone on its own line, it
is a **block** comment on the paragraph above. Before any content, it scopes the
**whole document**. Proposed edits can also be written in place:

```markdown
The quarter was {--largely --}difficult, and we {~~recieved~>received~~} strong signals.
```

The `[a3f]` identifiers are the one extension to
[CriticMarkup](http://criticmarkup.com/), whose mark syntax this format is a
constrained profile of. They exist so an edit can say which note it answers.

## The round trip

This is the part that makes it useful rather than merely tidy.

1. **Annotate.** Leave comments in the document as you read.
2. **Hand it to a model.** The document plus a short instruction preamble. No
   context assembly, no retrieval step.
3. **Get back a patch batch** — JSON that names the exact text to replace and
   which comment each edit answers.
4. **Apply it.** Every patch is located against the original text and matched
   exactly, never fuzzily. A patch that cannot be placed is rejected loudly with
   its closest candidate rather than applied to the wrong sentence.

Two guarantees make the loop trustworthy:

**Every comment gets exactly one response** — `patched`, `no-change-needed`,
`needs-input`, or `declined`. A model cannot quietly skip the note it found
inconvenient, because coverage is checked, not hoped for.

**A comment is never destroyed by a patch.** It is resolved if an edit was
attributed to it, re-anchored if its text moved, or demoted to a block comment and
flagged as anchor-lost. It is never silently dropped.

## What's here

| | |
|---|---|
| [`SPEC.md`](SPEC.md) | The specification. The stable artifact — read this first. |
| [`packages/core`](packages/core) | Parse, author, validate, apply. Pure functions, no I/O, no UI. |
| [`packages/obsidian`](packages/obsidian) | Obsidian plugin. Comment inline, run the round trip in your vault. |
| [`packages/web`](packages/web) | A no-login browser lab. Your files stay on your device. |
| [`packages/codemirror`](packages/codemirror) | Editor models shared by CodeMirror-based adapters. |
| [`conformance/`](conformance) | Fixtures as data, so any implementation in any language can check itself. |
| [`prompts/`](prompts) | The reference prompt, versioned with the spec. How a model learns the format. |
| [`RELEASING.md`](RELEASING.md) | Maintainer release process: promotion, plugin betas, versioning. |

## Install

```sh
npm install @galleymd/core
```

[![npm](https://img.shields.io/npm/v/@galleymd/core)](https://www.npmjs.com/package/@galleymd/core)

## Try it

```sh
pnpm install
pnpm build
pnpm --filter @galleymd/web dev
```

Then open a local Markdown file, select a sentence, and leave a comment.

For the Obsidian plugin:

```sh
pnpm --filter @galleymd/obsidian install-to-vault /path/to/your/vault
```

## Status

Pre-1.0, and honest about it. The spec is at version 1 with **Draft** status, and
`@galleymd/core` is published at 0.2.x. The format's shape is settled enough to
build against — scopes, identifiers, anchoring, patches, and responses are all
specified — but pre-1.0 means a minor version bump may still break the API. The
adapters are not published; they are applications, not libraries.

The npm scope carries a suffix because the bare `galley` name on npm belongs to
an unrelated archived project, which also blocks the matching organization. The
format, the repository, and the domain are all just Galley.

Spec versions and package versions move independently. A change that would make a
conforming v1 document parse differently requires a major spec version, and there
is a high bar for that.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Spec changes and code changes have
different bars, and it explains both.

Building with AI is welcome — most of this project was. The one real ask is that
pull requests stay small enough for a human to review.

## License

[Apache-2.0](LICENSE). Contributions come in under the same license; there is no
CLA to sign.

The mark syntax originates in [CriticMarkup](http://criticmarkup.com/) by Gabe
Weatherhead, Erik Hess, Martin Fenner, and contributors. See [NOTICE](NOTICE).
