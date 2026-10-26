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

**Group**:
The members of one shared publication, from one to the participant cap, all admitted through
the same invitation seam with no pair-only path. Two is not a special case.
_Avoid_: Team, organization (out of scope)

**Membership audit**:
A bounded, newest-first record on a shared publication of who invited, revoked, joined, changed
roles, or removed whom and when. It names participants and invitation IDs only, never tokens,
accounts, or prose, and only site owners and coordinators can read it.
_Avoid_: Activity feed, access log

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

**Approval rule**:
The publication's choice of whose approval publication needs: every author (the default), everyone
who wrote, the writers plus named participants, or the writers plus every author holding chosen
roles. Every writer, and everyone named on a synthesis item, always approves; a rule only adds
approvers and never counts, votes or stands in for anyone. A named person who leaves, or a role no
author holds, keeps the piece blocked until the rule changes. Site owners and coordinators change
it against the revision they read, with an explicit confirmation, and a real change clears every
approval. A coordinator may only keep or add required approvers; dropping anyone the rule
requires, even someone who has left, takes a site owner. It is bound into every approval and shown in the combined preview. It never changes who
reads which draft: reveal stays one group (ADR 0052).
_Avoid_: Quorum, vote, approval threshold, reveal group

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

**Media moment**:
A participant's located note on one of a shared publication's own sources. It points at the source
reference by id and at a place in it through one to eight notebook Locators: a timestamp or range for
video and audio, and pages, chapters or other textual locators for text. It holds a moment quotation,
a moment observation, or both. The participant who made it always comes from the session. A moment is
private to its owner unless it is proposed for the publication. Even then, another author sees it only
while it is sealed to the owner's draft revision that author may read. Approval binds the exact
moments proposed for the piece, and each owner must approve it (ADR 0062, 0063).
_Avoid_: Annotation, clip, transcript, comment

**Moment quotation**:
Words from the source, stored exactly as quoted and kept short: at most 1,000 characters, never a
transcript. It carries an optional speaker, an optional language, and an explicit quotation rights
status and provenance. It is never the participant's prose (ADR 0062).
_Avoid_: Excerpt when the notebook's passage is meant, observation

**Speaker**:
Who said a moment quotation in the source, as a plain name. It is neither the source attribution nor
the participant who quoted it (ADR 0062).
_Avoid_: Author, creator, participant

**Moment observation**:
The participant's own words about a media moment, written as untrusted Markdown with no raw HTML,
images, headings, footnotes or non-HTTP(S) links (ADR 0062).
_Avoid_: Quotation, note when the notebook's research note is meant

**Quotation rights**:
The participant's own statement of whether a moment quotation may be republished: unknown, brief
quotation, permission, open licence, public domain, or their own words. It is always paired with
provenance: transcribed, copied, or supplied. It is never a legal determination, and a quotation
whose rights are unknown cannot be proposed for the piece (ADR 0062).
_Avoid_: Licence check, clearance, fair use ruling

**Quotation attribution**:
The one line that credits a moment quotation wherever it shows: its speaker when named, the source's
title and kind as the record holds them now, and the moment's location, such as "The host, in Episode
4 (Podcast), from 1:02 to 1:10" (ADR 0065).
_Avoid_: Byline, credit line when the participant is meant

**Rights guidance**:
Neutral text explaining what a quotation rights status states and what helps co-authors review it,
always shown with the statement that the status is the participant's own and that open.blog does not
check rights. It never says that a use is allowed (ADR 0065).
_Avoid_: Legal advice, clearance, permission check

**Rights note**:
The participant's optional one-line note on a moment quotation's rights status, such as who gave
permission or which licence applies. It is covered by the seal and approval, shown to co-authors, and
never published (ADR 0065).
_Avoid_: Licence field, permission record

**Quotation warning**:
Advice about a moment quotation that names no speaker or is longer than the 300-character guide for a
brief quotation. It never judges accuracy and never blocks saving, proposing, approving or publishing
(ADR 0065).
_Avoid_: Error, violation, plagiarism flag

**Moment seal**:
The digest of an owner's proposed media moments, written when the owner offers a draft revision and
tied to that revision. It covers the moments' own content only, never the source's title or link,
and it is written once per revision. Another author sees the owner's proposed moments only while
the seal for the revision they may read still matches them; an edit after the offer stays private
until a newer revision is offered (ADR 0063, 0064).
_Avoid_: Snapshot, lock, approval

**EditMoments**:
The collaboration grant to capture, edit and remove one's own media moments and read the ones other
authors revealed. Contributors hold it for themselves only, because a proposed moment makes its owner
a required approver (ADR 0064).
_Avoid_: EditSynthesis, EditDraft

**Published moment**:
The public projection of an approved media moment: where it is (the source's title and kind and the
location, times read like `1:02`), who noted it (a display name), the quotation's words, language and
quotation attribution, the observation, and the moment link. It has no field for rights, the rights
note, provenance, ids, intent or seals, so none can be published. The gate appends every moment
proposed for the piece, in order, after the rest of the Post under "Moments in the sources"; private
moments never enter (ADR 0066).
_Avoid_: Embed, clip, player, annotation

**Moment link**:
The published link of a moment, derived from its source's stored address and never stored: a link
that starts at the moment where the provider's time parameter is known (YouTube), otherwise the
original link unchanged, and no link at all when the source has no safe address, so the location
stays text. Its label names the source and, when it starts there, the time (ADR 0062, 0066).
_Avoid_: Embed, timestamp URL field

**Moment frame**:
The closed HTML grammar a Post body carries for published moments (`section`, `figure`, `blockquote`
with the quotation's `lang`, `figcaption`, a link paragraph) around each observation's own Markdown.
The page, the preview and portable HTML render it through the production renderer; portable Markdown,
text and `llms-full.txt` read it back exactly and state the same facts without HTML, and the portable
semantic check requires every fact in order (ADR 0067).
_Avoid_: Widget, component, shortcode

**Combined preview**:
The side-effect-free review of the whole piece an author sees before approving: every author's
section in order at its exact latest revision (an author who wrote nothing has no section and
does not block it), each author's approval state (approved, awaiting, or
stale), and whether the piece is complete and ready. A section appears only if the reader may read
that latest revision; every other case is one identical placeholder. An author's proposed media
moments are part of their section: it shows only while they are sealed to the revision shown, and
the moments the reader may see are listed with it (ADR 0064). It opens with a "Preview, not
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
Post's `series` and `seriesOrder`. It does not create a separate series entity: the site's
existing series supplies name, description, theme, ordering and navigation. It is public, so it is
part of what every author approves (ADR 0038). Site owners and coordinators set it (`PlaceInSeries`) against
its revision, every participant sees it with the reading order it would join, and only site owners
add a new series definition (`CreateSeries`); the list and order come from published posts only
(ADR 0039).
_Avoid_: Series template

**Series definition**:
The site-owned `content/series/<slug>.md` that names a series and describes its recurring premise.
A shared publication never writes one; a site owner may add a new one from its Series panel, and
it is not public until a part is published (ADR 0039).
_Avoid_: Series template

**Collaborative work**:
A published Post whose approved work credits (an explicit credit sidecar) name two or more
authors. A legacy post's default site-author credit, a single author or a secondary role never
make one. It is derived from the credits alone, never from collaboration state (ADR 0040).
_Avoid_: Shared post, joint post

**Collaborative series**:
An ordinary series with at least one collaborative work among its published parts. Only such a
series names its contributors on its page and each part's authors in its navigation; every other
series renders exactly as before, and drafts or scheduled posts never make one (ADR 0040).
_Avoid_: Collaborative-series entity, series template

**Series context**:
What a feed item or portable copy of a published part of a collaborative series states about it:
the series name and canonical link, its place in the published reading order ("Part 2 in the
series", without the number of parts, so a growing series leaves earlier copies unchanged), the
part's authors and the series' contributors. Derived from the public series and approved credits
only; any other post has none and its feeds and copies are unchanged (ADR 0041).
_Avoid_: Series metadata, series membership

**Published assembly**:
The explicit, ordered selection of source references and contribution drafts, as they appear in
one approved collaboration revision, that a publication operation incorporates into canonical
content. It names that
publication-time assembly, not a second stored Post or Published work. Participant order does not
determine public credit; publication resolves credit through the existing Work credit model.
_Avoid_: Collaboration transcript, automatic byline, second Post or canonical document

## Evidence and identity

**Citation**:
An in-text pointer connecting a passage to a reference, written `[@key]` or
`[@key, page 514]`. Its key is the reference's source identifier and its locators are the
notebook's. Only its key, locators and the formatted reference are public; it asserts nothing
about what the source proves.
_Avoid_: Reference, source, footnote, link

**Reference**:
A description or resolvable identifier for a work used as evidence or context. In the
source library, a reference record points at exactly one work, edition, translation, or
witness, never at another reference or a contributor.
_Avoid_: Citation when no in-text pointer is meant; contributor or work credit

**Citation key**:
The source identifier written after `@` in a citation. There is no separate key registry, so a
citation resolves to exactly one source-library record, archived or not, or is reported.
_Avoid_: Cite key table, alias, BibTeX key

**Citation chip**:
How the visual editor shows a citation: one atomic, keyboard-reachable unit that keeps the
citation's exact Markdown and reopens it in the citation picker. It is an editing aid only; the
Markdown file stays canonical. Citation text the editor cannot show as chips exactly as the
scanner reads it stays a protected **Citation text** block instead.
_Avoid_: Footnote marker, link, tag

**Publication Markdown**:
The body every public representation of a post is built from: the authored Markdown, or for a
post that opts in to citations, that body with each citation written as a generated footnote
and the notes appended. The file on disk never changes.
_Avoid_: Export, rendered body

**Citation note**:
A generated, numbered note that publishes a citation: the formatted reference and the
citation's locators, linked from its marker and back. One per distinct citation in the `notes`
style.
_Avoid_: Footnote when an author's own note is meant

**Bibliography**:
The citation style that publishes each cited reference once, numbered in order of first
citation, under References, with locators kept next to the marker in the text.
_Avoid_: References section when the research profile's hand-written list is meant

**Reader references**:
The versioned data a citation preview reads: each cited reference once under its citation key,
and each citation with its marker and note ids and its locators, projected from the published
citations and holding only their public description. It lives inline in the page and is never
needed to read it. Only the reference id is stable; marker and note ids are positional for one
revision and are never stored.
_Avoid_: Bibliography data, citation metadata

**Citation endnotes**:
The region at the end of a native post page that holds its generated citation notes under their
heading, announced as endnotes and named by that heading. Following a marker moves focus to its
note, and each note links back to every marker citing it. It never holds the author's own
footnotes.
_Avoid_: Footnotes section, bibliography block

**Citation preview**:
The small panel that opens beside a citation marker, on focus, hover or a first tap, showing the
cited reference's formatted text, the citation's locators and at most one checked outside link
plus the way to the note, all taken from the page's reader references as text. It enhances the
marker, which stays the link to its note, and is never needed to read the post. It repeats what
the author's library says and verifies nothing: not that the source exists or is described
correctly, that its link resolves, that the passage supports the claim, or that the source is
authoritative or may be reused.
_Avoid_: Tooltip, popup, source card

**Citation check**:
An offline finding about a post's citations, in one of four separate classes: syntax (the
citation cannot be read), resolution (its key or locator does not resolve, or an identifier is
left out), completeness (a cited reference lacks a detail its kind usually has) and location
review (a cited location only a person can confirm). It never says whether a source is true,
relevant or supports a claim, and never looks anything up online.
_Avoid_: Verification, fact check, citation score

**Bibliography export**:
A post's cited references as CSL JSON or BibTeX, built only from the public description its
published notes show, with every detail the format cannot carry reported as an omission. It is
derived from the publication projection, not from the private source library export.
_Avoid_: Library export, source export

**Formatted reference**:
The public, plain-text rendering of a reference built only from its bibliographic description
(title, creators, date, identifiers, preserved CSL variables), never from notebook text.
_Avoid_: Bibliography entry when the source-library record is meant; CSL style output

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
work, edition, translation, or witness a reference points at. In a multi-volume edition or
witness it also names its volume.
_Avoid_: Citation, URL fragment

**Realization chain**:
A record and the records it realizes, followed through `of` up to the work, each keeping its
own kind: a reference, the edition it points into, the translation that edition prints, and the
work. A translation in the chain is never read as an edition or as the original work (ADR 0084).
_Avoid_: Version history, lineage when a revision is meant

**Revision**:
An edition that revises an earlier edition of the same text, recorded with `revises`. A new
translation is never a revision; it is its own translation (ADR 0084).
_Avoid_: Reprint, version, new translation

**Witness identity**:
The repository and shelfmark that identify one held copy. Two witnesses never share both
(ADR 0084).
_Avoid_: Call number alone, CSL archive

**Volume**:
One physical part of an edition or witness that declares several. A page or folio in such a
record must name its volume, because pages restart in each (ADR 0084).
_Avoid_: Issue, part, tome when a separate edition is meant

**Rights declaration**:
The author's own statement of the rights in one version's text, or in an interpretation's text:
a rights status, an optional one-line note and, for an open licence, the licence's name. It is
private and never a legal determination (ADR 0085).
_Avoid_: Licence check, clearance, permission

**Rights status**:
One of unknown, rights reserved, permission, open licence, public domain, or own work, as the
author states it. A version that declares none is unknown, and no version inherits a status
from the work, edition, or translation it comes from (ADR 0085).
_Avoid_: Allowed, cleared, copyright status as a fact

**Attribution certainty**:
How firmly a name is tied to a source or interpretation, as the author records it: stated by the
source, attributed by tradition or scholarship, uncertain, or disputed. Absent means not recorded,
never "stated" by inference (ADR 0086).
_Avoid_: Confidence score, authorship verdict

**Anonymous source**:
A work, edition, translation, or witness whose source names no maker. Names tradition assigns may
still be recorded as attributed, uncertain, or disputed, but never as stated (ADR 0086).
_Avoid_: Unknown author when the creators are simply not filled in

**Interpretation**:
An attributed rendering or reading of one located place in one exact text in the source library,
kept beside the library's records. It is private research, never a source, never cited, and
never a credit (ADR 0087).
_Avoid_: Translation (a published version), annotation, research note, claim

**Rendering**:
An interpretation that translates one located place into another language. It names the edition,
translation, or witness it was made from.
_Avoid_: Translation when the library's published translation record is meant

**Reading**:
An interpretation of what one located place means.
_Avoid_: Claim, evidence, commentary when a library source is meant

**Interpreter**:
Who made an interpretation: a contributor named by registry key, which reuses their identity
without creating a work credit, or anyone else by a descriptive name, each with an optional
attribution certainty. An interpretation with no interpreter is explicitly anonymous (ADR 0087).
_Avoid_: Credit, author, creator

**Passage alignment**:
The author's private record that places in two or more versions or interpretations correspond,
attributed and optionally evidenced. It never says the places mean the same thing and never
treats a version as authoritative (ADR 0088). It is published only once approved, through the
comparison projection (ADR 0092).
_Avoid_: Equivalence, parallel text, translation memory, automatic alignment

**Alignment member**:
One place in a passage alignment: a version and its own locators, optionally the notebook passage
quoting it, or an interpretation aligned as it is. Several members may come from one version, and
a place may belong to several alignments.
_Avoid_: Segment pair, row, one-to-one match

**Absent member**:
An alignment member recording that a version lacks the passage (an omission, a lost leaf, or a
gap), so a missing passage is stated rather than inferred from silence.
_Avoid_: Empty member, null match

**Correspondence**:
How the author reads an alignment's places: corresponding, corresponding in part, or
corresponding but differing. There is deliberately no "equivalent".
_Avoid_: Equivalence, similarity score

**Normalization**:
The author's normalized form of a member's original wording (for example, composed accents or
expanded abbreviations), stored beside and never in place of the passage or interpretation text.
_Avoid_: Correction, the text, cleaned excerpt

**Comparison workspace**:
The Admin research tool that reads one passage alignment as its versions' places side by side or
in a single column, in the author's member order, with original wording exact and normalizations
shown only on request (ADR 0090). It reads and edits alignments, previews what a public page
would show for each place, and records approval; it publishes only through the comparison
projection.
_Avoid_: Parallel text viewer, diff, translation comparison score

**Place identification**:
The visible line on every compared place naming its version (kind and language), its maker in the
version's own role (editor, translator, scribe, or interpreters, with attribution certainty), and
its locator, so a place read or copied alone stays attributed.
_Avoid_: Caption, citation

**Comparison export**:
Copying or downloading the places the author explicitly selected in the comparison workspace,
each with its place identification and rights statement and its wording exactly. Copying waits
for confirmation when a selected version's rights are unchecked or reserved, and a rights status
never means permission. The author's private notes on places are left out unless the author ticks
"Include my notes on places" (ADR 0091).
_Avoid_: Publishing, sharing, licence check

**Comparison projection**:
The one public form of passage comparisons: approved alignments, each reduced to an explicit
allowlist of fields, with every place identified and its wording passed through the rights gate.
The comparison pages and `comparisons.json` are both rendered from it (ADR 0092).
_Avoid_: Public alignments, parallel text export

**Comparison publication switch**:
The site setting `comparisons.publish`. Off by default, when no build reads the alignments file;
on, the build publishes the comparison projection. Each alignment still needs the author's
approval.
_Avoid_: Treating approval alone as publication

**Rights gate**:
The rule that a compared place's wording is published only when the author's rights statement
for its version or interpretation is permission, open licence, public domain, or own work, and the
wording is a brief excerpt (at most 1,000 characters). Otherwise the place is identified and
located, never quoted. It follows the author's declaration and is never a legal judgement.
_Avoid_: Licence check, copyright clearance, fair-use test

**Knowledge Atlas**:
An author's private, versioned map of contextual entries and the attributed relationships between
them. It reaches public output only through an explicit publication projection of approved items.
_Avoid_: Knowledge graph or database; ontology; a source of factual truth

**Contextual entry**:
One person, work, concept, movement, or event in the atlas. Its kind is fixed and decides which
relationships it may join. A concept entry is what a notebook note's concept link resolves to.
_Avoid_: Node, record, tag; treating an edition or translation as a work entry

**Attributed relationship**:
A directed link between two entries that one named party asserts, resting on cited source evidence
and carrying a confidence and an uncertainty note. Its reverse reading is a label, never a second
assertion, and it is never inferred from dates or order.
_Avoid_: Edge or fact; influence inferred from chronology

**Contested relationship**:
A relationship with at least one recorded, attributed disagreement. There is no state that says
scholars agree.
_Avoid_: Consensus, established

**Unsourced draft**:
The explicit state of a relationship that cites no evidence yet. It can be neither strong nor
approved.
_Avoid_: Unverified, low confidence

**Projected relationship**:
An approved relationship whose two entries are both approved, and so the only kind the
publication projection may copy. An approved relationship touching a private entry stays
private and is reported as a notice, never refused.
_Avoid_: Public relationship, approved relationship when a private endpoint is possible

**Dating**:
One party's attributed claim about when one aspect of an atlas entry or relationship happened,
resting on cited evidence (or explicitly unsourced), with a confidence and a note. It is private
until approved and is never a fact.
_Avoid_: Date field, the date of something; a date without who gives it

**Dated aspect**:
What a dating dates: an entry's `span`, a person's `birth`, `death` or `active` period, a work's
`composition` or `publication`, a concept's or movement's `emergence`, or the `span` during which
a relationship held. Only span, active and composition last. The chronology explorer lists one
item's dated aspect (Plato's birth) as one row holding all its competing datings, and its filters
show or hide a whole dated aspect, never one of its datings.
_Avoid_: Event type, role; a timeline bar or merged date range for one aspect

**Date expression**:
The one form a dating takes: a point (`at`), a duration (`from`/`to`), a date window
(`notBefore`/`notAfter`), unknown, or a relative dating.
_Avoid_: Date string, parsed date

**Date precision**:
How finely a point is stated: day, month, year, decade or century. A point is read back exactly
as written; nothing rounds, widens or narrows it.
_Avoid_: Accuracy, granularity guessed from text

**Circa**:
A point the party gives as approximate. It is kept beside the point and does not move it.
_Avoid_: Fuzzy date, estimated (when the party did not say so)

**Date window**:
The time inside which something happened, with an inclusive earliest (`notBefore`) and latest
(`notAfter`) point; an open end is what "after" or "before" a date means.
_Avoid_: Range (ambiguous with a duration), terminus as a stored word

**Unknown date**:
A party's explicit statement that a date is unknown. It is never coerced to a point and sorts
after every dated item; having no dating at all simply means undated.
_Avoid_: Null date, year 0, a placeholder year

**Competing datings**:
Two or more datings of the same aspect, by different parties or as one party's alternatives.
They stand side by side in file order; nothing prefers, merges or resolves them.
_Avoid_: Correct date, consensus date, resolved date

**Relative dating**:
A dating that places an aspect before, after or during another entry's aspect. It is the atlas's
only temporal relationship: asserted and cited like any dating, never inferred from absolute
dates, and never a relationship kind or a reason for one.
_Avoid_: Preceded or contemporary-of relationship; order inferred from years

**Calendar policy**:
Years are historical BCE/CE years with no year 0. A month and day may name the calendar they
are stated in (Gregorian or Julian); nothing converts calendars, and points in different
calendars are compared by year only.
_Avoid_: Normalized date, proleptic conversion

**Projected dating**:
An approved, cited dating with no notebook passage whose entry or relationship is published and,
if relative, whose other entry is approved. Anything else stays private and is reported as a
notice, never refused.
_Avoid_: Public date; approved dating when its owner may be private

**Chronology index**:
Every dating of the atlas, private or approved, placed by the entry or relationship it dates, by
aspect and on one timeline, in one deterministic display order that does not depend on file
order. Competing, circa, relative and unknown datings are all kept; nothing is chosen, merged or
linked by closeness in time. It is for the author's tools and is never published.
_Avoid_: Canonical timeline, resolved dates, contemporaries

**Chronology prompt**:
A structural, non-blocking notice that some recorded datings cannot all hold as stated, such as a
death dated before a birth or relative datings ordering two works both ways round. It names
dating ids and their stated values, asks the author to check them against the cited evidence, and
never says which dating is right; only relationships and relative datings someone asserted are
followed across entries.
_Avoid_: Chronology error, conflict resolution, verdict, inferred influence

**Chronology explorer**:
Admin Studio's text view of the chronology index: dated aspects in one display order, grouped by
century, decade or year at the author's choice, with relative datings as sentences and
chronology prompts as checks that link to the dating. It is lists and words only, private to the
author, and never resolves or ranks datings.
_Avoid_: Timeline chart, canonical chronology, zoomable graph

**Atlas projection**:
The one public form of the Knowledge Atlas: approved entries and projected relationships, each
reduced to an explicit allowlist of fields, with the public description of the sources they use.
Both the atlas pages and `atlas.json` are rendered from it, and nothing public reads the private
atlas. Withdrawing approval removes an item from the next build.
_Avoid_: Public atlas export, public graph; filtering the private atlas per surface

**Published dating**:
A projected dating as the atlas projection publishes it: who dates what, on which cited evidence,
how firmly and with what note, at the precision stated and read back in words with BCE written
out. Competing published datings appear side by side, in the chronology's one order, and none is
preferred.
_Avoid_: Public date, the date of an entry, resolved date

**Public timeline**:
The `/atlas/` section that lists every published dating as text, by the century in which each
dated aspect's earliest dating begins, with aspects not placed in time listed apart. It reads
completely without JavaScript; its component only filters whole dated aspects and moves focus to
a period. Order on it never means cause or influence.
_Avoid_: Timeline chart, canonical chronology, contemporaries list

**Chronology trail**:
The path a reader follows from one entry to another through published relative datings, one
asserted, attributed and cited step at a time, each linked both ways. Nothing chains steps, infers
an order from dates, or turns a step into a relationship.
_Avoid_: Influence chain, inferred sequence, derived timeline

**Atlas publication switch**:
The site setting `knowledgeAtlas.publish`. Off by default, when no build reads the atlas at all;
on, the build publishes the atlas projection. Item approval is still required for each item.
_Avoid_: Treating approval alone as publication

**Atlas revision**:
The fingerprint of the Knowledge Atlas as stored, which every change must name so that a change
based on an older read is refused instead of overwriting newer work.
_Avoid_: Version, which names the file format

**Relationship explorer**:
The Admin list of one entry's relationships, outgoing and incoming, each read from that entry's
side with who asserts it, its confidence, standing, evidence and uncertainty. It is the complete
interface to the atlas's structure; any drawing could only repeat it.
_Avoid_: Graph view, network map; a picture as the only way to read relationships

**Incident reading**:
How a relationship reads from one of its entries: its kind going out (`authored`), its inverse
label coming in (`authored by`). A label for display, never a second stored assertion.
_Avoid_: Reverse edge, inferred relationship

**Claim**:
A statement made in one draft post, optionally anchored to a UTF-8 byte span of its anchor text.
It is private until the author approves it and carries no truth value.
_Avoid_: Fact, finding; treating a cited sentence as a claim automatically

**Anchor text**:
The text a claim anchor indexes: the post body after a leading byte-order mark and the front
matter are removed, with every CRLF folded to LF and then any leading line breaks dropped, so the
blank line Admin's save writes after the front matter counts for nothing. Offsets are UTF-8 bytes
into it.
_Avoid_: Offsets into the raw file, character or UTF-16 offsets

**Evidence link**:
The author's recorded relation (supports, contradicts or contextualizes) between one claim and one
source, with optional locators and notebook passage, rationale, uncertainty, review state and
provenance. A citation alone is not one.
_Avoid_: Citation, proof, verdict; defaulting a relation to supports

**Projected evidence link**:
An approved link on an approved claim with no private passage and, if it supports the claim, no
private contradicting link beside it. Anything else stays private and is reported as a notice,
never refused, so withdrawing consent is an ordinary edit.
_Avoid_: Public link, approved link when its claim or a contradiction may be private

**Claim anchor check**:
Comparing a claim's recorded span with the current anchor text: verified, moved, stale or
ambiguous. It reports and never repairs.
_Avoid_: Auto-relocation

**Evidence gap**:
A finding about what a claim's record lacks or what only the author can check: no evidence,
contradicting evidence the post may not address, only support for a claim marked uncertain, an
archived source or passage, a missing location or rationale, an unchecked location, an
unreviewed suggestion, or words no longer where they were anchored. It is a prompt with a next
action, in the same finding contract as citation checks, and never a verdict on truth.
_Avoid_: Evidence score, weak claim, unsupported claim, verification

**Saved draft**:
A post's text as stored in its file, which every claim anchor is checked against. Unsaved editor
text never is; the author saves the post before anchoring a claim in new words.
_Avoid_: Editor buffer, live text

**Re-anchor**:
The author choosing a claim's words again in the saved draft, after they moved, went stale or
became ambiguous. Evidence cannot be added to a stale or ambiguous claim until it is re-anchored.
_Avoid_: Auto-fix, relocation by the software

**Claim evidence projection**:
The one public form of a post's claims: approved claims and projected evidence links, each
reduced to an explicit allowlist of fields, with the public description of the sources they cite.
It is published as a section of the post's publication Markdown and as `claim-evidence.json`;
supporting and contradicting evidence sit side by side under each claim and are never combined.
Withdrawing approval removes an item from the next build.
_Avoid_: Public claims export, verdict, fact check; filtering the private claims file per surface

**Claim evidence publication switch**:
The site setting `claimEvidence.publish`. Off by default, when no build reads the claims file and
every post is published as before; on, the build publishes the claim evidence projection. Approval
is still required for each claim and each link.
_Avoid_: Treating approval alone as publication

**Evidence revision note**:
A dated public note, written by the author in a post's front matter (`evidenceRevisions`), saying
how the post's evidence changed, optionally naming one claim. It is versioned with the post, so
removing private research or withdrawing a claim never removes it.
_Avoid_: Changelog entry, correction notice from a reader; storing the note in private research

## Reader participation

These terms describe how readers point at published text, where their feedback came from, and
the one policy that governs everything readers and authors add to a published post (ADRs 0101 to
0104).
Reader data is never research: a notebook **Passage** is an author's excerpt of a source, while a
**Passage target** points into a published post.

**Passage text**:
A post's published prose as a reader can quote it, section by section: the text before the first
heading, then each heading's id with its title and the text up to the next heading. Generated
markers, labels, image alternative text, raw HTML, embed frames, code blocks and the generated
citation notes are not part of it; only whitespace is normalized. The build publishes it as page
data; the browser maps a selection onto it rather than reading the page.
_Avoid_: Plain text, search text, body when the quotable published text is meant

**Passage revision**:
The fingerprint of a post's passage text, written `p1:` and 32 hex digits, whose number names the
text model. Feedback records the passage revision the reader saw.
_Avoid_: Version, commit, notebook revision

**Section digest**:
The fingerprint of one section's passage text, so a target for a whole section can tell an
unchanged section from an edited one.
_Avoid_: Section id, hash of the Markdown

**Passage target**:
A durable, versioned pointer at published text: the whole post, or a section anchor (the heading
id) and either the whole section, optionally with its digest, or a quotation of at most 500
characters with up to 64 characters of context on each side and a position hint. Never a
positional element id.
_Avoid_: Passage (the notebook term), anchor, highlight, marker id, selector when the whole
target is meant

**Target resolution**:
The outcome of reading a passage target against the current passage text: current (seen at this
revision, text in place), re-anchored (the identical text found again, uniquely, as the same
passage) or stale with a reason. It never points at text the reader did not quote.
_Avoid_: Fuzzy match, retargeting, best guess

**Feedback provenance**:
Where one piece of reader feedback came from: the published work, the passage revision the
reader saw, the passage target, when the reader saw it by their own clock, when the site received
it, the channel and the reader's attribution choice. Reader data, never a research note.
_Avoid_: Metadata, submission log, research note, audit trail when moderation decisions are meant

**Reader attribution**:
The name a reader optionally gives with feedback and their explicit agreement to show it. Without
that agreement the name is private to moderation; anonymous is the default.
_Avoid_: Author, contributor, credit, account

**Public provenance**:
The only public form of feedback provenance: the work, the revision seen, the day received,
whether the passage is stale, its section, the quoted text only while it is still published, and
a name only with consent.
_Avoid_: Feedback export, moderation record

**Feedback kind**:
What a reader says they are offering about a passage: a question, a suggested source, a suggested
correction or another interpretation. The reader's stated intent, never a verdict: a suggested
correction is not a correction until an author decides.
_Avoid_: Correction (for a submission), category, vote, rating

**Feedback submission**:
What a reader sends: the kind, the work, the passage revision seen, the passage target, the text,
the kind's details (a source link, suggested wording) and the reader's attribution choice. Nothing
else about the reader.
_Avoid_: Comment, message, report

**Scholarly feedback record**:
A received submission: its kind, text and details with the feedback provenance, including when the
receiver got it and by which channel. Reader data, never research, and never published except
through its public projection after moderation.
_Avoid_: Comment row, research note, correction

**Hosted feedback transport**:
The optional, opt-in path that carries feedback submissions to the site's hosted function and
stores them pending moderation. Without it, the canonical page and a copy-and-send fallback
remain.
_Avoid_: Feedback service, comment system, backend when the opt-in path is meant

**Passage data**:
A post's passage text as page data, built by the build: the work, the passage revision and each
section's index, anchor, heading title, text and digest, in one inert JSON element. Only an open
post on a site that opts in to feedback carries it; the browser maps selections onto it and never
re-derives text from the page (ADRs 0076, 0082).
_Avoid_: Page text, DOM text, scraped text

**Feedback region**:
The section after a post's navigation where a reader sends a passage-specific note. Its static
text tells a reader without JavaScript how to name a passage and reach the author; the feedback
form enhances it, and a failed submission falls back to a copy of the note to send (ADR 0082).
_Avoid_: Comment box, discussion when the hosted comments are meant

**Feedback moderation**:
A moderator's decision about one feedback item, taken in the moderation inbox: approve, ask to
clarify, reject or remove with a reason, or reopen, in the participation policy's state names
(pending, clarification, approved, rejected, removed, withdrawn). Each change names the state and
version the moderator saw and is recorded as an audit event; approval never edits the post (ADRs
0083, 0105).
_Avoid_: Accepting a correction, verdict, review when a moderation decision is meant

**Passage check**:
What a moderator sees about a feedback item's passage before acting: current, re-anchored after
the post changed, stale with its reason, or no post at that address. Approving anything but a
current passage needs the moderator to confirm the check they read (ADR 0083).
_Avoid_: Fuzzy match, auto-fix

**Published reader feedback**:
The public part of approved feedback, kept in `reader-feedback.json` in the content folder: the
kind, text, details, target and revision seen, the days received and approved, a name only with
consent, and the author's response. Shown on the post's canonical page only, through the public
provenance; portable copies and feeds carry a labelled link instead (ADR 0083).
_Avoid_: Comments, feedback export, moderation record

**Participation kind**:
One entry in the closed registry of ways to participate: comment, question, suggested source,
suggested correction, another interpretation, Third Perspective, author response or abuse report.
Each has fixed rules: who creates it, what it targets, whether an approved item may be shown, and
whether a moderator may ask its submitter to clarify. Every kind but comments starts `off`.
_Avoid_: Comment type, feedback type, category (a Third Perspective prompt), channel

**Participation mode**:
How one kind behaves on one post: `hidden` (nothing shown or accepted), `locked` (approved items
shown, nothing accepted) or `open` (approved items shown, new items accepted pending moderation).
The comment modes, applied to every kind; resolved from the site setting and the post's front
matter by one resolver.
_Avoid_: Comment policy when a kind other than comments is meant, visibility, status

**Site participation setting**:
A kind's value in `participation.kinds`: `off`, `follow-comments`, or the default mode for posts
that do not name the kind. `off` cannot be overridden by a post.
_Avoid_: Feature flag, opt-in when the per-post mode is meant

**Participation item**:
One stored submission of any kind, with its moderation state, version, revision and the text it
carries. Reader data, never research and never an author's contribution.
_Avoid_: Comment (unless the kind is comment), post, contribution, message

**Moderation state**:
Where an item is: pending, clarification requested, approved, rejected, removed or withdrawn.
Every item starts pending; only approved, at its current revision, can be public.
_Avoid_: Status when the comment column's three values are meant, published, visible

**Clarification request**:
A moderator's request, with a reason and only with the submitter's clarification consent, that a
submitter revise an item. The revision it asks about is never approved or published, even after
the item is rejected, expires or is reopened (reopening returns it to clarification); only the
answer, which replaces the text as a new revision and returns to pending, can be. Never sent by
e-mail.
_Avoid_: Reply, comment thread, rejection with feedback

**Clarification consent**:
A submitter's agreement, given when submitting, to be asked to clarify. Without it a moderator can
only approve or reject.
_Avoid_: Contact consent, publication consent, feature consent

**Removal**:
Taking an approved item out of public view, with a reason, by a moderator or by an upheld abuse
report. Distinct from rejection (never approved) and withdrawal (by the submitter).
_Avoid_: Deletion, purge, unpublish when retention is meant

**Withdrawal**:
A submitter taking back their own item, pending, in clarification or approved. Final: a withdrawn
item is never reopened, and its text is purged at once.
_Avoid_: Removal, retraction by the author, consent change for display only

**Abuse report**:
A reader's report that a public item is abusive. Never public, never counted, and never changes
its target by itself; upholding it removes the target in the same decision or changes nothing.
_Avoid_: Flag, vote, downvote, complaint

**Author response**:
An author's public reply to one approved item, written by the site Admin, a coordinator or a
contributing author of the work. A response to a published note is stored with it in
`reader-feedback.json` and shown under it (ADR 0083); a response kept as its own participation
item starts pending like everything else. Replying sends nothing to the reader.
_Avoid_: Revision note, correction, comment by the author, reply notification

**Moderator**:
The site Admin, or a coordinator for the works of their publications. Contributing authors read
and respond but do not moderate; readers act only on their own items as submitters.
_Avoid_: Admin user when a publication coordinator is meant, editor, owner

**Site Admin (moderation)**:
The hosted moderation token, or an Admin session acting on a work outside every shared publication
in which that account holds a binding. On a shared work a bound co-writer is that publication's
coordinator (site owners included) or contributing author instead. Only the site Admin and the
submitter see a reader's private name.
_Avoid_: Admin user, site owner (a publication role), owner

**Reason code**:
The ground for a moderation decision, such as spam, abusive, personal data, off topic, duplicate,
rights, unclear or needs source. Never a verdict on whether a reader was right.
_Avoid_: Verdict, label, rating, "incorrect"

**Moderation audit event**:
The private record of one submission, transition or purge: item, kind, action, states, actor role,
the Admin account where there is one, reason, time, revision and version. It never holds text or
anything identifying a reader, and it outlives purged text.
_Avoid_: Feedback provenance, log line, history of the text

**Participation retention**:
How long moderation keeps what it does not publish: pending and clarification items expire,
rejected and removed text and upheld abuse reports are purged after a period, withdrawn text at
once, and audit events last longer than any text. Comments are covered only once the site sets
`participation.retention` itself.
_Avoid_: Archive, backup, analytics retention

**Moderation inbox**:
Admin's one list of every hosted participation item, comments and passage feedback today, by
state and kind, oldest first. Each item is shown, and offered the decisions the one policy accepts
now, for the role the signed-in account has on that item's work; an item it may not see is left
out and never counted (ADR 0105).
_Avoid_: Comment moderation, Reader feedback view, queue when the whole inbox is meant

**Inbox decision**:
Approve, ask to clarify, reject, remove or reopen one item, naming the state and version the
moderator loaded. Admin and the hosted function each decide it with the same rules before one
conditional write records it with its audit event (ADR 0105).
_Avoid_: Status change, bulk action, verdict

**Reader receipt**:
A random secret the hosted function returns once when it takes a reader's note, kept only as its
digest. Holding it is the only proof of submission: with it the reader reads the note, agrees to
be asked to clarify, answers a clarification request, or withdraws the note. Comments and abuse
reports get none (ADR 0107).
_Avoid_: Account, login, confirmation e-mail, ticket number

**Deletion request**:
A request that an item's text, details and name be deleted now, by its submitter's receipt (which
withdraws an open or approved note first) or by the site Admin on an item already closed. Only the
state and an audit trail without text remain (ADR 0107).
_Avoid_: Delete row, unpublish, removal

**Purge**:
Overwriting an item's text, details and reader name, setting when it happened and raising its
version, with a `purge-content` audit event. A purged item is never approved again and takes no
further decision.
_Avoid_: Delete, archive, redact when the text is kept

**Retention run**:
The site Admin's confirmed application of `participation.retention`: a dry run lists what would
expire or be purged and how many audit events are old enough, then the run applies exactly the
items still due as they were. Never scheduled, and never touches comments unless the site set
retention itself (ADR 0108).
_Avoid_: Cron job, cleanup script, automatic purge

**Engagement protection**:
The opt-in hosted schema and switch (`supabase/protection.sql`, `OPENBLOG_PROTECTION_ENABLED`) that
add receipts, stored abuse reports, purging and the retention run, with replay bounds, all
additive and rolled back by `protection-rollback.sql` (ADR 0108).
_Avoid_: Security mode, hardening flag

**Inbox schema**:
The hosted columns, comment audit table and conditional moderation functions every inbox decision
needs, added by `supabase/moderation.sql` and `supabase/feedback.sql` and switched on with
`OPENBLOG_MODERATION_ENABLED`. Without it the inbox offers only what the older schema can store
(ADR 0106).
_Avoid_: Migration (it is additive and optional), new comment system

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

## Third Perspectives

Readers' own reflections on published works (ADRs 0106 to 0109). They extend the one reader
participation seam as the kind `third-perspective`; they never join the authors' work.

**Reader reflection**:
A reader's own interpretation of a published work, in whatever stage it is: a private draft, a
submitted copy or an approved response. Reader data, never research, never an author's
contribution and never a work credit.
_Avoid_: Comment, review, reply, contribution

**Third Perspective**:
A reader reflection on a shared reflection or a post, about the whole work or one section,
offered for publication. Public only with the reader's consent and a moderator's approval of that
exact text and consent, attributed as the reader chooses or anonymously, and always shown as a
reader's, never as one of the authors' perspectives or as a vote between them.
_Avoid_: Third author, verdict, rebuttal, side, comment

**Response category**:
An optional prompt a reader may pick to frame a reflection: another reading, a connection, from
experience, a question, or putting it to use. It describes the kind of thought, never its worth
or which author it sides with; a reflection without one is complete.
_Avoid_: Rating, score, vote, stance, agree or disagree

**Local reflection**:
A reader's private draft on their own device. It has no id, provenance, consent or moderation
state, and the site holds nothing of it until the reader submits it.
_Avoid_: Pending submission, saved comment

**Submitted copy**:
The site's private copy of a submitted reflection: its current text and revision, its provenance,
its intake and the reader's consent history. Visible only to moderation and the submitter.
_Avoid_: Published reflection, response

**Approved response**:
The one public form of an approved submitted copy, for the canonical page only: the work and
section it is about, whether that section has changed, whether the reader read an earlier
revision, the optional category, the text, the day received and a name only with consent. Never
in the Post, its credits, feeds or portable exports.
_Avoid_: Comment, author perspective, featured reflection

**Featured reflection**:
An approved response an editor chose to feature, covered by the reader's separate feature consent
for that approved revision. Editorial, never chosen by counts, rank or reactions, and never a
consensus claim (RD14).
_Avoid_: Top reflection, most liked, endorsed reflection

**Submission consent**:
One immutable, numbered record of what a reader agreed to: publication on the canonical page,
the name and whether to show it, being asked to clarify, and which revision may be featured.
Narrowing applies at once, even when the history is nearly full (room is kept for it and for
revocation); showing a name, or another name, is accepted only before a moderator decides;
revoking publication is a final withdrawal.
_Avoid_: Terms acceptance, checkbox state, approval

**Intake**:
How a submitted copy can be acted for: the digest of the private receipt a hosted submitter
holds, or the Admin user who entered a reader's message by hand. Never the receipt itself and
never public. A manual copy has no submitter: revoking it is an Admin removal with an immediate
purge, and it cannot be clarified.
_Avoid_: Account, login, contact details

**Moderation provenance**:
Everything moderation keeps about where a copy came from, whatever the reader shows publicly:
the work and revision read, the target, when it was received, the channel, the name as given and
the intake. Anonymous display never makes it anonymous.
_Avoid_: Public provenance, identity verification

**Moderation decision**:
A moderator's transition of an item in the one moderation state machine, with its private audit
event. Approving a Third Perspective also binds the text revision and the consent record the
moderator reviewed, and always names the moderator.
_Avoid_: Vote, verdict, ruling on who is right

**Continuation**:
A typed link from an approved response to a later published work that took it up (RD15). It never
edits the reflection and never implies that the reflection caused, or is endorsed by, the new work.
_Avoid_: Reply chain, thread, follow-up comment
