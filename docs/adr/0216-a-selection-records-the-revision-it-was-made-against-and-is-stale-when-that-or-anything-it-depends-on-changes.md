# ADR 0216: A selection records the revision it was made against and is stale when that, or anything it depends on, changes

- Status: Accepted
- Date: 2026-10-26
- Decision issue: [#192](https://github.com/journey-to-code-org/open.blog/issues/192)
- Parent story: [#190](https://github.com/journey-to-code-org/open.blog/issues/190)
- Parent epic: [#15](https://github.com/journey-to-code-org/open.blog/issues/15)
- Builds on: [ADR 0125](0125-one-publication-boundary-previewed-from-and-enforced-on-the-builds-own-projections.md), [ADR 0215](0215-curated-research-context-is-one-more-projection-that-selects-only-what-the-other-projections-publish.md)

## Context

Approval of a comparison already goes stale when a passage's locators move (ADR 0125). Curation
needs the same honesty for everything it selects: the author chose one version of an item.

## Decision

- **Identity.** A selection has a stable lowercase-slug `id` (derived as `<kind>-<target>` unless
  given), a `kind` and a `target`. The kinds keep the research model's distinctions apart:
  `reference` (a source's public description, never a citation), `contextual-entry`,
  `relationship`, `timeline` (one dating), `comparison`, `source-annotation` and `explanation`
  (the author's attributed words about a source or an entry).
- **Revision.** The `revision` is a 64-bit FNV-1a fingerprint, as 16 hex digits, of the selected
  public item and of every public dependency it brings (ADR 0218), recorded when the author
  selects. It covers the whole public item, not only the listed fields, so any change to what
  readers could be given makes the author look again. It is computed from the projections'
  public values, never from private notes.
- **Stale.** A live selection whose current revision differs is withheld as `stale-selection`,
  alone, with an item-scoped message and a `boundary:` warning. It is neither dropped nor
  updated: the old revision is never published. The author checks the item and chooses
  `reselect`, which records the revision as it now stands (the idiom of "Checked - approve
  again", ADR 0125). Nothing re-records a revision on its own.
- **Missing and unapproved.** A target that no longer exists is `missing-target`; one that
  exists but is not published is `not-approved`; when that cannot be told apart,
  `private-dependency`.
- **Withdraw and unselect.** Withdrawing keeps the record with an optional reason and publishes
  nothing (`withdrawn`); `reselect` makes it live again against the current revision. Unselecting
  removes the record. Neither touches the selected research.
