# ADR 0375: YouTube is a video-family provider, declared as a guided workflow until an adapter uploads

- Status: Accepted; the guided-workflow manifest is superseded by ADR 0378 (story #400)
- Date: 2026-10-29
- Parent epic: [#386](https://github.com/journey-to-code-org/open.blog/issues/386)
- Story: #399 (task DIST6.1.2)

## Context

The provider capability contract (ADRs 0325 to 0327) has a closed list of providers in two families: `syndication`
(a portable copy of the article) and `social` (an announcement linking the canonical post). Epic #386 adds YouTube,
which is neither: the destination receives a video the author made, and its description links the canonical article.
Story #399 prepares the release; story #400 uploads it. The YouTube preview (ADR 0376) must still be checked against
a manifest, like every other destination (ADR 0328), and a guided workflow must be declared rather than implied.

## Decision

- **A third family, `video`.** `ProviderId::Youtube` (`youtube`) belongs to `Family::Video`. Both halves of the
  contract (`openblog_core::provider_manifest` and `netlify/lib/social-capabilities.mjs`) read it; the hosted
  function never admits a video manifest as a social adapter, because `admittedManifest` requires `social`.
- **A video destination links the canonical post.** As for `social`, a `video` manifest whose `canonical` is not
  `linked` is inconsistent and refused.
- **The shipped YouTube manifest (policy 2026-10-29) is a guided workflow.** `video`, `text`, `link`, `image`
  (thumbnail), `draft` (a private upload) and `schedule` (`publishAt`) are `manual`: YouTube can do each, but in this
  release only the author does, in YouTube Studio. `article` is `unsupported`. `login` is `none` and `publishing` is
  `manual`, because nothing is sent. No generic constraint applies (YouTube's limits are a title in characters, a
  description in bytes and tags in total characters), so all are `null` and the release checks them itself
  (ADR 0376).
- **Sources, checked on 2026-10-29:** the [videos resource](https://developers.google.com/youtube/v3/docs/videos),
  [videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert),
  [thumbnails.set](https://developers.google.com/youtube/v3/docs/thumbnails/set),
  [captions.insert](https://developers.google.com/youtube/v3/docs/captions/insert) and the
  [chapters help page](https://support.google.com/youtube/answer/9884579).
- **The fixture holds it.** `tests/fixtures/provider-manifests.json` gains the manifest, three refused variants (a
  canonical copy, the wrong family, an adapter in a manual workflow) and two request checks.

## Considered options

- **YouTube as a `social` provider.** Rejected: the social family means "an announcement the queue delivers", and
  the hosted worker would then consider it for announcements.
- **No manifest until the adapter exists.** Rejected: the preview would then be the only destination not checked
  against one, and story #400 would add the provider and the adapter in one step, hiding the policy change.

## Consequences

- Story #400 raises the policy version and moves capabilities to `adapter` with OAuth scopes. Under ADR 0327 that is
  a breaking change (`login-changed`), so nothing approved under the guided workflow is carried over silently.
- Every other provider's manifest, and every existing preview, plan and approval, is unchanged.
