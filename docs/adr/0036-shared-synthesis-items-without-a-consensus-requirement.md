# ADR 0036: Shared synthesis items without a consensus requirement

- Status: Accepted
- Date: 2026-10-25
- Decision issue: [#178](https://github.com/journey-to-code-org/open.blog/issues/178)
- Parent story: [#150](https://github.com/journey-to-code-org/open.blog/issues/150)
- Parent epic: [#143](https://github.com/journey-to-code-org/open.blog/issues/143)

## Context

Separate drafts (ADR 0016) and a combined piece (ADR 0021) say nothing about what the authors
conclude together. A synthesis must not force agreement: people who read the same source can differ,
and a model that rejected that would push them to hide it.

## Decision

- A synthesis is a `SynthesisSet` of items, each with a kind (agreement, difference, question,
  application, uncertainty), untrusted Markdown, and an ordered list of the authors it speaks for.
  There is no required kind, no minimum count, and an empty set is valid and complete.
- An item speaks for one, some or all authors of the publication's single author set (ADR 0018).
  Groups may overlap and the model never compares items, so disagreement, contradictory text and
  duplicate text are data, never a validation error. Only structural limits fail: attribution to a
  non-author, a duplicate attribution, empty or oversized Markdown, control characters, more than
  100 items.
- Attribution is a claim made by an author, so it is consented to after the fact and individually:
  an edit can only add names, never remove another author, and each author takes only their own name
  off an item (withdrawal). An item nobody speaks for is dropped. Only authors an item speaks for
  can edit or withdraw it; reordering is open to any author. A removed author's attribution is
  dropped by `reconcile`, and restoring them does not bring it back.
- Every change names the set revision the caller read; a mismatch is `Stale` and changes nothing
  (concurrent state). Every other refusal about an item the requester cannot touch, and every
  refusal for a non-author including reading, is the same `Denied`, so no one learns another
  participant's items or whether an id exists.
- Approval binding: `binding_frame` returns prose-free digests (never Markdown, URLs or names) of
  each item's id, kind, text and attribution in order. The caller appends it to the approval
  subject's metadata (ADR 0020), so any edit, reorder, withdrawal or attribution change invalidates
  every approval, and an empty synthesis binds exactly as a piece without one.
- The set is private collaboration state holding prose. This task adds core types only: no route,
  storage, panel or publishing of synthesis exists yet, so canonical content and public output are
  unchanged. Later tasks store it privately, route it through `SharedPublication::authorize`,
  render it through the ordinary post pipeline, and call `reconcile` with author-set changes.

## Consequences

- Reader comments and automated summaries stay out of scope. The Markdown is rendered only by
  sanitizing renderers added later; the model treats it as text.
