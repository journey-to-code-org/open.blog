# ADR 0434: A component setting may set things down on a picture

- Status: Accepted
- Date: 2026-11-19
- Builds on: [ADR 0408](0408-a-theme-offers-components-an-owner-places-with-a-form-and-a-section-holds-only-a-name-and-checked-values.md),
  [ADR 0433](0433-a-choice-setting-may-read-more-choices-from-a-file-of-the-themes-own.md)

## Context

A theme component is set up with a form of plain settings (ADR 0408). A Christmas tree built that way had
twelve fixed branches, each a list to choose an ornament from. Its owner wanted to hang things where she
liked on a picture of the tree, the way one decorates a real one, and a fixed set of choice settings cannot
say "here".

## Decision

- **A new setting type, `places`.** It names a `picture` (an image file in the theme folder), `choices` (each
  a `value` of lowercase letters, digits and hyphens, a `label`, and optionally its own `image`, also a theme
  file), and `max`, how many it holds (24 when unsaid, at most 60).
- **Its value is one string**, `kind@x,y;kind@x,y`, each kind one of the choices and each spot two whole
  numbers from 0 to 100 (across and down the picture). The server checks it like every other value and writes
  it back the one way it is ever written; anything else is refused. Empty means nothing is set down. Nothing in
  it can be a style, an address or markup, so the section still holds only a name and checked values.
- **Studio draws the picture** and lets the owner choose a thing, tap where it goes, pick one up and drag it,
  or do all of that from the keyboard (Shift and Enter adds one; the arrows move it; Delete takes it off).
  Every step is said in words ("Bell is at the bottom left now"), and the things are listed as buttons under
  the picture, so the picture is never the only way in.
- **The component draws it on the site.** How a spot maps onto its own drawing is the component's business.

## Consequences

- A theme can offer anything arranged on a picture (a tree, a mantel, a wreath) with no new code in Studio.
- An older release refuses a theme with a `places` setting, so a theme that uses it needs this release.
- Spots are coarse (a hundredth of the picture); fine enough for ornaments, not for drawing.
