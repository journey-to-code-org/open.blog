# ADR 0041: Feeds and portable copies state a collaborative series' context

- Status: Accepted
- Date: 2026-10-25
- Decision issue: [#185](https://github.com/journey-to-code-org/open.blog/issues/185)
- Parent story: [#151](https://github.com/journey-to-code-org/open.blog/issues/151)
- Parent epic: [#143](https://github.com/journey-to-code-org/open.blog/issues/143)

## Context

[ADR 0040](0040-contributor-aware-series-navigation.md) names each part's authors on the series
page and in its navigation, but only on the site. A feed item or an external copy of a part is read
on its own, away from that navigation: a reader of the second part of a shared series in a feed
reader, or on a platform the post was syndicated to, cannot tell it belongs to a series, where it
falls, or who else wrote it. Before this decision no feed or portable representation carried any
series context at all, so adding it everywhere would change every existing feed and copy.

## Decision

- **A series context** (`SeriesContext`, built by `Site::series_context`) is one published part's
  place in a collaborative series: the series name, its canonical page, its position and the
  number of published parts ("Part 2 of 4"), the part's named authors in credit order, and the
  series' named contributors (`series_contributors`, so one person is named once). It exists only
  when the post is a published part of a collaborative series (ADR 0040). Drafts are not parts,
  even on a site loaded with them, so they never count towards a position, a total or the
  contributors, and a draft has no context. Every value is already public on the series page; it
  reads approved work credits and the series model, never collaboration state, so membership,
  approvals, accounts and publication ids cannot reach it.
- **The projection carries it.** `PortableProjection::for_site` is `from_post` plus the post's
  context; feeds, `openblog export`, syndication and the Admin portable preview use it, so every
  external copy of a part states the same context. Without a context the projection is exactly
  `from_post`'s, byte for byte.
- **Each format states it its own way, and only for a part of a collaborative series:**
  - portable HTML: one paragraph after the work's Contributions list and before the body,
    `<p class="ob-series-context">Part 2 of 4 in the series <a href="…/series/letters/">Letters</a>.
    This part is by Ann, Bo, and Cy. Series contributors: Site Owner, Ann, Bo, Cy, and Dee.</p>`;
  - portable Markdown: the same sentence under `## Series`, after `## Contributions`, with the
    series page as its only link; portable text (JSON Feed `content_text`) follows from it;
  - RSS: a `<category domain="…/series/letters/">Letters</category>`, so a summary-only item still
    names and links its series, besides the full content;
  - JSON Feed: an `_open_blog.series` extension object with `title`, `url`, `part`, `parts`,
    `authors` and `contributors`, which readers that do not know it ignore;
  - llms-full.txt: `- Series:`, `- Part authors:` and `- Series contributors:` lines among the
    post's facts.
  An ordinary part of a collaborative series gets the same context with its own author, so every
  part reads the same way. A clause with no named author is left out, never shown empty.
- **Names stay text.** Series and contributor names are escaped for each format (HTML text, XML,
  Markdown text with `<` and `&` escaped, JSON strings) and never linked; the canonical series page
  is the only link. The site's base URL resolves it, so it is always an absolute HTTP(S) URL.
- **Fail closed.** The series link (with its label), the position, each part author and each
  series contributor are semantic facts of the projection, so a portable HTML, Markdown or text
  artifact that loses or changes any of them fails `ensure_semantics` and the build stops with
  nothing published, exactly as a lost credit does.
- **No remote collections.** Syndication carries the context in the copy's body only. It never
  sets a platform's own series or collection field, because doing so creates collections on the
  remote platform.

## Consequences

- A feed or copy of a part changes, and its source revision with it, when its series gains or loses
  a published part or a contributor, since "Part 2 of 4" and the contributors would otherwise be
  stale. Copies of posts outside a collaborative series never change.
- When a series loses its last collaborative work, its parts' feed items and copies return to their
  earlier output.
