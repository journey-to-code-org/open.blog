---
title: "Showing your work: jobs and services"
subtitle: Turn finished jobs into posts, and let the site build the portfolio pages for you.
date: 2026-06-01
series: for-trades-and-local-business
seriesOrder: 1
tags:
  - guide
  - business
description: Describe each service once, write up finished jobs as posts, and open.blog builds service pages, browsable job archives and search-engine data with no extra setup.
---

If you lay floors, fix cars, dig foundations or paint houses, your finished work is your best
advertisement. open.blog has two features for that: **services**, describing what you sell, and
**jobs**, showing what you did. This series follows Maple Falls Floors, an invented flooring
business, so you can see both in action:

- [/services/](/services/) lists its two services, with price bands, timelines and questions.
- [/jobs/](/jobs/) lists every job, and [/jobs/flooring/](/jobs/flooring/) lists one trade's jobs.
- The next two parts are the jobs themselves.

None of this needed configuring. The pages exist because the files do.

> [!IMPORTANT]
> open.blog is not a field-service tool. There is no invoicing, quoting, scheduling or payment
> data. A price band is a public signal of the range you work in, never a quote.

## Services: say what you sell, once

A service is a Markdown file in `content/services/`. This is the start of
`content/services/floor-refinishing.md`:

```yaml
---
version: 1
id: floor-refinishing
name: Floor sanding and refinishing
summary: Old wood floors sanded back to bare wood, repaired where needed, and sealed.
includes:
  - Moving furniture out and back
  - Replacing up to three damaged boards
priceBand: 2k-10k
typicalTimeline: 2 to 4 days
faq:
  - question: How long before we can walk on it?
    answer: Socks after 24 hours, furniture after 3 days.
---
Anything written here is the long description on the service's page.
```

The price band is one of `under-500`, `500-2k`, `2k-10k`, `10k-50k`, `over-50k` or `ask`. It is
shown in words, such as "$2,000 to $10,000", with a note that it is a guide. Questions become a
FAQ on the page, and the search-engine data that goes with it.

In the Admin, open **Services** and choose **Add a service**. From a terminal, run
`openblog new "Floor refinishing" --profile service`.

## Jobs: show what you did

A job is an ordinary post with `profile: job` and a `job` block in its front matter:

```yaml
profile: job
job:
  trade: flooring
  service: floor-refinishing
  place:
    town: Maple Falls
    region: WA
  started: 2026-06-02
  finished: 2026-06-04
  durationHours: 26
  costBand: 2k-10k
  materials:
    - Reclaimed red oak, 3/4 in
    - Water-based matte finish
  media:
    before:
      - /images/demo/floor-before.svg
    after:
      - /images/demo/floor-after.svg
```

| Field | Rule |
| --- | --- |
| `trade` | One of `general-contractor`, `excavation`, `flooring`, `mobile-mechanic`, `auto-body-paint`, `roofing`, `plumbing`, `electrical`, `landscaping`, `painting`, `hvac` or `other`. Add your own with `"extraTrades": ["fencing"]` in `openblog.json`. |
| `service` | The `id` of one of your services. |
| `place` | A town and region only. Digits and commas are refused, so a customer's street address can never slip out. |
| `started`, `finished` | Dates. Required. |
| `costBand` | The same bands as services. Optional. |

Write the story in the body. A new job starts with four headings: **Problem**, **What we
found**, **What we did** and **Result**. Change them freely.

## Three ways to write a job

- **On site, from your phone.** Open **Capture** in the Admin. Take photos, pick the trade and
  town, type or dictate notes, and choose **Save draft**. If the signal drops, the capture waits
  on your phone and sends itself when you are back online.
- **In the Admin.** New post, then **Settings → Content profile → Job**. An **About this job**
  form fills in the fields above.
- **From a terminal.** `openblog new "Oak floor refinish" --profile job --trade flooring
  --service floor-refinishing --town "Maple Falls" --region WA`. The job starts as a draft.

A published job with a mistake, such as an unknown trade or a finish date before the start
date, stops the build with a sentence naming the field. A draft job is allowed to be unfinished.

## What the site builds

- `/services/` and a page for each service, with its three newest jobs.
- `/jobs/`, `/jobs/<trade>/` and `/jobs/<trade>/<service>/` archives, newest first.
- A **Services** link in the header, unless your navigation already has one.
- `Service` and `FAQPage` data for search engines, and `LocalBusiness` data once you fill in
  **Business facts** (name, phone, hours, licence) in the Admin.

Next: [Bringing back a 1920s oak floor](/posts/bringing-back-a-1920s-oak-floor/).
