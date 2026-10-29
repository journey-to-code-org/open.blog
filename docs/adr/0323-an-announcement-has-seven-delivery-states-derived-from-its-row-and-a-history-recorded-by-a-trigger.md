# ADR 0323: An announcement has seven delivery states derived from its row, and a history recorded by a trigger

- Status: Accepted
- Date: 2026-10-29
- Parent epic: [#353](https://github.com/journey-to-code-org/open.blog/issues/353)
- Story: #359 (task #376)

## Context

Story #359 asks for a status timeline an author can act on, in the words PENDING, PROCESSING, RETRYING,
PUBLISHED, FAILED, UNKNOWN and CANCELED. The queue stores six statuses (ADR 0308, 0316): `scheduled`, `claimed`,
`published`, `failed`, `unknown` and `canceled`. Two things were missing:

- `scheduled` covers both "never tried" and "waiting to be tried again after a try that certainly did not post",
  which an author waits for differently.
- There was no history. The attempts (ADR 0318) record each try, but not edits, reschedules or cancels, and settling
  an unknown outcome by hand overwrites the attempt's `unknown` with the final answer. A timeline rebuilt from the
  attempts is therefore incomplete, and calling it accurate would be false.

## Decision

- **Seven delivery states, derived, never stored as a second status.** `pending` is `scheduled` with no problem code
  (or `deferred`, a run that gave the attempt back unused); `retrying` is `scheduled` with any other problem code;
  `processing` is `claimed`; the other four are the stored status. The rule is written once in JavaScript
  (`netlify/lib/social-status.mjs`) and once in SQL (`openblog_social_delivery_state`), and a test pins them
  together. The stored status stays the only thing writers fence on, so no state can drift from the row.
- **What the author may do follows from the state** (`NEXT_STEPS`): pending and retrying can be edited or canceled,
  failed can be tried again, unknown can only be settled by a person, and processing, published and canceled offer
  nothing. The hosted routes enforce the same rules on their own (ADR 0309, 0318); the list is what the screen offers.
- **The history is recorded by a trigger**, in an opt-in file, `supabase/social-history.sql`. An `after insert or
  update` trigger on `openblog_social_posts` appends one row to `openblog_social_post_events` when the status, the
  time, the caption or the problem code changes (a version-only change records nothing). A trigger, not code in each
  route, because the history must be complete whoever writes: an Admin route through PostgREST, the claim and settle
  functions, or a person in the SQL editor. It runs as the caller (no `security definer`); the service role may only
  `select` and `insert` events, so history is append-only, and the public roles have no access. An event holds the
  status, the delivery state, the attempt number, a fixed short code (only for a state that is a problem) and times:
  never a caption, a token, a lease owner or provider text. Running the file writes one `baseline` event per existing
  announcement, so its history says plainly that nothing earlier was recorded.
- **Without the file, the history is rebuilt and says so.** The `announcements/attempts` route returns `delivery`,
  `timeline` and `timelineExact`. With the events table it serves the recorded events (`timelineExact: true`);
  without it (PostgREST answers 404 for an unknown table, and only that is read as "not installed") it rebuilds a
  timeline from the row and its attempts and returns `timelineExact: false`, which Admin shows as "rebuilt from the
  tries, so edits and checks made by hand may be missing". A storage failure is a fixed error, never a guess.
- **Admin rebuilds the timeline from known fields** (a time, a change, a state, an attempt number, a short code),
  dropping anything else, as it does for accounts (ADR 0301). The Social screen shows the delivery state as a word and
  a shape, says what happens next for the states that ask nothing of the author, and lists the history and the tries
  under one **History** disclosure, loaded when opened.

## Consequences

- Rollback: `supabase/social-history-rollback.sql` drops the trigger, its functions and the events table (export
  first if you want them); `social-rollback.sql` removes them before the tables. The queue keeps working without them.
- The history grows by a handful of rows per announcement. Retention (ADR 0324) removes a post's events with it.
- A row changed outside the trigger's columns (only the version) leaves no event; that is deliberate.
