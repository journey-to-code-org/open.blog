# Reader annotations

A reader can keep highlights, private notes, saved sources and reading trails in their own browser,
with no account. This page is the contract those features share. It is implemented by
`web/components/reader-annotations.js` (dependency-free, no DOM, no storage, no network) and tested by
`tests/web/reader-annotations.test.mjs` against `tests/fixtures/reader-annotations.json`. Decisions are in
[ADR 0450](../adr/0450-reader-annotations-are-one-reader-private-local-document-that-is-never-research-notes-and-never-public.md) (separate, local, private),
[ADR 0451](../adr/0451-an-annotation-names-its-work-by-site-and-path-and-its-text-by-a-passage-target-and-staleness-is-derived-never-stored.md) (identity and stale state),
[ADR 0452](../adr/0452-an-export-states-its-privacy-scope-and-leaves-note-text-out-unless-the-reader-includes-it.md) (export privacy) and
[ADR 0453](../adr/0453-reader-annotation-validation-is-strict-scoped-to-the-record-and-never-repairs-or-repeats-reader-text.md) (validation).

This task defines the contract. Local highlights and notes (#85), the trail and saved-source organizer
(#86) and import, export and privacy controls (#87) build on it. A site and its posts are unchanged
until those features are used; nothing here is in the build, Admin or any feed.

## Document

```json
{
  "format": "openblog.reader-annotations",
  "version": 1,
  "privacy": { "scope": "reader-private", "notes": "included" },
  "annotations": [
    { "id": "steep", "kind": "highlight",
      "work": { "site": "https://example.com", "path": "/posts/tea/" },
      "revision": "p1:0123456789abcdef0123456789abcdef",
      "target": { "version": 1, "kind": "quote", "section": "brewing",
                  "exact": "three minutes", "prefix": "Steep the tea for ", "suffix": ". Then taste", "start": 26 },
      "createdAt": "2026-10-27T09:30:00Z", "updatedAt": "2026-10-27T09:30:00Z" },
    { "id": "whole-post", "kind": "note", "work": { "site": "https://example.com", "path": "/posts/tea/" },
      "revision": "p1:0123456789abcdef0123456789abcdef", "target": { "version": 1, "kind": "work" },
      "text": "Return to this.", "createdAt": "2026-10-27T09:30:00Z", "updatedAt": "2026-10-27T09:30:00Z" }
  ],
  "sources": [
    { "id": "kettle-guide", "kind": "source", "title": "Kettle guide", "url": "https://example.org/kettles",
      "text": "Check the boiling point.", "createdAt": "2026-10-27T09:30:00Z", "updatedAt": "2026-10-27T09:30:00Z" }
  ],
  "trails": [
    { "id": "tea-trail", "kind": "trail", "title": "Learning tea",
      "steps": [{ "ref": "steep" }, { "ref": "kettle-guide" }],
      "createdAt": "2026-10-27T09:30:00Z", "updatedAt": "2026-10-27T10:00:00Z" }
  ]
}
```

- **Highlight**: a quoted passage, with no text of the reader's own. **Note**: the reader's text attached to
  a quote, a section or the whole work. **Saved source**: a title and either an http(s) `url` or a `work`
  on a site, with an optional note. **Trail**: an ordered line of up to 200 steps, each naming one
  annotation or saved source by id, once.
- **Identity.** A work is its site origin plus its canonical path. The target is a passage target
  ([ADR 0076](../adr/0076-passage-targets-are-section-anchors-with-quoted-context.md)): exact text with
  prefix and suffix context and a position hint. `revision` is the passage revision the page published when
  the reader made the annotation; this contract never computes it.
- **Stale state** is derived, not stored. `assessAnnotations(document, works)` returns `current`,
  `reanchored` or `stale` with a reason for each annotation, as passage targets resolve
  ([ADR 0077](../adr/0077-targets-resolve-as-current-reanchored-or-stale.md)), or `stale` with
  `workUnavailable` when the work cannot be loaded. A stale annotation keeps its record.
- **Separate from research notes.** The format name, ids and file are the reader's own. A research
  notebook, a reading path or any other JSON is refused as `wrongFormat`.

## Privacy

`privacy.scope` is always `reader-private`. `privacy.notes` is `included` or `omitted`: the default
`exportDocument(document)` leaves out the reader's own words (note text, a saved source's note, a trail's
note) and says so; `{ notes: true }` keeps them. A file that says `omitted` but holds note text is refused.
An export always holds the text of the highlights. Nothing is uploaded and nothing is published.

## Validation

`readDocument(value)` and `readDocumentJson(text)` return a new frozen document or every problem as
`{ code, object, message }`, where `object` names the record (`annotations[2] (steep)`). Nothing is
repaired and the caller keeps what it had. Messages never repeat reader text.

| Rule | Code |
| --- | --- |
| Not this format, or JSON that is not an object | `wrongFormat`, `malformed` |
| Version missing, fractional or newer | `malformed`, `unsupportedVersion` |
| Unknown field or kind | `unknownField`, `unknownKind` |
| Id not a lowercase slug of 1 to 64 characters, or reused | `invalidId`, `duplicateId` |
| Site not a plain http(s) origin; path not canonical, or holds traversal | `invalidSite`, `invalidPath` |
| URL not http(s), with credentials, or not canonical | `unsafeScheme`, `invalidUrl` |
| Highlight not a quote, or with text; note without text | `wrongTarget`, `unexpectedText`, `emptyText` |
| Target invalid | the passage-target code (`splitCharacter`, `unsupportedVersion`, ...) |
| Control, bidirectional or lone-surrogate characters | `forbiddenCharacter` |
| Limits: 4 MiB, 2,000 annotations, 500 sources, 50 trails, 200 steps, note 10,000, title 200, URL 2,048, path 512 | `tooLarge`, `tooMany`, `textTooLong` |
| Timestamp not UTC to the second, or updated before created | `invalidTimestamp`, `timeOrder` |
| Trail step missing, repeated, or naming a trail | `danglingRef`, `duplicateStep` |
| Scope not `reader-private`; notes statement wrong | `invalidPrivacy`, `privacyMismatch` |

`serializeDocument` writes the canonical form: fixed field order, two-space indent, LF, trailing newline.
Automated behaviour here never claims a passage is true, authoritative or licensed to copy; an annotation
records only what a reader chose to keep.
