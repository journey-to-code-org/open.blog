# Changelog

All notable changes to open.blog are recorded here. Releases follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Reworked the admin into a publishing workspace with grouped tools, a persistent
  publish-status bar, labeled settings/Markdown/preview panes, and an explicit
  mobile pane switcher inspired by the README Studio workspace pattern.
- Added a `Ctrl/Cmd+K` workspace search for navigation, creation, account actions,
  and contextual editor commands, with keyboard result navigation and unsaved-change
  protection when moving between admin views.
- Added editor save-state feedback, live line/word/character counts, `Alt+1/2/3`
  pane focus shortcuts, and persistent wide/tablet/mobile preview widths.
- Added an admin overview with publishing-pipeline totals, quick-create actions,
  content inventory, recent posts, scheduled-post context, and build health.

## [0.4.1] - 2026-10-23

### Added

- A reader-facing guide to safely syndicating open.blog articles to Hashnode, DEV,
  Medium, Ghost, WordPress.com, and self-hosted WordPress.
- A deploy-gated GitHub Actions template and dependency-free DEV adapter that create
  drafts, verify canonical URLs, and update existing articles without duplicating them.

### Changed

- Expanded the starter Getting Started series with a cross-posting walkthrough and
  documented feed, credential, canonical URL, and platform-specific safety requirements.

## [0.4.0] - 2026-10-22

### Added

- Opt-in editor-style Rust examples with syntax colouring, line decorations, inline
  compiler/program output through the official Rust Playground, reset, copy, an optional
  external fallback, a privacy notice, and a no-JavaScript code-block fallback.

## [0.3.0] - 2026-10-22

### Added

- Live search and answer-readiness guidance in the author editor, with the
  same checks available during site builds.
- `llms.txt` and `llms-full.txt` discovery files for AI assistants and answer
  engines.
- Structured author identity, author profile links, richer Open Graph data,
  and Twitter card metadata.
- Privacy-preserving analytics for AI crawler and agent traffic, including
  aggregate provider totals and requested-page breakdowns.
- Independent controls for AI search discovery and AI model-training crawlers.
- An SEO and answer-engine optimization guide for blog authors and operators.

### Changed

- Expanded generated metadata and feeds so posts are easier for search
  engines, answer engines, and social platforms to understand and attribute.
- Updated the starter configuration and documentation for the new SEO,
  author-identity, crawler-policy, and analytics capabilities.

## [0.2.0] - 2026-10-22

### Added

- Interactive Markdown knowledge checks with immediate accessible feedback,
  retry support, and attempts stored only in the reader's browser.
- An admin knowledge-check builder for one to three questions, with editable
  manual entry and optional author-time generation through an owner-configured
  API endpoint and key.
- A sample knowledge check in the starter “Writing a post” article.
- Persistent light and dark modes for the redesigned admin interface.
- Domain documentation, an architectural decision record, and automated
  coverage for quiz rendering, interaction, validation, and provider failures.

### Changed

- Refined the admin navigation, editor, content tables, analytics, dialogs,
  responsive layout, keyboard focus, and visual hierarchy.
- CI now discovers every JavaScript test in `tests/web/`.

[Unreleased]: https://github.com/journey-to-code-org/open.blog/compare/v0.4.1...HEAD
[0.4.1]: https://github.com/journey-to-code-org/open.blog/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/journey-to-code-org/open.blog/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/journey-to-code-org/open.blog/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/journey-to-code-org/open.blog/releases/tag/v0.2.0
