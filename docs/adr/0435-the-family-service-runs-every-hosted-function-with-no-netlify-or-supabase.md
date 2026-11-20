# ADR 0435: The family service runs every hosted function, with no Netlify or Supabase

- Status: Accepted
- Date: 2026-11-19

## Context

open.blog's hosted functions were written for Netlify and kept their data in Supabase. The family
service (`service/`) already ran three of them on Railway (notes, greeting cards, gifts) over Railway's
own Postgres, with PostgREST giving the functions the address shape Supabase has. A site whose editor
was on Railway still needed Netlify for push, quote requests, Webmentions and social publishing, and
its owner had two hosts and two databases to look after. open.blog's own site wants to leave Netlify
too.

## Decision

- **Every function runs in the service, unchanged.** Each is reached at `/api/<name>/…`; anything else
  under `/api/` is engagement, as before. A function that isn't in the engine version is skipped.
- **The schedules run in the container**: greeting cards hourly, the quote retention sweep daily, the
  social worker each minute when social publishing is on and has its worker key (pg_cron did this on
  Supabase; `social-cron.sql` is never applied here).
- **Bodies keep their bytes.** A body that isn't text reaches the function as base64 with
  `isBase64Encoded`, as Netlify hands it over. A quote request may be 6 MB; everything else keeps the
  256 KB limit.
- **Quote photos go to a folder** (`OPENBLOG_STORAGE_DIR`, a volume), answering the few Storage calls the
  quote store makes, through the loopback bridge with the service key only. A signed link (an HMAC of the
  object and its expiry, under a key derived from the service secret) opens one object until it expires,
  on the service's public address, and only ever sends an image. Object keys are a few plain segments;
  nothing can climb out of the folder.
- **The functions accept the loopback database address** (`http://127.0.0.1:<port>`), which only the
  service sets, as greetings and gifts already did. Every other address must still be https.
- **The database is set up from the features switched on**: the SQL files of each enabled feature are
  applied once per change, unless `OPENBLOG_SERVICE_SQL` says otherwise.
- **The service may serve the site** (`OPENBLOG_SITE_DIR`, built by `service/Dockerfile.site`), doing what
  `netlify.toml` did for pages. A file the build wrote under `/api/` is served before the catch-all.

## Consequences

- A site can run on Railway alone: Postgres, the service, and the editor.
- The Netlify functions stay as they are and keep working on Netlify; nothing is moved out of them.
- A site served by the service is as of its last build: something must rebuild it hourly for posts
  with a future date (docs/deploy.md says how).
- Data already in Supabase isn't moved by this; a site exports it and loads it into the new Postgres.
- Supabase Storage features beyond those few calls (public buckets, image transforms) aren't offered.
