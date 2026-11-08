# ADR 0365: Received mentions wait in a private inbox for a moderator who approves a revision, and a source proves only its host

- Status: Accepted
- Date: 2026-10-29
- Parent epic: [#387](https://github.com/journey-to-code-org/open.blog/issues/387)
- Story: #402 (task DIST7.2.2)

## Context

Anyone can send a Webmention naming any page as its source, and the page can say anything about itself: a title, an
author's name, a photo, a date. The Recommendation (section 4) leaves moderation to the receiver and only asks that
what is shown be encoded or filtered. The participation policy (ADRs 0101 to 0108) already holds that what others send
starts pending, that only what is approved at its current revision is public, that a rejection or removal names a
reason code, and that what is not published is purged by a confirmed run. A Webmention's sender is a website, not a
reader with a receipt, and verifying one needs the command-line fetcher (ADR 0364), so it does not fit the hosted
moderation inbox, which moderates rows the hosted function stored and reads.

## Decision

- **A private inbox.** Pulled mentions live in `webmention.receive.inboxFile` (default
  `.openblog/webmention-inbox.json`, project-relative, never `..`), a versioned file read strictly and never published.
  Each mention has a stable id (`m-` and 16 hex digits of a BLAKE2s digest of source and target), the post's source
  path, a state, a reason, the claims, a revision, the revision a moderator approved, and when it was received,
  verified and decided.
- **States.** `pending`, `approved`, `rejected`, `removed`, `blocked`. Every new mention is pending; only `approved`
  at the revision it holds now is public. `openblog mentions approve <id> --revision <n>` names the revision the
  moderator read in `openblog mentions list`, so a mention whose claims changed since is never approved unseen.
  `reject` (pending) and `remove` (approved) take a reason: `spam`, `abusive`, `off-topic`, `duplicate`,
  `personal-data` or `other`. A rejected mention can still be approved by a moderator who changes their mind.
- **Repeats are idempotent.** The same source and target always land on the same mention. A repeat with the same
  claims changes nothing; changed claims raise the revision and send an approved mention back to pending, so a page
  that was approved cannot swap in other text unseen. A rejection stands however often the source asks again. A
  source that took its link back and then links again starts over as pending.
- **Anti-spam limits at both ends.** The hosted store refuses a new pair with `429` when its source host already has
  20 requests waiting or the site has 1000, counted under a per-site lock, and a repeat within a minute changes
  nothing. The inbox drops a new mention when its host already has 20 pending or the inbox holds 5000. Every
  published link is `rel="nofollow ugc"`, so a mention lends the other site no search standing, which removes the
  usual reason to spam.
- **Blocking.** `openblog mentions block <host>` covers the host and its subdomains: every mention from it is blocked
  at once, published ones included, and its claimed text is deleted; its later requests are settled without being
  fetched, so a blocked site learns nothing from this one. The block list is in the private inbox, never in
  `openblog.json` or a page, because whom an author blocks is moderation data. `unblock` lifts it; blocked mentions
  return only when their source sends them again, as pending. The hosted function can also refuse hosts before
  storing anything (`OPENBLOG_WEBMENTION_BLOCKED_HOSTS`), answering them exactly as it answers anyone.
- **Source identity limitations.** The only thing verified about a sender is that a page at the source address, on
  that host, linked the post when it was fetched. The title, author name and date are the page's claims: kept as plain
  text from text nodes only (an `h-entry`'s `p-name`, `p-author` and `dt-published`, else the page's `<title>`), with
  control and bidirectional formatting characters removed, whitespace collapsed, at most 200 and 100 characters, and a
  date only when it is a real day. No avatar, photo, content excerpt or `h-card` URL is kept. The list prints claims
  as escaped strings, so a claim cannot drive the terminal, and the page says "as the page says".

## Consequences

- Nothing a stranger sends reaches a page without a person's decision at that revision, and a blocked site
  disappears in one command.
- Moderation is a command-line task, beside `openblog webmention`; the Admin moderation inbox does not list
  Webmentions yet.
- A site can still misstate its author or title; the page shows these as claims next to the host, the one fact
  checked.
