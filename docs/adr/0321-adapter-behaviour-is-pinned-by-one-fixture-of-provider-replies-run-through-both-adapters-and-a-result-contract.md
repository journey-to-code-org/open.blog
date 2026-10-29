# ADR 0321: Adapter behaviour is pinned by one fixture of provider replies run through both adapters and a result contract

- Status: Accepted
- Date: 2026-10-29
- Parent epic: [#353](https://github.com/journey-to-code-org/open.blog/issues/353)
- Story: #358 (task #375)

## Context

The worker will trust the publish result to decide whether to retry, reconcile or stop (ADR 0319, 0320). A wrong
mapping duplicates a post or hides one. Provider docs change, and a single test per adapter would let a mapping
drift unnoticed.

## Decision

- **One data fixture, `tests/fixtures/social-publish.json`,** lists provider replies in the documented shapes
  (2xx, 401, 403, 429, 5xx, a network reset, a timeout, ambiguous successes such as a 201 with no id or a 200
  with an HTML body) beside the result each must produce. It is hand-written from the documented shapes: no real
  account was used and no secret is in it. A change to an API version means re-checking it against the provider's
  current documentation first.
- **One contract test runs every case** through the real adapter with a scripted `fetch` and asserts, for all of
  them: the result has exactly the documented fields; there is exactly one provider call; a provider post id exists
  exactly when the status is `published`; an `unknown` result is never retryable and a retryable result is always
  `failed`; the message is the fixed text for the code; the access token is in the `Authorization` header and nowhere
  else; no token, trace id or provider wording appears in the result; every call has a timeout and does not follow
  redirects; nothing is written to the console.
- **Unsupported networks are a list in the fixture** (other platforms, wrong case, whitespace, prototype names, non
  strings). Each is `failed` `unsupported-provider` with no request. A supported provider with no settings is
  `provider-not-configured`.
- **The adapter source is checked** to hold no hosts of its own, no environment access and no logging.

## Considered options

- **Record real responses.** Rejected: it needs real accounts and would put account data in the repository.
- **Test the adapters only separately.** Rejected: the shared contract is the point; per-adapter tests alone let
  the two drift apart.

## Consequences

- Adding a provider means adding fixture cases first; the contract test then covers it.
- The fixture is documentation of what the code assumes, to be re-verified at setup and on version bumps.
