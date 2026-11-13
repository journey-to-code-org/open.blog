# Quote requests

Let a visitor ask for a quote from any page: name, phone, town, service, up to five photos and a description.
The request is stored in your private Supabase workspace and never in a static file. It is **off by default**:
a site that never turns it on builds exactly as before. The decisions are in ADRs 0381 to 0384, 0386 and 0387.

This is not a CRM. Listing, marking handled, CSV export and erasure come with the Admin request screen.

> **Where it runs.** The code that receives requests runs as a Netlify function on Netlify, or, on a site run by
> `openblog serve` in the container (the Render setup in [deploy](deploy.md)), as a small service the container
> starts beside the server. Either way the form posts to `/api/quote` on your own site. Pointing `endpoint` at
> the function on another address does not work: the function sends no cross-origin headers, so the browser does
> not let your page read the token it asks that address for.

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
   services you name; a fence that names none lists your published services, like the landing section, and shows a
   text box only when you have none. With `enabled` false the section renders nothing
   and a `quote` fence stays an ordinary code block, as it was before. Feeds and exports never carry the form.

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

### On Render (or any host running the container)

Set the same variables on the Render service (its **Environment** page), with `OPENBLOG_SITE_ORIGIN` set to the
address visitors use, such as `https://your-blog.onrender.com`. With `OPENBLOG_QUOTE_ENABLED` set to `true`, the
container starts `scripts/quote-service.mjs`, which runs the same function code with Node and listens on this
machine only (port 8788, or `OPENBLOG_QUOTE_SERVICE_PORT`). `openblog serve` passes `/api/quote/...` on your site
to it, with the visitor's address as the server saw it, so every spam control below works the same. It also runs the
retention sweep once a few minutes after it starts and then every 24 hours. If the service is not running, a visitor
is told nothing was sent. If it does not answer within 25 seconds, or its answer breaks off, the visitor is told
the request may have been saved and asked to call before sending it again, since the service may still save it. Without `OPENBLOG_QUOTE_ENABLED`, `/api/quote/...` is a missing page, as before.

For Admin on the same service, set `OPENBLOG_QUOTE_ENDPOINT` to `http://127.0.0.1:8788/api/quote` and
`OPENBLOG_QUOTE_ADMIN_KEY` (see **Managing requests in Admin**).

## Spam controls (no third-party captcha)

Same-origin posts only; a signed single-use form token that must be at least 3 seconds and at most 2 hours old; a
hidden honeypot field; at most 5 stored requests per visitor and 60 per site per hour (the visitor's address is
kept only as a keyed hash); a 4 MB body limit, at most 5 photos of 900 KB, checked by their own bytes (JPEG, PNG,
WebP); and no more than two links in the description. Control characters are removed from every field before it is
stored, so Admin can always show what was stored.

Without JavaScript, the browser checks the phone number before sending, and a request the function refuses comes
back as the form with your visitor's typing kept, each wrong field named at the top and marked beside the box, and a
fresh token to send again.

## Owner notification (optional)

| Variable | Value |
| --- | --- |
| `OPENBLOG_QUOTE_NOTIFY_PROVIDER` | `resend` |
| `OPENBLOG_QUOTE_NOTIFY_API_KEY` | your Resend API key |
| `OPENBLOG_QUOTE_NOTIFY_TO` | your own address; the only recipient |
| `OPENBLOG_QUOTE_NOTIFY_FROM` | a sender on a domain you verified, such as `Acme <quotes@example.com>` |
| `OPENBLOG_QUOTE_ADMIN_URL` | optional `https://` link to put in the email |

The email names the visitor, town, service and photo count only; the phone number and details stay in your
workspace. It never goes to a visitor. If it fails, the request is kept and the failure is recorded. The email gets at
most 4 seconds while the visitor waits, so a slow mail provider never makes the visitor wait long or tells them their
saved request was lost; an email that did not go out in that time is recorded as failed (`timeout`) for a later retry.
In Admin's **Quote requests** page (below), a request whose email did not go out says so, and **Send those emails
again** tries them once more. Without Admin, set `OPENBLOG_QUOTE_ADMIN_KEY` (32 or more characters, different from
every other key) to see failures with `GET /api/quote/notifications` and retry them with
`POST /api/quote/notifications/retry`, both with `Authorization: Bearer <key>`. A request is tried at most five times.

## Managing requests in Admin

Run `supabase/quote-v2.sql` once after `quote.sql` (it adds the `archived` status; `quote-v2-rollback.sql` undoes it).
Set `OPENBLOG_QUOTE_ADMIN_KEY` on the hosted function, then where Admin runs set the same key and the function
address:

| Variable | Value |
| --- | --- |
| `OPENBLOG_QUOTE_ENDPOINT` | `https://your-site.example/api/quote`, or `http://127.0.0.1:8788/api/quote` when the quote service runs beside Admin (Render) |
| `OPENBLOG_QUOTE_ADMIN_KEY` | the same key as on the function (32 or more characters) |

A **Quote requests** page then appears in Admin. Requests are newest first; each shows its status as a word, photo
thumbnails and one-tap **copy** buttons for the phone and email. **Mark handled**, **Archive** and **Mark as new**
are the only workflow there is.

- **Export**: choose days (both inclusive) or none for everything, and download a CSV of up to 5000 requests. It holds
  names, phone numbers and details, so keep it private. Cells starting with `=`, `+`, `-` or `@` are made text.
- **Erase**: tick requests, press **Erase**, read the count and photos, then confirm. Photos are first moved aside
  (which can be undone), then the records go in one step, a check confirms none remain, and only then are the photos
  removed. If anything fails before the records go, every request and every photo stays as it was. A photo that is
  already gone from storage does not stop the erase. If a photo cannot
  be removed after its record is gone, Admin says so; no request points to it, and the next erase or retention run
  removes it. A preview is good for 10 minutes and only for the exact list you saw.
- **Retention**: under **Erase archived requests automatically**, write a number of days (1 to 3650) and press
  **Save**; archived requests are then erased that many days after you archived them. **Keep until I erase them**
  turns it off. The choice is kept as a small private file in the photo bucket, so no table changes. Each archived
  request shows its countdown. The daily sweep (the `quote-retention` function on Netlify, or the quote service on
  Render) does it; **Erase expired now** does it on demand. New and handled requests are never erased
  automatically. Whoever runs the function can instead fix the number with `OPENBLOG_QUOTE_RETENTION_DAYS`; then
  that number wins, and Admin shows it and says it is changed there.
- **Erase the old ones now** (Studio, under Requests, **More**, **Clean up archived requests**) never erases on a
  guess. Admin first asks the function what it can do (`GET retention` answers `dryRun: true` and
  `eraseBefore: true`), then counts with a dry run, which erases nothing and gives the cutoff it counted with
  (`before`), asks the owner once, and erases with that cutoff, so a request archived in the meantime is not erased
  uncounted (the cutoff is never later than the retention period allows). A function deployed before these existed
  ignores a dry run and would erase, so Admin sends it nothing that could erase: Studio says the requests service
  needs updating (code `hosted-too-old` in its details). Deploy the current function to fix it.

## Privacy

Visitor values are never logged, never returned by the function and never placed in a page, feed or export.
Photos are kept in a private bucket. Tell visitors what you do with their details in `notice`.

## Checks

`node --test tests/web/netlify-quote.test.mjs tests/web/netlify-quote-notify.test.mjs tests/web/quote-form.test.mjs`
`tests/web/netlify-quote-admin.test.mjs`, `tests/web/admin-quotes.test.mjs`, `tests/web/quote-service.test.mjs`,
`cargo test -p openblog-cli --bin openblog quote_routes`, `cargo test -p openblog-cli --bin openblog quote_relay`
and `cargo test -p openblog-core --test quote_form` run against fakes; no real provider is called.
`tests/browser/quote-form.spec.mjs` also runs axe-core (WCAG 2.1 A and AA) on the form, its errors and its
confirmation, in light and dark. None of this has been tried against a live Supabase project, Netlify, Render or Resend, and the container image
with Node has not been built here.
