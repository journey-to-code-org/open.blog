---
title: Feeds, and your posts on other sites
subtitle: RSS, JSON Feed, a latest-posts list for your portfolio, and text for AI tools.
date: 2026-07-20
series: running-your-blog
seriesOrder: 2
tags:
  - guide
  - feeds
  - integrations
description: Every open.blog site publishes full-content RSS and JSON feeds, a small latest-posts JSON for showing posts on another site, a sitemap, and plain-text llms.txt files.
---

Your posts should reach readers wherever they are: in a feed reader, in a newsletter, on your
portfolio's home page. Every build writes machine-readable versions of the site for that, with
nothing to set up. Click any of these on this demo site:

| Address | What it is | Who uses it |
| --- | --- | --- |
| [/rss.xml](/rss.xml) | RSS 2.0 with full post content | Feed readers, newsletter tools |
| [/feed.json](/feed.json) | JSON Feed 1.1 | Feed readers, automations |
| [/api/blog.json](/api/blog.json) | The four newest posts | Your other websites |
| [/sitemap.xml](/sitemap.xml) | Every public address | Search engines |
| [/llms.txt](/llms.txt) | A plain-text guide to the site | AI tools and assistants |

## Feeds that carry the whole post

The feeds include each post's full content by default, so subscribers can read without
clicking through. Things that cannot run in a feed reader are turned into something that can:
a quiz shows its answer marked, a sandbox becomes code blocks, and a lesson demo becomes its
fallback text with a link to the live version.

```json
"feeds": {
  "rss": true,
  "json": true,
  "sitemap": true,
  "llms": true,
  "portfolioSnapshot": true,
  "limit": 20,
  "fullContent": true
}
```

Set `fullContent` to `false` to send only descriptions and make readers visit for the rest.

## Your newest posts on another site

If you have a portfolio or business site next to your blog, `/api/blog.json` is the easiest way
to show your latest posts there:

```json
{
  "schemaVersion": 1,
  "posts": [
    { "title": "Feeds, and your posts on other sites", "date": "2026-07-20T00:00:00Z", "link": "https://example.com/posts/feeds-and-your-posts-on-other-sites/" }
  ]
}
```

Fetch it from the other site and render the list. Here is a working version: press **Run preview**. It
loads `blog.json` from the live demo site, so the first run can take a few seconds while the demo
server wakes up.

```web runnable network module title="Latest posts from this blog"
---html
<h3>From the blog</h3>
<ul id="latest"><li>Loading…</li></ul>
---js
// Replace this with your own blog's address.
const url = "https://openblog-o0o5.onrender.com/api/blog.json";
try {
  const { posts } = await (await fetch(url)).json();
  document.querySelector("#latest").replaceChildren(...posts.map((post) => {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.href = post.link;
    link.textContent = post.title;
    item.append(link, ` (${new Date(post.date).toLocaleDateString()})`);
    return item;
  }));
} catch (error) {
  console.error("Could not load the list:", error.message);
}
```

`openblog serve` allows other sites to fetch this file and the feeds. Most static hosts do too.
If yours does not, fetch it from your other site's server instead of the browser.

## Series in feeds

Posts in a series say so in feeds and exported copies: the series name with a link, and which
part this is. A reader who finds part three in a newsletter knows where part one is.

## Cross-posting

To republish posts on DEV, Hashnode, Medium, Ghost or WordPress with credit pointing home, see
[Safely cross-posting your blog](/posts/automated-cross-posting/). The Admin can also schedule
announcements to LinkedIn and Facebook Pages.

Next: [Search engines and AI crawlers](/posts/search-engines-and-ai-crawlers/).
