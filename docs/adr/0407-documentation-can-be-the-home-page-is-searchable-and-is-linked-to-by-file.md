# ADR 0407: Documentation can be the home page, is searchable, and is linked to by file

- Status: Accepted
- Date: 2026-11-11
- Builds on: [ADR 0405](0405-a-documentation-section-is-a-tree-of-pages-under-content-docs-addressed-by-path-and-off-until-enabled.md), [ADR 0406](0406-a-docs-folder-read-on-github-reads-the-same-on-the-site.md)

## Context

The first documentation section left three gaps. A site that is only documentation still had the blog's post list
at `/`, so open.blog's own docs site needed a hand-made landing page. Search indexed posts, reading paths and
comparisons but no pages, so a documentation site's Search found nothing. And a post could not link into the
documentation by file the way the documentation links to itself.

## Decision

- **`docs.home`.** With it on, the section's index is published at `/` in place of the post list and its
  pagination, and `/docs/` is an alias that sends readers there. Links to the index follow it. Posts keep their
  addresses and stay in the archive and feeds. A `landing.json` is not shown, with a warning; `home` without an
  index file is an error. Off and unwritten by default.
- **Documentation pages are in `search.json`**, with no date and the section's title in the `series` field the
  results already show. Other pages stay out, so a site without documentation has the same index as before. The
  results line now joins only the parts it has, and the empty state no longer says "posts".
- **Posts and pages link into `docs/` by file.** A relative link from a post or page that resolves to a Markdown
  file or folder under `docs/` becomes the page's address, keeping the anchor; one that is not a page is a
  warning. Links that do not point into `docs/` are untouched, so nothing else about posts changes.

## Consequences

- open.blog's documentation site uses `docs.home` and has no landing page of its own.
- Search over a large documentation section adds each page's first 4,000 characters to `search.json`, as for posts.
- Still open: search limited to the documentation on a site that also has posts.
