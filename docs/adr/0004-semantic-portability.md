# ADR 0004: One semantic representation governs portable publishing

- Status: Accepted
- Date: 2026-10-24
- Decision issue: [#103](https://github.com/journey-to-code-org/open.blog/issues/103)

## Context

open.blog already parses an author-owned document into shared domain models and renders native
pages, feeds, previews, and destination payloads from those models. Cross-destination publishing
will encounter capabilities that another system can preserve, approximate, or only link back to.
Creating another editable document model for those copies would let canonical content, credits,
references, and identity drift.

The portability language must align with
[Citation](../../CONTEXT.md#evidence-and-identity),
[Reference](../../CONTEXT.md#evidence-and-identity),
[Work credit](../../CONTEXT.md#evidence-and-identity),
[Content profile](../../CONTEXT.md#language), and
[Publishing capability](../../CONTEXT.md#language). A citation remains an in-text pointer and a
work credit remains an attribution relationship even when a destination renders each with a
different widget or payload shape.

## Decision

Adopt this invariant: a document has one destination-independent
[semantic representation](../../CONTEXT.md#semantic-portability). Every portable representation
is derived from it under an explicit destination policy. A destination representation is never a
second canonical or editable document model.

Each destination policy assigns a portability level to each publishing capability:

- **Fully portable**: the destination can preserve the capability's meaning, attribution,
  reference identity, canonical URL, and applicable source provenance without intentional
  semantic loss.
- **Gracefully transformed**: the destination cannot preserve the capability directly, but an
  explicit portable fallback retains useful meaning and reports every intentional semantic loss.
- **Canonical-only interaction**: no honest destination-local fallback preserves the capability.
  The portable representation identifies the canonical work and keeps that interaction on its
  canonical page instead of simulating support or silently discarding meaning.

Capability semantics remain independent of presentation widgets and destination payloads. Core
domain models state that a capability, citation, reference, or credit exists and what it means.
Themes and Admin views decide how to present that meaning. Adapters serialize it into provider
payloads. Neither a widget nor a provider field becomes the semantic source of truth.

## Identity and privacy boundaries

The author-owned **Document** is the source item; the **Published work** is the public work it
represents. A work identifier and canonical URL identify that public work. A source path, import
record, provider response, draft-only metadata, credential, or private configuration does not
become public identity merely because it contributed to the semantic representation.

Source provenance records where information came from and must survive derivation when policy
allows, but public output includes only provenance explicitly designated for publication. An
imported or remote source URL does not replace the work's canonical URL. A destination's remote
identifier identifies its copy, not the canonical work or author-owned source.

All authored Markdown, raw HTML, metadata, imports, and remote responses remain untrusted at their
existing parser, renderer, safe-URL, preview, and adapter boundaries. Portability does not grant a
new path around validation, escaping, or privacy filtering.

## Failure and mutation boundaries

Planning and transformation are read-only derivations. A failure is reported against the source,
capability, and destination that produced it; one unsupported capability does not invalidate
unrelated capabilities or documents. A failed derivation never rewrites canonical content.

Remote mutation remains a separate, explicit operation after validation and preview. A
transformation or validation failure performs no remote write. A partial remote failure is
reported as destination-scoped state and is never repaired by mutating canonical content or by
silently creating a different remote representation. Reporting or recovering from a failure does
not mutate canonical content or remote state; a later retry is a distinct explicit operation.

## Compatibility

Existing native pages and legacy posts continue through their current parser, domain model,
renderer, feed, and preview paths. The absence of new portability metadata does not activate a
capability, change output, or require migration. Any future migration must define its own explicit
slice, compatibility behavior, and rollback boundary.

## Consequences

- Destination adapters can evolve without defining duplicate content semantics.
- Portability decisions are reviewable as policy instead of being hidden in payload conversion.
- Intentional loss becomes visible and capability-scoped.
- Some interactions stay on the canonical page when a faithful portable fallback does not exist.
- New capabilities must define semantics before adding widgets or destination fields.
