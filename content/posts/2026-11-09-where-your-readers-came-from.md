---
title: Where your readers came from
subtitle: Every place a post went, and the visits it sent back, without cookies or a tracking script.
date: 2026-11-09
series: running-your-blog
seriesOrder: 7
tags:
  - guide
  - analytics
  - distribution
description: The "Where it went" report lists every place a post was sent and estimates the visits each sent back, with no cookies and no tracking script.
---

Once a post is out in the world (cross-posted, pinned, shared to a community, announced on
social media), the useful question is which of those places sent anyone back. open.blog answers
it from records it already keeps, plus the visit counter, and adds nothing to your pages to do so.

## One report for every place a post went

Run this in your blog's folder:

```sh
openblog outcomes
```

or open **Distribution → Where it went** in Admin. For each post you get a row per place it was
sent: a cross-posted copy on Hashnode or DEV, a Pinterest Pin, a community submission, a shared
job, a YouTube upload. Each says what happened (sent, failed, waiting for you) with a link to it,
and how many visits came from that place.

## How the visits are counted

The cookie-free view counter already notes which site each view came from. When that site is
one it recognizes, such as `bsky.app`, `reddit.com`, `news.ycombinator.com`, `pinterest.com` or one
of your own cross-posting targets, the view is counted for that place. If you post from Mastodon
instances, list them so their visits count too:

```json
{ "analytics": { "fediverseHosts": ["hachyderm.io", "fosstodon.org"] } }
```

The figures are **estimates**, and the report says so: many apps hide where a reader came from,
and readers who send Do Not Track or Global Privacy Control are never counted. A platform's own
numbers (impressions, likes, saves) are shown as unavailable; open.blog never asks a platform for
them.

## If you host the counter yourself

The Cloudflare Worker and the hosted engagement function count arrivals the same way. Run
`openblog analytics attribution` to print the settings they need, then pull their counts in:

```sh
openblog analytics pull https://<name>.<you>.workers.dev --secret <EXPORT_SECRET>
```

## Campaign tags, if you want them

Turn on `"analytics": { "campaigns": true }` and a `?utm_source=` that names one of the known
places is counted for it. The links open.blog sends to a Pinterest Pin or a shared job then carry
that tag, and the preview shows the tagged link before you confirm. Your own pages never change.

The full story, including every place that is recognized, is in
[Where your posts went](https://github.com/journey-to-code-org/open.blog/blob/main/docs/distribution-reporting.md).
