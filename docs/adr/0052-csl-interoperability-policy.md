# ADR 0052: State which CSL data survives, which is preserved verbatim and which is reported lost

- Status: Accepted
- Date: 2026-10-25
- Decision issue: [#40](https://github.com/journey-to-code-org/open.blog/issues/40)
- Parent story: [#19](https://github.com/journey-to-code-org/open.blog/issues/19)
- Parent epic: [#15](https://github.com/journey-to-code-org/open.blog/issues/15)
- Builds on: [ADR 0012](0012-source-library-interchange.md),
  [ADR 0048](0048-citation-keys-are-source-identifiers.md)
- Contract: [Citation format](../specs/citations.md)

## Context

CSL JSON is the exchange format for references and for citation items. Neither side can store
everything the other holds, and silently dropping data would break trust in an import.

## Decision

**Reference data** keeps ADR 0012 and gains one lookup, `csl_field_fate`, so the policy has a
single readable source:

| Fate | Fields | Behaviour |
| --- | --- | --- |
| stored | `id`, `title`, `language`, `issued`, `author`, `editor`, `translator`, `DOI`, `ISBN`, `ISSN`, `URL`, `PMID`, `PMCID`, `custom` | mapped to library fields and exported again; round-trips |
| preserved | `type` (other than `document`) and variables with no library field (`publisher`, `container-title`, `volume`, ...) | kept verbatim under the record's `csl` field, text or number only |
| private-dropped | `note`, `abstract`, `annote`, `keyword` | never stored and reported, so they cannot reach a public artifact |
| unsupported | anything else | not stored; the import plan reports it with a reason |

**Citation items** map to CSL's `label` and `locator`:

- Kinds `page`, `folio`, `line`, `section`, `chapter` and `timestamp` have the same CSL label.
  `canonical` and `x-` kinds have none.
- CSL has one locator per item. Export writes the first locator, reports each thing CSL cannot
  carry (further locators, a kind with no label, the range structure, since CSL writes a range as
  one text) as a loss, and writes the full ordered list in `openblog-locators`, which CSL
  processors ignore. Import restores that list when its first locator still agrees with `label`
  and `locator`; if someone edited those elsewhere, CSL wins and the disagreement is reported.
- A CSL label with no matching kind is kept as an `x-csl-<label>` extension kind, not dropped,
  and export writes it back as that `label`. A kind cannot hold a space, so CSL's `sub verbo` is
  kept as `x-csl-sub-verbo` through a fixed two-way table and round-trips exactly; any other label
  with spaces is kept with hyphens and the respelling is reported. An item without a label is a
  `page` locator, as CSL specifies.
- `prefix`, `suffix`, `suppress-author`, `author-only`, embedded `itemData` and any other field
  are reported and not stored. The library stays the only source of reference data, and an item's
  `id` must already be a source identifier.
- Nothing contacts a service, and no style is rendered.

## Consequences

- An import never loses data without saying so, and an export-then-import of a citation is
  lossless for open.blog.
- Another tool can read the first locator and ignore the rest, at the cost of the listed losses.
- Supporting grouped citations, prefixes or suffixes later is additive.

## Domain language

**Citation**, **Locator** and **Reference** are defined in [`CONTEXT.md`](../../CONTEXT.md).
