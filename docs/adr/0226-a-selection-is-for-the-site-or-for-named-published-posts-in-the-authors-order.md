# ADR 0226: A selection is for the site or for named published posts, in the author's order

- Status: Accepted
- Date: 2026-10-26
- Decision issue: [#196](https://github.com/journey-to-code-org/open.blog/issues/196)
- Parent story: [#190](https://github.com/journey-to-code-org/open.blog/issues/190)
- Parent epic: [#15](https://github.com/journey-to-code-org/open.blog/issues/15)
- Builds on: [ADR 0215](0215-curated-research-context-is-one-more-projection-that-selects-only-what-the-other-projections-publish.md), [ADR 0216](0216-a-selection-records-the-revision-it-was-made-against-and-is-stale-when-that-or-anything-it-depends-on-changes.md)

## Context

Curation is done beside one post. A selection that readers of every post are given is a different
choice from one for a single post, and the author orders what a post's readers see. The file
format is unreleased, so it stays at version 1.

## Decision

- **`posts` and `position` are optional fields of a selection.** `posts` is a list of 1 to 50
  post slugs; absent means the whole site. `position` is a whole number, lowest first; absent
  sorts after every positioned item, and ties break by selection id.
- **A v1 record without them means what it always meant.** It is for the whole site and
  unpositioned. Such a file is read and written back byte for byte; the two fields are written
  only when set.
- **Only a published post is ever named.** The published item lists the posts that are both named
  and published by this build, so a draft's slug is never disclosed. A selection scoped to posts
  none of which is published is withheld as `post-not-published`. A scope is syntax-checked when
  it is saved but not matched to a post, so an author can choose before a post is saved.
- **Public order is (first post, position, id).** `PublicCuration.items` puts whole-site items
  first, then each post's by position, then id; `for_post` gives one post's order (its own items
  and the whole site's, by position then id). A selection scoped to several posts has one
  position in all of them.
- **Scope and position are part of the revision** (ADR 0216), but changing them is refused while
  the selection is stale, so ordering never re-blesses an item that changed. An ordering is all
  or nothing.
