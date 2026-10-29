# ADR 0490: The publishing adapters answer published, failed or unknown from one narrow call and never copy provider text

- Status: Accepted
- Date: 2026-10-29
- Parent epic: [#353](https://github.com/journey-to-code-org/open.blog/issues/353)
- Story: #358 (task #373)

## Context

The scheduled worker (story #357) claims a due announcement, opens the account's credential through the credential
store (ADR 0295) and has to hand the post to LinkedIn or Facebook. It must not duplicate a post, must not mark one
`published` without proof, and must not leak a token or a provider's text. The two providers share nothing but the
need, so the worker needs one small seam it can call and test with a fake.

## Decision

- **One call.** `createPublisher({ providers, fetchImpl, timeoutMs })` (in `netlify/lib/social-publish.mjs`) returns
  `{ publish(post, credentials) }`. `providers` is the settings from `socialProviders(env)` (ADR 0299), so API
  versions, scopes and hosts stay settings with fixed hosts. `post` is
  `{ provider, destination: { id, kind }, caption, url, title? }`; `credentials` is `{ accessToken }`. It never
  throws for a provider outcome.
- **One result shape.** `{ status: "published" | "failed" | "unknown", providerPostId, retryable, code, message,
  httpStatus, reauth, retryAfterSeconds }`. `code` is a fixed slug and `message` fixed text; nothing a provider
  said is ever copied into a result, so a token, an echoed secret or injected markup cannot reach an attempt row, a
  log or Admin.
- **`published` needs proof.** A 2xx with a well-formed provider post id (LinkedIn `urn:li:share|ugcPost:<n>` from
  `x-restli-id`). A 2xx without one is `unknown` (`outcome-unknown`), never `published`.
- **`failed` means the provider refused before acting.** 400/404/409/422 are final (`request-rejected`); 401 is
  `auth-rejected` with `reauth: true`; 403 is `permission-denied`; 429 is `throttled`, the only retryable result,
  with `Retry-After` bounded to an hour. An unexpected status, including a redirect (never followed), is `failed`
  `provider-unexpected`.
- **`unknown` means it may have posted.** A 5xx, a network error and a timeout are `unknown` with
  `retryable: false`: the worker reconciles, it does not post again blindly. Re-sending a LinkedIn post that did
  succeed would publish it twice, and neither API accepts an idempotency key.
- **Checks before any request.** The provider must be one of the two supported (an unsupported destination is
  `failed` `unsupported-provider`), configured, with a printable token and a caption and link that pass the
  schedule rules (ADR 0308), a destination id of the provider's own shape. Failing any is `failed` with no network
  call.
- **LinkedIn.** `POST {apiBase}/rest/posts` with `Authorization: Bearer`, `Linkedin-Version` (the configured dated
  version) and `X-Restli-Protocol-Version: 2.0.0`; none of the obsolete `X-Li-Format` or `ugcPosts` shape. The body
  is a `PUBLIC` `MAIN_FEED` post by the member or organization URN with an `article` (`source` the canonical link,
  `title`), `lifecycleState: PUBLISHED`. `commentary` is LinkedIn "little text", so the reserved characters
  ``\ | { } @ [ ] ( ) < > # * _ ~`` are escaped: a caption posts as typed and cannot mention or format.
- **The token travels only in the `Authorization` header.**

## Considered options

- **Throw on provider failure.** Rejected: the worker would have to parse exceptions to tell a refusal from an
  ambiguous outcome; a value it must switch on is harder to misuse.
- **Treat a 5xx as a retryable failure.** Rejected: a gateway can time out after the post was created.
- **Copy the provider's error message to help the author.** Rejected: it is untrusted text that may echo secrets.

## Consequences

- The worker needs a reconcile path for `unknown` (story #357), and Admin shows the fixed `message`.
- A new network is a code change in `providerOf` and here, on purpose.
