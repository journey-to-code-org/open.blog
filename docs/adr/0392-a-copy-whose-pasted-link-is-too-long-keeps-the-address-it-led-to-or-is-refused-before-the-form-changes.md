# ADR 0392: A copy whose pasted link is too long keeps the address it led to, or is refused before the form changes

- Status: Accepted
- Date: 2026-11-08
- Parent epic: [#474](https://github.com/journey-to-code-org/open.blog/issues/474)
- Story and tasks: #487, #519, #520, #521
- Amends: [ADR 0391](0391-a-review-a-published-job-shows-cannot-be-deleted-and-a-copy-keeps-an-address-only-if-the-review-can.md)

## Context

ADR 0391 made a copy keep the address a link led to only when a review could keep it as its link. It did not cover the
other side: the **pasted** link itself being too long. The **Link to copy from** box has no length limit, and the
snapshot route (shared with the assistant's URL context) does not check length either. A Google Maps link of 700 or so
characters copied fine, went into the read-only **Link to the review** box, and the review could then never be saved:
Admin said "Use the review's full link, starting https://." on a box the owner could not change, and the server's
500-character limit would refuse it too.

## Decision

1. **A pasted link the review cannot keep gives way to the address it led to, when that one can be kept** (at most 500
   characters, a plain http or https link, no spaces, no user name or password). The platform is then read from that
   address.
2. **When neither can be kept, the copy is refused before the form changes.** The Reviews screen says "That link is too
   long for your site to keep (over 500 characters). Use the review's Share link instead, or type the review in below."
   Nothing is filled in, so the link box stays editable and the review is still marked as typed in.
3. The snapshot route is not changed: it serves the assistant too, where a long link is fine. The check lives in the
   Reviews screen, which is the only place a copied link becomes a review's link.

## Consequences

- An owner who pastes a long Maps link is told to use the shorter Share link, which is what Google offers on a phone.
- A refused copy has still fetched the page once, as the owner asked; its words are not kept.
- No stored format changes.
