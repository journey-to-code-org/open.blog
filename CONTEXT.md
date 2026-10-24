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
A collaboration effort, identified by a stable opaque publication ID, that brings one or more
ordered source references and one or more ordered participants toward a possible published work.
It is pre-publication state, not another kind of Post or Published work, and one participant is
as valid as two or many.
_Avoid_: Pair, couple, co-authored post, published work before publication

**Shared publication record**:
The private, versioned file that holds one shared publication's title or guiding question, its
ordered source references, its collaboration contract, and its authorization policy together,
outside the content directory. Keeping them in one record is what ties a policy and a contract to
the same publication. Creating, refusing, or revoking a record never changes a Post, Document,
credit, or generated output.
_Avoid_: Draft post, front matter, Post, published work

**Source reference**:
A bounded entry, identified by a stable ID within one shared publication's ordered source
collection, describing material that prompted or informs it: a video, article, podcast, book, or
other source with an author-entered title, an optional original HTTP(S) link, and optional
creator, publisher, date, and (for a book) ISBN. Its provenance records who supplied those values;
provider metadata may only suggest values and never overwrites what an author saved. It is not
automatically evidence cited by the resulting work and does not replace a Citation, Reference,
canonical URL, or Work identifier.
_Avoid_: Citation when there is no in-text pointer, primary source field, provider response

**Participant**:
A person represented by a stable opaque ID within one shared publication. Participation is bound
to an Admin user and a contributor registry entry only through an explicit publication
authorization binding; it grants no site administration authority and implies neither public
credit nor authorship, so the bound entry is not thereby a Contributor.
_Avoid_: Contributor, Author, Admin user, left participant, right participant

**Publication authorization binding**:
An explicit entry in one shared publication's authorization policy that ties one Admin user and
one contributor registry entry to one participant and gives that participant collaboration roles.
It is the only source of collaboration access. It stops granting anything once its account,
registry key, or participant no longer exists, and it creates no authorship, Work credit, reveal,
or approval. Its identity is fixed: changing a binding changes only its roles, so a binding never
moves to another account or participant.
_Avoid_: Contributor registry entry, login, Work credit, invitation

**Pair projection**:
A derived, unpersisted view that presents a shared publication with exactly two ordered
participants as first and second UI slots. It reads the ordinary group collections and adds no
state, so changing the group size never requires a migration.
_Avoid_: Pair, couple, left/right fields, author A/B

**Collaboration role**:
A publication-scoped responsibility, such as site owner, coordinator, contributor, editor, or
reader, that a publication authorization binding gives a participant. It permits only the actions
that policy lists for that one shared publication. The `contributor` role means writing one's own
contribution draft, not holding a public Contributor credit, and no role is promoted to a Work
credit role implicitly. Changing a binding or its roles is itself a role-limited action: only a
site owner can grant, revoke, or touch the site owner role, and a publication that has a site
owner always keeps one.
_Avoid_: Work credit, global job title, site-wide Admin permission

**Contribution draft**:
Untrusted Markdown that one participant owns and offers to a shared publication. It stays private
collaboration state, never stored on a Post or Document, until an explicit assembly and
publication path incorporates it, as it appears in an approved collaboration revision, into the
author-owned Document. A draft has no revision of its own; per-draft revisions would be a later
decision.
_Avoid_: Post, canonical content, public contribution disclosure

**Reveal**:
Permission for an ordered collection of participants to receive one contribution draft. A reveal
does not publish the draft, approve an assembly, or imply a two-person exchange. Only the listed
participants may receive the draft; permission to view revealed drafts in general does not widen
that list.
_Avoid_: Publication, approval, left-to-right handoff

**Approval**:
One participant's consent to exactly one revision of collaboration state, covering every
contribution draft as it appears in that revision. Approval alone does not define quorum,
authorize publication, or assign public credit.
_Avoid_: Publication, Work credit, timeless consent

**Published assembly**:
The explicit, ordered selection of source references and contribution drafts, as they appear in
one approved collaboration revision, that a publication operation incorporates into canonical
content. It names that
publication-time assembly, not a second stored Post or Published work. Participant order does not
determine public credit; publication resolves credit through the existing Work credit model.
_Avoid_: Collaboration transcript, automatic byline, second Post or canonical document

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

**Contributor registry entry**:
A person record in the site's contributor registry, keyed by a contributor ID, that a Work credit
can reference. An entry grants no login or access and is not by itself a Contributor: it becomes
one for a published work only when that work's Work credit names it.
_Avoid_: Contributor before any Work credit, Admin user, Participant

**Author**:
A contributor who holds the author relationship for a particular published work.
_Avoid_: Site owner, publisher, or every person acknowledged on the work

**Work credit**:
An ordered relationship between one contributor and one published work, with one or more
explicitly named roles.
_Avoid_: Contributor profile, global job title

**Admin user**:
An authenticated account that signs in to Admin Studio for one site. It proves who is editing; by
itself it grants no public credit, authorship, or participation in a shared publication.
_Avoid_: Contributor, Participant, Author

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
