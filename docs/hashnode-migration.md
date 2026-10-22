# Migrating from Hashnode

Hashnode retired free access to its GraphQL API on 13 May 2026. Every request now needs a
Pro plan on the publication. `openblog import hashnode` offers two sources so you can
migrate with or without Pro.

## Without Pro: `--source public` (default)

```sh
openblog import hashnode journeytocode.io --limit 3   # trial run
openblog import hashnode journeytocode.io             # everything
```

It reads the pages your readers see:

1. `/sitemap.xml` (and its `?page=N` pages) lists every post URL.
2. Each post page carries schema.org JSON-LD: title, publish and modified dates, cover.
3. The real tags come from the page's `/tag/` links. The series comes from its
   `/series/` link, and each series page lists its parts in reading order, which becomes
   `seriesOrder`.
4. The article body is converted from HTML back to Markdown (headings, fenced code with
   language, lists, tables, images, links).
5. Cover and body images are downloaded to `static/images/<slug>/` and rewritten to
   `/images/<slug>/...`, so the blog no longer depends on Hashnode's CDN. A dead image is
   reported and left pointing at its original URL; it never stops the import.

Output is `content/posts/<date>-<slug>.md` plus `content/series/<series>.md`. Slugs are
kept, so with `postPath: "/{slug}/"` your URLs stay identical. With any other `postPath`,
each imported post gets `aliases: ["/<slug>/"]`, so the old Hashnode address redirects to
the new one. Re-running is safe: unchanged
posts are left alone, and an existing series file (where you may have set a `theme`) is
never overwritten.

Tags that are really keyword dumps (over 40 characters, or containing `#`) are dropped and
listed in the report. Review the rest, because many one-off tags make a long tags page.

Limits: this reads rendered HTML, so unusual Hashnode embeds (iframes, custom widgets) may
convert poorly, and a Hashnode redesign could change the page markup. Drafts are not public,
so they cannot be imported this way. Spot-check a few posts, especially tables and embeds.

## With Pro: `--source graphql`

```sh
HASHNODE_TOKEN=... openblog import hashnode journeytocode.io --source graphql
```

Uses `https://gql.hashnode.com` with your personal access token and returns the original
Markdown exactly, with the same output files and image handling. **This path is written
against Hashnode's documented schema but has not been run, because it needs a Pro
account.** If it fails, the error message says why; the public source remains available.

## After importing

```sh
openblog check     # validates every post, series, tag and theme
openblog serve     # preview at http://localhost:8080
openblog build     # writes dist/
```

Then deploy `dist/` to any static host. To keep `journeytocode.io` working, point that
domain at the new host and keep `"postPath": "/{slug}/"`. Set up the old Hashnode blog to
stop serving that domain first, or leave Hashnode on its `hashnode.dev` address and add
`canonical` front matter to any post you keep cross-posted.
