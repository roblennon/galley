# Contributing

Thanks for looking. This project is two things that live at different speeds, and
knowing which one you're touching is most of what you need to know before you
open a pull request.

**`SPEC.md` is the artifact.** It is a prose specification with RFC 2119 language,
and it is meant to outlive every implementation in this repository — including
all of them. Changing it is a bigger deal than changing code.

**Everything under `packages/` is a reference implementation.** The core library
proves the spec is implementable; the adapters prove it is usable. They can be
rewritten freely as long as the spec still holds.

## Getting set up

Node 20.19 or newer, and [pnpm](https://pnpm.io) 10.

```sh
pnpm install
pnpm build
pnpm test
```

That is the same sequence CI runs. If it passes locally it should pass there.

The packages:

- `packages/core` — parse, author, validate, apply. Pure functions, text in and
  text out, no file I/O and no UI. This is where byte-level behavior lives.
- `packages/codemirror` — presentation and targeting models shared by editors
  built on CodeMirror.
- `packages/obsidian` — the Obsidian plugin.
- `packages/web` — a no-login browser lab for trying the format on local files.
- `conformance/` — fixtures as data, never code, so that any implementation in
  any language can check itself against them.

One naming wrinkle worth knowing: the project is Galley, but the sidecar file
extension is `.marginalia`. That is deliberate. *Marginalia* is the term the spec
uses for the optional out-of-band layer (§4) — author, timestamps, threads — and
it stays that regardless of what the project is called. If you are editing spec
text, `marginalia` means the sidecar layer, never the project.

## Changing the implementation

Test against the public API, not internals. Internals should stay free to move;
if a test breaks because a private function was renamed, the test was wrong.

New behavior needs a test that fails before your change and passes after it. For
anything touching parsing, offsets, or patch application, prefer adding a
conformance fixture over a unit test — a fixture is portable to other
implementations, and a unit test is not.

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org):
`fix(core): ...`, `feat(obsidian): ...`, `docs: ...`.

## Changing the spec

Open an issue first. Spec changes are cheap to propose and expensive to undo, and
the conversation is usually more valuable than the patch.

A proposal lands better when it carries:

- **A real document that the current spec handles badly.** Not a hypothetical.
  The format is deliberately constrained, and "an implementation could want this"
  is not yet a reason to widen it.
- **Conformance fixtures** covering the new behavior, in `conformance/`.
- **An honest read on whether it breaks v1.** A change is breaking if it would
  make a conforming v1 document parse differently or fail to parse. Breaking
  changes need a major spec version and a much stronger case.

Examples in `SPEC.md` §13 are extracted into `conformance/` and CI verifies they
stay byte-identical. If you edit a spec example, expect that test to fail until
you update the fixture too. That coupling is intentional — it means the spec
cannot drift from what the code actually does.

Some questions are already settled and reopening them needs new evidence rather
than new preference. `SPEC.md` records what the format does; the non-goals in §1
record what it deliberately will not do.

## Pull requests

Keep them scoped. A PR that fixes a bug and also reformats three files is two
PRs wearing a coat.

Describe the change in terms of behavior — what was true before, what is true
now, and how you know. If you added a test or fixture, point at it.

## Working with AI

You are very welcome to build with AI here. I do essentially all of my own
development that way, and this repository is the result — so nothing in this
section is a judgement about how you work.

Two friendly asks.

**Keep pull requests tight.** This is the one that actually matters. AI makes it
almost free to generate a thousand lines and quite expensive for a human to read
them, and that asymmetry is where good projects quietly fall over. A focused
change that does one thing gets reviewed and merged. A large one that also
refactors nearby code, adjusts formatting, and adds a few extra abstractions
tends to sit there, because nobody can tell which parts were the point. If your
assistant produced more than you asked for, trim it back before you open the PR
— you will get a much faster review.

**Tell us what you used, if you are comfortable.** A line in the PR description
naming the model or tool is plenty. It is genuinely useful context: different
assistants have different characteristic blind spots, and knowing which one wrote
a patch helps a reviewer know where to look hardest. This is a request, not a
requirement, and no contribution will be turned away for leaving it out.

What gets reviewed is the change, on its merits. Please do read what you submit
and be able to speak to why it works — that is the same bar as any other
contribution, and the only one that really counts.

## Licensing of contributions

This project is Apache-2.0. Under section 5 of that license, anything you
deliberately submit for inclusion is licensed under the same terms, unless you
say otherwise in writing. There is no separate CLA to sign.

You keep the copyright to what you write. You are just granting everyone the same
rights the rest of the project already grants.

## Conduct

The [Code of Conduct](CODE_OF_CONDUCT.md) applies everywhere this project
happens. Report problems to rob@roblennon.xyz.
