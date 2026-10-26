# ADR 0194: Acceptance means editorial interest only, and nothing ranks or counts suggestions

- Status: Accepted
- Date: 2026-10-26
- Decision issue: [#213](https://github.com/journey-to-code-org/open.blog/issues/213)
- Parent story: [#204](https://github.com/journey-to-code-org/open.blog/issues/204)
- Parent epic: [#16](https://github.com/journey-to-code-org/open.blog/issues/16)
- Builds on: [ADR 0102](0102-one-moderation-state-machine-where-everything-starts-pending.md), [ADR 0116](0116-evidence-submissions-are-suggested-sources-and-corrections-with-unverified-reader-evidence.md)

## Context

The epic's acceptance criteria say accepting a suggestion must not claim endorsement or rights, and
the project forbids popularity-based truth signals.

## Decision

- **Acceptance is the one `approve` of the moderation policy**, with the meaning ADR 0190 gives
  it for this kind. Its words, in every editor screen and receipt, are `ACCEPTANCE_NOTICE`:
  "Accepted means the editors are interested in exploring this. It does not mean they agree with
  it, have checked it, or have permission to use it." No state, label or field says a suggestion is
  true, verified, endorsed, cleared or promised for publication.
- **Where it stands is derived, never stored**: `Standing` is computed from the moderation state
  and whether any conversion is recorded (received, waiting for the reader to say more, editors are
  interested, linked to future work, not taken forward, withdrawn). It adds no state to the one
  machine, and the labels name a stage, never a verdict.
- **Nothing counts or ranks.** No field, order, view or output carries a number of suggestions,
  votes or "most requested". `duplicate_groups` tells an editor which suggestions name the same
  source (an identifier decides first, then the link without its scheme, `www.`, fragment, trailing
  slash and tracking parameters) so they can be handled together; it returns lists of ids in a
  fixed order, never a count, and is private to editors.
- **A decline is a moderation decision with a reason** (`reject`, or `remove` once accepted), never
  published, and never a statement about the idea's merit.
