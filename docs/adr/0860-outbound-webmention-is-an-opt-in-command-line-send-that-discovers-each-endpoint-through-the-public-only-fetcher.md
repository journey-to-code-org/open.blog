# ADR 0860: Outbound Webmention is an opt-in command-line send that discovers each endpoint through the public-only fetcher

- Status: Accepted
- Date: 2026-10-29
- Parent epic: [#387](https://github.com/journey-to-code-org/open.blog/issues/387)
- Story: #401 (task DIST7.1.1)

## Context

Epic #387 wants open-web discovery and independent conversations: when a canonical post links someone else's page,
that site can be told with a [W3C Webmention](https://www.w3.org/TR/webmention/) (Recommendation, 12 January 2017).
The sender fetches the linked page, finds the endpoint it advertises and posts two addresses to it. Every one of those
addresses comes from someone else, so the sender is a server-side request forgery risk: a link, a redirect or an
advertised endpoint can point at `localhost`, a private network or a cloud metadata address.

The repository already has the pieces. `safe_http.rs` is the public-only resolver and agent that URL context,
source metadata and cross-posting use; `url_context::validate_public_url` refuses non-web schemes, credentials, literal
private addresses and `localhost` names; `openblog syndicate` already turns a published post into its public portable
HTML and checks the canonical page is live. Social publishing (ADRs 0316 to 0321, 0331) is a hosted queue for
authorized accounts on two providers; a Webmention has no account, no credential and no provider, and has to work for
a static site with no hosted service.

## Decision

- **Where it runs.** `openblog webmention [slug]` in the command-line tool, on the author's machine or in CI after a
  deploy. Not the hosted function: nothing is stored or scheduled outside the project, and a static site needs no
  service. The provider capability contract (ADRs 0325 to 0327) is not extended: a Webmention carries only two
  addresses, never a copy, text or media, and its receiver is discovered per link at send time, so there is no
  provider whose capabilities a manifest could declare.
- **Opt-in.** `webmention.enabled` in `openblog.json`, off by default and omitted from the written file while
  `webmention` has its defaults. Without it `--write` refuses before reading a post or contacting anything; a dry run
  always works. A post can opt out with `webmentions: false` in its front matter, and `webmention.excludeHosts` names
  sites (and their subdomains) that never receive one.
- **What is a target.** The `<a href>` links of the post's public portable HTML (the projection cross-posting sends,
  so nothing private is linked from), resolved against the canonical address, fragment removed, de-duplicated, in
  document order: `http` or `https` only, no user name or password, not the post's own host, not excluded, at most
  100 per post. The rest are listed with a fixed reason.
- **Discovery** follows section 3.1.2: GET the target with redirects followed by the tool, at most five, each hop
  resolved against the previous address and refused unless `http(s)`; the first `Link` header with a `rel` token
  `webmention` (quoted or not, several links per header, several tokens per `rel`) wins; otherwise the first `<link>`
  or `<a>` with that `rel` token and an `href`, in document order, from an HTML response only (parsed by an HTML
  parser, so commented-out markup is ignored, and only the first MiB is read). The reference resolves against the
  address after redirects, an empty one is that page, and a query string stays on the endpoint, as the
  [webmention.rocks](https://webmention.rocks/) discovery tests 13, 15, 19, 21 and 23 exercise.
- **SSRF defense, on every request.** Each address (the target, every redirect hop, the endpoint, the canonical
  check) is checked by `validate_public_url` before use and requested through `safe_http::public_agent`, whose
  resolver refuses a name that resolves to any non-public address, so a DNS answer cannot move a public name onto a
  private network. ureq follows no redirect itself and uses no proxy. A refused address ends that ping as `blocked`
  and nothing is sent there. This is stricter than the specification's section 4.3, which only asks a sender not to
  post to a loopback endpoint.
- **The ping** is section 3.1.3: a form POST of `source` (the canonical address) and `target`, with no credential and
  no cookie, at most 15 seconds per request. Any 2xx is success; a 201's `Location` is kept only when it is a public
  web address.

## Consequences

- Sending is a deliberate step, like `openblog syndicate --write`, and a site that never sets `webmention` builds,
  feeds and cross-posts exactly as before.
- A target behind a private address, or one whose name does not resolve publicly, can never be reached; the tool
  cannot tell a missing DNS name from a private one and reports both as `blocked`.
- Receiving Webmentions is story #402 and not part of this decision.
