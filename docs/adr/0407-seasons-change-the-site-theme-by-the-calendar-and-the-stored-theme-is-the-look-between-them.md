# ADR 0407: Seasons change the site theme by the calendar, and the stored theme is the look between them

- Status: Accepted
- Date: 2026-11-12
- Builds on: [ADR 0354](0354-seasonal-topics-are-bundled-per-trade-the-site-stores-only-its-changes-and-absent-means-off.md), [ADR 0307](0307-the-business-facts-screen-edits-one-member-of-openblog-json-as-text-checked-against-a-revision-of-that-member-and-problems-are-said-beside-the-field.md)

## Context

A family recipe site (Grammi's House) decorates for holidays the way its owner decorates her house:
autumn leaves for Thanksgiving, lights and snow for Christmas, the plain house the rest of the year.
Themes already carry everything a season needs, and a series' theme already keeps a holiday's posts
dressed for it. What was missing was changing the *site* theme on a date, and any way to change the
site theme from Admin at all: the owner was asked to edit `openblog.json`.

## Decision

- **A season is a window and a theme.** `seasons` is
  `{ "version": 1, "enabled": true, "windows": [ { "theme", "start", "end" } ] }`. Days are `MM-DD`, read
  with the seasonal reminders' `MonthDay` (ADR 0354), so `02-29` and windows across the new year behave
  the same in both features.
- **The stored `theme` is the look between seasons.** While `enabled`, a load with a clock wears the
  first window that holds today's UTC day; any other day it wears `theme`. Turning the calendar off keeps
  the windows for next time and puts nothing up.
- **Applied where the clock already is.** The season is put on when a site is loaded with `now` (the same
  moment scheduled posts are judged), by replacing the theme in memory. `openblog.json` is never rewritten
  by a build, and a load without a clock (tests, exports) uses `theme` as written, so pure builds stay
  deterministic.
- **Names are checked every day, not only in season.** Every theme a window names must exist, or the build
  stops naming it, so a mistake is found in November rather than on December 1.
- **A server wakes for it.** The build report's next due moment is the earlier of the next scheduled post and
  the next midnight on which the worn theme changes, so `openblog serve` redecorates on time with the
  scheduler it already has.
- **One Admin screen owns `theme` and `seasons`.** **Seasons** (`#/seasons`) edits both members as text
  (`config_text::set_member`, as ADR 0307), checked against a revision of those two members alone, and refuses
  a theme that does not exist. It is in the simple navigation beside **Customize look**.
- **Absent means off.** With no `seasons`, nothing is written back and every page builds byte for byte as before.

## Consequences

- An owner can change the site's theme from Admin for the first time, with or without the calendar.
- Seasons are UTC days. A site in a far timezone sees decorations change a few hours early or late; a
  per-site timezone would fix this for scheduling too and is left for when scheduling needs it.
- Look controls (`appearance`) still apply over whichever theme is worn. A seasonal theme that wants its
  colours kept lists only the controls it honors in `customizable`.
