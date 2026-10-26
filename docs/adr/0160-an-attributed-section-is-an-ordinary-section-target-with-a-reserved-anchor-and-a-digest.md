# ADR 0160: An attributed section is an ordinary Third Perspective section target with a reserved anchor and the digest of its text

- Status: Accepted
- Date: 2026-10-26
- Decision issue: [#212](https://github.com/journey-to-code-org/open.blog/issues/212)
- Parent story: [#202](https://github.com/journey-to-code-org/open.blog/issues/202)
- Parent epic: [#16](https://github.com/journey-to-code-org/open.blog/issues/16)
- Builds on: [ADR 0030](0030-one-deterministic-reading-order.md),
  [ADR 0033](0033-portable-equivalents-of-every-reflection-layout.md),
  [ADR 0076](0076-passage-targets-are-section-anchors-with-quoted-context.md),
  [ADR 0109](0109-third-perspectives-are-reader-reflections-with-optional-prompts-and-four-distinct-stages.md),
  [ADR 0112](0112-third-perspective-shapes-map-onto-b5-and-rd12-at-merge.md)

## Context

A shared reflection publishes each author's text as a turn under that author's name. RD10 lets a
reader write a Third Perspective about "one section" using a heading id. A turn is raw markup with
no heading id, and a heading id made from text or position changes when authors reorder, add or
rename things, so a reader's note could end up under the wrong author. Layouts also place turns in
columns or lanes, so any "left author" or "right author" is a property of CSS, not of the work.

## Decision

- **The target names the author, not a position on screen.** An attributed target is the author's
  contribution id (the opaque draft id the shared publication already uses, never a name or an
  account), the zero-based place `nth` among that author's sections in reading order, and B5's
  digest of the section's normalized text. Nothing about layout, lane, side or column is part of
  it, and the same sections are found whichever of the five layouts a post is published in.
- **It is stored as an ordinary RD10 section target**, so no schema, file or column changes and
  every stored Third Perspective, every projection and every reader of one keeps working: the
  section is the reserved anchor `ob-by-{contribution}-{nth}`, the selector is B5's section
  selector, and the digest is required. A reserved anchor that is not written exactly so, or that
  has no digest, is refused. A target that is not attributed (the whole work, an ordinary heading
  id) keeps RD10's meaning unchanged.
- **The sections as published come from the published body**, never from drafts:
  `AttributedSections::from_published` reads the arranged reflection back (ADR 0033), matching each
  turn to the one participant whose display name heads it, and digests exactly the turn's Markdown.
  Later private edits to a draft therefore cannot change what a target means. A turn whose name
  matches no participant or more than one, and any post that is not an arranged reflection, has no
  attributed sections: fail closed, nothing is guessed. Quotations stay B5's passage feedback and
  are not attributed targets (RD10 already refuses them).
- **Conversation items are not attributed targets.** "Speaking for A, B" items have positional ids
  and several authors; a reader answers them through the whole-work target. Revisit when they gain
  stable ids.

## Consequences

- The renderer (#224) gives each author section the anchor this ADR defines; until then the
  contract exists in core and existing posts publish byte for byte as before.
- Contribution ids are opaque handles such as `participant-2`; they appear in anchors, which reveals
  only how many co-authors exist.
