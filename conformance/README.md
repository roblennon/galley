# Conformance fixtures

Data, never code — portable across implementations. Any implementation of the
spec should be able to load these files and check itself.

Each directory is **globbed**, not listed: every `*.json` file in `parse/`,
`apply/`, and `roundtrip/` is picked up automatically, so adding a fixture is
adding a file. Nothing else needs to change, in this repo or in yours. Fixtures
whose names begin with `negative-` assert a MUST NOT: the document is malformed
and the implementation has to say so.

- `parse/` — annotated document → expected clean text, frontmatter, annotation
  layer, and issues.
- `apply/` — annotated document + patch batch → expected output document and
  report facts.
- `roundtrip/` — documents that must survive `parse → recompose` byte-exactly.

The `spec-13*` fixtures are extracted from SPEC.md §13 and CI verifies they stay
byte-identical to the spec's fenced blocks (spec examples double as test
fixtures).

## Schema

Strings are exact: no trimming, no line-ending fixups, no whitespace tolerance.
Offsets never appear in a fixture — anchors are stated as the text they cover,
so a fixture stays valid whatever a given implementation counts in.

### `parse/*.json`

| field | required | meaning |
| --- | --- | --- |
| `name` | yes | One line saying what the fixture proves. For a negative fixture, state the rule: "An anchor MUST NOT cross a block boundary (SPEC §6.2)". |
| `input` | yes | The annotated document, verbatim. |
| `cleanText` | yes | The clean text `parse` must produce (SPEC §7). |
| `frontmatter` | yes | The frontmatter string including its trailing blank lines, or `null`. |
| `comments` | yes | Array, in document order. Each entry: `id` (string or `null`), `scope` (`span` \| `point` \| `block` \| `document`), `body`, and `anchorText` — the clean text the anchor covers, `""` for a zero-width point anchor. |
| `editMarks` | yes | Array, in document order. Each entry: `kind` (`insertion` \| `deletion` \| `substitution`), `original`, `proposed`. |
| `expectedIssues` | no | Array of `{ code, severity }`. **Omitted means the document must parse with no issues at all.** When present it is the complete set — order does not matter, but an unexpected extra issue fails, and so does a missing one. `severity` is `error` or `warning`. |

A malformed construct is still prose: a negative fixture states the issue *and*
the clean text the parser recovers, because "reported it" and "did not silently
drop the user's bytes" are two separate requirements (SPEC §11).

### `apply/*.json`

| field | required | meaning |
| --- | --- | --- |
| `name` | yes | One line saying what the fixture proves. |
| `input` | yes | The annotated document, verbatim. |
| `batch` | yes | The patch batch, exactly as a generator would emit it. |
| `output` | yes | The document `applyBatch` must produce, byte for byte. |
| `report` | no | Any subset of `appliedIndices`, `rejected`, `resolved`, `orphaned`, `unaddressed`, `responseIssues`. A field that is present is compared exactly; a field that is absent is not asserted. `responseIssues` defaults to `[]` — response coverage is a MUST (SPEC §8.2), so a fixture has to opt in to expecting failures there. |
| `expectedIssues` | no | Same shape and meaning as in `parse/`, applied to the report's `issues`. |

### `roundtrip/*.json`

```json
{ "name": "…", "documents": [{ "name": "…", "text": "…" }] }
```

Every `text` must satisfy `recompose(parse(text)) === text`. This holds
unconditionally, for malformed documents too, so the suite also round-trips
every `input` and `output` string found in `parse/` and `apply/`.

## Adding a fixture

Write the file, run the suite, and read the diff before believing it. A fixture
generated from an implementation's own output only proves the implementation is
self-consistent — decide what the spec requires first, then check whether the
code agrees.
