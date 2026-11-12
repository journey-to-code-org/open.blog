# ADR 0403: Records for the same post and place are reconciled into one row, and an unknown never counts as reached

- Status: Accepted
- Date: 2026-11-11
- Parent epic: [#388](https://github.com/journey-to-code-org/open.blog/issues/388)
- Story: [#403](https://github.com/journey-to-code-org/open.blog/issues/403) (DIST8.1.2)
- Builds on: [ADR 0402](0402-every-adapters-record-is-read-into-one-redacted-outcome-per-post-and-destination-and-the-report-is-never-stored.md)

## Context

The same post can appear more than once for the same destination: a Pin attempted, refused and sent again, a
community link confirmed twice, a social announcement retried after an unknown. Records also name the same post
three ways (`posts/a.md`, `content/posts/a.md`, `source:content/posts/a.md`). Counting rows would count a post
twice, and counting an unknown as delivered would claim a post went somewhere it may not have.

## Decision

- **One key**: the source path reduced to the part every record agrees on (no `source:`, no content folder, forward
  slashes), the destination and the place.
- **One row per key.** Of several records, the newest settled outcome (`delivered`, `by-hand`, `not-delivered`)
  wins; an `unknown` never overrules a settled outcome; a settled outcome replaces an unknown even when the
  unknown has no time; otherwise the newest wins. Attempts are added up and the first attempt is the earliest.
- **Counts**: each row counts once. Only `delivered` and `by-hand` count as reached; `unknown` is its own count, so
  the report says how many need a person to check.
- **Settling stays where it was.** An unknown is settled with the adapter's own command (`openblog pinterest pin
  --reconcile`, `openblog video --settle`, **I posted it** in Admin's Share this job, or recording the outcome of an announcement
  that needs checking on the Announcements screen); the report shows the result the next time it is read.

## Consequences

The rules live in `openblog_core::outcome::reconcile` and Admin's `reconcileRows`, with the same tests.
