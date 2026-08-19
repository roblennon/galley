# Annotation Spec v1

A plain-text format for leaving editorial comments in Markdown documents, and for
returning machine-generated edits that answer them.

**Status:** Draft. **Spec version:** 1

---

## 1. Purpose and scope

Writers and editors need to leave notes on a document and hand it to a language
model that can act on them. Existing tools store comments in sidecar files or JSON
blobs, which means the document alone is not a complete artifact — the model sees
prose with no notes, or notes with no prose.

This spec defines an inline format: comments live in the text, next to what they
are about, so that a document handed to a model with no other context is
self-describing. It also defines a patch format for returning edits that are
attributable to specific comments.

### Non-goals

- Real-time collaborative editing. Anchors are character offsets and assume a
  single writer at a time.
- Rich text, tracked-changes interchange with word processors, or HTML round-trip
  fidelity.
- Storing authorship, timestamps, or revision history inline. See §4.
- Defining an editorial vocabulary. Reason tags (§9) are open by design; which
  tags an implementation recognizes is its own concern.
- Resolving cross-document references. The notation is reserved in v1 (§5.2) but
  resolution is deferred.

---

## 2. Relationship to CriticMarkup

This format is a constrained profile of
[CriticMarkup](http://criticmarkup.com/) with one extension.

| Mark | Form | Use here |
|---|---|---|
| Highlight | `{==text==}` | Delimits a comment's anchor |
| Comment | `{>>text<<}` | Carries a comment body, and all identifiers |
| Insertion | `{++text++}` | Proposed addition |
| Deletion | `{--text--}` | Proposed removal |
| Substitution | `{~~old~>new~~}` | Proposed replacement |

Extension: an optional identifier at the start of a comment body (§5.1). Because
the identifier is ordinary text inside a standard comment mark, an unaware
CriticMarkup parser reads a conforming document without error.

> **Extension principle.** Any future extension MUST remain readable as plain text
> to a parser that does not implement it.

---

## 3. Terminology

The key words MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are to be interpreted as
described in RFC 2119.

- **Clean text** — the document with all annotation syntax removed. The canonical
  form against which all offsets and patches are resolved.
- **Annotated document** — clean text plus annotation syntax, as stored on disk.
- **Anchor** — a range over clean text that a comment refers to.
- **Comment** — an identifier, an anchor or placement, and a body.
- **Scope** — whether a comment addresses a point, a span, a block, or the
  document.
- **Block** — a maximal run of consecutive lines in clean text that are not
  blank, where a blank line is one containing only spaces and tabs. Block
  boundaries are computed over clean text by this rule alone; see §7.1.
- **Edit mark** — an inline insertion, deletion, or substitution (§6.3).
- **Patch** — a single proposed text change, expressed as data rather than markup.
- **Patch batch** — a set of patches plus a response for every comment (§8).
- **Marginalia** — the optional out-of-band layer keyed by comment ID (§4).
- **Resolution** — applying or rejecting a patch and updating comment state.

---

## 4. Document layer and marginalia

Implementations MUST separate two layers.

**Document layer** — stored inline. Comment identifier, anchor, scope, body, edit
marks. Everything a model needs to perform an edit.

**Marginalia** — stored out of band. Author, timestamp, document version, threaded
replies, rationale for a patch, superseded variants, reason-tag aliases (§9.2),
resolved comment bodies.

The test for placement: *does a model need this to perform the edit?* If not, it
belongs in the marginalia.

- Marginalia MUST be serialized as YAML. Implementations MUST NOT define a bespoke
  syntax for it.
- Marginalia MUST be keyed by comment identifier.
- Marginalia MUST be optional. A conforming implementation MUST open an annotated
  document with no marginalia and lose no document-layer information. If deleting
  the marginalia loses meaning, something has been placed in the wrong layer.
- The conventional filename for a single document is `<document>.marginalia`
  beside it. A project-level file MAY be placed in a `.marginalia/` directory and
  address comments by qualified name (§5.2).
- Implementations MUST preserve keys they do not recognize when rewriting a
  marginalia file. This spec version does not define the field vocabulary, so an
  implementation that drops unknown keys destroys data written by another tool —
  and will destroy data written against a later spec version that does define it.

This spec version specifies the marginalia *container* — YAML, keyed by comment
identifier, optional — and deliberately does not specify its fields. A normative
field schema is planned for a later spec version; see §13.5.

---

## 5. Identifiers

### 5.1 Form

A comment body MAY begin with an identifier in square brackets, followed by a
single space:

```
{>>[a3f] this paragraph buries the lede<<}
```

- Identifiers MUST match `[A-Za-z0-9]{1,8}`.
- Identifiers MUST NOT contain `.`, which is reserved (§5.2).
- Implementations SHOULD generate 3–4 character identifiers.
- Generators SHOULD draw from an alphabet that excludes visually confusable
  characters: `l`, `I`, `1`, `O`, `0`.
- Generators MUST NOT allocate identifiers sequentially.
- Before minting an identifier, a generator MUST scan the document for existing
  identifiers and MUST NOT reuse one. Uniqueness within a document is therefore
  guaranteed by construction, not by probability.
- Generators MAY reserve the first character as a session prefix to reduce
  collisions when documents are merged.
- On merging two documents, an implementation MUST detect duplicate identifiers
  and MUST re-key one side rather than silently accepting the collision.

A comment without an identifier is valid. It cannot be referenced by a patch, and
implementations SHOULD assign one on first edit.

**The comment mark is the only identifier carrier.** Identifiers MUST NOT be
written inside highlight or edit marks, where a naive parser would treat them as
content and apply them to the text.

### 5.2 Qualified names

Identifiers are **local**. Only the local identifier is written into a document,
so that moving or renaming a file does not invalidate it.

A **qualified name** joins namespace segments with `.`, ending in a local
identifier — for example `manuscript.ch3.a3f`. Qualified names are **computed**
from a document's position in a hierarchy. They MUST NOT be stored in the document
layer.

Uniqueness is therefore only required within a single document; cross-document
collisions are resolved by the qualifier.

How segments are derived — file path, user configuration, or otherwise — is
implementation-defined and out of scope for v1. This section reserves the
separator so that a resolution scheme can be added without a breaking change.

---

## 6. Syntax

### 6.1 Comment placement determines scope

A comment mark's scope is determined by where it appears.

**Span comment** — a highlight immediately followed by a comment, with no
intervening characters:

```
The company {==leveraged its synergies==}{>>[a3f] say what they actually did<<} last quarter.
```

**Point comment** — a bare comment mark inline within prose. Its anchor is
zero-width at that offset:

```
She left without a word.{>>[c2k] we need a beat here<<} The door stayed open.
```

**Block comment** — a bare comment mark alone on a line, separated by blank lines,
attaching to the block **immediately preceding** it:

```
The quarter was difficult for reasons that were largely outside
our control, and we responded as well as could be expected.

{>>[b7c] this whole paragraph is defensive — cut or commit<<}
```

**Document comment** — a bare comment mark alone on a line, appearing before any
block content. Its scope is the entire file.

Multiple block comments MAY attach to the same block. Editors placing a block
comment from a paragraph selection, or from a cursor position with no selection,
SHOULD position it on the line following that block. This is interface guidance;
the format itself is positional.

Because the format has no escape mechanism, a comment body cannot contain the
closing delimiter `<<}`. Tools that write comments MUST refuse such a body
rather than emit a mark that parses differently than intended.

### 6.2 Anchoring rules

- An anchor MUST NOT cross a block boundary.
- An anchor SHOULD NOT partially overlap a Markdown emphasis, link, or code
  span; it should either contain the construct entirely or lie entirely outside
  it. This is authoring guidance, not a conformance requirement — see below.
- Anchors MUST NOT overlap each other.
- Anchors MUST NOT nest.
- A comment mark forming a span comment MUST immediately follow its highlight's
  closing `==}`.
- An anchor cannot cover text containing the literal sequence `==}`. Tools
  MUST refuse to create such an anchor rather than emit a highlight that
  terminates early.

The overlap and nesting restrictions exist so that every conforming document can
be rendered by decomposing text into non-overlapping segments. Implementations
encountering overlapping or nested anchors MUST report an error and MUST NOT guess
at the intended structure.

The emphasis rule is deliberately a SHOULD NOT rather than a MUST NOT. Enforcing
it requires recognizing Markdown inline structure, which would put a full inline
parser — the most intricate part of CommonMark — inside every conforming
implementation in every language, for a rule whose violation costs nothing in
data terms: an anchor that starts inside `*emphasis*` and ends outside it still
produces correct clean text, still round-trips byte-exactly, and still applies
patches correctly. What suffers is only how a highlight looks when rendered.
Weighed against the same reasoning as §7.1's block definition, the dependency is
not worth the tidiness. Editors SHOULD snap an anchor outward to whole
constructs where they can, and implementations MAY report a partial overlap as a
warning; neither is required to conform.

### 6.3 Edit marks

Insertions, deletions, and substitutions MAY appear inline:

```
The quarter was {--largely --}difficult, and we {~~recieved~>received~~} strong signals.
```

- Edit marks are anonymous. To reference one, attach an empty-bodied comment
  immediately after it: `{--largely --}{>>[a3f]<<}`.
- An edit mark MUST NOT contain an identifier.
- An edit mark MUST NOT span a block boundary.
- Applying an edit mark replaces the entire mark with its resulting text:
  insertions keep their content, deletions remove it, substitutions keep the text
  after `~>`.
- Rejecting an edit mark replaces it with its original text: insertions vanish,
  deletions keep their content, substitutions keep the text before `~>`.
- Edit marks MAY appear inside a comment's anchor. An anchor MUST NOT begin or end
  in the middle of an edit mark.

Edit marks and patches (§8) are alternative channels for the same intent. Patches
are for generated edits arriving from outside the document; edit marks are for
changes already written into it by a human or tool.

### 6.4 Spec version declaration

A document MAY declare its spec version in YAML frontmatter:

```yaml
annotation-spec: 1
```

Absent a declaration, parsers SHOULD assume the highest version they support.

---

## 7. Clean text and offsets

Comments are not text. They are **ranges over text**. Implementations MUST model
them that way.

Parsing a document produces two things: clean text, and an annotation layer whose
anchors are ranges into it.

- Offsets MUST be measured in Unicode code points, counted from the start of the
  clean text, zero-indexed, with ranges half-open: `[start, end)`.
- Before offsets are computed, line endings MUST be normalized to `\n`.
- YAML frontmatter (§6.4), when present, is not part of clean text. It is
  preserved verbatim, together with the blank lines that follow it, and restored
  on recomposition.
- A block or document comment's line — the mark, surrounding whitespace on its
  line, its line terminator, and one adjacent blank-line separator — is
  annotation syntax and is removed with the comment.
- Trailing whitespace on a line MUST be preserved in clean text.
- Unresolved edit marks contribute their **original** text to clean text:
  insertions contribute nothing, deletions contribute their content, substitutions
  contribute the text before `~>`.
- Removing annotation syntax MUST NOT alter any other character. Implementations
  MUST be able to reconstruct the annotated document from clean text plus the
  annotation layer exactly.

All patches are expressed against clean text. A patch batch therefore applies
identically to an annotated document and to a copy with annotations stripped.

---

A block or document comment occupies its own line, so attaching one after the
final block of a document that does not end in a line terminator requires one to
exist. Clean text therefore gains a single trailing newline in that case, and a
document with no final newline may acquire one once it is annotated. This is a
property of the format rather than an implementation choice: no serialization of
a trailing block comment avoids it. Implementations MUST NOT add a trailing
newline in any other circumstance.

A UTF-8 byte order mark, when present at the start of a document, is not part
of clean text and does not participate in offsets. Implementations MUST strip it
before parsing and MUST restore it when writing the document back, so that a
file carrying one round-trips unchanged. Treating it as content shifts every
offset by one, hides frontmatter behind it, and reclassifies a leading document
comment as a point comment.

## 7.1 Block boundaries

A **block** is a maximal run of consecutive non-blank lines in clean text. A
line is blank when it contains only spaces and tabs. A block's range excludes
the line terminator that ends it.

Implementations MUST compute block boundaries by this rule alone. They MUST NOT
parse Markdown structure to determine them. Two conforming implementations
therefore agree on block boundaries for every document, in any language, with no
Markdown parser and no shared dependency.

This is a deliberate simplification, and it has consequences worth stating
plainly rather than discovering:

- A heading followed immediately by a paragraph, with no blank line between
  them, is **one** block. An anchor may span both.
- A list whose items are not separated by blank lines is **one** block. A list
  with blank lines between items is several.
- A fenced code block containing a blank line is **two or more** blocks, because
  the fence is not interpreted.
- Two paragraphs separated only by a line of spaces are still two blocks, since
  such a line is blank by this definition.

The alternative — defining blocks by Markdown structure — would be more faithful
to how a reader sees a document, but it would require every implementation to
carry a CommonMark parser, and would make block boundaries depend on which
Markdown flavor an implementation chose. For a format whose purpose is that a
plain-text document is self-describing and portable, that cost is not worth
paying. This rule may be revisited in a later spec version; it will not change
within version 1.

Because a heading and the paragraph beneath it may be one block, tools that
create anchors SHOULD avoid spanning a line that begins with `#` when a
narrower anchor expresses the same intent.

---

## 8. Patches and responses

A patch batch is the reconciliation channel for generated edits. It is a data
structure, not inline markup, and its serialization is JSON.

### 8.1 Structure

```json
{
  "spec": 1,
  "responses": [
    { "comment": "a3f", "status": "patched" },
    { "comment": "b7c", "status": "declined",
      "note": "the defensiveness reads as candor here" }
  ],
  "patches": [
    { "type": "span",
      "find": "leveraged its synergies",
      "replace": "merged two sales teams",
      "comments": ["a3f"] },
    { "type": "span",
      "find": "we recieve",
      "replace": "we receive",
      "reason": "typo" }
  ]
}
```

### 8.2 Responses

A batch MUST contain exactly one response for every comment presented to the
generator. A missing response is a generator failure and MUST be reported as such;
it is not equivalent to any status.

| Status | Meaning |
|---|---|
| `patched` | One or more patches address this comment |
| `no-change-needed` | The comment was a question, or no edit is warranted |
| `needs-input` | Cannot be resolved without information not in the document |
| `declined` | Understood and deliberately not acted on |

A response MAY carry a `note`. Implementations SHOULD store notes in the
marginalia rather than writing them into the document.

Generators MUST NOT signal a non-edit by emitting an empty, null, or `"n/a"`
patch. Status is the only channel for this.

### 8.3 Span patches

`find` is a literal string in clean text. `replace` is its replacement.

- `find` and `replace` are clean text. `replace` MUST NOT contain annotation
  syntax; a patch whose replacement would introduce marks MUST be rejected.
- `find` MUST match the clean text exactly, including whitespace.
- `find` MUST be unique within the document, or within the block containing the
  anchor of a referenced comment. Ambiguous matches MUST be rejected.
- `find` SHOULD NOT exceed 200 characters. Larger changes SHOULD use a block
  patch.

Matching MUST NOT fall back to fuzzy or approximate matching. A failed match MUST
be reported with the closest candidate text so the generator can correct and
resend. Silent approximate application of prose edits is prohibited.

### 8.4 Block patches

For changes too large to quote reliably:

```json
{ "type": "block", "comment": "a3f", "replace": "The rewritten paragraph." }
```

The target is the block containing the anchor of the named comment. The generator
supplies only replacement text and never reproduces the original. Implementations
SHOULD prefer block patches whenever a change spans most of a block.

### 8.5 Attribution

Every patch SHOULD carry at least one of:

- `comments` — an array of comment identifiers the change addresses. A change MAY
  serve more than one comment, and MAY fall outside those comments' anchors.
- `reason` — a short tag describing why an unrequested change was made (§9).

A patch with neither is valid but unattributed, and implementations SHOULD present
it distinctly.

---

## 9. Reason tags

### 9.1 Form

- A reason tag MUST be lowercase, hyphen-separated, and MUST NOT contain spaces.
- A reason tag SHOULD be one to three words: `typo`, `em-dash`, `passive-voice`.
- Implementations MUST treat tags as opaque strings and MUST NOT reject a tag for
  being unrecognized.

The set of meaningful tags is deliberately undefined. Implementations MAY maintain
a known vocabulary and MAY treat counts against it as authoritative; counts against
tags outside it are descriptive only, since a generator may not word the same
concept consistently. Implementations SHOULD distinguish the two when reporting.

### 9.2 Normalization

To limit vocabulary drift, implementations SHOULD:

- supply tags already used in the document to the generator, and prefer reuse;
- lowercase and trim tags on parse;
- support a user-editable alias map in the marginalia, so that merging two tags
  persists across sessions.

---

## 10. Applying a batch

Implementations MUST apply a batch as a single transaction, in this order:

1. **Decompose** the annotated document into clean text and an annotation layer.
2. **Locate** every patch against the *original* clean text. Patches MUST NOT be
   located sequentially against partially-modified text.
3. **Validate.** Sort located patches by start offset and check for overlap. A
   document MUST NOT be modified before validation completes.
4. **Apply** non-conflicting patches in descending order of start offset, so that
   applying one never invalidates another's position.
5. **Transform** every anchor through the same edits (§10.1).
6. **Recompose** clean text and annotation layer into an annotated document.

On conflict, implementations SHOULD apply non-conflicting patches and report the
rejected ones, so the report can be returned to the generator. A single patch MUST
NOT be partially applied. Two patches MUST NOT be applied to overlapping ranges.

Where a patch attributed to a comment conflicts with a patch attributed only to a
`reason` tag, the comment-attributed patch takes precedence.

### 10.1 Anchor transformation

For an edit replacing `[s, e)` with text of length `L`, let `delta = L - (e - s)`.
For an anchor `[a, b)`:

| Relationship | Result |
|---|---|
| `b <= s` — anchor entirely before | unchanged |
| `a >= e` — anchor entirely after | shift both ends by `delta` |
| `a <= s` and `b >= e` — anchor contains the edit | `a` unchanged, `b += delta` |
| `a >= s` and `b <= e` — anchor inside the edit | anchor destroyed; see below |
| otherwise — partial overlap | clamp to the surviving portion, flag `anchor-modified` |

A point comment is a zero-width anchor and follows the same rules: it shifts with
preceding edits, and is destroyed only by an edit that strictly contains its
offset.

When an anchor is destroyed, the outcome depends on attribution:

- If the destroying patch is attributed to that comment, the comment is
  **resolved**. Its body moves to the marginalia and it stops rendering inline.
- Otherwise the comment is **orphaned**: it is demoted to block scope, attached to
  the block where its anchor formerly began, and flagged `anchor-lost`.

> **Invariant.** A comment is never destroyed by applying a patch. It is resolved,
> re-anchored, or orphaned.

### 10.2 Reporting

Applying a batch MUST return, at minimum: patches applied, patches rejected with
reasons, comments resolved, comments orphaned, and comments with no corresponding
patch.

---

## 11. Error handling and forward compatibility

- Unrecognized constructs MUST be preserved verbatim and MUST NOT be dropped,
  reordered, or normalized.
- A parser encountering an unknown spec version SHOULD parse what it recognizes
  and preserve the rest.
- Malformed annotation syntax — an unclosed mark, a highlight followed by no
  comment — MUST be reported. Implementations SHOULD treat the affected text as
  ordinary prose rather than failing the whole document.
- An identifier appearing inside a highlight or edit mark MUST be treated as
  ordinary content, not as an identifier, and SHOULD be reported as a warning.

---

## 12. Versioning

The spec version and any implementation's version are independent.

A change is **breaking**, and requires a major spec version, if it would cause a
conforming v1 document to parse differently or fail to parse. Adding an optional
field, an additional response status, or a new patch type is non-breaking.

Implementations MUST declare the spec version they support.

---

## 13. Examples

### 13.1 A document

```markdown
---
annotation-spec: 1
---

# Q3 Review

The company {==leveraged its synergies==}{>>[a3f] say what they actually did<<}
last quarter, and we recieve strong signals from the market.

Growth was {--largely --}difficult for reasons outside our control, and we
responded as well as could be expected.

{>>[b7c] this paragraph is defensive — cut or commit<<}
```

### 13.2 Its clean text

The unresolved deletion contributes its original content. The frontmatter and
the block comment's line are not part of clean text.

```
# Q3 Review

The company leveraged its synergies
last quarter, and we recieve strong signals from the market.

Growth was largely difficult for reasons outside our control, and we
responded as well as could be expected.
```

### 13.3 A batch answering it

```json
{
  "spec": 1,
  "responses": [
    { "comment": "a3f", "status": "patched" },
    { "comment": "b7c", "status": "declined",
      "note": "reads as candor rather than defensiveness" }
  ],
  "patches": [
    { "type": "span", "find": "leveraged its synergies",
      "replace": "merged two sales teams", "comments": ["a3f"] },
    { "type": "span", "find": "we recieve", "replace": "we receive",
      "reason": "typo" }
  ]
}
```

### 13.4 The result

`a3f` is resolved: its anchor was destroyed by a patch attributed to it, so the
comment moves to the marginalia. `b7c` is unaffected and remains open. The typo
patch is unattributed to any comment and is presented under its reason tag. The
deletion mark is untouched, since no patch addressed it.

```markdown
---
annotation-spec: 1
---

# Q3 Review

The company merged two sales teams
last quarter, and we receive strong signals from the market.

Growth was {--largely --}difficult for reasons outside our control, and we
responded as well as could be expected.

{>>[b7c] this paragraph is defensive — cut or commit<<}
```

### 13.5 Its marginalia

**Non-normative.** The field names below are illustrative, not a schema. This
spec version requires only that marginalia be optional YAML keyed by comment
identifier (§4); it does not define what the values contain. Implementations MAY
use these names, MUST tolerate others, and MUST preserve keys they do not
recognize. Do not treat this example as a conformance target.

```yaml
spec: 1
comments:
  a3f:
    status: resolved
    body: say what they actually did
    resolved_by: merged two sales teams
  b7c:
    status: declined
    note: reads as candor rather than defensiveness
```
