# Research posts and Evidence Studio

Use the Research content profile for an article that should publish work-level scholarly
metadata and a visible, bounded reference list. The post remains portable Markdown: links,
footnotes, headings, and prose do not depend on a private citation format.

## Start a research post

Choose **Research** under **Settings → Content profile** in the admin, or add the fields by
hand:

```markdown
---
title: Measuring a small intervention
date: 2026-10-23
profile: research
doi: 10.1234/example.study
license: https://creativecommons.org/licenses/by/4.0/
---

## Abstract

State the question, method, important result, and limits in visible prose.

## References

1. [Prior work](https://doi.org/10.1000/prior)
2. [Dataset](https://data.example.org/study)
```

`doi` accepts a DOI name or an `https://doi.org/` resolver URL. The engine preserves the
identifier and normalizes valid output to the HTTPS resolver form. `license` must be an
absolute HTTP or HTTPS URL for the license that applies to the work. Neither field is
required, but an explicitly empty or malformed value produces a finding instead of being
silently treated as verified metadata.

For a complete runnable example, see the repository's
[research and contributor-credit post](../content/posts/2026-02-16-research-and-contributor-credits.md),
its adjacent [credit sidecar](../content/posts/2026-02-16-research-and-contributor-credits.credits.json),
and the synthetic contributor registry in [`openblog.json`](../openblog.json). Together they
demonstrate the Admin Studio workflow, ordered author/editor roles, visible contributions,
research findings, feeds, and structured data without borrowing a real person's ORCID.

The Abstract and References/Bibliography headings must be visible top-level document
sections. A matching heading inside a quote, list item, footnote, code block, or HTML block
does not define the section. References can be list items or prose; resolvable HTTP and HTTPS
links inside the bounded References/Bibliography section become citation URLs. Links
elsewhere in the post do not.

## What readers and machines receive

A research post keeps the ordinary article page and adds:

- a visible work-details panel for a valid DOI resolver link and license link;
- `ScholarlyArticle` JSON-LD with explicit DOI identifier, valid license URL, and bounded
  citation URLs when present;
- `citation_title`, `citation_author`, and `citation_publication_date` Highwire metadata when
  the post resolves at least one actual author. A work-credit sidecar emits one
  `citation_author` tag per `crossref:author`, in authored order.

The engine deliberately does not invent journal, conference, volume, issue, pages,
publisher, funding, contributor roles, or peer-review status. It does not emit partial
venue metadata, `citation_doi`, or Dublin Core fields in this release. Metadata helps a
consumer understand the page; it does not guarantee Google Scholar inclusion, search rank,
an AI citation, or verification of the work.

## Evidence Studio and command-line checks

Open **Evidence** in the admin or press `Alt+7`. The view uses the publishing engine's audit
of the current unsaved document and groups findings as Detected, Potential, or Needs review.
It also shows the authored DOI (normalized to a resolver URL when valid), valid absolute
license URL, and number of linked references. The
Abstract and References toolbar actions consult that same parser before inserting a missing
section, so examples and nested headings are not mistaken for document structure.

The same findings appear during read-only validation, builds, and the startup build report
from the development server:

```sh
openblog check
openblog build
openblog serve
```

Each finding includes a stable code, source field or line and column, outcome, explanation,
and repair. Current codes are:

| Code | Meaning |
| --- | --- |
| `abstract-missing` | No visible top-level Abstract section was found. |
| `references-missing` | No visible top-level References or Bibliography section was found. |
| `doi-invalid` | The authored DOI is empty or lacks broad DOI name structure. |
| `license-url-invalid` | The authored license is not an absolute HTTP or HTTPS URL. |
| `footnote-unresolved` | A Markdown footnote reference has no definition. |
| `reference-link-review` | A reference entry has no resolvable HTTP or HTTPS link and needs human review. |
| `doi-link-non-preferred` | A DOI reference link should use the preferred `https://doi.org/` resolver form. |

These checks establish source structure and syntax only. They do not test whether a DOI
resolves on the network, a source is authoritative, a method is sound, a citation supports a
claim, or a work was peer reviewed. No empty finding list is presented as a quality score.

For the product boundary and supporting standards research, see
[Research and evidence publishing](research/research-evidence-publishing.md) and
[ADR 0002](adr/0002-research-profile-and-evidence-capability.md).
