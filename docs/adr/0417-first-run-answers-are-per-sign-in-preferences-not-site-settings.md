# ADR 0417: First-run answers are per-sign-in preferences, not site settings

- Status: Accepted
- Date: 2026-11-16
- Builds on: [ADR 0416](0416-studio-shows-feature-areas-chosen-per-sign-in.md), [ADR 0415](0415-the-old-admin-is-retired-and-admin-redirects-to-studio.md)
- Spec: [Studio ONB1](../specs/studio/onb1/architecture.md)

## Context

The questions About your blog asks ("What will you mostly write?") and the areas they tuck away are
about what one person wants to see, not about what the site publishes. The old Admin kept per-account
Personalize preferences (version 1) in `.openblog/private/admin-preferences/<sha256>.json`; R15
retired its `GET|PUT preferences` route and tests that it answers 404.

## Decision

- **Version 2 of the same private file**, one per sign-in: `schemaVersion: 2`, `onboarding: { state:
  pending | done | skipped, version, at }`, `kind`, `answers` (question → choice), `areas: { shown,
  hidden }`, `showEverything` and `storyMarks`. Every other key the file had is kept on a save, so
  R9's reading of `voiceInvitationDismissed` is unchanged. 0600, replaced atomically, never built,
  never in `openblog.json`, feeds or exports.
- **A new route, `GET|PUT areas`,** not the retired one: same 16 KiB limit, a revision (`etag`) that
  a save must name, 409 `stale` with the newer preferences. Unknown questions, choices, areas and
  kinds are dropped, never stored. Owner sign-ins only.
- **No file is `pending`, with nothing hidden.** Getting started opens About your blog first while a
  sign-in is pending; nothing else asks, so a site with Getting started off sees no change.
- **A v1 file is a sign-in already set up** (`done`). Studio never honoured the old presets, so they
  aren't applied now: `full` becomes Show everything, the `research`/`evidence` panes become Research
  and `analytics` Readers; nothing else carries over. It is read as v2 in memory and written as v2
  only on a save.
- **`openblog init --kind`** records the kind in `.openblog/onboarding.json` as a hint Studio
  preselects; each sign-in still answers for itself.

## Consequences

- Grammi and Mikey on one site see different Studios.
- A rehearsal (Getting started's practice run) applies answers to that window only, so nothing of
  hers is decided by whoever rehearses.
