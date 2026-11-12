# ADR 0367: Received mentions are pruned by a confirmed retention run, and receiving is pinned by fakes only

- Status: Accepted
- Date: 2026-10-29
- Parent epic: [#387](https://github.com/journey-to-code-org/open.blog/issues/387)
- Story: #402 (task DIST7.2.3)

## Context

The private inbox keeps what a moderator did not publish, so that repeats stay idempotent and a rejection stands.
Participation retention (ADR 0108) is a confirmed run, never scheduled, that purges what is not published after a
period. The hosted store keeps a request only until a pull handles it. The receiving path talks to a hosted database
and to arbitrary sites, neither of which a test may reach.

## Decision

- **Retention.** `webmention.receive.retentionDays` (default 90, 1 to 3650). `openblog mentions prune` lists the
  mentions due: rejected, removed and blocked ones decided more than that many days ago, and pending ones received
  more than that many days ago. `--write` deletes them from the inbox; approved mentions are never pruned. A blocked
  mention's claimed text is already gone; its id remains until pruned, and the block itself stays until lifted. A
  withdrawn mention (its link gone) loses its claimed text at once.
- **Hosted retention** is the pull: a request is deleted once handled, an unreachable one after 72 hours.
  `webmention-rollback.sql` drops the table and its functions and loses only requests no pull has taken.
- **Tests use fakes only.** The core state machine and the published file are unit tests. The command-line tests run
  the real pull, decisions and build over a scripted network and an in-memory hosted store, and check that a dry run,
  a site with receiving off, a blocked host and a refused request contact nothing. The hosted tests run the real
  function over a scripted Supabase and a scripted site and check that the source is never requested, that the inbox
  routes refuse every other key, and that the schema is additive, private and fully rolled back. A site with
  receiving off is checked to build with no endpoint, no section and no manifest.
- **The SQL and the page are run for real, with nothing outside.** `tests/web/webmention-sql.test.mjs` runs
  `webmention.sql` twice and `webmention-rollback.sql` against a scratch Postgres (`OPENBLOG_TEST_PG_URL`, in the same
  CI job as `social-queue-sql.test.mjs`; skipped without one): the public roles are refused, a repeat within a minute
  changes nothing, a later one raises the version so a settle at the old version deletes nothing, the host and site
  limits hold, and two requests at once with room for one let exactly one in under the per-site lock.
  `tests/browser/webmention-mentions.spec.mjs` opens a built post in a browser: the section is a region named by
  its heading, a hostile title is shown as text, no image or script is on it, each link is reached by Tab with a
  visible focus, it is the same with JavaScript off and fits 320px, and an opted-out post shows nothing.

## Consequences

- Nothing is deleted without the author running it, as with participation retention.
- No test reaches a real Supabase project or a real sending site; a live check after deploying is the deployer's.
