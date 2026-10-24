# open.blog publishing

open.blog turns author-owned documents into public works. This language keeps field-specific
publishing behavior distinct from reusable attribution, evidence, and distribution concepts.

## Language

**Document**:
An author-owned source item containing publishing metadata and a body.
_Avoid_: Record, entry

**Post**:
A dated document published into feeds, archives, tags, and optional series.
_Avoid_: Article, story, paper when referring to the shared domain entity

**Content profile**:
The single set of field-specific authoring and publishing semantics selected for a post or
provided by the default.
_Avoid_: Document type, editor type, template

**Publishing capability**:
A reusable authoring or output behavior that can apply across multiple content profiles.
_Avoid_: Profile when the behavior is not mutually exclusive

**Published work**:
The public intellectual or creative work represented by a document, independent of its URL
or presentation.
_Avoid_: Page when identity rather than location is meant

## Evidence and identity

**Citation**:
An in-text pointer connecting a passage to a reference.
_Avoid_: Reference, source

**Reference**:
A description or resolvable identifier for a work used as evidence or context. In the
source library, a reference record points at exactly one work, edition, translation, or
witness, never at another reference or a contributor.
_Avoid_: Citation when no in-text pointer is meant; contributor or work credit

**Work identifier**:
A persistent identifier assigned to a published work, distinct from the page URL where a
copy happens to appear.
_Avoid_: Canonical URL, source URL

**Contributor**:
A person or organization publicly credited for a defined role in a published work.
_Avoid_: Admin user, site account, author when the role is more specific

**Author**:
A contributor who holds the author relationship for a particular published work.
_Avoid_: Site owner, publisher, or every person acknowledged on the work

**Work credit**:
An ordered relationship between one contributor and one published work, with one or more
explicitly named roles.
_Avoid_: Contributor profile, global job title

**Contributor identifier**:
A persistent identifier for a person credited on a work.
_Avoid_: Work identifier, profile URL

**Identifier provenance**:
How a contributor identifier was collected, especially manual entry versus an authenticated
provider workflow.
_Avoid_: Treating syntax validation or a resolvable URL as identity verification

**Organization identifier**:
A persistent identifier for an organization associated with a work or contributor.
_Avoid_: Contributor identifier, organization website

**Evidence guidance**:
Authoring assistance that checks structure and resolvability without rating truth,
authority, peer review, or professional approval.
_Avoid_: Fact checking, evidence score, trust score

**Semantic representation**:
The meaning-bearing content and relationships of a published work, independent of a
particular interface or destination payload.
_Avoid_: Rendered HTML when referring to authored meaning

**Portable representation**:
A destination-neutral or destination-specific projection derived from the canonical
published work without becoming a second editable source of truth.
_Avoid_: A separately authored export document

**Portable fallback**:
A derived, usable representation for a capability that a destination cannot render
natively, with any material semantic loss made explicit.
_Avoid_: Silent omission, decorative placeholder

**Portability level**:
The declared relationship between a capability's semantics and its portable output:
Fully portable, Gracefully transformed, or Canonical-only interaction.
_Avoid_: A quality score or promise that every destination behaves identically

**Semantic loss**:
Meaning, structure, attribution, reference identity, or interaction that a portable
representation cannot preserve.
_Avoid_: Merely different styling

**Destination policy**:
Rules for projecting a capability to a particular destination, including its supported
representation, fallback, portability level, and diagnostics.
_Avoid_: Changing the canonical work to satisfy one destination

## Research sources

**Source library**:
An author's private, versioned collection of works, editions, translations, witnesses, and
references reused across research. It is never content and reaches public output only
through an explicit projection.
_Avoid_: Bibliography when the public reference list of one work is meant; database

**Source identifier**:
A stable, author-assigned slug naming one source-library record, independent of its title.
Editing a record never changes its kind; the library does not remember removed ids, so
reusing one after removal is the author's responsibility.
_Avoid_: Work identifier, bibliographic identifier, contributor identifier, URL

**Work**:
An intellectual or creative creation recorded in the source library independently of any
edition, translation, or copy of it; also called the original work.
_Avoid_: Published work when this site's own output is meant; book or edition

**Edition**:
One published realization of a work or of a translation, with its own text, pagination,
and publication details.
_Avoid_: Work, copy, version when a manuscript or translation is meant

**Translation**:
A rendering of a work into another language, recorded separately from the work it
translates and from the edition or witness it was made from.
_Avoid_: Edition, language variant

**Witness**:
One particular manuscript, printed copy, recording, or capture that attests a work,
edition, or translation.
_Avoid_: Edition, or source when a specific exemplar is meant

**Bibliographic identifier**:
A scheme-qualified value such as a DOI, ISBN, ISSN, or URL that describes a source-library
record without replacing its source identifier.
_Avoid_: Source identifier; treating syntax checks as proof the identifier resolves

**Source location**:
A scheme-qualified position, such as a page, folio, line, or timestamp, inside the specific
work, edition, translation, or witness a reference points at.
_Avoid_: Citation, URL fragment

## Admin workspace

**Workspace preferences**:
One admin login's private, schema-versioned presentation choices for Admin Studio: preset,
optional-tool order and visibility, density, and default writing mode. They never change a
document, site configuration, or any public or exported output.
_Avoid_: Settings or configuration when site-wide `openblog.json` behavior is meant

**Workspace preset**:
A named starting arrangement of optional tools (Simple, Guided, Advanced) or Custom, where the
admin chooses each optional tool's visibility. Every preset keeps every capability reachable.
_Avoid_: Mode or role; a preset never grants or removes permissions

**Essential control**:
An Admin control no workspace preference can hide or reorder: Write, Site preview, Settings,
save state, publish status, conflicts, privacy notices, approvals, and blocking validation.
_Avoid_: Default tool, pinned tool
