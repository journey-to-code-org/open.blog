# ADR 0862: Webmention safety is pinned by a local server and a scripted network, and sending off changes nothing

- Status: Accepted
- Date: 2026-10-29
- Parent epic: [#387](https://github.com/journey-to-code-org/open.blog/issues/387)
- Story: #401 (task DIST7.1.3)

## Context

The two risks of ADRs 0860 and 0861 are reaching an address that is not public, and sending at the wrong time. Tests
must never contact a real site.

## Decision

- **The real network code against a local server.** `PublicNetwork` (the ureq agent behind the public-only resolver)
  runs against a `127.0.0.1` listener reached through the resolver's test mapping of one name, as the URL context
  tests do. They pin: a redirect followed to a `Link` header whose endpoint keeps its query string, and the exact form
  body with no `Authorization`; a redirect to a private address refused before it is requested; a name that resolves to
  a private address never connected to (the listener sees no connection); and a silent endpoint ending as no answer
  within the request deadline.
- **Everything else over a scripted network** (the `Network` trait, no socket): header over HTML precedence, document
  order, redirects bounded and `http(s)` only, private and `localhost` endpoints and endpoints with credentials never
  posted to, 201 status URLs kept only when public, target errors; and the command over a project on disk: back-off
  then success, no contact before a retry is due, no repeat of a sent revision, a removed link told once, nothing sent
  for a post that is not live, is a draft, opts out or links only an excluded host, and an unsafe queue path refused.
- **The static fallback.** A dry run is run with a network that panics on any call and must write no queue; `--write`
  with sending off is refused before anything is contacted; and a site that never sets `webmention` serializes and
  parses to the same configuration, so builds and feeds, which never read it, are unchanged.

## Consequences

- A change that lets a request skip the public-only checks, or that sends during a dry run, fails a test.
- Interoperability with real receivers was checked against the specification and the webmention.rocks test
  descriptions only, not by sending to webmention.rocks, because tests never contact a real site.
