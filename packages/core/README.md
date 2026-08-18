# @galley/core

Core library for the inline Markdown annotation spec (see `../../SPEC.md`).
Pure functions, text in / text out, no file I/O, no UI.

## API

- `parse(text)` → clean text + annotation layer (comments, edit marks, issues)
- `recompose(parseResult)` → the annotated document, byte-exact round trip
- `applyBatch(text, batch)` → apply a JSON patch batch per SPEC §10, with report
- `addComment(text, options)` → insert a span/point/block/document comment
- `generateId(options)` → mint a collision-free comment identifier
- `validate(text)` → well-formedness issues for an annotated document

All offsets are Unicode code points over clean text (SPEC §7).
