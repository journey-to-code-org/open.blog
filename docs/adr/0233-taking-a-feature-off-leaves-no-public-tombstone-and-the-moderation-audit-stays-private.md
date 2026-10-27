# ADR 0233: Taking a feature off leaves no public tombstone, and the moderation audit stays private

- Status: Accepted
- Date: 2026-10-26
- Decision issue: [#214](https://github.com/journey-to-code-org/open.blog/issues/214)
- Parent story: [#205](https://github.com/journey-to-code-org/open.blog/issues/205)
- Parent epic: [#16](https://github.com/journey-to-code-org/open.blog/issues/16)
- Builds on: [ADR 0110](0110-submission-consent-is-an-append-only-record-and-anonymous-display-keeps-provenance.md),
  [ADR 0115](0115-approved-third-perspectives-publish-from-a-versioned-public-file-and-portable-copies-link-to-them.md),
  [ADR 0232](0232-withdrawal-retention-and-a-lost-source-take-a-feature-off-for-a-stated-reason.md)

## Context

Issue #214 asks for a documented unpublish or tombstone policy. A tombstone ("a featured reflection was
removed here") tells readers something happened to a reader's words, who may have withdrawn them
because of the attention. It also invites a count of removals, which is a signal of its own.

## Decision

- **No public tombstone.** When a feature comes off, its record is removed from
  `community-perspectives.json` and the page shows nothing where it was: no placeholder, no "withdrawn"
  notice, no removed-entry link. The file keeps no id, day, name, note or digest of it. Nothing on the
  page counts reflections or features, so a gap is invisible, and a section with no features is not
  rendered.
- **What stays private, and where the record is.** Moderation's audit (RD12) holds who decided, who
  withdrew and why, and never leaves the hosted store. Featuring adds no audit action to it, because an
  audit action is a stored vocabulary and a new one would be a hosted change. Who featured or took off,
  and when, is the history of the file in the site's repository, as for `third-perspectives.json`. The
  record itself holds only the day featured and never the editor's name.
- **Copies already published may remain.** Like a published reflection, a feature has been in the
  site's history, caches and possibly a public repository. No step here can recall those. The consent
  form and the withdrawal text say so (ADR 0115), and the feature consent says it in its own words: a
  featured reflection and a published name become part of the site's public record.
- **A removal is final for that text.** A feature that came off because the reader declined, withdrew
  or the text changed is not restored by anything automatic. Featuring again is a new Admin act against
  a consent that matches the text now (ADR 0231).
- **No notification.** Nothing emails a reader that their reflection was featured or taken off. The
  reader sees only what their receipt already says about the reflection.

## Considered options

- **A public tombstone with no text.** Rejected: it still announces that something was withdrawn and can
  be counted.
- **A private tombstone row in the hosted store.** Rejected: it needs a hosted schema change for no
  decision it would help make, since a withdrawn consent is already final (ADR 0110).
