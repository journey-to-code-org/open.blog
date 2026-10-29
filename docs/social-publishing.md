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
safely, and creates `openblog_social_accounts`, `openblog_social_posts` (the schedule queue),
`openblog_social_attempts` (delivery history), `openblog_social_credentials` (encrypted tokens) and
`openblog_social_schema` (the schema version). All of them are private: row level security is on with no
policies, the public roles have no access, and only the hosted function (`service_role`) reads and writes. Every
row carries your site scope and relations include it, so a row cannot point at another site's account or post.
Nothing is ever deleted by the function: cancelling and disconnecting are updates.

To undo it, remove `OPENBLOG_SOCIAL_ENABLED`, stop the worker, export what you want to keep (the commands are in
the file) and run `supabase/social-rollback.sql`. It drops only the `openblog_social_*` tables. Revoke the app at
LinkedIn and Facebook as well; stored tokens are deleted by the rollback but stay valid there until revoked.

## Provider tokens

Access and refresh tokens are encrypted by the hosted function before they reach the database
([ADR 0295](adr/0295-provider-tokens-are-envelope-encrypted-by-the-hosted-function-and-refreshed-single-flight.md)).
Each connection gets its own random key, wrapped by a key you keep only in the function's environment, so a database
dump or a leaked `service_role` key does not reveal a token. Generate a key with
`node -e "console.log('k1:' + require('crypto').randomBytes(32).toString('base64'))"` and store it in your secret
manager as well: if you lose it, every account has to be connected again.

To rotate, put a new key first (`k2:...,k1:...`) and redeploy; new connections use `k2`. Keep `k1` in the list: no
command re-wraps existing connections yet (the library function exists, and a later story adds the operator entry
point). Removing `k1` while a connection still uses it makes that connection unreadable, and it has to be connected
again. Check before removing a key:
`select key_id, count(*) from openblog_social_credentials where status = 'active' group by 1;`
Remove `k1` only when no active row shows it.

Tokens are refreshed once at a time, shortly before they expire. If a provider says a connection is no longer valid,
or you disconnect an account, its stored tokens are erased and the account asks to be connected again. Admin only ever
sees a connection's status and dates, never a token. Tokens never appear in errors or logs, and are never written to
`openblog.json`, the repository, a page or an export.

## Connecting LinkedIn and Facebook (OAuth)

Connecting an account is an OAuth authorization-code flow
([ADR 0460](adr/0460-the-oauth-handshake-is-a-single-use-state-bound-connection-finished-by-the-hosted-function.md)).
The provider sends the author's browser back to your hosted function, so it needs a public `https:` address.

Create an app with each provider you want and set these in the function's environment (never in `openblog.json`):

| Variable | Purpose |
| --- | --- |
| `OPENBLOG_SOCIAL_CALLBACK_BASE` | Public `https://` address of the function, such as `https://blog.example.com/api/social`. No credentials, query or fragment. |
| `OPENBLOG_SOCIAL_LINKEDIN_CLIENT_ID`, `OPENBLOG_SOCIAL_LINKEDIN_CLIENT_SECRET` | The LinkedIn app's credentials. A provider with neither set is simply not offered. |
| `OPENBLOG_SOCIAL_FACEBOOK_CLIENT_ID`, `OPENBLOG_SOCIAL_FACEBOOK_CLIENT_SECRET` | The Meta app's credentials. |
| `OPENBLOG_SOCIAL_<PROVIDER>_API_VERSION` | Optional. LinkedIn `YYYYMM` (default `202510`), Facebook `vNN.N` (default `v23.0`). |
| `OPENBLOG_SOCIAL_<PROVIDER>_SCOPES` | Optional. Replaces the requested scopes (space or comma separated). |
| `OPENBLOG_SOCIAL_LINKEDIN_ORGANIZATIONS` | Optional. `true` also asks for `r_organization_admin` and `w_organization_social`, to post as an organization. |
| `OPENBLOG_SOCIAL_<PROVIDER>_PKCE` | Optional. `true` sends a PKCE (S256) challenge. Off by default; turn it on only if the provider documents it for your app type. |

Register exactly this redirect URL in each provider app (Admin shows it too): `<CALLBACK_BASE>/callback/linkedin`
and `<CALLBACK_BASE>/callback/facebook`. Nothing in a request can change the redirect or the scopes that are sent.

**Verify these when you set up, because providers change them.** The defaults are a starting point, not a promise:

- LinkedIn: confirm the `Linkedin-Version` you set is still supported, that **Share on LinkedIn** is added to the
  app (for `w_member_social`) and **Sign In with LinkedIn using OpenID Connect** (for `openid profile`). Posting
  as an organization needs the Community Management API, which LinkedIn approves per app; until it does, the
  organization scopes are refused and only the member is offered.
- Facebook: confirm the Graph version, and that `pages_show_list` and `pages_manage_posts` are available to your
  app. Until Meta approves **Advanced access** through App Review, only people with a role on the app can
  connect a Page that is not their own. Admin cannot read review status from the API and says so.

Each attempt expires after ten minutes, works once, and at most ten may be open. If the author declines a
permission, the attempt fails with a plain message and nothing is stored. The scopes shown in Admin are the ones
the provider actually granted. Client secrets are sent in the request body to the provider, never in a URL.

## Choosing where to post

After the author authorizes, the function asks the provider where the grant can post
([ADR 0461](adr/0461-destinations-are-discovered-from-the-grant-and-offered-only-when-the-provider-confirms-them.md)).
Admin lists each destination and chooses one; nothing is connected until it does, and the choice is made once.

- **LinkedIn** offers the member, and the organizations they administer when you set
  `OPENBLOG_SOCIAL_LINKEDIN_ORGANIZATIONS=true` and LinkedIn has approved the Community Management API for your app.
  Admin tells apart "not asked for", "not granted", "LinkedIn refused the lookup" (usually no approval), "could not
  be listed" and "you administer none"; it never reads a refusal as an empty list.
- **Facebook** offers a Page only if `pages_manage_posts` was granted, your role on the Page includes creating
  content, and Facebook returned access for it. A Page whose role Facebook did not report is shown but not
  offered. Meta's App Review status cannot be read from the API, so Admin always reminds you to confirm it.
- A destination that is already connected cannot be connected twice; use **Reconnect** on it.

**Reconnect** signs in again and replaces the stored credential, but only for the same LinkedIn identity or the
same Page. A different login is refused, LinkedIn is asked to withdraw that grant, and nothing is changed.

**Disconnect** erases the stored tokens and keeps the account row for history. LinkedIn is asked to revoke the
grant when no other connected LinkedIn account could share it. Facebook is not asked, because withdrawing the grant
would also cut off your other Pages: remove the app under **Settings > Business integrations** in Facebook if you
want the grant gone. Revoke the app in the provider's settings as well when you retire the site.

An account shows as **Needs reconnecting** when a provider dropped the grant, its tokens were erased, or its tokens
(and refresh token) have run out, and as **Expiring** within seven days of that moment. LinkedIn tokens refresh
themselves while a refresh token is valid. Admin shows each account's provider id and name, its status, its dates and
the permissions that were granted, never a token.

## Connected accounts in Admin

Admin has a **Social accounts** page (`#/social`, and in the navigation once social settings exist)
([ADR 0462](adr/0462-connected-accounts-are-managed-through-admin-routes-that-rebuild-every-reply-from-known-fields.md)).
It is the only place you connect, reconnect or disconnect an account. Tell the machine that runs `openblog serve --admin`
where the function is and give it the Admin key, as environment variables (never in `openblog.json`):

| Variable | Purpose |
| --- | --- |
| `OPENBLOG_SOCIAL_ENDPOINT` | The function's address, such as `https://blog.example.com/api/social`. `https:` only (plain `http:` is allowed to `127.0.0.1` or `localhost` for local development). No credentials, query or fragment. |
| `OPENBLOG_SOCIAL_ADMIN_KEY` | The same value as the function's `OPENBLOG_SOCIAL_ADMIN_KEY`. At least 32 characters. |

With neither set, Admin has no Social accounts entry and the page only explains how to turn the feature on. If one is
set but wrong, the page names the setting at fault and sends nothing.

What you can do on the page:

- **Connect**: each provider shows the permissions it will ask for in plain words (optional ones marked) and the
  exact redirect address to register in the provider's app. **Connect** gives a link that opens the provider in a new
  tab; approve access there, return to Admin, press **I have finished, check now** (or just return to the tab), then
  choose where posts may go. The link is not kept after a reload; cancel and start again if you lose it.
- **Choose a destination**: destinations the provider did not confirm are shown disabled, with the reason.
- **Reconnect**: appears on every account and leads when access ran out or was withdrawn. Sign in as the same account.
- **Disconnect**: asks first, then erases the stored tokens and keeps the account in your history.

Each account shows its status as words (Connected, Expiring soon, Needs reconnecting, Disconnected), its dates, who
connected it, its provider id and the permissions the provider granted. Admin never receives a token: the page is
rebuilt from known fields on the Admin server, so even a faulty function reply cannot put one in front of you.
The page works with the keyboard and a screen reader and has no sideways scroll at 320 px.
