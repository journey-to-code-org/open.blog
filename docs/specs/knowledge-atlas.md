# Knowledge Atlas format

The private Knowledge Atlas holds contextual entries and the attributed relationships between
them. It is owned by `openblog_core::knowledge_atlas` and stored by the CLI's `atlas_store`;
decisions are in [ADR 0053](../adr/0053-knowledge-atlas-entries-keep-their-kind.md),
[ADR 0054](../adr/0054-attributed-evidence-based-relationships.md),
[ADR 0055](../adr/0055-private-knowledge-atlas-storage.md),
[ADR 0056](../adr/0056-one-lock-order-and-cross-store-research-guards.md) and
[ADR 0057](../adr/0057-accessible-atlas-authoring-and-a-text-first-explorer.md) and
[ADR 0058](../adr/0058-publish-one-allowlisted-knowledge-atlas-projection.md). Nothing in it
reaches a public page, feed, search index, `llms.txt` or export except through the
[publication projection](#publication), which copies approved items only when the site opts in.

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

## Admin API and workspace

Defined by [ADR 0057](../adr/0057-accessible-atlas-authoring-and-a-text-first-explorer.md).
Admin Studio's **Atlas** view (Research tools, next to Notebook, and `#/atlas/<id>`) lists,
searches and filters entries by kind, edits one entry or relationship, and explores an
entry's relationships as text. There is no graph drawing.

| Route | Purpose |
| --- | --- |
| `GET /admin/api/research/atlas` | `file`, `revision`, `stored`, `entries`, `relationships`, `notices`, `missingConcepts`, `kinds` (each relationship kind's endpoint kinds, `inverse`, `symmetric`, `sameKind`, `acyclic`), the library's `sources`, and notebook `passages` as `id`, `source`, `locators`, `archived` and a short `preview`. |
| `POST /admin/api/research/atlas/explore` | Body `{ id }`. `entry`, `outgoing` and `incoming`, each item with the relationship, its `label` read from this entry's side, the `other` entry, its derived `standing` (`asserted` or `contested`) and whether it is `projected`; for a concept, the notebook `notes` that link it. Read-only; an unknown id is `404`. |
| `POST` / `PUT /admin/api/research/atlas/entries` | Body `{ revision, entry }`. Create refuses an id any entry or relationship uses; update refuses an unknown id or a new kind. |
| `POST` / `PUT /admin/api/research/atlas/relationships` | Body `{ revision, relationship }`. Same rules. |
| `DELETE /admin/api/research/atlas/entries`, `/relationships` | Body `{ revision, id }`. An entry a relationship joins is refused (`still-linked`); removing a concept returns `unresolvedNotes`. |

All routes need an Admin session and, for changes, the CSRF token; a change is at most
256 KiB, and responses are `no-store`. Successes return the new revision and the whole view,
plus the saved `entry` or `relationship`. `409` carries `conflict`, the latest `revision`
and the stored `current` copy; `422` carries scoped `diagnostics` and the `file`. An id in a
removal or exploration request that is not an atlas identifier is `400` and is never echoed.

The editor offers only the entries a relationship kind may join, sources from the library
and passages from the notebook for evidence, the three kinds of attribution, confidence,
an uncertainty note and recorded dissents. A relationship needs evidence or the explicit
unsourced draft state. Standing is always written out ("Asserted; no recorded dissent" or
"Contested: N recorded dissents (by ...)"), never as agreement. A conflict keeps the draft
until the author uses the stored copy or keeps the draft on top of it. A notebook note's
concept links open the matching entry, or a new concept with that identifier.

## Publication

Defined by [ADR 0058](../adr/0058-publish-one-allowlisted-knowledge-atlas-projection.md). A site
publishes its atlas only with `"knowledgeAtlas": {"publish": true}` in `openblog.json`; until then
no build reads the atlas. When it is on, `openblog_core::atlas_publication::PublicAtlas` projects
the approved entries and the relationships `Atlas::is_projected` allows (approved, sourced, no
passage pointer, both entries approved), and the build writes:

| Output | Content |
| --- | --- |
| `/atlas/` | Published entries grouped by kind, with how many relationships each has, and a link to `atlas.json`. |
| `/atlas/<id>/` | The entry's label, other names, years, summary and work reference, then its relationships from and to it, each in the stored direction with standing, who asserts it, confidence, cited references and locators, uncertainty and every dissent. |
| `/atlas.json` | The same projection as compact data (below). |

```json
{
  "format": "openblog-atlas-projection",
  "formatVersion": 1,
  "entries": [
    { "id": "plato", "kind": "person", "label": "Plato", "aliases": ["Aristocles"],
      "bounds": { "from": -428, "until": -348 }, "url": "/atlas/plato/" }
  ],
  "relationships": [
    { "id": "r-authored", "kind": "authored", "from": "plato", "to": "republic",
      "label": "authored", "inverseLabel": "authored by",
      "assertedBy": { "kind": "source", "source": "scholar-book" },
      "confidence": "plausible",
      "evidence": [{ "source": "republic-slings", "locators": [{ "kind": "page", "value": "514" }] }],
      "uncertainty": "Authorship of some dialogues is disputed.",
      "standing": "contested",
      "contestedBy": [{ "by": { "kind": "named", "name": "Another reading" }, "note": "Dates it later." }] }
  ],
  "sources": [
    { "key": "scholar-book", "kind": "work", "title": "A study", "text": "A study" }
  ]
}
```

Only the fields shown (and an entry's `summary` and a work's `source`, a dissent's `evidence`)
are published; sources carry the citation allowlist of ADR 0044. Visibility, `unsourced`,
passage ids, unknown fields, private entries and relationships, relationships touching a
private entry and notebook data are never published. Entries, relationships and sources are
sorted by id. A relationship's `kind` is the stored machine value (`member-of`); `label` and
`inverseLabel` are how it reads in words from each end (`member of`, `has member`), as pages and
the Admin explorer show it. URLs are root-relative and follow a site's base path, and `<`, `>` and `&` in
text are written as JSON escapes. A relationship is `contested` whenever anyone dissents;
there is no agreed state.

Clearing an approval removes the item, and an entry's relationships, from the next build;
while the site publishes its atlas, a saved Admin atlas change rebuilds at once and its response
carries the outcome as `build` (`ok`, and `error` when it failed). A
published atlas that cannot be read or validated stops `build` and `check` before anything is
written, naming the file only. `atlas` is a reserved page and post path while the atlas is
published. The atlas pages join the sitemap; feeds, search, `llms.txt` and portable exports do
not include them.
