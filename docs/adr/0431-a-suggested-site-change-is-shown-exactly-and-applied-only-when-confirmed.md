# ADR 0431: A suggested site change is shown exactly and applied only when confirmed

- Status: Accepted
- Date: 2026-11-16
- Builds on: [ADR 0430](0430-first-run-answers-are-per-sign-in-preferences-not-site-settings.md)
- Spec: [Studio ONB1](../specs/studio/onb1/architecture.md)

## Context

Some answers imply the site could be set up to match: a documentation blog wants the `/docs/`
section, a recipe blog the recipe list. Changing `openblog.json` because of a first-run answer,
without the owner seeing it, would be a surprise, and could undo what the person who set the site
up chose.

## Decision

- `POST areas/suggestions` takes the kind and answers and returns proposals. A **change** names one
  top-level member and the exact lines it changes (computed with `config_text::set_member`, which
  keeps every other byte); an **open** names a screen instead, for anything that needs her details
  (business facts, decorations, comments, sharing accounts).
- Only two changes exist today, both turning one setting on: `docs.enabled` and `recipes.listing`.
  A suggestion never turns anything off and never edits content.
- `POST areas/suggestions/apply` takes the id and the file's revision as it was shown; a file that
  changed since is refused (409 `stale`) and left alone. The change is recomputed, checked to load,
  written atomically, and answered with the same lines. The site is rebuilt.
- Studio shows the change in her words with **Do this**; the exact lines sit under **For …**.
  Going on without pressing writes nothing.

## Consequences

- Declining every suggestion leaves `openblog.json` byte for byte; an applied one is exactly the
  change shown (route tests).
- A new suggestion is one entry in the server's list and one word id; a change that would turn
  something off needs a new decision.
