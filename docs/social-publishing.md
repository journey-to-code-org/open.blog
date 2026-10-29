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

Neither key may equal the Supabase key, the Admin API key or an anon/publishable key. If the feature is enabled
but something is wrong, it stays off and the log names the settings at fault, never their values.
Never put any of these in `openblog.json`, the repository or a browser bundle.
