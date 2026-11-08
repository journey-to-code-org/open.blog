# ADR 0388: A quote answer that cannot be confirmed never says nothing was saved, and a photo put back is recorded where it is

- Status: Accepted
- Date: 2026-11-08
- Parent epic: [#474](https://github.com/journey-to-code-org/open.blog/issues/474)
- Stories and tasks: #485, #516, #518
- Amends: [ADR 0387](0387-the-quote-form-runs-on-render-beside-the-server-the-owner-sets-retention-in-admin-and-an-erase-looks-before-it-gives-up.md)

## Context

A review of ADR 0387's work found two gaps:

- **A time-out told a visitor nothing was saved (#516, #485).** On Render, `openblog serve` stops waiting for the
  quote service after 25 seconds and answers `504 {"error":"timeout"}`. The service may still finish and save the
  request. The form's script turned every status of 500 or more, and a lost connection, into "We could not save your
  request, and nothing was sent", which is false for a saved request and invites a second copy. An answer that
  broke off after the service took the request was also said as "nothing was sent".
- **A photo put back with a lost reply was recorded in the wrong place (#518).** When an erase fails part way, the
  photos already moved to the hold folder are put back. If putting one back worked but its reply was lost, the
  request was changed to point at the hold folder while the photo was back in its own folder. The next erase then
  removed the record, "removed" the empty hold path, and reported a verified erase while the photo stayed in storage
  with nothing pointing to it.

## Decision

1. **Three kinds of failed answer.** The server tells the visitor "nothing was sent" only when the service was never
   reached (nothing listens, `502 {"error":"failed"}`). A time-out (`504 {"error":"timeout"}`), or an answer that
   breaks off or cannot be read (`502 {"error":"unconfirmed"}`), tells the visitor the request could not be confirmed
   and may have been saved, and asks them to call before sending it again. The form's script says the same for a 504, for
   `timeout` or `unconfirmed`, and for a lost connection (status 0), since none of them tells whether the request was
   saved. The function's own 500 and 503 still say nothing was sent: it answers those only after removing what it
   stored.
2. **Putting a photo back looks too.** When moving a photo back fails, the erase lists the hold folder. Only a photo
   seen there is recorded there. A photo not there (put back with a lost reply, or gone), or one whose place cannot
   be told, keeps its request's own path; the next erase already looks in both places (ADR 0387).

## Consequences

- A visitor who loses the connection before anything was sent is asked to call rather than told to try again. That
  is slower for them, but never false.
- No stored format changes.
