# ADR 0005: Separate private collaboration from public publication and credit

- Status: Accepted
- Date: 2026-10-24
- Decision issue: [#153](https://github.com/journey-to-code-org/open.blog/issues/153)
- Parent story: [#144](https://github.com/journey-to-code-org/open.blog/issues/144)
- Contract: [Shared perspectives collaboration contract](../specs/shared-perspectives-collaboration.md)

## Context

A shared reflection begins with source material and private contributions from one or more people.
Those people may coordinate, reveal drafts, and approve a revision before anything becomes canonical
content. Existing open.blog language already gives public meaning to Post, Published work,
Contributor, Author, and Work credit. Reusing those terms for private workflow state would imply
publication, site authority, authorship, or public attribution before those decisions have occurred.

The group-safe contract established by #155 already represents participants, contributions,
reveals, layout, and approvals as ordered collections keyed by stable opaque IDs. It deliberately
contains no couple, left/right, or author-A/author-B fields and remains isolated from the document
model and renderer. This decision names the surrounding domain without adding another persistence
format or weakening that boundary.

## Decision

Adopt the collaboration vocabulary in
[CONTEXT.md](../../CONTEXT.md#shared-publication-collaboration): Shared publication, Source
reference, Participant, Collaboration role, Contribution draft, Reveal, Approval, and Published
assembly.

A Shared publication has one or more ordered Source references and one or more ordered
Participants. All relationships use collections and stable opaque IDs. A two-person experience is
only a projection of the same group model; it never creates pair-specific persisted or API state.
The version 1 `participant`, `contribution`, `reveal`, and `approval` wire concepts from #155 realize
the corresponding workflow vocabulary and retain their existing validation and ordering rules.

Participant and Collaboration role describe private workflow involvement. They do not establish
that a person is a Contributor or Author, do not create a Work credit, and do not grant Admin user
authority. Public attribution continues to use
[ADR 0003's ordered work-credit model](0003-contributor-identity-and-orcid-provenance.md). Any
future publication transition must request or resolve public credits explicitly rather than
deriving them from participant order, collaboration roles, contribution ownership, reveals, or
approvals.

A Contribution draft is untrusted collaboration content. Reveal controls which ordered participant
IDs may receive a draft. Approval records consent to exactly the containing contract revision.
Neither concept publishes content, defines a quorum, or authorizes a workflow transition. A
Published assembly exists only when a separate explicit publication operation incorporates an
ordered selection into an author-owned Document. It names that publication-time assembly, not a
second stored artifact; the Document continues through the existing Post, Published work,
rendering, and portability paths.

Source reference is intentionally narrower than Citation and Reference. Source material may prompt
a shared publication without being cited as evidence. If the canonical document uses it as
evidence, the existing citation and reference model applies. A source URL never replaces the
published work's canonical URL or Work identifier.

## Trust and failure boundary

The #155 validation contract remains authoritative for collaboration fields: unknown or oversized
data is rejected; participant and contribution references must resolve; URLs are bounded safe HTTPS
URLs; Markdown is bounded untrusted source; and replacement is whole-contract and revision-checked.
Errors remain non-identifying and cannot echo another participant's content, identity, token, URL,
or metadata.

Collaboration parsing and validation do not mutate a Document, Post, credits, feeds, or rendered
output. A malformed or stale collaboration replacement returns no new value. Publication is a
later, explicit boundary, so failure leaves canonical content and public output unchanged and
independently reviewable.

## Compatibility fixtures

| Fixture | Required interpretation |
| --- | --- |
| One participant | A valid Shared publication; no absent partner is implied. |
| Two participants | The ordinary group contract may project first and second UI slots without pair fields. |
| Three or ten participants | Authored participant order and stable-ID relationships remain intact. |
| Reordered or removed participant | References are revalidated; stale references fail as one private error. |
| Legacy Post without collaboration state | The existing parser, legacy-author fallback, credits, renderer, feeds, and output remain unchanged. |

The first four fixtures are exercised by the collaboration contract tests introduced with #155.
The legacy fixture is exercised by the contributor compatibility tests introduced with ADR 0003.
No migration is required because this decision adds language, not collaboration persistence on a
Post or Document.

## Consequences

- Product and implementation work can discuss private participation without promising authorship,
  publication, or site authority.
- One-, two-, and many-person experiences share the same group-safe vocabulary and contract shape.
- Public credits remain explicit, ordered, and independent from collaboration workflow state.
- Source-led collaboration can later adopt richer research references without redefining a source
  prompt as a citation or canonical identity.
- Persistence, workflow UI, reveal delivery, approval quorum, assembly rendering, authentication,
  and publication transitions require separate decisions and implementation slices.
