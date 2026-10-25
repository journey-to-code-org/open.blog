# ADR 0030: A reflection's structure is separate from its layout and carries no identity

- Status: Accepted
- Date: 2026-10-25
- Decision issue: [#170](https://github.com/journey-to-code-org/open.blog/issues/170)
- Parent story: [#148](https://github.com/journey-to-code-org/open.blog/issues/148)
- Parent epic: [#143](https://github.com/journey-to-code-org/open.blog/issues/143)

## Context

Story SP5 presents the same approved contributions as side-by-side, sequential, point and
counterpoint, alternating dialogue or roundtable. [ADR 0005](0005-shared-publication-language.md)
forbids pair-specific fields, and [ADR 0018](0018-reveal-policy-readiness-and-comparison.md) gives a
publication one author set. The contract's `layout` list of contribution-to-region pairs
(`collaboration.rs`) is an opaque region vocabulary, not a reading structure.

## Decision

- `reflection::ReflectionStructure` is a versioned, revision-checked value: a `layout` mode and
  ordered `rounds`. A round has a stable id, an optional prompt and ordered `turns`; a turn is only a
  contribution id. A round with turns from several participants is an exchange.
- All five modes are one `ReflectionLayout` enum over the same structure. Changing it
  (`with_layout`) changes no round, prompt, turn or prose.
- A turn names a contribution, never a participant. Identity, display name and ownership come from
  the contribution in the collaboration contract at read time, so a structure holds no identity.
  Every struct is `deny_unknown_fields`, so `left`, `right`, `authorA`, `gender`, `pronouns`, `side`,
  `author` or `participantId` are rejected, and layout names are a closed list with no positional or
  gendered member.
- Placement (`lane` of `lanes`) is derived from the reading order and the layout, from the order
  participants first appear, and is never stored. Side-by-side and roundtable give each participant a
  lane; point-counterpoint uses two lanes (the first speaker, then everyone else); alternating
  dialogue alternates by turn; sequential has one lane. Any number of participants works.
- The structure is private collaboration state and is not wired to storage, routes, Admin or the
  publish gate here. It leaves the existing `layout` contract field untouched.

## Failure boundary

Parsing is bounded (128 KiB, 200 rounds, 100 turns per round, 1,000 turns, 1,000-byte prompts),
rejects control and bidi characters in prompts, requires safe opaque ids with each contribution used
at most once, and returns one `ReflectionError::Invalid` that never echoes input. A replacement must
name the current revision and the next number. Parsing and ordering are pure and mutate nothing, so
canonical content and public output are unchanged on any failure. Prompts and prose stay untrusted
text for the renderer to escape.

## Consequences

- #171 and #172 render layouts from `reading_order` and `placements`; #173 writes the sequential
  equivalent from the same order.
- Because a structure is not tied to a revision of prose, a layout switch never needs re-approval of
  prose (approval of the layout choice itself is decided in ADR 0031).
