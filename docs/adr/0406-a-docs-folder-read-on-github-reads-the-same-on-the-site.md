# ADR 0406: A docs folder read on GitHub reads the same on the site

- Status: Accepted
- Date: 2026-11-11
- Builds on: [ADR 0405](0405-a-documentation-section-is-a-tree-of-pages-under-content-docs-addressed-by-path-and-off-until-enabled.md)

## Context

The usual place for a project's documentation is a `docs/` folder in its repository, written to be read on GitHub:
a `README.md` introduces each folder, files are titled by their first heading with no front matter, and links point
at other files in the repository, including ones outside `docs/` (`../CHANGELOG.md`, `../src/lib.rs`). open.blog's
own `docs/` is like this. Copied into `content/docs/` as it is, the README files were left out (a README is never
content elsewhere), every page showed its title twice, and links leaving the folder pointed at addresses the site
does not have.

## Decision

- **A README is its folder's page** under `content/docs/`, as GitHub shows it, and as `index.md` is. A folder with
  both is an error (two files for one address). READMEs elsewhere in `content/` are still left out.
- **A file titled by its first heading** (no `title` in front matter) does not repeat that heading: the page prints
  the title as its one `<h1>`.
- **`docs.source`** names where the folder can be read in a repository viewer. With it, each page links to its own
  source, and a relative link the site cannot serve (a file outside `docs/`, or a file in it that is not Markdown)
  is rewritten to that file's address in the viewer, keeping the anchor. A link to a `.md` file inside `docs/` that
  is not a page is still a warning: it is a mistake, not a file to send the reader away to. Without `source`,
  nothing about such links changes.
- **open.blog's documentation site is built this way**, from `docs/` copied into `docs-site/content/docs/` at build
  time, replacing the Jekyll site and its separate copy of the guides. CI builds it and fails on a link warning.

## Consequences

- Any repository's `docs/` folder can be published with no edits to its files.
- The site and the repository cannot drift: there is one copy of each page.
- The engine's own documentation now exercises the documentation section on about 480 pages, so a regression in it
  shows up in CI before a release.
