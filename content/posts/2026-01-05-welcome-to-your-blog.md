---
title: Welcome to your blog
subtitle: A map of this demo site, and where to find each feature.
date: 2026-01-05
updated: 2026-11-11
tags:
  - meta
  - guide
description: Start here. This demo blog is a working tour of open.blog, with every feature on show and the instructions to use it on your own site.
---

You are reading `content/posts/2026-01-05-welcome-to-your-blog.md`. Everything on this site
comes from Markdown files like it. There is no database to set up and nothing to export later:
your posts are plain text in a folder you own, and `openblog build` turns them into a fast,
static website.

This blog is also the starter content every new open.blog site begins with. Each post is a
working example of a feature, with the instructions to use it on your own site. Read what helps,
then delete the rest when your own posts arrive.

## Find your way around

| If you want to… | Read |
| --- | --- |
| Write and publish your first post | [Getting started](/series/getting-started/) |
| Add callouts, buttons, maps, FAQs, photos and quizzes | [The writer's toolkit](/series/writers-toolkit/) |
| Post recipes that scale, time themselves and print | [From the kitchen](/series/from-the-kitchen/) |
| Teach with code readers can run and check | [Teaching with code](/series/teaching-with-code/) |
| Show off finished work as a trade or local business | [For trades and local businesses](/series/for-trades-and-local-business/) |
| Write up hikes and surveys without revealing locations | [Field notes](/series/field-notes/) |
| Publish research with proper credits | [Research and collaboration](/series/research-and-collaboration/) |
| Add analytics, comments, feeds, SEO and your own look | [Running your blog](/series/running-your-blog/) |
| Keep video episode notes, chapters and transcripts | [Zhalendor example production](/series/zhalendor-example/) |

Every series page lists its parts in reading order, and every part links to the next. The
[archive](/archive/) lists every post by year, [tags](/tags/) group posts by topic, and
[search](/search/) runs entirely in your browser.

## Three ways to write

1. **In the browser.** Run `openblog user add you`, then `openblog serve --admin`, and open
   `/admin`. The editor writes these same files, with a live preview, a word-processor-style
   Visual mode and an **Add something** menu, so you never have to touch Markdown.
2. **In a text editor.** Open a file in `content/posts/`, change it, and save. `openblog serve`
   rebuilds the site as you work.
3. **From the command line.** `openblog new "A post title"` creates a file with today's date.
   Add `--recipe` for a recipe, or `--profile job` for a trade job.

## What a post needs

The block between the `---` lines at the top of a file is its *front matter*. Only `date` is
required, plus a `title` unless the body starts with a `#` heading:

```yaml
---
title: My first post
date: 2026-01-05
tags: [meta]
description: One or two sentences for search results, feeds and social cards.
---

The post starts here.
```

[Writing a post](/posts/writing-a-post/) covers everything else that can go there.

## Make it yours

> [!TIP]
> Change three things first: `title`, `url` and `author` in `openblog.json`. Then try
> **Customize look** in the Admin, or see [Making it look like yours](/posts/making-it-look-like-yours/).

When you are ready, delete the example posts you do not need (or keep a few as a reference),
then write your own.
