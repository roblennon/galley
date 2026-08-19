# Galley for Obsidian

Inline editorial comments in your Markdown, on the galley annotation
format (see `../../SPEC.md`) — a constrained CriticMarkup profile with short
identifiers. Comments live in the file itself, so a note handed to an AI
editor is self-describing, and the AI's edits come back as an attributable
patch batch that answers every comment.

## Commands

- **Add comment** (right-click menu or command palette; bind a hotkey in
  Settings → Hotkeys if you like) — a selection becomes a highlighted span
  comment; a bare cursor offers "this exact spot" or "this paragraph".
- **Add document-level note** — a comment scoped to the whole file.
- **Open comments panel** — right-sidebar list with jump-to and remove.
- **Copy document for AI review** — the annotated note plus instructions
  that teach a model to return a conforming patch batch.
- **Apply patch batch from clipboard** — locates, validates, and applies the
  batch (never fuzzily), transforms anchors, and shows a report: applied,
  rejected (with closest candidates), resolved, orphaned, unanswered.
- **Validate annotations** — well-formedness check for the current note.
- **Toggle annotation markup rendering** — switch between rendered chips
  and raw syntax.

Live Preview renders annotations as highlights and id chips (hover a chip
for the comment body); an annotation touched by the cursor reveals its raw
syntax for editing. Reading mode renders highlights, notes, and edit marks.

## Development

```
pnpm build            # bundle + typecheck
pnpm test             # headless smoke suite (stubbed obsidian module)
pnpm install-to-vault # copy into ../../test-vault (or pass a vault path)
```

Parsing and byte-level transformations live in `@galleymd/core`; reusable
CodeMirror targeting and presentation models live in `@galleymd/codemirror`.
The plugin owns Obsidian UI and lifecycle behavior. Files must use LF line
endings (Obsidian's default).
