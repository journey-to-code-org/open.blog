# ADR 0053: Insert citations through a server-checked picker and keep them as atomic chips

- Status: Accepted
- Date: 2026-10-25
- Decision issue: [#41](https://github.com/journey-to-code-org/open.blog/issues/41)
- Parent story: [#19](https://github.com/journey-to-code-org/open.blog/issues/19)
- Parent epic: [#15](https://github.com/journey-to-code-org/open.blog/issues/15)
- Builds on: [ADR 0049](0049-opt-in-citation-markdown-syntax.md),
  [ADR 0050](0050-what-a-citation-makes-public.md),
  [ADR 0051](0051-citation-locators-reuse-notebook-locators.md),
  [ADR 0035](0035-private-notebook-storage-and-admin-capture.md)
- Contract: [Citation format](../specs/citations.md)

## Context

Authors need to insert and edit citations in both writing modes without learning the syntax.
The Markdown file stays canonical, the visual editor rewrites the whole document from its DOM on
any edit, and the visual editor escapes brackets in plain text. A citation that went through the
visual editor as text would come back as `\[@key\]`, which is no longer a citation. Hand-written
citations, including ones the picker cannot read, must survive untouched.

## Decision

- **Picker.** A modal **Cite** dialog in the Write toolbar searches the source library
  (titles, creators, identifiers, keys; Unicode-aware), lists live sources (an archived source
  only when the citation being edited already uses it), and takes optional locators in the
  capture form's `kind: value to end` lines. It can start from a live notebook passage, which
  copies the passage's source and its locators' kind, value and end only; the quotation, notes
  and extra locator fields are never copied. Cancel and Escape restore focus and the selection;
  nothing changes until Insert.
- **Server check.** Insert sends `{ revision, citation: { key, locators } }` to
  `POST /admin/api/citations/check`, which reads only `kind`, `value` and `to`, then runs
  `citations::check_citation`: format the Markdown, scan it back, resolve it against the library.
  The response's `markdown` is the only text the editor inserts. A library revision other than
  the one the picker loaded is a `409` with the latest sources, so the author's choices survive
  and nothing is inserted; a problem is a `422` scoped to that citation. The route writes nothing.
- **Visual mode.** Any `[@...]` the editor sees as a citation (not escaped, not a link, not in
  code) renders as an atomic, keyboard-reachable chip (`contenteditable="false"`,
  `role="button"`, `tabindex="0"`) that serializes back to its exact Markdown. A pasted chip is
  written back verbatim only when its text is a well-formed citation; anything else becomes
  escaped text. Click, Enter or Space on a chip reopens it in the dialog.
- **Editing in place.** In Markdown mode a selection inside (or exactly over) a citation reopens
  it; in Visual mode the chip does. Only that citation's text is replaced. New citations go at
  the end of the selection, after a space when they would touch a word, so the selected text
  stays; the caret lands after the citation.
- **Undo.** The editor keeps one undo record for the last citation applied: the exact prior
  Markdown and selection (Markdown mode) or a copy of the visual editor's nodes and caret path
  (Visual mode). Ctrl+Z or **Undo citation** restores it while the draft is unchanged since;
  after any other edit the record is dropped and native undo applies.
- Footnotes, links and protected blocks keep the existing visual-editor rules; the picker never
  edits them.

## Consequences

- Visual and Markdown modes round-trip citations byte for byte, including hand-written and
  invalid ones, which stay text for the author to fix.
- What is inserted is exactly what a build will read, because the core scanner checked it.
- A citation cannot be inserted inside code or a protected block from Visual mode; the author is
  told so and the draft is unchanged.
- Other visual-editor normalization (such as `*em*` becoming `_em_` after a visual edit) is
  unchanged and outside this decision.

## Domain language

**Citation** and **Citation chip** are defined in [`CONTEXT.md`](../../CONTEXT.md).
