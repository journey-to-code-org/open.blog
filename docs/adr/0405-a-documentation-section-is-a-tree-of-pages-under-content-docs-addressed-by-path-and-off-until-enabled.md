# ADR 0405: A documentation section is a tree of pages under content/docs/, addressed by path and off until enabled

- Status: Accepted
- Date: 2026-11-11

## Context

open.blog's own documentation is about 470 Markdown files in folders (guides, specifications, decision records),
linking to each other as `.md` files so they read correctly on GitHub. Publishing them, or any project's docs, with
open.blog needs things a blog does not: pages in folders, an address that follows the folder, a sidebar that shows
where the reader is, previous and next links, and links written between files that still work once built. Pages
(`content/pages/`) are flat: a page's address comes from its file name alone, so two `install.md` files in
different folders would collide, and changing that would move existing sites' pages.

## Decision

- **A new folder, off until asked for.** Markdown under `content/docs/` is the documentation section. It is built
  only with `"docs": { "enabled": true }` in `openblog.json`. Until then the folder is left out, as it always was,
  and the build warns once that it holds files that are not published, so a site that keeps notes there is
  unchanged. `docs` is not written to `openblog.json` while it has its defaults.
- **The address is the path.** `content/docs/guides/install.md` is `/docs/guides/install/`; a folder's `index.md`
  stands for the folder (`/docs/guides/`) and `content/docs/index.md` is `/docs/`. Each segment is slugified. Two
  files for one address are an error; a page or post that would take `/docs/` is an error while the section is on.
  `README.md` and names starting with `_` stay out, as everywhere in `content/`.
- **Documentation pages are pages.** Each is loaded as a page, so search, the sitemap, `llms.txt`, aliases, themes,
  code blocks and the accessibility checks apply unchanged. It never joins the header navigation by itself; a site
  links `/docs/` from `nav` like any other address.
- **Order.** Within a folder, pages with `order:` come first, lowest first, then the rest by title; a folder's index
  heads its group, and a folder without an index is listed under its name. Reading order (for previous and next) is
  depth first in that order. `navTitle:` gives a shorter sidebar title; `draft: true` keeps a page off the site.
- **The sidebar is bounded.** It lists every top-level entry, and expands only the folders the current page is in,
  so a folder of hundreds of pages costs nothing on pages elsewhere. It is a `<nav>` inside a `<details>` that is
  open in the HTML and works without JavaScript; `<ob-docs-nav>` folds it on narrow screens, where it sits above the
  page.
- **Links are written as files.** A link from a documentation page to a `.md` file or a folder under `docs/`
  (`install.md`, `../guides/`, `deploy.md#netlify`) is rewritten to that page's address, keeping the anchor. A link
  to a `.md` file that is not a documentation page is left as written and reported as a warning.

## Consequences

- A project's docs folder can be copied into `content/docs/` and published with no edits to its links.
- `openblog init --starter docs` writes a short example section and a Docs link.
- Pages stay flat; nothing about `content/pages/` changed.
- Not yet: a docs-only site whose home page is `/docs/` (today the home page is the blog's), per-section search,
  and links from posts or pages into `docs/` written as files.
