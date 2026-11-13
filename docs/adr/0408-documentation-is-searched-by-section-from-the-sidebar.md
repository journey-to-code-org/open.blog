# ADR 0408: Documentation is searched by section, from the sidebar

- Status: Accepted
- Date: 2026-11-12
- Builds on: [ADR 0407](0407-documentation-can-be-the-home-page-is-searchable-and-is-linked-to-by-file.md)

## Context

Search was built for articles: one entry per post, its first 4,000 characters, a date to break ties, and a page of its
own reached from the header. ADR 0407 put documentation pages into that index the same way, which falls short for
documentation. A reference page such as Configuration is far longer than 4,000 characters, so most of its keys could
not be found; a match anywhere on a long page sent the reader to the top of it; every result carried the section's
name as its label, which also made a query for that name match every page; and on a documentation site the search
was a header link away from where people read.

## Decision

- **One entry per section.** A documentation page is indexed as its opening (title, description and the text before
  the first `<h2>`) and one entry per `<h2>` section, titled "Page › Section" and addressed `page#section`. Each
  entry holds up to 1,500 characters of its own text, so almost every word of a page is searchable and a result
  leads to the section that matched. The index format is unchanged; these are ordinary entries.
- **Labelled by folder.** A result's label is the title of the folder the page is in (such as "Decision records"),
  and nothing for a page at the top, instead of the section's name on every result.
- **Search from the sidebar.** The documentation sidebar opens with a search box that submits to `/search/` (plain
  HTML, so it works without JavaScript). On a site with documentation the search page's description says it searches
  the documentation too.

## Consequences

- open.blog's own documentation index has about 2,400 entries and is about 2.4 MB uncompressed (from 1.9 MB),
  fetched only when the search page runs a query.
- Posts are indexed exactly as before.
- Still open: a search scoped to the documentation on a site that also has posts, and results grouped by page.
