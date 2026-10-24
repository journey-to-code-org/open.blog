# Changelog

All notable changes to open.blog are recorded here. Releases follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

- Portable HTML now renders static fallbacks for every current interactive capability:
  quizzes keep their prompt, lettered choices, and the author's answer and explanation behind a
  native `<details>` disclosure; runnable code and web sandboxes keep their labelled source with
  a link to run them on the canonical article; CodePen and YouTube embeds become titled provider
  links; video chapters become an ordered chapter list; recipe facts, callout titles, and
  video production notes stay visible; and comments become a link to the canonical discussion.
  The output needs no open.blog script, custom element, form, or iframe.
- Portable HTML now keeps research and attribution: ordered contributor credits with their roles
  and unauthenticated ORCID iDs (kept apart from the references), the DOI and license, the
  "Originally published at" source, and footnote citations that keep their numbers and ids and
  link to the note on the canonical article. Planned or unknown capabilities fail closed: their
  authored content stays visible with a labeled link to the canonical article and a
  canonical-only report, while private-only state adds nothing to the copy or its report.
- Portable HTML now rewrites authored raw HTML through a documented allowlist: scripts, styles,
  event handlers, forms, `<base>` and `<meta>` tags, comments, and custom elements are removed
  or unwrapped (Markdown inside a removed element goes with it); frames, media, SVG, and MathML
  become a link to the canonical article; heading `{key=value}` attributes are dropped; and each
  removal is reported as a `raw-html` capability. Raw HTML URLs resolve against the canonical
  article like Markdown links, ids stay unique across raw HTML, headings, and footnotes, every
  image gets `alt`, and the body stays well nested. Native pages are unchanged.
- The portable projection fails for that post with a source-scoped diagnostic, instead of
  publishing or truncating, when a raw HTML or `sourceUrl` address is unsafe (including `data:`
  and encoded `javascript:` URLs), a removed element or comment that is never closed would hide
  later content, or the body exceeds 2 MiB or 64 levels of nesting.
- Fixed quizzes and web sandboxes failing to build when nested in a callout, quote, or list item.

## [0.15.0] - 2026-10-24

- Added private per-admin workspace personalization to Admin Studio: Simple (the new default),
  Guided, Advanced, and Custom presets; showing, hiding, and reordering optional tools; comfortable
  or compact density; a default Visual or Markdown writing mode; and Restore defaults. A
  goal-grouped **Advanced tools** dialog, the **More tools** menu, and `Ctrl+K` keep every tool
  reachable in every preset, and Write, Site preview, Settings, save and publish state, conflicts,
  privacy notices, approvals, and blocking validation can never be hidden or reordered.
- Stored workspace preferences as a bounded, schema-versioned file per login under
  `.openblog/private/admin-preferences/`, behind login and CSRF checks, with atomic,
  revision-checked saves so a change from another tab is reloaded instead of overwritten. They never
  reach posts, `openblog.json`, the built site, feeds, or exports, and unavailable storage falls back
  to a usable Simple workspace with a notice.
- Admins whose browser remembered a writing mode from an earlier release move once into the
  Advanced layout with that mode; every other login, including others in the same browser, starts
  in Simple.

## [0.14.0] - 2026-10-24

- Defined the semantic portability invariant and domain language for derived output,
  destination policies, private/public boundaries, and canonical work identity.
- Added core descriptors for authored Markdown capabilities, including renderer,
  fallback, portability, and bounded diagnostics, without changing authoring syntax.
- Added a destination-neutral projection for canonical identity, existing HTML,
  Markdown, and text views, authorship, references, capabilities, and safe links;
  routed public feeds and syndication through it without changing authored content.
- Added a shared portability fixture corpus covering legacy articles, research and
  credits, recipes, callouts, media, quizzes, runnable code, unknown syntax, hostile
  code, Unicode, duplicate anchors, and draft exclusion.
- Published an implementation-status matrix separating shipped capabilities,
  partial support, and planned work without assigning unverified portability levels.
- Audited generated native HTML and optional custom elements, documenting no-JavaScript
  and no-CSS behavior, accessibility caveats, and the raw-HTML trust boundary.
- Audited semantic differences across Markdown, native pages, feeds, and syndication;
  extended shared fixtures across these output surfaces and documented known losses.
- Defined portability completion gates for planned research, reader, collaboration, and
  discovery capabilities, with unique story/task ownership and machine-checked fallbacks,
  privacy boundaries, and regression requirements.
- Added an opt-in portable HTML body projection that re-renders canonical Markdown, resolves
  authored link and image URLs against the post/site context, and leaves existing native HTML
  unchanged; raw-HTML sanitization and capability-specific fallbacks remain separately scoped.

## [0.13.0] - 2026-10-24

- Added `openblog syndicate <slug>` with dry-run planning, draft-first DEV, Hashnode,
  Ghost, and WordPress adapters, guided Medium import, private remote-ID state, and
  explicit two-step publication safety.
- Added optional provider-neutral code-runner configuration for credential-free, explicitly
  allowlisted executable lessons while preserving the official Rust Playground default and static
  fallback for unsupported languages.
- Expanded Assistant Interactions to propose strictly validated Rust, web, and configured-runner
  examples or coding challenges without executing code in the blog or Admin process.
- Added dependency-free `web runnable` HTML/CSS/JavaScript sandboxes with editable tabs and a
  CSP-restricted opaque-origin preview.
- Added structured video production stages, season/episode numbers, credits, an Admin workflow,
  and a complete fictional Zhalendor example production post.
- Added per-post open, locked, and hidden comment policies plus pending, approved, and rejected
  Admin moderation queues.
- Added optional Supabase-backed Netlify Functions for moderated comments and persistent,
  privacy-respecting view analytics, with a checked-in SQL schema and deployment guide.
- Added hosted engagement settings and pending-comment moderation to Admin Analytics. Public
  endpoints live in `openblog.json`; the matching Admin token is write-only, privately protected,
  bound to its endpoint origin, and can be overridden with `OPENBLOG_ENGAGEMENT_API_KEY` plus
  `OPENBLOG_ENGAGEMENT_API_ORIGIN`. Admin requests reject redirects and public writes use
  Supabase-backed per-client and per-site quotas.
- Expanded Assistant Interactions with editable runnable Rust examples and bounded coding challenges,
  including selected-section grounding, visible TODO and expected-result requirements, explicit
  insertion in Visual or Markdown mode, and a non-AI authoring path.
- Updated the Learning design review skill and versioned publishing-engine guide so recommendations
  distinguish recall checks, exploratory examples, and guided coding practice without inventing
  unsupported languages, multi-file projects, hidden tests, or automatic grading.

## [0.12.0] - 2026-10-24

- Added native Assistant integrations for OpenAI, Google Gemini, xAI Grok, DeepSeek, Mistral AI,
  and OpenRouter with fixed official destinations, provider-specific environment credentials,
  structured-output adapters, editable model choices, and strict local result validation.
- Added a versioned publishing-engine guide to Assistant requests so reviews, quiz proposals, and
  autocomplete understand native open.blog syntax, profiles, scheduling, and source boundaries.
- Added safe local application and one-step undo for exact AI review suggestions, with Unicode range
  handling and fail-closed stale, ambiguous, repeated, and overlapping edit detection.
- Added session-only opt-in AI autocomplete for Visual and Markdown writing, with explicit data
  disclosure, debouncing, selected context, stale-response suppression, abort-on-navigation, and
  author-controlled accept or dismiss actions.
- Completed Assistant Interactions by connecting it to the reviewed knowledge-check proposal flow.
- Added a CI-enforced documentation link and heading-anchor check, and expanded the documentation
  index and project overview to cover the completed author-time Assistant workflows.

## [0.11.2] - 2026-10-23

- Grounded Assistant reviews in trusted open.blog renderer capabilities so native quiz and
  runnable Rust fences are reviewed for authoring quality without being misreported as unsupported.

## [0.11.1] - 2026-10-23

- Made review verification labels context-aware and conservatively downgraded unsupported
  `supplied-context` claims to unverified advice instead of discarding an otherwise valid review.
- Extended native Anthropic Assistant requests to four minutes while preserving the existing
  30-second custom-provider deadline, allowing first-use structured-output grammar compilation.
- Constrained native Anthropic Assistant replies with task-specific JSON schemas so every review
  finding includes its required source range, and safely re-anchors incorrect provider offsets
  when their exact evidence occurs only once in the reviewed Markdown.
- Fixed Anthropic reviews that could spend the entire output budget on adaptive thinking before
  returning JSON, and now report safe, actionable stop-reason errors for empty responses.
- Added native Anthropic Claude support with the correct Messages API authentication and response
  adapter, plus an author-friendly provider choice that keeps custom HTTPS integrations compatible.
- Added an Assistant provider settings panel for endpoint and model configuration plus write-only
  private credential replacement and clearing, with environment credentials taking precedence.
- Refined Assistant provider setup into a compact connection card with clear status, progressive
  disclosure, author-friendly guidance, and confirmed credential removal.

## [0.11.0] - 2026-10-23

### Added

- Added a post Assistant workspace with keyboard and command-palette navigation, labelled
  Review, Interactions, and Context areas, and an authenticated credential-safe provider
  capability summary that leaves non-AI authoring available when configuration is missing.
- Added portable and private author/site Assistant context management with bounded UTF-8 files,
  atomic conflict-safe saves, Git safety warnings, publish exclusions, and a selected-context
  disclosure preview.
- Added portable and private post briefs, bounded Markdown/text references, and immutable existing-
  post snapshots to Assistant context, including transactional post rename and deletion handling.
- Added explicit URL-context snapshots with inspect-before-save metadata, selectable portable or
  private storage, SSRF-safe DNS and redirect validation, and bounded textual extraction without
  implicit refetching.
- Added seven inspectable, non-executable Markdown review skills plus validated project skills,
  explicit built-in overrides, repair guidance, and conflict-safe editing.
- Added document review over the current unsaved draft with selected skills and context, strict
  all-or-nothing structured findings, source anchoring, provider disclosure, and clearly labelled
  AI advice that never edits or saves the draft automatically.
- Added Visual and Markdown writing modes in Admin, with a remembered author preference,
  Heading 2–6 selection, familiar rich-text controls, and protected advanced blocks that
  retain source the visual editor cannot safely represent.

- Added a Field journal content profile for hikes and other place-based notes, with field
  facts, route and elevation drawings, structured place metadata, and hidden-by-default
  location handling.
- Added an Admin Field Review workflow that analyzes GPX locally, derives deterministic
  measurements, trims endpoints, and uploads source tracks only when Exact mode is chosen.

- Added a Video production content profile with privacy-enhanced YouTube embeds, duration
  and thumbnail metadata, creator-authored AI-assistance disclosure, and `VideoObject`
  structured data.
- Added an Admin release kit that extracts timestamp lines from Markdown, validates YouTube
  chapter rules, and composes a copy-ready description from the current draft.

## [0.10.1] - 2026-10-23

### Added

- Added a runnable research and contributor-credit demonstration to the repository example
  site, with synthetic registry identities, ordered Crossref/CRediT roles, an adjacent credit
  sidecar, visible references, a reusable license, feeds, and scholarly structured data.

### Changed

- Linked the README and authoring documentation directly to the example's configuration,
  Markdown, and sidecar files, with commands for inspecting them in Admin Studio or a build.

## [0.10.0] - 2026-10-23

### Added

- Added a stable contributor registry with public profile links, normalized manually entered
  ORCID identifiers, `sameAs` identities, and explicit provenance boundaries that avoid
  presenting editable identity data as authenticated.
- Added versioned per-post credit sidecars with ordered contributors and controlled
  Crossref/CRediT roles, including explicit-empty credits and legacy site-author inheritance.
- Added Admin Studio tools for managing contributor identities and per-post credits with
  conflict detection, reference-aware deletion, repair states, and source-preserving saves.
- Added `openblog contributors migrate --id <stable-id>` with a dry-run default and explicit
  `--write` mode for safely converting inherited authorship to reusable contributor credits.

### Changed

- Published bylines, article JSON-LD (including recipe posts), RSS, JSON Feed, and research
  metadata now use the resolved ordered contributor credits while preserving legacy author
  behavior for existing sites.
- Admin and CLI content writes, imports, migrations, and publishing now share a filesystem
  transaction lock so configuration and credit sidecars cannot be published half-written.
- Document listing, preview, save, delete, and validation now understand adjacent
  credit sidecars and surface malformed, orphaned, or ambiguous ownership errors.

## [0.9.0] - 2026-10-23

### Added

- Added the opt-in `research` content profile with DOI and license authoring fields, visible
  work metadata, ordinary-Markdown Abstract and References/Bibliography sections, and
  bounded reference extraction.
- Added deterministic evidence findings shared by `openblog check`, builds, and admin
  previews for research structure, DOI and license syntax, footnotes, reference links, and
  preferred DOI resolver links.
- Added `ScholarlyArticle` JSON-LD and conservative Highwire title, author, and publication
  date metadata, while omitting unsupported venue, publisher, review, and indexing claims.
- Added Evidence Studio with current-document findings, normalized work-metadata inspection,
  engine-backed Abstract/References insertion actions, dynamic profile fields, and `Alt+7`.

### Changed

- Build reports and `openblog check` now print evidence findings with stable codes, outcomes,
  source locations, and repair guidance separately from accessibility and SEO guidance.
- Profile-specific editor drafts now survive profile switches and save losslessly, including
  explicit field clears.

## [0.8.0] - 2026-10-23

### Added

- Added one structured accessibility audit shared by the core engine, `openblog check`,
  builds, and the admin preview. Findings use stable codes, canonical source locations,
  outcome labels, repair guidance, and informative standards references where applicable.
- Added bounded source checks for empty link names, missing site language, image
  alternatives, heading jumps, generic link text, tables, media, production embeds, and
  raw HTML without presenting context-dependent concerns as certain failures.
- Added a dedicated Accessibility Studio editor view with outcome counts, grouped findings,
  exact source context, next actions, and rendered-site manual-review guidance. It is
  available from normal editor navigation and `Alt+6`.

### Changed

- Build and check output now reports accessibility findings separately from publishing and
  SEO warnings. The accessibility reporter adds no pass or WCAG-conformance statement when
  its finding list is empty.
- Admin previews return only site-wide findings and findings for the document being edited,
  so another post's guidance cannot leak into the current workflow.

## [0.7.0] - 2026-10-23

### Added

- Added a content-profile catalog shared by the publishing engine and admin, beginning
  with the general-purpose `article` profile and the structured `recipe` profile.
- Added a Content profile selector to post settings, including visible fallback guidance
  for unknown profile ids and structured authoring-field metadata for future profiles.

### Changed

- Made `profile: recipe` the canonical way to select recipe behavior while retaining
  byte-for-byte generated-output compatibility with `recipe: true` and the existing
  `type`, `layout`, and `kind` recipe aliases.
- Unknown profile ids now round-trip without data loss, render safely as articles, and
  produce source-scoped build and preview warnings. A canonical `profile` takes precedence
  over contradictory legacy recipe markers and reports the conflict.

## [0.6.2] - 2026-10-23

### Changed

- Updated the project overview and documentation index to describe the focused writing
  workspace, publishing-faithful theme preview, social cards, readiness guidance, and
  source-preserving editing added in 0.6.0.
- Documented post, series, and site theme precedence with a practical pre-publish testing
  workflow, plus troubleshooting for base-path stylesheet MIME errors and the expected
  signed-out session probe.

## [0.6.1] - 2026-10-23

### Fixed

- Served the admin shell's root-relative theme and base styles from the built site when a
  configured deployment base path is active, preventing HTML fallback responses and strict
  MIME-type stylesheet failures during local administration.

## [0.6.0] - 2026-10-23

### Added

- Production-faithful draft previews that use the same site model, theme inheritance,
  renderer, metadata, and components as a published build while keeping front matter hidden.
- A dedicated social-card view backed by the exact resolved OpenGraph and X metadata emitted
  by the renderer, including canonical and site-image fallbacks.
- A transparent SEO and answer-readiness workspace with grouped search, answer-structure,
  trust, accessibility, and source-link guidance.
- Source-preserving Markdown controls for headings, emphasis, links, quotes, lists, and code,
  including keyboard shortcuts and undo-aware editing.

### Changed

- Replaced the permanent side-by-side editor with focused full-width Write, Site preview,
  Social, Optimize, and Settings views.
- Deferred expensive publishing-engine previews until Site preview or Social is visible and
  prevented stale asynchronous responses from replacing newer drafts.
- Hardened unpublished previews with authenticated random URLs, a bounded in-memory cache,
  opaque-origin sandboxing, restricted script origins, and disabled snippets and analytics.

## [0.5.0] - 2026-10-23

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

[Unreleased]: https://github.com/journey-to-code-org/open.blog/compare/v0.15.0...HEAD
[0.15.0]: https://github.com/journey-to-code-org/open.blog/compare/v0.14.0...v0.15.0
[0.14.0]: https://github.com/journey-to-code-org/open.blog/compare/v0.13.0...v0.14.0
[0.13.0]: https://github.com/journey-to-code-org/open.blog/compare/v0.12.0...v0.13.0
[0.12.0]: https://github.com/journey-to-code-org/open.blog/compare/v0.11.2...v0.12.0
[0.11.2]: https://github.com/journey-to-code-org/open.blog/compare/v0.11.1...v0.11.2
[0.11.1]: https://github.com/journey-to-code-org/open.blog/compare/v0.11.0...v0.11.1
[0.11.0]: https://github.com/journey-to-code-org/open.blog/compare/v0.10.1...v0.11.0
[0.10.1]: https://github.com/journey-to-code-org/open.blog/compare/v0.10.0...v0.10.1
[0.10.0]: https://github.com/journey-to-code-org/open.blog/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/journey-to-code-org/open.blog/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/journey-to-code-org/open.blog/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/journey-to-code-org/open.blog/compare/v0.6.2...v0.7.0
[0.6.2]: https://github.com/journey-to-code-org/open.blog/compare/v0.6.1...v0.6.2
[0.6.1]: https://github.com/journey-to-code-org/open.blog/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/journey-to-code-org/open.blog/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/journey-to-code-org/open.blog/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/journey-to-code-org/open.blog/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/journey-to-code-org/open.blog/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/journey-to-code-org/open.blog/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/journey-to-code-org/open.blog/releases/tag/v0.2.0
