# Content-capability portability matrix

- Status: implemented first iteration (audit document only; no rendering changes)
- Date: 2026-10-24
- Issue: [#107](https://github.com/journey-to-code-org/open.blog/issues/107) (Task P2.1)
- Parent story: [#94](https://github.com/journey-to-code-org/open.blog/issues/94) · Parent epic: [#92](https://github.com/journey-to-code-org/open.blog/issues/92)
- Depends on completed contract work: [#105](https://github.com/journey-to-code-org/open.blog/issues/105) (`PortableProjection`) and
  [#106](https://github.com/journey-to-code-org/open.blog/issues/106) (portability-contract fixtures)

## Purpose and boundaries

This document inventories, capability by capability, what open.blog actually does today versus
what is only planned in later epics. It changes no rendering behavior (out of scope per #94/#107)
and assigns no final portability level (out of scope per #107 and ADR 0004). Every row cites the
parser, domain model, renderer, feed, Admin, or syndication source that backs its claim. Where a
capability has no shipped behavior, the entry says "planned" and cites the issue that scopes it
instead of describing a hypothetical implementation.

### Portability-level vocabulary (defined, not newly assigned here)

[ADR 0004](../adr/0004-portable-projections-from-canonical-work.md) and the parent epic
([#92](https://github.com/journey-to-code-org/open.blog/issues/92)) define three levels reused
below only where a `CapabilityDescriptor` or fixture already records one:

- **Fully portable** — the portable representation preserves authored meaning and remains usable
  without open.blog's native interaction runtime.
- **Gracefully transformed** — a simpler representation preserves essential content and
  attribution; material semantic loss is reported.
- **Canonical-only interaction** — no portable interaction is claimed; the reader is directed to
  the canonical article.

### How native output, feeds, Admin preview, and syndication currently relate

- `PortableProjection::representation(RepresentationFormat::Html)` returns `post.html` unchanged —
  the same authored/native HTML string used for the native page
(`crates/openblog-core/src/portability.rs:158-164`, confirmed by
`crates/openblog-core/src/portability.rs:346-349` asserting
  `projection.representation(RepresentationFormat::Html) == post.html`). The separate
  `PortableProjection::portable_html()` API re-renders retained authored Markdown and resolves
  Markdown link and image destinations without parsing native HTML; it is an opt-in body projection,
  not yet consumed by feeds, Admin preview, or syndication. It renders static fallbacks for
  quizzes, runnable code, web sandboxes, embeds, video chapters, recipes, callouts, and comment
  participation ([#112](https://github.com/journey-to-code-org/open.blog/issues/112)), keeps
  credits, DOI/license, footnote citations, and source provenance, and fails closed for planned
  capabilities ([#113](https://github.com/journey-to-code-org/open.blog/issues/113)), but
  preserves authored raw HTML, so sanitization remains future work under
  [#114](https://github.com/journey-to-code-org/open.blog/issues/114). See the
  [portable HTML pipeline](./portable-html-pipeline.md) for its exact boundaries. Story
  [#95](https://github.com/journey-to-code-org/open.blog/issues/95) remains in progress until the
  planned capability-specific work is complete; [#96](https://github.com/journey-to-code-org/open.blog/issues/96)
  (portable Markdown export) is still unimplemented.
- RSS (`crates/openblog-core/src/feeds.rs:13-101`) and JSON Feed
  (`crates/openblog-core/src/feeds.rs:106-181`) both call
  `projection.representation(RepresentationFormat::Html)` for `<content:encoded>` /
  `content_html` when `feeds.full_content` is enabled, i.e. feeds currently embed the **native**
  HTML (including custom elements such as `<ob-quiz>`, `<ob-rust-playground>`, and
  `<ob-web-sandbox>`) after the existing root-relative `src`/`href` URL absolutization, rather
  than a feed-appropriate simplified fallback. Story
  [#97](https://github.com/journey-to-code-org/open.blog/issues/97) ("Make RSS and JSON Feed use
  appropriate portable representations") is open and unimplemented.
- Admin's **Site preview** "produced by the same site model, document renderer, theme
  inheritance, metadata, and components as a real build" (`docs/admin.md:24`), so Admin preview
  renders the identical native markup described in this matrix — there is no distinct Admin
  "portable preview" yet (`#100` is open and unimplemented: "Add portable publication previews to
  Admin Studio", epic #92 M4).
- Syndication (`docs/specs/automated-syndication.md:71-78`) sends either raw authored Markdown
  (DEV, Hashnode) or rendered HTML (Ghost, WordPress) built from the same renderer; it does not
  yet consult a destination-specific capability policy (`#101`, "Define destination-specific
  conversion policies and capabilities", is open). The detailed URL, attribution, reference,
  and text-loss comparison is in the [Markdown/feed/syndication audit](./markdown-feed-syndication-audit.md).

## Matrix

| Capability | Status | Owner (code) | Native HTML | No-JavaScript behavior | Feeds (RSS/JSON Feed) | Admin preview | Syndication | Citations |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Articles | Implemented | Markdown→HTML pipeline | Full CommonMark+GFM rendering; raw HTML passed through | Static HTML; no runtime dependency | Native HTML embedded when `feeds.full_content`, with root-relative `src`/`href` URLs absolutized | Same renderer, so authored post HTML is byte-identical | Markdown or rendered HTML per target | `crates/openblog-core/src/markdown.rs:1-75`; `crates/openblog-core/src/feeds.rs:396-397`; `docs/content.md:194-199` |
| Research/citations | Implemented (bounded) | `crates/openblog-core/src/research.rs` | `## Abstract`/`## References` sections stay ordinary Markdown; DOI/license meta line inserted (`render.rs:1328-1346`) | Fully readable; DOI/license line is plain text/links | `ResearchMetadata` is part of `post.html`, so included like any article content | Evidence view surfaces the same `EvidenceFinding`s (`docs/research-profile.md`) | No dedicated citation transform; passes through with the rest of the HTML/Markdown | `crates/openblog-core/src/research.rs:14-109,297-360`; `crates/openblog-core/src/render.rs:1247-1261` |
| Credits/bylines | Implemented | `crates/openblog-core/src/contributor.rs` | Ordered `<aside class="ob-contributions">` list with roles and unauthenticated-ORCID disclosure; legacy posts fall back to `<a class="p-author h-card">` | Fully static text/links, no script | RSS `<dc:creator>` / JSON Feed `authors[]` ordered by explicit credit (`feeds.rs:54-66,144-163`); legacy uses site author | Same renderer | Explicit authors carried in Markdown/HTML sent to targets (no structured transform) | `crates/openblog-core/src/render.rs:2057-2122`; `crates/openblog-core/src/feeds.rs:54-66,144-163`; closed issues [#9](https://github.com/journey-to-code-org/open.blog/issues/9)/[#10](https://github.com/journey-to-code-org/open.blog/issues/10) |
| Recipes | Implemented | `crates/openblog-core/src/recipe.rs` + `markdown.rs` block transform | `Ingredients`/`Steps` sections wrapped as `ob-recipe-part` with schema.org `Recipe` JSON-LD | Ingredients/steps remain a plain list; "cook mode" and "print recipe" are progressive-enhancement extras | Included as ordinary HTML | Same renderer; preview shows summary card | Rendered HTML/Markdown passed through unchanged | `crates/openblog-core/src/recipe.rs:1-80`; `tests/fixtures/portability-contract.json:58-90` (`recipe-callout-media` fixture); `docs/content.md:394-481` |
| Callouts | Implemented | `markdown.rs::callout_label` + block transform | `<aside class="ob-callout ob-callout-<kind>" role="note">` with a `<p class="ob-callout-title">` | Fully static; no JS involved at all | Included verbatim in `post.html` | Same renderer | Passed through as part of HTML/Markdown | `crates/openblog-core/src/markdown.rs:182-189,1340-1349` (test `github_style_callouts`); `tests/fixtures/portability-contract.json:63-90` |
| Quizzes (knowledge checks) | Implemented; gracefully transformed | `markdown.rs::parse_quiz`/`render_quiz`; `capability.rs` | `<ob-quiz>` with visible `<fieldset>`, radio inputs (`data-correct` marks the answer in source), and a `hidden` feedback/explanation paragraph | Choices are visible and selectable as plain radio inputs; feedback and retry button stay `hidden` without JS (no scored interaction) | Quiz markup is embedded in full-content feeds as-is (no simplified text fallback yet) | Same renderer; Admin also offers a form-based "Add knowledge check" authoring UI (`docs/content.md:212-235`) | Passed through as raw HTML/Markdown with the quiz markup intact | `crates/openblog-core/src/markdown.rs:252-360`; `crates/openblog-core/src/capability.rs:63-69`; fixture `knowledge-check` in `tests/fixtures/portability-contract.json:91-116` records `level: "gracefully-transformed"`, fallback `static-question-and-choices`, and `semanticLoss`: "The current text view omits fenced quiz content" |
| Runnable code | Implemented; gracefully transformed | `markdown.rs` fence handling; `capability.rs` | `rust runnable` → `<ob-rust-playground>` wrapping `<pre><code>`; configured-language fences → `<ob-code-runner>` | Source code remains fully visible/readable/copyable in `<pre><code>`; only Run/Reset/output require JS (`docs/specs/executable-code-lessons.md`) | Embedded verbatim in full-content feeds | Same renderer | Markdown/HTML sent as-is; no remote execution occurs during syndication | `crates/openblog-core/src/markdown.rs:1290-1330` (tests); `crates/openblog-core/src/capability.rs:64-68`; fixture `runnable-and-web-sandbox`, `tests/fixtures/portability-contract.json:117-142` (`level: "gracefully-transformed"`, fallback `pre-code`) |
| Web sandboxes (HTML/CSS/JS) | Implemented; gracefully transformed | `markdown.rs::valid_web_sandbox_source`; `capability.rs` | `<ob-web-sandbox>` with the authored HTML/CSS/JS escaped into visible `<pre><code>` sections | Authored source stays readable as escaped text; the live, isolated iframe preview requires JS | Embedded verbatim | Same renderer | Markdown/HTML sent as-is | `crates/openblog-core/src/markdown.rs:165-179`; fixture `runnable-and-web-sandbox`, `tests/fixtures/portability-contract.json:117-142` (fallback `source-code`); `docs/specs/interactive-web-video-comments.md` |
| Video/audio | Partial (video implemented; no dedicated audio capability) | `crates/openblog-core/src/video.rs`; `crates/openblog-core/src/embed.rs` | YouTube URLs become `<youtube-nocookie.com>` iframes via `embed::detect`/`VideoMetadata::embed_url`, plus a visible fallback link; `VideoObject` JSON-LD when fields are present | Fallback `<a>` link to YouTube is always present; raw `<audio>`/`<iframe>` authored directly in Markdown passes through unprocessed (CommonMark raw-HTML passthrough) since there is no dedicated audio capability | Included as part of `post.html` | Same renderer; Admin's Release kit (JS-only) composes a YouTube description, it does not change the published page | Passed through as-is | `crates/openblog-core/src/video.rs:1-85`; `crates/openblog-core/src/embed.rs:36-70`; `docs/content.md:194-197` (raw HTML passthrough); `docs/video-production.md:30-46` |
| Timestamps (video chapters) | Implemented (as plain Markdown + Admin-only validation) | `web/admin/admin.js::buildVideoReleaseKit` | Chapters are "ordinary timestamp lines" the author writes directly in Markdown body text (`docs/video-production.md:52-66`); no Rust parser or dedicated renderer owns them | Fully static plain text — no JS dependency for reading | Timestamp text is ordinary body text, carried through feeds like any other paragraph | Admin's Release kit (`Alt+4`) parses/validates chapters (first at `00:00`, ≥3 chapters, chronological order, ≥10s each) purely client-side in JS and composes a YouTube release description; it does not alter the published post | No special handling; plain text travels with the rest of the Markdown/HTML | `web/admin/admin.js:632-692`; `docs/video-production.md:48-66` |
| Shared Perspectives | Planned (not implemented) | — | — | — | — | — | — | Epic [#143](https://github.com/journey-to-code-org/open.blog/issues/143) "Shared Perspectives — Collaborative, Source-Led Publishing"; no child story (`#144`–`#152`) has shipped code in this repository. Grep for "shared perspective" across `crates/` and `web/` returns no implementation matches |
| Questions/discussions | Partial (generic comments implemented; passage-specific Q&A/corrections planned) | `crates/openblog-core/src/model.rs::CommentsPolicy`; `render.rs`; `netlify/functions/engagement.mjs` | Per-post `<ob-comments>` element with `mode="locked"` when configured; omitted entirely when `comments: hidden` | `<ob-comments path="..." endpoint="..."><p>Comments require JavaScript.</p></ob-comments>` — explicit no-JS fallback text | Comments are not embedded in feeds (separate hosted endpoint only) | Admin exposes moderation queues for the same hosted comments (`docs/specs/hosted-engagement.md`) | Not syndicated; comments remain on the canonical page | `crates/openblog-core/src/render.rs:1145-1161`; `docs/specs/hosted-engagement.md`; planned passage-specific questions/corrections: issue [#29](https://github.com/journey-to-code-org/open.blog/issues/29) "Ask passage-specific questions and submit evidence-based corrections" and the "Third Perspective" workstream `#201`–`#207` referenced in epic [#16](https://github.com/journey-to-code-org/open.blog/issues/16) — neither has shipped code |
| Reflections | Planned (not implemented) | — | — | — | — | — | — | Child stories [#144](https://github.com/journey-to-code-org/open.blog/issues/144) "Create a shared reflection from source material" and [#146](https://github.com/journey-to-code-org/open.blog/issues/146) "Write independently with protected drafts" under epic #143; no implementation found in `crates/` or `web/` |
| Source previews | Planned (not implemented) | — | — | — | — | — | — | Issue [#25](https://github.com/journey-to-code-org/open.blog/issues/25) "Explore interactive citations and source previews" under epic [#16](https://github.com/journey-to-code-org/open.blog/issues/16); no implementation found. (Today's research references are plain Markdown links with no preview affordance — `crates/openblog-core/src/research.rs:86-93`.) |
| Guided explanations | Planned (not implemented) | — | — | — | — | — | — | Issue [#26](https://github.com/journey-to-code-org/open.blog/issues/26) "Choose standard, guided, or deep-dive reading" under epic #16; no implementation found |
| Knowledge relationships | Planned (not implemented) | — | — | — | — | — | — | Issues [#21](https://github.com/journey-to-code-org/open.blog/issues/21) "Build a contextual Knowledge Atlas" (epic #15) and [#27](https://github.com/journey-to-code-org/open.blog/issues/27) "Explore concepts and intellectual relationships" (epic #16); no implementation found |
| Translation comparisons | Planned (not implemented) | — | — | — | — | — | — | Issues [#22](https://github.com/journey-to-code-org/open.blog/issues/22) "Compare editions, translations, and interpretations" (epic #15) and [#31](https://github.com/journey-to-code-org/open.blog/issues/31) "Compare scholarly interpretations and audience-aware explanations" (epic #16); no implementation found |
| Timelines | Planned (not implemented) | — | — | — | — | — | — | Issue [#23](https://github.com/journey-to-code-org/open.blog/issues/23) "Explore historical chronology and intellectual relationships" under epic #15; no implementation found |
| Diagrams | Planned, not yet scoped by any issue | — | — | — | — | — | — | No issue, ADR, research note, or source file in this repository defines diagram authoring or rendering. Searched `crates/`, `web/`, and `docs/` for "mermaid" and "diagram" — no matches other than this document. Raw HTML/image passthrough (`docs/content.md:194-197`) lets an author embed a pre-rendered diagram image today, but there is no dedicated diagram capability, syntax, or descriptor |

## Notes on scope and gaps

- **No rendering behavior changed.** This document only reads existing source; it does not add,
  remove, or modify any parser rule, renderer branch, feed field, Admin surface, or syndication
  adapter.
- The portability gates for upcoming research/reader capabilities live in the
  [planned-capability registry](./planned-capability-contracts.md) and its
  [machine-checked contract data](./planned-capability-contracts.json); planned work must use its
  existing story and unique contract owner rather than adding parallel exporters.
- **No final portability levels assigned beyond what code/fixtures already record.** The three
  rows with a recorded level (Quizzes, Runnable code, Web sandboxes) cite the exact
  `CapabilityDescriptor`/fixture source; the matrix does not extend that classification to
  capabilities the descriptor system does not cover (articles, recipes, callouts, research,
  credits, video, timestamps) or to anything still planned.
- **"Shared Perspectives", "Questions/discussions" (passage-specific), "Reflections", "Source
  previews", "Guided explanations", "Knowledge relationships", "Translation comparisons",
  "Timelines", and "Diagrams"** are drawn directly from the epic roadmap
  (`crates/openblog-core` has no matching modules); treating any of them as shipped would misrepresent
  the backlog recorded in issues #15, #16, and #143. Generic post comments (implemented) are a
  distinct, narrower capability from the planned passage-specific questions/corrections workstream.
- **Feeds and Admin preview currently reuse native HTML rather than a distinct portable
  representation.** This is expected per #105/#106 (which defined the projection seam and
  fixtures) and is not a defect of this audit; the distinct portable-HTML/Markdown transforms are
  scoped to the still-open stories #95, #96, #97, and #100.
- **Ambiguity:** the parent epic (#92) lists "#103/#107" first in its MVP sequence, but #107's own
  body states it is unblocked ("Blocked by: None") and scoped only to publishing this audit
  document; this document does not depend on or anticipate #103's outcome.
