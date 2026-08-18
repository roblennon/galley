# Security

## Reporting a vulnerability

Email **rob@roblennon.xyz**. Please do not open a public issue for a security
problem.

Include what you did, what happened, and what you expected. A reproducing
document or patch batch is worth more than a description of one.

Expect an acknowledgement within a few days. This is a small project, not a
funded security program, and there is no bounty — but reports are taken
seriously and credited unless you would rather not be.

## What counts

The core library parses untrusted text and applies untrusted patch batches to
documents. That is the interesting attack surface. Things worth reporting:

- Input that makes `parse` or `applyBatch` hang, exhaust memory, or crash.
- A patch batch that changes text outside the region it declared, or that
  silently destroys a comment the spec says must survive.
- Anything that makes an adapter write to a file the user did not choose.
- In the browser lab, anything that sends document content off the device.
  Documents are meant to stay local; the hosting origin serves static assets
  and nothing else.

## What does not

Annotated Markdown is untrusted text by design. A document containing malformed
or hostile-looking annotation syntax is expected — the spec's error handling
(§11) covers it, and `validate()` is there to report it. If the library
correctly refuses bad input, that is the library working.

Rendering annotated Markdown as HTML is the embedding application's
responsibility. This project produces text, not markup.
