# ADR 0371: Pinterest Pins are a social destination sent from the CLI under the author's own OAuth token, sandbox first

- Status: Accepted
- Date: 2026-10-29
- Parent epic: [#383](https://github.com/journey-to-code-org/open.blog/issues/383)
- Story: #394 (task DIST3.2.1)

## Context

Story #393 builds a post's Pinterest Pin card (ADRs 0368 to 0370) and sends nothing. Story #394 asks to connect
Pinterest and publish recipe and travel Pins, after verifying Pinterest's developer approval, boards, token and
Pin permissions. Epic #383 requires that unsupported API access becomes a guided workflow, that credentials never
reach a static bundle or a log, and that self-hosted static publishing is unchanged. The provider capability
contract (ADRs 0325 to 0327) is the place every destination states what open.blog does there.

## What was verified (2026-10-29)

- **The request.** Pinterest's official API description, version 5.28.0
  ([openapi.json](https://github.com/pinterest/api-description/blob/main/v5/openapi.json)): `POST /v5/pins` creates a
  Pin "on a board or board section owned by the operation user_account" from `board_id` (digits), optional
  `board_section_id`, `title` (at most 100 characters), `description` (800), `alt_text` (500), `link` (2,048) and a
  `media_source`: `image_base64` (`content_type` `image/jpeg` or `image/png`, and `data`), `image_url`, several
  images, or a `video_id` from a separate media upload. There is no draft or publishing-time field. It answers
  `201` with the Pin (`id`, digits, and the fields sent) or a `Pinterest.Lib.Error` (`code`, `message`) with
  `400`, `401`, `403`, `404` or `429`. The operation says it "is intended solely for publishing new content created
  by the user".
- **Boards.** `GET /v5/boards` lists the token owner's boards and the group boards they collaborate on, paged by
  `bookmark` (`page_size` at most 250); secret boards need the `boards:read_secret` scope, which open.blog does not
  ask for. `GET /v5/boards/{board_id}/pins` lists a board's Pins with `link`, `title` and `created_at`.
- **Permissions.** OAuth 2.0 (`https://www.pinterest.com/oauth/`, token at `/v5/oauth/token`). The schema lists
  `boards:read`, `boards:write`, `pins:read` and `pins:write` for creating a Pin (a Pinterest community report of
  April 2026 confirms the API refuses a Pin without `boards:write`).
- **Developer approval.** [Access tiers](https://developers.pinterest.com/docs/key-concepts/access-tiers/): an
  approved app starts with Trial access, and "all Pins and Boards created with Trial access are only visible to
  their creator as Sandbox entities"; Standard access, granted after Pinterest reviews a video of the app's
  authentication flow and integration, is needed for Pins others can see. Trial apps are rate limited per app per
  day, Standard apps per user per minute; no numbers are published there. The
  [sandbox](https://dev.pinterest.com/docs/developer-tools/sandbox/) is the same API at `api-sandbox.pinterest.com`;
  the app console generates a sandbox token that "lasts 30 days", and a sandbox token does not work in production
  nor a production token in the sandbox. Sandbox entities are separate from production ones: production boards
  are filtered out of `GET /v5/boards` there, and the way the sandbox page gives to get a sandbox board is
  `POST /v5/boards` on `api-sandbox.pinterest.com`, so a new sandbox token has no board until one is made that way.
  Collecting a person's password or session cookies instead of OAuth is
  grounds for refusing an app.

## Decision

- **Pinterest is a provider in the capability contract.** `pinterest`, family `social` (a Pin links the canonical
  post and carries no copy of the article, as an announcement does), label "Pinterest", login `oauth2` with the four
  scopes above, canonical `linked`, publishing `explicit-approval`. Capabilities: `link`, `text` and `image` by the
  adapter; `video` manual (Pinterest takes it, through an upload this adapter does not make); `article`, `draft`
  and `schedule` unsupported (the request has no such field). `maxTextChars` is 800, the description's limit; the
  title, alternative text and link limits are the card's own (ADR 0370). Both halves and the fixture hold it
  (ADR 0327); the hosted half reads it but never admits it as an announcement adapter, because it schedules
  nothing (ADR 0326).
- **Sent from the CLI, not the hosted worker.** A Pin is the author's explicit act on one built card
  (`openblog pinterest`, ADR 0372), like `openblog syndicate`. The hosted queue (ADRs 0316 to 0318) schedules a
  caption and a link, keeps no image, and would need a new hosted table for boards and image bytes; nothing in
  this story needs scheduling, so no hosted schema changes.
- **The author's own OAuth token, in the environment.** open.blog reads a Pinterest access token from
  `PINTEREST_ACCESS_TOKEN` and never stores, prints or logs it. The author obtains it through Pinterest's own OAuth
  for their app (the app console's "Generate token" for the sandbox, or Pinterest's authorization flow for
  production) with the four scopes. open.blog never asks for a Pinterest password or cookie. Running its own OAuth
  client and refresh is deferred to a hosted connection (a later story), so this release holds no client secret.
- **Sandbox first.** `syndication.pinterest.environment` is `sandbox` (the default, `api-sandbox.pinterest.com`,
  where Pins are visible only to the author) or `production` (`api.pinterest.com`), which the author sets on purpose
  once their app has Standard access. A sandbox Pin is reported as visible only to the author.
- **A sandbox board is a guided manual step.** Because pinterest.com boards are not visible in the sandbox,
  `openblog pinterest boards` with an empty sandbox prints the one `POST /v5/boards` request to make a sandbox
  board (naming `$PINTEREST_ACCESS_TOKEN`, never the token), and `docs/pinterest.md` gives the same step.
  open.blog does not make boards itself: that would be a second write path to confirm and test, for a one-time
  setup step. A `boards --create` command can be added later if authors need it.
- **Only the author's own published work.** A Pin is built only from a production-visible post's card, its image
  only from a file the site itself serves (ADR 0372), which keeps within "new content created by the user".

## Considered options

- **A hosted connection through the existing social OAuth (ADRs 0295, 0299).** Deferred: it would give Pinterest a
  sealed, refreshable grant, but needs an additive hosted schema for boards and Pin attempts and a place for image
  bytes. The CLI path proves the contract first and changes no hosted state.
- **A new family `visual`.** Rejected: the existing rules (a linked canonical, no article copy) fit a Pin, and a new
  family would widen a closed contract both halves must read.
- **Default to production.** Rejected: an app without Standard access cannot publish there, and the sandbox lets an
  author try a Pin without anyone seeing it.

## Consequences

- `ProviderId::ALL` includes Pinterest; the fixture and `docs/provider-capabilities.md` list it.
- No static build, feed, export, cross-posting plan or hosted route reads the Pinterest manifest or token.
