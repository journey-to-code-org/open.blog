# open.blog

An open-source, self-hosted blogging platform. Write Markdown files, get a fast static
site with feeds, search, themes, scheduling, and an optional browser editor. Built in Rust
and WebAssembly on native HTML and web components, with a focus on owning your content.

- **Markdown in, static site out.** Posts are plain `.md` files in a folder. No database.
- **Themes are design tokens.** A theme is a JSON file of colours, fonts, and sizes that
  compiles to CSS custom properties. Themes inherit from each other, each series can have
  its own, and a theme can ship its own web components.
- **Everything works without JavaScript.** A handful of small custom elements add search,
  a light/dark toggle, copy buttons, syntax highlighting, sharing, and view counts on top.
- **Not only for developers.** Mark a post `profile: recipe` and readers get a recipe card,
  servings scaling, checklists, step timers, a cook mode, a print view, and recipe data
  for search engines. Research posts get DOI and license display, bounded reference metadata,
  scholarly structured data, and evidence guidance. Callouts (`> [!TIP]`) work in any post.
- **Code that reads well.** Colours for common languages (with the language guessed when a
  block has none), line numbers, titles, and highlighted lines. Colours and numbers can be
  turned off for the whole blog or one post, and numbers for a single block.
- **Feeds and metadata built in.** RSS, JSON Feed, sitemap, Open Graph, JSON-LD, canonical
  links, and a small JSON of your latest posts for embedding on another site.
- **Publishing studio.** `openblog serve --admin` adds a login-protected, writing-first
  editor with publishing-faithful themed previews, Open Graph cards, transparent SEO and
  answer-readiness guidance, structured accessibility and research-evidence review,
  source-preserving formatting, uploads, drafts, and scheduling. It edits the same Markdown
  files; front matter stays in Settings and is never rendered in the preview.
- **Publish from home.** A Publish button commits and pushes with git, a GitHub Pages
  workflow deploys, and the repository is the backup. Drafts stay out of commits.
- **Privacy-respecting analytics.** A cookie-free view counter with a dashboard, counts
  backed up to a git branch and baked into static builds, and two counters you can host
  yourself when the site is static: a Cloudflare Worker or a Node service with MongoDB.
- **Import from Hashnode** without a paid plan.
- **Few dependencies.** The engine needs a Markdown parser and JSON support; only the
  command-line tool adds an HTTP client, an HTML-to-Markdown converter, and password hashing.

## Requirements

- [Rust](https://www.rust-lang.org/tools/install) 1.85 or newer (`cargo` on your path),
  to install the `openblog` command. Nothing else: the search engine's WebAssembly module
  is built into the command and written out by `openblog init`.

Windows, macOS, and Linux are supported.

## Install

```sh
cargo install --git https://github.com/journey-to-code-org/open.blog openblog-cli
```

This puts an `openblog` command on your path. To work from a clone instead, run
`cargo run -p openblog-cli -- <command>` in the repository; the clone also contains a
starter site you can run straight away.

## Quick start

```sh
openblog init my-blog          # a starter site: config, a post, a page, three themes
                               # add --github-pages for a ready-made deploy workflow
cd my-blog
openblog serve                 # http://localhost:8080, rebuilds whenever a file changes
```

Then:

```sh
openblog new "My first post"   # creates content/posts/<today>-my-first-post.md
openblog build                 # writes the finished site to dist/
```

Edit `openblog.json` to set your title, description, address, and author. Upload `dist/`
to any static host, or keep running `openblog serve` on a server of your own. See
[Deploying](docs/deploy.md).

To write from a browser:

```sh
openblog user add you          # create a login
openblog serve --admin         # editor at http://localhost:8080/admin
```

## A post

```markdown
---
title: Rust enums and match
date: 2026-10-21
tags: [rust, webassembly]
series: rustbound              # optional: slug of content/series/rustbound.md
description: Optional; an excerpt is used otherwise.
cover: /images/enums.png       # optional
draft: false
---

Markdown here: tables, task lists, footnotes, fenced code, images, raw HTML.
```

A post dated in the future is scheduled and appears by itself when the time comes. The
full list of fields is in [Writing content](docs/content.md).

## Contributor and research demonstration

The repository's runnable example includes a synthetic multi-contributor research post. It
connects the registry in [`openblog.json`](openblog.json) to an adjacent
[`credits.json`](content/posts/2026-02-16-research-and-contributor-credits.credits.json) file
and a portable [Markdown article](content/posts/2026-02-16-research-and-contributor-credits.md).
Run `openblog user add you` once and then `openblog serve --admin` to inspect the credits,
Evidence view, production preview, and social metadata, or run `openblog build` to inspect
the generated page, feeds, and JSON-LD. The demonstration identities are intentionally
synthetic and contain no borrowed ORCID iDs.

## Project layout

```
openblog.json         site settings (title, address, theme, navigation, feeds, ...)
content/posts/        posts plus optional adjacent .credits.json files
content/series/       series descriptions (optional)
content/pages/        pages such as About (optional)
static/               copied to the site root as is (images, favicon, CNAME)
themes/<name>/        theme.json, plus optional theme.css, scripts, and fonts
web/                  the stylesheet, web components, and the search module (wasm/)
dist/                 the generated site (do not edit; rebuilt every time)
```

## Documentation

Start with [the docs index](docs/README.md). The main guides:

- [Writing content](docs/content.md): posts, series, pages, and every front matter field
- [Configuration](docs/configuration.md): every setting in `openblog.json`
- [Themes and the design system](docs/themes.md) and
  [adding web components to a theme](docs/theme-components.md)
- [The admin editor](docs/admin.md): login, editing, scheduling, running it safely
- [Sharing, views, analytics, and embeds](docs/features.md)
- [SEO and answer discovery](docs/seo.md)
- [Accessibility checks and manual review](docs/accessibility.md)
- [Research posts and Evidence Studio](docs/research-profile.md)
- [Video productions and release kits](docs/video-production.md)
- [Field journals and private-by-default tracks](docs/field-journal.md), with a complete example hike
- [Deploying](docs/deploy.md): GitHub Pages, other hosts, self-hosting, moving URLs
- [Publishing from home, backups, and view counts without a server](docs/publishing.md)
- [Cross-posting to Hashnode, DEV, Medium, Ghost, and WordPress](docs/cross-posting.md)
- [Showing your posts on another site](docs/integrations.md)
- [Migrating from Hashnode](docs/hashnode-migration.md)

## Contributing

Issues and pull requests are welcome. The repository is a Cargo workspace:

```
crates/openblog-core   the engine: parsing, rendering, themes, feeds, search (no I/O)
crates/openblog-wasm   WebAssembly bindings for the browser
crates/openblog-cli    the openblog command: build, serve, admin, import
web/                   stylesheet and web components
themes/                base theme and examples
```

```sh
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all
```

Continuous integration runs the same three on every push.

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).
