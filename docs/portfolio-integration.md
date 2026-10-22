# Integrating with the mnix.dev portfolio

The portfolio (`mnichols08/portfolio`) shows the four newest posts. It currently parses
`https://journeytocode.io/rss.xml` in `scripts/lib/blog-feed.mjs`, then serves them from a
Netlify function at `/api/blog` and falls back to `src/assets/data/blog.generated.json`.

Nothing in the portfolio has to change while the blog stays at `journeytocode.io`:

- `/rss.xml` is RSS 2.0 with `title`, `link`, `pubDate`, and `guid`, which is what
  `parseFeed` reads. It contains no DOCTYPE or entities, which that parser rejects.
- Post links are `https://journeytocode.io/<slug>/`, passing the portfolio's origin check.
- Content type is `application/xml`, accepted by its `xml` content-type test.

Two extras if you want them:

- **`/api/blog.json`** is the snapshot in the portfolio's own shape
  (`{ "schemaVersion": 1, "posts": [{ "title", "date", "link" }] }`, four posts). The
  portfolio could `fetch` this and skip RSS parsing, removing its `fast-xml-parser`
  dependency.
- **Same look.** The `mnix` theme reproduces the portfolio design, and the header
  navigation in `openblog.json` links back to the portfolio sections, so the two read as
  one site.

If the blog moves to a different domain, update `feedUrl` in the portfolio's
`scripts/lib/blog-feed.mjs` and the origin in `src/utils/blogData.mjs`, and add
`profile.links.blog` in `profile.config.json`.

## Cross-posting

`/rss.xml` carries full post HTML in `content:encoded` (turn off with
`feeds.fullContent`) and `/feed.json` is JSON Feed 1.1. Most newsletter and cross-post
tools accept RSS directly. Each item has a stable `guid` (its URL), categories from tags,
and the cover as an `enclosure`. When you cross-post elsewhere, set that copy's canonical
URL to the post's address on your blog.
