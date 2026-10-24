# Portable HTML pipeline

`PortableProjection::portable_html()` provides an opt-in HTML body projection from the canonical
authored Markdown. It uses the Markdown event renderer rather than parsing generated production
HTML, so native output remains unchanged and existing consumers can adopt the projection
independently.

The renderer preserves the configured punctuation and heading-anchor behavior, resolves Markdown
links and image destinations against the canonical article URL (or the site base for root-relative
paths), and returns the capability descriptors discovered during rendering. Absolute URLs,
fragments, query strings, and Unicode destinations are covered by tests. Invalid or executable
links fail with a source-scoped error instead of silently producing a successful projection.

This is a body projection, not a complete page or a consumer migration. `representation(Html)`
continues to return the existing native `post.html`; feeds, Admin preview, and syndication are not
switched to `portable_html()` yet. Authored raw HTML remains untouched; raw-HTML policy and
sanitization are scoped to [#114](https://github.com/journey-to-code-org/open.blog/issues/114).

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

## Tests

The focused contract is tested in
[portability.rs](../../crates/openblog-core/src/portability.rs) and
[markdown.rs](../../crates/openblog-core/src/markdown.rs). The golden suite in
[portable_html.rs](../../crates/openblog-core/tests/portable_html.rs) renders the
[video lesson](../../tests/fixtures/portable-html/video-lesson.md) and
[recipe](../../tests/fixtures/portable-html/recipe.md) fixtures and compares them with their
expected `.html` files. It also checks that the output has no runtime-only elements or
attributes, uses only absolute URLs, has a target for every anchor, gives every link an
accessible name and every image alternative text, and leaks neither the comments nor the runner
endpoint. The shared [portability fixtures](../../tests/fixtures/portability-contract.json)
also render through `portable_html()`.
