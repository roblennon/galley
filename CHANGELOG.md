# Changelog

Notable changes to the spec and the packages in this repository. The spec version
and package versions move independently — see `SPEC.md` §12.

This project has not had a public release yet. Everything below is pre-1.0 and
the format is still allowed to move.

## @galleymd/core 0.2.0 — 2026-08-19

First public release. Spec version 1, status Draft.

Published under the `@galleymd` scope: npm's bare `galley` name belongs to an
unrelated archived project, which also blocks an organization of that name.

Everything below was in the tree before this release; it is listed here because
this is the first version anyone outside the repository can install.

## Unreleased

### Spec

- Spec version 1, status Draft. Scopes (span, point, block, document),
  identifiers, anchor rules, patches, and responses are specified and stable
  enough to implement against.

### Added

- `core` — parse, recompose, addComment, applyBatch, generateId, validate.
  Byte-exact round trip, offsets in Unicode code points.
- `core` — tracked-changes mode: patches arrive as edit marks, accepted or
  rejected individually, then exported to a final version.
- `obsidian` — plugin with inline comment authoring, comments panel, copy for AI
  review, patch batch application with an attributable report, and validation.
- `web` — no-login browser lab for the full round trip on local files.
- `codemirror` — editor models shared by CodeMirror-based adapters.
- `conformance/` — fixtures as data. Spec §13 examples are extracted here and CI
  verifies they stay byte-identical to the spec.
- `prompts/` — the reference prompt as a portable, spec-versioned artifact.
  `core` exports the same text; a test asserts the two never drift and that the
  prompt teaches only response statuses SPEC §8 defines.

### Changed

- The reference prompt moved from `codemirror` to `core`. It is format knowledge,
  not editor knowledge, and adapters that are not CodeMirror-based need it too.

### Spec

- §4 — marginalia: implementations MUST preserve keys they do not recognize when
  rewriting a marginalia file, so that defining a field schema in a later version
  is not a breaking change.
- §13.5 — labelled non-normative. The container is specified; the field
  vocabulary deliberately is not, and the example is not a conformance target.
