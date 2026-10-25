# Citation format

The contract defined by [ADR 0048](../adr/0048-citation-keys-are-source-identifiers.md) to
[ADR 0053](../adr/0053-citation-picker-in-the-visual-editor.md), implemented by
`openblog_core::citations`. A citation points at a record in the
[source library](research-source-library.md) and reuses the
[notebook's locators](research-notebook.md). The resolver never reads the notebook, and no build step
calls it yet.

## Syntax

```markdown
Plain: [@plato-republic]
Located: [@republic-slings-2003, page 514 to 520]
Compound: [@republic-slings-2003, page 514; canonical 514a to 520a; x-stephanus 514a]
```

| Part | Rule |
| --- | --- |
| key | A source identifier: lowercase ASCII slug, at most 64 bytes. Archived records resolve. |
| locator | `kind value`, optionally `kind value to end`. At most eight, separated by `;`. |
| kind | `page`, `folio`, `line`, `section`, `chapter`, `canonical`, `timestamp`, or `x-` plus a slug. |
| value, end | Unicode text, at most 200 characters, no `;`, `[`, `]`, ` to ` or control or bidirectional override characters. Timestamps are seconds or `h:mm:ss`. |

The scanner reads Markdown with the renderer's own parser, so a citation is found exactly where
the renderer shows `[@...]` as text. Not citations: code (fenced, indented, inline, also inside
block quotes and over line breaks), raw HTML and comments, `\[@key]`, links and images
(`[@key](url)`, `[@key][ref]`, and a shortcut `[@key]` that a `[@key]: url` definition turns
into a link), definitions, and footnotes. Backslash escapes inside a citation are read as the
renderer shows them, and an escaped `\]` does not close it. A citation sits on one line with no
formatting inside it. Malformed or unknown ones are reported with their line and left as text.
Limits: 1 MiB of Markdown and 2,000 citations per document.

## Resolution and public output

`resolve_citations` takes the scanned citations and the source library. Unknown keys and
ambiguous locators (a page on a work, a folio off a witness) are reported per citation and
omitted; others resolve. The result lists each citation with the number of its reference in
order of first citation, and each reference once.

Public: the key, the locators (kind, value, end) and the reference description (kind, title,
creator names and roles, issued, language, identifiers in the schemes `doi`, `isbn`, `issn`,
`url`, `pmid` and `pmcid`, preserved CSL variables) with its
plain-text rendering. Private and never present: notebook content, archived flag,
relationships, unknown fields (also on locators), identifiers in any other scheme, credits.

## CSL interoperability

See [ADR 0052](../adr/0052-csl-interoperability-policy.md) for the table of stored, preserved,
private-dropped and unsupported CSL variables and the citation-item mapping. In short: the first
locator becomes CSL `label` and `locator`; the full ordered list travels in `openblog-locators`;
every loss is reported; failures are scoped to one citation or item and change no file.

## Admin citation picker

The Write view's **Cite** action ([ADR 0053](../adr/0053-citation-picker-in-the-visual-editor.md))
inserts or edits one citation in either writing mode. Both routes are signed-in, `no-store`, and
write nothing.

| Route | Behaviour |
| --- | --- |
| `GET /admin/api/citations/library` | `file`, `revision` (of the source library), `sources`, and the notebook's live `passages` as `id`, `source`, a 160-character `preview` and `locators` (kind, value, end only). `notebookAvailable` is `false`, with no passages, when the notebook cannot be read. |
| `POST /admin/api/citations/check` | JSON body (at most 16 KiB, with the CSRF token) `{ revision, citation: { key, locators: [{ kind, value, to }] } }`. Only those locator fields are read. Returns `markdown`, `key`, `locators`, `reference`, `formatted` and `revision`. A different library `revision` is `409` with the latest `revision` and `sources`; a citation that fails to format, scan back or resolve is `422` with `diagnostics`; a missing revision is `400`. |

In Visual mode every citation is an atomic chip that serializes back to its exact Markdown, so
hand-written and generated citations round-trip byte for byte. Undo (Ctrl+Z or **Undo
citation**) restores the exact prior draft and caret while nothing else has changed.
