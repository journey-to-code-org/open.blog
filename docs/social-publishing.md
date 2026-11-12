# Scheduled social publishing (optional)

Social publishing announces an already-published post on a connected LinkedIn identity, Facebook Page, Bluesky
account or Mastodon account, at a time you choose. It is off by default. Your site, its exports and cross-posting work exactly the same without it,
and nothing in this guide is needed to read, build or publish a blog.

This page covers the identity and storage foundation (epic #353, story #354), scheduling announcements (story
#356), the delivery queue and worker (story #357), the LinkedIn and Facebook adapters (story #358), and delivery
status, monitoring and operations (story #359), how to roll it out, roll it back, rotate its secrets and find
what went wrong (story #360), and Bluesky and Mastodon (epic #382, stories #391 and #392). If you only want
the order of things, start at [Rolling it out, step by step](#rolling-it-out-step-by-step).

## Who is allowed to do what

Nothing in a browser talks to Supabase. The flow is:

1. You sign in to Admin as usual. Admin checks its own session and CSRF token on every route and denies by default.
2. Admin calls the hosted social function with a server-held key and names the signed-in Admin user in the
   `X-OpenBlog-Actor` header. That name is recorded for audit; it grants nothing.
3. The hosted function holds the Supabase `service_role` key. It acts for exactly one site, `OPENBLOG_SITE_ID`,
   and refuses any request that names a site.

The scheduled worker uses a different key and acts as `@worker`. A leaked worker key can never act as an author.

## Settings (hosted function only)

| Variable | Purpose |
| --- | --- |
| `OPENBLOG_SOCIAL_ENABLED` | Must be exactly `true`. Anything else and the routes answer 404. |
| `SUPABASE_URL` | `https://` project origin, no path or credentials. |
| `SUPABASE_SECRET_KEY` | The `service_role`/secret key. Server only. |
| `OPENBLOG_SITE_ID` | The site scope: 1 to 80 of `A-Z a-z 0-9 . _ -`, starting with a letter or digit. |
| `OPENBLOG_SOCIAL_ADMIN_KEY` | At least 32 characters; used by the Rust Admin. |
| `OPENBLOG_SOCIAL_WORKER_KEY` | At least 32 characters; used by the scheduled worker. Differs from the admin key. |
| `OPENBLOG_SOCIAL_TOKEN_KEYS` | Token encryption keys, `id:base64` of 32 random bytes, comma separated; the first encrypts new tokens. Required. |

Neither key may equal the Supabase key (`SUPABASE_SECRET_KEY`, or the legacy `SUPABASE_SERVICE_ROLE_KEY`), the
Admin API key (`OPENBLOG_ADMIN_API_KEY`) or an anon or publishable key (`SUPABASE_ANON_KEY`,
`SUPABASE_PUBLISHABLE_KEY`); the function reads those only to compare. If the feature is enabled
but something is wrong, it stays off and the log names the settings at fault, never their values.
Never put any of these in `openblog.json`, the repository or a browser bundle.

## The hosted tables

Run `supabase/social.sql` once in the Supabase SQL editor, only if you opt in. It is additive, can be run twice
safely, and creates `openblog_social_accounts`, `openblog_social_posts` (the schedule queue),
`openblog_social_attempts` (delivery history), `openblog_social_credentials` (encrypted tokens) and
`openblog_social_schema` (the schema version). All of them are private: row level security is on with no
policies, the public roles have no access, and only the hosted function (`service_role`) reads and writes. Every
row carries your site scope and relations include it, so a row cannot point at another site's account or post.
Nothing is deleted by the function: cancelling and disconnecting are updates. The only exception is retention, which
you turn on yourself (see the [operations runbook](#retention-optional-deletes-data)).

To undo it, remove `OPENBLOG_SOCIAL_ENABLED`, stop the worker, export what you want to keep (the commands are in
the file) and run `supabase/social-rollback.sql`. It drops only the `openblog_social_*` tables. Revoke access at
each provider you connected as well (LinkedIn, Facebook, Bluesky and Mastodon, as in
[Rolling it back](#rolling-it-back)); stored tokens are deleted by the rollback but stay valid there until revoked.

## Provider tokens

Access and refresh tokens are encrypted by the hosted function before they reach the database
([ADR 0295](adr/0295-provider-tokens-are-envelope-encrypted-by-the-hosted-function-and-refreshed-single-flight.md)).
Each connection gets its own random key, wrapped by a key you keep only in the function's environment, so a database
dump or a leaked `service_role` key does not reveal a token. Generate a key with
`node -e "console.log('k1:' + require('crypto').randomBytes(32).toString('base64'))"` and store it in your secret
manager as well: if you lose it, every account has to be connected again.

To rotate, put a new key first (`k2:...,k1:...`) and redeploy; new connections use `k2`. Keep `k1` in the list: no
command re-wraps existing connections yet (the library function exists, and a later story adds the operator entry
point). Removing `k1` while a connection still uses it makes that connection unreadable, and it has to be connected
again. Check before removing a key:
`select key_id, count(*) from openblog_social_credentials where status = 'active' group by 1;`
Remove `k1` only when no active row shows it.

Tokens are refreshed once at a time, shortly before they expire. If a provider says a connection is no longer valid,
or you disconnect an account, its stored tokens are erased and the account asks to be connected again. Admin only ever
sees a connection's status and dates, never a token. Tokens never appear in errors or logs, and are never written to
`openblog.json`, the repository, a page or an export.

## Connecting LinkedIn and Facebook (OAuth)

Connecting an account is an OAuth authorization-code flow
([ADR 0299](adr/0299-the-oauth-handshake-is-a-single-use-state-bound-connection-finished-by-the-hosted-function.md)).
The provider sends the author's browser back to your hosted function, so it needs a public `https:` address.

Create an app with each provider you want and set these in the function's environment (never in `openblog.json`):

| Variable | Purpose |
| --- | --- |
| `OPENBLOG_SOCIAL_CALLBACK_BASE` | Public `https://` address of the function, such as `https://blog.example.com/api/social`. No credentials, query or fragment. |
| `OPENBLOG_SOCIAL_LINKEDIN_CLIENT_ID`, `OPENBLOG_SOCIAL_LINKEDIN_CLIENT_SECRET` | The LinkedIn app's credentials. A provider with neither set is simply not offered. |
| `OPENBLOG_SOCIAL_FACEBOOK_CLIENT_ID`, `OPENBLOG_SOCIAL_FACEBOOK_CLIENT_SECRET` | The Meta app's credentials. |
| `OPENBLOG_SOCIAL_<PROVIDER>_API_VERSION` | Optional. LinkedIn `YYYYMM` (default `202610`, served until 2027-10-15), Facebook `vNN.N` (default `v23.0`, served until 2027-10-08). Dates as the providers listed them on 2026-10-29. |
| `OPENBLOG_SOCIAL_<PROVIDER>_SCOPES` | Optional. Replaces the requested scopes (space or comma separated). |
| `OPENBLOG_SOCIAL_LINKEDIN_ORGANIZATIONS` | Optional. `true` also asks for `r_organization_admin` and `w_organization_social`, to post as an organization. |
| `OPENBLOG_SOCIAL_<PROVIDER>_PKCE` | Optional. `true` sends a PKCE (S256) challenge. Off by default; turn it on only if the provider documents it for your app type. |

Register exactly this redirect URL in each provider app (Admin shows it too): `<CALLBACK_BASE>/callback/linkedin`
and `<CALLBACK_BASE>/callback/facebook`. Nothing in a request can change the redirect or the scopes that are sent.

**Verify these when you set up, because providers change them.** The defaults are a starting point, not a promise:

- LinkedIn: confirm the `Linkedin-Version` you set is still supported, that **Share on LinkedIn** is added to the
  app (for `w_member_social`) and **Sign In with LinkedIn using OpenID Connect** (for `openid profile`). Posting
  as an organization needs the Community Management API, which LinkedIn approves per app; until it does, the
  organization scopes are refused and only the member is offered.
- Facebook: confirm the Graph version, and that `pages_show_list` and `pages_manage_posts` are available to your
  app. Until Meta approves **Advanced access** through App Review, only people with a role on the app can
  connect a Page that is not their own. Admin cannot read review status from the API and says so.

Each attempt expires after ten minutes, works once, and at most ten may be open. If the author declines a
permission, the attempt fails with a plain message and nothing is stored. The scopes shown in Admin are the ones
the provider actually granted. Client secrets are sent in the request body to the provider, never in a URL.

## Connecting Bluesky (app password)

Bluesky is off until you set `OPENBLOG_SOCIAL_BLUESKY_ENABLED=true` in the function's environment
([ADR 0357](adr/0357-a-bluesky-account-is-connected-from-an-app-password-session-and-only-the-session-is-kept.md)).
There is no app to register and no redirect: Admin asks for your handle (such as `name.bsky.social`) and an **app
password**, and the function signs in once with them.

| Variable | Purpose |
| --- | --- |
| `OPENBLOG_SOCIAL_BLUESKY_ENABLED` | Exactly `true` to offer Bluesky. Unset means no Bluesky, and nothing changes. |
| `OPENBLOG_SOCIAL_BLUESKY_SERVICE` | Optional. The `https://` origin that signs you in and receives posts. Default `https://bsky.social`; set your own PDS if you host one. No path, query or credentials. |

1. In Bluesky, open **Settings, Privacy and security, App passwords** and add one (it looks like
   `xxxx-xxxx-xxxx-xxxx`). Do not allow direct messages for it; posting does not need them.
2. In Admin, open **Social accounts**, type your handle and the app password under **Bluesky**, and choose
   **Connect Bluesky**.
3. Choose the account under **Connections in progress**. Nothing is connected until you do.

What happens to the password: Admin and the function both refuse anything that is not shaped like an app password, so
your account password is never sent. The app password is used for that one sign-in and is never stored, logged or
shown again; the field is emptied as soon as you submit. What is kept is the session Bluesky returns (an access token
and a refresh token), encrypted like any other provider token. The access token is refreshed shortly before it
expires; Bluesky rotates the refresh token each time. If nothing posts for the refresh token's whole lifetime, or you
revoke the app password, the account shows **Needs reconnecting**: choose **Reconnect…** on it and give an app
password for the same account (a different account is refused). **Disconnect** ends the session at Bluesky too.

Limits to know (checked on 2026-10-29, see [Provider capabilities](provider-capabilities.md)): signing in is limited
to 30 times in 5 minutes and 300 a day per account, which is why the session is kept rather than signing in per post;
a post costs 3 of 5,000 points an hour. Bluesky's OAuth (with DPoP) is not used yet; a deployment that must not use
app passwords leaves Bluesky off.

## Connecting Mastodon (OAuth on one instance)

Mastodon is off until you register an application on **one** Mastodon instance and give the function its
credentials ([ADR 0359](adr/0359-a-mastodon-account-is-connected-by-oauth-on-one-instance-the-deployer-names-with-an-application-registered-there.md)). Every Mastodon address the function uses (sign-in, token, revoke, posting) is
built from that instance, so the client secret is only ever sent there. Accounts on other instances cannot be
connected; to move, register an application on the new instance, change the setting, and reconnect.

| Variable | Purpose |
| --- | --- |
| `OPENBLOG_SOCIAL_MASTODON_INSTANCE` | The instance's `https://` origin, such as `https://mastodon.social`. No path, query or credentials. |
| `OPENBLOG_SOCIAL_MASTODON_CLIENT_ID`, `OPENBLOG_SOCIAL_MASTODON_CLIENT_SECRET` | The application's **Client key** and **Client secret**. With neither set, Mastodon is not offered and nothing changes. |
| `OPENBLOG_SOCIAL_MASTODON_VISIBILITY` | Optional. `public` (default), `unlisted` (quiet public) or `private` (followers only). `direct` is refused. |
| `OPENBLOG_SOCIAL_MASTODON_MEDIA` | Optional. `cover` attaches the post's cover image with its description (below). Needs `OPENBLOG_SOCIAL_PROVIDER_TIMEOUT_SECONDS` of at least 15; otherwise it stays off and both settings are named in Admin. |
| `OPENBLOG_SOCIAL_MASTODON_SCOPES`, `OPENBLOG_SOCIAL_MASTODON_PKCE` | Optional, as for the other OAuth providers. Turn PKCE on only for an instance on Mastodon 4.3 or later. |
| `OPENBLOG_SOCIAL_MASTODON_API_VERSION` | Optional. Only `v1`, the default: the REST API is versioned by path, not by date. |

1. On the instance, signed in as any account, open **Preferences, Development, New application**. Name it, set the
   **Redirect URI** to exactly `<CALLBACK_BASE>/callback/mastodon` (Admin shows it), and tick only
   `read:accounts`, `write:statuses`, `read:statuses` and `write:media`. Save, then copy the client key and secret.
2. Set the variables above in the function's environment, and `OPENBLOG_SOCIAL_CALLBACK_BASE` if it is not set yet.
3. In Admin, open **Social accounts**. Under **Mastodon** the instance, the visibility and whether the cover is
   attached are shown; choose **Connect Mastodon**, sign in at the instance and approve. Then choose the account under
   **Connections in progress**. Nothing is connected until you do.

The permissions: `read:accounts` (to name the account) and `write:statuses` (to post) are required; a grant without
them is refused and its token revoked. `read:statuses` lets the worker look up a post whose outcome it did not see,
and `write:media` lets it upload the cover; without them that part is skipped and Admin says so when you connect.
Admin also tells you when the instance takes fewer than 500 characters per post. Mastodon tokens do not expire:
an account stays connected until you disconnect it in Admin (which revokes the token at the instance) or remove the
application under **Preferences, Account, Authorized apps** in Mastodon. **Reconnect…** asks the instance to sign in
again and works only for the same account. Admin follows a Mastodon sign-in address only when it is that instance's
own `/oauth/authorize`.

## Choosing where to post

After the author authorizes, the function asks the provider where the grant can post
([ADR 0300](adr/0300-destinations-are-discovered-from-the-grant-and-offered-only-when-the-provider-confirms-them.md)).
Admin lists each destination and chooses one; nothing is connected until it does, and the choice is made once.

- **LinkedIn** offers the member, and the organizations they administer when you set
  `OPENBLOG_SOCIAL_LINKEDIN_ORGANIZATIONS=true` and LinkedIn has approved the Community Management API for your app.
  Admin tells apart "not asked for", "not granted", "LinkedIn refused the lookup" (usually no approval), "could not
  be listed" and "you administer none"; it never reads a refusal as an empty list.
- **Facebook** offers a Page only if `pages_manage_posts` was granted, your role on the Page includes creating
  content, and Facebook returned access for it. A Page whose role Facebook did not report is shown but not
  offered. Meta's App Review status cannot be read from the API, so Admin always reminds you to confirm it.
- A destination that is already connected cannot be connected twice; use **Reconnect** on it.

**Reconnect** signs in again and replaces the stored credential, but only for the same LinkedIn identity or the
same Page. A different login is refused, LinkedIn is asked to withdraw that grant, and nothing is changed.

**Disconnect** erases the stored tokens, cancels the account's scheduled announcements (see the
[operations runbook](#disconnecting-an-account)) and keeps the account row for history. LinkedIn is asked to revoke the
grant when no other connected LinkedIn account could share it. Facebook is not asked, because withdrawing the grant
would also cut off your other Pages: remove the app under **Settings > Business integrations** in Facebook if you
want the grant gone. Revoke the app in the provider's settings as well when you retire the site.

An account shows as **Needs reconnecting** when a provider dropped the grant, its tokens were erased, or its tokens
(and refresh token) have run out, and as **Expiring** within seven days of that moment. LinkedIn tokens refresh
themselves while a refresh token is valid. Admin shows each account's provider id and name, its status, its dates and
the permissions that were granted, never a token.

## Connected accounts in Admin

Admin has a **Social accounts** page (`#/social`, and in the navigation once social settings exist)
([ADR 0301](adr/0301-connected-accounts-are-managed-through-admin-routes-that-rebuild-every-reply-from-known-fields.md)).
It is the only place you connect, reconnect or disconnect an account. Tell the machine that runs `openblog serve --admin`
where the function is and give it the Admin key, as environment variables (never in `openblog.json`):

| Variable | Purpose |
| --- | --- |
| `OPENBLOG_SOCIAL_ENDPOINT` | The function's address, such as `https://blog.example.com/api/social`. `https:` only (plain `http:` is allowed to `127.0.0.1` or `localhost` for local development). No credentials, query or fragment. |
| `OPENBLOG_SOCIAL_ADMIN_KEY` | The same value as the function's `OPENBLOG_SOCIAL_ADMIN_KEY`. At least 32 characters. |

With neither set, Admin has no Social accounts entry and the page only explains how to turn the feature on. If one is
set but wrong, the page names the setting at fault and sends nothing.

What you can do on the page:

- **Connect**: each provider shows the permissions it will ask for in plain words (optional ones marked) and the
  exact redirect address to register in the provider's app. **Connect** gives a link that opens the provider in a new
  tab; approve access there, return to Admin, press **I have finished, check now** (or just return to the tab), then
  choose where posts may go. The link is not kept after a reload; cancel and start again if you lose it.
- **Choose a destination**: destinations the provider did not confirm are shown disabled, with the reason.
- **Reconnect**: appears on every account and leads when access ran out or was withdrawn. Sign in as the same account.
- **Disconnect**: asks first, then erases the stored tokens and keeps the account in your history.

Each account shows its status as words (Connected, Expiring soon, Needs reconnecting, Disconnected), its dates, who
connected it, its provider id and the permissions the provider granted. Admin never receives a token: the page is
rebuilt from known fields on the Admin server, so even a faulty function reply cannot put one in front of you.
The page works with the keyboard and a screen reader and has no sideways scroll at 320 px.

## Scheduling announcements

An announcement is a caption and a time for one connected account, linking one of your public posts
([ADR 0308](adr/0308-an-announcement-links-a-public-canonical-post-at-a-utc-instant-and-only-a-scheduled-one-can-change.md),
[ADR 0309](adr/0309-announcement-routes-are-called-by-the-rust-admin-with-the-admin-key-and-change-a-row-only-by-version.md)).

What can be announced:

- Only a published post: not a draft, not dated in the future. The link is your site's own address for it, built from
  `url` in `openblog.json`, which must be a public `https` address. A cross-post whose `canonical` points to another
  site is not announced from here.
- A caption of 1 to 3,000 characters. The link is added when the post is sent, so it does not count. Control
  characters (other than a new line) and text-direction overrides are refused.
- A time at least a minute ahead and no more than a year ahead, written with its zone. It is stored in UTC; Admin
  shows it in your own zone. Your zone is not stored.

A scheduled announcement waits in the queue until the delivery worker (below) claims it; without the worker, or without
a provider adapter for its destination, it is never sent.

Only a **scheduled** announcement can be changed, rescheduled or canceled. Once a worker has claimed it, it cannot be.
Saving names the version you were looking at; if it changed meanwhile you are asked to reload. Creating is
idempotent: submitting the same composer twice (a double click, a retry after a timeout) gives one announcement.

### Settings

Scheduling uses the same settings as connected accounts (`OPENBLOG_SOCIAL_ENDPOINT`, `OPENBLOG_SOCIAL_ADMIN_KEY`, above)
on the machine that runs Admin, and the same hosted function: `netlify/functions/social.mjs` serves the announcement
routes beside the account routes, behind the same admin key, and answers 404 to everything unless the hosted settings
(including `OPENBLOG_SOCIAL_ENABLED=true`) are valid. A rejected key shows in Admin as a setup problem, not as a sign-out.

### Routes

Admin (`/admin/api/social/`, session and CSRF like every Admin route): `posts`, `preview`, `destinations`,
`announcements` (`GET` list, `POST` create, `PATCH ?id=` edit), `announcements/reschedule?id=`,
`announcements/cancel?id=`, `announcements/retry?id=`, `announcements/resolve?id=` and `GET announcements/attempts?id=`
(ADR 0318). Hosted (the same names under the endpoint, admin key only): the same set except
`posts` and `preview`, which Admin answers itself.

### The Social screen

With the settings above in place, Admin shows an **Announcements** tab
([ADR 0310](adr/0310-the-social-screen-is-a-labelled-form-with-a-server-checked-preview-and-times-in-the-authors-zone.md)):
a composer (destination, post, caption, date and time, preview) and the list of announcements with edit and cancel.
See [Admin](admin.md#announce-a-post-on-social-media-optional) for how it is used. It only offers connected accounts,
so connecting one is a separate step. Check it in a browser at 320px wide before you rely on it: it should never scroll
sideways.

Before you enable it for real, confirm in each provider's current documentation the API version, the permissions
(scopes) and any app review the posting API needs; none of that is part of this screen, and nothing here posts until
delivery is set up.

## Status and history

Each announcement shows one **delivery state** as a word and a shape
([ADR 0323](adr/0323-an-announcement-has-seven-delivery-states-derived-from-its-row-and-a-history-recorded-by-a-trigger.md)):

| State | Stored status | What it means | What you can do |
| --- | --- | --- | --- |
| Scheduled (`pending`) | `scheduled` | Waiting for its time; nothing has gone wrong. | Edit, cancel. |
| Sending (`processing`) | `claimed` | A worker holds it and may be calling the provider now. | Nothing; reload in a minute. |
| Retrying (`retrying`) | `scheduled` with a problem code | A try certainly did not post; it is tried again by itself at the time shown. | Edit, cancel, or wait. |
| Published | `published` | The provider confirmed it and named the post. | Nothing. |
| Failed | `failed` | It will not be sent again by itself. | Fix the cause, then **Try again**. |
| Needs checking (`unknown`) | `unknown` | It may have posted. It is looked up, never resent blindly. | Look at the account, then **Check the result**. |
| Canceled | `canceled` | You canceled it, or its account was disconnected. | Schedule a new one. |

**History** on each announcement lists its status changes and every try, in your time zone. To record the history
exactly, run `supabase/social-history.sql` in the Supabase SQL editor (after `social.sql` and `social-queue.sql`). It
adds one append-only table, `openblog_social_post_events`, and a trigger that writes an event whenever an
announcement's status, time, caption or problem code changes, whoever changes it. An event holds the status, the
delivery state, the try number, a short code and times, never the caption, a token or anything a provider wrote.
Announcements that already exist get one "history starts here" event. Without the file, Admin rebuilds the history
from the tries and says that edits and checks made by hand may be missing. Undo it with
`supabase/social-history-rollback.sql` (it deletes the recorded events; export them first if you want them).

## Publishing adapters

The delivery worker calls one adapter per provider through the interface documented in
`netlify/lib/social-delivery.mjs` ([ADR 0319](adr/0319-the-publishing-adapters-implement-the-worker-delivery-contract-and-never-copy-provider-text.md)).
An adapter is registered only for a provider you configured (its client id and secret, below); with none configured,
nothing is delivered and announcements wait. `publish` returns the provider's own post id only when the provider
confirmed the post and named it. Anything else is a typed error the worker acts on (see
[Retries, rate limits and uncertain outcomes](#retries-rate-limits-and-uncertain-outcomes)): a refused sign-in, a
refusal, a rate limit with the provider's `Retry-After`, a request that certainly never left (retried), or an outcome
that may have posted (a server error, a timeout, a dropped connection, a success without an id), which is never sent
again automatically.

Neither LinkedIn nor Facebook accepts an idempotency key on these calls, so none is sent: only an answer that means
"definitely not processed" is ever retried. Bluesky gets a record key of the announcement's own instead (below).

**Looking up an unclear outcome.** Facebook: the worker looks at the Page's own published posts since the attempt, read
only, made between just before the attempt started and just after it ended, and settles the announcement only when
exactly one of them has both the same caption and the same link. A post that matches by only one of the two (a link
you shared by hand, another announcement of the same post, a caption you edited on Facebook) cannot be told apart, so
the announcement comes to you as **Needs checking** instead of being guessed at. This needs
`pages_read_engagement` (requested by default); without it the lookup cannot tell and you settle it. LinkedIn: there
is no lookup, because reading a member's or organization's posts needs permissions LinkedIn gives only to approved
partners, so an unclear LinkedIn outcome comes straight to you as **Needs checking**.

### LinkedIn

Posts as the connected member or organization through the versioned REST Posts API (`POST /rest/posts`), with the
post link as an article whose title is the caption's first line. The caption is sent as typed: LinkedIn formatting characters (`( ) [ ] { } < > @ | ~ _ * #`
and the backslash) are escaped, so a caption cannot mention people or format text.

After installing `supabase/social-media.sql`, an author can preview and select the public JPEG or PNG cover, with its
description as alt text. The image post includes the canonical link in the commentary. If the approved image changes
or cannot be uploaded, the author chooses whether to post the link without the image or stop. Preview currently
accepts covers up to 1,000,000 bytes. Upload uses LinkedIn's [Images API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/images-api)
and [Posts API media schema](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/post-api-schema)
(checked 2026-11-12). An upload that succeeded but whose post result is unknown still requires a person to check;
the post is never retried automatically.

Verify at setup, because LinkedIn changes them: the API version (`OPENBLOG_SOCIAL_LINKEDIN_API_VERSION`, a dated
`YYYYMM` value that LinkedIn retires after about a year; the default is only a starting point), that your app has the
product that grants `w_member_social`, and for organizations the Community Management API and `w_organization_social`.

### Facebook Pages

Posts a message and the post link to the connected Page's feed (`POST /{page-id}/feed`) with that Page's access
token ([ADR 0320](adr/0320-the-facebook-adapter-posts-a-message-and-link-to-the-page-feed-with-the-page-token-in-the-header-and-reads-graph-error-codes.md)).
The token goes in the `Authorization` header, never in the address. Facebook's own error codes decide the result: an
expired token or a removed app asks you to reconnect, a missing permission or Page role is reported as such, a rate
limit (including Meta's Page-level limit, code `80001`, and the other business-use-case codes `80000`-`80014`) pauses
that Page and is tried again later, and an "unknown error" is `unknown` because the post may exist.

Verify at setup, because Meta changes them: the Graph version (`OPENBLOG_SOCIAL_FACEBOOK_API_VERSION`, for example
`v23.0`; old versions are retired), that your app has `pages_manage_posts` (and `pages_show_list`), and App Review:
until the app has Advanced access, only people with a role on the app can post to Pages.

### Bluesky

Writes one post record to your own repository (`com.atproto.repo.createRecord` of an `app.bsky.feed.post`)
([ADR 0358](adr/0358-a-bluesky-announcement-is-one-post-record-with-facets-and-a-link-card-under-a-record-key-derived-from-the-announcement.md)):
the caption as the text, full `https://` links and `#hashtags` in it as clickable facets, and the post link as a link
card with the post's own title and description, read from its public page just before posting
([ADR 0386](adr/0386-a-bluesky-card-shows-the-posts-own-title-and-a-link-already-in-a-caption-is-read-as-a-reader-sees-it.md)).
If that page cannot be read in a few seconds, the card is titled with the caption's first line instead. After installing
`supabase/social-media.sql`, you may preview and explicitly select the public cover for the card. The cover must be a
same-origin JPEG, PNG or WebP of at most 1,000,000 bytes with a description; larger images are not resized yet.
The preview shows the exact bytes that are approved, and delivery verifies them again. If the image changes or its
upload fails, the card goes without a picture. Bluesky's external-card schema does not offer a separate image
description; the description is shown in Admin but is not included in the card.
`@mentions` stay plain text, so nobody is notified by
mistake. A Bluesky caption is at most 300 characters; Admin counts against that as soon as you choose a Bluesky
destination, and the preview says how the card and the links will look.

Every try of one announcement writes the same record key, made from its scheduled time and its key, so a retry
after a try that did land is refused by Bluesky instead of posting twice; that refusal is checked by reading the
record, and when it is this announcement it counts as posted. The post's `at://` address is kept as the
provider post id. An unclear outcome is looked up by reading exactly that record: found with the same caption and
link and, when selected, the approved image or permitted image-free fallback, it is published; Bluesky saying it does not exist is a sure "not there"; anything else comes to you as **Needs
checking**. An expired or revoked session asks you to reconnect, and a rate limit is tried again after the time
Bluesky gives.

### Mastodon

Posts one status from the connected account (`POST /api/v1/statuses`) ([ADR 0360](adr/0360-a-mastodon-announcement-is-one-status-with-the-link-written-into-it-at-the-deployers-visibility-checked-against-the-instances-own-limits.md)): the caption, a blank
line and the post link (left out if the caption already holds that link, even in brackets or before a full stop), at
the visibility you set. Mastodon
makes its own preview card from the link and reads `#hashtags` and `@name@server` mentions as written, so a
mention notifies that person; the composer's preview says so. A Mastodon caption is at most 475 characters (a
default instance takes 500, and the link counts as 23); before each post the instance's own limits are read and a
status over them is refused without being sent. Every try of one announcement sends the same `Idempotency-Key`
(made from its key), which Mastodon honours for an hour. The status id is kept as the provider post id.

**The cover image.** With `OPENBLOG_SOCIAL_MASTODON_MEDIA=cover`, the worker reads the post's public page for its
`og:image` and `og:image:alt` (written from the post's `cover` and `coverAlt`), uploads the image with that
description, and attaches it. The image must be on your site's own address, a JPEG, PNG, WebP or GIF the instance
takes, and within its size limit; anything else, a post without `coverAlt`, or an upload that is not ready in time
leaves the image out and posts the text with Mastodon's link card. An image is never posted without its
description. The composer's preview shows the description that would go with it.

A refused token asks you to reconnect, a rate limit (300 calls per 5 minutes per account; media 30 per 30 minutes)
is tried again after `Retry-After` or `X-RateLimit-Reset`, and a refusal (422, or another 4xx) fails the
announcement. An unclear outcome is looked up read only: the account's latest statuses from around the attempt are
read back as text, and exactly one with this announcement's text settles it; no status at all in that window is a
sure "not there"; anything else (two matches, an edited status, more than five, no `read:statuses`) comes to you as
**Needs checking**.

### How the adapters are tested

All the adapters run against one fixture of provider replies (`tests/fixtures/social-publish.json`, [ADR 0321](adr/0321-adapter-behaviour-is-pinned-by-one-fixture-of-provider-replies-and-by-the-real-worker-over-a-scripted-provider.md)):
success, 401, 403, 429, 5xx, a redirect, a network failure, a refused connection, a timeout and ambiguous successes.
The real worker is also run with the real adapters over a scripted provider, from the reply to the stored
announcement, with a check that no token or provider wording reaches a stored error, a summary or a log. Mastodon reads the
instance's limits before it posts, so its replies are pinned by its own tests (`tests/web/social-publish-mastodon*.test.mjs`)
rather than the one-call fixture. No test uses
a real account or the network. The replies are written from the providers' documentation, so check them against the
current documentation when you change an API version.

## Delivery queue

Delivery has three parts, each opt-in on top of the last. This section is the queue; the worker that calls it and the
schedule that wakes the worker are below it.

Run `supabase/social-queue.sql` in the Supabase SQL editor after `social.sql`
([ADR 0316](adr/0316-due-announcements-are-claimed-by-database-functions-under-a-lease-and-an-expired-lease-after-sending-is-unknown.md)).
It is additive and re-runnable: five columns, one index and four functions, no existing row changed. Undo it with
`supabase/social-queue-rollback.sql`; `social-rollback.sql` removes the functions before it drops the tables.

- A **claim** takes due, scheduled announcements of this site, a bounded batch at a time, under a lease (5 minutes by
  default). Two workers at once get different announcements; one an author just canceled is not claimed.
- Each claim counts an **attempt** and opens an attempt row. The **sending mark** is made just before the provider is
  called, and only while the lease is valid.
- A lease that runs out **before** the sending mark returns the announcement to the queue. One that runs out
  **after** it becomes `unknown`: the provider may have posted, so it is never sent again, only looked up or reviewed.
- An outcome is recorded against the version the worker read, so a worker that lost its lease cannot overwrite the one
  that holds it. `published` is recorded only with the provider's own post id.
- Only `service_role` may execute the functions; the browser and the public keys cannot.

Without this file announcements wait in the queue exactly as before.

The optional `supabase/social-media.sql` adds storage for approved Bluesky and LinkedIn media snapshots after the queue is installed.
Run it before scheduling an announcement with a cover. Existing announcements remain unchanged.
`supabase/social-media-rollback.sql` refuses to remove the column while any media-bearing announcement remains.

## The delivery worker

The worker is a hosted function, `netlify/functions/social-worker.mjs`, reached at `POST /api/social-worker`
([ADR 0317](adr/0317-a-protected-worker-endpoint-woken-by-pg-cron-and-pg-net-delivers-a-bounded-batch-through-a-narrow-adapter-interface.md)).
Each call claims a small batch of due announcements, delivers each through its provider's adapter, records the outcome,
and answers with counts only. It is off (404) unless the social settings are valid.

**Who may call it.** Only the worker key, as `Authorization: Bearer <OPENBLOG_SOCIAL_WORKER_KEY>`. The admin key is
refused (403), a missing or wrong key is 401, and a worker key that equals the Supabase service key, the admin key or an
anon or publishable key disables the feature at start-up, so a public key can never run it. Nothing you send can name
a site or change what it does.

**Optional settings** (all have defaults; a value outside its range is ignored and the default used):

| Variable | Default | Range |
| --- | --- | --- |
| `OPENBLOG_SOCIAL_BATCH_SIZE` | 5 | 1 to 25 |
| `OPENBLOG_SOCIAL_LEASE_SECONDS` | 300 | 30 to 900 |
| `OPENBLOG_SOCIAL_PROVIDER_TIMEOUT_SECONDS` | 4 | 2 to 30 |
| `OPENBLOG_SOCIAL_WORKER_BUDGET_SECONDS` | 8 | 5 to 50 |

The defaults (a 4-second provider timeout inside an 8-second budget) fit even a 10-second function limit, and a run
claims only as many announcements as its budget can finish (one at the defaults; the schedule wakes it every minute).
Netlify's [function configuration](https://docs.netlify.com/build/functions/configuration/) listed a 60-second
synchronous execution limit on 2026-10-29; older setups and other hosts may allow less. To deliver more per run, check
your host's limit, then raise the budget to stay about 2 seconds under it. A budget smaller than the provider timeout plus 2
seconds is refused: both settings fall back to their defaults and the setting is reported as a problem. If the platform cuts a run off mid-delivery, the
announcement is not lost and not repeated: its lease runs out and it becomes `unknown` if the provider may have
been called, or returns to the queue if not.

**Set it up** (each step is separate and reversible):

1. Run `supabase/social-queue.sql` (the delivery queue, above).
2. Deploy the function with `OPENBLOG_SOCIAL_WORKER_KEY` set (and the other social settings).
3. Store the worker's address and key in Supabase Vault, from the SQL editor, replacing the placeholders:
   `select vault.create_secret('https://YOUR-SITE.example/api/social-worker', 'openblog_social_worker_url');` and
   `select vault.create_secret('THE-WORKER-KEY', 'openblog_social_worker_key');`
4. Run `supabase/social-cron.sql`. It enables `pg_cron` and `pg_net` and schedules one job, `openblog-social-worker`,
   every minute. Running it again leaves one job. Announcements go out within about a minute of their time.

To stop delivery run `supabase/social-cron-rollback.sql` (it keeps the extensions and the Vault secrets; delete the
secrets and rotate the worker key when you retire the feature). With no job, nothing wakes the worker; you can still call
the endpoint by hand with the key.

**Adapters.** The worker never talks to LinkedIn or Facebook itself. It calls an adapter registered in
`netlify/lib/social-adapters.mjs` through a narrow interface (documented in `netlify/lib/social-delivery.mjs`): `publish`
returns the provider's own post id only when the provider confirmed success, or throws a typed error. An adapter is
registered only for a provider you configured (see [Publishing adapters](#publishing-adapters)); an announcement for a
provider with no adapter **waits in the queue**, untouched, and one for a provider this release does not know fails with
`unsupported-provider`. Provider API versions, permissions and app review are settings you verify at setup (see
Provider setup above); nothing is guessed at run time.

## Retries, rate limits and uncertain outcomes

([ADR 0318](adr/0318-a-failure-that-certainly-did-not-post-is-retried-with-back-off-and-one-that-may-have-posted-is-unknown-looked-up-and-then-settled-by-a-person.md).)
What the worker does depends on what it knows about the provider's answer:

| The provider's answer | The announcement becomes | Next |
| --- | --- | --- |
| Confirmed, with its post id | `published` | Done. The id is kept on the announcement and the attempt. |
| Certainly not accepted (a refused connection, a clear "try later") | `scheduled` again | Retried after a back-off (about 1, 2, 4 minutes and so on, capped at an hour). |
| Rate limited (429) | `scheduled` again | Waits at least the provider's `Retry-After` (at most a day), and **that account sends nothing** until then. |
| Refused (400, 403, 404, 409, 410, 422) | `failed` | Not retried. Fix the cause (the caption, the account) and use **Try again**. |
| The sign-in was refused (401, an expired or removed Facebook token) | `failed`, `needs-reauth` | The account becomes **needs reconnecting**, and its other announcements fail without being sent until you connect it again; then use **Try again**. |
| No answer, a timeout, a 5xx, an unreadable answer, a crash, or a success that could not be recorded | `unknown` | **Never sent again by itself.** Looked up, then yours to settle. |
| Tried the allowed number of times (default 5) | `failed`, `attempts-exhausted` | A dead letter that keeps its history. **Try again** gives it a fresh allowance. |

**Unknown outcomes.** The worker asks the provider, through the adapter's optional lookup, whether the post exists:
after 5 minutes, 15 minutes, an hour, six hours and a day. If it is there, the announcement becomes `published` with
its post id. If the provider says conclusively that it is not there, and the attempt is at least 15 minutes old, it
becomes `failed` (`not-delivered`) and you can use **Try again**. If the lookup cannot tell, or the destination cannot
be looked up, the announcement stays `unknown` with `needs-review` and waits for you: open the account, see whether
the post is there, and choose **Check the result** in Admin. To find stuck work in the database:
`select id, status, last_error_code, updated_at from openblog_social_posts where status in ('unknown','failed');`.

**Settings** (optional, bounded; a value out of range is ignored): `OPENBLOG_SOCIAL_MAX_ATTEMPTS` (default 5, 1 to 10)
and `OPENBLOG_SOCIAL_BACKOFF_SECONDS` (default 60, 5 to 3600). The worker gives an adapter an idempotency key that is the
same for every attempt of one announcement, for a provider that honours one; LinkedIn and Facebook do not, so it is not
sent and nothing relies on it.

**What is recorded.** Each attempt keeps its number, times, outcome, HTTP status, a short code and a fixed sentence,
and the provider's post id. It never keeps a token, a header, a request or anything the provider wrote, so the history
is safe to show in Admin and to paste in a bug report.

## Rolling it out, step by step

([ADR 0331](adr/0331-social-publishing-is-an-opt-in-outward-announcement-beside-canonical-markdown-with-a-server-only-threat-model.md),
[ADR 0332](adr/0332-social-publishing-rolls-out-through-reversible-gates-and-its-provider-versions-carry-an-end-date.md).)
Each gate below is separate. Check it before you go on, and stop at any gate you like: everything before it keeps
working, and readers, builds, feeds, exports and cross-posting never change. The "Undo" column takes you back one gate.

| Gate | Do | Check | Undo |
| --- | --- | --- | --- |
| 1. Storage | Run `supabase/social.sql` in the Supabase SQL editor. | `select version from openblog_social_schema;` shows `1`. | `supabase/social-rollback.sql` |
| 2. Hosted function | Set the [settings](#settings-hosted-function-only) on the Netlify site (generate each key as in [Rotating secrets](#rotating-secrets)) and redeploy. | `curl -s -o /dev/null -w '%{http_code}' https://YOUR-SITE/api/social/status` answers `401` (on, and wants a key), not `404` (off). If it is `404`, the function log names the setting at fault. | Remove `OPENBLOG_SOCIAL_ENABLED` and redeploy. |
| 3. Admin | On the machine that runs `openblog serve --admin`, set `OPENBLOG_SOCIAL_ENDPOINT` and the same `OPENBLOG_SOCIAL_ADMIN_KEY`, then restart Admin. | Admin shows **Social accounts**; it lists no provider yet. | Unset both and restart Admin. |
| 4. Providers | Create the LinkedIn and Meta apps, register the redirect addresses and add the products and permissions in [Connecting LinkedIn and Facebook](#connecting-linkedin-and-facebook-oauth); set the client id, secret and `OPENBLOG_SOCIAL_CALLBACK_BASE`; redeploy. | **Connect** an account you own and choose a destination. | **Disconnect** it in Admin, remove the client settings, and remove the app in the provider's settings. |
| 5. Scheduling | Nothing to install. | Schedule an announcement in the **Announcements** tab. It stays **Scheduled**: nothing sends it yet. | Cancel it. |
| 6. Delivery | Run `supabase/social-queue.sql`, and `supabase/social-history.sql` if you want the exact history. | Call the worker once by hand: `curl -s -X POST -H "Authorization: Bearer $OPENBLOG_SOCIAL_WORKER_KEY" https://YOUR-SITE/api/social-worker` answers with counts, and a due announcement to an account you own is published. | `supabase/social-history-rollback.sql`, then `supabase/social-queue-rollback.sql` |
| 7. Schedule | Store the two Vault secrets, then run `supabase/social-cron.sql` (see [The delivery worker](#the-delivery-worker)). | `select status, start_time from cron.job_run_details order by start_time desc limit 3;` shows a successful run each minute. | `supabase/social-cron-rollback.sql` |
| 8. Operations (optional) | Run `supabase/social-ops.sql`, set `OPENBLOG_SOCIAL_OPS=true`, redeploy. Add `OPENBLOG_SOCIAL_RETENTION_DAYS` only if you want old history deleted. | Admin shows **Delivery health**; the log has `openblog-social-ops` lines. | Remove `OPENBLOG_SOCIAL_OPS`, then `supabase/social-ops-rollback.sql` |

For your first real announcement, post to an account or Page you own with a caption that says it is a test, and
watch it go from Scheduled to Published. Delete the test post on the network by hand afterwards; open.blog never
deletes anything it posted.

The hosted function runs as a Netlify function (`netlify/functions/social.mjs` and `social-worker.mjs`, routed by
`netlify.toml`). It is not a Supabase Edge Function: the modules use only Web APIs so they could be hosted there
later, but this release builds, deploys and tests them on Netlify only.

## Rolling it back

To turn the whole feature off and remove it, in this order. Each step is safe to stop after.

1. **Stop it.** Remove `OPENBLOG_SOCIAL_ENABLED` from the Netlify site and redeploy. Every social route and the worker
   now answer 404 and touch nothing; scheduled announcements simply wait.
2. **Hide it in Admin.** Unset `OPENBLOG_SOCIAL_ENDPOINT` and `OPENBLOG_SOCIAL_ADMIN_KEY` on the Admin machine and
   restart Admin.
3. **Keep what you need.** Export the announcements and their history (the commands are at the top of
   `supabase/social-rollback.sql`).
4. **Remove the data.** Run `supabase/social-rollback.sql`. It stops the `openblog-social-worker` cron job first (when
   `pg_cron` is installed), then drops every `openblog_social_*` function, trigger and table that `social.sql`,
   `social-queue.sql`, `social-history.sql`, `social-ops.sql` and `social-cron.sql` made. It touches no other table,
   job or extension, and running it twice is harmless.
5. **Remove the Vault secrets.**
   `delete from vault.secrets where name in ('openblog_social_worker_url', 'openblog_social_worker_key');`
6. **Revoke access at the providers.** Tokens deleted by the rollback stay valid at the provider until you do this,
   for each provider you connected:
   - **LinkedIn**: remove the app from the connected member's permitted services, or delete the app.
   - **Facebook**: remove the app under **Settings > Business integrations**, or delete the app.
   - **Bluesky**: delete the app password under **Settings, Privacy and security, App passwords**. The session it
     made can no longer be renewed.
   - **Mastodon**: remove the application under **Preferences, Account, Authorized apps** on the instance, or delete
     it under **Preferences, Development**. Mastodon tokens never expire on their own.
7. **Delete the remaining settings**, the token keys (`OPENBLOG_SOCIAL_TOKEN_KEYS`) last, and rotate any key you
   shared.

Check: `select count(*) from pg_tables where tablename like 'openblog_social%';` is `0`, and
`select count(*) from cron.job where jobname = 'openblog-social-worker';` is `0`. Posts already published on LinkedIn,
Facebook, Bluesky or Mastodon stay there; delete them on the network if you want them gone.

To undo only part of it, use the rollback file of that gate (table above), newest gate first: operations, schedule,
history, then queue. Each one leaves the gates before it working.

## Rotating secrets

Generate a key of the right length with `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`
(43 characters). Keep every value in a secret manager, never in `openblog.json`, the repository or a ticket.

- **`OPENBLOG_SOCIAL_ADMIN_KEY`**: set the new value on the Netlify site and redeploy, then on the Admin machine and
  restart Admin. In between, Admin reports a setup problem and changes nothing; no announcement is affected.
- **`OPENBLOG_SOCIAL_WORKER_KEY`**: set the new value on the Netlify site and redeploy, then update the Vault secret
  `openblog_social_worker_key`:
  `select vault.update_secret((select id from vault.secrets where name = 'openblog_social_worker_key'), 'THE-NEW-KEY');`
  Runs in between are refused (401) and announcements wait for the next run; nothing is lost or sent twice.
- **`SUPABASE_SECRET_KEY`**: create a new secret key in the Supabase dashboard, set it on the Netlify site, redeploy,
  then delete the old key in Supabase. Tokens stay readable: they are sealed with the token keys, not this one.
- **`OPENBLOG_SOCIAL_TOKEN_KEYS`**: put the new key first and keep the old ones, as described in
  [Provider tokens](#provider-tokens). Remove an old key only when no active connection uses it.
- **`OPENBLOG_SOCIAL_<PROVIDER>_CLIENT_SECRET`**: generate a new secret in the provider's app, set it on the Netlify
  site and redeploy. A provider may end existing grants when its secret changes; if accounts show **Needs
  reconnecting** afterwards, reconnect them and use **Try again** on their failed announcements.

Rotate a key at once if it may have leaked, and whenever someone who knew it leaves. The
[threat model](adr/0331-social-publishing-is-an-opt-in-outward-announcement-beside-canonical-markdown-with-a-server-only-threat-model.md#threat-model)
says what each key can reach.

## Rate limits

What the providers documented on 2026-10-29 (check again when you set up; they change):

- **LinkedIn** counts calls per day, per application and per member, and resets at midnight UTC. A request over the
  limit gets a 429. LinkedIn does not publish most limits; your app's **Analytics** tab in the Developer Portal shows
  them for endpoints you have called today, and LinkedIn emails the app's admins at 75% of an application limit.
  Its Share on LinkedIn guide lists 150 requests a day per member and 100,000 per application.
  ([Rate limiting](https://learn.microsoft.com/en-us/linkedin/shared/api-guide/concepts/rate-limits),
  [Share on LinkedIn](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin).)
- **Facebook Pages** calls made with a Page token count against Meta's business-use-case limit for that Page:
  4,800 calls times the number of people who engaged with the Page, over a rolling 24 hours. Over it, Graph answers
  with code `80001`; codes `4`, `17` and `32` are app and user limits. Meta asks callers to stop until the limit
  clears, because calls made while throttled extend it.
  ([Rate limiting](https://developers.facebook.com/docs/graph-api/overview/rate-limiting/).)

open.blog makes very few calls: one per announcement, plus a few read-only lookups for an unclear Facebook outcome
and a token refresh now and then. When a provider says "too many", that **account is paused** until the provider's
`Retry-After` (at most a day; by back-off if it gave none) and sends nothing in between, so the next announcement
does not hit the limit again; the announcement shows **Retrying** with its time. A run sends at most three
announcements per account. If you schedule many announcements to one account, space them out.

## Troubleshooting

| What you see | Likely cause | What to do |
| --- | --- | --- |
| Admin has no **Social accounts** entry | `OPENBLOG_SOCIAL_ENDPOINT` or `OPENBLOG_SOCIAL_ADMIN_KEY` is not set where Admin runs. | Set both and restart Admin (gate 3). |
| Admin says the function rejected its key | The admin key differs between Admin and the function. | Set the same value in both places. |
| Admin says social publishing is not enabled there, or the routes answer 404 | `OPENBLOG_SOCIAL_ENABLED` is not exactly `true`, or a hosted setting is invalid. | Read the function log: it names each setting at fault, never its value. |
| A provider is missing under **Connect** | Its client id or secret is missing or malformed, or `OPENBLOG_SOCIAL_CALLBACK_BASE` is missing. | Admin lists the setting at fault; fix it and redeploy. |
| The provider says the redirect address does not match | The app does not list `<CALLBACK_BASE>/callback/linkedin` or `/callback/facebook` exactly. | Copy the address Admin shows into the provider's app. |
| No LinkedIn organization, or no Facebook Page, is offered | LinkedIn has not approved the Community Management API; the Page role lacks content creation; `pages_manage_posts` was declined; or Meta's App Review is pending. | See [Choosing where to post](#choosing-where-to-post). |
| Announcements stay **Scheduled** after their time (`backlog-overdue` when operations are on) | The queue (gate 6) or the schedule (gate 7) is missing, a Vault secret is missing or wrong, or the worker key differs. | `select status, return_message from cron.job_run_details order by start_time desc limit 5;` and `select status_code, created from net._http_response order by created desc limit 5;` A `401` means the Vault key differs from `OPENBLOG_SOCIAL_WORKER_KEY`. pg_net keeps responses for six hours. |
| One network's announcements wait while the other's go (`provider-not-configured`) | That provider has no settings on this deployment. | Add its settings and redeploy, or cancel them. |
| LinkedIn announcements are all refused at once | The `Linkedin-Version` was retired, or the app lost the product that grants `w_member_social`. | Set `OPENBLOG_SOCIAL_LINKEDIN_API_VERSION` to a current version and check the app's products. |
| An account shows **Needs reconnecting** (`accounts-need-reconnect`) | The provider refused its token: expired, revoked, a changed password, or the app removed. | **Reconnect** it, then **Try again** its failed announcements. |
| **Needs checking** (`needs-review`) | A delivery may have posted and could not be looked up. | Look at the account and choose **Check the result**. |
| After a deploy, announcements show **Retrying**, then **Failed**, with "The saved sign-in could not be used." (`credential-error`, then `attempts-exhausted`), while their accounts still show connected | A token key was removed from `OPENBLOG_SOCIAL_TOKEN_KEYS` while connections used it. | Put the old key back (after the new one), redeploy, then **Try again** the failed announcements. |
| **Retrying** with a time far ahead | The account is paused after a rate limit. | Wait, or see [Rate limits](#rate-limits). |

When you ask for help, paste an announcement's **History** or the `openblog-social-worker` and `openblog-social-ops`
log lines: they hold counts and short codes only, never a token, caption or provider text.

## Operations runbook

([ADR 0324](adr/0324-social-operations-log-counts-only-alert-on-backlog-sweep-and-prune-by-opt-in-and-cancel-on-disconnect.md).)

### Logs

Every worker run writes one JSON line, `{"event":"openblog-social-worker","summary":{...}}`, with counts only
(claimed, published, retried, failed, unknown, deferred, and the lookups). Log lines are built from whole numbers,
true/false and short codes only, so no token, caption, account name, address or provider text can appear in them.
Nothing else is logged, and errors are never logged with their detail.

### Health and backlog alerts (optional)

1. Run `supabase/social-ops.sql` in the Supabase SQL editor (after `social.sql` and `social-queue.sql`). It adds three
   functions and changes no table or row. Undo it with `supabase/social-ops-rollback.sql`.
2. Set `OPENBLOG_SOCIAL_OPS=true` on the hosted functions and redeploy.

Each run then also reaps expired leases, expires account handshakes left open past their time (erasing any sealed
tokens they still hold), reads the queue's health and writes an `openblog-social-ops` line. The line is a **warning**
when there is an alert, so point your log drain or alerting at `"event":"openblog-social-ops"` at warn level:

| Alert | Meaning | What to do |
| --- | --- | --- |
| `backlog-overdue` | Announcements the worker could take now are more than `OPENBLOG_SOCIAL_BACKLOG_ALERT_MINUTES` (default 15, 1 to 1440) late. Announcements of an account paused after a rate limit are not counted here (they show as `waiting_on_pause` and wait for the pause to end). | The worker is not running or not keeping up: check `select * from cron.job_run_details order by start_time desc limit 5;`, the Vault secrets, and the function's log. |
| `expired-leases` | A run stopped mid-delivery. | Nothing: the next run returns it to the queue, or marks it Needs checking if it may have posted. If it repeats, raise the function timeout or lower the batch. |
| `provider-not-configured` | Announcements wait for a provider whose settings this deployment does not have, so the worker leaves them in the queue. | Add the provider's settings and redeploy, or cancel them in Admin. |
| `accounts-need-reconnect` | A provider refused an account's sign-in. | Reconnect it in Admin, then **Try again** its failed announcements. |
| `needs-review` | An outcome may have posted and could not be looked up. | Check the account and use **Check the result** in Admin. |
| `failed-recently` | Something failed in the last day. | Read its History in Admin. |
| `stale-connections` | An unfinished account connection expired. | Nothing: the sweep cleaned it up. |

Admin's Social screen shows the same health under **Delivery health**, whether or not `OPENBLOG_SOCIAL_OPS` is set,
once the file is installed. To check by hand: `select * from openblog_social_health('<your site id>', 900);` (add a third argument such as
`array['facebook']` to count a provider without settings apart, as the worker does).

### Retention (optional, deletes data)

Nothing is deleted unless you set `OPENBLOG_SOCIAL_RETENTION_DAYS` (30 to 3650) as well as `OPENBLOG_SOCIAL_OPS=true`.
Then each run deletes, at most 200 at a time, announcements that **ended** (published, failed or canceled) longer ago
than that, with their tries and history; finished account handshakes; and disconnected accounts nothing refers to
any more. Scheduled, sending and Needs checking announcements are never deleted. Meta's Platform Terms (section 3.d)
and LinkedIn's API Terms of Use (section 4) ask you to keep provider data only as long as you need it, so choose a
period you can justify (for example 365) and export first if you want an archive:
`copy (select * from openblog_social_attempts) to stdout with csv header;`.

A person asking for their data to be deleted is a manual step: disconnect the account in Admin, then in the SQL editor
delete its rows (replace the id):
`delete from openblog_social_attempts where post_id in (select id from openblog_social_posts where account_id = '<id>');`
then the same for `openblog_social_post_events` (if installed), `openblog_social_posts`, `openblog_social_credentials`
and `openblog_social_accounts` with `account_id`/`id = '<id>'`.

### Disconnecting an account

Disconnecting erases its tokens and **cancels its scheduled announcements** (they show as Canceled, "its account was
disconnected"), because a disconnected account can only come back as a new account. One a worker is sending at that
moment fails without being sent, because its tokens are gone; one that Needs checking stays for you to check. Admin
says how many were canceled.

### Stuck work, by hand

- Late queue: `select id, status, scheduled_for, next_attempt_at, last_error_code from openblog_social_posts where status = 'scheduled' and coalesce(next_attempt_at, scheduled_for) < now() - interval '15 minutes';`
- Expired leases without waiting for a run: `select * from openblog_social_sweep('<your site id>');`
- Needs checking: `select id, last_error_code, updated_at from openblog_social_posts where status = 'unknown';` and settle each in Admin.

## How delivery safety is tested

Nothing here uses a real account or the network; providers and Supabase are fakes.

- **Races** (`tests/web/social-races.test.mjs`): two workers run at once over the same queue and each announcement is
  sent exactly once; an author's cancel and a worker's claim cannot both win.
- **Fault injection**: a storage failure (a dropped connection or a 500 carrying a key) is injected at every single
  call of a worker run in turn, then healthy runs follow. Whatever failed, nothing is sent twice, nothing is
  `published` without the provider's id, nothing stays claimed, and no key or token reaches a summary or a stored row.
  Every provider failure the adapter contract allows (refused, rate limited, signed out, timed out, crashed, a success
  without an id) is run the same way: only an answer that certainly did not post is ever sent again.
- **The SQL** of the queue, the history and the operations runs against a real Postgres in CI
  (`social-queue-sql`, `social-history-sql`, `social-ops-sql`), including two concurrent claimers, the append-only
  history and retention that never touches scheduled, sending or unknown work.
- **Security**: every Admin route needs a session and every write a CSRF token; the hosted routes take the admin key
  only, refuse a request that names a site and read only this site's rows; captions, paths and codes are rendered
  as text; and Admin rebuilds every reply from known fields.
- **In a browser** (`tests/browser/social-announcements.spec.mjs`): the real binary and Admin over the real hosted
  routes, by keyboard and at 320 px, including the status history.
