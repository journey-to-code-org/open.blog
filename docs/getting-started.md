# Quick Start

This walkthrough gets you from zero to a working local blog with optional GitHub Pages publishing.

## 1) Install

Install the CLI (requires Rust toolchain):

```bash
cargo install --git https://github.com/journey-to-code-org/open.blog openblog-cli
```

Verify installation:

```bash
openblog help
```

## 2) Create a blog

```bash
openblog init my-blog --github-pages
cd my-blog
```

This creates starter content, themes, configuration, and a Pages-ready baseline.

In a terminal, `init` first asks **What will you mostly write?** (press Enter to skip). Say it in a
script with `--kind technical|recipes|trade|teaching|research|podcast|docs|personal`; `trade` and
`docs` use their starters. Studio's first questions start from the answer
([Your first time](admin.md#your-first-time-about-your-blog)).

## 3) Run locally

```bash
openblog serve
```

Default preview is `http://localhost:8080`.

## 4) Create your first post

```bash
openblog new "Hello open.blog" --tags docs,intro
```

Edit the generated Markdown file under `content/posts/`.

## 5) Validate and build

```bash
openblog check
openblog build
```

The static site is written to `dist/`.

## 6) Use Admin Panel (optional)

```bash
openblog serve --admin
```

Use Studio (`openblog serve --admin`, then `/admin/`) to write, schedule, check and publish.

## 7) Publish with Git

```bash
openblog publish "Publish initial docs"
```

If your repository is configured for GitHub Pages, the deploy workflow will publish your site.

## Next references

- [CLI Overview](cli-reference.md)
- [Studio: running your blog](admin.md)
- [Markdown Style Guide](content.md)

## Learn from the example site

The repository's own `content/` folder is a working example site, deployed at
<https://open-blog-jtc.netlify.app>. Each post there shows one feature in use and explains how it
was made, and its Markdown source sits beside it in `content/posts/`. Among the newest:

- **Publishing an audio episode**: an episode with chapters, a transcript and the podcast feed
  (`content/posts/2026-11-05-publishing-an-audio-episode.md`).
- **Where your readers came from**: the "Where it went" report and visit attribution
  (`content/posts/2026-11-09-where-your-readers-came-from.md`).
- **Documentation beside your blog**: the documentation section, with a small handbook in
  `content/docs/` (`content/posts/2026-11-12-documentation-beside-your-blog.md`).
