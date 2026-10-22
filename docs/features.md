# Sharing, views, analytics, and embeds

## Syntax highlighting

Code blocks are coloured in the browser by `<ob-code highlight>`, a small tokenizer built
into the engine. No library is downloaded and nothing is sent anywhere. It understands
Rust, JavaScript and TypeScript, HTML and XML, CSS, JSON, YAML, TOML, Bash, Python, Ruby,
Go, SQL, Markdown, and the C family (C, C++, Java, C#, Kotlin, Swift). Unknown languages
stay plain, and a tokenizer error can never blank out the code.

Colours are theme tokens, so a theme sets its own palette:

```jsonc
"colors": {
  "dark": {
    "codeKeyword": "#c678dd", "codeString": "#98c379", "codeComment": "#7f8794",
    "codeNumber": "#d19a66", "codeFunction": "#61afef", "codeType": "#e5c07b",
    "codeAttr": "#e06c75", "codeTag": "#7aa2ff", "codeMeta": "#7f8794", "codeVariable": "#56b6c2"
  }
}
```

A theme that prefers another highlighter sets `"options": { "codeHighlighting": false }`
and loads its own through `scripts`; the engine then only adds the copy buttons.

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

## Serving assets from a CDN

The site is static, so the simplest CDN setup is to put the whole of `dist/` behind one
(Cloudflare, a CDN in front of your host, or an object store). Nothing needs configuring
for that. `openblog serve` sends `Cache-Control: public, max-age=86400` for asset paths and
`no-cache` for pages, so a CDN in front of the server caches assets and always revalidates
pages. Views and the admin are never cached.

To serve assets from a different origin than the pages, set a CDN URL:

```jsonc
"cdn": {
  "url": "https://cdn.example.com",          // empty disables rewriting
  "paths": ["/assets/", "/themes/", "/images/"],
  "version": "",                             // derived from the files when empty
  "maxAge": 86400
}
```

With `url` set, stylesheet, script, font, and image URLs under those paths point at the CDN
and carry `?v=<version>`, so a changed file gets a new URL and stale copies are never used.
Page links, feeds, and the sitemap keep the site's own URLs. Mirror `dist/` to the CDN
origin (every build, with the same paths) before deploying the pages.

Two things to know:

- Fonts and stylesheets loaded cross-origin need the CDN to send
  `Access-Control-Allow-Origin` for them; most CDNs do, or can be told to.
- The search engine's WebAssembly module stays on the site's own origin on purpose, because
  cross-origin module loading depends on CDN headers that are easy to get wrong.

## Everything else that is already built in

Reading time, a table of contents for longer posts, previous and next links, series
navigation, tag pages, an archive, client-side search, RSS and JSON feeds, a sitemap,
Open Graph and JSON-LD metadata, a light and dark toggle, copy buttons on code blocks,
"last updated" dates, canonical links for cross-posts, and print styles.
