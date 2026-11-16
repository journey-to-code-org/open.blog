# ADR 0416: Studio shows feature areas chosen per sign-in

- Status: Accepted
- Date: 2026-11-16
- Builds on: [ADR 0415](0415-the-old-admin-is-retired-and-admin-redirects-to-studio.md)
- Spec: [Studio ONB1](../specs/studio/onb1/architecture.md)

## Context

open.blog has grown dozens of parts: recipes, trade sites, seasons and greeting cards, sharing to
other sites, research, teaching, writing together. Studio showed each once the site was set up for
it, and some (Pages, Collections, Decorations, Readers) always. A family cook met cross-posting and
code; a technical writer met decorations and recipe boxes. Hiding needed one rule that every screen,
Find item, Home line and Write choice obeys, and that can never hide something the site uses.

## Decision

- **One catalog** (`web/studio/parts/area-rules.js`): eleven areas that can be tucked away
  (`pages`, `collections`, `recipes`, `trade`, `seasonal`, `sharing`, `readers`, `research`,
  `teaching`, `code`, `together`), each with a name and one line in her words, and the blog kinds
  that turn them on. The server keeps the same ids (`admin_preferences::AREA_IDS`); a test compares
  them.
- **Essentials are not areas.** Home, Posts, Write, Pictures, Look, Front page, People,
  Notifications, the writing helper, Your writing voice, My stories, Getting started, About your
  blog and What you use always show.
- **Every screen picks its area** in `SCREEN_AREAS` (or `null`, essential); a test parses
  `screens/index.js` and fails for a screen that isn't listed. Find items follow their address;
  Write's kinds, the add menu and Home's lines ask `areaVisible(meta, id)`.
- **Hiding is a list of hidden areas.** An area added later shows until someone hides it, so a new
  screen never vanishes silently. **Show everything** overrides the list without losing it.
- **What the site uses always shows** (`meta.areasInUse`, computed by the server from the files and
  settings on every `meta`, one front-matter parse per post, nothing stored). Writing together
  counts while the sign-in takes part in one. Plain code examples and the visitor counter don't
  count: every new site has both, and hiding the add menu's code items or Readers loses nothing she
  made.
- **Hidden is one step away:** a hidden area's address shows "<Area> is turned off for you" with
  **Turn it on**; Find lists **Turn on <Area>**; What you use has a switch.

## Consequences

- A new screen is born with an area, or the test says so.
- Per sign-in, so two people on one site can see different Studios ([ADR 0417](0417-first-run-answers-are-per-sign-in-preferences-not-site-settings.md)).
- Something not yet in Studio (audio episodes, a documentation editor) joins the catalog with its
  screen.
