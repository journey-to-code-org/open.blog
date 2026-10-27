# ADR 0234: A feature says whose reflection it is and why it is shown, and nothing counts, ranks or claims consensus

- Status: Accepted
- Date: 2026-10-26
- Decision issue: [#214](https://github.com/journey-to-code-org/open.blog/issues/214)
- Parent story: [#205](https://github.com/journey-to-code-org/open.blog/issues/205)
- Parent epic: [#16](https://github.com/journey-to-code-org/open.blog/issues/16)
- Builds on: [ADR 0111](0111-third-perspective-lifecycle-and-its-one-public-projection.md),
  [ADR 0156](0156-acceptance-means-editorial-interest-only-and-nothing-ranks-or-counts-suggestions.md),
  [ADR 0230](0230-featuring-a-reflection-is-an-editorial-selection-of-one-approved-reflection-with-the-readers-own-consent.md)
- Coordinates with: [#230](https://github.com/journey-to-code-org/open.blog/issues/230) (public section)

## Context

The story's promise is that readers know whose reflection is featured, why it appears, and that
selection is not a community vote. A featured section is where a site is most likely to imply the
opposite: a short list reads as "the best" or "what people think".

## Decision

- **Honest provenance, always shown.** A `FeaturedPerspective` carries a `provenance` line a renderer
  shows with it: it is a Third Perspective from a named or anonymous reader, the day it was received,
  that the editors approved it, the day it was featured with the reader's separate permission, and, when
  true, that the reader read an earlier version or that the part it is about has changed. A reader's
  reflection is never shown as an author's, a member's or the group's (`role` is `reader`, ADR 0111).
- **Why it appears is a fixed sentence.** `NON_CONSENSUS_NOTICE` ("The editors chose this reflection to
  feature. It is one reader's view: featuring it is an editorial choice, not a vote, and it does not mean
  the authors, the editors or the community agree with it.") heads the section; no setting turns it off
  or replaces it.
- **The editors' note is theirs.** At most 280 characters of plain text, labelled as the editors' note,
  optional. It is refused when it claims popularity, a count or agreement: a conservative phrase list
  ("most agreed", "most popular", "top-rated", "upvoted", "community consensus", "most readers" and the
  like) and any number beside readers, people, likes, votes, agreement or shares. This is a hint that
  errs toward refusing, not a judgment of the note, and ADR 0156's rule that acceptance never states
  quality applies.
- **Nothing counts, ranks or orders by popularity.** Inclusion is an editor's choice and is never
  derived from reactions, reads or reports (the system holds none of the first two). A feature has no
  number, rank, score, weight or position; the public type has no such field, and a section never
  states how many reflections it holds or how many were submitted, approved or featured. Features are
  listed by the day they were featured, then the id: a fixed order that says nothing about merit.
- **Placement is the page it is about.** One community section per canonical page, after the Third
  Perspectives section, anchored `ob-community-perspectives`. A reflection has at most one placement;
  a repeated id in the file is refused as a whole. Grouping features under editor headings is a later,
  separate decision that needs its own consent wording and file version (ADR 0235).
- **The editor who chose it is not shown.** The public form has no field for the Admin user or any
  moderator; the page says "the editors". A site run by one author still says "the editors", since the
  claim is about selection, not about who made it.

## Considered options

- **Order by an editor's rank.** Rejected: any order an editor sets reads as a ranking.
- **Show how many reflections the site received, for context.** Rejected: a count of reflections is a
  popularity signal, and the system is not a poll.
- **Block "consensus" in a note altogether.** Rejected: an editor may honestly write that a reflection
  is not a consensus view; only claims of agreement or popularity are refused.
