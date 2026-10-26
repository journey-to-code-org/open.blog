# ADR 0166: An author response is one more row of the existing feedback table, stored through one Admin route behind one flag

- Status: Accepted
- Date: 2026-10-26
- Decision issue: [#223](https://github.com/journey-to-code-org/open.blog/issues/223)
- Parent story: [#202](https://github.com/journey-to-code-org/open.blog/issues/202)
- Parent epic: [#16](https://github.com/journey-to-code-org/open.blog/issues/16)
- Builds on: [ADR 0081](0081-hosted-feedback-transport-is-opt-in-and-reuses-the-engagement-seam.md),
  [ADR 0102](0102-one-moderation-state-machine-where-everything-starts-pending.md),
  [ADR 0113](0113-third-perspectives-are-one-feedback-row-submitted-through-the-one-route-with-a-receipt.md),
  [ADR 0162](0162-only-the-bound-contributor-who-wrote-a-section-may-answer-as-its-author.md),
  [ADR 0164](0164-attributed-perspectives-store-the-responder-publish-nothing-by-themselves-and-leave-static-reading-whole.md)

## Context

ADR 0164 requires an answer to store who answered. Hosted storage is a one-way door, so this
decision takes the smallest reversible route: reuse what exists, add nothing to the database, and
make the whole feature opt-in.

## Decision

- **No hosted schema change, so no rollback file.** An answer is one `openblog_feedback` row of
  kind `author-response` (the column only checks the kind's shape). `work`, `revision` and `target`
  are the parent's own, read from the parent's row and never from the request; `body` is the
  answer; `details` is `{parent, responder: {contributor, author, standing}, binding: {participant,
  account}}`; `status` is always `pending`; there is no receipt, no reader name and no consent.
  The public part of the responder is `responder` (the contributor handle, the name the section is
  published under, its standing: `{state: "current", moved}` or `{state: "stale", reason}`); the
  private part is `binding` (the participant and the Admin account), which no public view reads and
  the inbox shows to the site Admin only (the account) or never (the participant). The
  `supabase/` files are unchanged (a test holds that). To undo it, remove the flag below; rows stay
  private and pending or closed, and nothing was made public by this change.
- **One new flag, `OPENBLOG_AUTHOR_RESPONSES_ENABLED=true`, on top of Third Perspectives** (so on
  top of passage feedback, the inbox's schema and protection). Without it the new route answers
  `404 unavailable`, an answer is never approved (`422 notAllowed`), and the other decisions on
  existing answers (reject, remove, reopen) still work. The site must also set
  `participation.kinds."author-response"` to `open` for a work to take new answers; `locked` and
  `hidden` answer `403 closed` and `404 unavailable`.
- **One Admin-token route, `admin/author-response`.** `POST` stores an answer; `PATCH` withdraws
  one. Only Admin's token reaches it (a reader's origin is `401`/`403` before anything is read), and
  Admin sends it only after it has checked, against the private shared-publication record the
  function never holds, that the signed-in account may answer (ADR 0167). The function still reads
  the request strictly (`netlify/lib/author-response.mjs`, held to
  `tests/fixtures/author-responses.json` with `crates/openblog-core/src/author_response.rs`), and
  checks, in this order: the request's shape and bounds, the post's `author-response` mode, the
  parent row it reads itself (a Third Perspective of that work, shown now, about an attributed
  section of that very contributor, at the version Admin saw), that the reflection has no answer
  pending or approved already (`409 alreadyAnswered`), a quota of 20 answers an hour per account
  (`429 rateLimited`), and the same answer from the same place once an hour (`409 duplicate`, with
  the claim released if storing fails).
- **A parent that is not shown is `409 parentUnavailable`; one about another section or work is
  `422`** (`notAttributed`, `responderMismatch`, `wrongWork`); a changed parent is `409 conflict`.
  Nothing a refusal says repeats what anyone wrote.
- **B5's own route never decides an answer.** `/admin/feedback` answers `409 useModerationInbox`,
  as it does for a Third Perspective, so no decision skips the checks of ADR 0168.
- **Withdrawal keeps the row.** The author takes an answer back (`PATCH`, the account that wrote
  it, while pending or approved) through RD12's `withdraw` as the submitter, by the same moderation
  function as every other change; the text, responder and audit event stay until retention purges
  the text like any closed item, and it is never public again. This is the "edits and removals
  preserve provenance" rule: an answer is never edited in place (the author withdraws and writes
  another), and neither a coordinator's removal nor a withdrawal discards who wrote it before the
  retention period; the audit event (account, role, action, time) outlives the text.

## Considered options

- **A new table or columns for the parent and the responder.** Rejected: `details` holds them, the
  parent is looked up by `details->>parent` (small, filtered by kind and state), and a schema change
  is the one thing this feature can avoid.
- **Letting the function check the private record.** Rejected: the record is private and never
  leaves Admin's host (ADR 0007); a hosted function holding it would be a new place it could leak.

## Consequences

A site turns answers on with one variable and off by removing it. If the flag is turned off while
answers exist, they stay in the inbox and can be rejected or removed.
