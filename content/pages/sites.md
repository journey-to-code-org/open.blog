---
title: Kinds of sites
description: How open.blog's pages, collections, front page and documentation section combine into a blog, a recipe site, a business site or a handbook.
---

open.blog started as a blog engine. It is also a small content management system: the same
folder of files holds pages, collections, a front page and a documentation section. This page
shows how they combine, with this site as the example.

## The parts

### The front page

Without any setup the home page is the newest posts. Add `content/landing.json`, or open
**Front page** in [Studio](/studio/), and it becomes sections you arrange: a welcome with a
picture and a button, text, buttons, pictures, a video, a map, opening hours, questions and
answers, the newest posts, the series, services, finished jobs and reviews.

[This site's home page](/) is eleven of those sections. [The content guide](https://journey-to-code-org.github.io/open.blog/docs/content/)
lists every kind.

### Pages

A page is a Markdown file in `content/pages/`. `about.md` is served at `/about/`. Pages take
the same call-outs, buttons, pictures and questions as posts. The pages on this site:

- [What it does](/features/)
- [Studio](/studio/)
- [Kinds of sites](/sites/), which you are reading
- [Get started](/get-started/)
- [Questions](/faq/)
- [About](/about/)

### Collections

Posts group into series, each with its own page and reading order. A series can wear its own
look: [From the kitchen](/series/from-the-kitchen/) is set in a different one from the rest of
this site. Recipes also gather at [Recipes](/recipes/), and a trade's services at
[Services](/services/).

### A documentation section

`content/docs/` becomes a handbook with a sidebar, **Previous** and **Next**, and a search of
its own. It can sit beside the blog, as the [Example handbook](/docs/) does here, or be the
home page. open.blog's own documentation is built this way.

## What people build

### A blog

Posts, tags, series, an archive, feeds and search. Start with
[Getting started](/series/getting-started/).

### A recipe site

Recipes with ingredients that scale, steps with timers, a page that prints cleanly and a
browsable index. See [From the kitchen](/series/from-the-kitchen/).

### A site for a trade or a local business

Services described once, finished jobs with before-and-after photos, reviews, business facts
and a quote form, on a front page made for a phone. `openblog init --starter trade` sets one
up. See [For trades and local businesses](/series/for-trades-and-local-business/) and
[Trades](https://journey-to-code-org.github.io/open.blog/docs/trades/).

### A handbook or a product's documentation

`openblog init --starter docs` adds the documentation section.
[Documentation beside your blog](/posts/documentation-beside-your-blog/) explains it, and
[Documentation sites](https://journey-to-code-org.github.io/open.blog/docs/docs-sites/) covers making it the whole site.

### A course

Lessons with code that readers run and check, quizzes, and a series to order them. See
[Teaching with code](/series/teaching-with-code/).

### A field journal, a research notebook, a show

Each has a profile with the fields it needs: [Field notes](/series/field-notes/),
[Research and collaboration](/series/research-and-collaboration/) and the
[Zhalendor example production](/series/zhalendor-example/).

## One site can be several

These are not separate products. This site is a blog, a recipe index, a business's services
and a handbook at once, from one folder and one command.

```piece button
label: Get started
href: /get-started/
style: primary
```
