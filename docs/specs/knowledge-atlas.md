# Knowledge Atlas format

The private Knowledge Atlas holds contextual entries and the attributed relationships between
them. It is owned by `openblog_core::knowledge_atlas` and stored by the CLI's `atlas_store`;
decisions are in [ADR 0058](../adr/0058-knowledge-atlas-entries-keep-their-kind.md),
[ADR 0059](../adr/0059-attributed-evidence-based-relationships.md),
[ADR 0060](../adr/0060-private-knowledge-atlas-storage.md) and
[ADR 0061](../adr/0061-one-lock-order-and-cross-store-research-guards.md). Nothing in it reaches
a public page, feed, search index, `llms.txt` or export until an explicit publication
projection copies approved items.

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
entry with the same id; an unresolved id is reported, not an error. Removing an entry is
refused while a relationship joins it; removing a concept that notes link to is allowed and
reports those notes, whose links are now unresolved.

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
evidence or `"unsourced": true`, never both. An approved relationship needs evidence and no
`passage` pointer; otherwise it is refused. It reaches the publication projection only when
both entries it joins are approved too. If either is private the relationship stays private
and `Atlas::notices` reports a non-blocking `private-endpoint` notice, so withdrawing an
entry's approval never makes the atlas invalid.

Unknown fields are preserved at every level; contributor credit fields are refused; diagnostics
are scoped to collection, index, id and field and never repeat authored text.

## Storage

The atlas is one file, `.openblog/private/research/atlas.json`, in canonical form
(deterministic pretty JSON, trailing newline). Its **atlas revision** is the SHA-256 of the
stored bytes, or of the empty atlas while no file exists. Every change names the revision it
was based on and is refused as a conflict when the file has changed, including by hand edit.
Changes are validated against the stored source library and notebook, written to a temporary
file and renamed while holding the atlas, notebook and library locks in that order, so a
refused or interrupted change leaves the file as it was. A symlinked, damaged, oversized or
newer-version file is reported with its path and never replaced, and a damaged library or
notebook blocks atlas changes.

| Operation | Rule |
| --- | --- |
| create entry or relationship | Refuses an id any entry or relationship uses. |
| update entry or relationship | Refuses an unknown id; an entry keeps its kind. |
| remove entry | Refused while a relationship joins it; reports notes left with an unresolved concept link. |
| remove relationship | Always allowed. |

Other stores protect it: removing a source-library record the atlas uses (a work entry's
`source`, evidence, or an attribution) is refused with `still-used`, removing a notebook
passage atlas evidence points to is refused with `still-linked`, and an atlas that cannot be
read blocks both removals. A library or notebook edit that would turn a valid atlas invalid
is refused. `openblog check` validates a stored atlas, prints approved relationships the
projection would leave out as `notice:` lines that name ids only, and says nothing when there
is no atlas. The hosted workspace keeps the file durable with the 4 MiB library limit. A copy
of an atlas inside `content/`, `static/` or a theme stops the build, `serve`, `check` and
publish.

`Atlas::index` gives sorted lookup tables computed from file order: entries by kind,
relationships by entry, users by source and users by passage. Nothing is indexed on disk.
