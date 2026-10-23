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
A description or resolvable identifier for a work used as evidence or context.
_Avoid_: Citation when no in-text pointer is meant

**Work identifier**:
A persistent identifier assigned to a published work, distinct from the page URL where a
copy happens to appear.
_Avoid_: Canonical URL, source URL

**Contributor**:
A person or organization publicly credited for a defined role in a published work.
_Avoid_: Admin user, site account, author when the role is more specific

**Contributor identifier**:
A persistent identifier for a person credited on a work.
_Avoid_: Work identifier, profile URL

**Organization identifier**:
A persistent identifier for an organization associated with a work or contributor.
_Avoid_: Contributor identifier, organization website

**Evidence guidance**:
Authoring assistance that checks structure and resolvability without rating truth,
authority, peer review, or professional approval.
_Avoid_: Fact checking, evidence score, trust score
