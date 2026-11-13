# ADR 0418: Diagram nodes link only to pages on the site, and the links are listed

- Status: Accepted
- Date: 2026-11-13
- Epic: [#566](https://github.com/journey-to-code-org/open.blog/issues/566) (task #590)
- Builds on: [ADR 0416](0416-diagrams-are-rendered-at-build-time-by-merman-on-by-default.md)

## Context

A system or architecture diagram often names things the site already explains: a service with its own post, a
concept with a docs page. Mermaid's `click` lines can turn a node into a link, but they also run JavaScript
callbacks, open outside addresses and new windows. An inline SVG link is only reachable with a pointer unless
it is also in the tab order, and a diagram with ten focusable nodes is ten extra Tab presses that say little.
A link that points nowhere is worse in a diagram than in prose, because the reader cannot see the address.

## Decision

- **Only `click Node "/path/"` (or `click Node href "/path/"`) is accepted**, optionally followed by a
  tooltip. The address must be a path on this site: it starts with one `/`, has no scheme, no backslash, no
  quotes and no spaces. A callback, an outside address, a `_blank` target or anything else after the link is
  refused with the diagram line it is on, and the diagram does not render, as a syntax error would not.
- **The renderer never sees the links.** The `click` lines are blanked (kept as empty lines so the
  renderer's line numbers still match) before the source is drawn; afterwards each linked node's group is
  wrapped in `<a href="/path/" tabindex="-1" class="ob-diagram-link">`. The SVG boundary allows an `a`
  element only with exactly that shape and a site path.
- **The links are listed after the caption** in a `<nav aria-label="Links in this diagram">` naming each node
  and its page. That list is the keyboard and screen-reader path; the nodes are left out of the tab order
  (`tabindex="-1"`) so the figure stays one stop for a reader moving through the page, and the image is still
  announced once by its title and description.
- **Every link must lead to a page this build writes**: a post, page, series or tag, or the site's own home,
  archive, search, series and tags indexes. A broken link stops a published post and is a warning on a draft
  or in a preview, like every other diagram problem.
- **Portable copies drop the links.** Feeds and exports carry the PNG copy (ADR 0419), which cannot hold
  links; the source disclosure still shows the `click` lines, and the canonical page has them.

## Consequences

- An author can link a diagram into the rest of the site without JavaScript, and readers who do not use a
  pointer get the same links in a plain list.
- Linking out of the site from a diagram is not possible; a link in the caption or the prose does that.
- Renaming a post that a published diagram links to fails the build until the diagram is updated, the same
  as it would for a broken series or successor link.
- The wasm preview in Admin runs the same code, so it shows the same links and refuses the same lines.
