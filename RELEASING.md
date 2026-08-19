# Releasing

Maintainer notes. Contributors want [CONTRIBUTING.md](CONTRIBUTING.md) instead.

This repository ships four things that move at different speeds, and most of
the process below exists to keep them from being confused with each other.

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

## The web lab, and why nothing auto-publishes

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
live domain. Preview deployments are currently behind team SSO, which outside
contributors cannot pass — loosen that on this project before inviting
contributions, or people cannot see their own work.

## The Obsidian plugin

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

## npm packages

Nothing is published yet; every package is `"private": true`.

When that changes: drop `private`, add `"publishConfig": {"access": "public"}`,
and publish from a clean `main` with tests green. `core` is the only package
with a reason to be published on its own — the adapters are applications, and
`codemirror` exists to be shared between them.

Version the packages independently of the spec. A package at 0.3.0 implementing
spec version 1 is normal and should stay possible.

## The spec

`SPEC.md` carries its own version, independent of every package.

A change is **breaking** if a conforming document would parse differently or
fail to parse; that requires a major spec version and a much higher bar than
code. Adding an optional field, a response status, or a patch type is not
breaking.

Two couplings are enforced by tests rather than discipline, and both will fail
CI if you edit one side only:

- `SPEC.md` §13's examples must match the fixtures in `conformance/`
- `prompts/review-request.md` must match `AI_REVIEW_PREAMBLE` in `core`, and
  must not teach a response status the spec does not define

That is deliberate. It means the spec cannot quietly drift from what the code
does.

## Before any release

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm test
```

Same sequence CI runs. If it passes locally it should pass there, and if it
does not, that difference is itself worth understanding before shipping.
