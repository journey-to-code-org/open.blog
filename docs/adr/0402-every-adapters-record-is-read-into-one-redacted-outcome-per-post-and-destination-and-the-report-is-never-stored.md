# ADR 0402: Every adapter's record is read into one redacted outcome per post and destination, and the report is never stored

- Status: Accepted
- Date: 2026-11-11
- Parent epic: [#388](https://github.com/journey-to-code-org/open.blog/issues/388)
- Story: [#403](https://github.com/journey-to-code-org/open.blog/issues/403) (DIST8.1.1, DIST8.1.3)
- Builds on: [ADR 0325](0325-a-provider-manifest-declares-per-destination-what-the-adapter-does-by-hand-or-not-at-all-at-a-dated-policy-version.md), [ADR 0340](0340-a-community-submission-is-recorded-only-as-the-authors-word-and-keeps-a-repeat-from-being-prepared.md), [ADR 0372](0372-a-pin-is-sent-only-as-previewed-to-a-board-the-token-can-use-after-the-author-confirms-its-digest.md), [ADR 0379](0379-an-approved-release-is-uploaded-private-through-a-recorded-resumable-session-and-youtube-not-open-blog-schedules-its-publication.md), [ADR 0393](0393-a-job-reaches-google-business-profile-from-the-cli-only-when-the-owner-turned-it-on-and-confirmed-its-digest.md)

## Context

Each way of sending a post keeps its own private record: cross-posting (`syndication.json`), Pinterest
(`pinterest.json`), community submissions (`community-submissions.json`), shared jobs (`job-shares.json`), YouTube
(the protected releases record) and social announcements (the hosted Supabase queue). Each has its own statuses,
its own remote ids and links and its own times. An author who wants to know where a post went has to read five
files and a queue, and nothing says which statuses the provider confirmed and which only the author said.

## Decision

- **One shape.** `openblog_core::outcome::Outcome` is a post's source path, a destination (a provider id from the
  manifests), an optional place (a cross-posting target name, a Reddit community, a Pinterest board, a social
  account), a status (`delivered`, `by-hand`, `draft`, `pending`, `unknown`, `not-delivered`), what that status
  rests on (`provider`, `author` or `none`), the remote id and permalink, the number of attempts and the first and
  last times.
- **One reader per record**, in `openblog-cli/src/outcomes.rs`, each knowing only its own format. A Pinterest Pin in
  the sandbox is a `draft` (only its creator can see it); an uploaded YouTube video is `draft` while private and
  `pending` when YouTube will publish it at a time; a job share kit is `pending`; a community submission is
  `by-hand` on the author's word; a cross-posting target no longer in the settings, a status the reader does not
  know and a destination outside the manifests are left out, never guessed at. The hosted queue can only be
  read by Admin's browser, so Admin normalizes announcements by the same rules (tested on both sides).
- **Redacted on the way out.** A problem is kept only as a short code (`[a-z0-9-]`, 40 characters), anything else
  becomes `other`, so provider text, tokens and response bodies never appear. A permalink is kept only as an
  `http(s)` address without credentials, query or fragment. A remote id must be plain characters. A time must be a
  real time.
- **Read, never stored.** `openblog outcomes [--json] [--days N]` and `GET /admin/api/distribution` work the
  report out from the records each time and write nothing; an unreadable record is named in the report and the
  others still report. Retention is the records' own: the report adds no file to keep or prune.
- **Only posts the site has.** A row whose post no longer exists is not reported.

## Consequences

A new adapter adds one reader and its tests. The records themselves are unchanged.
