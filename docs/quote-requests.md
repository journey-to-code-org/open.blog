# Quote requests

Let a visitor ask for a quote from any page: name, phone, town, service, up to five photos and a description.
The request is stored in your private Supabase workspace and never in a static file. It is **off by default**:
a site that never turns it on builds exactly as before. The decisions are in ADRs 0900 to 0902.

This is not a CRM. Listing, marking handled, CSV export and erasure come with the Admin request screen.

## What a visitor sees

A plain form that works without JavaScript. With JavaScript it also checks fields before sending, says each
problem beside its field, shrinks large photos, shows upload progress and confirms in place. Without it, the
first post is answered with the same form to send once more (this stops scripts); photos must be attached again.

## Place the form

1. In `openblog.json`:

   ```json
   "quote": { "enabled": true, "endpoint": "/api/quote", "notice": "We use these details only to answer your request." }
   ```

   `endpoint` is a path on your site (the default) or an `https://` address; `notice` is optional.
2. In the Landing builder add **Quote request form**, or write a fence in any post or page:

   ````text
   ```quote
   service: Fence repair
   service: New fence
   ```
   ````

   The landing section lists your services and the form lists your service areas as choices. A fence lists the
   services you name (or a text box if none). With `enabled` false both render nothing.

## Set up the hosted function

1. Run [`supabase/quote.sql`](../supabase/quote.sql) in the Supabase SQL editor. It adds one table and one
   private storage bucket, and nothing existing changes. [`quote-rollback.sql`](../supabase/quote-rollback.sql)
   undoes it (empty and delete the bucket in the dashboard first).
2. In Netlify set:

   | Variable | Value |
   | --- | --- |
   | `OPENBLOG_QUOTE_ENABLED` | `true` |
   | `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `OPENBLOG_SITE_ID`, `OPENBLOG_SITE_ORIGIN` | as for [hosted engagement](../netlify/functions/README.md) |
   | `OPENBLOG_QUOTE_SECRET` | a long random value (32 or more characters) that signs form tokens |

3. Deploy. `netlify.toml` maps `/api/quote/*` to the function. Until you set `OPENBLOG_QUOTE_ENABLED` every route
   answers 404.

## Spam controls (no third-party captcha)

Same-origin posts only; a signed single-use form token that must be at least 3 seconds and at most 2 hours old; a
hidden honeypot field; at most 5 stored requests per visitor and 60 per site per hour (the visitor's address is
kept only as a keyed hash); a 4 MB body limit, at most 5 photos of 900 KB, checked by their own bytes (JPEG, PNG,
WebP); and no more than two links in the description.

## Owner notification (optional)

| Variable | Value |
| --- | --- |
| `OPENBLOG_QUOTE_NOTIFY_PROVIDER` | `resend` |
| `OPENBLOG_QUOTE_NOTIFY_API_KEY` | your Resend API key |
| `OPENBLOG_QUOTE_NOTIFY_TO` | your own address; the only recipient |
| `OPENBLOG_QUOTE_NOTIFY_FROM` | a sender on a domain you verified, such as `Acme <quotes@example.com>` |
| `OPENBLOG_QUOTE_ADMIN_URL` | optional `https://` link to put in the email |

The email names the visitor, town, service and photo count only; the phone number and details stay in your
workspace. It never goes to a visitor. If it fails, the request is kept and the failure is recorded.
Set `OPENBLOG_QUOTE_ADMIN_KEY` (32 or more characters, different from every other key) to see failures with
`GET /api/quote/notifications` and retry them with `POST /api/quote/notifications/retry`, both with
`Authorization: Bearer <key>`. A request is tried at most five times.

## Privacy

Visitor values are never logged, never returned by the function and never placed in a page, feed or export.
Photos are kept in a private bucket. Tell visitors what you do with their details in `notice`.

## Checks

`node --test tests/web/netlify-quote.test.mjs tests/web/netlify-quote-notify.test.mjs tests/web/quote-form.test.mjs`
and `cargo test -p openblog-core --test quote_form` run against fakes; no real provider is called.
