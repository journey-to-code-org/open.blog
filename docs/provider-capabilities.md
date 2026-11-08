# Provider capabilities

open.blog can reach other platforms in five ways: [cross-posting](cross-posting.md) sends a portable copy of an
article (DEV, Hashnode, Ghost, WordPress, or a manual Medium import), and optional
[social publishing](social-publishing.md) announces a published post on LinkedIn, a Facebook Page, Bluesky or Mastodon. A third,
[community submissions](community-submissions.md), prepares a post for you to submit by hand to Hacker News, a
Reddit community or Product Hunt. A fourth, [Pinterest Pins](pinterest.md), sends a post's visual card to one of
your boards. A fifth, a [video release](video-production.md#prepare-a-youtube-release), prepares a video post's
YouTube upload and, once you connect a channel and approve it, uploads it. All five are off until you set them up,
and your Markdown and your own site stay the original.

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

## The destinations (policy version 2026-10-29; YouTube 2026-10-29.2)

| Capability | DEV | Hashnode | Ghost | WordPress | Medium | LinkedIn | Facebook Page | Bluesky | Mastodon | YouTube |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Link to your post | unsupported | unsupported | unsupported | unsupported | unsupported | adapter | adapter | adapter (link card) | adapter (in the text) | adapter (in the description) |
| Short text (caption) | unsupported | unsupported | unsupported | unsupported | unsupported | adapter | adapter | adapter | adapter | adapter (title and description) |
| Whole article | adapter | adapter | adapter | adapter | manual | unsupported | unsupported | unsupported | unsupported | unsupported |
| Images | adapter (hosted URLs) | adapter (hosted URLs) | adapter (hosted URLs) | adapter (hosted URLs) | manual | manual | manual | manual | manual (the deployer may attach the cover, with its description) | adapter (thumbnail) |
| Video as video | unsupported | unsupported | unsupported | unsupported | unsupported | manual | manual | manual | manual | adapter (uploaded private) |
| Remote draft | adapter | adapter | adapter | adapter | manual | unsupported | unsupported | unsupported | unsupported | adapter (a private upload) |
| Scheduled delivery | unsupported | unsupported | unsupported | manual | unsupported | adapter (open.blog's queue) | adapter (open.blog's queue) | adapter (open.blog's queue) | adapter (open.blog's queue) | adapter (`publishAt`, kept by YouTube) |
| Login | environment key | environment key | environment key | environment key | none | OAuth | OAuth | app password | OAuth (one instance) | OAuth (on your computer) |
| Canonical address | sent | sent | sent | not supported by core | set by hand | the post links it | the post links it | the post links it | the post links it | the description links it |
| Becomes public | your approval | draft only | your approval | your approval | by hand | your approval | your approval | your approval | your approval | your approval (private until `--publish-at` or by hand) |

Hacker News and Reddit are *community* destinations (policy version 2026-10-29,
[ADR 0337](adr/0337-hacker-news-and-reddit-are-community-destinations-whose-manifests-say-the-author-submits-by-hand.md)):
the link is **manual** (you submit it yourself on the community's own form) and every other capability is
**unsupported**; there is no login and nothing becomes public except by your own submission. A community manifest that
claims anything open.blog would do there is refused. Their title limits and rules are in
[Community submissions](community-submissions.md#what-was-checked-and-where-2026-10-29). Product Hunt is a community
destination too
([ADR 0341](adr/0341-product-hunt-is-a-community-destination-whose-launch-the-maker-enters-and-submits-by-hand.md)):
its link, text, images, video, draft and launch day are all **manual**, because the maker enters each in Product
Hunt's own form, and it has no login; see [Product Hunt launch kits](community-submissions.md#product-hunt-launch-kits).

Limits enforced before anything is sent: DEV takes 4 tags of at most 30 characters; Hashnode 15 tags and a request
of at most 100,000 bytes; a LinkedIn caption at most 3,000 characters; a Bluesky caption at most 300; a Mastodon caption at most 475, and the whole status within the instance's own limit. Announcements are scheduled between one
minute and one year and a day ahead. Video in an article becomes a link in the portable copy
([portable fallback](cross-posting.md)).

Pinterest (a Pin from `openblog pinterest`, [ADR 0371](adr/0371-pinterest-pins-are-a-social-destination-sent-from-the-cli-under-the-authors-own-oauth-token-sandbox-first.md)):
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
- Bluesky: the [post record](https://github.com/bluesky-social/atproto/blob/main/packages/api/lexicons/app/bsky/feed/post.json)
  takes at most 300 graphemes (and 3,000 bytes) of text, links and hashtags as facets in UTF-8 byte offsets, and one
  embed; the link travels as an `app.bsky.embed.external` card ([posts guide](https://docs.bsky.app/docs/advanced-guides/posts)).
  Images need a blob upload first, which this adapter does not do; there are no remote drafts and no scheduling
  field, so open.blog's queue schedules. Login is an AT Protocol session from an app password
  ([XRPC](https://atproto.com/specs/xrpc)); creating a record costs 3 of 5,000 points an hour and 35,000 a day, and
  signing in is limited to 30 per 5 minutes and 300 a day per account
  ([rate limits](https://docs.bsky.app/docs/advanced-guides/rate-limits)).
- Mastodon: a [status](https://docs.joinmastodon.org/methods/statuses/) is one text, with the link written into it
  (every URL counts as 23 characters, [guidelines](https://docs.joinmastodon.org/api/guidelines/)) and a visibility
  of `public`, `unlisted`, `private` or `direct`; an `Idempotency-Key` header is honoured for an hour. A default
  instance takes 500 characters, and each instance says its own limits at
  [`/api/v2/instance`](https://docs.joinmastodon.org/methods/instance/). Images are uploaded first with a plain-text
  description ([media](https://docs.joinmastodon.org/methods/media/)); the adapter can attach the post's cover that
  way when the deployer turns it on, but an announcement cannot ask for an image of its own, so images stay
  `manual`. There are no remote drafts, and open.blog's queue schedules. Login is OAuth 2 against one instance with
  granular scopes ([OAuth](https://docs.joinmastodon.org/methods/oauth/)); 300 calls per 5 minutes per account, media
  uploads 30 per 30 minutes ([rate limits](https://docs.joinmastodon.org/api/rate-limits/)).
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
- YouTube: [videos resource](https://developers.google.com/youtube/v3/docs/videos),
  [videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert),
  [thumbnails.set](https://developers.google.com/youtube/v3/docs/thumbnails/set),
  [captions.insert](https://developers.google.com/youtube/v3/docs/captions/insert) and
  [chapters](https://support.google.com/youtube/answer/9884579). A title takes at most 100 characters and a
  description 5,000 bytes, neither with `<` or `>`; tags take 500 characters in all; chapters need three or more,
  the first at `00:00`, each at least ten seconds. Uploads use the
  [resumable upload protocol](https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol),
  start private, and may carry `publishAt` only while private; quota errors are read from
  [the API errors](https://developers.google.com/youtube/v3/docs/errors) and reset at midnight Pacific Time
  ([quota costs](https://developers.google.com/youtube/v3/determine_quota_cost)). Captions need a scope that manages
  the whole account, so they stay by hand in YouTube Studio. The login is
  [OAuth for desktop apps](https://developers.google.com/identity/protocols/oauth2/native-app) with your own client
  (ADRs [0375](adr/0375-youtube-is-a-video-family-provider-declared-as-a-guided-workflow-until-an-adapter-uploads.md),
  [0376](adr/0376-a-youtube-preview-is-the-exact-metadata-with-the-canonical-article-link-checked-against-youtubes-rules.md),
  [0378](adr/0378-youtube-uploads-use-the-deployers-own-google-client-a-loopback-pkce-grant-and-a-refresh-token-protected-on-the-authors-machine.md),
  [0379](adr/0379-an-approved-release-is-uploaded-private-through-a-recorded-resumable-session-and-youtube-not-open-blog-schedules-its-publication.md)).
- Ghost, Hashnode and Medium: as verified for [cross-posting](cross-posting.md). Scheduling there was not
  re-verified, so it is listed as unsupported.

Recipe directories (Google Search recipe results, Pinterest, Foodgawker) have no adapter and no manifest here:
open.blog only prepares a package for them, and every capability is manual or unsupported in the same vocabulary.
Pinterest is in both places on purpose, as two separate things: the recipe directory is Pinterest reading your
page's recipe data when you save a Pin from it yourself (`openblog export --format recipe-package --directory
pinterest`), while the Pinterest destination above is `openblog pinterest` sending a post's visual card as a Pin
with your own token. Neither uses the other.
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
  `compatibility`, `approval_stands`); `openblog_core::community_submission` checks the community manifests before it
  prepares a kit.
- Hosted function: `netlify/lib/social-capabilities.mjs` (`parseManifest`, `checkRequest`, `admittedManifest`), used by
  `socialAdapters`, which puts the admitted manifest on each adapter as `manifest`.
- Both are held to `tests/fixtures/provider-manifests.json`:
  `cargo test -p openblog-core --test provider_manifest` and `node --test tests/web/social-capabilities.test.mjs`.
