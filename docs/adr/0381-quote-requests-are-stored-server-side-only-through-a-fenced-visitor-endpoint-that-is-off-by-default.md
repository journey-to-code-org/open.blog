# ADR 0381: Quote requests are stored server-side only, through a fenced visitor endpoint that is off by default

- Status: Accepted
- Date: 2026-10-29
- Parent story: [#485](https://github.com/journey-to-code-org/open.blog/issues/485)
- Task: [#514](https://github.com/journey-to-code-org/open.blog/issues/514)
- Parent epic: [#474](https://github.com/journey-to-code-org/open.blog/issues/474)
- Builds on: [ADR 0294](0294-the-social-schema-is-additive-site-keyed-and-shaped-for-atomic-claim.md) (the Supabase `service_role` workspace pattern)

## Context

A visitor who wants a quote has no account, so the social function's admin-key model cannot apply to the
form. The data is personal (name, phone, town, photos of a home) and must be reachable only server-side.

## Decision

- **Off by default.** `netlify/functions/quote.mjs` answers 404 and touches nothing unless
  `OPENBLOG_QUOTE_ENABLED=true` and every setting is valid; an incomplete setting is still off and names
  the variable, never the value. No static file, feed, export or syndication reads it.
- **Server-side only, additive schema.** `supabase/quote.sql` (rollback `quote-rollback.sql`) creates
  `openblog_quote_requests` and a private bucket `openblog-quote-photos`: row level security on with no
  policies, public roles revoked, `service_role` only, every row carrying `site_id` (`OPENBLOG_SITE_ID`),
  every query filtered by it. The browser never talks to Supabase.
- **Fenced instead of authenticated.** Same-origin posts only (`OPENBLOG_SITE_ORIGIN`); a signed, single-use
  form token (HMAC with `OPENBLOG_QUOTE_SECRET`, at least 3 s and at most 2 h old, its hash unique per
  site so a token sends one request); a honeypot answered like a success; at most 5 stored requests per
  visitor and 60 per site per hour, counted from stored rows with the visitor's address kept only as a
  keyed hash; hard bounds (body 4 MB, at most 5 photos, 900 KB each, 4 MB together); photos accepted by
  their own bytes (JPEG, PNG, WebP only); more than two links in the description is refused. No
  third-party captcha.
  Story #485 asks for an "authenticated" endpoint. A visitor asking for a quote has no account and should
  not need one, and anything a public page could hand them to prove who they are (a key, a client
  secret) would be readable by everyone, so it would authenticate nothing. What the criterion is after
  is that only real, bounded requests from this site's own form are stored, under this site; the fence
  above does exactly that, and every route that reads, changes or erases requests is authenticated (the
  admin key on the function, and the signed-in session plus CSRF check in Admin, ADR 0384). That is how
  this decision reads the criterion.
- **Works without JavaScript.** The page script fetches the token; a plain form post has none, so its first
  post is answered with the same form (text kept, escaped) and a fresh token to send again. A bot that does
  not wait is refused; a person presses Send twice. Photos must be attached again.
- **Nothing lost, nothing leaked.** Photos are uploaded first and removed if the row cannot be written; a
  storage failure answers 503 so the visitor knows nothing was sent. Visitor values are never logged,
  returned or placed in an error; responses carry fixed reasons and field names only.
- **Fields.** name, phone, email (optional), town, service, description (10 to 2000 characters), page path,
  photos. `service` and `town` are bounded text on the server; the form offers the site's lists.

## Verified provider facts

- Supabase Storage standard uploads: `POST /storage/v1/object/{bucket}/{path}` with `apikey` and
  `Authorization`, suited to files up to 6 MB
  (<https://supabase.com/docs/guides/storage/uploads/standard-uploads>, checked 2026-10-29).
- Netlify synchronous functions cap a request body at 6 MB, so the bounds above keep base64 under it.
  Not re-verified in this task.

## Consequences

Per-visitor limits count stored requests only, so a flood of refused posts costs compute but no storage.
Admin listing, handling, CSV export and erasure belong to story #486.

The function is a Netlify function (`netlify/functions/quote.mjs`, routed by `netlify.toml`). A site served by
`openblog serve` alone, as on Render, has no `/api/quote` route, so the form there has nowhere to send. Running
the function elsewhere for a Render site is not built: the page script fetches its token from the same site,
and the function sends no cross-origin headers.
