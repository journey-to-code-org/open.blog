# Writing content

Everything on the site comes from Markdown files under `content/`:

```
content/posts/     one file per post
content/series/    one file per series (optional)
content/pages/     one file per page, such as About (optional)
```

Files anywhere in `content/posts/` are posts, including in subfolders. A `README.md`, and
any file or folder whose name starts with `_` (such as `content/posts/_notes.md` or
`content/posts/_ideas/`), are ignored, so you can keep notes beside your posts.

## Posts

A post is Markdown with a front matter block between `---` lines:

```markdown
---
title: Writing a post
date: 2026-01-12
tags: [guide, markdown]
description: What goes in a post file and which Markdown features work.
---

The body starts here.
```

Only `date` is required (a draft may omit it), plus a `title` unless the body starts with
a `#` heading, which is then used. Everything else is optional:

| Field | Meaning |
| --- | --- |
| `title` | The headline. If missing, the first `#` heading in the body is used. |
| `date` | `YYYY-MM-DD` (midnight UTC) or a full time such as `2026-01-12T09:30:00Z` or `2026-01-12T09:30:00-05:00`. A future date **schedules** the post. |
| `updated` | When the post was last revised. Shown on the page and used in feeds. |
| `slug` | The address part. Defaults to the file name without a leading `YYYY-MM-DD-`. |
| `tags` | A list (`[a, b]` or one per line with `- `). Matched case-insensitively. |
| `series` | The slug of a series this post belongs to. |
| `seriesOrder` | Position within the series. Without it, parts are ordered by date. |
| `description` | A sentence or two for feeds, search results, and social cards. Defaults to an excerpt. |
| `cover` | Image shown at the top and used as the social card. Defaults to the first image in the body. |
| `coverAlt` | Alternative text for the cover. |
| `draft` | `true` keeps the post out of every build and feed. |
| `theme` | A theme name, to render this post differently from the rest. |
| `canonical` | If the post was first published elsewhere, that address. Search engines then credit the original. |
| `sourceUrl` | Shown as "Originally published at" under the post. The Hashnode importer fills this in. |
| `aliases` | Old addresses that should redirect here, such as `[/old-slug/]`. Also accepted as `redirectFrom`. |

Unknown fields are kept and ignored, so you can store your own notes in the front matter.

### File names and addresses

A file named `2026-01-12-writing-a-post.md` gets the slug `writing-a-post` and, with the
default settings, the address `/posts/writing-a-post/`. The `postPath` setting changes the
pattern; `"/{slug}/"` puts posts at the site root, which matches most blog platforms.

### Markdown

CommonMark plus the GitHub extensions: tables, task lists, footnotes, and strikethrough.
Raw HTML is passed through, so an `<iframe>` for a video or a `<details>` block works.
Headings get ids and a hover anchor so sections can be linked. A table of contents appears
automatically on posts with three or more section headings (configurable).

Fenced code blocks keep their language and are highlighted in the browser:

````markdown
```rust
fn main() {}
```
````

### Images

Put files in `static/`; they are copied to the site root unchanged. `static/images/a.png`
is `/images/a.png`:

```markdown
![A short description](/images/a.png)
```

In the admin editor, images can be inserted with a button, dragged in, or pasted; they are
saved under `static/images/uploads/<year>/`.

### Drafts

`draft: true` hides a post everywhere. Preview drafts locally with
`openblog serve --drafts`, or in the admin editor, where drafts have their own badge.

### Scheduling

A post whose `date` is in the future is held back from the site, the feeds, the sitemap,
search, and tag and series pages. The first build after that time includes it. When
`openblog serve` is running, it rebuilds by itself at the right moment; on a static host, a
scheduled build (a cron job or workflow) does the same. See [Deploying](deploy.md).

To preview a scheduled post before its time, run `openblog serve --drafts` or
`openblog build --drafts`; the flag includes drafts and scheduled posts. The admin editor
lists them with a "scheduled" badge.

## Series

A series groups posts in reading order and gets its own page. Create
`content/series/<slug>.md`:

```markdown
---
name: Getting started
description: Three short parts that cover the basics.
theme: paper          # optional: every post in the series uses this theme
cover: /images/getting-started.png
order: 1              # position on the /series/ page (lower first)
---

Optional Markdown shown at the top of the series page.
```

Posts join with `series: getting-started`. Each post then shows "Part 2 of 3" with
previous and next links and a list of all parts. If you reference a series that has no
file, one is created from the slug and the build prints a warning.

## Pages

Pages live in `content/pages/` and have no date, tags, or series:

```markdown
---
title: About
nav: true             # add to the header navigation
description: About this blog.
theme: paper          # optional
---

Text.
```

A page named `about.md` is served at `/about/`. The slugs `series`, `tags`, `archive`,
`search`, `page`, `themes`, `assets`, and `api` are reserved by the engine.

## What the engine generates

| Address | Content |
| --- | --- |
| `/` and `/page/2/` ... | The post list, newest first, with a series overview |
| `/posts/<slug>/` | A post (pattern set by `postPath`) |
| `/series/` and `/series/<slug>/` | Series overview and each series that has at least one published post (a series whose parts are all drafts or scheduled has no page yet) |
| `/tags/` and `/tags/<slug>/` | Tags and the posts in each |
| `/archive/` | Every post by year |
| `/search/` | Client-side search |
| `/<page>/` | Pages |
| `/rss.xml`, `/feed.json` | Feeds |
| `/sitemap.xml`, `/robots.txt` | For search engines |
| `/api/blog.json` | The four newest posts as JSON, for other sites |
| `/404.html` | The not-found page most hosts serve automatically |

## Checking your work

```sh
openblog check     # lists every problem with the file name and the reason
openblog build     # the same checks, then writes dist/
```

Typical problems: a missing `date`, a date in an unrecognised format, two posts with the
same slug, a theme that does not exist, or an alias that collides with a real page.
