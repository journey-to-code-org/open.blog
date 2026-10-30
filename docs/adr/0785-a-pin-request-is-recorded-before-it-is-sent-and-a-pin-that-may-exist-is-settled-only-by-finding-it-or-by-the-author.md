# ADR 0785: A Pin request is recorded before it is sent, and a Pin that may exist is settled only by finding it or by the author

- Status: Accepted
- Date: 2026-10-29
- Parent epic: [#383](https://github.com/journey-to-code-org/open.blog/issues/383)
- Story: #394 (task DIST3.2.3)

## Context

Task DIST3.2.3 asks for integration tests, failure reporting and source URL preservation. A Pin request can fail in
ways that certainly created nothing (a refused token, a refused field) and in ways that may have created a Pin
(a timeout after the body was sent, a server error). Social publishing already separates the two (ADR 0318) and
learned that "not found" is not proof of "not posted" (SP5: an absence is reported only when nothing in the window
could be the post). Epic #383 asks for reliable failure states and that the canonical page stays the source.

## Decision

- **Three outcomes, from the reply alone.** `201` or `200` with a numeric `id` is **posted**. `400`, `404`, `409`,
  `413`, `415` and `422` (refused as sent), `401` (token refused: expired, a sandbox token lasts 30 days, or revoked;
  reconnect), `403` (missing scope, a board not the author's, or a Trial app in production) and `429` (rate limit)
  are **not posted**: nothing was created and sending again is allowed. Anything else (no reply, a timeout, a `5xx`,
  a success without a Pin id) is **unknown**. Every message is fixed text per code; Pinterest's own `message` is
  never printed or recorded, and the token never appears anywhere.
- **Recorded before the request.** Before `POST /v5/pins`, the private record (`syndication.pinterest.stateFile`)
  gets an `unknown` entry for the environment, board and post with the attempt time, digest and link; the reply
  then turns it into `posted` (with the Pin id and address) or `not-posted` (with a fixed failure code). A crash or
  a killed process mid-request therefore leaves `unknown`, never a gap that would let a second Pin through.
- **Unknown is settled by finding the Pin or by the author.** An `unknown` entry refuses every further send of that
  post to that board. `--reconcile` reads the board's Pins (`GET /v5/boards/{id}/pins`, at most 20 pages) and
  records the attempt as posted when exactly one Pin links the post's canonical address and was created no earlier
  than five minutes before the attempt. Finding none, or more than one, or failing to read, leaves it `unknown` and
  says so: open.blog never concludes on its own that nothing was posted. `--forget-attempt`, after the author has
  looked at the board, removes the entry so the Pin may be sent again, and says that a second Pin results if the
  first did exist. The command exits non-zero for every not-posted, unknown and unsettled outcome.
- **The source address is preserved and checked.** A Pin's `link` is the canonical address cross-posting uses (the
  post's page on the site, ADR 0004), exactly, with nothing appended. It must be a public web address (not
  `localhost`, a `.local` name or a bare IP), or the Pin is refused before any request. When Pinterest's reply
  carries a different link, or none, the Pin is still recorded as posted (it exists) with `linkPreserved: false`, and
  the author is told to check where it leads.
- **Tests never reach Pinterest.** Unit tests script the transport for every reply above, a crash during the request
  (the record is checked while the request is in flight), reconciliation with zero, one and two candidates, paging
  and a refused token. Integration tests run the binary: a build with its feeds, an export, a cross-posting plan, a
  card plan and `openblog check` are byte for byte the same with Pinterest on and a token present, the token is in
  no output, and every command refuses before any request while Pinterest is off or the token is missing.

## Considered options

- **Retry an unknown attempt automatically.** Rejected: it is how one announcement becomes two.
- **Treat "no matching Pin found" as not posted.** Rejected: Pinterest may not list a new Pin at once, and the author
  may have edited it; only the author can decide.
- **Record the provider's error message for diagnosis.** Rejected: provider text can echo content and is not the
  author's to keep; the fixed code says what to do.

## Consequences

- A Pin is created at most once per post and board unless the author explicitly decides otherwise.
- An author always learns whether a Pin exists, does not exist, or needs their look.
