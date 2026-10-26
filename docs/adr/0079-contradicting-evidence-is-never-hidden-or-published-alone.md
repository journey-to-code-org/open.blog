# ADR 0079: Contradicting evidence is never hidden, and support is never published alone

- Status: Accepted
- Date: 2026-10-26
- Decision issue: [#44](https://github.com/journey-to-code-org/open.blog/issues/44)
- Parent story: [#20](https://github.com/journey-to-code-org/open.blog/issues/20)
- Builds on: [ADR 0054](0054-attributed-evidence-based-relationships.md),
  [ADR 0078](0078-claims-and-evidence-links-record-the-authors-reading.md)
- Contract: [Claims and evidence links format](../specs/claims-evidence.md)

## Context

Showing only the sources that agree with a claim misleads readers even if every link is accurate.
The format also must keep private material private by default.

## Decision

- **Private by default.** `visibility` is `private` unless the author writes `approved`, on claims
  and on links separately. Approval is consent for one item.
- **Order is file order.** Accessors return links in stored order and counts per relation. No
  helper sorts, ranks or collapses relations, so contradiction cannot be pushed out of view or
  netted against support.
- **Support is not publishable while contradiction is withheld.** An approved `supports` link on
  a claim that has any contradicting link that is not approved is refused
  (`undisclosed-contradiction`). The author approves the contradicting link too, or withdraws the
  support. This is the conservative, reversible choice: it stops partial disclosure and costs the
  author one edit. Private rationale stays private either way; the projection (#47) decides
  rationale separately.
- **Approval exposes nothing more.** An approved link needs its claim approved. An approved link
  may not carry a private notebook `passage` (as in ADR 0054); it cites source and locators. A
  `suggested` claim cannot be approved, and a `suggested` link only once `reviewState` is
  `reviewed`, so an assistant's suggestion is never published as the author's reading.
- **Projection helper.** `is_projected` is true only when link and claim are both approved.
- **Leak guard.** A claims file is recognised by structure (`claims` with `post` and `statement`,
  `links` with a typed `relation` and evidence object) and added to the structural check build
  guards already use for notebooks and atlases, so a copy in `content/`, `static/` or a theme is
  refused without echoing its text.

## Consequences

- #47 may rely on these invariants and only needs an allowlisted field copy.
