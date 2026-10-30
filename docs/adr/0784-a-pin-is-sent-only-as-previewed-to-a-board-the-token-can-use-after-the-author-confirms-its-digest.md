# ADR 0784: A Pin is sent only as previewed, to a board the token can use, after the author confirms its digest

- Status: Accepted
- Date: 2026-10-29
- Parent epic: [#383](https://github.com/journey-to-code-org/open.blog/issues/383)
- Story: #394 (task DIST3.2.2)

## Context

ADR 0783 makes Pinterest a destination sent from the CLI with the author's OAuth token. Task DIST3.2.2 asks for a
preview, authorized board selection and confirmed Pin submission. The Pin card (ADRs 0780 to 0782) already
chooses the image, words and alternative text and checks them against Pinterest's requirements; cross-posting
already binds consent to a digest of exactly what is sent (ADR 0329).

## Decision

- **Opt-in configuration.** `syndication.pinterest` in `openblog.json`: `enabled` (must be `true`; absent or
  `false` means every `openblog pinterest` command refuses before reading a token or making a request),
  `environment` (`sandbox` by default, or `production`), `board` and `boardSection` (digits; `--board` and
  `--section` override them), and `stateFile` (default `.openblog/pinterest.json`, project-relative, never `..`).
  Values are checked by the command, so a mistake there never stops a build. Nothing else reads the block, so
  builds, feeds, exports and `openblog syndicate` are byte for byte the same with or without it.
- **The Pin plan is the card plus the board, and nothing is generated.** `openblog pinterest pin <slug>` builds the
  post's `pinterest-pin` card (the same code as `openblog card`) and turns it into the exact request: the board
  and section, the card's title, its description followed by the image credit the author recorded ("Image: …"),
  the image's own alternative text, the canonical address as `link`, and the image file's bytes. It prints that
  plan (text or `--json`, never the bytes) and its **Pin digest** (BLAKE2b, 128 bits, length-prefixed fields: the
  environment, board, section, source path, link, title, description, alternative text, media type, a digest of
  the image's bytes and the card digest). It sends nothing and creates no state.
- **A Pin is sent only when every check holds.** It is refused, with "No request was sent to Pinterest.", when the
  card is not `ready` (a `check` card is refused too: an image on another site cannot be sent as bytes, and a
  photograph that records where it was taken is never uploaded until the author removes the location), when the
  image is not a file the site serves, when the alternative text is missing, when the Pinterest manifest finds the
  request ineligible (ADR 0326: `link`, `text` and `image`, the description within 800 characters), when the
  canonical address is not a public web address, or when no board is chosen.
- **Confirmed submission.** `--write` requires `--confirm <digest>` equal to the digest the plan has now. Any change
  to the post, image file, board or words since the preview changes the digest and refuses the run before any
  request. The approvals file of ADR 0329 is not reused: it binds a cross-posting `DistributionPlan`, and one
  digest repeated on the command line binds a single Pin as strictly.
- **Authorized board selection.** `openblog pinterest boards` lists the boards the token can pin to
  (`GET /v5/boards`, page by page). Before a Pin is sent, the chosen board must be among them; otherwise the run
  stops after that read with "No Pin was sent." Secret boards are never listed, because open.blog does not ask for
  the secret scopes.
- **The image is sent as its bytes.** `media_source` is `image_base64` with the file's JPEG or PNG type, so Pinterest
  receives exactly the bytes previewed, whether or not the site is deployed yet, and open.blog never asks Pinterest
  to fetch a URL.
- **One Pin per post and board.** A private record keyed by environment, board and source path keeps each Pin's id
  and address; a post already pinned to a board is refused there.
- **The token stays out of everything.** It is read from `PINTEREST_ACCESS_TOKEN` only when a request is about to
  be made, sent only as the `Authorization` header, and never printed, recorded or included in an error.

## Considered options

- **`image_url` pointing at the published image.** Rejected: Pinterest would fetch whatever the URL serves at that
  moment, which may differ from the preview or not exist yet.
- **Reusing `openblog syndicate --approve`.** Rejected for now: a Pin is not an article copy and has no
  `DistributionPlan`; folding it in would change the cross-posting plan's shape for every existing user.
- **Letting `--write` send without a digest.** Rejected: the story asks for confirmed submission.

## Consequences

- An author sees, before anything is sent, exactly what a Pin will carry and where, and only that is sent.
- A sandbox Pin is visible only to the author; production must be chosen on purpose.
