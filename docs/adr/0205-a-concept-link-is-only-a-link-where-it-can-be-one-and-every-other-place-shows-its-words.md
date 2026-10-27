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
  through an escape or a character), with control characters replaced.
- **A concept link looks and sounds like one.** The resolved link is
  `<a class="ob-concept" ...>label<span class="ob-visually-hidden"> (atlas entry)</span></a>`: the
  theme draws a dotted underline (not colour alone, solid on hover and focus), and the hidden words
  tell a screen reader and a reader without styles what the link leads to. Copies that leave the site
  still carry only the words. The context previews (ADR 0206) do not repeat these words.
- **`entryHref(id, base)`** puts the site's base path in front, and ignores anything that is not a
  plain path.

## Consequences

- Nothing a post, page or intro author writes with `atlas:` can leave a raw address or id on a page.
- The hidden hint is English text in the page; a site in another language would need it localised
  with the other fixed wording.
- Pages cannot link entries until a later decision resolves them.
