---
title: Writing a docs page
navTitle: Writing pages
description: Front matter, order and links in a documentation page.
---

## Front matter

- `title` is the page's heading. Without one, the first `#` heading is used.
- `navTitle` is a shorter title for the sidebar; this page uses "Writing pages".
- `order` puts the pages in a folder in order, lowest first.
- `draft: true` keeps a page off the site.

## Links

Link to another page by its file: [Getting started](../getting-started.md), or a heading on it,
[Install](../getting-started.md#install). The build turns these into the pages' addresses and
warns about a link to a file that does not exist.

## Sections are searchable

Each `##` heading on a page is its own search result, so readers land on the section they need.
Try the search box in the sidebar.
