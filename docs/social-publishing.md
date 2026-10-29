# Scheduled social publishing (optional)

Social publishing announces an already-published post on a connected LinkedIn identity or Facebook Page, at a
time you choose. It is off by default. Your site, its exports and cross-posting work exactly the same without it,
and nothing in this guide is needed to read, build or publish a blog.

This page covers the identity and storage foundation (epic #353, story #354) and scheduling announcements (story
#356). Provider setup and delivery arrive in later stories.

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

## Scheduling announcements

An announcement is a caption and a time for one connected account, linking one of your public posts
([ADR 0470](adr/0470-an-announcement-links-a-public-canonical-post-at-a-utc-instant-and-only-a-scheduled-one-can-change.md),
[ADR 0471](adr/0471-announcement-routes-are-called-by-the-rust-admin-with-the-admin-key-and-change-a-row-only-by-version.md)).

What can be announced:

- Only a published post: not a draft, not dated in the future. The link is your site's own address for it, built from
  `url` in `openblog.json`, which must be a public `https` address. A cross-post whose `canonical` points to another
  site is not announced from here.
- A caption of 1 to 3,000 characters. The link is added when the post is sent, so it does not count. Control
  characters (other than a new line) and text-direction overrides are refused.
- A time at least a minute ahead and no more than a year ahead, written with its zone. It is stored in UTC; Admin
  shows it in your own zone. Your zone is not stored.

Until a delivery worker exists (a later story) a scheduled announcement waits in the queue and is not sent.

Only a **scheduled** announcement can be changed, rescheduled or canceled. Once a worker has claimed it, it cannot be.
Saving names the version you were looking at; if it changed meanwhile you are asked to reload. Creating is
idempotent: submitting the same composer twice (a double click, a retry after a timeout) gives one announcement.

### Settings on the machine that runs Admin

The Admin process, not the hosted function, needs these. They are environment variables only; they are never read from
`openblog.json` and never returned by Admin.

| Variable | Purpose |
| --- | --- |
| `OPENBLOG_SOCIAL_ENABLED` | Must be exactly `true`. Anything else and the **Social** section does not appear. |
| `OPENBLOG_SOCIAL_ENDPOINT` | `https://your-site.example/.netlify/functions/social-schedule` (plain `http` is accepted only for `localhost`). |
| `OPENBLOG_SOCIAL_ADMIN_KEY` | The same value as the hosted function's `OPENBLOG_SOCIAL_ADMIN_KEY`; 32 characters or more. |

The function lives at `netlify/functions/social-schedule.mjs`. It has no redirect and nothing public links to it; it
answers 404 to everything unless the hosted settings above are valid, and only accepts the admin key. A rejected key
shows in Admin as a setup problem ("did not accept this Admin's key"), not as a sign-out.

### Routes

Admin (`/admin/api/social/`, session and CSRF like every Admin route): `status`, `posts`, `preview`, `destinations`,
`announcements` (`GET` list, `POST` create, `PATCH ?id=` edit), `announcements/reschedule?id=`,
`announcements/cancel?id=`. Hosted (the same names under the endpoint, admin key only): the same set except `status`,
`posts` and `preview`, which Admin answers itself.

### The Social screen

With the settings above in place, Admin shows a **Social** tab
([ADR 0472](adr/0472-the-social-screen-is-a-labelled-form-with-a-server-checked-preview-and-times-in-the-authors-zone.md)):
a composer (destination, post, caption, date and time, preview) and the list of announcements with edit and cancel.
See [Admin](admin.md#announce-a-post-on-social-media-optional) for how it is used. It only offers connected accounts,
so connecting one is a separate step. Check it in a browser at 320px wide before you rely on it: it should never scroll
sideways.

Before you enable it for real, confirm in each provider's current documentation the API version, the permissions
(scopes) and any app review the posting API needs; none of that is part of this screen, and nothing here posts until
delivery is set up.
