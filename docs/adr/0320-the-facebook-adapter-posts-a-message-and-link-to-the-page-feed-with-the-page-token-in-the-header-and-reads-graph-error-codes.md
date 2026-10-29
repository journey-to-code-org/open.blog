# ADR 0320: The Facebook adapter posts a message and link to the Page feed with the Page token in the header and reads Graph error codes

- Status: Accepted
- Date: 2026-10-29
- Parent epic: [#353](https://github.com/journey-to-code-org/open.blog/issues/353)
- Story: #358 (task #374)

## Context

Facebook posts to a Page with that Page's own access token, found during discovery (ADR 0300) and stored sealed per
account (ADR 0295). Graph reports most failures as a 400 with an error code in the body, not as the HTTP status
that would explain them, and its answer to a successful post is a JSON object with an id.

## Decision

- **Same seam as LinkedIn (ADR 0319).** `publish(post, credentials)` with `credentials.accessToken` being the Page
  token, and the same result shape and conservative rules.
- **Request.** `POST {apiBase}/{pageId}/feed` (the Graph version is the configured setting) with a form body of
  `message` (the caption) and `link` (the canonical post). The token is sent as `Authorization: Bearer`, never as
  an `access_token` parameter, so it is in no URL or body that a proxy or access log could keep. Permissions are
  the ones discovery already verified (`pages_manage_posts`, and a role with `CREATE_CONTENT`); the adapter does
  not re-request them.
- **Published.** Only HTTP 200 with an `id` shaped `<pageId>_<postId>` for the same Page. Anything else that is 2xx
  is `unknown`.
- **Errors are read by Graph code, then by status.** `190` and `102` are `auth-rejected` (reauthorize); `10` and
  `200`-`299` are `permission-denied`; `4`, `17`, `32`, `341` and `613` are `throttled` and retryable; `1` and
  `2` ("an unknown error occurred") are `unknown`, because Graph can say that after creating the post. Other codes
  fall back to the HTTP status table of ADR 0319. The message, type, subcode and trace id are never copied.

## Considered options

- **`access_token` as a form field.** Rejected: it is what the Graph docs show, but the header is accepted and
  keeps the token out of anything that records bodies.
- **Treat every 400 as final.** Rejected: Graph returns throttles and expired tokens as 400 too, and they need
  opposite handling.

## Consequences

- Graph error codes are a small table in `social-publish.mjs`; a code Meta adds falls to the status table, which
  fails closed (final failure for 4xx, unknown for 5xx).
- A Page token does not expire, so `auth-rejected` normally means the author removed the app or lost the Page role.
