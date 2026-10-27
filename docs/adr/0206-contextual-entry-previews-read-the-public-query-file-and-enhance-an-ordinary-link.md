# ADR 0206: Contextual entry previews read the public query file and enhance an ordinary link

- Status: Accepted
- Date: 2026-10-26
- Decision issue: [#74](https://github.com/journey-to-code-org/open.blog/issues/74)
- Parent story: [#27](https://github.com/journey-to-code-org/open.blog/issues/27)
- Parent epic: [#16](https://github.com/journey-to-code-org/open.blog/issues/16)
- Builds on: [ADR 0061](0061-citation-previews-are-a-progressive-non-modal-component.md),
  [ADR 0200](0200-the-atlas-query-projection-is-derived-from-the-public-atlas-alone-and-is-one-more-listed-artifact.md),
  [ADR 0203](0203-the-query-file-carries-the-pages-wording-and-a-works-source-and-its-lookup-is-one-shared-algorithm.md),
  [ADR 0204](0204-an-article-links-a-term-to-an-atlas-entry-only-where-the-author-writes-an-atlas-link-and-only-if-the-entry-is-published.md),
  [ADR 0205](0205-a-concept-link-is-only-a-link-where-it-can-be-one-and-every-other-place-shows-its-words.md)
- Contract: [Knowledge Atlas format](../specs/knowledge-atlas.md#entry-previews)

## Context

A reader who meets a concept link (ADR 0204) should be able to see what the entry is, where that
comes from and how firmly the nearby relationships are held without leaving their place, and always
be able to go to the complete static entry page. The citation previews (ADR 0061) already settled
how such a card behaves for a keyboard, a pointer, a touch screen and a screen reader.

## Decision

- **The link stays the page.** Without JavaScript nothing is added: the link is the ordinary link to
  the entry's page. The component only enhances a link that still leads to the entry's own page
  (its path equals the `url` the query file gives for that id), so a hand-written link cannot be
  made to preview something else.
- **One public file, fetched lazily.** The component reads `atlas-query.json` (ADR 0200), the public
  projection, from the site's own origin, and nothing else: not the page, not the private atlas, not
  another host. Inline per-post data was rejected: it would put copies of entry text, sources and
  relationships into every post page, which the publication boundary would then have to list and
  check per post, while the query file is already a listed, bounded, checked artifact. The cost is
  one request per page view that has a concept link, made when the browser is idle (so a first touch
  tap can open a preview) or at the first interest in a link; it is not made up front when the
  reader asked to save data, and a page without a concept link never loads the component. The build
  adds the element only when the file is actually written (ADR 0201 can leave it out), so a link
  never waits for a file that is not there.
- **Failure is quiet and total.** A file that cannot be fetched, is not JSON, is not this format or
  a newer version, or lists no entry for a link leaves that link an ordinary link: no message, no
  half-preview. Each entry, relationship and source is validated on its own.
- **What a preview says.** The entry's type is its `kindLabel`; its provenance is the line "From the
  author's approved Knowledge Atlas" (every public entry is approved) and, for a work, its `source`.
  The summary is the file's `preview`, with "The entry's page has the rest." when it is clipped. Up
  to two relationships are listed from the file's own fields (`assertedByText`, `confidenceText`,
  `standingText`, `uncertainty`, evidence `text`, never reworded), in the direction they were stated
  and from the entry's own side; the rest are counted and the page lists them. Uncertainty and
  dissent are therefore shown with the claim, and the component says nothing about truth, consensus
  or authority. The words around the data are English defaults the page may replace with attributes.
- **Behaviour is the citation preview's.** Focus opens it and describes the link with it, Tab
  continues into its one link (it follows the link in the page), there is no focus trap, Escape
  closes it and returns focus without reopening it, hover opens and leaving closes it, the first tap
  opens it and a second follows the link (Enter and assistive technology always follow it; a tap
  before the file has loaded follows the link), pressing or focusing anything else closes it, the
  page never scrolls, placement stays inside the viewport (below the link, or above where only that
  fits) and the animation is only played when the reader has not asked for reduced motion.
- **No doubled hint.** The link already reads "label (atlas entry)" (ADR 0205). The preview is the
  link's description and starts with the type ("Person"), so a screen reader hears "Plato (atlas
  entry)", then "Person. From the author's approved Knowledge Atlas. ...".
- **Fields are not HTMLElement properties.** The component keeps its card as `card` and its links as
  `anchors`; a test fails if any field it assigns is an HTMLElement property (`popover` broke the
  citation previews).
- **Base paths.** The element's `src` and the file's `url` fields are rewritten with every other
  address by the build; the component compares paths, so it works under any base path.
- **Only public fields, as text.** Every value is assigned as text. The one link is the link's own
  checked destination.

## Consequences

- A reader on a slow or metered connection pays for the query file on pages with concept links; the
  bound (4 MiB, normally far smaller) and `saveData` are the limits, and a later inline option is
  possible without changing the file.
- A site whose build leaves the query file out has plain links and no component.
- The preview wording is English until the fixed wording of the site is localised.
