# ADR 0359: A Mastodon account is connected by OAuth on one instance the deployer names, with an application registered there

- Status: Accepted
- Date: 2026-10-29
- Parent epic: [#382](https://github.com/journey-to-code-org/open.blog/issues/382)
- Story: #392 (task DIST2.2.1)

## Context

Epic #382 adds open social networks to scheduled social publishing (epic #353). Mastodon is not one service:
every instance runs its own OAuth server and API, and an application (client id and secret) exists only on the
instance it was registered on. The OAuth connector, sealed credential store, destination discovery, connection
rows and Admin screen already exist for LinkedIn and Facebook (ADRs 0295, 0299 to 0301), and Bluesky reuses them
with an app-password session (ADR 0357). Task DIST2.2.1 asks for instance-aware OAuth and permission discovery.

What Mastodon documents, checked on 2026-10-29:

- [OAuth methods](https://docs.joinmastodon.org/methods/oauth/): `GET /oauth/authorize` takes `response_type=code`,
  `client_id`, `redirect_uri`, space-separated `scope`, PKCE (`code_challenge`, `code_challenge_method=S256`, the
  only method, since Mastodon 4.3.0) and `force_login`, "necessary for authorizing with multiple accounts from the
  same instance". `POST /oauth/token` answers `access_token`, `token_type`, `scope` and `created_at`; no
  `expires_in` or `refresh_token` is documented. `POST /oauth/revoke` takes `client_id`, `client_secret` and
  `token`. `GET /.well-known/oauth-authorization-server` (4.3.0+) lists `scopes_supported`.
- [OAuth tokens](https://docs.joinmastodon.org/api/oauth-tokens/): tokens "will not expire automatically"; they end
  when the user deletes them or the app revokes them. The project has said expiring tokens and refresh tokens will
  come in a later release, detectable from the token response.
- [OAuth scopes](https://docs.joinmastodon.org/api/oauth-scopes/): granular scopes since 2.4.3; `write:statuses`
  and `write:media` fall under `write`, `read:accounts` and `read:statuses` under `read`, and requesting the broad
  scope grants the granular ones. The docs recommend asking for the narrowest scopes.
- [Accounts](https://docs.joinmastodon.org/methods/accounts/): `GET /api/v1/accounts/verify_credentials` needs
  `profile` or `read:accounts` and answers the account's `id`, `username` and `acct`.
- [Instance](https://docs.joinmastodon.org/methods/instance/): `GET /api/v2/instance` (4.0.0+, public, no token)
  answers `configuration.statuses.max_characters` (500 by default),
  `configuration.statuses.characters_reserved_per_url` (23) and `configuration.media_attachments`
  (`supported_mime_types`, `image_size_limit`, `description_limit`).
- [Applications](https://docs.joinmastodon.org/methods/apps/): an application can be registered by API or by hand
  in an account's Preferences, Development; client secrets do not expire.

## Decision

- **One instance, named by the deployer, with an application registered there by hand.** Mastodon is offered when
  `OPENBLOG_SOCIAL_MASTODON_CLIENT_ID`, `OPENBLOG_SOCIAL_MASTODON_CLIENT_SECRET` and
  `OPENBLOG_SOCIAL_MASTODON_INSTANCE` are all set. The instance is an `https` origin and nothing else (no
  credentials, path, query or fragment). Every endpoint (`/oauth/authorize`, `/oauth/token`, `/oauth/revoke`, the
  API) is derived from that origin, so the client secret can only ever be sent to the instance it belongs to. This
  is the existing OAuth provider shape (ADR 0299) with the host made a setting; no new storage is needed. Registering
  an application per author instance at connect time (`POST /api/v1/apps`) would need a sealed per-instance client
  store and a way to revoke and forget it; it is the follow-up if a deployment needs authors on several instances.
- **Narrow scopes, checked against the grant.** It asks for `read:accounts write:statuses read:statuses
  write:media`. `read:accounts` (to name the account) and `write:statuses` are required; `read:statuses` (to look an
  uncertain attempt up, ADR 0360) and `write:media` (the cover image, ADR 0360) are optional and only narrow what the
  connection does. The granted scopes are read from the token reply's `scope`, and a broad scope counts for its
  granular ones (`write` grants `write:statuses`). A grant without a required scope is refused and its token revoked.
  `OPENBLOG_SOCIAL_MASTODON_SCOPES` and `OPENBLOG_SOCIAL_MASTODON_PKCE=true` work as for the other providers; PKCE is
  for instances on 4.3.0 or later.
- **The account is the destination; the instance is discovered, not trusted to stay.** After the exchange,
  `verify_credentials` names the account: its id is the destination id, `@username@instance-host` its name, offered
  unless Mastodon says `suspended` (reason `account-suspended`). `GET /api/v2/instance` is read without a token and
  only for what the author should know now: notes say when the instance takes fewer than 500 characters
  (`instance-limit-low`), when its configuration could not be read (`instance-unavailable`, which does not stop the
  connection), when `read:statuses` was not granted (`statuses-not-readable`) and when the cover image is turned on
  but `write:media` was not granted (`media-not-granted`). The adapter reads the instance again before every post
  (ADR 0360), so nothing about it is stored.
- **A Mastodon token is the connection's own.** The instance issues a token per authorization, so, like a Bluesky
  session and unlike LinkedIn's shared member grant, it is always revoked at the instance (`POST /oauth/revoke`,
  best effort) when its account is disconnected, when a failed attempt leaves it unused, and when an authorized
  attempt is canceled. Reconnecting sends `force_login=true` so the author signs in as the account the connection
  belongs to, and finishes only for the same account id (the existing rule); a token for anyone else is revoked.
- **Refresh only if Mastodon ever sends one.** A token reply without `expires_in` stores no expiry and is never
  refreshed. If an instance answers with a `refresh_token` and an expiry, the standard refresh grant is used with the
  client credentials under the credential store's single-flight lease (ADR 0295), exactly as LinkedIn's is.
- **Admin only follows the instance's own sign-in page.** The Rust Admin passes on a Mastodon authorization address
  only when it is `https`, on the default port, at `/oauth/authorize` and on the exact origin the function's status
  names for Mastodon, which Admin asks the function for at each Mastodon attempt; the Admin page checks the same
  before it draws the link. The status shows the instance, the visibility and whether the cover is attached.
- **Off by default, no schema change.** Nothing about Mastodon exists until its three settings are set. Provider and
  kind are checked for shape only by the existing tables (ADR 0293), so nothing in `supabase/` changes.

## Consequences

- An author can connect accounts on the deployer's instance only. A deployer whose authors use another instance
  registers the application there and changes `OPENBLOG_SOCIAL_MASTODON_INSTANCE`; accounts connected on the old one
  stop working and are reconnected.
- A Mastodon token does not expire, so an account stays connected until the author revokes the application in
  Mastodon (Preferences, Account, Authorized apps) or disconnects it in Admin.
- A reconnect stores the new token but does not revoke the replaced one; it stays listed in the author's authorized
  apps until they remove it there.
