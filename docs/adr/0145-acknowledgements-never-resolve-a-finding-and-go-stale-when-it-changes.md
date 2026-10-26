# ADR 0145: Acknowledgements never resolve a finding and go stale when it changes

- Status: Accepted
- Date: 2026-10-26
- Decision issue: [#191](https://github.com/journey-to-code-org/open.blog/issues/191)
- Parent story: [#189](https://github.com/journey-to-code-org/open.blog/issues/189)
- Parent epic: [#15](https://github.com/journey-to-code-org/open.blog/issues/15)
- Builds on: [ADR 0074](0074-evidence-gaps-are-prompts-in-the-shared-finding-contract.md),
  [ADR 0144](0144-one-research-completeness-contract-with-one-owner-per-check.md)
- Coordinates with: [#62](https://github.com/journey-to-code-org/open.blog/issues/62),
  [#194](https://github.com/journey-to-code-org/open.blog/issues/194)

## Context

Some prompts are legitimately permanent: a whole-work source needs no locator, and a doubt with
no source behind it stays a doubt (ADR 0074). RW9 lets an author acknowledge a subjective review
without turning it into an automated pass, and requires that acknowledgement never relabels a
finding resolved. An acknowledgement must also stop applying when the thing acknowledged
changes, for example when another located citation appears or a dating's stated value is
edited, or an author could acknowledge once and never see a new problem under the same name.

## Decision

- **What an acknowledgement is.** An `Acknowledgement` records the finding's validator, code,
  object kind, file (`path`), id and field (its key) and the finding's `fingerprint` when it was
  acknowledged. The file is part of the key because a post-scoped finding names no id: without
  it, acknowledging `abstract-missing` on one post would mark another post's acknowledged.
  It holds no note, no person and no time, so it has nothing private to leak. Its JSON refuses
  unknown fields, so a stored record cannot claim more (there is no `resolved`).
- **The fingerprint.** A 128-bit BLAKE2s digest, as 32 hexadecimal characters, of the key, the
  related objects and the message. Lines, columns and indexes are left out because they move
  with unrelated edits. Messages name ids, counts and stated values, so the fingerprint changes
  exactly when what the finding says about its object changes.
- **Only advisory findings can be acknowledged.** `Acknowledgement::of` returns nothing for a
  finding whose gate refuses something: integrity and privacy failures are fixed, never
  acknowledged. A stored acknowledgement that names one is not applied.
- **Matching in a report.** `CompletenessReport::new` marks an advisory finding `current` when
  an acknowledgement has its key and fingerprint, and `stale` when an acknowledgement has its key
  but a fingerprint that fits no finding now in the report under that key. An acknowledgement
  of one of two findings that share a key (two undefined footnotes in one post) leaves the other
  unacknowledged, not stale.
- **Never resolved.** An acknowledged finding is still listed, still has its outcome and is still
  counted in `found`; `acknowledged` counts the current acknowledgements of each outcome
  separately. A stale acknowledgement counts for nothing. A finding disappears only when its
  validator no longer reports it, because the record now holds what was missing.
  Acknowledgements that match no advisory finding are counted as `unmatchedAcknowledgements`, so
  a store can tidy them up; they are never shown as resolutions.
- **The report is versioned.** `CompletenessReport` serializes as `version` 1, `findings` (each
  finding with its `fingerprint` and any `acknowledgement`), `counts` (`detected`, `potential`,
  `needsReview`, each `found` and `acknowledged`) and `unmatchedAcknowledgements`. There is no
  total, score or readiness field.
- **Storage is #194's.** Where acknowledgements are kept (a private file beside the research
  files, read through the existing authorization and CSRF seams) is decided with the report that
  shows them. Nothing here writes, and nothing stored can reach a public artifact.

## Consequences

- An author can set aside a prompt they have considered, and see it again as soon as it says
  something new.
- Acknowledging is reversible: removing the record restores the finding's unacknowledged state.
- Because the key leaves out positions, an acknowledgement survives edits elsewhere in a post,
  and because the fingerprint includes the message, it does not survive a change to the finding.

## Domain language

**Finding acknowledgement** and **Finding fingerprint** are defined in
[`CONTEXT.md`](../../CONTEXT.md).
