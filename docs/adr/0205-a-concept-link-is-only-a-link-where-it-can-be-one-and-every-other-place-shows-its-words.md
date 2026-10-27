# ADR 0205: A concept link is a link only where a link can be one, and every other place shows its words

- Status: Accepted
- Date: 2026-10-26
- Decision issue: [#73](https://github.com/journey-to-code-org/open.blog/issues/73) (review findings)
- Parent story: [#27](https://github.com/journey-to-code-org/open.blog/issues/27)
- Parent epic: [#16](https://github.com/journey-to-code-org/open.blog/issues/16)
- Builds on: [ADR 0204](0204-an-article-links-a-term-to-an-atlas-entry-only-where-the-author-writes-an-atlas-link-and-only-if-the-entry-is-published.md)
- Contract: [Knowledge Atlas format](../specs/knowledge-atlas.md#concept-links-in-articles)

## Context

Review of the first concept links found places where the author's `atlas:` syntax could still reach a
reader as something other than the link or the plain words ADR 0204 promises: inside an image's
alt text the mark was escaped onto the page with its id (private or not); the Admin document preview
never resolved a link; a page, a series description or the home introduction left the raw `atlas:`
address as a dead link; and an unclosed raw mark turned the rest of the post into a link. The link
also did not look or sound different from any other link.

## Decision

- **One function closes the whole class of leaks, not one form at a time.** Review kept finding a
  new Markdown form that carried a private id to a page (first image alt text, then autolinks, then
  reference-style images). `concept_links::mark_events` is now the only place that reads an `atlas:`
  destination, and it handles EVERY link and image whose destination starts with `atlas:` (any
  letter case, after the whitespace and control characters a browser ignores are removed), whatever
  its `LinkType`: inline, reference, collapsed, shortcut, autolink or email. It runs in the one
  renderer, for posts, pages, series descriptions and the home introduction, and before any heading
  id or text is made from the events:
  - A link written exactly `[label](atlas:id)` in a post becomes a mark and resolves when the entry
    is published. Every other `atlas:` link (not in a post, inside an image's description, the
    scheme in another letter case) shows its label as plain text.
  - An autolink `<atlas:id>` has no label, so it renders as nothing, and the build warns: write
    `[label](atlas:id)`.
  - An image with an `atlas:` address is always refused: its description is shown as plain text and
    the build warns. A link inside such a description keeps only its words.
  - Nothing emits an `atlas:` href or src, a title, or the id as text. The portable and feed copies
    (`plain_markdown`) apply the same rules to the Markdown: a reference definition an image or a
    link uses goes with its use, a collapsed `[label][]` becomes the label, an image becomes its
    description's words, and a raw `<ob-concept ...>` or `</ob-concept>` in any letter case and with
    any attributes is removed, so it cannot reach `feed.json`'s `content_text`.
  - `crates/openblog-core/tests/atlas_link_corpus.rs` is the guard. It writes every form (inline
    with and without a title, reference full, collapsed and shortcut, autolink, image inline and
    reference, inside alt text, headings, footnotes, tables, lists, quotes, nested links, raw marks)
    to unpublished ids into a post, a page, a series description and the home introduction, builds
    the site with the atlas on and off, and scans EVERY file of `dist` and the portable copies:
    no `atlas:` in a link or image attribute, no private id, no private title and no raw
    `<ob-concept` tag. A new form that leaks fails there by adding one line to the corpus.
- **A raw mark that is dropped is not silent.** An unclosed or block-spanning raw `<ob-concept>`
  mark, or one whose tag is not complete, is removed and the build warns that it was.
- **A concept link in a heading is described, not renamed.** Inside a heading the link has no inline
  hidden words (they would become part of the heading's accessible name and of any outline built
  from it); it carries `aria-describedby` for the one hidden hint element
  (`<span id="ob-concept-hint" hidden>Atlas entry</span>`) the post then ends with. A post with no
  such link has no hint element.
- **The Admin preview reads only the atlas.** For a post with the syntax the preview releases the
  build lock first, then attaches the published atlas alone (`site::published_atlas`), never the
  comparisons or claims, and resolves the links. The preview page still loads the previews from the
  last build's `atlas-query.json`: that file is not re-projected for a preview, so a preview can
  show a card one build behind the atlas (an entry added since has a link but no card). This is
  deliberate: previews are a reader enhancement, the link itself is always current, and the file
  stays one listed artifact.
- **An image description keeps the label only.** A concept link inside an image's alt text is not
  marked; its label stays in the alt text and the build warns (once per id and post) that a link
  cannot be there. The private id never reaches a page.
- **Every Admin document preview that shows a post with the syntax resolves it** through the same
  place the build does (`boundary::project_with` over `Shared::read`), under the content lock the
  draft holds and before the research stores are read, and reports the same warnings. A document
  without the syntax is previewed exactly as before and reads no research file.
- **A page, a series description and the home introduction do not resolve the syntax, and say so.**
  The label is shown as plain text, never a raw `atlas:` address, and the site load warns once per
  document and id (`<file>: atlas link ...`). Resolving there was not chosen: those documents have
  no preview data and no manifest entry yet, and a link to an entry from a page would be a new
  publication path to review. Reversible by resolving in the same place later.
- **A mark closes inside its own block.** A raw `<ob-concept ...>` with no closing tag in its block is
  dropped and its text kept, so it can never link the rest of the post.
- **A warning names the id as the author wrote it,** not HTML-escaped, cut by characters (never
  through an escape or a character), with control characters and the characters that reorder or hide
  text (U+202A to U+202E, U+2066 to U+2069, U+200B to U+200F, U+061C, U+2028, U+2029, U+2060 and
  U+FEFF) replaced.
- **A concept link looks and sounds like one.** The resolved link is
  `<a class="ob-concept" ...>label<span class="ob-visually-hidden"> (atlas entry)</span></a>`: the
  theme draws a dotted underline (not colour alone, solid on hover and focus), and the hidden words
  tell a screen reader and a reader without styles what the link leads to. Copies that leave the site
  still carry only the words. The context previews (ADR 0206) do not repeat these words.

## Consequences

- Nothing a post, page or intro author writes with `atlas:` can leave a raw address or id on a page.
- The hidden hint is English text in the page; a site in another language would need it localised
  with the other fixed wording.
- Pages cannot link entries until a later decision resolves them.
