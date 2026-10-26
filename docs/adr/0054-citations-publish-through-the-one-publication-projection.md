# ADR 0054: Citations publish as generated Markdown notes through the one publication projection

- Status: Accepted
- Date: 2026-10-25
- Decision issue: [#42](https://github.com/journey-to-code-org/open.blog/issues/42)
- Parent story: [#19](https://github.com/journey-to-code-org/open.blog/issues/19)
- Parent epic: [#15](https://github.com/journey-to-code-org/open.blog/issues/15)
- Builds on: [ADR 0004](0004-portable-projections-from-canonical-work.md),
  [ADR 0049](0049-opt-in-citation-markdown-syntax.md),
  [ADR 0050](0050-what-a-citation-makes-public.md)
- Amends: [ADR 0012](0012-source-library-interchange.md) (builds now read the library, for opted-in posts only)
- Contract: [Citation format](../specs/citations.md)

## Context

Citations had a scanner, a resolver and a public reference type, but no build step called them.
Issue #92 gives one semantic publication projection to every public representation (native page,
portable HTML, Markdown and text, RSS, JSON Feed, `llms.txt`, destination adapters); a feature
registers semantics and fallbacks and does not build an exporter of its own. Existing posts must
publish byte for byte as before, and the source library is private author research.

## Decision

- **Opt in per post.** A post publishes citations only when its front matter sets
  `citations: notes` or `citations: bibliography` (`true` means `notes`; `false` or no key means
  not at all). Anything else is an error for that post. A post that opts in but cites nothing is
  published exactly as if it had not.
- **One published body.** At load, an opted-in post's citations are scanned with the core
  scanner, resolved against the library, and each `[@...]` span is replaced by an ordinary
  footnote reference `[^cite-N]`. The generated notes are appended under one level-2 heading as
  footnote definitions. That Markdown is the post's **publication Markdown**
  (`Post::publication_markdown`): the native page renders it, and the portable projection, feeds
  and `llms.txt` read it in place of the authored body. The authored body and the file on disk
  never change. Footnotes are already portable everywhere, so citations need no new fallback;
  the `citations` capability is registered as fully portable with a `markdown-footnotes`
  fallback.
- **Labels never collide.** Generated labels use the prefix `cite-` unless an author footnote
  already uses `cite-` plus a number; then `cite2-`, `cite3-` and so on. The author's footnotes
  keep their labels, text and markup, and share one numbering with the generated ones (first use,
  as the HTML writer numbers them).
- **Markers stay markers.** A `(`, `[` or `:` straight after a generated marker is escaped, so it
  cannot join the marker into a link or a definition; the rendered text is unchanged. After
  writing, the published body is parsed again and must hold exactly one generated marker per
  citation and one generated note per number. An unclosed code block, HTML block or comment at the
  end of a post would swallow the notes; such a post is refused, not published with citations
  missing.
- **Deterministic and offline.** Notes are numbered in order of first citation; text is escaped
  Markdown built from the `PublicReference` allowlist (ADR 0050); nothing depends on time, the
  machine's locale or hash order. A DOI links to `https://doi.org/`, a web address links to
  itself only when it is a plain HTTP(S) address without credentials, and other public schemes
  are text.
- **The library is read only when needed.** The CLI hands the stored library's text to the load
  through the same symlink, containment and size checks as Admin storage. The load parses it on
  first need, so a site without citations never reads it, and a broken or unreadable library
  refuses only the posts that cite, with a message that names the file and `openblog check`
  and never repeats its contents. `load_post` (used for listings and status) reads no library and
  leaves citations as text; `Site::load` and `load_post_cited` publish them.

## Consequences

- Every representation shows the same notes with the same numbers, because there is one body.
- Existing posts, including legacy research posts with a hand-written References section and
  posts that merely contain `[@handle]` text, are untouched; the tests compare whole builds with
  and without a library.
- Search text, the table of contents and the reading-time estimate include the generated notes,
  which are public anyway.
- A shared reflection that opted in would publish its notes after its arrangement; that
  combination has no dedicated presentation yet.

## Domain language

**Publication Markdown**, **Citation note** and **Bibliography** are defined in
[`CONTEXT.md`](../../CONTEXT.md).
