# ADR 0231: Feature consent binds the exact text and the name, and a material edit needs renewed consent

- Status: Accepted
- Date: 2026-10-26
- Decision issue: [#214](https://github.com/journey-to-code-org/open.blog/issues/214)
- Parent story: [#205](https://github.com/journey-to-code-org/open.blog/issues/205)
- Parent epic: [#16](https://github.com/journey-to-code-org/open.blog/issues/16)
- Builds on: [ADR 0110](0110-submission-consent-is-an-append-only-record-and-anonymous-display-keeps-provenance.md),
  [ADR 0111](0111-third-perspective-lifecycle-and-its-one-public-projection.md),
  [ADR 0167](0167-a-readers-credit-is-opt-in-bound-to-the-text-it-was-agreed-for-and-shown-only-in-the-link-view.md),
  [ADR 0230](0230-featuring-a-reflection-is-an-editorial-selection-of-one-approved-reflection-with-the-readers-own-consent.md)

## Context

The reader agreed to feature the words they saw. Words can change: a clarification replaces the text,
an editor can slip while hand-editing the published file, and a name can be hidden or, if a stored
history were wrong, widened. The lesson of RD13's `creditRevision` applies: an agreement that does not
match the text must not carry over to different text.

## Decision

- **A material edit is any change to the reflection's text.** Only a clarification the reader answers
  changes it, as the next text revision (ADR 0111). It leaves the old `featureRevision` behind, so the
  consent covers the old words only. A feature of the old text is `textChanged` and comes off.
- **Only an explicit agreement renews, and a change to anything else never does.** A consent change
  carries a three-way feature choice, `FeatureChange::Keep`, `Agree { revision_seen }` or `Decline`,
  never a flag. `Keep` (what every change to the name or to being asked to clarify sends) carries the
  `featureRevision` in effect forward exactly as it was, still naming the old text. Only `Agree` binds
  a revision, and only the revision the reader saw: the approved one once approved, or the current one
  before a decision; an agreement for any other revision is refused (`staleRevision`). The first design
  rebound a kept agreement to the current text whenever any consent change was made, so a reader who
  merely switched off clarification after rewriting their reflection silently agreed to feature words
  they had not agreed to; that is now impossible by construction. Stored consent records are unchanged
  and read as before: this alters only what a new change may write.
- **The words are bound twice.** A feature records the revision the reader agreed to and the digest of
  that text (`body_digest`, a domain-separated BLAKE2s-256 of the exact bytes). The hosted check
  compares the revision, the approved revision and the digest; the static page compares the published
  text's digest. A hand edit of the published reflection, a republication of changed text or a
  restored older text hides the feature until it is featured again for that text.
- **The reader's words are shown whole or not at all.** A featured reflection is the approved text, byte
  for byte, never an excerpt, truncation, pull quote or edited version, because a cut can change what
  the reader said. The editor says why it is worth reading in their own note, labelled as theirs
  (ADR 0234).
- **A name may only narrow.** The feature records the name shown when it was chosen (none when the
  reader kept it private or it matched a credited name). A reader who later hides their name changes
  nothing else: the feature stands, anonymously. A name that differs from the recorded one, or one added
  where there was none, is never shown (`nameChanged`), whether a stored history is wrong or the
  published file was edited. A reader cannot widen a name after approval at all (ADR 0110).
- **Editing the note is not a material edit.** The note is the editors' own words about the reflection;
  changing it needs no consent from the reader and shows no new reader text. It must still pass
  ADR 0234's rules.
- **Declining is immediate and renewing is explicit.** Declining to feature (a narrowing change,
  ADR 0110) takes effect at once and the reflection stays published; to be featured again the reader
  agrees again, explicitly, for the revision they see. A reader who revoked publication cannot be featured at all.

## Considered options

- **Bind only to the revision number.** Rejected: it does not catch a hand-edited published file, which
  the static build alone must refuse.
- **Rebind a kept agreement to the current text on any change.** Rejected: it renewed consent the
  reader never gave (RD10 behaved so until this correction; the stored records are unaffected).
- **Allow light editing of featured text (trimming, spelling).** Rejected: any edit puts words in the
  reader's mouth; if the reader wants a change they clarify and renew.
- **Let the featured name differ from the published name.** Rejected: one projection decides what a
  reader's name is, and a second would be a second place to leak or widen it.
