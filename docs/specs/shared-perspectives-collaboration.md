# Shared perspectives collaboration contract

Status: contract and authorization policy established; workflow UI and quorum behavior are not
implemented
Date: 2026-10-24

## Outcome

Shared-perspectives capabilities use one versioned, group-safe contract. Every relationship is an
ordered collection keyed by opaque participant or contribution IDs. No persisted or API field
represents “left/right,” “author A/B,” or another fixed pair. A two-person experience is a projection
of an otherwise unchanged group contract.

The surrounding domain terms are defined by
[ADR 0005](../adr/0005-shared-publication-language.md). In particular, private participation and
contribution ownership never imply public authorship or work credit. Source references are part of
that language but not of this version 1 contract; the private collaboration artifact adds them as an
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
  while another binding still holds `siteOwner`.
- **Manage roles** grants, changes, or revokes one participant's binding or roles. Policy
  replacement applies it to every binding a replacement adds, changes, or removes; for a binding
  that holds `siteOwner` before or after the change, the target counts as a site owner.
- View published and Export cover only the published projection. Neither exposes private
  collaboration state, which reaches public output only through a Published assembly under
  [ADR 0004](../adr/0004-portable-projections-from-canonical-work.md).

A binding's roles combine, so a coordinator who also holds `contributor` can edit and approve their
own draft. Site owners and coordinators cannot read, edit, reveal, or approve another participant's
private draft. An editor may view and edit their own draft or a draft revealed to them without
becoming its author, and cannot reveal or approve for anyone. A grant for Approve only permits the
bound participant to submit an approval; it does not create one. Authority to schedule or publish
does not create or bypass participant approvals. Exact-revision consent and the transactional
publication gate remain separate contracts.

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
  `from_json` loads a stored policy and takes no requester, so it is not a change path.

### Policy replacement

`AuthorizationPolicy::replace_from_json` takes the requester's context (its target is ignored),
the replacement, and the observed revision. Beyond the parse, publication, and revision checks, it
refuses the replacement unless all of these hold:

1. The requester passes the identity checks above and may Manage roles on their own binding, so
   only site owners and coordinators can change the policy.
2. The requester may Manage roles on every binding the replacement removes, adds, or changes.
   Bindings compare whole and in any order, and need not resolve in the contract yet, because an
   accepted invitation adds the participant and the binding in one transaction.
3. A policy that has a site owner keeps at least one.

A coordinator therefore cannot grant `siteOwner`, including to themselves, strip it from anyone,
or rebind a site owner's account, registry key, or participant.

### Limits and failure

The policy is capped at 64 KiB and 100 bindings. Unknown fields are rejected, so Markdown, URLs,
credentials, tokens, provider claims, and arbitrary metadata cannot enter it. Parsing,
authorization, and optimistic whole-policy replacement return the same non-identifying denial;
replacement must keep the publication ID, advance the observed revision by exactly one, and pass
the replacement rules above.
Because the policy has no document, renderer, feed, export, filesystem, or network integration,
denial cannot mutate canonical content or public output.

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
many ordered sources with stable IDs, and rejection of zero sources) arrive with the source
collection in #156.

Authorization matrix fixtures in `crates/openblog-core/tests/collaboration_authorization.rs`
check every role against every action and target kind, including unknown IDs and an unbound
participant, both when the requester is the only site owner and when another participant holds
`siteOwner`. Further fixtures cover registry entries and logins without a binding,
confused-deputy requests (another participant's draft, an unrevealed draft, a wrong target kind,
and approving for someone else), coordinators removing a site owner, removing the last site
owner, coordinators granting, stripping, or rebinding `siteOwner` through replacement, members
without membership roles changing any binding, removed Admin users, renamed contributors, removed
participants, another account claiming a binding, cross-publication use, Admin username and
registry key rules (including homoglyph, bidi, and NUL identities), unknown roles, hostile fields,
authorization in groups of 1, 2, 3, 10, and the binding limit (the last binding is found, its
site-owner role is honoured, and an unbound account is denied), and stale, replayed, skipped, and
exhausted policy revisions. An isolation pin builds a site with no collaboration input before and
after denials; it holds by construction, and the first collaboration-to-publication seam (#156
and #158) owns the real unchanged-output assertion.

## Out of scope

- Group workflow UI, layout rendering, reveal delivery, approval quorum, authentication, provider
  identity verification, and collaboration persistence.
- Adding collaboration data to existing documents, generated pages, feeds, or public APIs.
