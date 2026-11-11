# ADR 0387: The quote form runs on Render beside the server, the owner sets retention in Admin, and an erase looks before it gives up

- Status: Accepted
- Date: 2026-11-08
- Parent epic: [#474](https://github.com/journey-to-code-org/open.blog/issues/474)
- Stories and tasks: #485, #486, #514, #518
- Amends: [ADR 0381](0381-quote-requests-are-stored-server-side-only-through-a-fenced-visitor-endpoint-that-is-off-by-default.md),
  [ADR 0384](0384-the-owner-manages-quote-requests-in-admin-with-no-crm-and-erases-them-only-after-a-preview-with-a-verified-result.md),
  [ADR 0386](0386-a-bluesky-card-shows-the-posts-own-title-and-a-link-already-in-a-caption-is-read-as-a-reader-sees-it.md)

## Context

A review of ADR 0386's work found three gaps that need no person or outside account:

- **An erase could never finish (#518).** ADR 0386 moves each photo into a hold folder before removing the records.
  A move of a photo that is no longer at its recorded place fails, and the whole erase was then refused. That state
  is reachable: a move whose reply is lost (the photo moved, the call threw) is not counted as moved, so it is not put
  back, and the record still points to the old place. From then on every erase of that request, and every retention
  run that meets it, failed, so other expired requests in the same batch were never erased either. Before ADR 0386
  the same request erased.
- **No quote form on Render (#485, #486, #514).** The site runs on Render with `openblog serve`. The function that
  receives requests ran only on Netlify, so the site had no `/api/quote` address there and the docs said to leave
  the form off.
- **Retention only where the function runs (#518).** The number of days an archived request is kept was read only
  from `OPENBLOG_QUOTE_RETENTION_DAYS`, which a non-technical owner on a phone cannot set.

## Decision

1. **An erase looks before it gives up.** When a move fails, the erase lists the photo's folder. If the photo is
   still where its record says, the move really failed: every photo already moved is put back and the erase is
   refused, as before. If it is gone from there but is in the hold folder (the move happened), it counts as moved, so
   a later failure puts it back and a success removes it. If it is in neither place, there is nothing to keep, and
   the erase goes on. A failed listing is a failed erase.
2. **On Render the same function runs beside the server.** The container installs Node, and when
   `OPENBLOG_QUOTE_ENABLED` is exactly `true` its entrypoint starts `scripts/quote-service.mjs` (started again if it
   stops). That service wraps the very handler Netlify runs and the daily retention sweep, and listens only on
   `127.0.0.1` (port 8788, or `OPENBLOG_QUOTE_SERVICE_PORT`). `openblog serve` passes `/api/quote/...` on the site to
   it under the same switch, so the form posts to its own site exactly as on Netlify, and every fence of ADR 0381 is
   the same code. The server never connects anywhere but loopback; passes on only `Content-Type`, `Accept`, `Origin`
   and `Authorization`; puts the visitor's address it worked out (behind a trusted proxy, the address the proxy saw)
   in `X-Forwarded-For`, never one the visitor wrote; returns only the reply headers a page needs; bounds the body to
   6 MiB, what Netlify lets through to the function (five photos the form allows can be over the function's own
   4 MiB + 64 KiB, and must still reach it so the visitor sees its "Photos too large" page, not a bare error); and gives up after 25 seconds. If the service is not running, a visitor is
   told plainly that nothing was sent; after a time-out, that the request may not have been saved. Off, the address
   is a missing page, as before. Admin on Render reaches the same service at `http://127.0.0.1:8788/api/quote`, which
   the existing endpoint rule already allows.
3. **The owner sets retention in Admin.** Admin's Quote requests page has **Erase archived requests automatically**:
   a number of days from 1 to 3650 and **Save**, or **Keep until I erase them**. The function keeps the choice as one
   small private object, `<site>/settings/retention.json` in the existing photo bucket, so no table changes and
   nothing is published. The host setting `OPENBLOG_QUOTE_RETENTION_DAYS` still works and wins when valid; then Admin
   shows the number, says it is changed where the form runs, and the function refuses a change (`409
   retention-set-by-host`). The daily sweep (Netlify's scheduled function, or the service on Render) and **Erase
   expired now** use whichever is in force. The list says where the number came from (`retentionSource`: `host` or
   `admin`); a reply without it is read as `host`, which is all an older function could mean.

## Consequences

- The container image grows by Debian's Node package. Debian bookworm ships Node 18, which has everything the
  function uses (`fetch`, `AbortSignal.timeout`).
- On Render the daily sweep runs a few minutes after the service starts and then every 24 hours of uptime. A free
  Render service that sleeps runs it less often; **Erase expired now** is always there.
- The retention choice is one new private object in a bucket that already exists. Removing it, or the bucket, turns
  retention off; nothing else reads it.
- No live Supabase, Render or Resend account was tried, and the container image was not built here: the service,
  the relay and the entrypoint are tested against fakes and stand-ins.
