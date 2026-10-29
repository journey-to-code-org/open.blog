# Scheduled social publishing (optional)

Social publishing announces an already-published post on a connected LinkedIn identity or Facebook Page, at a
time you choose. It is off by default. Your site, its exports and cross-posting work exactly the same without it,
and nothing in this guide is needed to read, build or publish a blog.

This page covers the identity and storage foundation (epic #353, story #354). Provider setup, scheduling and the
Admin screens arrive in later stories.

## Who is allowed to do what

Nothing in a browser talks to Supabase. The flow is:

1. You sign in to Admin as usual. Admin checks its own session and CSRF token on every route and denies by default.
2. Admin calls the hosted social function with a server-held key and names the signed-in Admin user in the
   `X-OpenBlog-Actor` header. That name is recorded for audit; it grants nothing.
3. The hosted function holds the Supabase `service_role` key. It acts for exactly one site, `OPENBLOG_SITE_ID`,
   and refuses any request that names a site.

The scheduled worker uses a different key and acts as `@worker`. A leaked worker key can never act as an author.

## Settings (hosted function only)

| Variable | Purpose |
| --- | --- |
| `OPENBLOG_SOCIAL_ENABLED` | Must be exactly `true`. Anything else and the routes answer 404. |
| `SUPABASE_URL` | `https://` project origin, no path or credentials. |
| `SUPABASE_SECRET_KEY` | The `service_role`/secret key. Server only. |
| `OPENBLOG_SITE_ID` | The site scope: 1 to 80 of `A-Z a-z 0-9 . _ -`, starting with a letter or digit. |
| `OPENBLOG_SOCIAL_ADMIN_KEY` | At least 32 characters; used by the Rust Admin. |
| `OPENBLOG_SOCIAL_WORKER_KEY` | At least 32 characters; used by the scheduled worker. Differs from the admin key. |
| `OPENBLOG_SOCIAL_TOKEN_KEYS` | Token encryption keys, `id:base64` of 32 random bytes, comma separated; the first encrypts new tokens. Required. |

Neither key may equal the Supabase key, the Admin API key or an anon/publishable key. If the feature is enabled
but something is wrong, it stays off and the log names the settings at fault, never their values.
Never put any of these in `openblog.json`, the repository or a browser bundle.

## The hosted tables

Run `supabase/social.sql` once in the Supabase SQL editor, only if you opt in. It is additive, can be run twice
safely, and creates `openblog_social_accounts`, `openblog_social_posts` (the schedule queue) and
`openblog_social_attempts` (delivery history). All of them are private: row level security is on with no
policies, the public roles have no access, and only the hosted function (`service_role`) reads and writes. Every
row carries your site scope and relations include it, so a row cannot point at another site's account or post.
Nothing is ever deleted by the function: cancelling and disconnecting are updates.

To undo it, remove `OPENBLOG_SOCIAL_ENABLED`, stop the worker, export what you want to keep (the commands are in
the file) and run `supabase/social-rollback.sql`. It drops only the `openblog_social_*` tables. Revoke the app at
LinkedIn and Facebook as well; stored tokens are deleted by the rollback but stay valid there until revoked.

## Provider tokens

Access and refresh tokens are encrypted by the hosted function before they reach the database
([ADR 0452](adr/0452-provider-tokens-are-envelope-encrypted-by-the-hosted-function-and-refreshed-single-flight.md)).
Each connection gets its own random key, wrapped by a key you keep only in the function's environment, so a database
dump or a leaked `service_role` key does not reveal a token. Generate a key with
`node -e "console.log('k1:' + require('crypto').randomBytes(32).toString('base64'))"` and store it in your secret
manager as well: if you lose it, every account has to be connected again.

To rotate, put a new key first (`k2:...,k1:...`), redeploy, and re-wrap accounts; remove `k1` once none uses it.

Tokens are refreshed once at a time, shortly before they expire. If a provider says a connection is no longer valid,
or you disconnect an account, its stored tokens are erased and the account asks to be connected again. Admin only ever
sees a connection's status and dates, never a token. Tokens never appear in errors or logs, and are never written to
`openblog.json`, the repository, a page or an export.
