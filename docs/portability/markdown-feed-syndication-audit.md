# Markdown, feed, and syndication semantic-loss audit

- Status: audit of current output; no conversion or provider behavior changed
- Date: 2026-10-24
- Issue: [#109](https://github.com/journey-to-code-org/open.blog/issues/109) (Task P2.3)
- Parent story: [#94](https://github.com/journey-to-code-org/open.blog/issues/94) · Parent epic: [#92](https://github.com/journey-to-code-org/open.blog/issues/92)
- Shared fixtures: [portability-contract.json](../../tests/fixtures/portability-contract.json)

## Scope and method

This audit follows one loaded post from its Markdown body through `Post`, native HTML,
plain text, public feeds, and provider payload builders. The fixture corpus now exercises
the same public fixture posts through the native document renderer, RSS, JSON Feed,
`llms-full.txt`, and DEV, Hashnode, Ghost, WordPress, and Medium syndication shapes.
These tests inspect local output only; no provider network calls occur.

No provider-specific conversion is claimed. In particular, the implementation does not
sanitize raw HTML or guarantee that a destination supports open.blog custom elements.
Findings describe current behavior, not the behavior of third-party importers.

Projection errors include the canonical source path; provider failures are reported by
target. There is no capability-scoped conversion failure yet because syndication sends
the selected Markdown/HTML representation without destination-specific capability
transforms. The fixture tests only build local payloads. In the command path, dry-run
returns before verification, credential lookup, network requests, or private-state writes
(`crates/openblog-cli/src/syndication.rs:307-345`); this audit changes no canonical
source or remote state.

## Representation map

| Surface | Input and transformation | Retained semantics | Known loss or boundary |
| --- | --- | --- | --- |
| Canonical Markdown body | Front matter is separated; `Post.authored_markdown` retains the body. | Authored Markdown, custom fences, raw HTML, reference definitions, source links, and Unicode remain available for downstream rendering. | Structured sidecar credits, cover metadata, canonical metadata, and other front matter are not part of the body string. |
| `post.html` / native article | The Markdown renderer produces HTML, preserving standard structure and applying open.blog transforms for recipes, callouts, quizzes, runnable code, and embeds. The full native page adds metadata, bylines, navigation, and theme/runtime assets around it. | Content and accessible native fallbacks are present in the body HTML; full pages add structured metadata and visible credits. | Custom elements and raw HTML remain native markup; this is not a destination-neutral HTML conversion. |
| `post.text` and `llms-full.txt` | The renderer collects text events outside fenced code blocks, collapses whitespace, and the full-text feed adds article metadata and this text representation. | Ordinary prose and heading text remain. | Fenced code (including quizzes and runnable examples) is omitted. Link destinations are not included in text, so linked reference URLs reduce to their visible labels. The quiz fixture explicitly records this loss. |
| RSS `content:encoded` and JSON Feed `content_html` | When full-content feeds are enabled, each receives `post.html`; the feed builder replaces quoted root-relative `src="/…"` and `href="/…"` values with site-absolute URLs. Feed-level title, summary, dates, tags, images, and authors are emitted separately. | Native HTML and custom markup are retained; absolute and fragment links remain unchanged; root-relative image/link attributes are made absolute. | Parent-relative links such as `../reference/` remain relative. The output is native HTML, not a feed-specific fallback. Other URL-bearing attributes, `srcset`, and raw Markdown destinations are not handled by this feed rewrite. |
| DEV and Hashnode | Both receive `SyndicationPost.markdown`, derived from the authored Markdown body with root-relative Markdown/HTML `href` and `src` values prefixed by the site URL. Hashnode receives it as `contentMarkdown`; DEV as `body_markdown`. | Authored fences, reference sections, and Markdown semantics remain available to the destination parser. | Parent-relative destinations remain unresolved. Provider rendering of open.blog fences, raw HTML, and other extensions is destination-dependent. Hashnode automation is draft-only; publish intent is rejected before writing. |
| Ghost and WordPress | Both receive `SyndicationPost.html`, derived from `post.html` with root-relative `href` and `src` element attributes prefixed using an HTML fragment parser. | Rendered prose, headings, images, links, and open.blog custom-element markup are carried in the HTML body. | Parent-relative links remain unchanged. Structured author credits and cover-image metadata are not separate provider fields in these requests. WordPress payloads do not include `canonical_url`; the adapter warns that core WordPress cannot set an external canonical URL. |
| Medium | Manual-only instruction points the user to Medium's Import a story flow and supplies the canonical open.blog URL. No Medium request or body is generated. | The source article remains accessible at its canonical URL for the import workflow. | Extraction, formatting, canonical assignment, images, byline, and reference handling are controlled by Medium and are not verified or asserted by this repository. |

Source traces: `crates/openblog-core/src/model.rs:145-195,855-880`;
`crates/openblog-core/src/markdown.rs:815-895,917-936`;
`crates/openblog-core/src/render.rs:100-130,435-480`;
`crates/openblog-core/src/feeds.rs:13-169,317-355,395-400`;
`crates/openblog-cli/src/syndication.rs:539-592,597-735,951-1156,1160-1360`.

## Identity, attribution, references, and media

- The portable projection's canonical URL is the site's URL for the post. RSS item `link` /
  `guid`, JSON Feed `id` / `url`, and the syndication canonical URL use that identity.
  A post's optional `canonical` field is separate: native social metadata may use it, and
  JSON Feed exposes it as `external_url`; RSS does not emit it as a separate field.
  Syndication uses the projection URL, not the optional override.
- RSS authors are emitted as `dc:creator`; JSON Feed has site-level author data and may
  carry explicit per-item author names/URLs. The provider request builders do not emit
  the structured credit sidecar as a separate author field, even though a native full
  page renders visible contribution credits.
- Research reference sections survive as rendered body content in HTML and as authored
  Markdown in the Markdown targets. The separate reference model is not projected into
  a dedicated RSS or provider field. The plain-text representation keeps link labels but
  omits their targets.
- RSS emits a cover as an `enclosure` with inferred MIME type and length `0`; JSON Feed
  emits it as `image`. Syndication payloads do not send the cover as a dedicated field.
  Body images remain in HTML/Markdown, subject to the URL behavior above.
- HTML embeds and open.blog components are carried in full-content feeds and HTML
  syndication payloads as native markup. Markdown destinations receive authored syntax
  instead. This difference is intentional representation selection, not evidence that a
  remote provider will preserve or execute the feature.
- Comment policy and other open.blog-only interaction configuration do not have separate
  feed/provider fields. The rendered article body may contain the associated native markup.

## Intentional versus accidental differences

| Difference | Classification | Evidence / follow-up |
| --- | --- | --- |
| HTML targets receive rendered HTML while DEV/Hashnode receive Markdown; Medium is manual-only. | Intentional current adapter contract. | Provider request builders and the manual Medium instruction select distinct forms; destination capability conversion remains future work. |
| `post.text` and `llms-full.txt` omit fenced code/quiz bodies and link targets. | Known semantic loss, not a faithful text conversion. | The shared quiz fixture records the omission; a future text projection should report or transform it. |
| Relative `../…` links are not resolved in feeds or syndication. | Accidental gap. | Existing URL rewriting only prefixes root-relative paths. The shared legacy fixture contains a parent-relative link; a future fix should resolve it against the canonical source URL without rewriting code or raw unrelated text. |
| Sidecar bylines and cover metadata are absent from provider payload fields. | Accidental metadata gap unless a destination cannot represent them. | They are present in the domain model and some feed/page metadata, but the current `SyndicationPost` and payload builders do not carry them. |
| WordPress does not receive an external canonical field; Medium behavior is unverified. | Explicit provider limitation / manual boundary. | WordPress adapter warning and Medium manual-only instruction document the limits. |
| Full-content feeds may expose native `<ob-…>` tags and raw HTML. | Intentional compatibility behavior, not portable conversion. | No feed-specific conversion is implemented; preserve this distinction until a destination-aware transformation is specified. |

## Fixture and regression coverage

`crates/openblog-core/tests/portability_contract.rs` drives each public fixture through
`post.html`, the native rendered page, RSS `content:encoded`, JSON Feed `content_html`,
`post.text`, and `llms-full.txt`. It keeps each fixture's expected semantics and text-loss
notes next to the canonical source in the shared JSON corpus.

`crates/openblog-cli/src/syndication.rs` runs those same public source fixtures through the
DEV, Hashnode, Ghost, WordPress, and Medium request/instruction builders and checks that
each payload uses its declared Markdown or HTML representation. These are request-shape
tests only; they do not contact providers or claim remote-rendering parity.

The fixture corpus covers Unicode, duplicate heading anchors, relative links, image alt
text, references, explicit and legacy authorship, recipes, callouts, media, quizzes,
runnable code, unknown syntax, and draft exclusion. It does not claim provider-side
equivalence or that currently unresolved relative links are correct.
