# ADR 0245: The public paths value is an allowlisted, deterministic projection, and nothing reads a path yet

- Status: Accepted
- Date: 2026-10-27
- Decision issue: [#76](https://github.com/journey-to-code-org/open.blog/issues/76)
- Parent story: [#28](https://github.com/journey-to-code-org/open.blog/issues/28)
- Parent epic: [#16](https://github.com/journey-to-code-org/open.blog/issues/16)
- Builds on: [ADR 0168](0168-the-atlas-query-projection-is-derived-from-the-public-atlas-alone-and-is-one-more-listed-artifact.md),
  [ADR 0240](0240-a-reading-path-is-its-own-content-type-and-never-a-series.md),
  [ADR 0244](0244-a-path-names-only-published-items-and-a-missing-step-is-left-out-and-reported-to-the-author-only.md)
- Contract: [Reading paths](../specs/reading-paths.md#public-projection)

## Context

#77 (Admin), #78 (pages and progress) and #79 (discovery and export) all need the same reading
of a path: which steps, in what order, with what words. If each resolves a path itself they will
disagree about what is published. #76 defines the contract and the one value they share, and
nothing more.

## Decision

- **One value.** `PublicPaths::resolve(paths, targets)` gives `PublicPaths` (format
  `openblog-reading-paths`, version 1) and the author's diagnostics. Pages, the JSON file, search and
  export in later tasks are views of it.
- **An allowlist.** A path carries `slug`, `url` (`/paths/<slug>/`), `title`, `summary` and `steps`.
  A step carries `id`, `position`, `kind` (`post` or `atlas`), `kindLabel`, `target`, `title`, `url`,
  `rationale`, `prerequisites`, `difficulty`, `optional` and `transition` (`relationship`, `label`,
  `why`, `basis`). The title and address of a target are those of the published post or atlas entry,
  never the author's copy. Nothing else is copied, and a field added to a post or the atlas reaches
  paths only when added here.
- **Deterministic.** Paths are sorted by slug, steps keep the author's order, and nothing depends on
  time, locale, file order or the platform. The JSON embed escapes `<`, `>` and `&`.
- **Derived from published inputs only**, and so safe to regenerate and cheap to drop or reshape.
- **Not wired into a build yet.** This task adds no folder scan to `Site::load`, no page, no `paths.json`,
  no sitemap, feed or search entry, no `llms.txt` line and no Admin route. A site with or without a
  `content/paths` folder builds byte for byte as before. The reserved address `/paths/` is
  noted so #78 can refuse a post or page that would collide.
- **One-way doors: none.** Nothing here sends, publishes real people's data or fixes a hosted
  schema. Every file format has a version, and the label list, bounds and public field list can
  change with a version.

## Consequences

- #77 validates a draft by calling `ReadingPath::parse` and `resolve` and shows the diagnostics.
- #78 renders the value and adds the artifact to the publication manifest.
- #79 indexes and exports the value and imports through `parse` with a dry run.
- Paths stay out of feeds and the canonical post order until a later task decides otherwise, and
  #79's criterion that discovery never reorders posts holds by construction.

## Domain language

**Public reading paths** is defined in [`CONTEXT.md`](../../CONTEXT.md).
