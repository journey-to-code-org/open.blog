# Diagrams

Write a diagram as Mermaid source in a ` ```mermaid ` fence. When the site is built, open.blog draws it as
an image inside the page: no JavaScript is sent and nothing is fetched. The diagram uses your look's colours in
light and dark mode and prints in black and white. Readers can open the source beneath it.

````markdown
```mermaid title="How a request is served" description="The browser asks the CDN; on a miss the CDN asks the origin server, which answers through it." caption="One request, two hops"
flowchart LR
  Browser --> CDN
  CDN -->|cache miss| Origin
  Origin --> CDN --> Browser
```
````

Diagrams are on in the `openblog` binary. A build made with `--no-default-features` leaves the fence as a code
block, as it was before diagrams existed.

## What you can draw

Flowcharts (`flowchart`, `graph`), sequence diagrams, class diagrams, state diagrams, entity-relationship
diagrams, git graphs and C4 diagrams. Anything else is refused with the line it is on, as a syntax error is.

Admin's **Add diagram** button in the post and page editors opens an editor with five examples to start from:
system design, request flow, git path, data model and state machine. It draws a live preview with the same
code the build uses, so what you see there is what is published.

## Describing a diagram

Every diagram needs a **title** and a **description** for readers who cannot see it. Screen readers announce
them as the image's name and description, and copies of the post use them as the image's text alternative.
Put them on the fence line:

| Option | Required | What it is |
| --- | --- | --- |
| `title="…"` | Yes, unless the diagram has `accTitle:` | A short name for the diagram |
| `description="…"` | Yes, unless the diagram has `accDescr:` | What the diagram shows, in a sentence or two |
| `caption="…"` | No | A visible caption under the diagram |
| `source="…"` | No | A link to where the diagram came from: a site path or an `https://` address |

Mermaid's own `accTitle:` and `accDescr:` lines work too and are used first. C4 diagrams need a fence `title`.
Each option is at most 1,024 bytes; quote values that contain spaces.

A published post with a diagram that is missing either, does not draw, or breaks a rule below is not built.
`openblog check`, `openblog build` and Admin's Publish say which line and what to add. A draft, or a preview,
shows the same message as a warning and still draws the rest.

## Colours

The renderer's colours are swapped for your look's: text, node fill, lines, a highlight and six accent hues
made from the look's own colours, so the diagram follows the reader's light or dark choice and a change of
look without a rebuild. Printing uses black on white, and Windows high-contrast mode uses the system colours.
See [ADR 0417](adr/0417-diagram-colours-are-the-looks-variables-with-the-renderers-colours-as-fallback.md).

Colours you write yourself in `style`, `classDef` or `linkStyle` lines stay exactly as written, so they do not
change with dark mode. A `style` or `classDef` that sets a `fill` must therefore also set `color`, and the two
must reach a contrast of 4.5:1:

```mermaid title="Highlighted step" description="A request passes the cache, and the origin is highlighted."
flowchart LR
  Cache --> Origin
  style Origin fill:#1e3a8a,color:#ffffff
```

Mermaid's `%%{init}%%` and `---` configuration blocks are not supported.

## Linking nodes to your pages

A flowchart node can link to a page on your site:

```text
click Origin "/posts/how-our-origin-works/"
```

Only paths on your site are allowed: no outside addresses, new windows or JavaScript callbacks. Each link must
lead to a post, page, series, tag or one of the site's index pages, or the post is not published. The links
are also listed under the diagram, so they work from the keyboard and with a screen reader. See
[ADR 0418](adr/0418-diagram-nodes-link-only-to-pages-on-the-site-and-the-links-are-listed.md).

## Limits

A diagram's source is at most 16 KiB and 200 nodes, edges or messages, and it must draw within a few
seconds. A diagram over a limit is refused with a message saying so; split it into two.

## In feeds, copies and cross-posts

RSS and JSON Feed, portable HTML and Markdown copies, Markdown bundles and every cross-posting destination
get a PNG copy of the diagram (`assets/diagrams/<digest>.png`), with the title and description as its text
alternative and the Mermaid source written after it. None of the destinations open.blog posts to is known to
draw Mermaid itself, so [provider capabilities](provider-capabilities.md) lists diagrams as sent as an image
everywhere. See [ADR 0419](adr/0419-diagrams-travel-as-png-copies-with-their-text-alternative.md).

## A diagram as the post's image

To make a diagram the image shown when the post is shared, set `coverDiagram` to its number in the post,
counting from 1:

```yaml
coverDiagram: 1
```

open.blog draws a 1200 × 630 card of that diagram, with white space around it so nothing is cropped, and uses
it as the cover: the link preview image, and the image `openblog card` checks for
[visual cards](visual-cards.md). Its alternative text is the diagram's title and description, unless you set
`coverAlt`. Don't set `cover` as well.

## Decision records and git history

The `decision` profile's **Before** and **After** headings are places for a diagram of the system before and
after the decision; see [decision records](content.md#decision-records).

`openblog diagram git --from <ref> --to <ref>` prints a draft ` ```mermaid ` git graph of the commits between
two refs, to paste into a post. Add `--repo <path>` for another repository. Review it before publishing: branch
names and commit subjects can say more than you intend. Email addresses and full hashes are removed, and you
add the title and description.

## For contributors

The fence contract, sanitizer, limits and the parity between the build and Admin's preview are in the
[diagrams spec](specs/diagrams.md). The renderer choice is
[ADR 0416](adr/0416-diagrams-are-rendered-at-build-time-by-merman-on-by-default.md).
