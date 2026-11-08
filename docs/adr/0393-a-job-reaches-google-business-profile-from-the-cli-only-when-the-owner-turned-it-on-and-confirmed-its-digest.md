# ADR 0393: A job reaches Google Business Profile from the CLI only when the owner turned it on and confirmed its digest

- Status: Accepted
- Date: 2026-11-08
- Parent epic: [#475](https://github.com/journey-to-code-org/open.blog/issues/475)
- Story: #488 (task #522, TRADE5.1.1)

## Context

Story #488 asks that one finished job reach Google Business Profile, Facebook and Nextdoor with a preview and the
owner's consent. Task #522 asks for a Google Business Profile adapter under the provider capability contract
(ADRs 0325 to 0327) that fails closed on what it does not support, with a by-hand kit when API access is not
available. The issue says to check Google's API and approval rules at the time of building.

## What was checked (2026-11-08)

- [Prerequisites](https://developers.google.com/my-business/content/prereqs): the Business Profile APIs are not open
  to everyone. The applicant must manage a profile that has been verified and active for 60 days or more, create a
  Google Cloud project, and send Google's "Application for Basic API Access" form from an owner or manager address,
  then wait for Google's answer. Nobody working on open.blog has that approval, so no live post has been made.
- [localPosts](https://developers.google.com/my-business/reference/rest/v4/accounts.locations.localPosts) (API v4):
  a post has `summary` (its words), `topicType` (`STANDARD` for an ordinary update), an optional `callToAction`
  (`LEARN_MORE` with a `url` is a Learn more button) and `media`, where "sourceUrl is the only supported data field".
  [create](https://developers.google.com/my-business/reference/rest/v4/accounts.locations.localPosts/create) is
  `POST https://mybusiness.googleapis.com/v4/accounts/{account}/locations/{location}/localPosts`. There is no draft
  and no publishing time.
- The reference gives no length for `summary`, and [Google's help page on posts](https://support.google.com/business/answer/7662907)
  gives no photo rules. Posting tools hold the words to 1,500 characters and photos to JPEG or PNG of 10 KB to 5 MB
  and at least 250 by 250 pixels. These figures are not Google's own; open.blog keeps to them so that a post is not
  refused for its size.

## Decision

- `google-business-profile` is a social-family provider in the closed list (`ProviderId`, the JS reader and
  `tests/fixtures/provider-manifests.json`), policy version `2026-11-08`. Link, text and image are done by the
  adapter; article, video, remote draft and scheduling are unsupported; at most 1,500 characters; OAuth with
  `https://www.googleapis.com/auth/business.manage`. Since it schedules nothing, the hosted announcement worker
  never admits it (`admittedManifest` returns null), like Pinterest (ADR 0371).
- `openblog job-share <slug> --send google-business-profile --confirm <digest>` sends one `STANDARD` local post:
  the projection's words (ADR 0395), a Learn more button to the job's page, and the first after-photo by its public
  address. It sends only when `syndication.googleBusinessProfile.enabled` is true with the account and location
  numbers set, the token is in `GOOGLE_BUSINESS_ACCESS_TOKEN`, the preview has no blocking problem and the digest
  is the one previewed. The setting is absent by default, so nothing is sent unless the owner turns it on.
- The route follows the manifest: a job is sent only when every capability it needs is the adapter's. A capability
  done by hand sends the job to the kit; an unsupported one blocks it. A changed or broken manifest therefore turns
  sending off instead of guessing.
- The attempt is written to `.openblog/job-shares.json` before the request. Google's answer is read without
  copying its text: `200` with a post name is posted; `400`, `401`, `403`, `404`, `409`, `413`, `422` and `429` are
  not posted and may be sent again; no answer, a `5xx` or a `200` without a name may have posted, and the job is not
  sent again until the owner looks and runs `--forget-attempt`. The token is never printed, stored or put in a
  message.
- Every request goes through the syndication `Transport`; tests script Google's replies and never reach it.

## Consequences

- Owners without Google's approval, which is nearly all of them, use the kit (`--kit <new folder>`), which needs no
  account. The preview tells them sending is off and points to the kit.
- When someone has approval, a person should try one live post and update this ADR with what Google returned.
  Until then the adapter is proven only against scripted replies.
- The token is a short-lived access token the owner obtains; open.blog does not yet run Google's sign-in for this.
