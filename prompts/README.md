# Prompts

Versioned with the spec, and data rather than code — like `conformance/`, so an
implementation in any language can use them without depending on this one.

- `review-request.md` — the reference prompt. Prepend it to an annotated document
  to ask a model for a conforming patch batch. Its frontmatter declares the spec
  version it targets.

`@galley/core` exports the same text as `AI_REVIEW_PREAMBLE`, so bundled adapters
need no file I/O. `packages/core/test/prompt-sync.test.ts` asserts the two stay
byte-identical, and that the prompt never teaches a rule SPEC.md does not have —
the same coupling that keeps SPEC §13's examples and the conformance fixtures in
step.

If you change the prompt, change `prompts/review-request.md`. The constant
follows it, not the other way round.
