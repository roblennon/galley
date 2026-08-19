# Galley browser lab

A no-login, local-first browser experience for commenting on Markdown and
completing the Galley AI patch round trip. Document processing stays in the
browser; the hosting origin only serves the static application assets.

From the workspace root:

```sh
pnpm --filter @galley/web dev
pnpm --filter @galley/web... build
pnpm --filter @galley/web test
```

The dependency-inclusive build command is intentional: workspace dependencies
must be built before Vite creates the static bundle. Hosting uses the same command
from `vercel.json` and publishes `packages/web/dist`.

## Response headers

`vercel.json` sets a Content-Security-Policy that keeps this promise mechanical
rather than merely stated: `default-src 'self'` means the page cannot originate a
request to any other host, so a document opened here has nowhere to go. `style-src`
allows `'unsafe-inline'` because CodeMirror injects `<style>` elements at runtime;
scripts get no such exemption. `frame-ancestors 'none'` prevents the lab being
embedded by a site that could overlay it.

Changing these headers changes a security claim this project makes in SECURITY.md.
Treat them as behavior under test, not configuration.

## File behavior

- Chromium browsers can open a user-approved source handle and explicitly save
  back to it.
- Other current browsers import a file snapshot and download the changed copy.
- Browsers do not report whether a user later cancels a download; the UI therefore
  says “Download started” rather than claiming the copy was written.
- Recovery drafts live in browser-private IndexedDB. Separate tabs keep separate
  bounded draft records so one tab cannot silently replace another's recovery.
  When a session restores another session's draft it adopts the record under its
  own id and deletes the original, so a draft always has exactly one owner.
- A draft whose download was started is restored one more time (the save dialog
  may have been cancelled), labeled as already downloaded, then settles as
  current instead of being re-offered forever.
- When trimming stored drafts, clean records are evicted before dirty ones; a
  dirty draft is the user's only copy of unexported text.
- UTF-8 BOM and CRLF files round-trip; mixed line endings are normalized to LF
  with a visible warning.
