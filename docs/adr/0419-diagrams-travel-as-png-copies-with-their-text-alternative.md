# ADR 0419: Diagrams travel as PNG copies with their text alternative

- Status: Accepted
- Date: 2026-11-13
- Epic: [#566](https://github.com/journey-to-code-org/open.blog/issues/566) (tasks #584, #585, #586)
- Builds on: [ADR 0416](0416-diagrams-are-rendered-at-build-time-by-merman-on-by-default.md),
  [ADR 0417](0417-diagram-colours-are-the-looks-variables-with-the-renderers-colours-as-fallback.md)

## Context

On the site a diagram is inline SVG. Everywhere else, an `<img>` of the SVG file was the first plan, but feed
readers, email clients and the cross-posting destinations often refuse SVG images or strip them, and none
that open.blog posts to was found to draw Mermaid source itself: DEV, Hashnode, Ghost, WordPress, Medium,
LinkedIn and the rest either show the fence as code or need a plug-in the author may not have. A link
preview (`og:image`) must be a PNG or JPEG of a known size. Each provider manifest also has to say what it
does with a diagram, so a capability added later fails closed rather than being silently dropped.

## Decision

- **Every diagram gets a PNG copy beside its SVG** (`assets/diagrams/<digest>.png`), drawn by the same
  renderer from the same source, in the renderer's own light colours on white, with its bundled font, at
  most 800 points on a side at 2× scale. The bytes are the same on every machine, so the file is cached and
  compared like the SVG.
- **Portable copies use the PNG**: portable HTML and Markdown, Markdown bundles, RSS and JSON Feed show
  `<img src="…png" alt="Title: description">` followed by the diagram's source as text, so a reader of a copy
  has the picture, its text alternative and the source. Without the PNG feature (a build without
  `diagram-png`) the SVG file is used as before.
- **Provider manifests gain a `diagram` capability.** Every built-in provider declares it `unsupported`:
  none is verified to draw Mermaid, so all receive the PNG copy with its alternative text and the canonical
  link. The policy versions are raised, so approvals made before diagrams were declared are reviewed again
  (YouTube's stays above the built-in version, as its adapter requires). A provider that later draws diagrams
  natively changes this in its manifest and its tests.
- **A diagram can be the post's cover.** `coverDiagram: N` names the Nth diagram in the post. Its card image,
  `assets/diagrams/<digest>.card.png`, is the drawing fitted inside a margin and centred on a white
  1200 × 630 canvas, so a link preview shows the whole diagram uncropped. It becomes the post's cover: the
  page's `og:image`, its `coverAlt` (the diagram's text alternative unless the author writes one), and the
  image `openblog card` checks, which draws it into `.openblog/diagram-cards/` to measure it. `coverDiagram`
  and `cover` together, a number out of range, or a post without diagrams is an error.

## Consequences

- Copies of a post look the same in every reader and destination, at the cost of a raster image instead of
  scalable text; the text alternative and the source travel with it.
- The PNG is drawn in light colours whatever the look, because the place it is shown has no page stylesheet.
- PNG drawing adds `resvg` and `tiny-skia` to the native build; the WebAssembly module does not draw PNGs.
- A destination that starts drawing Mermaid is a manifest change, not a renderer change.
