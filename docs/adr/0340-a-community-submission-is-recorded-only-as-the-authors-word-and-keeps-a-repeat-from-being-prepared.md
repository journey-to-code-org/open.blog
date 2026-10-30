# ADR 0340: A community submission is recorded only as the author's word, and keeps a repeat from being prepared

- Status: Accepted
- Date: 2026-10-29
- Parent epic: [#384](https://github.com/journey-to-code-org/open.blog/issues/384)
- Story: #395 (task DIST4.1.3)

## Context

The story asks to "track author-confirmed submissions without pretending API success", and the epic to avoid spam
and repeat submissions. open.blog cannot know whether the author pressed submit on Hacker News or Reddit: it never
submits, and reading the providers back would need an API it does not use (ADRs 0337 to 0339). Distribution
reporting (epic #388) will later need to tell provider-verified facts from facts nobody checked.

## Decision

- **`openblog submit <slug> --confirm <destination> [--permalink <address>]`** records that the author submitted the
  post there by hand. It is the only way a submission enters the record. `--title` records the title used, when it
  was not the post's.
- **The record says whose word it is.** Each entry has `status: "author-confirmed"` and `evidence: "author"`, both
  closed lists with one value in this release, plus the canonical address, the title, the optional permalink, the
  time (`confirmedAt`, `confirmedAtUnix`) and the manifest policy version. There is no "posted", "live" or
  "succeeded" state, and the command and `--list` say "your word; open.blog did not check".
- **A permalink is checked for shape only.** Hacker News: `https://news.ycombinator.com/item?id=<digits>`. Reddit:
  `https://{www,old,new,}.reddit.com/r/<the same community>/comments/<id>/…`, stored as
  `https://www.reddit.com/r/<community>/comments/<id>/`. Anything else, including `http`, credentials, another host
  or another community, is refused. open.blog never opens it.
- **Private and local.** The record is `community.stateFile` (default `.openblog/community-submissions.json`, a
  project-relative path without `..`), next to the cross-posting state. It is read strictly (unknown fields, another
  `recordsVersion`, a destination key not in its canonical spelling, or more than 1 MiB refuse it whole) and never
  reaches a build, feed or export.
- **Repeats are not prepared.** A confirmation counts for the post's source identity and for any other source with the
  same canonical address. Reddit: a confirmed community is blocked (`already-submitted`) for good. Hacker News, after
  the FAQ's "last year or so": within 365 days it is blocked (`already-submitted`); later it is blocked
  (`submitted-before`) until the author adds `--again`, and then the kit says it is a repost. A second confirmation
  of one destination also needs `--again`, so a mistaken double record is not silent.
- **`--list`** prints what the author confirmed for the post. `--to`, `--confirm` and `--list` each run alone.

## Considered options

- **Mark a submission as posted when the author opens the submit link.** Rejected: opening the form is not
  submitting, and the page has no script to see it.
- **Check the permalink by fetching it.** Rejected: open.blog would then contact the provider, and a page that loads
  does not prove the author's account submitted it; it stays the author's word.
- **An undo command.** Deferred: the record is a small private JSON file the author can edit; distribution reporting
  can add one with its own states.

## Consequences

- Distribution reporting can show these entries as author-reported, never as verified, from the `evidence` field.
- An author who submits without confirming gets no repeat guard; the kit's page and terminal output end with the
  confirm command to make that easy.
