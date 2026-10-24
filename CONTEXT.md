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

## Shared publication collaboration

These terms describe private collaboration before publication. They do not replace the public
attribution terms under [Evidence and identity](#evidence-and-identity), and they do not make
collaboration state part of a document or post.

**Shared publication**:
A collaboration effort that brings one or more ordered source references and one or more ordered
participants toward a possible published work. It is pre-publication state, not another kind of
Post or Published work.
_Avoid_: Pair, co-authored post, published work before publication

**Source reference**:
A bounded, ordered description of material that prompted or informs a shared publication. It is
not automatically evidence cited by the resulting work and does not replace a Citation, Reference,
canonical URL, or Work identifier.
_Avoid_: Citation when there is no in-text pointer, canonical source, provider response

**Participant**:
A person represented by a stable opaque ID within one shared publication. Participation grants no
site administration authority and implies neither public credit nor authorship.
_Avoid_: Contributor, Author, Admin user, left participant, right participant

**Pair projection**:
A derived, unpersisted view that presents a shared publication with exactly two ordered
participants as first and second UI slots. It reads the ordinary group collections and adds no
state, so changing the group size never requires a migration.
_Avoid_: Pair, couple, left/right fields, author A/B

**Collaboration role**:
A responsibility held by a participant within the collaboration workflow, such as coordinating or
reviewing. It is not a public Work credit role and must not be promoted to one implicitly.
_Avoid_: Work credit, global job title, authorization claim

**Contribution draft**:
Untrusted, participant-associated draft material offered to a shared publication. It remains
collaboration state until an explicit assembly and publication path incorporates it into the
author-owned Document.
_Avoid_: Post, canonical content, public contribution disclosure

**Reveal**:
Permission for an ordered collection of participants to receive one contribution draft. A reveal
does not publish the draft, approve an assembly, or imply a two-person exchange.
_Avoid_: Publication, approval, left-to-right handoff

**Approval**:
One participant's consent to exactly one revision of collaboration state. Approval alone does not
define quorum, authorize publication, or assign public credit.
_Avoid_: Publication, Work credit, timeless consent

**Published assembly**:
The result of explicitly selecting and ordering source references and contribution drafts for
incorporation into canonical content. It names the publication-time assembly, not a second stored
Post or Published work, and participant order does not determine public credit; publication
resolves credit through the existing Work credit model.
_Avoid_: Collaboration transcript, automatic byline, second canonical document

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
