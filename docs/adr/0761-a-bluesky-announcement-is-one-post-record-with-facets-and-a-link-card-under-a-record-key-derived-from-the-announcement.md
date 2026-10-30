# ADR 0761: A Bluesky announcement is one post record with facets and a link card, under a record key derived from the announcement

- Status: Accepted
- Date: 2026-10-29
- Parent epic: [#382](https://github.com/journey-to-code-org/open.blog/issues/382)
- Story: #391 (task DIST2.1.2)

## Context

ADR 0760 connects a Bluesky account. The delivery worker calls a provider only through the adapter interface of
`social-delivery.mjs` (ADRs 0316 to 0319): `publish` resolves only for a success the provider confirmed and named,
everything else is a typed `DeliveryError`, and an optional `reconcile` looks an uncertain attempt up. LinkedIn
and Facebook honour no idempotency key, so an uncertain attempt there can only be looked up by content (ADR 0320) or
handed to a person.

What Bluesky's records require, checked on 2026-10-29 against the lexicons and guides:

- [`app.bsky.feed.post`](https://github.com/bluesky-social/atproto/blob/main/packages/api/lexicons/app/bsky/feed/post.json):
  `text` (at most 3,000 bytes and 300 graphemes) and `createdAt` are required; the record key type is `tid`;
  `embed` is one of images, video, external, record; `facets` annotate the text.
- [`app.bsky.richtext.facet`](https://github.com/bluesky-social/atproto/blob/main/packages/api/lexicons/app/bsky/richtext/facet.json):
  `byteStart` inclusive, `byteEnd` exclusive, "counting bytes of the UTF-8 encoded text"; features `#link` (a full
  URI), `#tag` (without the `#`, at most 64 graphemes) and `#mention` (a DID).
- [`app.bsky.embed.external`](https://github.com/bluesky-social/atproto/blob/main/packages/api/lexicons/app/bsky/embed/external.json):
  `uri`, `title` and `description` are required; `thumb` is an uploaded blob of at most 1,000,000 bytes.
- [`com.atproto.repo.createRecord`](https://github.com/bluesky-social/atproto/blob/main/lexicons/com/atproto/repo/createRecord.json):
  takes `repo`, `collection`, an optional `rkey` and the `record`, and answers `uri` and `cid`.
  [`getRecord`](https://github.com/bluesky-social/atproto/blob/main/lexicons/com/atproto/repo/getRecord.json)
  reads one record by repo, collection and key, with the error `RecordNotFound`.
- The [posts guide](https://docs.bsky.app/docs/advanced-guides/posts) shows link cards and facets built by the
  client: the service does not detect links or fetch a card for you.
- XRPC errors are JSON `{ error, message }`; an expired access token answers `ExpiredToken` (HTTP 400); a limit
  answers HTTP 429 ([XRPC](https://atproto.com/specs/xrpc), [rate limits](https://docs.bsky.app/docs/advanced-guides/rate-limits)).

## Decision

- **One record, written by the adapter.** `publish` sends one `createRecord` of an `app.bsky.feed.post` to the
  connected account's own repository (`repo` is the account's DID): `text` is the stored caption, `createdAt` the
  moment of the attempt, and `embed` an `app.bsky.embed.external` card whose `uri` is the canonical post, `title` the
  caption's first line (plain, at most 300 characters) and `description` empty. No thumbnail is uploaded (images are
  `manual` in the manifest), and the post text does not repeat the link: the card carries it.
- **Facets for links and hashtags, never mentions.** Full `http(s)://` links and `#hashtags` in the caption become
  `#link` and `#tag` facets at UTF-8 byte offsets; sentence punctuation at the end of a link is left out of its
  facet, a link with credentials is not linked, and an all-digit `#2026` is not a tag. `@handles` stay plain text: a
  mention needs the handle resolved to a DID, and a wrong one would notify a stranger.
- **The caption limit is Bluesky's.** The announcement model gives Bluesky a caption limit of 300 characters in both
  halves (`social_schedule.rs`, `social-schedule.mjs`, held to `tests/fixtures/social-schedule.json`). Characters
  (code points) are never fewer than graphemes, and 300 of them are at most 1,200 bytes, so a caption Admin accepts is
  always within Bluesky's limits; the adapter checks graphemes and bytes again before sending. The Rust Admin checks
  a new or edited caption before it knows the account's provider, so it now accepts one that *some* destination
  takes (`check_caption_for_any`, formerly every destination), and the hosted function, which resolves the account,
  applies that destination's own limit; the composer counts against the chosen destination's limit as you type. The manifest declares
  `maxTextChars: 300` and the new `app-password` login method (ADR 0760) in both halves and the fixture.
- **A record key per announcement.** The record key is a TID (atproto's 13-character timestamp identifier) made from
  the announcement's scheduled instant (milliseconds, plus three digits of microseconds) and a 10-bit clock id, the
  extra bits taken from a SHA-256 of its idempotency key. Every attempt of one announcement names the same record:
  if an attempt that looked uncertain did land, a later write of the same key is refused by the repository instead of
  posting twice. The worker gives adapters the announcement's `scheduledFor` for this. The idempotency key itself is
  never sent.
- **The at:// URI is the provider post id.** A 200 counts only when the service names exactly
  `at://<did>/app.bsky.feed.post/<key>` with a `cid`; any other 2xx, a 3xx or a 5xx is `uncertain`. 401, or 400 or 403
  with `ExpiredToken`, `InvalidToken`, `AuthenticationRequired` or `AuthMissing`, is `auth` (the account is flagged
  for reconnecting, ADR 0319); 429 or `RateLimitExceeded` is `rate-limited`, honouring `Retry-After` and otherwise
  `RateLimit-Reset` (an epoch second, or a small number of seconds); other 4xx are `rejected`. The service's message
  is never read.
- **Reconcile reads that one record.** `reconcile` calls `getRecord` for the announcement's key. It is `published`
  only when the record is there, is a post, and holds exactly the caption and the canonical link; `RecordNotFound`
  is a conclusive `absent` (the key is this announcement's alone); anything else is `unknown`, which the worker keeps
  looking at and then hands to a person (ADR 0318).

## Consequences

- An uncertain Bluesky attempt is settled by a lookup that cannot match another post, and a retry after a wrong
  "absent" cannot duplicate the post, unlike the content matching LinkedIn and Facebook need.
- Two announcements of one account would need the same scheduled millisecond and the same 20 bits of hash to share a
  key; the second would then be refused, never written over the first.
- The card has no image and an empty description; Bluesky shows the title and the link's domain. Adding a thumbnail
  (an `uploadBlob` of the post's social image) is a later, separate change to the manifest's `image` support.
- Mentions, language tags (`langs`) and self-labels are not sent.
