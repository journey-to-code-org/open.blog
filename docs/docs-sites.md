# Documentation sites

open.blog can publish a project's documentation beside the blog: a folder of Markdown files becomes a tree of pages
at `/docs/`, with a sidebar, previous and next links, and links between the files that work both on GitHub and on
the site. The design is [ADR 0405](adr/0405-a-documentation-section-is-a-tree-of-pages-under-content-docs-addressed-by-path-and-off-until-enabled.md) and [ADR 0406](adr/0406-a-docs-folder-read-on-github-reads-the-same-on-the-site.md).

## Start one

```bash
openblog init my-project --starter docs
cd my-project
openblog serve
```

Open <http://localhost:8080/docs/>. The starter turns the section on, adds a **Docs** link to the header, and writes
four example pages under `content/docs/`. To add a documentation section to an existing site, turn it on in
`openblog.json` and create the folder:

```json
"docs": { "enabled": true, "title": "Documentation" }
```

`title` is the sidebar's heading (default "Documentation"). Add `{ "label": "Docs", "href": "/docs/" }` to `nav` if
you want it in the header. Until `enabled` is true, files in `content/docs/` are not published, and the build says so.

## Where pages go

Each Markdown file under `content/docs/` is a page at the address its path gives:

| File | Address |
| --- | --- |
| `content/docs/index.md` | `/docs/` |
| `content/docs/install.md` | `/docs/install/` |
| `content/docs/guides/index.md` | `/docs/guides/` |
| `content/docs/guides/deploy.md` | `/docs/guides/deploy/` |

A folder's `index.md`, or its `README.md` as GitHub shows it, is the folder's own page and heads its group in the
sidebar (a folder with both is an error). A folder without one is still listed, under its name. Files and folders
whose names start with `_` are left out. A file with no `title` in front matter is titled by its first heading,
which is then not repeated on the page.

## Front matter

```markdown
---
title: Deploying your site
navTitle: Deploying       # optional shorter title for the sidebar
order: 2                  # optional; lower comes first within the folder
description: How to publish the site.
draft: true               # optional; keeps the page off the site
---
```

Within a folder, pages with `order` come first, lowest first, and the rest follow by title. The same order decides
the **Previous** and **Next** links at the foot of each page: a folder's index, then the pages in it, then the next
entry.

## Links between pages

Link to another page by its file, as you would on GitHub:

```markdown
See [installing](install.md), [the Netlify section](guides/deploy.md#netlify) or [all guides](guides/).
```

The build rewrites each link to the page's address and keeps the `#anchor`. A link to a `.md` file that is not a
page under `docs/` is left as written and reported as a warning by `openblog build` and `openblog check`.

## A docs folder that lives in a repository

If the same folder is read on GitHub (or another repository viewer), tell open.blog where:

```json
"docs": { "enabled": true, "source": "https://github.com/you/project/blob/main/docs/" }
```

Each page then ends with a **View this page's source** link, and a link to a file the site does not publish (outside
`docs/`, like `../CHANGELOG.md` or `../src/main.rs`, or a file in `docs/` that is not Markdown) points at that file in
the repository instead of at an address the site does not have. A link to a `.md` file in `docs/` that does not
exist is still reported. open.blog's own documentation site is built this way: see `docs-site/` in the repository.

## The sidebar

The sidebar lists every top-level page and folder, and opens the folders the current page is in, with the current
page marked. On a wide screen it sits beside the page; on a narrow one it is a folded list above it. It is plain
HTML, so it works without JavaScript.

## What is not there yet

- A docs-only site whose home page is the documentation (today `/` is the blog's home; link it to `/docs/` from the
  landing page or `nav`).
- Search limited to the documentation (the site's search covers documentation pages with everything else).
- Links from posts and pages into `docs/` written as `.md` files (write the address, such as `/docs/install/`).
