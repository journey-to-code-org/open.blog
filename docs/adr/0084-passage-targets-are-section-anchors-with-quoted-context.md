# ADR 0084: Passage targets are section anchors with quoted context, over one published passage text

- Status: Accepted
- Date: 2026-10-26
- Decision issue: [#80](https://github.com/journey-to-code-org/open.blog/issues/80)
- Parent story: [#29](https://github.com/journey-to-code-org/open.blog/issues/29)
- Parent epic: [#16](https://github.com/journey-to-code-org/open.blog/issues/16)
- Builds on: [ADR 0059](0059-published-reference-data-for-citation-previews.md),
  [ADR 0048](0048-citations-publish-through-the-one-publication-projection.md)
- Serves: [#81](https://github.com/journey-to-code-org/open.blog/issues/81),
  [#82](https://github.com/journey-to-code-org/open.blog/issues/82),
  [#83](https://github.com/journey-to-code-org/open.blog/issues/83),
  [#84](https://github.com/journey-to-code-org/open.blog/issues/84),
  [#208](https://github.com/journey-to-code-org/open.blog/issues/208),
  [#210](https://github.com/journey-to-code-org/open.blog/issues/210),
  [#212](https://github.com/journey-to-code-org/open.blog/issues/212)

## Context

Readers will attach questions, sources, corrections (#81–#83, RD6), Third Perspectives (RD10),
responses to one author's section (RD11) and private annotations (#84) to places in a published
post. Posts change after publication. ADR 0059 rules out the obvious ids: citation marker and
note ids are positional and must not be stored. Heading ids are the only anchors the author
controls (`markdown.rs` gives each heading its `{#id}` or a slug of its title). A target must
survive edits gracefully, never silently point at other text, and work on the canonical page
without JavaScript, with the hosted service optional.

## Decision

- **One passage text, read from the publication.** A post's *passage text* is read from its
  publication Markdown (ADR 0048) with the renderer's own parser options and heading ids
  (`PassageDocument::of_post`), split into sections: the text before the first heading (no
  anchor), then each heading's id with its title and the text up to the next heading of any
  level. It is what the native page shows without what the page generates around it: footnote
  and citation markers, image alternative text, raw HTML, code blocks and the generated
  citation notes region are left out; an author's own footnote text stays where it is written.
  Text that only raw HTML shows cannot be targeted; a target made from it is reported stale,
  never matched elsewhere.
- **Only whitespace is normalized.** Each run of Unicode `White_Space` becomes one space and the
  ends are trimmed. Case and Unicode normalization forms are kept exactly: a quotation copied from
  the page matches the page and nothing else.
- **Offsets count Unicode scalar values** (`Array.from` in the browser), never bytes or UTF-16
  units.
- **Character boundaries without Unicode tables.** A target may not begin or end in front of a
  continuing character (combining marks of the common scripts, ZWJ and ZWNJ, variation
  selectors, emoji modifiers, tags) or right after a ZWJ. This is a fixed approximation of UAX #29
  grapheme clusters, chosen so the build and every browser agree exactly instead of depending on
  each engine's ICU version. A boundary it misses can only make a target refused or stale.
- **Revisions and digests.** The *passage revision* is `p<model>:` plus 32 hex digits of a
  BLAKE2s fingerprint of every anchor and section text. The model number (`p1`) changes whenever
  this text model changes, so a revision of an older model never equals a current one. A
  *section digest* is 32 hex digits of the fingerprint of one section's text.
- **Two kinds of target, one flat versioned JSON object.**
  - Quote: `{"version":1,"kind":"quote","section":"methods","exact":"…","prefix":"…","suffix":"…","start":12}`.
    `exact` is the quotation (1–500 characters); `prefix` and `suffix` are up to 64 characters
    of the same section right before and after it, empty only at the section's edge, never
    crossing into another section; `start` is where `exact` began in its section at the revision
    the reader saw, a hint trusted only at that revision. This is the W3C Web Annotation
    TextQuoteSelector plus a position hint, scoped by the section anchor.
  - Section: `{"version":1,"kind":"section","section":"methods","digest":"…"}` for the whole
    section. The digest is optional so a reader without JavaScript can name a section from its
    link alone; without it the target can only be confirmed at the revision the reader saw.
  - `section` absent or `null` means the text before the first heading.
- **Bounds and character rules.** Anchors are 1–200 characters without whitespace; text fields
  must already be passage text (single spaces, `exact` trimmed); control characters and the
  bidirectional embeddings, overrides and isolates are refused (they can make a quotation display
  differently from what it says); a quotation or its context may not start or end inside a
  character; `start` is at most 1,000,000; serialized targets are at most 16 KiB. Unknown fields,
  a missing or non-integer version and a newer version are refused with a code. Nothing is
  repaired. Error messages name the field and never repeat the text.
- **Escaping.** Quoted text is data. `context_html` writes `prefix<mark>exact</mark>suffix`
  with every character escaped; JSON is written by a serializer. The page's own text is never
  replaced by a target.
- **One contract, two implementations, one set of fixtures.** `openblog_core::passage_target`
  serves the build, Admin and moderation; `web/components/passage-target.js` (dependency-free,
  pure functions) serves forms (#82), local annotations (#84) and can validate in the hosted
  function (#81). Both read `tests/fixtures/passage-targets.json` and must produce the same
  targets, codes and resolutions.
- **No page change yet.** Section anchors already exist on every page and work without
  JavaScript. Emitting the revision and digests for no-JavaScript forms and the mail or copy
  fallback belongs to #82, behind its opt-in, so existing pages are unchanged.

## Consequences

- A durable reference to published text is a section anchor plus a quotation or a digest, never
  a positional id. Renaming a heading changes its anchor; a quote target then still re-anchors
  by its text, and a section target by its digest (ADR 0085).
- A browser adapter that reads the passage text from the DOM must leave out the same generated
  parts (heading anchor links, footnote and citation markers and labels, callout titles,
  component controls) or its targets will be reported stale; they can never land on other text.
- Revisions change when any passage text changes, including through smart punctuation or a
  citation style that writes locators into the prose.

## Domain language

**Passage text**, **Passage revision**, **Passage target** and **Section digest** are defined in
[`CONTEXT.md`](../../CONTEXT.md).
