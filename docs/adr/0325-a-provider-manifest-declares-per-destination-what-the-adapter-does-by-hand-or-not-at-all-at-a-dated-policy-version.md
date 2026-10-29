# ADR 0325: A provider manifest declares, per destination, what the adapter does, what is by hand and what is not possible, at a dated policy version

- Status: Accepted
- Date: 2026-10-29
- Parent epic: [#381](https://github.com/journey-to-code-org/open.blog/issues/381)
- Story: #389 (task DIST1.1.1)

## Context

open.blog reaches other platforms through two seams that grew separately: cross-posting (`openblog syndicate`,
ADR 0004 and the destination policies in `openblog_core::portability`) sends a portable copy of the article to DEV,
Hashnode, Ghost, WordPress or a manual Medium import; social publishing (epic #353, ADRs 0293 to 0321) announces a
public post to LinkedIn or a Facebook Page through the hosted delivery worker. Epic #381 asks for one capability
contract that later distribution epics plan against: link, text, article, image, video, draft, schedule, login and
policy constraints, with a provider policy version, default-deny for anything unknown, and a guided manual workflow
where an API does not allow something. Neither existing seam can answer "can this destination take an image?" or
"does this run depend on facts that have since changed?".

## Decision

- **One manifest per provider, versioned twice.** `openblog_core::provider_manifest::ProviderManifest` carries
  `manifestVersion` (the format; this release reads `1` only), the `provider` (a closed list: `dev`, `hashnode`,
  `ghost`, `wordpress`, `medium`, `linkedin`, `facebook`), its `family` (`syndication` or `social`, fixed by the
  provider), a `label`, and a `policyVersion`: the day the facts were checked against the provider's own
  documentation, `YYYY-MM-DD` with an optional `.N` for a second change on one day. `sources` lists that
  documentation (`https` only).
- **Seven capabilities, three support levels, all declared.** `link`, `text`, `article`, `image`, `video`, `draft`,
  `schedule`. Each is `adapter` (this release's adapter does it through the provider's API), `manual` (the provider
  can do it, but only the author can, by hand, in the provider) or `unsupported`. A manifest must declare all seven.
  "Manual" is how an API that does not allow something becomes a guided workflow instead of a silent gap.
- **Login, limits and policy are facts, never secrets.** `login` names the method (`none`, `environment-credential`,
  `oauth2`) and, for OAuth, the scopes every connection asks for. `constraints` holds only provider limits that were
  verified (`maxTextChars`, `maxTags`, `maxTagNameChars`, `maxRequestBodyBytes`, `scheduleMinLeadSeconds`,
  `scheduleMaxHorizonSeconds`); `null` means none was verified and the caller's own limits still apply. `canonical`
  says how the canonical address travels (`sent`, `linked`, `manual`, `not-supported`); `publishing` what makes
  something public (`explicit-approval`, `draft-only`, `manual`).
- **Built from the existing seams, not beside them.** A syndication manifest takes its label, tag and body limits and
  its publishing rule from `destination_policy` (ADR 0004), so the two cannot drift. A social manifest takes its
  schedule window from the announcement model (`MIN_LEAD_SECONDS`, `MAX_HORIZON_SECONDS`, ADR 0308), because open.blog's
  queue, not the provider, schedules an announcement.
- **Verified facts as of 2026-10-29** (see [Provider capabilities](../provider-capabilities.md) for the table):
  - LinkedIn Posts API ([posts-api](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api),
    [post schema](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/post-api-schema)):
    images and video need an upload through the Images or Videos API first, so they are `manual` for this adapter;
    "PUBLISHED is the only accepted field during creation", so `draft` is `unsupported`; there is no scheduling
    field, so scheduling is open.blog's queue. The 3,000 character commentary limit is the one ADR 0308 holds captions to.
  - Facebook Pages API ([Pages posts](https://developers.facebook.com/docs/pages-api/posts)): `message` and `link` to
    `/{page-id}/feed` (this adapter); photos and video use other endpoints and permissions (`manual`); an unpublished
    post must carry `scheduled_publish_time` between 10 minutes and 30 days ahead, so `draft` is `unsupported`. No
    message limit was verified, so `maxTextChars` is `null` and the schema's caption bound applies.
  - DEV ([Forem API v1](https://developers.forem.com/api/v1#tag/articles)): `published: false` saves a draft and the
    request has no scheduling field (`schedule` `unsupported`); four tags.
  - WordPress ([posts](https://developer.wordpress.org/rest-api/reference/posts/)): `status` accepts `future`, but this
    adapter does not send it (`schedule` `manual`); core cannot record an external canonical (`not-supported`).
  - Ghost, Hashnode and Medium keep the facts and sources `docs/cross-posting.md` already verified; scheduling there
    was not re-verified and is declared `unsupported`, the conservative choice.
- **Fail closed on reading.** `ProviderManifest::from_json` / `from_value` read the format version first, then refuse
  the whole manifest on an unknown field anywhere, an unknown provider, capability, support level, login method or
  policy, a missing capability, a limit that is not a positive whole number, a non-`https` source, or facts that
  contradict each other (an adapter with no login, a manual import that claims an adapter, a draft-only destination
  without draft support, a social destination that claims a canonical copy, a schedule window that closes before it
  opens). Each refusal is a fixed code and sentence that never repeats the refused value.

## Considered options

- **Booleans per capability.** Rejected: "the provider can, but our adapter does not" is exactly what the epic means
  by a guided workflow, and a boolean loses it.
- **A manifest file the deployer edits.** Rejected for now: a manifest is a claim about this release's code, so it is
  code. The reader exists so that a later story can accept a third-party adapter's manifest under the same rules.
- **Separate manifests for cross-posting and social.** Rejected: later epics plan one distribution across both.

## Consequences

- Distribution planning (story #390) can ask one question of any destination and get a destination-specific answer.
- Adding a provider or a capability is a code change in both halves and the fixture (ADR 0327), on purpose.
- Static builds, feeds, exports and existing cross-posting output are unchanged: nothing in the build reads a manifest.
