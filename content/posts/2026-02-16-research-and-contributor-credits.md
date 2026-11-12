---
title: Research posts and contributor credits
date: 2026-02-16
series: research-and-collaboration
seriesOrder: 1
tags:
  - research
  - guide
  - collaboration
description: A working example of research metadata, ordered authorship, contributor roles, references, and the Admin Studio workflow.
profile: research
license: https://creativecommons.org/licenses/by/4.0/
---

## Abstract

This working example shows how a portable Markdown article can publish research-oriented
metadata and credit more than one person without putting identity data in front matter. The
post selects the `research` profile, while an adjacent JSON sidecar supplies ordered authorship
and controlled contributor roles.

## Follow the source files

Three files make the demonstration work:

1. `openblog.json` registers the reusable `example-author` and `example-editor` identities.
2. This Markdown file contains the article, license, Abstract, and References sections.
3. `2026-02-16-research-and-contributor-credits.credits.json` connects those identities to
   this work with Crossref and CRediT roles.

The identities are deliberately synthetic and their ORCID fields are empty. Replace them with
real people and add only identifiers those people actually control. Manually entered ORCID iDs
remain visibly labeled as unauthenticated.

## What to inspect

Open this post in Admin Studio to see the same data from an author's point of view:

- **Settings → Credit contributors and roles** preserves credit order and exposes controlled
  roles.
- **Evidence** reports the research structure and bounded reference links below.
- **Site preview** renders the production byline, work details, and Contributions panel.
- **Social** uses the same publishing-engine metadata as the generated page.

After `openblog build`, inspect this page, `rss.xml`, `feed.json`, and the page's JSON-LD.
Only the Crossref author appears in author-only metadata; both people and all their roles remain
visible in the Contributions panel.

## Footnotes as references

Research posts can use ordinary Markdown footnotes for asides and sources.[^roles] The Evidence
view checks that a References or Bibliography section exists and that its links are well formed.
It does not judge whether a source is right; that is the author's job.

Next: [Which writing rules still matter?](/posts/which-writing-rules-still-matter/), a shared
reflection by two contributors.

## References

1. [CRediT role taxonomy](https://credit.niso.org/)
2. [Crossref contributor guidance](https://www.crossref.org/documentation/schema-library/markup-guide-metadata-segments/contributors/)

[^roles]: CRediT has fourteen roles, from `conceptualization` to `writing-review-editing`. Crossref
    roles such as `author`, `editor` and `translator` decide who appears in the byline.
