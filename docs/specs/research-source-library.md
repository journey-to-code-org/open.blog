# Research source library format

Version 1 of the private source library contract defined by
[ADR 0005](../adr/0005-research-source-library-identity.md). It is implemented by
`openblog_core::source_library` and stored as described in
[ADR 0006](../adr/0006-private-source-library-storage.md). Builds never read it;
`openblog check` validates it, and Admin Studio editing arrives with issue
[#34](https://github.com/journey-to-code-org/open.blog/issues/34).

## Document

```json
{
  "version": 1,
  "sources": [
    { "id": "plato-republic", "kind": "work", "title": "Πολιτεία", "language": "grc",
      "creators": [{ "name": "Plato", "role": "author" }] },
    { "id": "republic-slings-2003", "kind": "edition", "of": "plato-republic",
      "title": "Platonis Rempublicam", "issued": "2003",
      "identifiers": [{ "scheme": "isbn", "value": "978-0-19-924849-0" }] },
    { "id": "republic-bloom", "kind": "translation", "of": "plato-republic",
      "basedOn": "republic-slings-2003", "language": "en", "title": "The Republic of Plato" },
    { "id": "paris-gr-1807", "kind": "witness", "of": "plato-republic",
      "title": "Paris, Bibliothèque nationale de France, gr. 1807" },
    { "id": "cave-allegory", "kind": "reference", "of": "republic-slings-2003",
      "location": { "scheme": "canonical", "value": "514a–520a" } }
  ]
}
```

Record order is preserved. Any field not listed below is kept verbatim, including inside
creators, identifiers, and locations, but an unknown field may not reuse the name of a
defined field at the same level. An empty `creators` or `identifiers` array carries no
data and is written back as an absent field.

## Fields

| Field | Applies to | Rule |
| --- | --- | --- |
| `id` | every record | Required. Lowercase ASCII slug, at most 64 bytes, unique across all kinds. An upsert never changes an existing record's kind; the library does not remember removed ids, so reusing one is the caller's responsibility. |
| `kind` | every record | Required. `work`, `edition`, `translation`, `witness`, or `reference`. |
| `title` | every record | Required except on a reference. |
| `of` | all but work | Required. Edition → work or translation. Translation → work. Witness → work, edition, or translation. Reference → work, edition, translation, or witness. |
| `basedOn` | translation | Optional edition, witness, or translation the translation was made from; it must belong to the same work and must not lead back to the translation. |
| `language` | every record | Language tag such as `en` or `grc`. Required on a translation. |
| `issued` | every record | Authored date text, kept as written. |
| `creators` | every record | `{ "name", "role"? }`, where role is `author`, `editor`, `translator`, `compiler`, `scribe`, or `other`. Descriptive only; never a contributor reference. |
| `identifiers` | every record | `{ "scheme", "value" }`. `doi`, `isbn`, `issn`, and `url` are checked offline; other schemes need a lowercase slug name. Values must not start or end with whitespace. |
| `location` | reference | `{ "scheme", "value" }` with scheme `page`, `folio`, `line`, `section`, `chapter`, `canonical`, or `timestamp`. Pages cannot point at a work; folios need a witness; timestamps are seconds or `h:mm:ss`. |

`credit`, `credits`, `contributor`, and `contributors` are rejected as field names at any
depth of a record, including inside creators, identifiers, locations, and unknown fields,
and beside `sources` at the library level. A `.credits.json` sidecar is rejected as a
library.

## Limits and diagnostics

A library may be at most 4 MiB, measured both on the text that is read and on its
canonical written form, so every library that parses can be written back, read again, and
shrunk. It may hold at most 10,000 records; text fields are limited to 1,000
characters without control characters. A version other than 1 is refused without being
reinterpreted.

Each diagnostic has a stable kebab-case `code`, the record's zero-based `index` and
`sourceId` when it belongs to one, a `field` path such as `identifiers[0]` or
`location.scheme`, and a `message`. All problems are reported together, and a record that
already failed is not reported again through records that point at it.

## Storage

The library is stored at `.openblog/private/research/sources.json`, which new projects
ignore in Git. No existing component of that path may be a symlink or junction. Builds never
read it, and nothing inside `.openblog/` is copied into a build or feeds its asset version
even when `paths.static` or `paths.themes` contains it.

Every read returns a **library revision**, the lowercase hexadecimal SHA-256 of the stored
bytes (or of the canonical empty library while no file exists). Create, update, and remove
each name the revision they were based on; any other revision, including one changed by a
hand edit, is a conflict and nothing is written, not even the private directories of a
library that is not stored yet. Create refuses an identifier in use (`duplicate-id`, scoped
to the existing source), and update refuses one that is not (`unknown-source`, scoped to the
requested identifier).

Changes hold `sources.json.lock` beside the library, write the canonical form to a new
`sources.json.<process>-<time>.tmp` file, flush it, and rename it over the library, so the
stored file is always either the previous or the next complete library. Temporary files
left by an interrupted write are ignored and removed by the next successful write. A lock
left by a crashed process blocks changes until it is removed; reads never wait for it.

A leading UTF-8 byte-order mark, as some editors save, is ignored when reading; the
revision still covers the stored bytes, and the next change writes the canonical form
without it. A stored file that is malformed, not UTF-8, larger than 4 MiB, invalid, or of a
newer version is reported with the diagnostics above and is never overwritten. Lookups by id,
kind, and dependent record are derived in memory from the file and never stored.
