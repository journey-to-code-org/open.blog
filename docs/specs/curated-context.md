# Curated research context

Status: implemented for v1 of the format (#197). Decisions:
[ADR 0250](../adr/0250-the-curated-context-file-is-a-bounded-versioned-projection-of-the-one-public-curated-value.md),
[ADR 0251](../adr/0251-a-post-page-carries-its-curated-context-as-a-static-section-with-canonical-anchors.md),
[ADR 0252](../adr/0252-the-text-guard-allows-the-public-curated-value-and-the-manifest-checks-the-file-against-it.md),
[ADR 0253](../adr/0253-nothing-published-means-nothing-written-and-a-refused-file-is-left-out-whole.md) and
[ADR 0254](../adr/0254-portable-output-and-shared-reflections-are-left-to-198-and-a-curation-change-rebuilds-the-served-site.md).

A site that sets `curatedContext.publish` and has selections (see [Curated research
context](../configuration.md#curated-research-context)) publishes two things from one public value:

- `curated-context.json`, a versioned data file that Reader Discovery and any other tool can fetch and
  reuse without reading a private store; and
- on each post's page, a static **Research context** section that says the same thing in readable
  HTML, complete without JavaScript.

Both are read from the one public curated value the boundary manifest lists, so they never disagree and
neither can reach a private object. A site that curates but publishes no selection writes neither.

## `curated-context.json`

Compact JSON, deterministic (the same site builds the same bytes), with `<`, `>` and `&` written as
escapes so authored text can never close a `<script>` element the file is embedded in. At most 1 MiB
and 2,000 posts; a projection over either bound, or one that does not agree with itself, is left out
whole and the build says why (`boundary:`); the pages are unaffected.

| Member | Meaning |
| --- | --- |
| `format`, `formatVersion` | `openblog-curated-context-file` and `1` (distinct from the public value's own `openblog-curated-context`: the file is a projection of it). A reader of another version declines. |
| `section` | The id of the section on a post's page (`ob-research-context`). |
| `anchorPrefix` | The prefix of each item's fragment (`ob-curated-`). |
| `items` | Every published selection, whole-site first, then by first post and the author's order there. Each carries `id`, `kind`, `target`, `revision` (the revision that was selected, which is the one published), `content` (only the fields the author listed, plus the attribution, doubt, dissent and evidence the kind always carries), `provenance` (`authored`, `imported` with where from, or `unrecorded`), `missing` (selected details the source lacks: never invented), `requires`, `posts`, `positions` and `notices`. |
| `context` | The approved sources, entries and relationships a published item needs to be understood, sorted by kind then id, each with the ids it is `via`. |
| `posts` | For each published post that offers anything, sorted by slug: `post`, its `url`, its `items` in that post's own order (`id` and the canonical `url` of the item's anchor on the post's page) and the `context` it needs. |

An item is published once; `requires` and `via` name published items only; a selection that is
withdrawn, stale, missing, unapproved, cyclic or for no published post is not in the file (the
[boundary preview](../admin.md) says why). Nothing in it can be queried for more: its only addresses are
public pages. Relationships keep their stored direction and assertion; nothing says one is true.

## The page section

A `<section id="ob-research-context" aria-labelledby="ob-research-context-title">` after the post's text. It
holds an `<h2>`, a note that nothing in it is a verdict, an ordered list with one `<li id="ob-curated-ID">`
per item (an `<h3>`, then a definition list of the selected fields), and a "What these refer to" list of
the sources and entries the items cite, which the items link to. Every string is escaped; the only links
are to this site's pages and to a source's own `https` address. The order in the document is the reading
order. It wraps anywhere (so it reflows at 320 pixels and at 400% zoom), keeps each item whole in print,
and needs no script. A post that is offered nothing has no section and is byte for byte what it was.

## What is left to portable output

Feeds, portable Markdown, text and HTML, and shared reflections do not carry the section: they are built
from the post, not its page. Carrying the selected facts across them, with loss diagnostics, is #198;
this file and the section are the public projection it reads.
