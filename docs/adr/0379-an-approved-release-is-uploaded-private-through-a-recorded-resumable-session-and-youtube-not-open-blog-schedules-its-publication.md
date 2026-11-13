# ADR 0379: An approved release is uploaded private through a recorded resumable session, and YouTube, not open.blog, schedules its publication

- Status: Accepted
- Date: 2026-10-29
- Parent epic: [#386](https://github.com/journey-to-code-org/open.blog/issues/386)
- Story: #400 (task DIST6.2.2)

## Context

A published video cannot be taken back the way a page can (ADR 0377). An upload is long, can be interrupted, spends
a daily quota, and may finish without its reply reaching open.blog. The epic asks to verify resumable uploads, quota
and scheduling, and every external action must be opt-in, authorized and report a reliable state.

## Decision

- **An approval binds one preview and one file.** `openblog video <slug> --approve <digest>` records, in
  `.openblog/private/youtube/approvals.json`, the preview digest (ADR 0376), the canonical address, the size and
  BLAKE2b digest of the whole master file, the optional publication time and the whole manifest it was approved
  under. It sends nothing, and refuses a blocked release, a release with no file, a digest that is not the current
  one (`plan-changed`) and a canonical address that is not public `https` (`canonical-not-public`). Before any
  credential is read, `--upload` refuses with `not-approved`, `preview-changed`, `source-changed` (the file was
  replaced), `policy-changed` (ADR 0327), a publication time that has passed, or one now earlier than the article's date
  (`time-before-article`: the preview digest does not hold the date, so a post moved later after the approval is
  caught here), and refuses a draft post (`article-draft`).
- **Always private, scheduled by YouTube.** `videos.insert` receives the previewed title, description and tags,
  `privacyStatus: private`, the author's made-for-kids and altered-content answers, and, when approved with
  `--publish-at`, `publishAt`. The time must name its zone and be at least a minute and at most a year ahead (the same
  reader as announcements), and no earlier than the article's own date (`time-before-article`), so a video never goes
  public before the page it links. Without it the video stays private until the author publishes it in YouTube
  Studio. Source: [videos resource](https://developers.google.com/youtube/v3/docs/videos), checked 2026-10-29:
  `publishAt` can be set only on a private video that was never published, and an unset privacy status would default
  to public.
- **Resumable, in 8 MiB chunks, recorded before each step.** The session is opened with `X-Upload-Content-Length`
  and `X-Upload-Content-Type`; its address is followed only on `https://www.googleapis.com/upload/youtube/v3/videos?`
  (`session-unreadable` otherwise), so the access token never goes where a reply pointed. Every chunk but the last is
  a multiple of 256 KiB and is sent with `Content-Range`; a `308` reply's `Range` says how far it got. The private
  record (ADR 0380) is saved before every chunk, and before the last one it says the video may now exist. A lost
  reply or a `5xx` on a chunk is never answered by resending it: the session is asked (`Content-Range: bytes */total`)
  and the upload continues from what arrived. A session that ended before its last byte holds no video, so one new
  session is opened. A run that gets no answer stops with `provider-unavailable`, and the next `--upload` resumes the
  same session. Only one upload runs per project (a lock file). Source:
  [resumable upload protocol](https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol),
  checked 2026-10-29.
- **Quota and limits are states, not crashes.** Google's fixed `reason` codes decide, never its message:
  `quotaExceeded` is `quota-exceeded` (the project's quota resets at midnight Pacific Time,
  [quota costs](https://developers.google.com/youtube/v3/determine_quota_cost)), `uploadLimitExceeded` is
  `upload-limit-reached` (the channel's own daily limit, [errors](https://developers.google.com/youtube/v3/docs/errors)),
  and `429` and the rate-limit reasons are `rate-limited`; each keeps an open session to resume. A `401` refreshes the
  token once; `insufficientPermissions`, `youtubeSignupRequired` and a refused refresh (`invalid_grant`) ask the
  author to connect again. Any other refusal is `rejected` or `forbidden`, and nothing was created. On 2026-10-29
  [videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert) counted against a separate allowance
  of 100 uploads a day and [thumbnails.set](https://developers.google.com/youtube/v3/docs/thumbnails/set) cost about
  50 units of the 10,000-unit default ([getting started](https://developers.google.com/youtube/v3/getting-started));
  Google says these defaults may change, so open.blog reads the error rather than counting.
- **The thumbnail follows the video.** After the video exists, a local JPEG or PNG thumbnail (ADR 0377) is set with
  `thumbnails.set`; setting it again replaces it, so it is retried freely. A refusal (custom thumbnails need a
  verified channel) leaves the video uploaded and the thumbnail `failed`; the next `--upload` retries only it.
- **Caption uploads are separately opted in.** Amended for #623: after the video exists, a connection with the
  explicit caption-management grant sends each approved caption with its language via `captions.insert`. Each file's
  full digest is checked immediately before sending. The private record is marked unknown before the request;
  lost replies and conflicts are never automatically retried, while definite refusals can be retried alone.
  YouTube's acceptance is not proof that processing succeeded. Caption errors do not undo the video. The
  [caption insert reference](https://developers.google.com/youtube/v3/docs/captions/insert) and
  [API discovery document](https://www.googleapis.com/discovery/v1/apis/youtube/v3/rest), checked 2026-11-12,
  specify multipart media uploads, `youtube.force-ssl` and 400 quota units per insert.

## Considered options

- **Upload public, or follow a visibility the author chooses.** Rejected: a mistake would be public at once.
- **Schedule through open.blog's announcement queue.** Rejected: the queue runs in the hosted function, which has
  no file, and YouTube's own `publishAt` publishes without open.blog running.
- **Send the file in one request.** Rejected: an interruption would restart a multi-gigabyte upload, and a lost reply
  would leave nothing to ask.

## Consequences

- An interrupted upload continues where it stopped, in the same run or a later one, and is never sent twice.
- The author decides publication once, at approval; changing the time means approving again.
