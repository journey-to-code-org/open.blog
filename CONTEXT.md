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

**Public source attribution**:
The approved public subset of a shared publication's first (original) Source reference: its
title, optional link, and type, plus the guiding question. It is published as plain front matter
on the resulting Post and shown as a link beside the work, never as an embed, in the page, feeds,
and portable exports. Participants, contributions, invitations, approvals, source IDs,
provenance, creators, publishers, dates, and ISBNs are not part of it.
_Avoid_: Citation, Source reference (the private entry), Work credit

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

**Invitation**:
A single-use, expiring offer, scoped to one shared publication, for one named Admin user and
contributor registry entry to join with stated roles. Its token is shown once as a copyable
link, stored only as a hash, and never emailed. Accepting it by the named account adds a new
participant and an explicit publication authorization binding in one write; it never takes over
an existing participant. An invitation grants nothing until accepted.
_Avoid_: Binding (the result of accepting), account creation, email invite

**Member**:
A person whose Admin account holds an explicit binding on one shared publication. Ending a
member's access removes only the binding; the participant and the credit for what they wrote stay.
_Avoid_: User (account administration is separate), contributor (credit, not access)

**Publish gate**:
The check that publishing a shared publication needs the publish grant and an approval of the
current revision from every participant who owns a contribution. Site ownership alone never
satisfies it.
_Avoid_: Approval quorum (a separate contract)

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
author-owned Document. A draft changes only by appending numbered, immutable revisions, each
identified by a prose-free stamp of contribution, number, author, timestamp, and content digest.
Its owner reads and saves it through Admin; each participant has one, kept in private project storage
(ADR 0017).
_Avoid_: Post, canonical content, public contribution disclosure

**Reveal**:
Permission for an ordered collection of participants to receive one exact revision of a
contribution draft, granted only by a mutual exchange that takes effect for all members at once or
for none. A reveal does not publish the draft, approve an assembly, or imply a two-person exchange. Only the listed
participants may receive the draft; permission to view revealed drafts in general does not widen
that list.
A coordinator-chosen reveal policy (independent, voluntary, all-ready) and each participant's
per-revision readiness decide when an exchange forms (ADR 0018). A publication has one author set, so
voluntary visibility is derived at read time from the active participants' standing offers: each
sees exactly the revision the others currently offer, and nothing is stored or merged.
The Shared reflections draft panel offers a revision only after an explicit confirmation, because a
copy that has been read cannot be recalled (ADR 0019).
_Avoid_: Publication, approval, left-to-right handoff

**Approval**:
One author's affirmative, timestamped consent to publish exactly the content their snapshot is
bound to: their own section revisions (or every section under the whole-piece scope), the author
set, section order, public title and source attribution, and the approval policy (ADR 0020). It
counts only while the recomputed binding still matches, so any covered change invalidates it.
Only the author can give or withdraw it; a site owner or coordinator cannot, and a publish grant
never replaces it; the publish gate checks it again at publication (ADR 0022). It is not an electronic signature, and alone it does not assign public credit.
_Avoid_: Publication, Work credit, timeless consent

**Synthesis item**:
An optional statement the authors of a shared reflection make together: an agreement, difference,
question, application or uncertainty, written as untrusted Markdown and attributed in order to one,
some or all authors. No kind is required, an empty synthesis is complete, and disagreement is never
an error. An author can add attributions but removes only their own name (withdrawal). Each item
records which attributed authors approved it, bound to its revision (any change clears them), and
everyone named on an item must approve the piece. Approval binds
to the exact items, order and attribution, and the set stays private until a later step publishes it
(ADR 0024). Contributors write and approve them in Admin through one `EditSynthesis` grant, and
the publish gate waits for every item to be approved by every author it names (ADR 0025).
When the piece publishes, only fully approved items appear, after the authors' sections under
"Continuing the conversation" (ADR 0026).
_Avoid_: Consensus, summary, comment

**Continuing the conversation**:
The published section of a shared reflection holding its approved synthesis items, grouped by kind
(shared takeaways, where we differ, questions, ways to apply, what we are unsure about), each item
headed "Speaking for" the authors it names and anchored by kind and ordinal. It is ordinary Post
Markdown, so it reaches the page, feeds and exports with the rest; it has no heading when nothing
is approved, and it never signals consensus or lists approvers (ADR 0026). Its anchors are
reserved and item headings start at level five (ADR 0027). Portable output carries it with
attribution and stable anchors; summaries stop before it and summary-only feeds omit it (ADR 0028).
_Avoid_: Summary, consensus, comments

**Combined preview**:
The side-effect-free review of the whole piece an author sees before approving: every author's
section in order at its exact latest revision (an author who wrote nothing has no section and
does not block it), each author's approval state (approved, awaiting, or
stale), and whether the piece is complete and ready. A section appears only if the reader may read
that latest revision; every other case is one identical placeholder. It opens with a "Preview, not
published" notice, runs no script and loads nothing (ADR 0021).
_Avoid_: Draft view, published page, staging copy

**Publish gate**:
The single operation that turns approved drafts into a Post, for "publish now" and for a scheduled
time falling due. It runs only for a requester holding the publish grant, only while
`ApprovalSet::evaluate` passes against the content as it is at that moment, and writes the Post,
its credits, the private outcome and the rebuilt output as one unit that is undone if any step
fails. A retry changes nothing. A scheduled publication is held in private state, not content, and
passes the gate again when it falls due (ADR 0022). The gate also refuses a piece whose joined page
would differ from the sections as each author previewed them, or carry active markup (ADR 0022).
_Avoid_: Auto-publish, scheduled Post written ahead of approval

**Published shared reflection**:
The Post a publish gate writes, shown as an ordinary Post in every representation: the native page,
portable HTML, Markdown and text, RSS, JSON Feed and the text discovery files. It has no
representation of its own. Every written section appears in participant order, each author who wrote
one is credited in that order, and the shared source and guiding question appear as a plain link
(ADR 0008). Nothing else of the collaboration reaches it: no draft revision, invitation, approval,
account name or publication id (ADR 0023).
_Avoid_: Shared page, collaboration export

**Reflection structure**:
The ordered rounds, round prompts and turns of a shared reflection, plus one chosen Reflection
layout, and the only authority for how it is arranged. A turn names one part of one draft, never a
person, so the structure holds no identity and no gendered or positional field (ADR 0029). A draft
splits into ordered parts at a line that is exactly `<!-- openblog:part -->`; without it a draft is
one part. Once wired, its turn order, round prompts and layout are part of what an author approves
(ADR 0030).
_Avoid_: Left/right, author A/B, theme, template, the contract's region layout

**Reflection layout**:
One of sequential, side-by-side, point-counterpoint, alternating dialogue or roundtable: a
presentation of the same structure. Changing it rewrites no prose, and it never decides identity,
authority or credit. Every layout reads in the one Reading order (ADR 0030). It is not the
collaboration contract's `layout` field, a reserved list of contribution-to-region pairs that nothing
reads and the next contract version drops.
_Avoid_: Role, side, speaker slot, contract layout, region layout

**Arrangement**:
The stored Reflection structure as a coordinator edits it: the chosen layout, the rounds, round
prompts, the order of turns and each turn's optional label. It is private until published,
holds no prose, is saved with a revision check, and is part of what every author approves, so
changing it makes standing approvals stale (ADR 0030, ADR 0031). A reflection with no arrangement
publishes in participant order.
_Avoid_: Template, theme, layout setting

**Turn label**:
An optional short phrase an author-coordinator writes for one turn of an arrangement, such as "Point"
or "Reply". It is public text, bound to approval with the rest of the arrangement, escaped on
output, and shown under the turn's author heading. No layout invents one, and it is dropped with its
turn (ADR 0032).
_Avoid_: Side, role, stance, speaker slot

**Portable reflection**:
The static equivalent of a published reflection in portable HTML, Markdown, text, feeds and llms
output: each round prompt, then every turn under its author's name and optional label, in reading
order, whatever the layout. It carries no placement, class, placeholder or part marker, and the
layout is reported once as a diagnostic instead of lost silently (ADR 0033).
_Avoid_: Layout export, flattened copy

**Part break**:
The line `<!-- openblog:part -->` a writer places in their own draft to start a new part. It is
never rendered or published: the preview, the Post, feeds and exports all drop it (ADR 0031).
_Avoid_: Page break, horizontal rule

**Round prompt**:
The optional public cue or question a round of a reflection structure answers, read once before its
first answer. It is not an editor prompt (ADR 0019), which is a never-stored hint inside the draft
editor, and a round is not an exchange, which means a mutual reveal.
_Avoid_: Editor prompt, exchange

**Reading order**:
The deterministic linear sequence of a reflection structure: rounds, then turns, with each round's
round prompt before its first answer. Shared by every layout. The requester-scoped form shows the
same placeholder for any turn the requester cannot read (ADR 0021); the unscoped form is for the
publish gate only. The portable equivalent can share it once #173 wires it.
_Avoid_: Visual order

**Series placement**:
The optional series reference and position a shared publication carries, written as an ordinary
Post's `series` and `seriesOrder`. It is not a collaborative series: the site's existing series
supplies name, description, theme, ordering and navigation. It is public, so it is part of what
every author approves (ADR 0036). Site owners and coordinators set it (`PlaceInSeries`) against
its revision, every participant sees it with the reading order it would join, and only site owners
add a new series definition (`CreateSeries`); the list and order come from published posts only
(ADR 0037).
_Avoid_: Collaborative series, series template

**Series definition**:
The site-owned `content/series/<slug>.md` that names a series and describes its recurring premise.
A shared publication never writes one; a site owner may add a new one from its Series panel, and
it is not public until a part is published (ADR 0037).
_Avoid_: Collaborative series, series template

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

**Raw HTML policy**:
The fixed allowlist the portable projection applies to authored raw HTML: static content
elements are kept, active or destination-hostile markup is removed, unwrapped, or replaced
with a canonical link, and every removal of reader content is reported.
_Avoid_: Sanitizer (a general-purpose API), passing authored HTML through to a destination

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

**Library revision**:
The fingerprint of the source library as stored, which every change must name so that a
change based on an older read is refused instead of overwriting newer work.
_Avoid_: Version, which names the file format; edition

**Archived source**:
A source-library record hidden from everyday lists but kept in place, so records that
point at it still resolve. Archiving is reversible and is not removal.
_Avoid_: Deleted, removed, hidden source

**Import plan**:
The preview of a CSL JSON import: for each item whether it would create, update, leave
unchanged, or conflict with a source, what it keeps, and which fields cannot be stored.
Nothing is written until a plan with no conflicts is applied.
_Avoid_: Dry run when the result of applying it is meant

**Notebook**:
An author's private, versioned collection of quoted passages and research notes that point
into the source library. It is never content and has no public form of its own; research
becomes public only through an explicit projection.
_Avoid_: Source library, bibliography, journal

**Passage**:
An excerpt of one source-library record together with where in it the excerpt sits. A
passage keeps its source for life and holds quoted text, never the author's prose.
_Avoid_: Quote block, citation, annotation

**Quoted excerpt**:
The verbatim text of a passage, stored exactly as quoted and apart from every field of
author prose. It is someone else's words and carries no claim that it is accurate or
permitted to republish.
_Avoid_: Note text, summary, content

**Locator**:
One position inside a source, with a kind such as page, folio, line, canonical reference,
or an `x-` extension kind, and an optional range end. A passage lists several in order for a
compound location.
_Avoid_: Location when the single source-library record location is meant; citation

**Notebook revision**:
The fingerprint of the notebook as stored, which every capture, edit, and removal must name
so that a change based on an older read is refused instead of overwriting newer research.
_Avoid_: Version, which names the file format

**Capture**:
Saving a passage, and optionally a first note about it, into the notebook from Admin without
leaving the draft. It never changes the draft and never publishes anything.
_Avoid_: Clip, import, citation

**Research note**:
The author's own observation or question, linked to passages, sources, or concepts. Always
private; never a quotation, claim, or citation.
_Avoid_: Annotation, comment, reader note

**Archived entry**:
A passage or note the author has set aside. It stays in the notebook file, its links and its
exports, and is left out of lists, search and the open-question count until the author asks for
archived entries. Archiving is reversible and never changes who can see the entry.
_Avoid_: Deleted, hidden, unpublished, private (every entry is private)

**Research bundle**:
The versioned, explicitly requested export of the whole notebook, marked private so tools can
recognise and refuse it in public folders. Importing one previews first and only adds entries
the notebook lacks.
_Avoid_: Backup of the site, publication, CSL export

**Open question**:
A research note of kind question that the author has not marked resolved. A question with no
state written is open. The state is the author's own marking and says nothing about whether an
answer is correct.
_Avoid_: Todo, unanswered claim, knowledge gap

**Backlink**:
An entry in the notebook that points at a passage, a source or a concept, found by reading the
stored notebook rather than from a saved index. A source's backlinks include entries that point
at its editions, translations, witnesses and references.
_Avoid_: Citation, reference, mention

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
