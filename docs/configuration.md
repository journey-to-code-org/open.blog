# Configuration

All settings live in `openblog.json` at the root of your blog. Every key is optional; the
values below are the defaults. `openblog init` writes the file with every key at its
default, so you can edit values in place and delete the ones you do not need.

```jsonc
{
  "title": "open.blog",
  "description": "A blog built with open.blog",   // meta description and feed subtitle
  "url": "https://example.com",                  // the address the site is published at
  "language": "en",
  "author": { "name": "", "url": "", "email": "" },
  "logo": "",                                    // image beside the title, e.g. /images/logo.png
  "favicon": "",
  "ogImage": "",                                 // social card image for pages without a cover
  "theme": "base",                               // default theme (a folder under themes/)
  "postPath": "/posts/{slug}/",                  // "/{slug}/" puts posts at the root
  "postsPerPage": 10,                            // 0 shows every post on the home page
  "nav": [
    { "label": "Home", "href": "/" },
    { "label": "Series", "href": "/series/" },
    { "label": "Archive", "href": "/archive/" },
    { "label": "Search", "href": "/search/" }
  ],
  "social": [],                                  // footer links, e.g. {"label":"GitHub","href":"..."}
  "footer": "© {year} {author}",
  "poweredBy": true,                             // the "Powered by open.blog" footer link
  "home": { "heading": "Latest posts", "intro": "", "showSeries": true },
  "share": { "enabled": true, "networks": ["x", "bluesky", "linkedin", "reddit", "hackernews", "email"] },
  "analytics": { "builtin": true, "showViews": true, "retentionDays": 400 },
  "snippets": { "head": "", "postFooter": "", "bodyEnd": "" },
  "relatedPosts": 3,
  "cdn": { "url": "", "paths": ["/assets/", "/themes/", "/images/"], "version": "", "maxAge": 86400 },
  "feeds": { "rss": true, "json": true, "sitemap": true, "portfolioSnapshot": true, "limit": 20, "fullContent": true },
  "markdown": { "smartPunctuation": false, "headingAnchors": true, "tocDepth": 3, "tocMinHeadings": 3 },
  "paths": { "content": "content", "static": "static", "output": "dist", "themes": "themes", "web": "web" },
  "admin": { "usersFile": ".openblog/users.json", "sessionHours": 12, "secureCookies": false, "maxUploadMb": 10, "trustedProxies": [] }
}
```

## Site

- **`url`** is used for canonical links, feeds, the sitemap, and social cards, so set it to
  the real public address. If it includes a path (`https://user.github.io/blog`), the site
  is built to live under that path. See [Deploying](deploy.md).
- **`postPath`** must contain `{slug}`; a value without it is silently replaced by the
  default `/posts/{slug}/`, and a leading and trailing `/` are added if missing. Choose it
  before publishing; changing it later moves every post (add `aliases` to the posts to keep
  old links working).
- **`nav`** entries can point anywhere, including other sites. Pages with `nav: true` in
  their front matter are appended after these.
- **`footer`** replaces `{year}` with the year of the newest post and `{author}` with the
  author name.
- **`home.intro`** is Markdown shown above the post list on the first page.

## Share, analytics, related posts, snippets, CDN

These are described in [Sharing, views, analytics, and embeds](features.md).

- `share.networks` accepts `x`, `bluesky`, `mastodon`, `linkedin`, `facebook`, `reddit`,
  `hackernews`, and `email`.
- `analytics.builtin` turns the view counter in `openblog serve` on or off;
  `showViews` controls the count shown on posts.
- `snippets` are raw HTML placed on every page (`head`, `bodyEnd`) or under every post
  (`postFooter`): third-party analytics, comments, newsletter forms.
- `relatedPosts` is how many related posts to show under each post; `0` hides the section.
- `cdn.url`, when set, serves assets from another origin.

## Feeds

- `rss` writes `/rss.xml`, `json` writes `/feed.json` (JSON Feed 1.1), `sitemap` writes
  `/sitemap.xml` and `/robots.txt`.
- `portfolioSnapshot` writes `/api/blog.json`, a small list of the newest four posts for
  embedding on another site. See [Showing your posts on another site](integrations.md).
- `limit` is the number of posts in the RSS and JSON feeds; `fullContent` includes each
  post's HTML in them (good for readers and cross-posting; set `false` for summaries only).

## Markdown

- `smartPunctuation` turns straight quotes and dashes into typographic ones.
- `headingAnchors` adds a hover link to each section heading.
- `tocDepth` is the deepest heading level in the table of contents (`2` for `##` only);
  `tocMinHeadings` is how many headings a post needs before it gets one.

## Paths

Folder names relative to `openblog.json`. `output` is wiped of stale files on every build,
so point it at a folder of its own. The build refuses an output folder that contains the
blog itself or that it did not create.

## Admin

Settings for the browser editor; see [The admin editor](admin.md).

- `usersFile` holds usernames and password hashes. Keep it out of version control.
- `sessionHours` is how long a login lasts.
- `secureCookies` must be `true` when the editor is served over HTTPS (it should be,
  whenever it is reachable from the internet).
- `maxUploadMb` caps image uploads.
- `trustedProxies` lists the addresses of reverse proxies in front of the server, so login
  limits and the view counter see real client addresses.

## Themes

Themes are not configured here beyond `theme`; each theme has its own `theme.json`. See
[Themes](themes.md).
