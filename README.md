# open.blog

An open-source, self-hosted blogging platform built with native web technologies, portable themes, and a focus on owning your content.

- **Markdown in, static site out.** Drop `.md` files in `content/posts/`.
- **Rust core, WebAssembly in the browser.** One crate does front matter, Markdown, themes, feeds, and search. It runs in the CLI and, compiled to WASM, powers search in the page.
- **Native HTML and web components.** Semantic pages, no framework, no client-side build step. Everything works without JavaScript; four small custom elements enhance it, and a theme can ship its own.
- **A real design system.** Themes are JSON design tokens that compile to CSS custom properties. Themes inherit from each other, each **series** (or post) can have its own, and a theme can bring scripts and a heading effect (see `themes/demo/`).
- **RSS, JSON Feed, sitemap** and a snapshot feed for your portfolio.
- **Built-in syntax highlighting** with no external library, URL aliases for moved posts, and a GitHub Pages workflow that also publishes scheduled posts on time.
- **Share links, a cookie-free view counter with an analytics dashboard, related posts, and embed slots** for comments, newsletters, or another analytics service. Optional CDN support with cache-busting asset URLs.
- **Log in, edit, create, and schedule posts** from a browser editor (`openblog serve --admin`), still saving plain Markdown files.
- **Hashnode import that works without Pro.**
- **Few dependencies.** The core needs `pulldown-cmark`, `serde`, and `serde_json`. Only the CLI adds an HTTP client and an HTML-to-Markdown converter, for importing.

## Quick start

```sh
cargo install --path crates/openblog-cli     # installs the `openblog` command
openblog init my-blog && cd my-blog
openblog serve                               # http://localhost:8080, rebuilds on change
```

Or work in this repository directly: `cargo run -p openblog-cli -- serve`.

```sh
openblog new "My first post" --series guide --tags rust,wasm
openblog build            # writes dist/, deploy it to any static host
openblog check            # validate content and themes
openblog themes
```

Search uses WebAssembly. Build it once (needs `cargo install wasm-pack`):

```sh
openblog build-wasm       # writes web/wasm/, which `build` copies to dist/assets/wasm/
```

Search falls back to a small JavaScript matcher if the module is missing.

## A post

```markdown
---
title: Rust enums and match
date: 2026-10-21
tags: [rust, webassembly]
series: rustbound          # slug of content/series/rustbound.md
seriesOrder: 4             # optional; defaults to date order
cover: /images/enums.png
description: Optional; defaults to an excerpt.
draft: false
theme: mnix                # optional per-post override
canonical: https://example.com/original   # optional, for cross-posts
---

Markdown here. Tables, task lists, footnotes, fenced code, and heading anchors included.
```

File names may start with a date (`2026-10-21-my-post.md`); the slug is the rest.
Series live in `content/series/<slug>.md` (`name`, `description`, `theme`, `cover`, `order`).
Pages live in `content/pages/` (`nav: true` adds them to the header).

## Layout

```
openblog.json         site settings: title, url, theme, nav, feeds, paths
content/              posts/ series/ pages/
static/               copied to the site root (images, favicon, CNAME)
themes/<name>/        theme.json (+ theme.css, fonts/)
web/                  base.css, components/, wasm/ (front end; embedded defaults ship in the binary)
crates/openblog-core  the engine (no I/O; also compiles to WebAssembly)
crates/openblog-wasm  wasm-bindgen bindings
crates/openblog-cli   the `openblog` command
```

## Output

`/` and `/page/N/`, `/<slug>/` for posts (configurable with `postPath`), `/series/`,
`/series/<slug>/`, `/tags/`, `/tags/<slug>/`, `/archive/`, `/search/`, pages, `/404.html`,
`/rss.xml`, `/feed.json`, `/sitemap.xml`, `/robots.txt`, `/api/blog.json`, `/search.json`.
Every post has Open Graph tags, JSON-LD, a canonical link, and microformats.

## Docs

- [Deploying: GitHub Pages, other static hosts, self-hosting, moving URLs](docs/deploy.md)
- [The admin editor: login, editing, scheduling](docs/admin.md)
- [Sharing, views, analytics, and embeds](docs/features.md)
- [Themes and the design system](docs/themes.md), including per-series themes
- [Adding web components to a theme](docs/theme-components.md), with the `demo` heading effect to copy
- [Migrating from Hashnode](docs/hashnode-migration.md), with and without Pro
- [Integrating with the mnix.dev portfolio](docs/portfolio-integration.md)

## Development

```sh
cargo test --workspace
cargo clippy --workspace --all-targets
```

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).
