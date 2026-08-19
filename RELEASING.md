# Releasing

Maintainer notes. Contributors want [CONTRIBUTING.md](CONTRIBUTING.md) instead.

This repository ships four things that move at different speeds, and most of
the process below exists to keep them from being confused with each other.

They are ordered below by how hard a mistake is to take back, hardest first.
That ordering is deliberate: the artifacts you release most often are the ones
that forgive you, and the one you touch least often forgives nothing.

| Artifact | Versioned by | Released by |
|---|---|---|
| The spec | `SPEC.md` spec version | Editing the file. Prose, not a package. |
| npm packages | each `package.json` | `npm publish` (nothing published yet) |
| Obsidian plugin | `manifest.json` | A GitHub release with three assets |
| The web lab | not versioned | Promoting a staged Vercel deployment |

## Branching

One long-lived branch: `main`.

Work happens on a short branch, arrives by pull request, and lands on `main`
once CI is green. There is no `develop`. The gate that matters is not a second
branch — it is that nothing reaches the live domain without a person choosing
to promote it, which is handled below.

`main` should always be releasable. That is a real constraint, not an
aspiration: anything on `main` can be promoted to `galley.md` in one command by
someone who has not read the diff.

## The spec

**Least reversible thing here.** Once someone implements against a published
spec, changing it breaks their code, not yours — and you cannot un-publish it,
because there is no install step to roll back. Everything else on this page can
be recovered from. This cannot.

`SPEC.md` carries its own version, independent of every package.

What counts as breaking is defined normatively in SPEC.md §12. Do not restate
it here or anywhere else — link to it. It already exists in three places in this
repository, and paraphrases drift from the text they paraphrase with nothing to
catch it.

Two couplings are enforced by tests rather than discipline, and both will fail
CI if you edit one side only:

- `SPEC.md` §13's examples must match the fixtures in `conformance/`
- `prompts/review-request.md` must match `AI_REVIEW_PREAMBLE` in `core`, and
  must not teach a response status the spec does not define

That is deliberate. It means the spec cannot quietly drift from what the code
does.

## npm packages

**Recoverable.** A bad publish is fixed by a patch release and a deprecation
notice. The cost is other people's time, not their data.

Nothing is published yet; every package is `"private": true`.

When that changes: drop `private`, add `"publishConfig": {"access": "public"}`,
and publish from a clean `main` with tests green. `core` is the only package
with a reason to be published on its own — the adapters are applications, and
`codemirror` exists to be shared between them.

Version the packages independently of the spec. A package at 0.3.0 implementing
spec version 1 is normal and should stay possible.

## The Obsidian plugin

**Recoverable, but slowly, and it touches user files.** A shipped version sits
in people's vaults until each of them updates. It is also the only artifact that
writes to a user's own writing, so "it built cleanly" is nowhere near enough —
test in a real vault against a real document.

Obsidian installs plugins from GitHub releases, not from branches, so beta
testing is a release channel rather than a branch.

1. Bump `version` in `packages/obsidian/manifest.json`. Obsidian requires
   semver, and `minAppVersion` should reflect the oldest Obsidian the build
   actually works on.
2. Build and verify in a real vault:

   ```sh
   pnpm --filter @galley/obsidian build
   pnpm --filter @galley/obsidian install-to-vault /path/to/vault
   ```

3. Tag and publish a GitHub release whose assets are exactly `main.js`,
   `manifest.json`, and `styles.css`, attached individually. Not a zip —
   Obsidian and BRAT fetch the files directly.
4. For a beta, mark it a **pre-release**. Testers install it with
   [BRAT](https://github.com/TfTHacker/obsidian42-brat) by pointing at this
   repository; BRAT is how the Obsidian community distributes betas, and it
   reads pre-releases specifically.
5. A stable release is the same steps without the pre-release flag.

Submission to the community plugin directory is a separate, one-time pull
request against `obsidianmd/obsidian-releases`.

## The web lab, and why nothing auto-publishes

**Most reversible.** A bad deploy is undone in seconds by reassigning the
domain, with no rebuild. Its risk is not correctness but first impressions.

`galley.md` does **not** update when you merge to `main`.

Auto-assignment of production domains is disabled on the Vercel project. A push
to `main` builds a full production deployment — production environment,
production build, real URL — and leaves it in the **Staged** state. The domain
keeps serving whatever was promoted last.

So the loop is:

1. Merge to `main`. Vercel builds and stages it.
2. Open the staged deployment's URL and actually read it. This is the step the
   whole arrangement exists to protect; skipping it makes the rest theatre.
3. Promote it:

   ```sh
   vercel promote <deployment-url> --scope harbor-lane
   ```

   Promotion assigns the domain to a build that already exists. There is no
   rebuild, so what you approved is byte-for-byte what ships.

To see what is staged versus current:

```sh
vercel ls galley --scope harbor-lane
```

### Rolling back

```sh
vercel rollback <previous-deployment-url> --scope harbor-lane
```

Instant, because it reassigns the domain rather than rebuilding. Reach for this
first when production is wrong; diagnose afterwards.

A deployment can only be promoted once. To return to something previously
promoted, roll back to it rather than promoting it again.

### Pull request previews

Every pull request gets its own preview URL, isolated from both `main` and the
live domain, and reachable without signing in so contributors can see their own
work. Previews carry `x-robots-tag: noindex`, so they stay out of search results.

Pull requests from forks still require approval before they build. Leave that on:
it is what stops a hostile pull request from spending build minutes in your team.

## Current setup

Facts about how the hosting is configured today, kept in one place because they
change independently of the process above. If a command below stops working,
suspect this section before suspecting the process.

- Vercel team scope: `harbor-lane`. It appears in every `--scope` flag; if it
  changed, the commands fail loudly, which is why it is safe to write down.
- Production domain: `galley.md`. `www.galley.md` 308-redirects to it.
- Auto-assignment of production domains is **off**. That is what makes a push to
  `main` stage rather than publish.
- Preview deployments are not behind authentication. Fork builds still require
  approval.

Anything in this section is a snapshot. The tool is the source of truth —
`vercel project ls` and the project's settings page win over this list.

## Before any release

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm test
```

Same sequence CI runs. If it passes locally it should pass there, and if it
does not, that difference is itself worth understanding before shipping.
