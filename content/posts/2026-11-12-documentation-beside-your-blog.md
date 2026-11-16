---
title: Documentation beside your blog
subtitle: A folder of Markdown becomes a handbook with a sidebar, search, and links that work on GitHub too.
date: 2026-11-12
series: running-your-blog
seriesOrder: 8
tags:
  - guide
  - documentation
description: Publish a folder of Markdown as a handbook at /docs/, with a sidebar, section-by-section search, and links that work on GitHub and on the site.
---

A project often needs more than posts: a handbook, a reference, a getting-started guide that
stays put. open.blog publishes one beside the blog from plain Markdown files. This site has a
small one: open [the example handbook](../docs/index.md), or **Docs** in the header.

## Turning it on

```json
"docs": { "enabled": true }
```

Then write Markdown files in `content/docs/`. Each becomes a page at the address its path gives:

| File | Address |
| --- | --- |
| `content/docs/index.md` | `/docs/` |
| `content/docs/getting-started.md` | `/docs/getting-started/` |
| `content/docs/guides/index.md` | `/docs/guides/` |
| `content/docs/guides/writing-a-docs-page.md` | `/docs/guides/writing-a-docs-page/` |

A folder's `index.md` (or its `README.md`, as GitHub shows it) is the folder's own page. A new
project can start with one already: `openblog init my-project --starter docs`.

## What readers get

- **A sidebar** listing the handbook, with the folder you are in opened and your page marked. On
  a phone it folds away above the page.
- **Previous and Next** links at the foot of each page, in reading order. `order:` in a page's
  front matter sets it; pages without one follow by title.
- **Search from the sidebar**, a section at a time: a result such as "Getting started › Install"
  opens at that heading.

## Links that work everywhere

Link to another page by its file, the way you would on GitHub:

```markdown
See [Getting started](getting-started.md#install) or [the guides](guides/).
```

The build turns each link into the page's address and warns about one that leads nowhere. Posts
can do the same: the link to the handbook at the top of this post is written as
`../docs/index.md`.

If the folder is also read on GitHub, set `docs.source` to its address there, and each page gets
a **View this page's source** link. open.blog's own documentation is built exactly this way, from
the repository's `docs/` folder: [journey-to-code-org.github.io/open.blog](https://journey-to-code-org.github.io/open.blog/).
For every setting, read
[Documentation sites](https://journey-to-code-org.github.io/open.blog/docs/docs-sites/).
