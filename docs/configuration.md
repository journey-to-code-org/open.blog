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
  "author": { "name": "", "url": "", "email": "", "sameAs": [] },
  "contributors": {},                           // reusable people for per-post credits
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
  "analytics": { "builtin": true, "showViews": true, "retentionDays": 400, "endpoint": "", "branch": "analytics", "bakeCounts": true },
  "engagement": { "enabled": false, "comments": true, "analytics": true, "endpoint": "" },
  "snippets": { "head": "", "postFooter": "", "bodyEnd": "" },
  "relatedPosts": 3,
  "cdn": { "url": "", "paths": ["/assets/", "/themes/", "/images/"], "version": "", "maxAge": 86400 },
  "feeds": { "rss": true, "json": true, "sitemap": true, "llms": true, "portfolioSnapshot": true, "limit": 20, "fullContent": true },
  "seo": { "aiSearch": true, "aiTraining": true },
  "markdown": { "smartPunctuation": false, "headingAnchors": true, "tocDepth": 3, "tocMinHeadings": 3 },
  "code": { "highlight": null, "lineNumbers": null, "copyButton": true },
  "codeRunner": { "endpoint": "", "languages": [] },
  "recipes": { "scaling": true, "checklists": true, "timers": true, "cookMode": true, "print": true, "jumpLink": true },
  "knowledgeChecks": { "generationEndpoint": "", "model": "" },
  "paths": { "content": "content", "static": "static", "output": "dist", "themes": "themes", "web": "web" },
  "admin": { "usersFile": ".openblog/users.json", "sessionHours": 12, "secureCookies": false, "maxUploadMb": 10, "trustedProxies": [] },
  "publish": { "remote": "origin", "branch": "main", "auto": false, "includeDrafts": false, "paths": ["content", "static", "openblog.json", "themes", ".github"], "pullFirst": true },
  "knowledgeAtlas": { "publish": false }
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
- **`author.sameAs`** lists only public profiles that identify the same person (for example,
  a Mastodon, GitHub, or professional profile). It feeds structured author identity; use
  `social` for generic footer links.
- **`contributors`** is a reusable registry for posts with multiple authors or other
  credited people. Keys are lowercase slugs. Each person supports `name`, `url`, `sameAs`,
  and an optional ORCID iD. Profile `url` accepts an HTTP(S) URL or site-root path; every
  `sameAs` entry must be an absolute HTTP(S) URL. Contributor IDs are referenced by post
  credit sidecars, so treat them as stable identifiers. They can also be managed under
  **Site → Contributors** in Admin Studio. See
  [Work-specific credits](content.md#work-specific-credits).
- **`home.intro`** is Markdown shown above the post list on the first page.

## Share, analytics, related posts, snippets, CDN

These are described in [Sharing, views, analytics, and embeds](features.md).

- `share.networks` accepts `x`, `bluesky`, `mastodon`, `linkedin`, `facebook`, `reddit`,
  `hackernews`, and `email`.
- `analytics.builtin` turns the view counter in `openblog serve` on or off;
  `showViews` controls the count shown on posts. `endpoint` points pages at a counter
  hosted elsewhere, `branch` names the git branch that backs the counts up, and
  `bakeCounts` writes the known counts into static builds. See
  [Publishing from home](publishing.md).
- `engagement.enabled` adds hosted comments and analytics to static deployments;
  `engagement.endpoint` is the public function URL. Database and moderation secrets stay in server
  environment variables or Admin's write-only private credential store.
- `snippets` are raw HTML placed on every page (`head`, `bodyEnd`) or under every post
  (`postFooter`): third-party analytics, comments, newsletter forms.
- `relatedPosts` is how many related posts to show under each post; `0` hides the section.
- `cdn.url`, when set, serves assets from another origin.

## Feeds

- `rss` writes `/rss.xml`, `json` writes `/feed.json` (JSON Feed 1.1), `sitemap` writes
  `/sitemap.xml` and `/robots.txt`.
- `llms` writes `/llms.txt`, a compact text index, and `/llms-full.txt`, the public article
  text in one retrieval-friendly document. This is an emerging answer-engine convention,
  not a ranking requirement; HTML, feeds, and the sitemap remain authoritative.
- `portfolioSnapshot` writes `/api/blog.json`, a small list of the newest four posts for
  embedding on another site. See [Showing your posts on another site](integrations.md).
- `limit` is the number of posts in the RSS and JSON feeds; `fullContent` includes each
  post's HTML in them (good for readers and cross-posting; set `false` for summaries only).

## SEO and AI crawler policy

- `aiSearch` controls the explicit `robots.txt` groups for OAI-SearchBot,
  Claude-SearchBot, and PerplexityBot. Leave it on if you want those answer products to
  discover and cite the blog.
- `aiTraining` independently controls GPTBot, ClaudeBot, and Google-Extended. Turn it off
  to signal that those providers should not use future crawls for their documented training
  purposes without removing the blog from ordinary search.

These are crawler instructions, not access control. See [SEO and answer discovery](seo.md)
for the publishing checklist and analytics limitations.

## Markdown

- `smartPunctuation` turns straight quotes and dashes into typographic ones.
- `headingAnchors` adds a hover link to each section heading.
- `tocDepth` is the deepest heading level in the table of contents (`2` for `##` only);
  `tocMinHeadings` is how many headings a post needs before it gets one.

## Code blocks

- `highlight` colours code blocks; `lineNumbers` numbers blocks of two or more lines.
  Leave them `null` (or out) to follow the theme, which turns both on by default. Set
  `true` or `false` to decide for the whole blog whatever the theme says.
- `copyButton` adds a Copy button to every code block.

A post can override `highlight` and `lineNumbers` in its front matter, and one code block
can override line numbers with its fence options (see [Writing content](content.md#code-blocks)).
The order is: the fence, then the post, then this setting, then the theme.

### External code runner

`codeRunner` is optional. With no endpoint, `rust runnable` keeps using the official Rust
Playground and every other configured-runner language stays a static code block. To enable an
independently hosted execution gateway:

```json
"codeRunner": {
  "endpoint": "https://runner.example.com/v1/execute",
  "languages": ["python", "go"]
}
```

The endpoint must be HTTPS without credentials, a query, or a fragment. `languages` is an explicit
allowlist; Rust is routed through the gateway whenever an endpoint is present, and `web` always uses
open.blog's separate browser-preview sandbox. Unknown languages marked `runnable` remain ordinary
static fences. The endpoint is public and appears in generated HTML: never place a token, API key,
or private runner address in it.

See [Deploying an execution gateway](deploy.md#execution-gateway) for the wire contract and runner
isolation requirements.

## Web sandbox

`webSandbox.libraries` names script files that `web runnable` lessons can load with `libs=`.
open.blog bundles no libraries: put the exact builds you want under `static/` (keeping their
license headers) and list them in load order. Paths must be root-relative files your site serves.

```json
"webSandbox": {
  "libraries": {
    "react": ["/vendor/react.production.min.js", "/vendor/react-dom.production.min.js"],
    "angular": ["/vendor/angular.min.js"]
  }
}
```

The page fetches the files from your own site and inlines them into the lesson's preview, so the
preview still makes no network requests and the files need no special headers. Use UMD or other
classic-script builds that define a global, since lessons cannot `import` from the site.
A name can list several files: a framework that compiles components in the browser, such as
Svelte, can ship its compiler and a runtime bundle together, and the lesson compiles its own
component source before mounting it. Every listed file downloads with the page that uses it,
so keep large compilers to the lessons that need them.
See [Writing content](content.md#html-css-and-javascript-sandboxes).

## Recipes

What readers get on posts using `profile: recipe` (legacy `recipe: true` also works; see
[Writing content](content.md#recipes)).
Every option is on by default; set one to `false` to leave that feature out.

- `scaling`: buttons that scale the amount at the start of each ingredient to more or
  fewer servings. Shown only when the recipe has a number in `servings`.
- `checklists`: checkboxes to tick off ingredients and steps, remembered on the reader's device.
- `timers`: durations in steps ("bake for 25 minutes") become countdown buttons.
- `cookMode`: a "Cook mode" button that keeps the screen awake and enlarges the
  ingredients and steps. Browsers that cannot keep the screen awake do not show it.
- `print`: a "Print recipe" button that prints only the title, the summary, the
  ingredients, and the steps.
- `jumpLink`: a "Jump to recipe" link in the summary card.

## Paths

Folder names relative to `openblog.json`. `output` is wiped of stale files on every build,
so point it at a folder of its own. The build refuses an output folder that contains the
blog itself or that it did not create.

## Knowledge checks

Knowledge checks and their local reader interactions need no configuration. Setting
`generationEndpoint` enables optional author-time question generation and review in the admin
editor when a private credential is saved from the Assistant panel or
`OPENBLOG_LESSONS_API_KEY` is present in the server environment. Environment configuration takes
precedence. `model` is an
optional identifier passed through to that endpoint. See [The admin editor](admin.md#optional-question-generation)
for the endpoint contract and security boundary.

## Admin

Settings for the browser editor; see [The admin editor](admin.md).

- `usersFile` holds usernames and password hashes. Keep it out of version control.
- `sessionHours` is how long a login lasts.
- `secureCookies` must be `true` when the editor is served over HTTPS (it should be,
  whenever it is reachable from the internet).
- `maxUploadMb` caps image uploads.
- `trustedProxies` lists the addresses of reverse proxies in front of the server, so login
  limits and the view counter see real client addresses.

## Publish

How the Publish button and `openblog publish` commit and push; see
[Publishing from home](publishing.md). `paths` lists what gets committed, `includeDrafts`
keeps drafts out of public history unless set, `auto` publishes after every save, and
`pullFirst` rebases on changes made elsewhere before pushing.

## Syndication

`syndication.targets` is a map of user-chosen destination names to DEV, Hashnode, Ghost,
WordPress, or manual Medium settings. `stateFile` points to private remote-ID state and
defaults to `.openblog/syndication.json`. Credentials are environment-only and never belong
in this file. See [Cross-posting](cross-posting.md#built-in-command) for setup and the
[automated syndication specification](specs/automated-syndication.md) for the exact fields,
credential names, and safety behavior.

## Knowledge Atlas

`knowledgeAtlas.publish` (off by default) publishes the approved part of your private
Knowledge Atlas: `/atlas/`, a page per approved entry at `/atlas/<id>/`, and the same data as
`/atlas.json`. Only entries you approved, and relationships you approved whose entries are both
approved, are published, each with who asserts it, its evidence, confidence, doubt and any
dissent; private notes, notebook passages and unapproved items never are. While it is off, no
build reads the atlas. Clearing an approval removes the item from the next build. Add
`{ "label": "Atlas", "href": "/atlas/" }` to `nav` to link it from the header. See the
[Knowledge Atlas format](specs/knowledge-atlas.md#publication).

The atlas is private and Git-ignored, so only a build that can read it publishes it:
`openblog serve` and Admin, or a local `openblog build` whose `dist/` you then upload. A CI or
static-host build from the repository finds no atlas and publishes `/atlas/` and `/atlas.json`
empty; `openblog build` and `openblog check` warn when publishing is on but no atlas is stored.
See [Deploying](deploy.md).

## Themes

Themes are not configured here beyond `theme`; each theme has its own `theme.json`. See
[Themes](themes.md).
