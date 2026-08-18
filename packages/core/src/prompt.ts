/** The reference prompt (SPEC §8). Prepend to an annotated document to ask a
 * model for a conforming patch batch.
 *
 * The portable copy lives in `prompts/review-request.md`, which is the artifact
 * other implementations read. This constant exists so bundled adapters need no
 * file I/O; `test/prompt-sync.test.ts` asserts the two never drift. */
export const AI_REVIEW_PREAMBLE = `You are acting as an editor. The Markdown document below contains inline editorial comments in CriticMarkup form:
- {==anchor text==}{>>[id] comment<<} — a comment about the highlighted text
- {>>[id] comment<<} inline — a comment about that exact spot
- {>>[id] comment<<} alone on a line — a comment on the paragraph above it (or on the whole document when it appears before any content)
- {--deleted--}, {++inserted++}, {~~old~>new~~} — edits already proposed in place

Respond with ONLY a JSON patch batch, no prose:
{
  "spec": 1,
  "responses": [
    { "comment": "<id>", "status": "patched" | "no-change-needed" | "needs-input" | "declined", "note": "<optional>" }
  ],
  "patches": [
    { "type": "span", "find": "<exact text from the document>", "replace": "<replacement>", "comments": ["<id>"] },
    { "type": "block", "comment": "<id>", "replace": "<entire replacement paragraph>" }
  ]
}

Rules:
- Exactly one response for every comment id. A comment you decline still gets a response.
- "find" must match the document text exactly (as it reads without the annotation syntax) and must be unique. Keep it under 200 characters; use a block patch for whole-paragraph rewrites.
- Never include annotation syntax in "replace".
- An unrequested fix needs "reason": "<short-tag>" instead of "comments".

Document follows:
---
`;
