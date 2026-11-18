# ADR 0433: A choice setting may read more choices from a file of the theme's own

- Status: Accepted
- Date: 2026-11-17
- Builds on: [ADR 0408](0408-a-theme-offers-components-an-owner-places-with-a-form-and-a-section-holds-only-a-name-and-checked-values.md),
  [ADR 0409](0409-components-with-a-zubra-source-are-rendered-ahead-by-the-zubra-command-when-it-is-installed.md)

## Context

A component's `choice` setting writes its choices in `theme.json`, at most 50 of them. That suits a
countdown sign with a handful of holidays. It does not suit a component whose list is made elsewhere and
keeps growing: open.parlor's `<card-room>` can deal 79 games and gains more, so its form offered three
(Palace, Spades or both) and every new game meant editing each theme's `theme.json` by hand.

Asking the parlor for its list when Admin opens the form would never need updating, but the build checks
every stored value against the choices (ADR 0408), so it would need the network too, and a page would stop
building when another site was down or changed its list.

## Decision

- **A `choice` setting may name a `choicesFrom` file**: a `.json` file inside the theme folder, held to the
  same rule as `script` and `source` (relative, no `..`, never an address elsewhere).
- **The file lists choices** as an array of `{ "value", "label" }`, or an object holding that array as
  `choices`, so a manifest can carry other keys of its maker's.
- **Its choices follow the ones written in `theme.json`.** A value already offered keeps its first label. An
  older release ignores `choicesFrom` and offers the written choices alone, so a component can ship both and
  work on either.
- **Up to 500 choices with a file; still 50 written in `theme.json`.** Each value and label in the file is
  one line of at most 120 characters.
- **The file is read when the themes are loaded**, before a theme resolves, so everything after that (the
  check of a landing section's values, inheritance through `extends`, Admin's form) sees one list and is
  unchanged. A file that is missing, is not a list of choices, or brings the setting past 500 stops the build
  naming the theme, the component and the file.
- **A refused value says the first twelve choices** and how many others are listed, not all of them.

## Consequences

- A component's maker ships its list beside its script, and an owner updates it by replacing one file. No
  `theme.json` is edited when the list grows.
- The list is still fixed at build time: nothing is fetched, and a stored value is checked as before. A game
  the file no longer lists stops the build naming the section, as a removed choice always has.
- Admin's form shows a longer select. Past a few hundred choices a setting wants a different control, which
  is why the limit is 500 and not higher.
- Themes held in memory without a folder (the bundled base theme, a look being drafted) have no file to
  read: a setting there needs its choices written out.
