# Shared perspectives collaboration contract

Status: contract established; workflow UI and quorum behavior are not implemented
Date: 2026-10-24

## Outcome

Shared-perspectives capabilities use one versioned, group-safe contract. Every relationship is an
ordered collection keyed by opaque participant or contribution IDs. No persisted or API field
represents “left/right,” “author A/B,” or another fixed pair. A two-person experience is a projection
of an otherwise unchanged group contract.

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

## Validation and failure contract

- Unknown fields are rejected. Credentials, session tokens, arbitrary metadata, and provider
  identity claims therefore cannot enter this persisted/API shape.
- IDs must be unique in their collection. Every participant or contribution reference must resolve,
  including after removals and reorders. Reveal recipients and approvals cannot repeat.
- Profile URLs must be absolute HTTPS URLs without credentials, control characters, or whitespace.
- Display names reject control characters. Contribution Markdown is retained as untrusted source,
  bounded, and rejected when it contains a NUL byte. A future display surface must pass it through
  open.blog's normal Markdown and HTML-safety pipeline; the contract never renders it.
- Parsing and validation return one non-identifying error. The error does not echo Markdown, URLs,
  IDs, tokens, metadata, or another participant's content.
- Replacement is whole-contract and optimistic: the caller supplies the observed revision and the
  replacement must advance it by exactly one. Stale, malformed, oversized, or invalid replacements
  return no new value and cannot partially mutate the current contract.

## Testing contract

Property-style fixtures cover groups of 1, 2, 3, and 10 participants, reordered participants,
duplicates, and references to a removed participant. Boundary fixtures cover untrusted fields,
identities, URLs, Markdown, atomic revision replacement, and private errors. Because this module has
no renderer, Admin, filesystem, or network integration, canonical content and public output remain
unchanged by construction.

## Out of scope

- Group workflow UI, layout rendering, reveal delivery, approval quorum, authentication, provider
  identity verification, and collaboration persistence.
- Adding collaboration data to existing documents, generated pages, feeds, or public APIs.
