# Provider capabilities

open.blog can reach other platforms in two ways: [cross-posting](cross-posting.md) sends a portable copy of an
article (DEV, Hashnode, Ghost, WordPress, or a manual Medium import), and optional
[social publishing](social-publishing.md) announces a published post on LinkedIn or a Facebook Page. A third,
[Pinterest Pins](pinterest.md), sends a post's visual card to one of your boards. All are off until you set them
up, and your Markdown and your own site stay the original.

Each destination has a **provider manifest**: a short, versioned statement of what this release's adapter does
there. You do not edit it; it is part of the code, and it decides what open.blog will and will not attempt
(ADRs [0325](adr/0325-a-provider-manifest-declares-per-destination-what-the-adapter-does-by-hand-or-not-at-all-at-a-dated-policy-version.md),
[0326](adr/0326-an-adapter-is-used-only-under-a-manifest-that-reads-and-does-the-request-and-anything-unknown-fails-closed.md),
[0327](adr/0327-a-provider-upgrade-raises-the-policy-version-and-a-narrowing-change-voids-approvals-made-under-the-old-one.md)).

## What each word means

- **adapter**: open.blog does it for you through the provider's API, once you have opted in.
- **manual**: the provider can do it, but only you can, by hand, in the provider. open.blog says so instead of
  pretending.
- **unsupported**: neither open.blog nor a guided step can do it for this destination.

Anything open.blog does not recognise (a capability, a provider, a manifest format) is refused, never guessed at.

## The destinations (policy version 2026-10-29)

| Capability | DEV | Hashnode | Ghost | WordPress | Medium | LinkedIn | Facebook Page |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Link to your post | unsupported | unsupported | unsupported | unsupported | unsupported | adapter | adapter |
| Short text (caption) | unsupported | unsupported | unsupported | unsupported | unsupported | adapter | adapter |
| Whole article | adapter | adapter | adapter | adapter | manual | unsupported | unsupported |
| Images | adapter (hosted URLs) | adapter (hosted URLs) | adapter (hosted URLs) | adapter (hosted URLs) | manual | manual | manual |
| Video as video | unsupported | unsupported | unsupported | unsupported | unsupported | manual | manual |
| Remote draft | adapter | adapter | adapter | adapter | manual | unsupported | unsupported |
| Scheduled delivery | unsupported | unsupported | unsupported | manual | unsupported | adapter (open.blog's queue) | adapter (open.blog's queue) |
| Login | environment key | environment key | environment key | environment key | none | OAuth | OAuth |
| Canonical address | sent | sent | sent | not supported by core | set by hand | the post links it | the post links it |
| Becomes public | your approval | draft only | your approval | your approval | by hand | your approval | your approval |

Limits enforced before anything is sent: DEV takes 4 tags of at most 30 characters; Hashnode 15 tags and a request
of at most 100,000 bytes; a LinkedIn caption at most 3,000 characters. Announcements are scheduled between one
minute and one year and a day ahead. Video in an article becomes a link in the portable copy
([portable fallback](cross-posting.md)).

Pinterest (a Pin from `openblog pinterest`, [ADR 0783](adr/0783-pinterest-pins-are-a-social-destination-sent-from-the-cli-under-the-authors-own-oauth-token-sandbox-first.md)):
link, short text (the Pin's title and description), and one image are done by the adapter; video is by hand in
Pinterest; whole articles, remote drafts and scheduling are not possible. Login is OAuth (`boards:read`,
`boards:write`, `pins:read`, `pins:write`), the Pin links your post, and it becomes public only with your
confirmation. A description is at most 800 characters.

## What was checked, and where

Checked on 2026-10-29 against the providers' own documentation:

- LinkedIn: [Posts API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api)
  and [Post schema](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/post-api-schema).
  Images and video must be uploaded through LinkedIn's Images and Videos APIs first, which this adapter does not do;
  a post can only be created as `PUBLISHED`, so there are no remote drafts; there is no scheduling field, so
  open.blog's own queue schedules. Requests need `Linkedin-Version` (dated `YYYYMM`) and
  `X-Restli-Protocol-Version: 2.0.0`; LinkedIn retires each version about a year after release, so keep
  `OPENBLOG_SOCIAL_LINKEDIN_API_VERSION` current.
- Facebook: [Pages API posts](https://developers.facebook.com/docs/pages-api/posts). A post is a `message` and a
  `link` on the Page feed; photos and videos use other endpoints and permissions; an unpublished post must be
  scheduled between 10 minutes and 30 days ahead, so open.blog keeps scheduling in its own queue.
- DEV: [Forem API v1, articles](https://developers.forem.com/api/v1#tag/articles). `published: false` keeps a draft;
  there is no scheduling field.
- WordPress: [posts reference](https://developer.wordpress.org/rest-api/reference/posts/). `status` accepts
  `future`, which you can use in WordPress; open.blog sends drafts only unless you publish.
- Pinterest: the official [API v5 description](https://github.com/pinterest/api-description/blob/main/v5/openapi.json)
  (version 5.28.0), [access tiers](https://developers.pinterest.com/docs/key-concepts/access-tiers/) and
  [sandbox](https://dev.pinterest.com/docs/developer-tools/sandbox/). `POST /v5/pins` takes `board_id`, an optional
  `board_section_id`, `title` (100), `description` (800), `alt_text` (500), `link` (2,048) and a `media_source`
  (`image_base64` as JPEG or PNG, `image_url`, or video by a separately uploaded `video_id`); it has no draft or
  publishing-time field. The schema lists `boards:read`, `boards:write`, `pins:read` and `pins:write` for it.
  A new app gets Trial access, whose Pins and boards are sandbox entities visible only to their creator, through
  `api-sandbox.pinterest.com`; a sandbox token generated in the app console lasts 30 days and does not work in
  production. Pins visible to everyone need Standard access, which Pinterest grants after reviewing a video of
  the app. Trial apps are rate limited per app per day and Standard apps per user per minute; no numbers are
  published there, so open.blog only reports a rate limit when Pinterest returns one.
- Ghost, Hashnode and Medium: as verified for [cross-posting](cross-posting.md). Scheduling there was not
  re-verified, so it is listed as unsupported.

Recipe directories (Google Search recipe results, Pinterest, Foodgawker) have no adapter and no manifest here:
open.blog only prepares a package for them, and every capability is manual or unsupported in the same vocabulary.
Their dated facts and sources are listed in
[Preparing a recipe for recipe directories](content.md#preparing-a-recipe-for-recipe-directories).

## Seeing what each destination would receive

`openblog syndicate <slug> --preview <new folder>` writes each destination's exact copy and an accessible page
that checks it against these manifests, and `--approve` records your consent to exactly that plan. See
[Preview and approve before sending](cross-posting.md#preview-and-approve-before-sending).

## Images for a destination

What a Pinterest Pin or a shared link's preview would show of a post, and whether its image fits that destination,
is checked separately by `openblog card`; see [Visual cards](visual-cards.md).

## When a provider changes

A manifest change always raises its policy version. A change that only widens what an adapter does, loosens a limit
or updates documentation is *compatible*. A change that narrows a capability, tightens a limit, changes the login or
scopes, or changes how the canonical address or publishing works is *breaking*: anything you approved under the old
policy version must be previewed and approved again. If a social provider's manifest stops covering a link, a
caption and a scheduled time, the delivery worker registers no adapter for it and announcements wait in the queue
instead of being sent.

## For developers

- Rust: `openblog_core::provider_manifest` (`builtin_manifest`, `ProviderManifest::from_json`, `check`,
  `compatibility`, `approval_stands`).
- Hosted function: `netlify/lib/social-capabilities.mjs` (`parseManifest`, `checkRequest`, `admittedManifest`), used by
  `socialAdapters`, which puts the admitted manifest on each adapter as `manifest`.
- Both are held to `tests/fixtures/provider-manifests.json`:
  `cargo test -p openblog-core --test provider_manifest` and `node --test tests/web/social-capabilities.test.mjs`.
