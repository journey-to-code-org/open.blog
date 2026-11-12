# ADR 0360: A Mastodon announcement is one status with the link written into it, at the deployer's visibility, checked against the instance's own limits

- Status: Accepted
- Date: 2026-10-29
- Parent epic: [#382](https://github.com/journey-to-code-org/open.blog/issues/382)
- Story: #392 (tasks DIST2.2.2 and DIST2.2.3)

## Context

ADR 0359 connects a Mastodon account. The delivery worker calls a provider only through the adapter interface of
`social-delivery.mjs` (ADRs 0316 to 0319): `publish` resolves only for a success the provider confirmed and named,
everything else is a typed `DeliveryError`, and an optional `reconcile` looks an uncertain attempt up.

What Mastodon documents, checked on 2026-10-29:

- [Statuses](https://docs.joinmastodon.org/methods/statuses/): `POST /api/v1/statuses` takes `status`,
  `media_ids[]`, `visibility` (`public`, `unlisted`, `private`, `direct`), `language` and `spoiler_text`, and answers
  200 with the Status (its `id` and its `account`), 401 for a bad token and 422 for a refused one. The
  `Idempotency-Key` header "prevent[s] duplicate submissions of the same status"; keys are kept "for up to 1 hour".
  `GET /api/v1/statuses/:id/source` (3.5.0+, `read:statuses`) answers the status's plain `text`.
- [API guidelines](https://docs.joinmastodon.org/api/guidelines/): status `content` is sanitized HTML, never the text
  sent; "URLs in text always count for 23 characters"; ids are strings to be treated as opaque.
- [Instance](https://docs.joinmastodon.org/methods/instance/): the limits come from `GET /api/v2/instance`
  (`max_characters` 500 by default, `characters_reserved_per_url` 23, `description_limit` 1500, `image_size_limit`,
  `supported_mime_types`).
- [Media](https://docs.joinmastodon.org/methods/media/): `POST /api/v2/media` takes a multipart `file` and a plain
  `description` "for accessibility purposes", answers 200 when processed (small images, 4.0.0+) or 202 while still
  processing, and `GET /api/v1/media/:id` answers 206 until it is ready.
- [Accounts](https://docs.joinmastodon.org/methods/accounts/): `GET /api/v1/accounts/:id/statuses` takes `limit`
  (at most 40) and `exclude_reblogs`.
- [Rate limits](https://docs.joinmastodon.org/api/rate-limits/): 300 calls per 5 minutes per account,
  `POST /api/v1/media` 30 per 30 minutes; `X-RateLimit-Reset` is the time the limit resets.
- [PreviewCard](https://docs.joinmastodon.org/entities/PreviewCard/): the card Mastodon makes from a link has an
  `image` but no description of it.

## Decision

- **One status: the caption, a blank line, the canonical link.** Mastodon has no separate link field and makes its
  own preview card from a link in the text, so the adapter writes the canonical URL after the caption, unless the
  caption already holds that exact link as a word. Hashtags and `@user@instance` mentions in the caption are
  Mastodon's to read, as the author wrote them; the composer's preview says a mention notifies that person. No
  `language`, `spoiler_text` or poll is sent.
- **Visibility is the deployer's choice.** `OPENBLOG_SOCIAL_MASTODON_VISIBILITY` is `public` (the default),
  `unlisted` or `private` (followers only); anything else, `direct` included, keeps Mastodon off with the setting
  named. `direct` would message the people a caption mentions instead of announcing anything. A choice per
  announcement would need a new column; it is not made here.
- **Length as Mastodon counts it, against the instance's own limit.** The announcement model gives Mastodon a caption
  limit of 475 characters in both halves (`social_schedule.rs`, `social-schedule.mjs`, held to
  `tests/fixtures/social-schedule.json`): 500, the default status limit, less the blank line and the link counted as
  23. Admin's composer counts against 475. Before each post the adapter reads the instance's limits (public, no
  token; Mastodon's defaults when it does not answer) and counts the status as Mastodon does, every URL as
  `characters_reserved_per_url`; a status over `max_characters` is `rejected` without a call. Mentions are counted
  at full length, which is never short. The manifest declares `maxTextChars: 475` and the `oauth2` login with the two
  required scopes, in both halves and the fixture.
- **An Idempotency-Key per announcement.** Every attempt sends `Idempotency-Key: openblog-<48 hex>`, a SHA-256 of
  the announcement's idempotency key (never the key itself), so a repeat within Mastodon's hour returns the status
  already made instead of a second one. This narrows harm only: the worker still never retries an uncertain attempt
  blindly (ADR 0318).
- **The cover image, with its description, only when asked for and only when it has one.** With
  `OPENBLOG_SOCIAL_MASTODON_MEDIA=cover` the adapter reads the canonical page (the post's public page, without a
  token) for `og:image` and `og:image:alt`, which the engine writes from the post's `cover` and `coverAlt`. The image
  is attached only when it is `https` on the page's own origin, has a description of at most the instance's
  `description_limit` characters with no control characters, is a JPEG, PNG, WebP or GIF the instance takes, and is
  no larger than its `image_size_limit` or 8 MiB. It is uploaded with `POST /api/v2/media` and the description, and,
  if it answers 202, looked at twice more, half a second apart. Anything short of a ready upload leaves the image out
  and the status goes as text with Mastodon's own card; an image is never posted without its description. A 401 on
  the upload is `auth`. The cover gets at most 6 seconds; because the whole delivery shares one provider timeout,
  `cover` is refused (the settings are named and media stays off) unless `OPENBLOG_SOCIAL_PROVIDER_TIMEOUT_SECONDS`
  is at least 15. The manifest still says `image: manual`: an announcement cannot ask for an image of its own.
- **The status id is the provider post id.** A 200 counts only when it names an `id` of the opaque id shape and the
  status's `account.id` is the connected account; any other 2xx, a 3xx or a 5xx is `uncertain`. 401 is `auth` (the
  account is flagged for reconnecting, ADR 0319); 429 is `rate-limited`, honouring `Retry-After` and otherwise the
  ISO 8601 `X-RateLimit-Reset`; 422 and other 4xx are `rejected`. Mastodon's error text is never read.
- **Reconcile reads the account's own statuses back as text.** `reconcile` lists the account's latest 40 statuses
  (`exclude_reblogs`) and keeps those created during the attempt, give or take two minutes (up to 15 minutes when the
  attempt has no recorded end). Each one in the window, at most five, is read back with `/source`; exactly one whose
  text is the status this announcement sends is `published`. `absent` is conclusive only when the window holds no
  status of the account at all and the page reaches back past it. Anything else (two matches, a status that differs,
  more than five, a missing `read:statuses`, any failure) is `unknown`, which the worker keeps looking at and then
  hands to a person (ADR 0318).

## Consequences

- A long caption that fits the default 500 can still be refused by an instance with a lower limit; Admin says so when
  the account is connected (`instance-limit-low`) and the delivery is `rejected` without a call.
- An instance with a higher limit takes no more than 475 characters of caption from open.blog.
- With the cover on, Mastodon shows the image and its description instead of its link card; the link stays in the
  text. Without it, Mastodon's card shows the cover with no description, which is Mastodon's own behaviour.
- A post whose status was edited on Mastodon after it was sent, or that another app posted with the same text in the
  window, goes to a person rather than being guessed at.
