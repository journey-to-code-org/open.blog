# Diagrams

Status: implemented for epic #566 (DIA1). The author's guide is [Diagrams](../diagrams.md).

## Contract

A diagram is a fenced code block whose info string's first word is `mermaid`. The rest of the info string is
`key=value` options, separated by whitespace, with `"` or `'` quoting: `title`, `description`, `caption` and
`source` (a safe site path or an `https://`/`http://` URL). Each value is nonempty and at most 1,024 bytes; an
unknown, repeated, unquoted-with-trailing-text or unclosed option is refused. The source is at most 16 KiB.

The text alternative is required: the title is the diagram's `accTitle` if it has one, else the fence `title`;
the description is `accDescr`, else the fence `description`. A C4 diagram needs a fence title, because the
renderer maps C4 `accTitle` to its ordinary title. The accessible values are compared with what the renderer
parsed, so a line that only looks like `accTitle:` inside a label or `accDescr` block is refused. `---`
front matter and `%%{...}%%` directives are refused.

Supported families: flowchart/graph, sequence, class, state, entity-relationship, git graph and C4
(merman 0.10.0, ADR 0416). Rendering is strict, with plain SVG labels, a 200-item model budget, a 1 MB SVG
budget, the renderer's own deadline and a hard 5-second wall-clock deadline after which the work is cancelled
and the diagram refused.

## Output

`<figure class="ob-diagram">` holds the inline SVG (`role="img"`, with `aria-labelledby` naming its `<title>` and
`<desc>`), an optional `<figcaption>`, the node-link list, an optional source link, and
`<details><summary>Show diagram source</summary>` with the source. The SVG passes an allowlist sanitizer:
known elements and attributes only, no scripts, event handlers, `foreignObject`, external references or
style URLs, and `a` only as a node link (ADR 0418). Each diagram is also written to
`assets/diagrams/<blake2s-256 of the SVG>.svg`, and with the `diagram-png` feature a PNG copy beside it
(ADR 0419).

Colours are rewritten to `var(--ob-diagram-*, <renderer colour>)` and fonts to the look's body font
(ADR 0417). Authored `style`/`classDef` colours are kept; a fill without a `color` reaching 4.5:1 is a finding.

## Publication gate

`openblog check`, `openblog build`, Git and Admin Publish share one gate. On a published post, page or series
description, a diagram that is invalid, inaccessible, too large, too slow, has an unreadable authored colour
pair or links to a page the build does not write stops the build with the file, line and fix. Drafts and
previews report the same finding as a warning and render the rest. Admin refuses to save a published post
with such a diagram and saves it as a draft.

`coverDiagram: N` (ADR 0419) must be 1 to the number of diagrams in the post and is exclusive with `cover`.

## Admin preview parity

The Admin editor loads `web/admin/diagram-wasm/`, `openblog-wasm` built with `diagram-rendering`, only when
**Add diagram** is opened, in a Web Worker the page terminates on timeout. It calls the same
`diagram::validate_source` and `diagram_svg` code as the build. CI's `diagram-wasm` job builds the module from
the commit, checks with `scripts/diagram-spike/core-parity.cjs` that it produces byte-identical SVG to the
native `diagram-parity` example on every fixture in `tests/fixtures/diagrams/`, and checks that the committed
module is that build; its artifact is the module to commit when it is not.

## Portability

Feeds, portable HTML and Markdown, Markdown bundles and syndication carry the PNG copy with
`alt="Title: description"` and the source as text. Every provider manifest declares the `diagram` capability
`unsupported`. Node links are not carried into copies.

## Tests

- `crates/openblog-core/src/diagram.rs`, `diagram_svg.rs`, `diagram_theme.rs`: options, alternatives,
  sanitizer, budgets, deadlines, node links, theming and PNG determinism.
- `crates/openblog-core/tests/diagram_publication.rs`: the gate, assets, feeds and copies, links and covers.
- `crates/openblog-core/tests/diagram_contrast.rs`: every curated look and theme, light and dark.
- `crates/openblog-cli/src/card.rs`, `admin.rs`, `portable_export.rs`: card images, Admin's publish refusal and
  exported bundles.
- `tests/web/diagram-preview.test.mjs`: the Admin editor's worker and fence writing.
