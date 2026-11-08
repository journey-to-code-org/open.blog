# ADR 0362: A ping is queued only for a live, published post, and each outcome is recorded in a private queue that retries with back-off

- Status: Accepted
- Date: 2026-10-29
- Parent epic: [#387](https://github.com/journey-to-code-org/open.blog/issues/387)
- Story: #401 (task DIST7.1.2)

## Context

ADR 0361 decides how one Webmention is discovered and sent. This one decides when one is sent at all, what is kept
afterwards and what a failure does next. The specification asks a sender to re-send previously sent Webmentions when
the source changes, including to links that were removed (section 3.1.4), and a receiver treats a repeated Webmention
as an update. So unlike a social announcement (ADR 0318), a repeat is harmless and an unknown outcome can be retried.

## Decision

- **Only when appropriate.** Only production-visible posts (published and due; a draft or a scheduled post is refused
  as `openblog syndicate` refuses it), only with an `https` canonical address that is not a placeholder (the
  cross-posting rule), and only after a preflight: the canonical address itself answers 2xx and declares itself in
  `<link rel="canonical">` (the check cross-posting uses, now shared as `syndication::declares_canonical`). A post that
  fails it gets nothing sent and nothing recorded, and the command exits non-zero so CI notices. The preflight runs
  only when the post has a ping due.
- **The queue** is a private JSON file, `webmention.stateFile` (default `.openblog/webmentions.json`, project-relative
  without `..`; `.openblog/` is ignored by Git). Format version 1, closed: an unknown version or field is refused,
  never guessed. Per canonical address and target it keeps the post revision (the cross-posting revision: title,
  subtitle, portable Markdown and canonical address), whether that revision links the target, the status, attempts,
  the endpoint, the HTTP status, a 201 status URL, a fixed error code, the attempt time and the next attempt time.
  Never a response body, never a credential.
- **The plan** for each target (`webmention::plan`): a new link is sent; a link whose post revision changed is sent
  again; a link that was told and is no longer in a changed post is told once more (so the receiver can update or
  remove the mention); a retry is sent when its time has come and waits before; anything else (already sent, or an
  outcome a retry would not change) is skipped until the post changes.
- **Outcomes** (`webmention::record_attempt`): any 2xx is `sent`; no advertised endpoint is `no-endpoint`; 408, 425,
  429 and 5xx from the target or the endpoint, and no answer at all (timeout, refused connection, unreadable reply),
  are `retrying` after 10 minutes, 1 hour, 6 hours and 24 hours, then `failed` after five attempts; any other 4xx, a
  3xx from the endpoint (not followed) or a bad redirect is `rejected`; a non-public address is `blocked`. The queue is
  saved after every ping, so an interrupted run never repeats one that went through.
- **Reporting.** The text report and `--json` (dry run only) list every planned action with its reason code, the links
  that are not targets and why, and each outcome with its HTTP status and error code.

## Consequences

- There is no daemon: retries happen the next time the author or CI runs `openblog webmention --write`. Running it
  after every deploy is the documented pattern.
- Two runs at the same time on the same project can overwrite each other's record of a ping; the worst case is one
  harmless repeated Webmention.
- A deleted post is not handled here; section 3.1.5 (410 Gone and re-sending) needs the site to serve a tombstone,
  which open.blog does not do yet.
