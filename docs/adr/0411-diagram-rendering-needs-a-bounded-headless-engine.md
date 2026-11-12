# ADR 0411: Diagram rendering needs a bounded headless engine

- Status: Proposed
- Date: 2026-11-12

## Context

Mermaid source needs to produce the same accessible, script-free diagram in
builds and Admin previews. A renderer must be evaluated on more than whether it
returns SVG: malformed input, resource use, browser payload, output safety and
the licenses of transitive dependencies matter too.

## Decision

Use the [renderer comparison](../../tests/fixtures/diagrams/README.md) to
develop against merman 0.10.0, with only the required diagram families, SVG and
Cytoscape enabled; disable its default ELK feature. Use strict parsing and
plain SVG labels. This configuration preserved the fixture descriptions,
rejected the malformed example, and matched Windows, Linux and browser WASM
output on the initial corpus. It was visually close to Mermaid on those
examples. The other candidates either include an EPL-2.0 layout dependency or
failed the malformed-input and accessibility-text checks.

Do not treat this proposal as approval to publish raw SVG. Before enabling
diagrams, implement and test an allowlist sanitizer, bounded rendering and
publication gates. Review and satisfy the MPL-2.0 and other dependency notice
and source-distribution obligations for the exact shipped feature set.

## Consequences

The initial generated WASM binding is about 9.9 MB uncompressed, substantially
larger than the existing Admin module. It must be loaded separately on demand
and measured against a documented budget; the spike is not a production
payload measurement. Expand the fixture corpus and repeat visual, safety,
license, native/WASM and cross-platform checks whenever the pinned renderer,
its features or its dependencies change. Revisit this decision if those checks
fail or the payload cannot meet the budget.
