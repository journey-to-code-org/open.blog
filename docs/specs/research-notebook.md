# Research notebook format

Version 1 of the private passage and research-note contract defined by
[ADR 0024](../adr/0024-private-passages-and-research-notes.md), implemented by
`openblog_core::research_notes`. It points into the
[source library](research-source-library.md). It is stored and edited as described in
[ADR 0025](../adr/0025-private-notebook-storage-and-admin-capture.md); builds never read it.

```json
{
  "version": 1,
  "passages": [
    { "id": "cave-opening", "source": "republic-slings-2003", "visibility": "private",
      "excerpt": { "text": "ὁ δὲ Σωκράτης…", "language": "grc" },
      "locators": [
        { "kind": "page", "value": "514" },
        { "kind": "canonical", "value": "514a", "to": "520a" },
        { "kind": "x-stephanus", "value": "514a" }
      ] }
  ],
  "notes": [
    { "id": "why-a-cave", "kind": "question", "visibility": "private",
      "text": "Why does the image start underground?",
      "passages": ["cave-opening"], "sources": ["plato-republic"], "concepts": ["allegory"] }
  ]
}
```

## Fields

| Entry | Field | Rule |
| --- | --- | --- |
| both | `id` | Required. Lowercase ASCII slug of at most 64 bytes, unique across passages and notes, never changes. |
| both | `visibility` | Optional on read, always written. Only `private`; any other value is refused (`not-private`). |
| passage | `source` | Required. An existing source-library id (archived records resolve). Never changes. |
| passage | `excerpt` | Required object: `text` (verbatim, at most 20,000 characters) and optional `language` tag. |
| passage | `locators` | Optional, at most eight, in order, none repeated. |
| locator | `kind` | `page`, `folio`, `line`, `section`, `chapter`, `canonical`, `timestamp`, or `x-` plus a lowercase slug. |
| locator | `value`, `to` | Text up to 200 characters; `to` ends a range. Timestamps are seconds or `h:mm:ss`. |
| note | `kind` | Required. `observation` or `question`. |
| note | `text` | Required author prose, at most 20,000 characters. |
| note | `passages`, `sources`, `concepts` | Optional id lists (at most 100, no repeats). Passages must exist in the notebook, sources in the library; concepts are slugs checked for shape only. |

Pages cannot address a work and folios need a witness, resolving a reference through its
`of` chain. Unknown fields are kept verbatim at the notebook, entry, excerpt, and locator
levels but may not reuse a defined name. Credit field names are refused. Text may contain
`\n` and tabs in excerpts and notes, never other control characters or Unicode bidirectional
override and isolate controls.

## Limits and diagnostics

At most 4 MiB as read and as written, 10,000 passages and 10,000 notes. A newer version is
refused. Diagnostics carry a kebab-case `code`, `collection`, zero-based `index`, `id`, a
`field` path, and a message that never repeats quoted or noted text. Failed changes
(`upsert_passage`, `upsert_note`, `remove_passage`, `remove_note`) leave the notebook
unchanged; removing a passage still linked by a note is `still-linked`, and changing a
passage's source is `source-changed`.

## Storage and Admin API

The notebook is one file, `.openblog/private/research/notebook.json`, in canonical form
(deterministic pretty JSON, trailing newline). Its **notebook revision** is the SHA-256 of
the stored bytes, or of the empty notebook while no file exists. Every change names the
revision it was based on and is refused with `409` when the file has changed, including by
hand edit. Changes are validated against the stored source library, written to a temporary
file and renamed under a lock, so a refused or interrupted change leaves the file as it was.
A damaged, oversized or newer-version file is reported with its path and never replaced.

| Route | Purpose |
| --- | --- |
| `GET /admin/api/research/notebook` | `file`, `revision`, `stored`, `passages`, `notes`, and the library's `sources` for choosing from. |
| `POST` / `PUT /admin/api/research/passages` | Body `{ revision, passage }`. Create refuses an id any entry uses; update refuses an unknown id. |
| `POST` / `PUT /admin/api/research/notes` | Body `{ revision, note }`. Same rules. |
| `DELETE /admin/api/research/passages`, `/notes` | Body `{ revision, id }`. A passage a note links to is refused (`still-linked`). |

All routes require an Admin session and, for changes, the CSRF token; requests are at most
256 KiB and responses are `no-store`. Successes return the new `revision`, the lists, and
the saved entry. `409` carries `conflict`, the latest `revision`, and the stored `current`
copy; `422` carries entry-scoped `diagnostics`. Removing a source-library record that a
passage or note still uses is refused with `still-used`.
