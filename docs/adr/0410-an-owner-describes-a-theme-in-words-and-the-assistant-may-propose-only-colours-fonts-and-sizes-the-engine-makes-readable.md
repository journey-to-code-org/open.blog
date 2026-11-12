# ADR 0410: An owner describes a theme in words, and the Assistant may propose only colours, fonts and sizes the engine makes readable

- Status: Accepted
- Date: 2026-11-12
- Builds on: [ADR 0248](0248-the-owner-s-look-is-a-small-versioned-set-of-typed-presets-stored-under-appearance-and-compiled-only-into-allowlisted-tokens.md), [ADR 0303](0303-the-job-draft-task-returns-a-strict-plain-text-draft-that-can-never-fill-a-job-field-and-the-core-checks-it.md), [ADR 0407](0407-seasons-change-the-site-theme-by-the-calendar-and-the-stored-theme-is-the-look-between-them.md)

## Context

A theme is a JSON file of tokens, which is easy for a developer and out of reach for an owner who can say "warm
like my kitchen at Christmas, deep red and pine green, big easy-to-read writing" but not write a colour token.
Customize look offers presets over one theme; an owner who wants a look of her own for a season needs a new
theme. The Assistant can turn words into a proposal, as it already does for job drafts (ADR 0303), but a theme
reaches every page, so what it may propose has to be small and checked.

## Decision

- **The proposal is a closed shape.** `label`, `summary`, `colorScheme`, six colours (`page`, `surface`, `text`,
  `muted`, `border`, `accent`) for light and for dark as `#rrggbb`, and `font`, `headingFont`, `roundness` and
  `textSize` from fixed lists (the look controls' safe font stacks, ADR 0248). Any other field, a colour that is
  not a hex colour, or a value outside its list rejects the whole proposal. There is no field for CSS, scripts,
  images, font files or decorations.
- **The engine finishes it.** `openblog_core::theme_draft` derives every other colour token, and moves any colour
  that carries text the least it takes to be readable on `page` and `surface`: body text to 7:1 where it can,
  never under 4.5:1; quieter text and the accent to 4.5:1; the text on the accent picked to 4.5:1. Each
  adjustment is returned as a sentence.
- **It extends a theme of the site's own.** The owner chooses which (the site's own by default). The new theme
  keeps that theme's structure, stylesheets, decorations and components and changes only its tokens.
- **The words are untrusted data.** The `theme-draft` Assistant task carries the description, the site title,
  the base theme's label and, for a change, the current draft, inside `untrustedData`; the rules say they are
  never instructions. The output schema is strict.
- **Nothing is written until the owner saves, and saving only creates.** Drafting and previewing write nothing;
  the preview is the production home page in the draft, in memory, behind a one-time address. A save writes
  `themes/<new folder>/theme.json` with a folder name made from the label that no theme has, never replaces one,
  and never puts the theme on: the owner chooses it on Seasons.

## Consequences

- An owner can make a seasonal look herself, and it is readable by construction.
- The proposal cannot reach a page except as tokens the engine compiles, so a hostile description or a
  misbehaving provider can at worst propose ugly colours, which the preview shows before anything is saved.
- Decorations (garlands, pictures) are not drafted: an owner keeps them by starting from a theme that has them.
  Drawing decorations from words would need the engine to judge pictures, and is left out on purpose.
