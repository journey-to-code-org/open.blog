# ADR 0220: The curated manifest is previewed from the same resolution the build uses, and off changes nothing

- Status: Accepted
- Date: 2026-10-26
- Decision issue: [#192](https://github.com/journey-to-code-org/open.blog/issues/192)
- Parent story: [#190](https://github.com/journey-to-code-org/open.blog/issues/190)
- Parent epic: [#15](https://github.com/journey-to-code-org/open.blog/issues/15)
- Builds on: [ADR 0125](0125-one-publication-boundary-previewed-from-and-enforced-on-the-builds-own-projections.md), [ADR 0215](0215-curated-research-context-is-one-more-projection-that-selects-only-what-the-other-projections-publish.md)

## Context

Preview and production must agree (ADR 0125), existing sites must build byte for byte as before,
and the file format must be safe to extend.

## Decision

- **One resolution.** `BoundaryManifest` reads the `Resolution` that `resolve` returns, so
  Admin's **What will be public**, `check` and the build report the same published, withheld and
  notice lists. The `curated` report lists each published selection with the fields it copies
  and the fields it withholds (`unsafe-url`, `private-identifier`, `rights`), its context items,
  and each withheld selection with a reason: `withdrawn`, `stale-selection`, `missing-target`,
  `selection-cycle`, `not-approved`, `private-dependency` or `projection-off`. A stale selection
  also prints a `boundary:` warning; none fails the build.
- **Off changes nothing.** The `curated` report appears only when `curatedContext.publish` is on
  or a selections file is stored; the file counts as research for the private-text guard but not
  as a reason to read the research stores. The text of `selections.json` is guarded like every
  private store, so author-written comments cannot reach a page or feed until a projection
  allows them. A site without the file and the switch builds the same bytes and prints the same
  messages, and its manifest is unchanged. A file that cannot be read is named as unavailable
  and changes nothing else.
- **File format and migration.** `selections.json` is `{ "version": 1, "selections": [...] }`; a
  different version is refused (`unsupported-version`) rather than guessed at, unknown fields
  are preserved, and records are written in id order. The public `PublicCuration` value
  (`format: openblog-curated-context`, `formatVersion: 1`) has no `version` key so it is never
  mistaken for the private file.
- **Reversible choices.** Nothing here is a one-way door: no hosted schema, no publication of
  real people's data, no public artifact is written yet. The format version and the public
  projection can still change before #197 writes them.
- **Not decided here.** The Admin curation surface (#196), the pages and a curated-context file
  for Reader Discovery (#197) and portable output and shared reflections (#198) consume
  `PublicCuration` and add no second approval.
