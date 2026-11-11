# ADR 0404: Visits are attributed only to a fixed list of destinations, and campaign tags are opt-in

- Status: Accepted
- Date: 2026-11-11
- Parent epic: [#388](https://github.com/journey-to-code-org/open.blog/issues/388)
- Story: [#404](https://github.com/journey-to-code-org/open.blog/issues/404)
- Builds on: [ADR 0402](0402-every-adapters-record-is-read-into-one-redacted-outcome-per-post-and-destination-and-the-report-is-never-stored.md)

## Context

The author wants to know whether sending a post somewhere brought readers back. The built-in counter already keeps,
per day, views, uniques and referring hosts, with no cookie and nothing that identifies a visitor. Anything more
must not track people across sites, must not let a visitor write their own keys into the record, and must say
plainly what it cannot know.

## Decision

- **Arrivals.** For each counted view, the counter also counts the destination it came from, per day and page, in
  a new `arrivals` map that is written only once there is one (a store without it keeps its exact shape). Nothing
  about the visitor is added.
- **A fixed vocabulary.** A destination is one of the sixteen provider ids in the manifests, nothing else. A
  referring host stands for a destination only from a fixed list (for example `bsky.app`, `*.facebook.com`,
  `news.ycombinator.com`, `*.reddit.com`, `pinterest.com`, `business.google.com`) or from the author's own
  cross-posting targets' addresses. A Google search result is not a Google Business Profile visit. Unknown keys in a
  backup or an imported counter are dropped.
- **Campaign tags are opt-in.** With `analytics.campaigns: true` (off by default, not written while off), the page's
  `utm_source` counts when it is one of the destinations, ahead of the referrer; and the links open.blog itself
  sends to a Pinterest Pin and to each shared-job place carry `?utm_source=<destination>&utm_medium=open.blog`. The
  tag is added before the preview's digest is made, so the author confirms the exact link. A link with a query is
  never changed, and the canonical page is the same page. Announcements and cross-posted copies are not tagged:
  their links are the canonical address by contract (ADR 0325). A visitor's `utm_source` is sent by `ob-views`
  only when it is a short plain word, and counted only as above.
- **Three kinds of figure.** The report says each status is confirmed by the platform, the author's word, or not
  settled; each visit count is *estimated* (referrers are often stripped, and DNT, GPC and automated browsers are
  never counted) or *unavailable* when the built-in counter is off; and a platform's own statistics are always
  *unavailable*, because open.blog never asks a platform for them.
- **Nothing in the build.** A build, its feeds and its pages are byte for byte the same with campaign tags on or off,
  and a built site loads no third-party script and sets no cookie (tested).

## Consequences

An external counter (the Cloudflare Worker or the hosted engagement function) does not attribute arrivals in this
release; its views still count. Visits from Mastodon are not attributed by referrer, since every instance has its
own address; with campaign tags on, a link tagged `utm_source=mastodon` by hand still counts.
