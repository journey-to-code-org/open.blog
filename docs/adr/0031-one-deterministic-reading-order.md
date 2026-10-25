# ADR 0031: One deterministic reading order serves every layout

- Status: Accepted
- Date: 2026-10-25
- Decision issue: [#170](https://github.com/journey-to-code-org/open.blog/issues/170)
- Parent story: [#148](https://github.com/journey-to-code-org/open.blog/issues/148)

## Decision

- The linear order is rounds in order, then turns in order. It is the same for every layout, for a
  reader without CSS or JavaScript, and for the portable equivalent
  ([ADR 0004](0004-portable-projections-from-canonical-work.md)). A layout may arrange it visually
  but never reorders it.
- A round's prompt belongs to its first entry, so it is read once, before the answers.
- A turn whose contribution has no text keeps its place and is flagged `empty`; the order never
  shifts when someone has not written. A participant with no turn simply has no entry. Unequal turn
  counts are normal.
- If any turn names a contribution the contract lacks, `reading_order` returns an error and no
  entries, so a stale structure cannot show part of a reflection or reveal which id was missing.
- Choosing a layout is a presentation change that does not alter the approved prose. Whether it is
  part of what an author approves is left to the Post pipeline task: today the published Post
  ([ADR 0023](0023-shared-reflections-publish-through-the-ordinary-post-pipeline.md)) remains
  sections in participant order, and nothing here changes it.

## Reversibility

This adds an unused pure module and tests; it persists nothing and publishes nothing, so it is fully
reversible.
