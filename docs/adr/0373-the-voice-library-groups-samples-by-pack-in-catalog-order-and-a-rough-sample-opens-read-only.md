# ADR 0373: The voice library groups samples by pack in catalog order, and a rough sample opens read-only

- Status: Accepted
- Date: 2026-10-28
- Decision issue: [#448](https://github.com/journey-to-code-org/open.blog/issues/448)
- Parent story: [#419](https://github.com/journey-to-code-org/open.blog/issues/419)
- Parent epic: [#408](https://github.com/journey-to-code-org/open.blog/issues/408)
- Builds on: ADR 0266, ADR 0267, ADR 0268, ADR 0370

## Context

An author with a few weeks of sessions needs to see what they have and where the gaps are, and to open any sample
the way its stage says: a rough draft to read, a polished draft to edit.

## Decision

- **One list from the server, grouped by the page.** `GET voice/samples` returns every sample file, valid or not,
  and for each catalog pack the prompts with whether a rough and a polished draft exist. The page groups them
  (`groupLibrary`, a pure function), so the same files always give the same page.
- **Deterministic order.** Packs come in the catalog's order. Inside a pack the prompts that have a sample come
  newest first (by the newest of their files, ties broken by file name). A prompt with a rough and a polished
  draft is one row with both badges, showing the polished draft's length and the newer date.
- **Badges say the stage in a word and a shape** (a hollow diamond for rough, a solid one for polished), plus the
  length, where it is kept (Private or Portable) and the date. Color is never the only signal.
- **Coverage is a sentence per pack** ("3 of 4 prompts written, 1 polished") and a total at the top. A pack with
  prompts still unwritten offers "Draw from this pack", which opens the session view restricted to that pack
  (`#/voice?pack=<id>`); a pack that is fully written does not.
- **Nothing is hidden.** A sample of a pack the site no longer offers goes in a last group ("Other prompts"), and a
  file that cannot be used is listed apart with the store's guidance and the folder it is in. A library with only
  an unreadable file is not called empty. The list carries no sample text.
- **The empty state teaches.** It says what a sample is (short, in your own words, against a clock, private by
  default, never a post) and offers Start a session.
- **Opening a sample follows its stage.** A rough draft opens read-only with a sentence on why, and offers a
  polished copy; a polished draft opens in the same editor as after a session, revision-checked (see below).
  Promoting a polished draft to a post is a separate step.

## Considered options

- **Group on the server.** Rejected: ordering and wording are page concerns, and the page needs the raw files for
  its invalid group.
- **A row per file.** Rejected: a pair is one piece of writing; two rows would double the list.

## What would trigger revisiting this

- Libraries large enough to need paging or search: the list is small files of one author and is read in full.

## Consequences

- The library, the CLI and the Assistant read the same folders, so a sample written anywhere appears here.
