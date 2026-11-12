---
title: Views, comments and sharing
subtitle: Know what people read and let them respond, without cookies or trackers.
date: 2026-07-13
series: running-your-blog
seriesOrder: 1
tags:
  - guide
  - analytics
  - privacy
description: open.blog counts views without cookies or stored addresses, offers moderated first-party comments, and ends every post with share links that work without JavaScript.
---

Most blogs bolt on three third-party scripts: one for analytics, one for comments, one for share
buttons. Each is a tracker. open.blog builds all three in, so you get the answers without
handing your readers to anyone.

## View counts

The number of views beside this post's reading time comes from the built-in counter. It is on
by default when you run `openblog serve`. The Admin's **Analytics** tab shows views and unique
visitors for the last 7, 30, 90 or 365 days, a bar per day, your top pages, the sites that sent
readers, and requests from known AI crawlers.

What it records, per day and page: views, unique visitors, a count per referring site, and AI
crawler labels. **Nothing else.**

- No cookies, and no addresses or browser strings written to disk.
- Unique visitors are counted with a hash that includes a random salt, which is thrown away at
  midnight. Visits cannot be linked across days or to a person.
- Readers who send Do Not Track or Global Privacy Control are not counted at all.

```json
"analytics": {
  "builtin": true,
  "showViews": true,
  "retentionDays": 400
}
```

> [!TIP]
> On a static host with no server, open.blog writes the latest counts into the pages at build
> time, and a tiny counter can run on Cloudflare Workers or Render. The
> [publishing guide](https://github.com/journey-to-code-org/open.blog/blob/main/docs/publishing.md#view-counts-on-a-static-host)
> walks through both. To use Plausible, Umami, GoatCounter or Fathom instead, paste their tag
> into `snippets.head` and set `builtin` to `false`.

## Comments

This demo site has first-party comments turned on, so you will find a comment form at the end of
this post. Comments are text only: no HTML, no images, no tracking embeds. Every comment waits as
**pending** until you approve it in the Admin's **Moderation inbox**, so nothing appears on your
site without your say.

Each post can choose its own policy:

```yaml
comments: open      # the default
comments: locked    # keep approved comments visible, accept no new ones
comments: hidden    # no comment section at all
```

The [Zhalendor episode page](/posts/zhalendor-gate-of-embers/) is `locked`. The lock is checked
on the server too, so nobody can get around it by posting directly.

On Netlify, comments and persistent analytics are stored in a Supabase project you own: turn
them on in **Admin → Analytics**. To use giscus or utterances instead, paste their tag into
`snippets.postFooter`.

## Share links

Scroll to the end of this post: share links for each network you chose, plus **Share…** (your
phone's own share sheet) and **Copy link**. They are plain links, so they work without
JavaScript, and nothing loads from the networks until a reader clicks.

```json
"share": {
  "enabled": true,
  "networks": ["x", "bluesky", "linkedin", "reddit", "hackernews", "email"]
}
```

Available networks: `x`, `bluesky`, `mastodon`, `linkedin`, `facebook`, `reddit`, `hackernews`
and `email`. They appear in the order you list them.

## Related posts

Below the share links are up to three related posts, ranked by shared tags and series. A post
with nothing in common with any other shows none. Set `"relatedPosts": 0` to turn the section
off, or another number to show more.

Next: [Feeds, and your posts on other sites](/posts/feeds-and-your-posts-on-other-sites/).
