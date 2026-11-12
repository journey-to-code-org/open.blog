---
title: Moving a post without breaking links
subtitle: Slugs, redirects from old addresses, revision dates and canonical links.
date: 2026-04-20
updated: 2026-05-02
series: writers-toolkit
seriesOrder: 6
slug: moving-a-post-without-breaking-links
aliases:
  - /posts/renaming-a-post/
  - /posts/old-addresses/
tags:
  - guide
  - seo
description: Change a post's address and keep every old link working, mark a real revision with an updated date, and credit the original when a post started elsewhere.
---

Links to your posts live in emails, bookmarks, search results and other people's articles. If an
address changes and the old one breaks, all of those readers hit a dead end. This part covers the
four front matter fields that keep links healthy.

## Choosing the address: `slug`

A post's address comes from its file name. This file is
`2026-04-20-moving-a-post-without-breaking-links.md`. The leading date is dropped, and the rest
becomes the slug, so the post lives at `/posts/moving-a-post-without-breaking-links/`.

To choose a different address without renaming the file, set `slug:` in the front matter:

```yaml
slug: moving-a-post-without-breaking-links
```

The overall pattern is `postPath` in `openblog.json`. The default is `"/posts/{slug}/"`, and
`"/{slug}/"` puts posts at the site root, as most blog platforms do.

## Keeping old addresses working: `aliases`

This post used to live at two other addresses. Try them:
[/posts/renaming-a-post/](/posts/renaming-a-post/) and
[/posts/old-addresses/](/posts/old-addresses/). Both bring you back here, because the front
matter lists them:

```yaml
aliases:
  - /posts/renaming-a-post/
  - /posts/old-addresses/
```

open.blog writes a small redirect page at each old address. Many hosts (Netlify, Cloudflare
Pages and others) also read a `_redirects` file and send a real, permanent `301` redirect, which
search engines prefer. Ask for that file in `openblog.json`:

```json
"redirectsFile": true
```

Aliases work on pages and series too. `redirectFrom` is accepted as another name for the same
field, which helps when you move posts from another blog generator. If an alias would collide
with a real page, `openblog check` says so.

> [!TIP]
> Whenever you change a slug, add the old address as an alias in the same edit. It costs one
> line and keeps every existing link working.

## Marking a real revision: `updated`

When a post changes in a way that matters to a reader, such as a corrected step or a new
section, add `updated:`. This post has one, so it shows "Updated" beside its date, and feeds and
search engines learn it changed:

```yaml
date: 2026-04-20
updated: 2026-05-02
```

Leave it out for typo fixes. It is a signal to readers, so use it when something they relied on
changed.

## Crediting the original: `canonical` and `sourceUrl`

If you first published a post somewhere else and are bringing it home, tell search engines which
copy is the original:

```yaml
canonical: https://dev.to/you/the-original-post
sourceUrl: https://dev.to/you/the-original-post
```

`canonical` goes in the page's metadata for search engines. `sourceUrl` shows readers an
"Originally published at" line. The Hashnode importer fills in `sourceUrl` for you. Going the
other way, publishing here first and copying elsewhere, is covered in
[Safely cross-posting your blog](/posts/automated-cross-posting/).

Next: [Writing in the Admin editor](/posts/writing-in-the-admin-editor/).
