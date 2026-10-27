# ADR 0403: A removed or deleted submission takes its continuations off every page and out of the file

- Status: Accepted
- Date: 2026-10-27
- Decision issue: [#215](https://github.com/journey-to-code-org/open.blog/issues/215)
- Parent story: [#206](https://github.com/journey-to-code-org/open.blog/issues/206)
- Parent epic: [#16](https://github.com/journey-to-code-org/open.blog/issues/16)
- Builds on: ADR 0400, ADR 0401

## Context

Readers may withdraw a submission and moderators may remove one. The earlier question must not linger as a link.

## Decision

- `resolve` shows an edge only while the origin is `Approved` and both pages are published. Any other standing, including unknown because no hosted service answered, hides it with no placeholder, so a static build without the service shows nothing it cannot confirm. A removed submission therefore disappears from both ends at the next build.
- `ContinuationsFile::forget_origin` drops every edge of a deleted, withdrawn or removed submission for good; Admin calls it with the same action that removes the submission (#231). Nothing of the submission ever lived in the file, so no text needs scrubbing.
