# ADR 0058: Keep Knowledge Atlas entries typed, private by default, and the home of notebook concepts

- Status: Accepted
- Date: 2026-10-25
- Decision issue: [#48](https://github.com/journey-to-code-org/open.blog/issues/48)
- Parent story: [#21](https://github.com/journey-to-code-org/open.blog/issues/21)
- Parent epic: [#15](https://github.com/journey-to-code-org/open.blog/issues/15)
- Builds on: [ADR 0009](0009-research-source-library-identity.md),
  [ADR 0034](0034-private-passages-and-research-notes.md)
- Contract: [Knowledge Atlas format](../specs/knowledge-atlas.md)

## Context

Research notes may link `concepts`, but ADR 0034 only checked their shape because nothing
defined a concept. The Knowledge Atlas describes the people, works, concepts, movements and
events a writer reasons about, and relates them. Two risks shape it. A generic "node" record
loses what each thing is, so a person can be "part of" a concept and a translation can pass
for a work. And a file that anyone can later flag public invites a path to publication that
skips review.

## Decision

The atlas is a private, versioned JSON document owned by `openblog_core::knowledge_atlas`:
`{ "version": 1, "entries": [...], "relationships": [...] }`. Entries and relationships share
one identifier space of immutable lowercase slugs.

- **Five kinds, no generic record.** An entry is a `person`, `work`, `concept`, `movement`
  or `event`. Anything else is refused. Kind is immutable for an id, because relationships
  were checked against it; a different kind of thing is a new entry. Only a `work` entry may
  carry `source`, which must be a source-library record of kind `work` (ADR 0009): editions,
  translations and witnesses are cited as evidence, never made entries, so a translation is
  not an original work.
- **Concept entries are what notebook concepts mean.** A note's `concepts` id resolves to the
  concept entry with that id. The notebook format and parser are unchanged, so an existing
  notebook stays valid with no atlas, and a link to a missing concept is reported
  (`Atlas::concept_links`, `missing_concepts`) rather than refused. A link whose id names a
  person, work, movement or event is reported as the wrong kind. Removing a concept entry is
  refused while a note links to it, so a resolved link cannot silently become unresolved.
- **Entry prose is the author's.** `label`, `aliases` and `summary` are the author's words;
  quotation belongs in notebook passages. Contributor credit fields are refused, as in the
  notebook, because attribution here is about who asserts, not who is credited.
- **Private by default, consent is explicit.** `visibility` is `private` unless `approved`,
  and is always written. `approved` is only the author's recorded consent for the publication
  projection (#51); this module copies nothing, the source and notebook stay private, and an
  approved relationship cannot point at a private entry, cannot be an unsourced draft, and
  cannot carry a pointer into the private notebook. Until storage exists nothing reads or
  writes an atlas file, so builds, feeds, search and exports cannot see one. Unlike the
  notebook, which has no switch at all, the atlas needs per-entry approval (#51); the
  conservative choice is a field that only a projection may act on, and which is reversible
  by editing the value.
- **Dates are context, not structure.** `bounds` is an optional coarse year range (negative
  is BCE, no year 0) kept for display. Nothing orders or relates entries by it. Cited,
  uncertain and competing dates are the chronology contract (#56), which supersedes `bounds`
  with a version bump rather than overloading it.
- **Validation is all-or-nothing and scoped.** Diagnostics name the collection, index, id and
  field and never repeat authored text. `upsert_*` and `remove_*` change the in-memory atlas
  only when the whole result is valid; removal is refused while relationships (or, for a
  concept, notebook notes) depend on the entry. Unknown fields are preserved at every level
  but may not reuse a defined name, serialization is deterministic, and the 4 MiB limit
  applies to the written form. A newer version is refused rather than reinterpreted; control
  and bidirectional override characters are refused in text.

Storage, revision checks and atomic writes (following ADR 0010 and 0035), Admin UI and the
publication projection are separate slices.

## Consequences

- A person can never be "part of" a concept or be a work; the table of allowed endpoints is
  one place to read and extend.
- The storage slice (#49) must check library, notebook and atlas together before deleting a
  source or passage (`uses_of_source`, `uses_of_passage`).
- Approval is a reviewable field, not a bypass: the projection (#51, #72) must re-check it
  and may copy only approved entries.
