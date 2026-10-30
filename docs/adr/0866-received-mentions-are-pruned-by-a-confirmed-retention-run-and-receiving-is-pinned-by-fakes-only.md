# ADR 0866: Received mentions are pruned by a confirmed retention run, and receiving is pinned by fakes only

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

## Consequences

- Nothing is deleted without the author running it, as with participation retention.
- The Supabase functions are checked statically here; running them against a scratch Postgres, as
  `social-queue-sql.test.mjs` does, is left for a later change.
