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
switched to `portable_html()` by this task. Authored raw HTML remains untouched, and native
custom-element wrappers may remain in the output. The static children do not require an
open.blog custom-element definition, but the pipeline does not yet provide capability-specific
fallbacks. Those fallbacks and their semantic-loss reporting are scoped to [#112](https://github.com/journey-to-code-org/open.blog/issues/112); raw-HTML policy and sanitization are scoped to [#114](https://github.com/journey-to-code-org/open.blog/issues/114).

The focused contract is tested in
[portability.rs](../../crates/openblog-core/src/portability.rs) and
[markdown.rs](../../crates/openblog-core/src/markdown.rs). It checks URL resolution, deterministic
results, scoped errors, preserved raw HTML boundaries, and that rendering the portable projection
does not mutate the native HTML.
