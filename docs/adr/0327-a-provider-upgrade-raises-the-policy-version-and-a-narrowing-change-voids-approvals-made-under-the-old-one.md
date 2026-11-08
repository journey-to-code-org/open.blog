# ADR 0327: A provider upgrade raises the policy version, and a narrowing change voids approvals made under the old one

- Status: Accepted
- Date: 2026-10-29
- Parent epic: [#381](https://github.com/journey-to-code-org/open.blog/issues/381)
- Story: #389 (task DIST1.1.3)

## Context

Providers change their APIs, permissions and limits (LinkedIn retires a dated API version roughly a year after it
ships; Meta versions the Graph API). When a manifest changes, an author's earlier preview or approval of a
distribution may rest on facts that are no longer true. The two halves of the contract (ADR 0326) must also never
drift apart.

## Decision

- **Every change raises `policyVersion`.** `compatibility(old, new)` compares two manifests of one provider and refuses
  (`policy-version-not-raised`) any change that keeps or lowers the policy version, and refuses two different providers
  (`different-provider`). So one provider and policy version always mean one set of facts.
- **Three levels, with fixed change codes in a stable order** (breaking changes first):
  - `same`: nothing a plan depends on changed (raising the version alone is allowed).
  - `compatible`: only `capability-widened:<name>`, `constraint-loosened:<name>` (a larger maximum, a shorter
    minimum lead, a limit removed) or `documentation-changed` (label, sources). Approvals stand.
  - `breaking`: `capability-narrowed:<name>` (support lowered along unsupported < manual < adapter),
    `constraint-tightened:<name>` (a limit added or made stricter), `login-changed` (method or scopes: an account may
    need reconnecting), `canonical-changed`, `publishing-changed`, or `manifest-format-changed`. Approvals made under
    the older policy version are void: the author previews and approves again (story #390 pins each approval to a
    provider and policy version and calls `approval_stands`).
- **One fixture holds both halves and the shipped manifests.** `tests/fixtures/provider-manifests.json` contains the
  shipped manifests exactly, the refused manifests with their codes, the request checks with their ineligibility
  codes, the unknown requested capabilities, and the upgrade cases with their levels. The Rust tests
  (`crates/openblog-core/tests/provider_manifest.rs`) and the hosted tests (`tests/web/social-capabilities.test.mjs`)
  both run it. Changing a shipped manifest therefore fails both suites until the fixture is updated, which is the
  moment to raise the policy version and record the provider documentation that justified it.
- **Re-verification is part of an upgrade.** Raising a policy version means re-reading the sources listed in the
  manifest; `docs/provider-capabilities.md` records what was verified and when.

## Considered options

- **Semantic version numbers for providers.** Rejected: whether a change breaks a plan is decided by the policy above,
  not by a number someone chose; a date says when the facts were checked.
- **Allow approvals to survive any change.** Rejected: a narrowed capability could otherwise send something the author
  approved under different terms.

## Consequences

- A compatible provider upgrade costs the author nothing; a breaking one asks them to look again before anything is
  sent.
- The fixture is the review point for every provider change.
