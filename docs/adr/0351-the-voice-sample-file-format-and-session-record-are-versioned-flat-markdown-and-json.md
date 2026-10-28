# ADR 0351: The voice sample file format and session record are versioned, flat Markdown and JSON

- Status: Accepted
- Date: 2026-10-28
- Decision issue: [#430](https://github.com/journey-to-code-org/open.blog/issues/430)
- Parent story: [#411](https://github.com/journey-to-code-org/open.blog/issues/411)
- Parent epic: [#406](https://github.com/journey-to-code-org/open.blog/issues/406)
- Builds on: ADR 0350

## Context

Every later feature (CLI sessions, Admin sessions, Assistant context) reads and writes the same files. Files
people keep for years are a one-way door: once authors have a library, a format change must never lose or
rewrite it. So the format is small, versioned from the first byte, and conservative about what it accepts.

## Decision

### The sample file

- **A Markdown file**: front matter, one blank line, the author's text, one final newline. The reader removes
  exactly that one blank line and one final newline and nothing else, so the author's own blank lines and
  indentation survive. CRLF is read as LF, a byte order mark is dropped, and a non-UTF-8 file is refused.
- **Flat front matter.** The repository's front matter parser is a deliberately small flat subset, with no
  nested maps. The `voice` block of the epic is therefore written as dotted keys: `voice.format`,
  `voice.catalog`, `voice.pack`, `voice.prompt`, `voice.stage`, `voice.timeLimitSeconds`, `voice.words` and
  `voice.roughOf`. The post parser treats them as unknown keys, so a sample accidentally placed in
  `content/posts/` would parse rather than crash (and the store never writes there). The other keys are
  `title`, `subtitle`, `slug`, `date` (RFC 3339 with a time), `description` and `tags`.
- **`voice.format` is the file format version** (this release writes 1 and reads 1). A file with a newer
  format is refused with a sentence telling the author to update, and is never rewritten. `voice.catalog` is
  the prompt catalog version the prompt came from; a newer one is refused the same way (ADR 0352).
- **Strict where it protects the library.** Unknown `voice.stage` values, a polished draft without
  `voice.roughOf`, a rough draft with one, a `roughOf` that is not the file name of a rough draft for the same
  prompt, an empty body, null characters and ids that are not lowercase kebab-case are all refused, each with
  a sentence naming the field. Files are at most 64 KiB.
- **Lenient where it protects the author.** Keys this release does not know (including unknown `voice.*`
  keys) are kept and written back, after the known keys, in alphabetical order, so a newer release's additions
  survive an older one's save. `voice.words` is informational and is not checked against the text.
- **Deterministic.** Equal samples serialize to equal bytes: known keys in a fixed order, then the rest
  alphabetically. A valid file written by this release parses and serializes back byte-identically.
- **File name**: `<YYYY-MM-DD>-<prompt-id>-<stage>.md`. The day is the day the rough draft was written; a
  polished draft takes the day of its rough draft, so each rough draft has at most one polished draft and the
  pair sorts together.

### Where samples live

`assistant/context/voice/` (portable) or `.openblog/private/context/voice/` (private), beside the other
Assistant context. Neither is read by a build.

## Considered options

- **Nested `voice:` map as in the epic text.** Rejected: it needs a second front matter parser, and a
  different parser reading the same file differently is exactly the bug a one-way door must not have.
- **JSON files.** Rejected: authors should be able to read and edit their polished drafts in any editor.
- **One file with both stages.** Rejected: the rough file must be written once and never touched, which is
  only simple to enforce when it is a file of its own.

## What would trigger revisiting this

- A field authors need that cannot be an additive key. That is `voice.format: 2`, with a documented upgrade
  and the rule that an older release never overwrites a newer file.

## Consequences

- Equal bytes in, equal bytes out lets the store prove a moved rough draft was not changed.
- Later sections of this ADR record the store and session record.
