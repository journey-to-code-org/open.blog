# Sharing, views, analytics, and embeds

## Syntax highlighting

Code blocks are coloured in the browser by `<ob-code highlight>`, a small tokenizer built
into the engine. No library is downloaded and nothing is sent anywhere. It understands
Rust, JavaScript and TypeScript, HTML and XML, CSS, JSON, YAML, TOML, Bash, Python, Ruby,
Go, SQL, Markdown, and the C family (C, C++, Java, C#, Kotlin, Swift). Inside HTML, the
contents of `<script>` and `<style>` are coloured as JavaScript and CSS, and template
literals colour the code inside `${…}`. Unknown languages stay plain, and a tokenizer
error can never blank out the code.

A fence without a language, which is common in posts imported from other platforms, is
guessed from its content: HTML, CSS, JavaScript, TypeScript, shell commands, Rust,
Python, Go, SQL, JSON, YAML, TOML, or the C family. When the guess is unsure the block
stays plain, and a fence marked `text` is never coloured. Tag a fence with its language
to skip the guess.

Colours are theme tokens, so a theme sets its own palette:

```jsonc
"colors": {
  "dark": {
    "codeKeyword": "#c678dd", "codeString": "#98c379", "codeComment": "#7f8794",
    "codeNumber": "#d19a66", "codeFunction": "#61afef", "codeType": "#e5c07b",
    "codeAttr": "#e06c75", "codeTag": "#7aa2ff", "codeMeta": "#61afef", "codeVariable": "#56b6c2",
    "codeProperty": "#e06c75", "codeOperator": "#56b6c2", "codePunctuation": "#abb2bf",
    "codeConstant": "#d19a66", "codeRegex": "#56b6c2"
  }
}
```

Code blocks of two or more lines are numbered. The numbers are drawn by CSS, so copying
the code, with the button or by selecting it, never includes them. Plain-text fences
(`text`, `output`) are not numbered. A block can have a title and highlighted lines
(see [Writing content](content.md#code-blocks)).

A theme sets the defaults with `"options": { "codeHighlighting": false, "codeLineNumbers": false }`.
The blog owner overrides them under `code` in `openblog.json` (where `copyButton: false`
also removes the Copy buttons), a post with `highlight:` or `lineNumbers:` in its front
matter, and one block with its fence options.

A theme that prefers another highlighter sets `"options": { "codeHighlighting": false }`
and loads its own through `scripts`. The engine still adds Copy buttons and line numbers
unless those are turned off, and a site that sets `"code": { "highlight": true }` switches
the built-in colouring back on.

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
  it shows the count as of the last build (see below), and updates live when a counter is
  reachable.
- **In the admin:** the Analytics tab shows views and unique visitors for the last 7, 30, 90,
  or 365 days, a bar per day, top pages, referring sites, and aggregate requests from
  documented AI crawler and user-agent tokens.

```jsonc
"analytics": {
  "builtin": true,        // record views and serve /api/views
  "showViews": true,      // show the count on posts
  "retentionDays": 400,   // daily statistics to keep (all-time totals are kept forever)
  "endpoint": "",         // a counter hosted elsewhere (Cloudflare Worker); empty = same origin
  "branch": "analytics",  // git branch holding the backup of the counts
  "bakeCounts": true      // write known counts into static builds and /api/views.json
}
```

### Static hosts, backups, and a counter you host

The counts are backed up to a git branch, baked into pages at build time so a static host
shows them, and can be recorded by a dependency-free Cloudflare Worker when there is no
server. All of that is in [Publishing from home](publishing.md).

### What it records, and what it never records

Per day and page: views, unique visitors, a count per referring site, and aggregate AI
agent labels. Nothing else.
There are no cookies, and no addresses or browser strings are written to disk. Unique
visitors are counted with a hash of a random daily salt, the address, and the browser string
that lives in memory only and is discarded at midnight, so visits cannot be linked across
days or to a person. A visit counts once per page per browser session. Readers who send
Do Not Track or Global Privacy Control are not counted at all, and neither are automated
browsers. One address can record at most 30 views a minute.

AI-agent requests are counted separately when `openblog serve` returns a public file to a
documented OpenAI, Anthropic, or Perplexity user-agent token. The file stores only a stable
label and requested path—not the raw header or address. A user-agent can be spoofed, so the
dashboard describes claims, not verified identities. Static hosts do not send their request
logs to open.blog, so use the host or CDN's logs there.

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
for that. Every build references stylesheets, scripts, fonts, and images with a
content-derived `?v=` version, so a changed file always gets a new URL. `openblog serve`
sends `Cache-Control: public, max-age=86400` only for those versioned requests and
`no-cache` for everything else (pages, and modules that other scripts import without a
version), so a CDN in front of the server caches what is safe to cache. Views and the
admin are never cached.

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

Recipes (servings scaling, checklists, step timers, cook mode, a print view, and
schema.org recipe data; see [Writing content](content.md#recipes)), GitHub-style callouts,
code-block titles and highlighted lines, reading time, a table of contents for longer
posts, previous and next links, series
navigation, tag pages, an archive, client-side search, RSS and JSON feeds, a sitemap,
Open Graph and JSON-LD metadata, a light and dark toggle, copy buttons on code blocks,
"last updated" dates, canonical links for cross-posts, and print styles.
