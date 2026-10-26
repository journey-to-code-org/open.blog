# Citation format

The contract defined by [ADR 0042](../adr/0042-citation-keys-are-source-identifiers.md) to
[ADR 0047](../adr/0047-citation-picker-in-the-visual-editor.md), implemented by
`openblog_core::citations`, and published by `openblog_core::bibliography`
([ADR 0048](../adr/0048-citations-publish-through-the-one-publication-projection.md),
[ADR 0049](../adr/0049-built-in-citation-styles-locales-and-accessible-notes.md)). A citation
points at a record in the [source library](research-source-library.md) and reuses the
[notebook's locators](research-notebook.md). The resolver never reads the notebook.

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

See [ADR 0046](../adr/0046-csl-interoperability-policy.md) for the table of stored, preserved,
private-dropped and unsupported CSL variables and the citation-item mapping. In short: the first
locator becomes CSL `label` and `locator`; the full ordered list travels in `openblog-locators`;
every loss is reported; failures are scoped to one citation or item and change no file.

## Admin citation picker

The Write view's **Cite** action ([ADR 0047](../adr/0047-citation-picker-in-the-visual-editor.md))
inserts or edits one citation in either writing mode. Both routes are signed-in, `no-store`, and
write nothing.

| Route | Behaviour |
| --- | --- |
| `GET /admin/api/citations/library` | `file`, `revision` (of the source library), `sources`, and the notebook's live `passages` as `id`, `source`, a 160-character `preview` and `locators` (kind, value, end only). `notebookAvailable` is `false`, with no passages, when the notebook cannot be read. |
| `POST /admin/api/citations/check` | JSON body (at most 16 KiB, with the CSRF token) `{ revision, citation: { key, locators: [{ kind, value, to }] } }`. Only those locator fields are read. Returns `markdown`, `key`, `locators`, `reference`, `formatted` and `revision`. A different library `revision` is `409` with the latest `revision` and `sources`; a citation that fails to format, scan back or resolve is `422` with `diagnostics`; a missing revision is `400`. |

In Visual mode every citation is an atomic chip that serializes back to its exact Markdown, so
hand-written and generated citations round-trip byte for byte. A citation typed or pasted in
Visual mode becomes a chip. A block whose `[@` text the visual editor cannot read exactly as the
scanner does (an escaped backslash before it, a link or `(` after it, a malformed bracket, link
text, or overlapping emphasis) is a protected **Citation text** block, kept verbatim. Neither
mode inserts a citation inside code, a link or a protected block; the dialog explains why and
stays open. Undo (Ctrl+Z or **Undo
citation**) restores the exact prior draft and caret while nothing else has changed.

## Publication

A post opts in with `citations: notes` or `citations: bibliography` in its front matter
(`citationLocale`: `en`, `de`, `fr` or `es`, defaulting to the site language). Without it, or
with no citation in the body, the post publishes exactly as before.

| Step | Rule |
| --- | --- |
| Scan and resolve | The core scanner and resolver. For a post the load publishes, any diagnostic, a missing library or an unreadable library refuses the post with its file line, key, code and a repair hint, before anything is written. A draft, a post held back until its date and, in an Admin preview, every other document get a warning instead and keep their citations as text. |
| Rewrite | Each citation becomes a footnote reference `[^cite-N]` (`cite2-` and so on when the author already uses `cite-` plus a number as a footnote or as literal `[^cite-N]` text, in any case). `bibliography` adds ` (locators)` after the marker. A following `(`, `[` or `:` is escaped. |
| Notes | Appended under `## Notes` or `## References` (localized) as `[^cite-N]: reference, locators.` in order of first citation: one per distinct citation (`notes`) or per reference (`bibliography`). Text is escaped Markdown from the public reference only. |
| Check | The result is parsed again; it must hold one generated marker per citation and one note per number, or the post is refused. |
| Publish | `Post::publication_markdown` feeds the native page and the portable projection (portable HTML, Markdown, text, RSS, JSON Feed, `llms.txt`, destinations). The authored file never changes. |

A source library edit (`update`, CSL import or removal) that would stop a published, opted-in
post's citations from resolving is refused with `still-used`, naming the post's path and line.

## Checks

`openblog_core::citation_review` ([ADR 0050](../adr/0050-offline-citation-checks-and-portable-bibliography-exports.md))
reviews every post that opts in, offline, and reports evidence findings that `openblog check`,
builds and Evidence Studio show with the post's path and line:

| Code | Outcome | When |
| --- | --- | --- |
| `citation-syntax` | detected | a citation cannot be read (malformed, invalid key or locator, too large) |
| `citation-unresolved` | detected | unknown key or ambiguous locator |
| `citation-identifier-unpublished` | potential | a PMID or PMCID not in its standard form, left out of notes and exports |
| `citation-reference-incomplete` | potential | the cited reference has no title; no creator (work, edition, translation); no date (edition, translation, or any CSL type); no container title (journal article, chapter, entry, paper, blog post); no publisher (book, report, thesis, untyped edition); no web address (web page, post). `field` names the detail |
| `citation-location-review` | needs-review | one per post, listing the lines of resolved citations that give a location: only a person can check that the passage is there |

No finding says whether a source is true, relevant or supports a claim, and nothing is looked
up online. Posts that do not opt in get none.

## Bibliography exports

A published post's cited references, in order of first citation, export as CSL JSON
(`export_cited_csl_json`) or BibTeX (`export_cited_bibtex`) from the same public description
the notes show: no `custom` envelope, relationships, locations, archived flags, unknown fields
or private identifiers. Each export lists `losses` (`sourceId`, `field`, `reason`) for what the
format cannot carry.

| Where | Behaviour |
| --- | --- |
| `openblog export <slug> --format csl-json\|bibtex` | Dry run prints the content and each omission; `--out <path> --write` writes atomically and never overwrites; `--json` prints `{ version, sourcePath, canonicalUrl, representation, outputFile, bytes, count, offline, omissions, content }`. A post that publishes no citations is refused and nothing is written. |
| `POST /admin/api/preview` | For a post that publishes citations, `citations` holds `style`, `locale`, `citations`, `notes`, `references`, `offline: true` and `exports` with `csl-json` and `bibtex` entries (`filename`, `mediaType`, `count`, `content`, `losses`); otherwise `null`. |

On the native page a generated marker is
`<sup class="footnote-reference ob-citation"><a href="#cite-1" id="cite-1-ref-1" role="doc-noteref"><span class="ob-visually-hidden">Citation </span>1</a></sup>`
and each note ends with one `doc-backlink` per citing marker. Portable copies keep ordinary
footnotes that link to the note on the canonical article.

## Reader references

[ADR 0064](../adr/0064-published-reference-data-for-citation-previews.md) defines the data a
citation preview reads, `openblog_core::reader_references::ReaderReferences`
(`Post::reader_references`), projected from the published citations and absent for a post that
publishes none.

| Field | Content |
| --- | --- |
| `version`, `style`, `locale` | `1`; `notes` or `bibliography`; the notes' locale |
| `references[]` | `id` (the citation key, distinct per work, edition, translation and witness), `number` (order of first citation), `preview` (the public description, ADR 0044), `formatted` (plain text), `link` (DOI resolver or plain HTTP(S) address, else absent) |
| `citations[]` | `marker` (`cite-N-ref-K`), `note` (`cite-N`), `reference` (an id above), `locators` (kind, value, end) |

Every citation names a listed reference, every reference is cited, and `check_page` confirms the
page holds each marker and note id, so each citation resolves to a visible reference without
JavaScript. Only the reference `id` is stable across revisions: `marker` and `note` ids are
positional (order of first citation, occurrence and the post's label prefix), valid for the one
revision whose page carries them, and must not be stored. A durable target uses the reference id,
or the passage and annotation selectors of #80 and #84. The document is written inline as
`<script type="application/json" id="ob-references">` with `<`, `>`, `&` and U+2028/9 escaped
(`to_script_element`); there is no separate file in version 1.
