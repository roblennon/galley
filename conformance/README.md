# Conformance fixtures

Data, never code — portable across implementations. Any implementation of the
spec should be able to load these files and check itself.

- `parse/` — annotated document → expected clean text, frontmatter, and
  annotation layer. `anchorText` states what each span/block anchor covers, so
  fixtures stay valid without hardcoded offsets.
- `apply/` — annotated document + patch batch → expected output document and
  report facts.
- `roundtrip/` — documents that must survive `parse → recompose` byte-exactly.

The `spec-13*` fixtures are extracted from SPEC.md §13 and CI verifies they
stay byte-identical to the spec's fenced blocks (spec examples double as test
fixtures).
