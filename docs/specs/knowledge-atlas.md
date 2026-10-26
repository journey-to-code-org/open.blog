# Knowledge Atlas format

The private Knowledge Atlas holds contextual entries and the attributed relationships between
them. It is owned by `openblog_core::knowledge_atlas`; decisions are in
[ADR 0058](../adr/0058-knowledge-atlas-entries-keep-their-kind.md) and
[ADR 0059](../adr/0059-attributed-evidence-based-relationships.md). Nothing reads or writes an
atlas file yet, and nothing in it reaches a public page, feed, search index or export until an
explicit publication projection copies approved items.

```json
{
  "version": 1,
  "entries": [
    { "id": "plato", "kind": "person", "label": "Plato", "aliases": ["Πλάτων"],
      "bounds": { "from": -428, "until": -348 } },
    { "id": "republic", "kind": "work", "label": "Republic", "source": "plato-republic" },
    { "id": "allegory", "kind": "concept", "label": "Allegory" }
  ],
  "relationships": [
    { "id": "r-authored", "kind": "authored", "from": "plato", "to": "republic",
      "assertedBy": { "kind": "source", "source": "scholar-book" },
      "confidence": "plausible",
      "evidence": [{ "source": "republic-slings", "locators": [{ "kind": "page", "value": "514" }] }],
      "uncertainty": "Authorship of some dialogues is disputed.",
      "contestedBy": [{ "by": { "kind": "named", "name": "Another reading" }, "note": "Dates it later." }] }
  ]
}
```

## Entries

`id` (slug, shared with relationships), `kind` (`person`, `work`, `concept`, `movement`,
`event`), `label` (at most 200 characters), optional `aliases` (20), `summary` (the author's
prose, 20,000 characters), `source` (work entries only; a source-library record of kind
`work`), `bounds` (`from`/`until` whole years, negative is BCE, no year 0), and `visibility`
(`private` default, or `approved`). A notebook note's `concepts` id resolves to the concept
entry with the same id; an unresolved id is reported, not an error.

## Relationships

`id`, `kind`, `from`, `to`, `assertedBy`, optional `confidence` (`tentative` default,
`plausible`, `strong`), `evidence`, `unsourced`, `uncertainty`, `contestedBy`, `visibility`.

| kind | from | to | notes |
| --- | --- | --- | --- |
| `authored` | person | work | read back as "authored by" |
| `influenced` | any | any | needs evidence unless an unsourced draft |
| `responds-to` | person, work | person, work, movement, concept, event | |
| `disputes` | person, work, movement | person, work, movement, concept | |
| `member-of` | person | movement | |
| `participated-in` | person, movement | event | |
| `developed` | person, movement | concept | |
| `exemplifies` | work | concept, movement | |
| `discusses` | work | any | |
| `part-of` | work, concept, movement, event | same kind | acyclic |
| `specializes` | concept | concept | acyclic |
| `related-to` | any | any | symmetric |

`assertedBy` and each `contestedBy[].by` is `{"kind": "author"}`, `{"kind": "source",
"source": id}` or `{"kind": "named", "name": text}`. `evidence[]` is `{"source": id,
"locators": [...], "passage": id?}` using the notebook's locator format. A relationship needs
evidence or `"unsourced": true`, never both. An approved relationship needs both endpoints
approved, evidence, and no `passage` pointer.

Unknown fields are preserved at every level; contributor credit fields are refused; diagnostics
are scoped to collection, index, id and field and never repeat authored text.
