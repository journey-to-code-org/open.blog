# ADR 0344: A Product Hunt launch stays the maker's to approve, submit and record, and is never repeated silently

- Status: Accepted
- Date: 2026-10-29
- Parent epic: [#384](https://github.com/journey-to-code-org/open.blog/issues/384)
- Story: #396 (task DIST4.2.3)

## Context

Task DIST4.2.3 asks to "keep approval/submission manual and document platform compliance", and the epic says the
Product Hunt "submission stays user-controlled". Product Hunt's launch guide forbids asking for upvotes and company
accounts, and allows a relaunch for each significant new iteration. Its API offers no way to create a launch and
forbids commercial use (ADR 0341). ADR 0340 already records community submissions as the author's word.

## Decision

- **There is no approval step in open.blog because there is nothing for it to approve.** The maker's approval *is*
  their own click on Product Hunt's form. open.blog prepares and hands off; it does not create a draft, schedule a
  launch, upload an image, sign in, store a Product Hunt credential or read anything back. The distribution approval
  of ADR 0329 is for writes open.blog makes; a launch kit makes none.
- **The handoff appears only when nothing blocks.** A blocked kit has no link to the form (ADR 0342); the fields stay
  copyable so the maker can still decide.
- **Recording reuses ADR 0340.** `--confirm product-hunt [--permalink <address>]` records `status:
  "author-confirmed"`, `evidence: "author"` under the post's source identity and key `product-hunt`. The address is
  checked for shape only (`https://www.producthunt.com/posts/<slug>`, `/products/<slug>` or
  `/products/<slug>/launches/<slug>`) and never opened.
- **No silent repeat.** After a confirmed launch the kit is blocked with `already-launched`; `--again` prepares it as
  a relaunch with a `relaunch` notice that names the earlier day. Product Hunt states no waiting period, so none is
  invented; recording a second launch also needs `--again`.
- **Compliance is documented, not enforced by guesswork.** [Community submissions](../community-submissions.md)
  lists each written Product Hunt rule beside what open.blog does about it, the date it was checked, and what was not
  verified (whether the form reads prefilled fields, a name limit, co-maker username rules, other image formats).
  Rules only the maker can follow (personal account, no vote asking) are checklist items.

## Considered options

- **Approve the kit by digest, like a distribution plan.** Rejected: nothing is sent, so an approval would bind no
  write and would only look like consent to something open.blog does not do.
- **A waiting period between launches.** Rejected: Product Hunt states none; a blocking notice until `--again`
  makes the maker say it is a new iteration without open.blog guessing how long that takes.
- **Read the launch back to confirm it.** Rejected: that needs the API whose terms open.blog cannot accept for its
  users, and would turn the maker's word into a claim open.blog could get wrong.

## Consequences

- Distribution reporting (epic #388) sees a Product Hunt launch as an author-confirmed fact, like the other
  community destinations, never as provider-verified.
- If Product Hunt ever offers an API for makers, using it would be a manifest change the contract treats as breaking
  (ADRs 0327, 0341), and this ADR would be superseded.
