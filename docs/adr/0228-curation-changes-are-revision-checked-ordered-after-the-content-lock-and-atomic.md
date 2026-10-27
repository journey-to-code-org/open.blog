# ADR 0228: Curation changes are revision-checked, ordered after the content lock and atomic

- Status: Accepted
- Date: 2026-10-26
- Decision issue: [#196](https://github.com/journey-to-code-org/open.blog/issues/196)
- Parent story: [#190](https://github.com/journey-to-code-org/open.blog/issues/190)
- Parent epic: [#15](https://github.com/journey-to-code-org/open.blog/issues/15)
- Builds on: [ADR 0215](0215-curated-research-context-is-one-more-projection-that-selects-only-what-the-other-projections-publish.md), [ADR 0216](0216-a-selection-records-the-revision-it-was-made-against-and-is-stale-when-that-or-anything-it-depends-on-changes.md), [ADR 0089](0089-alignments-take-their-lock-after-claims-and-guard-what-they-use.md)

## Context

Authors select, select again, withdraw, scope, order and unselect research context while they
write. These are writes to a private research file from a UI, so they follow the rules every
research store already follows: authorization, a revision against lost updates, one lock order and
a write that cannot half-happen.

## Decision

- **Routes.** `GET research/curation[?post=slug]` reads the author's view; `POST`, `PUT` and
  `DELETE research/curation/selections` select, change (`reselect`, `withdraw`, `scope`) and
  unselect; `PUT research/curation/order` orders a post's selections. They sit behind the
  session, the CSRF token for every change and the deny-by-default router, so any other method or
  path under the prefix is a `404`. A body is JSON of at most 64 KiB; a selection with an unknown
  field is refused.
- **Stale-write protection.** Every change names the SHA-256 revision of the selections file it
  was based on. A different current revision is a `409` carrying the latest revision that changes
  nothing, and the page reloads. A damaged file is a `422` that names the file and is never
  replaced.
- **Lock order.** A change takes the content lock first (the build mutex and the content
  transaction), loads the saved site as a build does, then the atlas, alignments, notebook,
  library and selections locks in that order (ADR 0215), reads the stores and resolves
  against them under those locks, and writes. While nothing is stored the change is first tried
  without the locks, so a refused change creates no directory. A lock another writer holds is a
  `500` that changes nothing, after the usual wait.
- **Atomic with rollback.** The file is written to a temporary file beside it, flushed, and
  renamed over it; a failed write removes the temporary file and leaves the stored file byte for
  byte. Orderings are all or nothing. No route writes the research a selection points at, and
  none approves anything.
- **Nothing is public by these routes.** They only edit private choices. The text an author
  writes for a comment is guarded like every private store until a projection allows it.
