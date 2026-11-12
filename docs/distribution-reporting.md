# Where your posts went

open.blog can send a post to many places: [cross-posting](cross-posting.md) to DEV, Hashnode, Ghost, WordPress or
Medium, [social announcements](social-publishing.md), [Pinterest Pins](pinterest.md),
[community submissions](community-submissions.md) you make by hand, [YouTube releases](video-production.md) and
[shared jobs](job-sharing.md). Each keeps its own private record. **Where it went** reads all of them and shows, for
each post, every place it went, what that status rests on, and how many visits your own counter saw from there.

It only reads. It sends nothing, asks no platform anything, and writes no file
([ADR 0402](adr/0402-every-adapters-record-is-read-into-one-redacted-outcome-per-post-and-destination-and-the-report-is-never-stored.md)).

## See it

- In Admin: **Where it went** (in the Simple workspace, under **More pages**). Choose 7, 30 or 90 days of visits.
- In a terminal: `openblog outcomes`, or `openblog outcomes --json --days 90` for the same report as JSON.

## What each status means

| Status | Means |
| --- | --- |
| Delivered | The platform answered that it is there (a post id, a published article, a Pin). |
| Posted by hand | You said you posted it (a community submission, **I posted it** on a shared job). open.blog never checked. |
| Draft or private | A remote draft, a private YouTube upload, or a Pinterest sandbox Pin that only you can see. |
| Waiting | Scheduled, queued, uploading, or a kit made for you to post. |
| Unknown | A request was made and may have created it. Check the platform, then settle it where you sent it. |
| Not delivered | Refused, failed before creating anything, or canceled. |

Each status also says what it **rests on**: *confirmed by the platform*, *your word*, or *not settled yet*. Only
Delivered and Posted by hand count as reached; an unknown is counted on its own, never as reached
([ADR 0403](adr/0403-records-for-the-same-post-and-place-are-reconciled-into-one-row-and-an-unknown-never-counts-as-reached.md)).
A post sent twice to the same place is one row with two attempts.

Settle an unknown where you sent it: `openblog pinterest pin <slug> --reconcile`, `openblog video <slug> --settle`,
**I posted it** in **Share this job**, or the announcement that needs checking on the **Announcements** screen.

## Visits

The built-in, cookie-free [counter](features.md) already counts the referring site of each view. It now also counts,
per page, views that came from one of the places above, when the referring site is one it knows (for example
`bsky.app`, `facebook.com`, `news.ycombinator.com`, `reddit.com`, `pinterest.com`, `business.google.com`) or the
address of one of your own cross-posting targets. Add the fediverse instances you post from to
`analytics.fediverseHosts` to attribute visits from them to Mastodon; when social Mastodon is configured, its
instance is included automatically by the built-in counter. The list is omitted by default and accepts up to 20
bare host names, for example:

```json
{ "analytics": { "fediverseHosts": ["hachyderm.io", "fosstodon.org"] } }
```

These figures are **estimated**: many apps and sites hide where a visitor came from, and readers who send Do Not
Track or Global Privacy Control are never counted.

### Counters you host

The Cloudflare Worker and the hosted engagement function can attribute arrivals too. They use the same fixed
destination list and referring-host table as the built-in counter, and only store aggregate counts per day,
destination and page. The Worker gets `CAMPAIGNS` and `OWN_HOSTS` in its generated `wrangler.toml`.
`openblog analytics attribution` prints their current values after you change settings. For a hosted engagement
function, run [`supabase/arrivals.sql`](../supabase/arrivals.sql) after `openblog.sql`, set
`OPENBLOG_ARRIVALS_ENABLED=true`, and use the same printed `OPENBLOG_ANALYTICS_CAMPAIGNS` and
`OPENBLOG_ANALYTICS_OWN_HOSTS` values in the function's environment. Without that opt-in and schema, the function
continues counting views as before and does not attempt to record arrivals.

Pull either counter's export into `.openblog/analytics.json`:

```sh
# Cloudflare Worker
openblog analytics pull https://<name>.<you>.workers.dev --secret <EXPORT_SECRET>

# Hosted engagement function; use the function's OPENBLOG_ADMIN_API_KEY
openblog analytics pull https://<site>/api --secret <OPENBLOG_ADMIN_API_KEY> --name hosted
```

Pulled data is merged idempotently by source, including arrivals. **Where it went** and the Admin report use these
arrivals even when `analytics.builtin` is off; if neither the built-in counter is enabled nor a counter has been
pulled, visits say **unavailable**. `openblog analytics attribution` also shows listed fediverse hosts and the
configured social Mastodon instance as `mastodon` for external counters. Re-run it when those settings change,
then update the deployed Worker or hosted-function environment.

A platform's own statistics (impressions, likes, saves) are always shown as **unavailable**: open.blog never asks a
platform for them.

### Campaign tags (optional)

```json
{ "analytics": { "campaigns": true } }
```

With campaign tags on ([ADR 0404](adr/0404-visits-are-attributed-only-to-a-fixed-list-of-destinations-and-campaign-tags-are-opt-in.md)):

- A page address's `utm_source` is counted when it names one of the places above (`pinterest`, `nextdoor`,
  `reddit`, ...). Any other value is ignored.
- The links open.blog itself sends to a **Pinterest Pin** and to each place of a **shared job** carry
  `?utm_source=<place>&utm_medium=open.blog`. The preview shows the tagged link and its digest covers it, so you
  confirm exactly what is sent. A link that already has a query is not changed.
- Announcements and cross-posted copies are not tagged: they always carry your canonical address.

You can also tag a link yourself, for example `https://your.site/post/?utm_source=nextdoor` in a post you make by hand.

Nothing in your built site changes either way: no tag, script or cookie is added to your pages.

## When something is missing

- **A record could not be read**: the report names it and shows the rest. Fix or move that file (the command that
  writes it explains how).
- **Social announcements could not be read**: Admin reads them from your hosted queue; they appear again once it
  answers.
- **A post is not listed**: nothing was sent for it, or it no longer exists on your site.
- **A cross-posting target is missing**: a target removed or renamed in `openblog.json` is left out, not guessed.
