# ADR 0400: Three looks for trades meet AAA contrast and choose large text and bold headings

- Status: Accepted
- Date: 2026-11-11
- Parent story: [#490](https://github.com/journey-to-code-org/open.blog/issues/490)
- Task: [#528](https://github.com/journey-to-code-org/open.blog/issues/528)
- Parent epic: [#475](https://github.com/journey-to-code-org/open.blog/issues/475)
- Builds on: [ADR 0248](0248-the-owner-s-look-is-a-small-versioned-set-of-typed-presets-stored-under-appearance-and-compiled-only-into-allowlisted-tokens.md), [ADR 0399](0399-the-trade-starter-writes-only-what-it-can-state-truthfully-and-keeps-its-examples-as-drafts.md)

## Context

A trade site is read on a phone, often outdoors, by someone who wants to call. The eight curated looks are tuned
for reading a blog: they meet AA (body text 7:1, everything else 4.5:1) and leave text size alone. The story asks
for looks that read as a business: high contrast, large tap targets and a phone number that stands out.

## Decision

- **Three curated looks for trades**, after the eight: **Workshop** (black on white, deep rust accent), **High-vis**
  (safety yellow on charcoal at night, dark olive on cream by day) and **Blueprint** (drafting blue). Each
  description starts "For a trade:", so the picker says who it is for in words. They are data in core like the
  others (`look_presets::LOOKS`, `PALETTE_IDS`), marked `for_trades`, and the Admin catalog carries `forTrades`.
- **AAA, tested.** In light and dark, on the page and both surfaces: body text at least 12:1, muted and subtle text
  and the accent at least 7:1, and borders at least 1.8:1 against the page. The existing AA test still covers them,
  and so does the test that every accent stays readable on every bundled theme.
- **Bigger by default.** Applying a trade look (server `apply` and Admin's `applyCurated`, kept in step by tests)
  also chooses `textSize: large` and `headingWeight: bold`, but only where the owner has not chosen a size or a
  weight: a choice the owner made is never overwritten. Every other look still leaves them alone. Because sizes
  are in `em`, every control and tap target grows with the text.
- **The phone number as the main action.** On the landing page's Business facts section, the phone link is a solid
  button at least 52px tall in the accent, with the accent's own contrast token as its text color and an outline
  in forced-colors mode. This is base CSS, not part of the look, because a look may only write allowlisted
  tokens (ADR 0248); it uses only tokens, so every theme and look keeps it readable.
- **The trade starter opens in Workshop** (ADR 0399), so a new trade site reads as a business from its first build.

## Consequences

`PALETTE_IDS` has 11 entries; an older release refuses a site whose `appearance.palette` is one of the new ids,
as it refuses any value it does not know. The footer's phone link is unchanged.
