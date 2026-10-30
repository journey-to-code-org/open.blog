# ADR 0760: A Bluesky account is connected from an app-password session, and only the session is kept

- Status: Accepted
- Date: 2026-10-29
- Parent epic: [#382](https://github.com/journey-to-code-org/open.blog/issues/382)
- Story: #391 (task DIST2.1.1)

## Context

Epic #382 adds open social networks to scheduled social publishing (epic #353). Bluesky is reached through the AT
Protocol's XRPC API, and the delivery worker, credential store, connection rows and Admin screen already exist for
LinkedIn and Facebook (ADRs 0295, 0299 to 0301, 0316 to 0321). Task DIST2.1.1 asks to confirm the current AT
Protocol auth and token handling before anything posts.

What the protocol offers, checked on 2026-10-29:

- **OAuth is the primary scheme.** [XRPC spec](https://atproto.com/specs/xrpc): "The primary client/server
  authentication and authorization scheme for XRPC is OAuth." The [atproto OAuth profile](https://atproto.com/specs/oauth)
  requires a client metadata document served at the `client_id` URL, pushed authorization requests (PAR), PKCE (S256),
  DPoP-bound tokens with mandatory server nonces on every request, per-account identity resolution (handle to DID to
  PDS to authorization server, verified both ways), and for a confidential client `private_key_jwt` with ES256 keys.
  Refresh tokens are single-use; a public client's session is limited to two weeks.
- **Legacy Bearer sessions are still supported.** The same XRPC spec documents `com.atproto.server.createSession`
  returning an access JWT and a refresh JWT, and App Passwords as "a mechanism to reduce security risks when logging
  in to third-party clients" with "slightly restricted permissions" (no account deletion, no changing authentication
  settings). The lexicons ([createSession](https://github.com/bluesky-social/atproto/blob/main/lexicons/com/atproto/server/createSession.json),
  [refreshSession](https://github.com/bluesky-social/atproto/blob/main/lexicons/com/atproto/server/refreshSession.json),
  [deleteSession](https://github.com/bluesky-social/atproto/blob/main/lexicons/com/atproto/server/deleteSession.json))
  give the shapes: `{ identifier, password }` in, `{ accessJwt, refreshJwt, handle, did, active?, status? }` out;
  refresh and delete authenticate with the refresh JWT; errors `ExpiredToken`, `InvalidToken`, `AccountTakedown`.
- **The bsky.social entryway forwards.** [Entryway guide](https://docs.bsky.app/docs/advanced-guides/entryway):
  session management for bsky.social accounts is handled by the entryway, and "most requests that can be sent to a PDS
  on behalf of a user can also be sent to the Entryway instead", which forwards them to the right PDS.
- **Limits.** [Rate limits](https://docs.bsky.app/docs/advanced-guides/rate-limits): `createSession` is limited per
  account to 30 per 5 minutes and 300 per day, so a sign-in per post is wrong; writes cost 3 points per create
  against 5,000 points an hour and 35,000 a day. Exceeding a limit answers HTTP 429.

## Decision

- **App-password sessions now; OAuth later, behind the same seams.** The first Bluesky connection signs in with
  `createSession` from a handle (or DID) and an **app password**. DPoP with nonces on every request, PAR, a hosted
  client metadata document and a key pair to rotate are a large, separate piece of security-critical work; the legacy
  session is documented, scoped down by Bluesky itself, and revocable by the author in Bluesky's settings. Moving to
  OAuth later changes only how a session is opened and refreshed (`social-providers.mjs`); the account, its sealed
  credential, the worker and the adapter stay as they are. This is the reversible choice: nothing is stored that an
  OAuth connection would have to migrate, and an author reconnects to switch.
- **Only an app password is accepted.** Admin (Rust) and the hosted function both refuse a password that does not
  have the app-password shape (`xxxx-xxxx-xxxx-xxxx`, letters and digits) before any call, so an author's account
  password, which can do far more, is never sent. The identifier must be a handle or a DID (an `@` is dropped and a
  handle is lower-cased); an email address or a URL is refused.
- **The password is used once and kept nowhere.** It travels Admin to function to service in one request body, is
  emptied from the Admin form before the request is sent, and is never stored, logged, sealed or answered. What is
  kept is the session: the access and refresh JWTs, sealed by the credential store (ADR 0295) exactly like OAuth
  tokens. `createSession`'s other fields (email, DID document) are not kept.
- **It is a connection like the others.** The function makes an `openblog_social_connections` row (status
  `exchanging`, a random `state_hash` that never leaves it, the service as `redirect_uri`, no scopes), opens the
  session, and hands it to the same `authorize` step as an OAuth callback: the session's one account is the only
  destination (kind `account`, id the DID, name `@handle`), offered only while the service does not say
  `active: false` (reason `account-inactive`). The author chooses it as with any provider, so nothing is connected
  until they do. No schema change is needed: provider and kind are checked for shape only (ADR 0293).
- **Reconnect is for the same DID only.** Reconnecting a Bluesky account sends a handle and app password with the
  account id; a session for a different DID is refused as `identity-mismatch` and that new session is ended.
- **Expiry comes from the tokens; refresh is the existing single-flight one.** The access and refresh expiries are
  read from each JWT's `exp` claim (unverified: it only decides when to refresh, and the service checks every token).
  An access token whose expiry cannot be read is treated as 15 minutes, so it is refreshed early, not late. Refreshing
  calls `refreshSession` with the refresh JWT under the credential store's lease (ADR 0295), which matters because the
  refresh token rotates. Only `ExpiredToken`, `InvalidToken`, `AccountTakedown` or `AuthenticationRequired` with a 400
  or 401 ends the session (the account becomes "needs reconnecting"); anything else is retried.
- **Sessions are ended, not abandoned.** Disconnecting, canceling a waiting attempt, a failed attempt (inactive
  account, identity mismatch) and a lost race all call `deleteSession` with the refresh JWT, best effort. A Bluesky
  session belongs to one account, so unlike LinkedIn's shared grant it is always ended.
- **Settings.** `OPENBLOG_SOCIAL_BLUESKY_ENABLED=true` offers Bluesky; anything else set there is a named problem.
  `OPENBLOG_SOCIAL_BLUESKY_SERVICE` is the service that signs the author in and receives posts, an `https` origin
  only (default `https://bsky.social`; a self-hosted PDS sets its own). Failures are fixed codes:
  `credentials-rejected` (400, the service refused the sign-in), `provider-rate-limited` (429),
  `provider-unavailable` (503), `no-destination` and `identity-mismatch` (409). No message from the service is
  repeated.

## Consequences

- A Bluesky refresh token lapses if nothing refreshes it for its lifetime (the `exp` the service gives; Admin shows
  "Can renew until"); the account then needs reconnecting, as any expired grant does.
- If the store fails right after a successful refresh, the rotated refresh token is lost and the next refresh is
  refused: the account asks to be reconnected. It never posts with a token it should not have.
- An author can end open.blog's access at any time by revoking the app password in Bluesky, and Disconnect ends the
  session from this side.
- OAuth with DPoP is the follow-up when the hosted function can keep a client key pair and serve client metadata;
  until then a deployment that must not use app passwords leaves Bluesky off.
