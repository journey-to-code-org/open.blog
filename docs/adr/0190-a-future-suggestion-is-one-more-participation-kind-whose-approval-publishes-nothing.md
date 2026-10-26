# ADR 0190: A future suggestion is one more participation kind whose approval admits it to the editors' queue and publishes nothing

- Status: Accepted
- Date: 2026-10-26
- Decision issue: [#213](https://github.com/journey-to-code-org/open.blog/issues/213)
- Parent story: [#204](https://github.com/journey-to-code-org/open.blog/issues/204)
- Parent epic: [#16](https://github.com/journey-to-code-org/open.blog/issues/16)
- Builds on: [ADR 0101](0101-one-registry-of-participation-kinds-enabled-per-site-and-post.md), [ADR 0102](0102-one-moderation-state-machine-where-everything-starts-pending.md), [ADR 0103](0103-who-may-moderate-reader-participation.md), [ADR 0104](0104-retention-audit-events-and-abuse-reports-fail-closed.md), [ADR 0107](0107-reader-receipts-deletion-requests-and-anonymous-abuse-reports.md)

## Context

RD13 lets a reader send the editors a question, text, video or other source for possible future
work. RD12 made one registry of participation kinds and one moderation state machine, and every
kind in it is either published after approval (comments, reflections, answers) or never public
(abuse reports, whose approval means "upheld"). A suggestion is neither: it is meant for the
editors, so approval cannot mean "show it", and it is useful for far longer than a rejected item
is kept.

## Decision

- **One new kind, `future-suggestion`, in the existing registry**, not a parallel system. It is
  created by any reader without an account, targets the page it was sent from, may be asked to
  clarify (with the reader's consent) and gets a private receipt, so every mode, quota, state,
  role grant, reason, audit event and deletion rule of the one policy applies unchanged. It
  starts `off` for every site and a post cannot turn it on.
- **It is not publishable.** `is_public` is false for it in every state and mode, so no feed,
  page, export or count can show one, whatever a later projection forgets to check.
- **A new fixed rule, `editorial`, says what approval means for such a kind.** Approving admits the
  suggestion to the editors' private queue; it stays kept while approved (retention does not purge
  it on the closed-item clock the way an upheld abuse report is purged), and an editor closes it
  with the same `remove` an approved public item has, with a decline reason, after which the
  ordinary closed-item retention applies. The reader may still withdraw it or ask for deletion.
- **Approval is the site Admin's or a coordinator's**, as everywhere (the one grant list). A
  contributing author, the public and the retention job never decide.
- **The setting is inert until the submission route exists.** Naming `future-suggestion` in
  `participation.kinds` before RD13.2 ([#227](https://github.com/journey-to-code-org/open.blog/issues/227))
  adds the form and the hosted route changes no page; the moderation inbox does not yet hold the
  kind, so nothing can be stored or listed.

## Consequences

- The transition, protection and matrix fixtures gain rows for the kind; the hosted function's
  mirror (`netlify/lib/participation-moderation.mjs`) is checked against them case by case.
- A kind that is neither public nor an abuse report is now possible, so code must ask the rules
  (`publishable`, `editorial`), never compare kinds, which the policy already did for abuse
  reports only.
