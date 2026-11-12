# ADR 0378: YouTube uploads use the deployer's own Google client, a loopback PKCE grant and a refresh token protected on the author's machine

- Status: Accepted
- Date: 2026-10-29
- Parent epic: [#386](https://github.com/journey-to-code-org/open.blog/issues/386)
- Story: #400 (task DIST6.2.1)

## Context

Story #399 made YouTube a guided workflow (ADR 0375): open.blog prepared the release and the author uploaded it by
hand. Story #400 publishes approved video assets. The master file is a project file kept out of the published
folders (ADR 0377) and may be many gigabytes, so it lives where the author runs `openblog`, not in the hosted
function: a Netlify function has neither the file nor the time to send it. The social adapters' grant is sealed in
the hosted database (ADRs 0295, 0299) because the hosted worker posts on a schedule; nothing hosted takes part in a
video upload. Google requires every API project to be the deployer's own, and lets a user grant only some of the
scopes asked for.

## Decision

- **Off until two opt-ins.** Uploading needs `OPENBLOG_YOUTUBE_CLIENT_ID` (and `OPENBLOG_YOUTUBE_CLIENT_SECRET` when
  the client has one): the deployer's own Google OAuth client of the Desktop app type, read from the environment,
  never from the project or a bundle. Then `openblog youtube connect` makes the grant. Without either, `--upload`
  stops with `youtube-not-configured` or `youtube-not-connected`, says nothing was sent, and points at the guided
  workflow, which keeps working unchanged.
- **Installed-app authorization.** `connect` listens on `127.0.0.1` at a free port, prints Google's authorization
  address with PKCE (`S256`, a fresh 256-bit verifier) and a fresh `state`, accepts only a reply on `/` carrying that
  `state` (`state-mismatch` otherwise, nothing stored), and exchanges the code once (a lost reply is not retried).
  It waits five minutes at most. Source:
  [OAuth 2.0 for iOS & Desktop Apps](https://developers.google.com/identity/protocols/oauth2/native-app), checked
  2026-10-29: loopback redirect, PKCE, refresh tokens are always returned for installed apps, the `scope` field says
  what was granted, `invalid_grant` means the grant is gone, and `https://oauth2.googleapis.com/revoke` revokes it.
- **Two scopes, all or nothing.** `youtube.upload` (create the video and set its thumbnail) and `youtube.readonly`
  (list the channel's own uploads when an outcome is unknown, ADR 0380). Uploading captions needs
  `youtube.force-ssl`, which also manages the whole account, so open.blog does not ask for it and captions stay a
  step in YouTube Studio (the preview says so with the note `captions-by-hand`). If the reply lacks either scope or a
  refresh token, the token is revoked and nothing is stored (`scope-missing`).
- **Protected refresh token on the author's machine.** The grant (refresh token, scopes, a fingerprint of the
  client id, the time) is written to `.openblog/private/youtube/credential` the way the Assistant's key is: Windows
  DPAPI for the signed-in user, owner-only permissions elsewhere, under the Git-ignored `.openblog/` folder. The
  access token is refreshed for each run and lives only in memory. A grant made for another client id is never used
  (`client-changed`). `openblog youtube disconnect` revokes the grant at Google and removes the file even when
  Google cannot be reached, then says where to revoke by hand. `openblog youtube status` shows the state and sends
  nothing.
- **The manifest moves to an adapter (policy `2026-10-29.2`).** `video`, `text`, `link`, `image`, `draft` and
  `schedule` become `adapter`, login becomes `oauth2` with the two scopes, and publishing becomes
  `explicit-approval`. As ADR 0375 foresaw, the login change is breaking (ADR 0327), so nothing approved under the
  guided workflow is carried over. A manifest scope may now be a URL, because Google spells scopes that way: both
  halves of the contract accept `/` in a scope. The fixture's refused case for the video family is now an adapter
  that names no login.

## Considered options

- **Upload from the hosted function with the grant in the hosted database.** Rejected: the file is on the author's
  machine, a video is far beyond a function's request size and time, and the scheduled queue is not needed because
  YouTube schedules publication itself (ADR 0379).
- **Ask for `youtube` or `youtube.force-ssl` to upload captions too.** Rejected: either lets open.blog manage the
  whole channel, which is far more than publishing one release needs.
- **A plain-text token file.** Rejected: it is the one secret that can publish under the author's name.

## Consequences

- No hosted schema changes, and no credential reaches a build, a feed, an export, a log or an error.
- On a computer other than the one that connected, the author connects again.
