# ADR 0025: Storing, authorizing and approving shared synthesis

- Status: Accepted
- Date: 2026-10-25
- Decision issue: [#179](https://github.com/journey-to-code-org/open.blog/issues/179)
- Parent story: [#150](https://github.com/journey-to-code-org/open.blog/issues/150)
- Parent epic: [#143](https://github.com/journey-to-code-org/open.blog/issues/143)

## Context

ADR 0024 modelled synthesis items in core only. Authors now need to write, attribute, approve,
reorder and withdraw from them in Admin, and the approval and publish gates must account for them.
Three places built the approval subject separately (the publish gate, the combined preview and the
approval routes), and all passed no attributed authors and no synthesis frame, so a synthesis edit
could not stale a standing approval and a named author could be left out.

## Decision

- **One subject builder.** `assembly::with_subject` is the only place an `ApprovalSubject` is built.
  It takes the `SynthesisSet`, appends `binding_frame()` to the public metadata and passes
  `attributed_authors()`. `assembly::assemble`, `preview::build` (which now runs inside
  `with_subject`), the approve route, the reconcile pass and the publish gate all call it, so the
  binding a preview hands out, the one a route stores and the one the gate checks cannot drift.
- **Storage.** `.openblog/private/collaboration/synthesis/<publication>.json`, one file per
  publication beside the drafts, written by the same compare-and-swap replace (a stale read, a
  symlink, a directory or an oversized file is refused and nothing is overwritten). A file that
  exists but does not parse is an error, never an empty synthesis, so a bad file cannot make a piece
  look synthesis-free and publishable.
- **Authorization.** A new `AuthorizationAction::EditSynthesis` targets the requester's own
  participant and is held by Contributors only, for themselves. It is deliberately narrower than
  `EditDraft`: a named author must be able to approve the piece and Editors cannot. Every route
  resolves the requester through `SharedPublication::authorize`; coordinators who are not
  contributors, readers, removed members, strangers, unknown publications and missing sessions all
  get the same 404 and learn nothing. The list of people an item may name is the set of participants
  who currently hold the grant.
- **Routes.** `GET collaboration/synthesis?publicationId=` returns the items with who approved and
  who is awaited, and `POST collaboration/synthesis` applies one `change` (`add`, `edit`,
  `withdraw`, `approve`, `reorder`) against `expectedRevision`. Requests deny unknown fields, so no
  participant id can be smuggled; the acting participant always comes from the session. A stale
  revision is a 409 that stores nothing; invalid input is a 422; a published reflection refuses
  further changes. Each stored change reconciles the piece's approvals in the same transaction.
- **Reconcile.** `reconcile_approvals` (called after every author-set or prose change, including
  member removal and role changes) first runs `SynthesisSet::reconcile` with the current grant
  holders and stores the result, then reconciles approvals against the new frame. A failure leaves
  stale state, which is recomputed on every read and fails closed.
- **Gate.** Publishing is blocked for a named author who has not approved the piece (the attributed
  rule, under every policy) and also while any item is not approved by every author it names
  (`assembly::unapproved_item_authors`), reported as the missing authors' names only. Whole-piece
  approval is not item approval: an author approves the piece, and separately approves each item
  that speaks for them. Any edit changes the binding frame, so it stales standing approvals even
  when every item is approved again.
- **Visibility.** The combined preview lists each item with who approved it and who is awaited
  (names only in the summary). Item prose appears only in the sandboxed preview document served to
  active authors, rendered by the production sanitizing renderer. Admin shows the same standing next
  to each item.
- **Public output.** Nothing here writes a Post, page, feed or export, and the assembled Post still
  carries no synthesis. Publishing approved synthesis is a later task (#180); until then unapproved
  synthesis cannot reach public output because none does.
- **Prompts.** Each kind has an optional prompt the author can insert, edit or ignore, and prompts
  can be dismissed and restored. The dismissal is remembered only in the browser as a convenience.
  No kind, count or length is required beyond a non-empty item.

## Consequences

- Adding an author to an item, editing it, reordering, or an author leaving all stale standing
  whole-piece approvals; authors re-approve what is now on the page.
- Contributors only: a coordinator or editor cannot be named on an item or approve one.
- The combined preview is authorized as a draft author (EditDraft, which editors hold), so it receives
  the synthesis only when the requester also holds EditSynthesis; for anyone else the items, their
  names and the conversation section are left out, while readiness still counts every item.
- This amends ADR 0024: synthesis authors are Contributors only.

## Recipient-specific delivery

The synthesis route also supports an explicit `delivery` change. Every current synthesis author
must separately consent to deliver the current conversation to a named participant with publication
access. The request names the synthesis revision and authorization revision seen when the recipient
was chosen. Consent covers even an empty conversation, so a denied reader cannot infer whether one
exists. Removing any consent, changing the conversation, or changing membership or authorization
prevents delivery; restoring access alone does not restore it. A delivered conversation is read-only
for recipients without the synthesis author grant. These grants do not enable combined review or
whole-piece approval for non-authors; that requires further work.

Admin lets each author confirm or withdraw their own agreement for each eligible recipient and
lets recipients read the delivered conversation. A recipient who is not entitled to read it sees
the same unavailable message whether the conversation is empty or contains private items.

Delivery is stored in the private synthesis file. Older versions that reject unknown synthesis
fields cannot read files containing delivery consent or its content revision. Rollback requires
preserving those files and removing the new fields only after accounting for the lost consent.
