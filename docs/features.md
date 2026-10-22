# Sharing, views, analytics, and embeds

## Share links

Every post ends with share links. They are plain anchors, so they work without
JavaScript; the `<ob-share>` element adds the device's share sheet ("Share…", where the
browser supports the Web Share API) and a "Copy link" button.

```jsonc
// openblog.json
"share": {
  "enabled": true,
  "networks": ["x", "bluesky", "linkedin", "reddit", "hackernews", "email"]
}
```

Available networks: `x`, `bluesky`, `mastodon`, `linkedin`, `facebook`, `reddit`,
`hackernews`, `email`. Order in the list is display order.

## View counts and analytics

`openblog serve` includes a small view counter. It is on by default and stores its data in
`.openblog/analytics.json`.

- **On posts:** `<ob-views>` shows "N views" next to the reading time. On a static host
  (no server) it stays invisible.
- **In the admin:** the Analytics tab shows views and unique visitors for the last 7, 30, 90,
  or 365 days, a bar per day, top pages, and referring sites.

```jsonc
"analytics": {
  "builtin": true,        // record views and serve /api/views
  "showViews": true,      // show the count on posts
  "retentionDays": 400    // daily statistics to keep (all-time totals are kept forever)
}
```

### What it records, and what it never records

Per day and page: views, unique visitors, and a count per referring site. Nothing else.
There are no cookies, and no addresses or browser strings are written to disk. Unique
visitors are counted with a hash of a random daily salt, the address, and the browser string
that lives in memory only and is discarded at midnight, so visits cannot be linked across
days or to a person. A visit counts once per page per browser session. Readers who send
Do Not Track or Global Privacy Control are not counted at all, and neither are automated
browsers. One address can record at most 30 views a minute.

Behind a reverse proxy, set `admin.trustedProxies` so the real client address is used for
unique visitors and rate limits.

### Using another analytics service instead

Paste the provider's tag into `snippets.head` (see below) and set `analytics.builtin` to
`false` if you do not want both. Plausible, Umami, GoatCounter, and Fathom all work this way.

## Embeds: comments, newsletters, any tag

Three places accept raw HTML from `openblog.json`. It is inserted as-is on every page, so
only put there what you would put in a template yourself.

```jsonc
"snippets": {
  "head": "<script defer data-domain=\"example.com\" src=\"https://plausible.io/js/script.js\"></script>",
  "postFooter": "<script src=\"https://giscus.app/client.js\" data-repo=\"you/blog\" ... crossorigin=\"anonymous\" async></script>",
  "bodyEnd": ""
}
```

- `head` goes before `</head>` on every page: analytics tags, site verification, extra fonts.
- `postFooter` goes at the end of every post, after related posts: giscus or utterances
  comments, a newsletter form, a "buy me a coffee" button.
- `bodyEnd` goes before `</body>` on every page.

## Related posts

Each post ends with up to `relatedPosts` (default 3) other posts, ranked by shared tags
and series. Posts with nothing in common are never listed, so a lone post shows no
section. Set `"relatedPosts": 0` to turn it off.

## Already built in

Reading time, a table of contents for longer posts, previous and next links, series
navigation, tag pages, an archive, client-side search, RSS and JSON feeds, a sitemap,
Open Graph and JSON-LD metadata, a light and dark toggle, copy buttons on code blocks,
"last updated" dates, canonical links for cross-posts, and print styles.
