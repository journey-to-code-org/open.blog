# Shared perspectives collaboration contract

Status: contract, authorization policy, private drafting, reveal, approval and publication
workflow established. Epic [#592](https://github.com/journey-to-code-org/open.blog/issues/592)
(PERSP1) tracks remaining group-workflow requirements.
Date: 2026-10-24

## Outcome

Shared-perspectives capabilities use one versioned, group-safe contract. Every relationship is an
ordered collection keyed by opaque participant or contribution IDs. No persisted or API field
represents “left/right,” “author A/B,” or another fixed pair. A two-person experience is a projection
of an otherwise unchanged group contract.

The surrounding domain terms are defined by
[ADR 0005](../adr/0005-shared-publication-language.md). In particular, private participation and
contribution ownership never imply public authorship or work credit. Source references are part of
that language but not of this version 1 contract; the
[shared publication record](#shared-publication-record) holds them beside the contract as an
ordered collection keyed by stable IDs.

The contract is intentionally isolated from the document model and renderer. Invalid collaboration
state cannot change source Markdown, canonical content, feeds, or public output.

## Version 1 wire contract

```json
{
  "version": 1,
  "revision": 12,
  "participants": [
    { "id": "ada", "displayName": "Ada", "profileUrl": "https://example.org/ada" },
    { "id": "grace", "displayName": "Grace" }
  ],
  "contributions": [
    { "id": "opening", "participantId": "ada", "markdown": "A perspective." }
  ],
  "reveals": [
    { "contributionId": "opening", "participantIds": ["grace"] }
  ],
  "layout": [
    { "contributionId": "opening", "region": "opening" }
  ],
  "approvals": [
    { "participantId": "ada", "revision": 12 }
  ]
}
```

- Array order is authored order and survives parsing and serialization.
- Participant and contribution IDs are opaque ASCII identifiers. A contribution belongs to one
  participant through `participantId`.
- Draft content, its revisions, and its mutual reveal are governed by ADR 0016 and the draft set,
  not by the entries below; they do not grant access to draft content.
- Each reveal entry names one contribution and an ordered set of participants allowed to receive
  that reveal. It does not imply a pair, a quorum, or publication.
- Layout is an ordered list of contribution-to-region relationships. Region vocabulary remains a
  consumer decision; version 1 validates it as a bounded identifier.
- An approval records one participant's approval of exactly the containing contract revision,
  which covers every contribution as it appears in that revision. Contributions have no revision
  of their own. Quorum and workflow transition rules are out of scope.
- `pair_projection()` is available only when the participant array contains exactly two entries. It
  derives first and second UI slots without adding pair-specific persisted state.

## Limits

| Input | Limit |
| --- | ---: |
| Encoded contract | 256 KiB |
| Participants | 100 |
| Contributions | 1,000 |
| Reveals | 1,000 |
| Layout entries | 1,000 |
| Approvals | 100 |
| Identifier | 128 bytes |
| Display name | 200 bytes |
| Profile URL | 2,048 bytes |
| Markdown per contribution | 64 KiB |
| Layout region | 64 bytes |

Byte limits count UTF-8 bytes, not characters. Each reveal and layout entry must name a distinct
contribution, so those collections can never outgrow the contribution collection. The encoded
contract limit also bounds the combined size of every contribution; validation is a single linear
pass with set lookups, so cost grows only with the bounded input.

## Authorization policy

[ADR 0006](../adr/0006-collaborator-identity-binding.md) records this decision. Authentication,
public attribution, and publication access remain three separate relationships:

- An Admin user proves who signed in. Removing the account invalidates its sessions through the
  existing Admin authentication boundary.
- A contributor registry entry supplies public credit identity. It grants no login or access, and
  it makes a person a Contributor for a work only when that work's credit sidecar names it.
- A publication policy deliberately binds one active Admin user and one current contributor ID
  to one participant ID from that publication's collaboration contract. The binding points at a
  registry entry; it never credits that entry on any work.

The version 1 policy is group-safe and contains no pair-specific fields:

```json
{
  "version": 1,
  "revision": 7,
  "publicationId": "shared-reflection",
  "bindings": [
    {
      "adminUser": "ada-admin",
      "contributorId": "ada",
      "participantId": "ada-participant",
      "roles": ["coordinator", "contributor"]
    }
  ]
}
```

- `adminUser` follows the Admin sign-in username rule (lowercase ASCII letters, digits, `_`, `.`,
  and `-`, at most 32 bytes). The rule lives in `openblog-core` and the CLI uses it when it
  creates an account, so every account the CLI creates can be bound and no binding can name an
  account the CLI could not create. Loading the users file does not re-check names, so a name
  hand-edited outside the rule can sign in but can never be bound.
- `contributorId` follows the contributor registry key rule (a lowercase ASCII slug), capped at
  128 bytes.
- `participantId` follows the contract identifier rule above.
- Bindings are one-to-one within a publication: Admin user, contributor ID, and participant ID
  cannot repeat, and participant IDs are compared ASCII case-insensitively as in the contract.
- A binding carries one or more distinct roles from `siteOwner`, `coordinator`, `contributor`,
  `editor`, and `reader`. These are publication-scoped collaboration roles: the `contributor`
  role means writing one's own contribution draft, not holding a public contributor credit, and
  `siteOwner` gives no site-wide Admin authority beyond this publication.

### Decisions

`AuthorizationPolicy::authorize` takes server-side facts for one request: the publication ID, the
authenticated Admin user from the session, the current Admin users, the current contributor
registry keys, the current collaboration contract, and a target. It denies by default and returns
the same non-identifying error unless all of these hold:

1. The policy belongs to the requested publication.
2. The signed-in account is still an active Admin user and has a binding in this policy.
3. The binding's contributor ID is still a registry key and its participant ID is still in the
   contract's participant collection.
4. The target has the kind the action takes and resolves in the contract.
5. One of the binding's roles allows the action on that resolved target.

The check takes no policy or contract revision, so it cannot tell a stale policy from a current
one; see the caller obligations below. Missing, removed, renamed, cross-publication, or unbound
identities receive no access, whatever roles the policy lists. A registry entry, a login, or a participant record alone
grants nothing.

Targets are `Publication`, `Participant(id)`, or `Contribution(id)`. The request supplies only the
ID. A contribution's owner and its reveal recipients are read from the contract, so a request
cannot claim to act on its own draft while naming another participant's, and a target of the
wrong kind is denied rather than ignored.

| Action | Target | Site owner | Coordinator | Contributor | Editor | Reader |
| --- | --- | --- | --- | --- | --- | --- |
| View publication | Publication | Yes | Yes | Yes | Yes | Yes |
| View published | Publication | Yes | Yes | Yes | Yes | Yes |
| View revealed | Contribution | Revealed | Revealed | Revealed | Revealed | Revealed |
| View contribution | Contribution | No | No | Own | Own or revealed | No |
| Edit contribution | Contribution | No | No | Own | Own or revealed | No |
| Invite | Publication | Yes | Yes | No | No | No |
| Reveal | Contribution | No | No | Own | No | No |
| Approve | Participant | No | No | Self | No | No |
| Schedule | Publication | Yes | Yes | No | No | No |
| Publish | Publication | Yes | Yes | No | No | No |
| Remove member | Participant | Any but the last site owner | Not a site owner | No | No | No |
| Manage roles | Participant | Any | Not a site owner | No | No | No |
| Export | Publication | Yes | Yes | Yes | Yes | Yes |

- **Own** means the contract lists the bound participant as the contribution's owner.
- **Revealed** means that contribution's reveal lists the bound participant. View revealed is
  checked per contribution, so any surface that lists or delivers revealed drafts must authorize
  each draft and deliver nothing for a denied one.
- **Self** means the target is the bound participant. An approval is recorded only for the
  requester's own participant.
- **Any** and **Not a site owner** refer to the target participant. A coordinator cannot remove a
  participant whose binding holds `siteOwner`, or grant, change, or revoke that binding. A
  participant with no binding is not a site owner.
- **Any but the last site owner** means a site owner may remove anyone, including themselves,
  while another current binding still holds `siteOwner`. A site-owner binding whose account,
  registry key, or participant is gone cannot act, so it does not count as the remaining one.
- **Manage roles** grants or revokes one participant's binding, or changes its roles. Policy
  replacement applies it to every binding a replacement adds, changes, or removes; for a binding
  that holds `siteOwner` before or after the change, the target counts as a site owner. It never
  changes who a binding is (see Policy replacement).
- View publication covers the record's title, guiding question, and source references. It
  never delivers a contribution draft, another participant's binding, or an Admin username.
- View published and Export cover only the published projection. Neither exposes private
  collaboration state, which reaches public output only through a Published assembly under
  [ADR 0004](../adr/0004-portable-projections-from-canonical-work.md).

A binding's roles combine, so a coordinator who also holds `contributor` can edit and approve their
own draft. Site owners and coordinators cannot read, edit, reveal, or approve another participant's
private draft. An editor may view and edit their own draft or a draft revealed to them without
becoming its author, and cannot reveal or approve for anyone. A grant for Approve only permits the
bound participant to submit an approval; it does not create one. Authority to schedule or publish
does not create or bypass participant approvals. Exact-revision consent and the transactional
publication gate remain separate contracts; [ADR 0014](../adr/0014-record-level-authorization-and-publish-gate.md)
records the single record-level check and the refusal to publish unapproved contributions.

### Caller obligations

- Fill the identity fields from the authenticated session, the users file, and the contributor
  registry on every request, never from the request body.
- Load the policy and the contract from the same publication record. The version 1 contract has
  no publication ID of its own, so the record that stores both is what ties them together.
- Authorize inside the same transaction as the change the grant permits, against the current
  policy and contract revisions, and let an optimistic revision conflict fail the request.
- Change bindings only through `AuthorizationPolicy::replace_from_json` with the requester's
  context. Invitations ([#159](https://github.com/journey-to-code-org/open.blog/issues/159)) and
  member management ([#161](https://github.com/journey-to-code-org/open.blog/issues/161)) add,
  change, and remove bindings this way, and invitations must bind the account that accepts.
  Accepting an invitation is the one other way a binding is added: it applies the same rules from
  the invitation, see [ADR 0013](../adr/0013-publication-scoped-invitations.md).
  `from_json` loads a stored policy and takes no requester, so it is not a change path.
- Treat Admin usernames and registry keys as names that a binding would follow if reused.
  Removing an Admin account or renaming a registry key must also remove that name's bindings in
  every policy, or the name must never be reused. The
  [shared publication record](#shared-publication-record) enforces this for the supported paths:
  `openblog user remove` and `openblog user add` remove the username from every record's
  bindings, and the Admin Contributors editor refuses to remove a bound registry key. A hand edit
  that removes an account or key leaves a binding that grants nothing until the name returns.

### Policy replacement

`AuthorizationPolicy::replace_from_json` takes the requester's context (its target is ignored),
the replacement, and the observed revision. Beyond the parse, publication, and revision checks, it
refuses the replacement unless all of these hold:

1. The requester passes the identity checks above and may Manage roles on their own binding, so
   only site owners and coordinators can change the policy.
2. The requester may Manage roles on every binding the replacement removes, adds, or changes.
   Bindings match by participant ID (ASCII case-insensitively) in any order, and roles compare
   as a set, so re-sorting roles is not a change. A new binding need not resolve in the contract
   yet, because an accepted invitation adds the participant and the binding in one transaction.
3. Only roles change. A binding kept for the same participant keeps exactly the same Admin user,
   contributor ID, and participant ID. A new binding uses no Admin user or contributor ID that a
   current binding holds, so nobody can move their own account, or anyone else's, onto a
   different participant.
4. A new binding does not name a participant that the current contract links to a contribution,
   a reveal, or an approval. A participant removed from the policy therefore cannot be re-bound
   to another account later, and invitations add new participants rather than taking over
   existing ones.
5. A policy that has a current site owner keeps at least one. Current means that the account,
   the registry key, and the participant all still exist, as for the requester.

A coordinator therefore cannot grant `siteOwner`, including to themselves, strip it from anyone,
or rebind a site owner's account, registry key, or participant. No requester, not even a site
owner, can use replacement to rebind a participant or take over another participant's drafts,
reveals, or approvals.

### Limits and failure

The policy is capped at 64 KiB and 100 bindings. Unknown fields are rejected, so Markdown, URLs,
credentials, tokens, provider claims, and arbitrary metadata cannot enter it. Parsing,
authorization, and optimistic whole-policy replacement return the same non-identifying denial;
replacement must keep the publication ID, advance the observed revision by exactly one, and pass
the replacement rules above.
Because the policy has no document, renderer, feed, export, filesystem, or network integration,
denial cannot mutate canonical content or public output.

## Shared publication record

[ADR 0007](../adr/0007-private-shared-publication-records.md) records this decision. Each shared
publication is one versioned JSON file at
`.openblog/private/collaboration/publications/<publication-id>.json`, outside the content
directory and ignored by Git. It is the publication record that ties the policy and the contract
together:

```json
{
  "version": 1,
  "publicationId": "shared-0a1b2c3d4e5f",
  "title": "On attention",
  "guidingQuestion": "What does attention ask of us?",
  "sources": [
    {
      "id": "source-1",
      "kind": "video",
      "title": "The Art of Noticing",
      "url": "https://www.youtube.com/watch?v=abc123",
      "creator": "A channel",
      "provenance": "author"
    },
    {
      "id": "source-2",
      "kind": "book",
      "title": "Middlemarch",
      "creator": "George Eliot",
      "publisher": "Blackwood",
      "published": "1871",
      "isbn": "978-0-14-143954-9",
      "provenance": "author"
    }
  ],
  "collaboration": { "version": 1, "revision": 1, "participants": ["…"], "…": "…" },
  "authorization": { "version": 1, "revision": 1, "publicationId": "shared-0a1b2c3d4e5f", "…": "…" }
}
```

- `publicationId` is random (`shared-` and 12 hex digits), follows the identifier rule, is the
  file stem, and must equal the policy's `publicationId`. A file stored under another name is
  ignored.
- A title, a guiding question, or both must be present. They follow the display-name text rules:
  ordinary Unicode, one line, visible text, and no bidi controls.
- `sources` is ordered and holds one to 20 entries. Source IDs follow the identifier rule, are
  unique ASCII case-insensitively, and are assigned in authored order at creation (`source-1`,
  `source-2`, …). `kind` is `video`, `article`, `podcast`, `book`, or `other`. A title is
  required; `url`, `creator`, `publisher`, `published`, and `isbn` are optional, and `isbn` is
  accepted only for a book. `provenance` is `author` in version 1: every value was typed by a
  person, and later provider suggestions need their own provenance. Version 1 deliberately
  deviates for lookups: values filled from a provider suggestion are saved as `author` (ADR 0007,
  "Optional source metadata").
- A source link is an absolute HTTP or HTTPS URL with no username or password, a valid host and
  port, and no control or bidi characters. Creation trims and normalizes a pasted link, so a
  Unicode host becomes punycode and a Unicode path is percent-encoded; a stored link must already
  be ASCII. Nothing fetches the link.
- An ISBN has 10 digits (the last may be `X`) or 13 digits, optionally grouped by hyphens or
  spaces. The checksum is not verified, so a mistyped digit is kept rather than rejected.
- At creation the contract has one participant, `participant-1`, whose display name is the chosen
  registry entry's name, and no contributions, reveals, layout, or approvals. The policy binds the
  signed-in Admin user and the chosen registry key to that participant with `siteOwner` and
  `contributor`. Both revisions start at 1.
- Unknown fields are rejected throughout. Stored-record failures return one non-identifying
  error; creation errors name a field and a source position from the requester's own submission
  and never repeat a value.

| Input | Limit |
| --- | ---: |
| Encoded record | 384 KiB |
| Sources | 20 |
| Title | 300 bytes |
| Guiding question | 1,000 bytes |
| Source title | 300 bytes |
| Creator or publisher | 200 bytes |
| Published date | 64 bytes |
| Source link | 2,048 bytes |

### Admin API

Both routes require a signed-in session; creation also requires the CSRF token, a same-origin
request, and `Content-Type: application/json`.

- `POST /admin/api/collaboration/publications` takes `title`, `guidingQuestion`,
  `contributorId`, and ordered `sources`, each with `kind`, `title`, `url`, `creator`,
  `publisher`, `published`, and `isbn`. Any other field is refused, so a body cannot name an Admin
  user, participant, role, or binding. `contributorId` must be a current registry key; it is the
  creator's unverified choice, because no link from Admin users to registry keys exists yet (see
  [ADR 0007](../adr/0007-private-shared-publication-records.md)). It returns
  `201` with the summary below, or `422` with `error` and `field` (for example `title` or
  `sources.1.url`).
- `GET /admin/api/collaboration/publications` lists the summaries of records where the signed-in
  account may View publication, so an unbound account, a removed account, or a renamed registry
  key sees nothing.

A summary holds `publicationId`, `title`, `guidingQuestion`, `sources`, and the requester's own
`roles`. It never includes participants, bindings, Admin usernames, or drafts.

Creation holds the content transaction lock, writes the record to a private temporary file, and
hard-links it into place. The link fails rather than overwrite a taken ID, and the temporary file
is removed whether or not it succeeds. Creation reads the registry but never writes `content/`,
`openblog.json`, or the build output.

## Validation and failure contract

- Unknown fields are rejected. Credentials, session tokens, arbitrary metadata, and provider
  identity claims therefore cannot enter this persisted/API shape.
- IDs must be unique in their collection; participant and contribution IDs are compared ASCII
  case-insensitively, so `Ada` and `ada` cannot share one file key on a case-insensitive
  filesystem. References match the exact ID and must resolve, including after removals and
  reorders. Reveal recipients and approvals cannot repeat.
- Identifiers and layout regions are opaque ASCII letters, digits, `-`, `_`, and `.`; they cannot
  start or end with a separator, contain `..`, or have a Windows device stem (`con`, `prn`, `aux`,
  `nul`, `com0`-`com9`, `lpt0`-`lpt9`, in any case and before any `.`), so dot segments, path
  traversal, and device files cannot be expressed if a later consumer keys files or URLs by them.
- Profile URLs reuse the contributor profile-link rules, narrowed to absolute HTTPS: no
  credentials, invalid ports, empty host labels, control characters, or whitespace. Non-ASCII must
  be percent-encoded (hosts in punycode), which also keeps bidi controls out of displayed links.
- Display names keep ordinary Unicode, including the joiners, variation selectors, and tags used
  by scripts and emoji, but reject control characters, the U+2028/U+2029 line and paragraph
  separators, and bidi embedding/override/isolate marks, so a name cannot break across lines or be
  reordered into a different string. A name must also contain a visible character: whitespace,
  Default_Ignorable_Code_Point characters, and blank fillers such as U+3164 and U+2800 alone are
  rejected, so no participant renders as nobody. Names are not unique and confusable names are
  allowed, so a display surface must distinguish participants by ID.
- Contribution Markdown is retained as untrusted source, bounded, and rejected when it contains a
  NUL byte. A future display surface must pass it through open.blog's normal Markdown and
  HTML-safety pipeline; the contract never renders it.
- Parsing and validation return one non-identifying error. The error does not echo Markdown, URLs,
  IDs, tokens, metadata, or another participant's content.
- Replacement is whole-contract and optimistic: the caller supplies the observed revision and the
  replacement must advance it by exactly one. Stale, malformed, oversized, or invalid replacements
  return no new value and cannot partially mutate the current contract.
- Authorization-policy parsing, decisions, and replacement expose no submitted identity or private
  participant data in errors.

## Testing contract

Property-style fixtures cover groups of 1, 2, 3, 10, and the maximum participant count, reordered
participants, duplicates in every collection, and removals that either purge every reference or
leave one dangling. The pair projection is checked to exist only for two participants and to add no
persisted state, and every serialized key of the contract and authorization policy is checked for
pair-specific names. Boundary fixtures accept every limit at its maximum and reject it one past
(approvals, capped at one per participant, are checked at the maximum group). Further fixtures
cover untrusted fields, dot-segment, device-name, case-colliding, and lookalike identifiers,
Unicode and spoofed or blank display names, URLs, verbatim hostile Markdown, stale, replayed,
skipped, and exhausted revisions, and private errors. Because this module has no renderer, Admin,
filesystem, or network integration, canonical content and public output remain unchanged by
construction.

Shared-publication language fixtures check that the glossary keeps collaboration terms apart from
Post, Contributor, Author, Work credit, and Admin user, that bound and approving participants in
groups of 1, 2, 3, and 10 create no work credit while explicit credit keeps sidecar order, and that
collaboration-shaped front matter on a legacy post stays lossless and changes no credit or
generated output. The no-credit property holds by construction while site loading takes no
collaboration input; the first collaboration-to-publication seam must route bindings and
approvals through it and assert that credits are unchanged. Source-reference fixtures (one and
many ordered sources with stable IDs, and rejection of zero sources) live in
`crates/openblog-core/tests/shared_publication_record.rs`.

Authorization matrix fixtures in `crates/openblog-core/tests/collaboration_authorization.rs`
check every role against every action and target kind, including unknown IDs and an unbound
participant, both when the requester is the only site owner and when another participant holds
`siteOwner`. Further fixtures cover registry entries and logins without a binding,
confused-deputy requests (another participant's draft, an unrevealed draft, a wrong target kind,
and approving for someone else), coordinators removing a site owner, removing the last site
owner (a stale site-owner binding does not count as the remaining one), coordinators granting,
stripping, or rebinding `siteOwner` through replacement, coordinators and site owners swapping
another participant's account or registry key in place, moving their own binding onto another
participant, or removing and re-adding a participant who has drafts, reveals, or approvals, role
re-sorting that is not a change, members
without membership roles changing any binding, removed Admin users, renamed contributors, removed
participants, another account claiming a binding, cross-publication use, Admin username and
registry key rules (including homoglyph, bidi, and NUL identities), unknown roles, hostile fields,
authorization in groups of 1, 2, 3, 10, and the binding limit (the last binding is found, its
site-owner role is honoured, and an unbound account is denied), and stale, replayed, skipped, and
exhausted policy revisions. An isolation pin builds a site with no collaboration input before and
after denials; it holds by construction, and the first collaboration-to-publication seam (#156
and #158) owns the real unchanged-output assertion. The Admin tests for creation compare the
content directory before and after every accepted and refused request and scan a full build for
the record's title, question, sources, IDs, and contributor key.

Duplicate IDs, rollback of a failed write, and refused or spoofed bodies are covered by the core
record fixtures, `crates/openblog-cli/src/shared_publications.rs`, and the Admin API tests. The
browser tests in `tests/web/admin-shared-reflection.test.mjs` cover the client side of a failure:
a `422` or `500` maps to a field or to the status message without discarding the draft, and an
error without a known field focuses the status alert.

## Outside the original contract scope

The original contract did not define the group workflow UI, layout rendering, reveal delivery,
approval quorum, authentication, provider identity verification, or persistence beyond creating
a shared publication record. Later decisions and implementations cover parts of that work;
the remaining requirements are tracked in epic #592.

## Reviewing and approving in Admin

An author can open the combined preview and, when every current section is visible, affirm
approval of that exact preview, including its public credits. An author may withdraw approval,
and an out-of-date preview must be reloaded before it can be approved.

The private credit-choice API lets participants save only their own choice; profile details
are taken from the server's registry. New reflections require choices for everyone whose work
appears before complete review, approval, scheduling and publication; legacy reflections
switch to that behavior when any choice is saved. Display-name
choices receive a separately generated public identifier, never the participant ID. Missing
choices and older display-name choices without such an identifier block complete review and
publication; the participant must select the name again. Choice revisions bind the complete
preview, approval and publication, so changing and reverting a choice does not revive consent.
The preview shows the exact frozen credits only after the requester can read the entire piece.

Older reflections without any saved choices still use the legacy contributor-profile publication
path. Older releases cannot read newly created records carrying the explicit-choice requirement.
Remaining collaboration work is tracked in epic #592.

The draft set can list and reorder a participant's own live contributions with an expected
order and ordering revision. A monotonic order revision is bound into approval, including after
an order is restored or a separate contribution is created and withdrawn. Once this mode has
been used, new or withdrawn contributions also advance that revision.
The opt-in multi-contribution approval subject covers every live contribution's owner, ID and
revision; a credit-aware variant also binds participant credit choices and projects credit for
authors whose contribution IDs differ from their participant IDs. These subjects are not issued
by Admin until complete multi-contribution previews are available.
The draft set also supports atomic offers of all of an author's current contributions: mutual
reveal waits for each active author, and each committed revision remains distinct. Voluntary
offers can be taken back, while named releases remain specific to a contribution and recipients.
Older releases cannot read multi-contribution offers or exchanges; the Admin routes do not yet
create them.
An opt-in arrangement reader resolves distinct contribution IDs against authorized ownership
metadata, checks stored ownership, and applies draft or named-reader visibility to each turn.
Ownership metadata can be derived transiently from the private draft set, without copying private
prose or persisting a second ownership source. Its caller must authorize disclosure of every ID.
A separate opt-in coverage check rejects arrangements that omit a live part or reference a
different owner, duplicate ownership metadata, or nonexistent parts. An opt-in assembly path
checks those constraints after credit-bound approvals and publishes every arranged part in order.
An initial arrangement can be derived in each owner's chosen contribution order; it splits
large arrangements into rounds and refuses pieces beyond the part limit rather than truncating.
The coverage check reads private drafts and its result must not be exposed before whole-piece
approval.
An opt-in complete review path refuses a token unless every current contribution is visible,
the arrangement covers every part, and the public credit choices are complete. It uses the same
credit-bound subject as multi-contribution assembly. A matching opt-in receipt captures every
included contribution revision. Proposed moments must be sealed to the owner's exact live
contribution revisions before review or assembly. A seal for a given snapshot is write-once;
editing a moment stays private until a different contribution revision is offered. These moment
seals are not yet wired into Admin sharing, and older releases cannot read them.
Admin review, approval, scheduling and publication now use these multi-contribution gates when
separate contributions already exist. Authoring and sharing controls still support one draft per
participant; the core ordering operation is not exposed until those paths are completed.
The legacy preview cannot issue complete-review tokens and the legacy assembly cannot publish
while an active author has a separate live contribution.
Older releases cannot read draft sets after this ordering operation changes their order.

When an approver submits an approval, the server checks again that the current combined preview is
complete for them. If sharing changed after the preview was opened, the earlier review token
cannot be used while any current material is hidden; they must reload after it is shared.
This check does not withdraw approvals already recorded before a sharing change.

At creation, the initial whole-piece rule defaults to all participants; the creator may instead
select a fixed participant quorum from 1 to 100. The threshold may exceed the current group and
never decreases automatically. Records without an initial requirement retain their legacy
author-only default, and an existing approval set always takes precedence over that initial rule.
Older releases cannot read records containing the new initial requirement.

The approval rule may be proposed by a site owner or coordinator, but changes only after every
active, bound participant explicitly agrees to the same proposal, including coordinators and
readers. Reader-only participants can review and vote on the rule and read explicitly named draft
releases and their sealed current source moments, but cannot see mutual releases or the piece's
approval status. Consent
can be withdrawn before the rule changes. Membership or access
changes stale the proposal. Rule consent does not approve the piece; applying the rule clears
piece approvals. New reflections require whole-piece approval under every rule, so an edit
invalidates all approvals. If an earlier version saved a section-only rule for a new reflection,
participants must unanimously replace it with a whole-piece rule before approving, scheduling or
publishing. Legacy reflections retain their existing scope unless they select a numeric quorum,
which always requires whole-piece approval. A fixed quorum counts standing approvals from current
authors who hold the contributor role; every writer and attributed author must separately approve.
It is not reduced when authors leave. A proposal exceeding the current eligible author count is
refused, and only a site owner may propose weakening an existing quorum. The normal unanimous
proposal process still applies. Every whole-piece approval binds membership and authorization
revisions, so changing access invalidates it even if a removed role is later restored. Existing
non-quorum whole-piece approvals from before this binding require review again; legacy section-only
bindings are unchanged. A group can instead unanimously select all participants or a fixed
participant quorum; every writer and attributed author must still approve. Readers and other
non-drafters can approve only after all current drafts, their sealed moments, and the conversation
have been explicitly shared with them. A conversation is shared with a recipient only after every
current conversation author consents to that delivery. Existing author-only rules keep their
meaning. Older releases cannot read an approval set containing a numeric quorum or either
participant rule.

Publishing stores a private receipt identifying the approved section revisions and hashing the
exact resulting Post and credit sidecar. The receipt contains no draft prose and is not public
output. Older timestamp-only publication outcomes remain readable.

## Named-recipient sharing

Alongside the mutual-reveal default, a coordinator may select named-recipient sharing. Each
author chooses the current revision and recipients and confirms the release. Only the named
active recipients can read that revision; later edits and other recipients remain private.
Proposed source moments sealed to a current revision may accompany it. See
[ADR 0018](../adr/0018-reveal-policy-readiness-and-comparison.md) for access and compatibility.

## Public source attribution

[ADR 0008](../adr/0008-public-source-attribution.md) records how a shared reflection's source
reaches public output. Only the guiding question and the first source's title, link, and type are
published, as `guidingQuestion`, `sharedSourceTitle`, `sharedSourceUrl`, and `sharedSourceType`
front matter. `SharedAttribution::from_record` derives them from the private record;
`SharedAttribution::from_front_matter` validates them on load and fails the load for an unsafe
link, unknown type, control or bidi character, or oversized text. The native page, Admin preview,
RSS, JSON Feed, `llms-full.txt`, and portable HTML, Markdown, and text all render the same values,
and the portable projection treats them as required semantic facts. The fixtures in
`crates/openblog-core/tests/shared_source_attribution.rs` scan the built site, preview, feeds, and
every portable representation for the record's IDs, identities, ISBN, creator, publisher,
invitation text, and local paths.
