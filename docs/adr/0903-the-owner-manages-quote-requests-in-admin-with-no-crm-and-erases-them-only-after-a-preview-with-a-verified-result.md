# ADR 0903: The owner manages quote requests in Admin with no CRM, and erases them only after a preview, with a verified result

- Status: Accepted
- Date: 2026-10-29
- Parent story: [#486](https://github.com/journey-to-code-org/open.blog/issues/486)
- Tasks: [#517](https://github.com/journey-to-code-org/open.blog/issues/517), [#518](https://github.com/journey-to-code-org/open.blog/issues/518)
- Parent epic: [#474](https://github.com/journey-to-code-org/open.blog/issues/474)
- Builds on: [ADR 0900](0900-quote-requests-are-stored-server-side-only-through-a-fenced-visitor-endpoint-that-is-off-by-default.md) (storage), [ADR 0301](0301-connected-accounts-are-managed-through-admin-routes-that-rebuild-every-reply-from-known-fields.md) (the Admin-to-function proxy pattern)

## Context

Requests live only in the private Supabase workspace. The owner must read them, mark them done, take a copy
and remove them, on a phone, without a CRM: no scoring, no pipeline, no automation beyond a status.

## Decision

- **Admin reaches the hosted function server-side only.** `crates/openblog-cli/src/admin/quote.rs` is a
  proxy like the social one: `OPENBLOG_QUOTE_ENDPOINT` and `OPENBLOG_QUOTE_ADMIN_KEY` come from the
  environment of the process running Admin, never from `openblog.json`. Unset, every route but `status` is a
  404 and nothing is sent. Every route is behind the session, CSRF, JSON and a 16 KB body bound. Each reply
  is rebuilt from known, length-bounded fields; a photo address is accepted only as an `https` signed
  storage URL, and hashes never travel to the browser. The navigation entry exists only when the settings
  exist. The hosted routes (`/requests`, `/export`, `/erase`, `/erase/preview`, `/retention/run`) need the
  same admin key as the notification routes and answer JSON only.
- **Status is `new`, `handled` or `archived`, and nothing more.** `supabase/quote-v2.sql` (rollback
  `quote-v2-rollback.sql`) is additive: it admits `archived`, adds `archived_at` and records schema version
  2; the rollback turns archived requests back into handled ones and deletes nothing. Marking a request
  new again clears both times.
- **The Requests view** lists newest first with a status word and symbol (not colour alone), filters by
  status and service, shows photo thumbnails through short-lived (10 minute) signed URLs with alternative
  text, and offers one-tap copy of phone and email (with a visible fallback when the clipboard is
  refused). Controls are native; focus returns to the changed request; the layout is one column.
- **Export** is CSV for whole days (both ends inclusive, empty means all), at most 5000 rows, built on the
  server, with cells that start `= + - @` made text so a spreadsheet cannot run them. Admin returns it as
  JSON and the page downloads it; the file holds personal data and the page says so.
- **Erase is previewed, confirmed and verified, and failure removes nothing.**
  1. A preview names the count and photo total and returns a token sealed (HMAC) over exactly that id list,
     valid 10 minutes. Erase refuses any other list, an expired token or a request that vanished (409).
  2. Photos are removed first in one bulk call and each request's folder is listed to prove it is empty.
     If either step fails, every row is kept and each row's photo list is rewritten to the files that still
     exist, so no row points at a missing file; the reply is `erase-failed`.
  3. Only then does one `DELETE` statement remove all the rows (atomic in Postgres); the count must match.
  4. A final read must find none of them (`verified: true`), otherwise the reply is `erase-unverified`.
  Storage and Postgres cannot share a transaction, so this is the strongest order: the irreversible
  database step is last, single and checked. The page reports success only from a verified reply.
- **Retention is opt-in and only touches archived requests.** `OPENBLOG_QUOTE_RETENTION_DAYS` (1 to 3650)
  on the hosted function; unset or invalid means archived requests are kept until erased by hand. When set,
  the list gives each archived request an erase date and the page shows "Erased automatically in N days".
  The daily scheduled function `quote-retention` and the "Erase expired now" button run the same erase
  (batches of 100) and stop at the first failed batch. New and handled requests are never erased
  automatically.

## Verified provider facts

- Supabase Storage removal takes a list of object paths, up to 1,000 per call, and deleting through SQL leaves
  files orphaned, so the API is used (<https://supabase.com/docs/guides/storage/management/delete-objects>,
  checked 2026-10-29). The documentation does not state that a multi-file removal is atomic, which is why the
  folders are listed afterward and rows are kept on any doubt.
- Signed URL creation, folder listing and the exact REST shapes are used as the Supabase Storage API
  reference describes them; they are exercised only against fakes here and not re-verified against a live
  project.
- Netlify scheduled functions use `config.schedule` (`@daily`) in the function file; not run against Netlify here.

## Consequences

An erase of a very large photo set can take more than one request; the page erases up to 100 at a time. A
failed erase can leave some photos already gone while their requests remain, with an accurate photo list.
Nothing here emails or contacts a visitor, and no visitor value is logged.
