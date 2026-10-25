# Research notebook format

Version 1 of the private passage and research-note contract defined by
[ADR 0024](../adr/0024-private-passages-and-research-notes.md), implemented by
`openblog_core::research_notes`. It points into the
[source library](research-source-library.md). No file location or Admin API exists yet;
builds never read a notebook.

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
