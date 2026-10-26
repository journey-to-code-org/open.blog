# ADR 0162: Only the bound contributor who wrote a section may answer as its author

- Status: Accepted
- Date: 2026-10-26
- Decision issue: [#212](https://github.com/journey-to-code-org/open.blog/issues/212)
- Parent story: [#202](https://github.com/journey-to-code-org/open.blog/issues/202)
- Parent epic: [#16](https://github.com/journey-to-code-org/open.blog/issues/16)
- Builds on: [ADR 0006](0006-collaborator-identity-binding.md),
  [ADR 0014](0014-record-level-authorization-and-publish-gate.md),
  [ADR 0101](0101-one-registry-of-participation-kinds-enabled-per-site-and-post.md),
  [ADR 0103](0103-who-may-moderate-reader-participation.md),
  [ADR 0160](0160-an-attributed-section-is-an-ordinary-section-target-with-a-reserved-anchor-and-a-digest.md),
  [ADR 0161](0161-an-attributed-target-resolves-by-author-and-text-and-is-stale-rather-than-retargeted.md)

## Context

RD12's registry already says an author response is written by the site Admin, a coordinator or a
contributing author of the work. For a reader's note about one named author's section, "any author"
would let one co-author speak as another, and a contributor registry entry alone says who someone is
on the site, not that they wrote this section.

## Decision

- **One new action, `RespondAsAuthor`, in the existing collaboration authorization**, targeting a
  participant. Only the `contributor` role holds it, and only for the participant the requester's
  own binding names. The site owner, coordinator, editor and reader roles do not hold it, and a
  contributor registry key without a binding to that participant on this publication grants
  nothing: the account, the registry key and the participant must all still resolve (the existing
  check). Every refusal is the same `denied`, so nothing about another participant is learned.
- **Answering a Third Perspective about an attributed section requires all of**: the target is
  attributed (otherwise `not-attributed`, and RD12's generic author response applies unchanged,
  which is also what a whole-work or ordinary-heading perspective gets); the request's account
  equals the account the resolved actor is for (no pairing one account with another's actor); the
  grant above on the section's participant; the parent is a public Third Perspective of this very
  work; and the author is still confirmed (below). Then RD12's `ModerationPolicy::admit` applies as
  it does to every item: the answer is an ordinary `author-response`, always pending, under the
  kind's mode (hidden, locked and open behave as for every kind).
- **The author must still be the same person.** The section must still be published (a changed one
  is fine, and the page says it changed), and the name it is published under must equal the
  participant's current display name. A removed section, or a participant id that now belongs to
  someone published under another name, gives `author-unconfirmed`, so a re-invited person who
  inherits an id never answers for earlier prose.
- **Coordinators and the site Admin moderate, never impersonate.** They approve, reject and remove
  the response by RD12's table unchanged, but a coordinator or site owner who is not that section's
  contributor cannot write as the author, and the moderation token never can. A coordinator who is
  also that section's contributor can, through the contributor grant. A contributing author never
  moderates, so an author cannot approve their own answer.
- **Withdrawing is the same author check** (`authorize_author`), then RD12's `withdraw` as the
  submitter; an author removed from the publication cannot, and a coordinator removes instead.

## Consequences

Group works need no special case: each section has exactly one author, and the grant is per
participant. A perspective on the whole work stays answerable by any in-scope author, as RD12 says.
