# ADR 0417: Diagram colours are the look's variables, with the renderer's colours as the fallback

- Status: Accepted
- Date: 2026-11-13
- Epic: [#566](https://github.com/journey-to-code-org/open.blog/issues/566) (tasks #576, #578)
- Builds on: [ADR 0416](0416-diagrams-are-rendered-at-build-time-by-merman-on-by-default.md)

## Context

The renderer paints a diagram with fixed colours from Mermaid's default look: near-black text, pastel node fills,
grey lines and a dozen saturated hues for branches and borders. On a dark page that is a bright rectangle with
pastel boxes, and it ignores the look the author chose. Rendering twice (once per scheme) would double the bytes
and still not follow a reader's colour-scheme toggle or a look changed after the build. The same SVG is also
written as a file for feeds and exports, where no page stylesheet applies.

## Decision

- **Every colour the renderer chose becomes a variable with its own value as the fallback**:
  `fill:var(--ob-diagram-fill, #eaeaea)`. On a page the variables come from the look; in a feed, an export or the
  file opened on its own, the fallback is what shows, so those look as the renderer drew them.
- **Ten variables, each made from the look's own tokens** in `web/base.css`, beside `.ob-diagram`: text
  (`--ob-color-text`), fill (`--ob-color-surface-raised`), line (`--ob-color-muted`), a highlight (14% of the
  accent over the raised surface), and six accents, each 60% of a fixed hue mixed with the text colour, so they
  are dark on a light page and light on a dark one.
- **A colour's role comes from what it looks like.** Very dark is text; near-grey is a fill when light and a line
  otherwise; a light tint is a highlight; anything else is an accent by hue (six bands). Lines (`stroke`,
  `border`) never take a fill's role. Presentation attributes cannot hold `var()`, so a rewritten colour attribute
  moves into the element's `style`; the SVG boundary parses and checks the result again.
- **Colours the author wrote are kept as written.** Hex, `rgb()`, `hsl()` and named colours in `style`,
  `classDef` and `linkStyle` lines are left alone. Because they do not follow the scheme, a `style` or `classDef`
  that sets a `fill` must also set `color`, and the pair must reach 4.5:1; otherwise the diagram does not publish
  (drafts and previews warn), with the line and the ratio in the message.
- **Fonts** follow the look's body font, with the renderer's as the fallback.
- **Print** sets every variable to black or white, and **forced colours** to `CanvasText` and `Canvas`.
- **Checked.** `diagram_contrast.rs` reads the hues and amounts from `base.css` and checks, for every curated look
  and bundled theme in light and dark, text on fill, highlight and page (4.5:1), lines on page and fill (3:1),
  each accent on page and fill (3:1) and fill-coloured text on each accent (4.5:1).

## Consequences

- One SVG serves light, dark, print, forced colours and every look, and follows the reader's toggle without a
  rebuild.
- Mermaid's own themes (`%%{init: {theme: ...}}%%`) stay unsupported, as configuration directives already were.
- An author who wants exact colours writes them in `style`/`classDef` with a text colour, and owns their contrast.
- A renderer upgrade that introduces new colours needs no change here: any colour is classified. The fixture
  corpus screenshots are the check that the classification still reads well.
