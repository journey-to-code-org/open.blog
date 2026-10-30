# ADR 0863: Received Webmentions are stored by a hosted receiver that never fetches, and verified by the command-line pull

- Status: Accepted
- Date: 2026-10-29
- Parent epic: [#387](https://github.com/journey-to-code-org/open.blog/issues/387)
- Story: #402 (task DIST7.2.1)

## Context

Story #402 wants other sites to be able to tell this one that they link a post, and the author to moderate what
arrives. The [W3C Webmention Recommendation](https://www.w3.org/TR/webmention/) (12 January 2017, checked
2026-10-29) sets the receiver's rules:

- 3.2: the receiver SHOULD check the request synchronously and then queue and process it asynchronously, answering
  `202 Accepted` (or `201` with a status URL, or `200` when it verified synchronously).
- 3.2.1: it MUST check that `source` and `target` are valid URLs of a supported scheme and MUST reject the request
  when they are the same; it SHOULD check that the target is a resource it accepts Webmentions for.
- 3.2.2: before using a Webmention it MUST GET the source, following redirects (it SHOULD limit them), and the source
  MUST contain an exact match of the target. A `410 Gone`, or a `200` without the link, SHOULD delete an existing
  Webmention; a repeat SHOULD update it, idempotently.
- 3.2.3: a sender's mistake is a `400 Bad Request`; the receiver's own failure SHOULD be a `500`.
- 4.1 and 4.2: verification SHOULD be asynchronous so the receiver cannot be used for denial of service; receivers
  SHOULD limit redirects, data and time when fetching an unverified source, and MUST encode or filter what they show.

A static site cannot take a POST, so a receiver needs a hosted function. The project already has them (Netlify
functions over Supabase, opt-in `supabase/*.sql` schemas, a key per function), and the outbound half (ADR 0860)
already has a public-only fetcher that checks every redirect hop and resolves names only to public addresses. A hosted
function that fetched the source would be a request-forgery proxy for anyone who can POST two addresses.

## Decision

- **The hosted receiver never fetches a source.** `netlify/functions/webmention.mjs` (`/api/webmention`) checks the
  request (3.2.1), stores the pair and answers `202`. It reads exactly one `source` and one `target` from an
  `application/x-www-form-urlencoded` body of at most 8 KiB: both `http(s)`, at most 2048 bytes, no user name or
  password, different once the fragment is removed, the target on `OPENBLOG_SITE_ORIGIN` and the source not. Each
  refusal is a `400` with a fixed code and message that never repeats input. The only request it makes beyond
  Supabase is to its own origin's `openblog-webmention.json`, with redirects refused: a target that is not a post
  accepting mentions is refused (3.2.1's SHOULD), and an unreadable list is a `503`, never a guess. A storage failure
  is a `500` that says nothing about the database.
- **Off by default, with its own secret.** The function answers `404` to everything and touches nothing unless
  `OPENBLOG_WEBMENTION_ENABLED=true` and every setting is valid: Supabase, `OPENBLOG_SITE_ID`, an `https`
  `OPENBLOG_SITE_ORIGIN`, and `OPENBLOG_WEBMENTION_ADMIN_KEY`, at least 32 characters and different from every other
  credential the deployment holds. The schema is `supabase/webmention.sql`, additive and private (row level security
  with no policy, nothing granted to the public roles), undone by `supabase/webmention-rollback.sql`.
- **The site advertises the endpoint only while it receives.** `webmention.receive` in `openblog.json` (`enabled`,
  `endpoint`, `inboxFile`, `retentionDays`) is off by default and omitted while it has its defaults. Only when it is
  on, with an `https` endpoint without credentials, query or fragment, does each post that has not opted out with
  `webmentions: false` carry `<link rel="webmention" href="...">` in its head, and does the build write
  `openblog-webmention.json`: the absolute addresses of those posts. Every other site's output is byte for byte as
  before, and feeds never change.
- **Verification is the command-line pull.** `openblog mentions pull --write` takes at most 100 waiting requests with
  the Admin key, checks each again (the same rules, in `openblog_core::webmention_inbox::check_request`) and against
  the site as published now, then fetches the source with the network half of `openblog webmention`: every address
  and redirect hop checked by `validate_public_url` and resolved by the public-only resolver, at most five redirects,
  15 seconds, the first MiB, no proxy, no cookie, no credential. A source that is not public is never connected to. A
  dry run contacts nothing.
- **What counts as a link (3.2.2).** Only `text/html`, `application/xhtml+xml` and `text/plain` bodies are read. HTML
  is parsed into a tree by `html5ever`; no script runs and no style, image, frame or other resource is requested, so a
  link a script would write is no link. An `href` of `a`, `area` or `link`, a `src` of `img`, `video`, `audio` or
  `source`, or a `cite` of `blockquote`, `q`, `ins` or `del` counts when it resolves, against the address after
  redirects, to exactly the target (with or without a fragment). Plain text must contain the target address.
- **Outcomes.** A source that links the post becomes a pending mention (ADR 0864). A `404` or `410`, a page without
  the link or a body that is not read withdraws a known mention (3.2.2's deletion) and keeps nothing for an unknown
  one. A source that does not answer, times out, redirects too often or answers another status stays in the hosted
  store for the next pull, for 72 hours from its arrival, then is dropped. The inbox is saved before the handled
  requests are deleted from the hosted store, each only at the version taken, so a pull that stops halfway repeats
  work and loses nothing, and a repeat that arrived meanwhile is kept.

## Consequences

- Nothing a stranger sends can make the hosted function request anything, and the one fetch is made where the
  public-only fetcher already lives.
- Mentions are verified when the author pulls, not when they arrive: a sender gets `202`, and the mention appears
  only after a pull, a moderator's approval and a build. A sender gets no status URL.
- A site with no hosted service cannot receive Webmentions; it keeps its canonical pages and can still send them.
- Like ADR 0860, receiving is not a provider in the capability contract (ADRs 0325 to 0327): nothing is published to
  another service, and the sender is any site.
