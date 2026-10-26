# ADR 0193: Attribution and contact are optional and consented, and contact is private to the site Admin and the submitter

- Status: Accepted
- Date: 2026-10-26
- Decision issue: [#213](https://github.com/journey-to-code-org/open.blog/issues/213)
- Parent story: [#204](https://github.com/journey-to-code-org/open.blog/issues/204)
- Parent epic: [#16](https://github.com/journey-to-code-org/open.blog/issues/16)
- Builds on: [ADR 0107](0107-reader-receipts-deletion-requests-and-anonymous-abuse-reports.md), [ADR 0103](0103-who-may-moderate-reader-participation.md), [ADR 0104](0104-retention-audit-events-and-abuse-reports-fail-closed.md)

## Context

An editor may want to credit an idea or ask about it, but a reader who sends a link has not agreed
to be emailed, listed or thanked in public.

## Decision

- **Display is anonymous by default.** A suggestion keeps the reader's name only if they gave one,
  and shows it publicly only if they also set `publishName`. A name needs no publication consent
  to be kept privately; `publishName` without a name is refused. `Suggestion::credit` returns only
  a consented name, and nothing in the system uses it: crediting a reader is the author's own
  later action.
- **Contact is optional and consented.** `contact` is `{address, followUp}`: one plain ASCII
  e-mail address (no display name, comment, quoting, list or whitespace, at most 254 bytes) and
  `followUp: true`, the reader's agreement to be contacted about this suggestion. An address
  without that agreement is refused, not dropped silently. Nothing but the reader's own word
  collects it; it is never required.
- **Contact is private.** It is shown only to those who may see a reader's private identity (the
  one `View::PrivateIdentity` rule: the site Admin and the submitter), never to a coordinator,
  contributing author or the public, and the same holds for an unpublished name. It is excluded
  from audit events, conversions, library candidates and `Debug` output (which prints
  `Contact(<private>)`), and is purged with the text on withdrawal, deletion and retention.
- **Nothing here sends a message.** open.blog never emails a suggester. If an editor decides to
  write to someone, that is outside the system, and it is the editor's to do with the address
  they are allowed to see.
