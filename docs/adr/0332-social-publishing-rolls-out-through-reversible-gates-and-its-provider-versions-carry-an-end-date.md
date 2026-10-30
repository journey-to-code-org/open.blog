# ADR 0332: Social publishing rolls out through reversible gates, and its provider versions carry an end date

- Status: Accepted
- Date: 2026-10-29
- Parent epic: [#353](https://github.com/journey-to-code-org/open.blog/issues/353)
- Story: #360 (task #380)

## Context

The setup of social publishing is spread over five SQL files, about thirty settings in two places (the hosted
functions and the Admin machine), two provider apps, Supabase Vault and a cron job. Each story documented its own
part in `docs/social-publishing.md`, so the guide was correct piece by piece but had no order, no single rollback, no
rotation steps for most secrets and no troubleshooting. Checking it against the code and the providers on 2026-10-29
found four real faults:

1. The LinkedIn default `Linkedin-Version`, `202510`, was sunset by LinkedIn on 2026-10-15 (LinkedIn's
   [migration table](https://learn.microsoft.com/en-us/linkedin/marketing/integrations/migrations); versions are
   served for at least a year, [versioning](https://learn.microsoft.com/en-us/linkedin/marketing/versioning)). Every
   deployment that kept the default could no longer post.
2. `supabase/social-rollback.sql` dropped the tables but left the `openblog-social-worker` cron job and its ping
   function, so after a full rollback Supabase kept sending the worker key to the worker every minute.
3. The guide said Netlify functions time out after 10 seconds by default; Netlify's
   [function configuration](https://docs.netlify.com/build/functions/configuration/) now lists 60 seconds.
4. `netlify.toml` cited ADR numbers that never existed (left over from a renumbering).

## Decision

- **The rollout is eight gates, each with a check and an undo.** Storage (`social.sql`), the hosted function, the
  Admin machine, the provider apps, scheduling, delivery (`social-queue.sql`, optionally `social-history.sql`), the
  schedule (Vault plus `social-cron.sql`), and optional operations (`social-ops.sql`). The guide's "Rolling it out,
  step by step" lists them in dependency order. Each check is something an owner can run (a status code, one SQL
  query, one Admin screen), and each undo returns to the gate before it.
- **One rollback order.** Stop the hosted function (`OPENBLOG_SOCIAL_ENABLED`), hide Admin, export, run
  `social-rollback.sql`, delete the Vault secrets, revoke the provider apps, and delete the token keys last.
  `social-rollback.sql` now stops the cron job and drops its ping function first, inside a block that does nothing
  on a database without `pg_cron`, so it is still safe to run anywhere and twice. It still keeps every extension
  and the Vault secrets: those can be shared with other things, so deleting them is a separate, named step.
- **Every secret has a rotation procedure** that never loses or duplicates an announcement: admin key (Admin reports a
  setup problem in between), worker key (runs in between are refused and work waits), Supabase secret key (tokens are
  sealed by the token keys, so they stay readable), token keys (prepend, never remove a key in use), and provider
  client secrets (reconnect if the provider ends grants). There is one admin key and one worker key at a time; a
  rotation has a short window of refused calls rather than two valid keys, which is the safer failure.
- **Rate limits and troubleshooting cite the providers** with the date they were checked, and map each symptom to the
  alert code, SQL query or Admin message that confirms it.
- **Provider default versions carry an end date.** `VERSION_SUPPORT` in `netlify/lib/social-providers.mjs` records, for
  each default API version, the date its provider said it stops being served, when that was checked and where. The
  LinkedIn default moves to `202610` (served until 2027-10-15); Facebook stays `v23.0` (until 2027-10-08, Meta's
  [version list](https://developers.facebook.com/docs/graph-api/changelog/versions/)). A deployer's own
  `OPENBLOG_SOCIAL_<PROVIDER>_API_VERSION` is not checked at run time: refusing it on a date would silently stop
  delivery, and the deployer owns that choice.
- **Release gates keep the guide true** (`tests/web/social-release-gates.test.mjs`, run in CI): every setting the
  social code reads is in the guide; each bounded setting's range in the guide is the range the code accepts; every
  social SQL file has a rollback and both are named; the rollout lists the SQL in dependency order and the rollback
  in its order; the rotation section covers every secret; the full rollback stops the job before dropping tables and
  drops only `openblog_social_*` objects (and, against a real Postgres, leaves another job alone); each default
  provider version is still inside its recorded window; and every ADR the social code, SQL, settings and guide name
  exists. The version check depends on today's date by design: when a default expires, CI fails until someone
  checks the provider and moves it.

## Considered options

- **Leave the version default alone and only document it.** Rejected: the default was already broken, and the
  guide is not read again after setup.
- **Check the configured version against a table at run time.** Rejected for now: a stale table would block a
  version the provider still serves, and blocking stops delivery for a reason the owner cannot see in Admin.
- **Make `social-rollback.sql` delete the Vault secrets too.** Rejected: Vault may hold secrets with similar names
  for other tools, and the guide names the delete explicitly; the cron job, which actively sends the key, is the part
  that must stop.
- **Accept two admin keys during rotation.** Rejected: it doubles what can leak for the sake of a window measured in
  one redeploy.

## Consequences

- A release that touches social publishing cannot ship a guide that names a missing setting, file or ADR.
- About once a year, CI fails on the provider version check until the default is re-verified and moved. That is the
  intended reminder; the fix is a one-line change plus the fixtures that assert the default.
- The live rollback test adds a stand-in `cron` schema only on a database without `pg_cron`, and removes it.
