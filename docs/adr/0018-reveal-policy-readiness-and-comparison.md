# ADR 0018: A coordinator-chosen reveal policy, per-revision readiness, and a placeholder comparison

- Status: Accepted
- Date: 2026-10-25
- Decision issue: [#164](https://github.com/journey-to-code-org/open.blog/issues/164)
- Parent story: [#146](https://github.com/journey-to-code-org/open.blog/issues/146)
- Parent epic: [#143](https://github.com/journey-to-code-org/open.blog/issues/143)

## Context

[ADR 0016](0016-private-contribution-revisions-and-mutual-reveal.md) defined the mutual exchange but
nothing let a participant start one, and [ADR 0014](0014-record-level-authorization-and-publish-gate.md)
left the reveal route deny-by-default. Readers of a comparison must never learn more than reading
each draft would allow.

## Decision

- The draft set holds a reveal policy, defaulting to `independent`: nothing is ever revealed.
  `voluntary` reveals among any two or more participants who mark a revision ready, and only those.
  `allReady` reveals only when every participant who currently holds the draft grant is ready.
- A new action `SetRevealPolicy` targets the publication and is held by Site owners and
  Coordinators. It reads no draft. A coordinator who is not a drafter can set the policy and sees
  the policy only.
- Marking ready names one exact revision of the caller's own draft and goes through
  `EditDraft`. The offer is private and can be replaced or taken back at any time before the reveal
  commits. When the policy condition is met, the same write turns all offers into one revealed
  exchange (ADR 0016 semantics), so every member reads every committed revision at once or nobody
  does. Edits after an offer or reveal stay private. Withdrawing a draft takes back its offer.
- Changing the policy clears every standing offer and reveals nothing itself, so a policy change
  cannot expose prose that was offered under another policy. Offers cannot exist under
  `independent`, and stored data that says otherwise fails to load.
- Participant removal: the route computes the active drafters through `authorize` on each binding.
  A removed or downgraded participant neither counts toward `allReady` nor joins a reveal. Their
  earlier offers and any reveal already committed are untouched, and a copy already read cannot be
  recalled.
- `voluntary` groups are separate: a participant who becomes ready after a group revealed starts the
  next group and sees nothing from the earlier one, because the earlier members only agreed to
  share with each other.
- The comparison lists every contract participant in contract order with their display name. Each
  slot is the caller's own latest revision, a revision revealed to the caller (decided by
  `DraftSet::view`), or a placeholder that is identical for missing, unrevealed, withdrawn and
  unknown drafts. A placeholder says only whether that participant has offered a revision. Prose,
  names and metadata are JSON strings; a client renders them as text, never as markup.
- Routes: `GET /admin/api/collaboration/reveal`, `PUT .../reveal/policy`, `PUT .../reveal/ready`.
  All need the Admin session, writes need CSRF and strict JSON, every refusal is the same 404, and
  writes use the revision-checked draft store (409 on a race, nothing changed). Manual exchange
  creation and `POST .../contribution/reveal` still have no route. No browser panel ships here.

## Consequences

- Reveal never approves anything and the contract is untouched.
- Publication approval and group-safe state beyond this model stay with later stories.
