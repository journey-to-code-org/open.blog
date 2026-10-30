# Provider capabilities

open.blog can reach other platforms in two ways: [cross-posting](cross-posting.md) sends a portable copy of an
article (DEV, Hashnode, Ghost, WordPress, or a manual Medium import), and optional
[social publishing](social-publishing.md) announces a published post on LinkedIn or a Facebook Page. A third,
[community submissions](community-submissions.md), prepares a post for you to submit by hand to Hacker News or a
Reddit community. All three are off until you set them up, and your Markdown and your own site stay the original.

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

Hacker News and Reddit are *community* destinations (policy version 2026-10-29,
[ADR 0800](adr/0800-hacker-news-and-reddit-are-community-destinations-whose-manifests-say-the-author-submits-by-hand.md)):
the link is **manual** (you submit it yourself on the community's own form) and every other capability is
**unsupported**; there is no login and nothing becomes public except by your own submission. A community manifest that
claims anything open.blog would do there is refused. Their title limits and rules are in
[Community submissions](community-submissions.md#what-was-checked-and-where-2026-10-29).

Limits enforced before anything is sent: DEV takes 4 tags of at most 30 characters; Hashnode 15 tags and a request
of at most 100,000 bytes; a LinkedIn caption at most 3,000 characters. Announcements are scheduled between one
minute and one year and a day ahead. Video in an article becomes a link in the portable copy
([portable fallback](cross-posting.md)).

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
- Ghost, Hashnode and Medium: as verified for [cross-posting](cross-posting.md). Scheduling there was not
  re-verified, so it is listed as unsupported.

## Seeing what each destination would receive

`openblog syndicate <slug> --preview <new folder>` writes each destination's exact copy and an accessible page
that checks it against these manifests, and `--approve` records your consent to exactly that plan. See
[Preview and approve before sending](cross-posting.md#preview-and-approve-before-sending).

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
