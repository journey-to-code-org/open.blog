# ADR 0137: One publication boundary, previewed from and enforced on the build's own projections

- Status: Accepted
- Date: 2026-10-26
- Decision issue: [#63](https://github.com/journey-to-code-org/open.blog/issues/63)
- Parent story: [#24](https://github.com/journey-to-code-org/open.blog/issues/24)
- Parent epic: [#15](https://github.com/journey-to-code-org/open.blog/issues/15)
- Builds on: [ADR 0044](0044-what-a-citation-makes-public.md),
  [ADR 0048](0048-citations-publish-through-the-one-publication-projection.md),
  [ADR 0056](0056-one-lock-order-and-cross-store-research-guards.md),
  [ADR 0058](0058-publish-one-allowlisted-knowledge-atlas-projection.md),
  [ADR 0075](0075-publish-approved-claim-evidence-in-the-post-with-public-revision-notes.md),
  [ADR 0092](0092-publish-approved-comparisons-as-one-rights-gated-projection.md),
  [ADR 0099](0099-approved-datings-publish-through-the-atlas-projection.md),
  [ADR 0132](0132-the-research-workspace-is-one-admin-destination-with-one-route-namespace.md),
  [ADR 0134](0134-the-draft-side-research-panel-inserts-only-checked-and-published-research.md),
  [ADR 0136](0136-review-acknowledgements-are-a-private-revisioned-file-of-keys-and-fingerprints.md)

## Context

Research reaches the public site through four projections, each with its own opt-in switch and
its own allowlist: citations publish the public description of the sources a published post cites
(per post, `citations:` front matter), the Knowledge Atlas its approved entries and relationships
and their approved datings (`knowledgeAtlas.publish`), claim evidence the approved claims and links
of published posts (`claimEvidence.publish`), and comparisons the approved alignments
(`comparisons.publish`). Each projection already withholds what it must, and structural guards
refuse a copy of a private file in a public folder or in generated output. What was missing was
one place that says, before a build, exactly what each projection will publish and why everything
else stays private; a guard that does not depend on each projection being right; and an answer
for approvals that no longer hold, dependencies that are not published and web addresses that
should never reach readers. #63 asks for all of it, with preview and production consuming the same
projection.

## Decision

- **One manifest from the build's own values.** `openblog_core::publication_boundary::BoundaryManifest`
  lists, per projection, every item it publishes (kind, id, label, the posts it belongs to, its
  public address, the fields it copies and the fields of it that stay private) and every item it
  withholds with one reason and one sentence naming ids and fields only. It is built from the very
  values a build renders (the `PublicAtlas` and `PublicComparisons` attached to the site, and the
  citations and claim evidence each published post carries), never from a second reading of the
  rules. The private files are read only to say what is withheld and why. A manifest covers the
  whole site (citations, claim evidence, atlas, datings, comparisons) or one post (its citations,
  its claim evidence, and the atlas and comparison pages it links to), and ends with what is never
  published, per file.
- **Preview and production consume the same projection.** `boundary::project` attaches the
  projections to a loaded site exactly as `generate_site` does, and `boundary::manifest` builds the
  manifest from them. The build calls both, then checks its output against that manifest and
  returns it in its report; Admin's `GET /admin/api/research/boundary` loads the saved site the way
  a build does and calls the same two functions, reporting a projection that cannot be built as
  `blocked` instead of refusing. `POST /admin/api/research/boundary` reads one post's unsaved fields
  and body through the preview loader, as the research review does (ADR 0135). Both are read-only,
  Admin-only, behind the session and CSRF seams, and change no file.
- **Withheld reasons are the projections' rules, never judgements.** `projection-off`,
  `not-approved`, `unsourced`, `notebook-passage`, `private-dependency`, `contradiction-withheld`,
  `post-not-published`, `stale-approval`, `page-not-published`; and for one field of a published
  item, `unsafe-url`, `private-identifier`, `rights`, `length` and `stale-anchor`.
- **Stale approvals, missing dependencies and unsafe addresses block only what they affect.**
  - An approved comparison whose place no longer matches the notebook passage it aligns (the
    passage was re-located after approval: the alignments file's `stale-locator` notice) is
    withheld from `/comparisons/` and `comparisons.json`, alone, until the author checks the place
    and updates the member or its passage. Archiving is not staleness: an archived record still
    resolves by design.
  - An approved item whose dependency is not published stays withheld by its projection's
    existing rule (a relationship to a private entry, a dating relative to one, a link on a private
    claim, support while contradiction is private) and the manifest names the dependency. A claim
    whose anchored words moved keeps publishing its statement without the quote (ADR 0075).
  - A web address in a source's identifiers is published only when `public_url_problem` accepts
    it: `http` or `https`, no credentials, a public host (not `localhost`, `.local`, `.internal`,
    `.lan`, `.home.arpa`, `.intranet`, a single-label host, or a loopback, private, link-local,
    carrier-grade or unspecified IP), and no query parameter named like a key, token, signature or
    session. Only the address is withheld, from every projection at once through `public_reference`;
    the rest of the reference is published, and the citation review lists it as
    `citation-identifier-unpublished` (advisory).
  - The build prints each newly withheld item as a `boundary:` warning naming its projection,
    object and field; none fails the build.
- **The output is checked against the boundary before anything is written.** After generating,
  the build refuses when a page exists for an atlas entry or comparison the manifest does not
  publish, or when `atlas.json`, `comparisons.json` or `claim-evidence.json` names an item it does
  not publish.
- **A systematic guard for private research text.** `PrivateText` holds every string of every
  private research file (library, notebook, atlas, claims, alignments, acknowledgements; a file
  that is not JSON is held whole) as 32-byte windows of letters, digits, spaces and non-ASCII
  characters, which read the same in HTML, XML, JSON and Markdown output, compared without case.
  Text that a public input (`openblog.json`, every text file under content, static and themes, the
  contributor registry) or an approved projection (each published post's publication Markdown, the
  atlas, comparison and claim evidence artifacts, and every source's public description, the
  citation allowlist of ADR 0044) also holds is allowed. Any remaining window found in a generated
  file refuses the build, naming the output, the private file, the record's id and the field as a
  JSON path, never the text. `openblog export` applies the same guard to portable Markdown and to
  CSL JSON and BibTeX exports. Shorter text (ids, kinds, dates) is kept out by the projections'
  allowlists and the structural guards, not by this one.
- **A cross-projection leak corpus.** One fixture seeds a distinct sentinel in every private store
  and field (rights and private notes, unknown fields, private identifier schemes, an unsafe
  address, unapproved passages, notes, entries, relationships, datings, claims, links and
  alignments, a stale approved alignment, an acknowledgement) and in every approved projected
  field, builds with every projection on, and proves that no private sentinel appears in the built
  site (pages, feeds, search index, `llms.txt`, JSON artifacts) or in any post's portable Markdown,
  portable HTML, CSL JSON or BibTeX, while every approved sentinel does.
- **Deterministic and backward compatible.** The manifest is ordered by the projections' own
  orders and is the same for the same files; the Admin preview equals the build's report. A site
  with private research but no projection switched on builds byte for byte as before; a site
  without research prints exactly what it printed. Only an unsafe address or a stale approved
  comparison changes what a research site publishes, and both are named.
- **Admin.** The Research workspace gains **What will be public** (`#/research/public`, listed
  with the private panels because the preview itself is Admin-only), and Evidence Studio gains
  **What this post makes public**. Each projection is a labelled section with its switch, then
  "Published (n)" and "Withheld (n)" lists; each item says Published or Withheld in words (the
  visibility labels of ADR 0132), with the fields it copies or the reason, and a withheld item links
  to where it is changed by its own address (an atlas relationship by
  `#/research/atlas/relationships/<id>`). Refresh is announced in a polite status region; the lists
  wrap at 320 pixels and add no motion.

## Consequences

- An author sees, before publishing, exactly what the next build publishes of their research and
  why everything else stays private, from the same values the build writes.
- A bug in any projection, template or exporter that would carry private research text into the
  output stops the build instead of publishing, with a message that says where the text came from.
- A build reads every stored private research file once more for the guard; a site without
  research reads nothing new.
- Text a private note shares, word for word for 32 bytes, with generated template text that no
  public input holds would refuse a build. The refusal names the record and field, so the author
  can change either.

## Domain language

**Publication boundary**, **What will be public**, **Withheld reason**, **Stale approval**,
**Unsafe web address** and **Private text guard** are defined in [`CONTEXT.md`](../../CONTEXT.md).
