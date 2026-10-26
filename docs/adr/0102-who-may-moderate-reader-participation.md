# ADR 0102: The site Admin and in-scope coordinators moderate; contributing authors read and respond; readers act only on their own items

- Status: Accepted
- Date: 2026-10-26
- Decision issue: [#211](https://github.com/journey-to-code-org/open.blog/issues/211)
- Parent story: [#203](https://github.com/journey-to-code-org/open.blog/issues/203)
- Parent epic: [#16](https://github.com/journey-to-code-org/open.blog/issues/16)
- Builds on: [ADR 0006](0006-collaborator-identity-binding.md),
  [ADR 0014](0014-record-level-authorization-and-publish-gate.md),
  [ADR 0101](0101-one-moderation-state-machine-where-everything-starts-pending.md)

## Context

Today one secret moderates hosted comments: the Admin's `OPENBLOG_ADMIN_API_KEY`. Collaborative
works add publication coordinators and contributing authors bound to a shared publication by its
authorization policy (ADR 0006), and #203 asks that role checks distinguish the site Admin, a
publication coordinator and a contributing author. Readers have no accounts, yet RD10 and RD14
need a reader to answer a clarification or withdraw their own submission.

## Decision

- **Actors** (`openblog_core::moderation::Actor`) are established by the server, never claimed by
  a request:
  - *Public*: anyone using the public submission path.
  - *Submitter*: the item's own submitter, proven by the server (a reader's private receipt, which
    a transport adds with #226, or the author's session for an author response).
  - *Site Admin*: an Admin session or the hosted moderation token.
  - *Coordinator*: an Admin account bound as coordinator in a shared publication's authorization
    policy, for that publication's works.
  - *Contributing author*: an Admin account bound as contributor there, for those works.
  - *System*: the retention job.

  Site owners in a publication policy act as the site Admin. Editors and the publication
  `reader` role get nothing here. A coordinator or contributing author whose binding is removed has
  no works, so every grant lapses with it; an item without a work is the site Admin's alone.
- **The grant list is complete; every other combination is denied:**

  | Action | Site Admin | Coordinator (in scope) | Contributing author | Submitter | System | Public |
  | --- | --- | --- | --- | --- | --- | --- |
  | approve, reject, request clarification, remove, uphold report | yes | yes | no | no | no | no |
  | reopen | yes | no | no | no | no | no |
  | clarify, withdraw | no | no | no | yes | no | no |
  | expire | no | no | no | no | yes | no |
  | create a reader kind's item | no (uses the public path) | no | no | no | no | yes |
  | create an author response | yes | yes | yes (in scope) | no | no | no |

  Reopening undoes a moderator's decision, so it stays with the site Admin. Upholding a report also
  needs the grant to remove the reported item (ADR 0103).
- **Viewing** (`moderation::may_view`): the text and details of an item that is not public are
  visible to the site Admin, in-scope coordinators, in-scope contributing authors (except abuse
  reports, which may name or accuse others) and the submitter. A reader's private identity (a name
  they did not agree to publish, any contact detail a later kind adds) is visible only to the site
  Admin and the submitter. Everyone else, including coordinators and authors out of scope, sees
  only what `is_public` allows. Purged text is visible to nobody.
- **Decisions are not authorship or approval of prose.** Approving a Third Perspective or a
  question publishes the reader's words as the reader's, never as an author's contribution, and
  creates no Work credit (ADR 0006). An author response is the author's own words, and it still
  starts pending.
- **Every check is server-side and first.** The grant is checked before the version, the state
  or anything else, so an unauthorized request returns `denied` whatever the item looks like.

## Considered options

- **Let contributing authors approve items about their own work.** Rejected for now: on a shared
  work one author would decide what readers see about another's section. Coordinators and the
  site Admin, who already arrange the publication, moderate; authors respond.
- **Let coordinators reopen.** Rejected: reversing a decision that may have followed a report is
  the site Admin's call.

## Consequences

- The inbox (#225) builds the actor from the session and the stored authorization policies, never
  from the request, and filters each list through `may_view`.
- A reader receipt (#226) is the only way a reader becomes a submitter; without it a reader can
  submit but cannot clarify or withdraw, and the copy fallback still lets them ask the author.
