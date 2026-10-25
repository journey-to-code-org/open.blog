# Portable HTML pipeline

`PortableProjection::portable_html()` and `portable_markdown()` derive destination-neutral
representations from the canonical authored Markdown. They use the Markdown event renderer and
authored source, never parse generated production HTML to reconstruct content. Native output
remains unchanged.

The renderer preserves the configured punctuation and heading-anchor behavior, resolves Markdown
links and image destinations against the canonical article URL (or the site base for root-relative
paths), and returns the capability descriptors discovered during rendering. Absolute URLs,
fragments, query strings, and Unicode destinations are covered by tests. Invalid or executable
links fail with a source-scoped error instead of silently producing a successful projection.

The HTML projection is a body, not a complete page. Full-content RSS and JSON Feed now use its
static HTML fallbacks; JSON Feed also includes text derived from the portable Markdown projection.
Syndication adapters use portable HTML or Markdown according to their destination policy.
`representation(Html)` continues to return the existing native `post.html`. Admin's authenticated
unsaved preview offers native, portable HTML, portable Markdown, and destination-policy views
using the same projection as production. Its diagnostics include the source, severity,
transformation, and recommended action. Authored raw HTML follows the
[raw HTML policy](#raw-html-urls-anchors-and-size-bounds) below.

Portable Markdown is a CommonMark-oriented article with a canonical identity header and public
attribution/provenance metadata. Knowledge checks become a question, choices, answer, and
explanation; runnable fences become ordinary code with a canonical-run link; web sandboxes become
labelled source fences; callouts become titled blockquotes. Raw HTML is escaped and called out
rather than executed. Markdown source can be inspected without writing files:

```sh
openblog export my-post --format markdown
openblog export my-post --format markdown --out exports/my-post.md
openblog export my-post --format markdown --out exports/my-post.md --write
```

The first two forms are dry runs; only `--write` creates a file, and an existing file is never
overwritten.

Admin warning acknowledgements are tracked separately in a per-post `.portability.json` sidecar.
Each record is bound to the portable source revision, capability, representation, and destination.
Acknowledging records an author's review but does not hide the warning or bypass projection errors;
changed source content makes the previous record stale.

## Static fallbacks for interactive capabilities

Generated markup in the projection needs no open.blog script, custom element, form control,
iframe, `hidden` attribute, or stylesheet. Each current capability renders as ordinary HTML
([#112](https://github.com/journey-to-code-org/open.blog/issues/112)):

| Capability | Portable fallback | What moves to the canonical article |
| --- | --- | --- |
| Knowledge check (`quiz` fence) | The prompt, choices as a lettered list, and the author's answer and explanation inside a native `<details>` disclosure, so the answer stays on request. | Scoring, retry, and remembered answers. |
| Runnable code (`rust runnable`, configured runner languages) | The authored source in `<pre><code>` with its title and line options (`showLineNumbers`, the start line, and `{2}` highlights as `data-line-*` attributes, as on ordinary fences), plus a link to run and edit it on the canonical article. Fences the canonical page cannot run stay ordinary code. The runner endpoint is never included. | Editing, execution, and output. |
| Web sandbox (`web runnable`) | The HTML, CSS, and JavaScript as separate, labelled, escaped code blocks (text before the first marker is kept), plus a link to the live preview. | The isolated live preview. |
| CodePen and YouTube embeds | A titled link to the provider: the authored link text and address when present, otherwise the rebuilt provider address. Hashnode `%[url]` syntax never reaches the output. A video post's `videoUrl` becomes a link at the top unless the body already links that video, after the same production notes (season and episode, status, credits) the native page shows. | The embedded frame. |
| Video chapters | In video posts, a paragraph whose lines (two or more) all start with a timestamp, or a tight bulleted list (`- 00:00 Intro`) whose items all do, becomes an ordered chapter list. Timestamps follow the Admin release kit: `M:SS` or `H:M:SS` with up to two hour and three minute digits, with seconds (and, after an hour, minutes) under 60. The list has `<time>` values, linked to that moment when the post has a YouTube video. | Nothing. |
| Recipes and callouts | A recipe summary list with the same facts as the native card (prep, cook, and total time, servings, yield, cuisine, course, calories) comes first; ingredient and step sections keep their headings and lists; callout titles are bold so they read without styles. | Scaling, timers, checklists, and cook mode. |
| Comments | When the canonical page offers comments, a link to join (or, when locked, read) the discussion there, reported as a `comments` capability with the canonical-only portability level. Hidden comments or an unconfigured backend add nothing, and the hosted endpoint never appears. | Reading and posting comments. |

open.blog has no authored expected-output field for runnable code: output an author writes as
ordinary Markdown next to the fence stays visible like any other content. A closed `<details>`
disclosure may print collapsed, so a reader who wants the answer on paper opens it first: the
answer is never shown before the reader asks, on screen or in print.

A `quiz` or `web runnable` fence with no text at all has always built, so it still builds (an
empty knowledge check, or a sandbox with no source); any written content is validated.

Fallbacks stay inside their container, so a quiz or runnable example in a callout, quote, or
list item keeps its position. A malformed capability fails the projection with the source path
and that capability's error and diagnostic; the canonical Markdown, the native HTML, and any
remote state are left untouched.

## Research, attribution, and planned structures

The projection keeps what identifies and credits the work
([#113](https://github.com/journey-to-code-org/open.blog/issues/113)), in the order the native
page shows it:

- **Credits.** A post with an explicit credit sidecar starts with the same ordered
  "Contributions" list as the native page: each name, its role labels (for example *Author*
  or *Translator*), and a manually entered ORCID iD marked "(unauthenticated)". Contributor
  links resolve against the site, and the decorative ORCID icon (a site asset) is left out.
  Credits are attribution: they never enter the References section or `references()`. A post
  credited only to the legacy site author gets no list; consumers take that byline from
  `authors()`, as feeds do.
- **Work identity.** A research post's DOI and license follow, as on the native page. A DOI
  that cannot be resolved is not shown as the work's identifier there or here; the evidence
  audit reports it.
- **References and citations.** Reference links keep their exact address, including page or
  section fragments and query strings, and references without a link stay visible as text.
  Footnote citations keep their number and note id; each citation links to the note on the
  canonical article (`…/post/#note`), as heading anchors do, so a copy that drops ids still
  reaches the cited note. A repeated citation keeps one number.
- **Provenance.** A `sourceUrl` adds the native "Originally published at" line after the body.
  It must be an absolute HTTP(S) address without credentials; anything else fails the
  projection for that post.

Planned research and reader capabilities (the ids in the
[planned-capability registry](./planned-capability-contracts.json): comparisons, timelines,
source previews, guided explanations, relationships, reading paths, interpretations,
reflections, diagrams, and the rest) have no authoring syntax or portable fallback yet. Until
their owning story ships one, a capability the canonical page reports without a portable
fallback fails closed: its authored content stays visible as ordinary Markdown, a labeled note
such as "**Timeline**: see it on the original article" links to the canonical article, and the
capability is reported with the canonical-only level. The note is article-level for now: until
an owning story detects the block, nothing locates its content, so notes follow the whole body
(footnotes included) rather than the block they describe. An unknown capability gets the label
"Interactive content". Private-only state (local reader annotations and protected reflection
drafts) adds nothing to the copy and is left out of the capability report, so no destination
learns that it exists. Unknown front matter stays in the canonical source and never
reaches the output.

## Raw HTML, URLs, anchors, and size bounds

Authored raw HTML (HTML blocks, inline tags, and `{key=value}` heading attributes) is
untrusted ([#114](https://github.com/journey-to-code-org/open.blog/issues/114)). The projection
tokenizes it and writes it out again from a fixed allowlist, so nothing authored reaches a
destination byte for byte, and anything that is not complete markup (a stray `<`, an
unterminated tag) becomes escaped text. This is the projection's policy, not a general-purpose
sanitizer API. The native page keeps passing raw HTML through, as before.

| Authored markup | Portable output |
| --- | --- |
| Static content elements: paragraphs, headings, lists, tables, quotes, figures, `<details>`, `<abbr>`, `<kbd>`, `<time>`, `<img>`, links, and similar | Kept, with `id`, `class`, `title`, `lang`, `dir`, `aria-label`, `aria-labelledby`, `aria-describedby`, and each element's own static attributes (for example `href`, `src`, `alt`, `cite`, `datetime`, `colspan`, `scope`, `open`). Anything else, including `style`, `target`, `srcset`, `data-*`, and every event handler, is removed. |
| `<script>`, `<style>`, `<noscript>`, `<template>`, `<title>`, `<textarea>`, `<select>`, `<button>` | Removed with their content, including any Markdown written inside them, until their end tag. An inline one that is never closed ends with its paragraph (or other container). One opened in an HTML block that hides authored content after the block and is never closed fails the projection for that post, naming the element, such as `posts/work.md: raw HTML <iframe> is never closed …`, since a browser would hide that content too. A paragraph left empty by removals is removed. |
| `<base>`, `<meta>`, `<link>`, `<input>`, `<source>`, `<track>`, `<area>` | Removed. |
| `<iframe>`, `<frame>`, `<object>`, `<embed>`, `<video>`, `<audio>`, `<canvas>`, `<svg>`, `<math>` | Replaced with "**Video**: see it on the original article" (or Embedded frame, Embedded object, Interactive graphic, Illustration, Math), naming the element's `title` or `aria-label` when it has one. Nothing inside them is kept or checked. |
| `<form>`, `<label>`, page landmarks (`<nav>`, `<main>`, `<header>`, `<footer>`), presentational tags (`<font>`, `<center>`), custom elements (including hand-written `<ob-…>` tags), and unknown elements | The tags (and their attributes) are removed; their content is kept. |
| Comments, doctypes, processing instructions, and CDATA | Removed without a report, since they are never reader content and may hold private notes. A comment left open at the end of its HTML block (for example one split by a blank line inside a `<div>`) keeps hiding everything after it, Markdown included, until a later raw `-->`, as in a browser; if it would hide authored content and is never closed, the projection fails for that post. |

Every removal is reported once per kind as a `raw-html` capability (gracefully transformed,
fallback `allowlisted-html`) whose `RemovedMarkup` diagnostics name the removed elements and
attributes, never their content. A post whose raw HTML loses nothing reports no `raw-html`
capability.

**URLs.** `href`, `src`, and `cite` values are decoded (numeric and common named character
references) and then resolved exactly like Markdown links: relative paths against the canonical
article, root-relative paths against the site base, `#fragment` links to the fragment on the
canonical article. A value that cannot be made a safe HTTP(S), `mailto:`, or `tel:` URL
(`javascript:` in any spelling or encoding, `data:` URLs including SVG images, credentials,
control characters, or an empty value) fails the projection for that post with the element and
attribute named, such as `posts/work.md: link must use HTTP(S), mailto, or tel (raw HTML <img src>)`.
A `<base>` element is removed, so it cannot redirect relative URLs.

**Anchors.** Raw `id` values are kept as written, Unicode included, so authored fragment links
keep their target; a legacy `<a name>` anchor becomes an `id`. An id that repeats an earlier raw
id, a heading id, or a footnote id, that contains whitespace, or that starts with the reserved
`ob-` prefix is removed and counted in the report; for a duplicate, the heading or first element
keeps the anchor. A heading id (`{#id}` or a slug) that repeats an earlier heading's id or a
footnote id, or starts with `ob-`, is renamed to a unique id without the prefix (`x-2`,
`contributions-title`) and counted, so the first heading keeps the id it has on the native page. A
footnote named with the `ob-` prefix is written without an id and counted. Like every fragment link, a link to a
removed or renamed id points at the canonical article, where the native page still has that id,
so it reaches the original target there rather than a place in the portable copy.

**Images.** A raw `<img>` written without `alt` gets `alt=""` (decorative) and is counted in the
report, so every portable image has alternative text; add a real `alt` to describe it.

**Linear time.** An unterminated tag or quoted value is escaped text through the end of its
fragment, so hostile or broken markup costs time in proportion to its length.

**Balance.** Kept elements are closed inside the Markdown container that opened them, a stray
end tag is dropped (a stray `</br>` is a line break, as in a browser), and anything still open at
the end of the body is closed there. The finished body is then balanced once more as a whole, so
an element left open in a recipe section closes before the section does, and the body can be
embedded in any destination container without closing it early.

**Bounds.** A portable body larger than `MAX_PORTABLE_HTML_BYTES` (2 MiB), or nested more than
`MAX_PORTABLE_NESTING_DEPTH` (64) elements deep, fails the projection for that post with a
diagnostic naming the bound. Nothing is ever truncated. As with every projection failure, the
canonical Markdown, the native HTML, and any remote state are left untouched.

## Tests

The focused contract is tested in
[portability.rs](../../crates/openblog-core/src/portability.rs) and
[markdown.rs](../../crates/openblog-core/src/markdown.rs). The golden suite in
[portable_html.rs](../../crates/openblog-core/tests/portable_html.rs) renders the
[video lesson](../../tests/fixtures/portable-html/video-lesson.md),
[recipe](../../tests/fixtures/portable-html/recipe.md),
[research](../../tests/fixtures/portable-html/research.md) (with a
[credit sidecar](../../tests/fixtures/portable-html/research.credits.json) naming two authors
and a translator), and [hostile HTML](../../tests/fixtures/portable-html/hostile-html.md)
fixtures and compares them with their expected `.html` files. The last is an imported post
with scripts, event handlers, a `<base>` tag, frames, SVG, a form, a private comment,
duplicate ids, a legacy anchor, and unclosed tags. It also checks that the output has no runtime-only elements or
attributes, uses only absolute URLs, has a target for every anchor, gives every link an
accessible name and every image alternative text, and leaks neither the comments nor the runner
endpoint nor unknown front matter. The shared [portability fixtures](../../tests/fixtures/portability-contract.json)
also render through `portable_html()`.
