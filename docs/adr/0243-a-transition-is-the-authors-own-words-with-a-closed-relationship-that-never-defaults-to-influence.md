# ADR 0243: A transition is the author's own words with a closed relationship that never defaults to influence

- Status: Accepted
- Date: 2026-10-27
- Decision issue: [#76](https://github.com/journey-to-code-org/open.blog/issues/76)
- Parent story: [#28](https://github.com/journey-to-code-org/open.blog/issues/28)
- Parent epic: [#16](https://github.com/journey-to-code-org/open.blog/issues/16)
- Builds on: [ADR 0054](0054-attributed-evidence-based-relationships.md),
  [ADR 0170](0170-queries-are-exact-lookup-and-a-bounded-trail-that-infer-nothing.md)
- Contract: [Reading paths](../specs/reading-paths.md#transitions)

## Context

The story wants paths that "explain why each step follows without falsely asserting direct
influence", and #78 requires that a transition never imply a relationship stronger than the
author wrote. The atlas (ADR 0054) already refuses to infer influence from chronology and requires
evidence for it. A reading path is a looser editorial device, and the easiest way for it to
overclaim is a sequence read as "this led to that".

## Decision

- **Every step after the first has a transition, with the author's text.** `transition.why` is
  required, non-blank plain text of at most 600 characters. The first step has none, because there is
  nothing for it to follow, and a transition on it is refused. A published path with a missing
  transition is refused; a draft may be unfinished. The text is the author's alone: nothing
  generates, completes or rewords it, and AI output enters only as text the author accepts.
- **A closed relationship label with no default.** `transition.relationship` is required, and a
  missing one is refused rather than filled in. The values are `next`, `background`, `builds-on`,
  `contrasts-with`, `responds-to`, `applies` and `influenced`. Each reads as a sentence about this
  step and the one before it ("Builds on the previous step"), and `next` says in its words that no
  further relationship is claimed. It is the neutral choice, and the only one an author reaches for
  when the honest answer is "it simply comes next".
- **Influence needs a published relationship.** `influenced` requires `basis`, the id of an
  approved Knowledge Atlas relationship of kind `influenced`, which already carries its asserter,
  evidence and uncertainty (ADR 0054). Resolution keeps the claim only if that relationship is
  published and, where the earlier or later step is an atlas entry, runs from the earlier entry to
  this one, the direction it was stated. Otherwise the transition is dropped and the author is told;
  it is never softened to another label, because that would be a claim the author did not
  make. Order, dates and a shared tag never suffice, and nothing infers a relationship.
- **A basis on any other label is shown only if it holds.** The same rule applies, but a failing
  basis is dropped alone and the author's label and words stand, with a diagnostic.
- **A transition is only about adjacent steps.** A transition does not relate a step to a later one,
  and when the step before it is not shown the transition is dropped (ADR 0244). No score,
  strength, "path shows" or transitive reading exists.
- **Not a claim of fact.** A path states what an author recommends reading and why. Surfaces say so
  in the author's voice; nothing here asserts truth, consensus or authority.

## Consequences

- #78 can print the relationship label and the author's sentence with no further wording of its own,
  and its Previous and Next never say more than the label does.
- An author who wants to say "this shaped that" must cite a published relationship, which keeps the
  atlas the one place influence is evidenced.
- A closed list means a new label needs a version bump, which is the point.

## Domain language

**Path transition** is defined in [`CONTEXT.md`](../../CONTEXT.md).
