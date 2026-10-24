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

## Semantic portability

These terms implement the invariant adopted in
[ADR 0004](docs/adr/0004-semantic-portability.md): open.blog has one semantic model of a
document and derives destination-specific output from it.

**Semantic representation**:
The destination-independent meaning loaded from a document, including its content, metadata,
identity, attribution, references, and publishing capabilities.
_Avoid_: Presentation widget, destination payload, a second editable document model

**Portable representation**:
A destination-ready projection derived from the semantic representation without changing the
canonical document. It may use destination-specific syntax while preserving the same meaning.
_Avoid_: Canonical source, independent copy, provider object

**Portable fallback**:
An explicit substitute used when a destination cannot carry a publishing capability directly,
chosen to preserve useful meaning, attribution, reference identity, canonical URL, and source
provenance as far as that destination allows.
_Avoid_: Silent downgrade, best-effort copy with unreported loss

**Portability level**:
The destination policy's declared outcome for one capability: Fully portable, Gracefully
transformed, or Canonical-only interaction.
_Avoid_: Quality score, destination support badge, presentation mode

**Semantic loss**:
Meaning, identity, attribution, provenance, or interaction that a portable representation cannot
preserve and therefore reports explicitly.
_Avoid_: Formatting difference with no change in meaning, unreported omission

**Destination policy**:
The rules that map publishing capabilities to a portability level, allowed portable fallback,
and required semantic-loss report for one destination.
_Avoid_: Destination payload schema, UI component configuration, remote state

## Evidence and identity

**Citation**:
An in-text pointer connecting a passage to a reference.
_Avoid_: Reference, source

**Reference**:
A description or resolvable identifier for a work used as evidence or context.
_Avoid_: Citation when no in-text pointer is meant

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
