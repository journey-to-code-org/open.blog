---
title: Search engines and AI crawlers
subtitle: What open.blog already does for you, what is left to you, and who may read your posts.
date: 2026-07-27
series: running-your-blog
seriesOrder: 3
tags:
  - guide
  - seo
description: The search metadata open.blog writes for every post, a five-step checklist before publishing, and separate switches for AI search and AI training crawlers.
---

There is no trick to being found. Search engines and AI-assisted search reward the same thing:
clear pages that answer a question, with honest metadata. open.blog writes the metadata. The
writing is up to you.

## What every post already has

Without you doing anything, each post gets:

- a canonical address, a description and Open Graph tags for social cards;
- a visible author byline and `BlogPosting` structured data;
- published and updated dates, and topic tags;
- `Recipe` data on recipes, `ScholarlyArticle` on research posts, `VideoObject` on video pages,
  and `Service` and `FAQPage` data on service pages;
- a place in the sitemap, the feeds and `llms.txt`.

## Five things to do before publishing

1. **Set the basics in `openblog.json`**: the real public `url`, a specific `title` and
   `description`, and the author's `name` and `url`. Add your verified profiles to
   `author.sameAs`.
2. **Write a description that answers**, between 50 and 180 characters. "How long to rest a
   steak, and why it matters" beats "Some thoughts on steak".
3. **Use descriptive headings and alt text.** Keep the important answer in the text, not only in
   an image or a video.
4. **Use `updated` when the answer changes**, and `canonical` only when the original lives
   somewhere else.
5. **Build, read the warnings, then check after deployment.** Run a structured-data validator on
   a few posts, and submit `/sitemap.xml` to the search consoles you use.

> [!TIP]
> The Admin's **Search & answer readiness** checklist runs these checks while you write: a weak
> description, a very long title, a cover image with no alt text. It is guidance, not a ranking
> score, and nothing can guarantee a place in results.

## Who may read your posts: AI crawlers

AI companies run two kinds of crawler. Some fetch pages to *answer a question now* and usually
link to you. Others collect pages to *train future models*. open.blog lets you decide each
separately:

```json
"seo": {
  "aiSearch": true,
  "aiTraining": false
}
```

| Switch | Crawlers |
| --- | --- |
| `aiSearch` | OAI-SearchBot, Claude-SearchBot, PerplexityBot |
| `aiTraining` | GPTBot, ClaudeBot, Google-Extended |

The generated `robots.txt` follows your choice and always allows ordinary search engines. This
demo site allows both. See its [robots.txt](/robots.txt).

> [!WARNING]
> `robots.txt` is a request, not a lock. Well-behaved crawlers follow it, but it is not security.
> Never publish something and rely on robots.txt to keep it private.

## Seeing who visits

When `openblog serve` hosts the site, the Analytics tab counts requests from documented OpenAI,
Anthropic and Perplexity crawlers, by purpose and page, separately from human views. Anyone can
claim to be a crawler, so treat these as claims. On a static host, your host's or CDN's logs are
the place to look.

Next: [Making it look like yours](/posts/making-it-look-like-yours/).
