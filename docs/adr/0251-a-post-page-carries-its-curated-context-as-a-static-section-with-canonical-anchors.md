# ADR 0251: A post's page carries its curated context as a static section with canonical anchors

- Status: Accepted
- Date: 2026-10-27
- Decision issue: [#197](https://github.com/journey-to-code-org/open.blog/issues/197)
- Parent story: [#190](https://github.com/journey-to-code-org/open.blog/issues/190)
- Parent epic: [#15](https://github.com/journey-to-code-org/open.blog/issues/15)
- Builds on: [ADR 0250](0250-the-curated-context-file-is-a-bounded-versioned-projection-of-the-one-public-curated-value.md), [ADR 0226](0226-a-selection-is-for-the-site-or-for-named-published-posts-in-the-authors-order.md), [ADR 0229](0229-selected-for-readers-lives-in-the-draft-side-research-panel-and-previews-the-public-value.md)

## Context

Reader Discovery is progressive enhancement: the page has to be complete without it. The data file is
for tools; a reader with no JavaScript, a screen reader or a printer still needs the selected context,
with who holds each view and how firmly.

## Decision

- **A section rendered from the same value.** After the post's text, a post offered at least one item
  gets `<section id="research-context">`: an `<h2>`, a note that nothing in it is a verdict, an ordered
  list with one item per selection (an `<h3>` and a definition list of the selected fields), and a
  "What these refer to" list of the cited sources and entries. It is rendered from the public curated
  value alone, so the page, the data file and the Admin preview of what readers get cannot disagree.
  A post offered nothing has no section and is byte for byte what it was.
- **Semantic and complete without JavaScript.** Headings, lists and definitions only: document order is
  reading order, a screen reader gets the headings in sequence, print keeps every item whole, and
  nothing is hidden behind a control. Attribution, confidence, doubt, dissent, evidence, the origin of
  imported metadata and the details a source lacks are text, never colour or position alone.
- **Canonical anchors.** Each item is `id="curated-" + selection id`, and a selection id is a lowercase
  slug, so the fragment is valid and stable. The data file gives each post's items their full address
  (`/post/#curated-id`), the section's id and the prefix, so #25 and #27 link to a real anchor. The
  entries and sources the items cite are anchored with an underscore (`curated_ref_source_id`), which a
  selection id never holds, so no anchor can collide with a selection's; a reference to something
  selected on its own links to that item instead.
- **Authored text is text.** Every string is escaped; the author's comment is shown as written, in an
  attributed item, never as markup. A value is a link only when it is a root-relative page of this site
  or an `https` address, so `javascript:`, protocol-relative and `data:` addresses are plain text.
- **Reflows.** The section and each item wrap anywhere, so a 300-character word does not overflow at 320
  pixels or at 400% zoom; the styles ship in `base.css`.
- **Where the data file is not written** (a bound, or an inconsistency), the page's section still
  renders, without the link to the file.
