# Shared perspectives collaboration contract

Status: contract established; workflow UI and quorum behavior are not implemented
Date: 2026-10-24

## Outcome

Shared-perspectives capabilities use one versioned, group-safe contract. Every relationship is an
ordered collection keyed by opaque participant or contribution IDs. No persisted or API field
represents “left/right,” “author A/B,” or another fixed pair. A two-person experience is a projection
of an otherwise unchanged group contract.

The surrounding domain terms are defined by
[ADR 0005](../adr/0005-shared-publication-language.md). In particular, private participation and
contribution ownership never imply public authorship or work credit.

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
- An approval records one participant's approval of exactly the containing contract revision.
  Quorum and workflow transition rules are out of scope.
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

Authentication, public attribution, and publication access remain three separate relationships:

- An Admin account proves who signed in. Removing the account invalidates its sessions through the
  existing Admin authentication boundary.
- A contributor registry entry supplies public credit identity. It grants no login or access.
- A publication policy deliberately binds one active Admin account and one current contributor ID
  to one participant ID from that publication's collaboration contract.

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

Bindings are one-to-one within a publication: Admin account, contributor ID, and participant ID
cannot repeat. A binding may carry multiple distinct roles. Authorization checks the publication,
currently authenticated account, active Admin-user set, current contributor registry, current
participant collection, requested action, and (for participant-owned actions) target participant on
every request. Missing, removed, renamed, stale, cross-publication, or unbound identities deny by
default.

| Role | View published | View revealed | View contribution | Edit contribution | Invite | Reveal | Approve | Schedule | Publish | Remove member | Export |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Site owner | Yes | Yes | No | No | Yes | No | No | Yes | Yes | Yes | Yes |
| Coordinator | Yes | Yes | No | No | Yes | No | No | Yes | Yes | Yes | Yes |
| Contributor | Yes | Yes | Own | Own | No | Own | Own | No | No | No | Yes |
| Editor | Yes | Yes | Yes | Yes | No | No | No | No | No | No | Yes |
| Reader | Yes | Yes | No | No | No | No | No | No | No | No | Yes |

An editor may edit without becoming the attributed author and cannot reveal or approve for a
participant. An authorization grant for `Approve` only permits the bound participant to submit an
approval; it does not create one. Site-owner or coordinator authority to schedule or publish does
not manufacture or bypass participant approvals. Exact-revision consent and the transactional
publication gate remain separate contracts.

The policy is capped at 64 KiB and 100 bindings. Unknown fields are rejected, so Markdown, URLs,
credentials, tokens, provider claims, and arbitrary metadata cannot enter it. Parsing,
authorization, and optimistic whole-policy replacement return the same non-identifying denial;
replacement must keep the publication ID and advance the observed revision by exactly one.
Because the policy has no document, renderer, feed, export, filesystem, or network integration,
denial cannot mutate canonical content or public output.

## Validation and failure contract

- Unknown fields are rejected. Credentials, session tokens, arbitrary metadata, and provider
  identity claims therefore cannot enter this persisted/API shape.
- IDs must be unique in their collection. Every participant or contribution reference must resolve,
  including after removals and reorders. Reveal recipients and approvals cannot repeat.
- Identifiers and layout regions are opaque ASCII letters, digits, `-`, `_`, and `.`; they cannot
  start or end with a separator or contain `..`, so dot segments and path traversal cannot be
  expressed if a later consumer keys files or URLs by them.
- Profile URLs reuse the contributor profile-link rules, narrowed to absolute HTTPS: no
  credentials, invalid ports, empty host labels, control characters, or whitespace. Non-ASCII must
  be percent-encoded (hosts in punycode), which also keeps bidi controls out of displayed links.
- Display names keep ordinary Unicode, including the joiners used by scripts and emoji, but reject
  control characters, bidi embedding/override/isolate marks, and names made only of whitespace or
  invisible characters, so one participant cannot render as another or as nobody. Contribution Markdown is retained as untrusted source,
  bounded, and rejected when it contains a NUL byte. A future display surface must pass it through
  open.blog's normal Markdown and HTML-safety pipeline; the contract never renders it.
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
pair-specific names. Boundary fixtures cover each limit, untrusted fields, dot-segment and
lookalike identifiers, Unicode and spoofed display names, URLs, verbatim hostile Markdown, stale,
replayed, skipped, and exhausted revisions, and private errors. Because this module has
no renderer, Admin, filesystem, or network integration, canonical content and public output remain
unchanged by construction.

Authorization matrix fixtures cover every role and action plus confused-deputy targeting, removed
Admin users, renamed contributors, removed participants, unbound accounts, cross-publication use,
hostile fields, group sizes, and atomic policy replacement.

## Out of scope

- Group workflow UI, layout rendering, reveal delivery, approval quorum, authentication, provider
  identity verification, and collaboration persistence.
- Adding collaboration data to existing documents, generated pages, feeds, or public APIs.
