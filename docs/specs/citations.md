# Citation format

The contract defined by [ADR 0048](../adr/0048-citation-keys-are-source-identifiers.md) to
[ADR 0052](../adr/0052-csl-interoperability-policy.md), implemented by
`openblog_core::citations`. A citation points at a record in the
[source library](research-source-library.md) and reuses the
[notebook's locators](research-notebook.md). Nothing here reads the notebook, and no build step
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
