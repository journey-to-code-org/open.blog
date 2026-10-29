# Jobs

A job is a post that records one piece of finished trade work: a floor, a driveway, a brake repair.
It is an ordinary post with `profile: job`, so feeds, tags, series, search and export treat it like any
other post ([ADR 0285](adr/0285-jobs-are-posts-with-a-content-profile-and-open-blog-is-not-a-field-service-tool.md)).
A site that never uses the profile builds exactly as it did before.

open.blog is not a field-service tool. There is no invoicing, estimating, dispatch, job scheduling or
payment data. A job may show a cost band as a public price signal; it is never a quote.

## Front matter

Use the usual post keys (`title`, `date`, `tags`, `description`, and so on) plus one `job` mapping:

```yaml
---
title: New oak floor in Maple Falls
date: 2026-10-21
tags: [flooring]
profile: job
job:
  trade: flooring
  service: hardwood-install
  place:
    town: Maple Falls
    region: WA
  started: 2026-10-14
  finished: 2026-10-16
  durationHours: 22.5
  costBand: 2k-10k
  materials:
    - Red oak 3/4 in
    - Matte finish
  media:
    before:
      - /images/floor-before.jpg
    after:
      - /images/floor-after.jpg
  review: rev_01
---
```

| Field | Required | Rule |
| --- | --- | --- |
| `trade` | yes | One of the trades below, or a trade the site adds. |
| `service` | yes | A short id: lowercase letters, digits and hyphens. |
| `place.town`, `place.region` | yes | A plain name. Digits and commas are refused: towns only, never an address or postal code. |
| `started`, `finished` | yes | `YYYY-MM-DD`. `finished` is the same day as `started` or later. |
| `durationHours` | no | A number of hours greater than 0. |
| `materials` | no | Up to 50 short items. |
| `costBand` | no | `under-500`, `500-2k`, `2k-10k`, `10k-50k`, `over-50k` or `ask`. Never free text. |
| `media.before`, `media.after` | no | Up to 50 image references each: a site path or http(s) URL ending in `png`, `jpg`, `jpeg`, `gif`, `webp`, `avif` or `svg`. |
| `review` | no | The id of a saved review (letters, digits, `-`, `_`). |

Keys you add that this version does not know are kept untouched, so a file written by a newer version
survives an older one. The `job` mapping is the only place front matter may nest.

## Trades

Bundled: `general-contractor`, `excavation`, `flooring`, `mobile-mechanic`, `auto-body-paint`, `roofing`,
`plumbing`, `electrical`, `landscaping`, `painting`, `hvac`, `other`. Add your own in `openblog.json`:

```json
{ "extraTrades": ["fencing"] }
```

## Archives

Jobs are browsable the way customers look for them. When a site has jobs, the build adds:

- `/jobs/`: every job, newest first, with links to each trade.
- `/jobs/<trade>/`: one trade's jobs, with links to its services.
- `/jobs/<trade>/<service>/`: one service within a trade.

They page like the home page (`postsPerPage`; later pages are `/jobs/page/2/` and so on), appear in `sitemap.xml`, and are
built in a fixed order. A trade or service with no jobs gets no page, and a site with no jobs gets no `/jobs/` at all. Feeds
are unchanged: jobs are posts, so they are in them as posts. `page` cannot be a trade or service id. See
[ADR 0286](adr/0286-jobs-archives-are-derived-from-job-posts-and-page-like-the-home-page.md).

## Checks

A published job with a problem stops the build with a sentence naming the field, for example
``job.costBand: `cheap` is not a cost band; use one of under-500, 500-2k, ...``. Every problem is listed
at once. A draft job is allowed to be unfinished: its problems are warnings, prefixed
`job not ready to publish`.
