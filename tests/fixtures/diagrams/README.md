# Mermaid renderer spike

These are synthetic inputs for comparing the three renderer candidates in #568.
The standalone harness in `scripts/diagram-spike` does not change the site
renderer. It pins the candidate versions and uses its own lockfile. The
[proposed renderer decision](../../../docs/adr/0411-diagram-rendering-needs-a-bounded-headless-engine.md)
records what must happen before integration.

Run the comparison from the repository root:

```sh
cargo run --manifest-path scripts/diagram-spike/Cargo.toml --release --features merman,ferrigura,mermaid
cargo run --manifest-path scripts/diagram-spike/Cargo.toml --release --features merman,ferrigura,mermaid -- 2000
cargo run --manifest-path scripts/diagram-spike/Cargo.toml --release --features merman,ferrigura,mermaid -- --hostile
```

The optional numeric argument generates that many disconnected flowchart nodes;
run large inputs under an external process timeout. Set `DIAGRAM_SPIKE_OUTPUT`
to a scratch directory to write the raw SVGs for inspection. These files are
**not sanitized** and must not be embedded in a public site.

For a visual reference, install the pinned Mermaid package with
`npm ci --prefix scripts/diagram-spike --ignore-scripts`, ensure the browser
test dependencies are installed, and run
`node scripts/diagram-spike/reference.cjs <native-svg-dir> <output-dir>`.
This writes separate SVGs and side-by-side Chromium screenshots using Mermaid
12.3.0; it uses only the synthetic fixtures in this directory.

## Initial measurements

On Windows, Rust 1.99.1, with release builds on 12 November 2026:

| Candidate | Valid fixtures | Malformed fixture | SVG bytes (valid fixtures) | Title / description text present | Same-platform repeat | 2,000 nodes |
| --- | --- | --- | --- | --- | --- | --- |
| merman 0.10.0, selected families, Cytoscape, strict parse, plain labels | 7/7 | Rejected | 9,365-30,386 | 7/7 each | Identical | 58 ms, 1,309,570 bytes |
| ferrigura 0.7.0, default | 7/7 | Rejected | 17,651-33,356 | 7/7 each | Identical | 359 ms, 1,399,739 bytes |
| mermaid-rs-renderer 0.3.1, no default features | 7/7 | Accepted | 1,967-7,710 | 2/7 titles, 1/7 descriptions | Identical | 62 ms, 921,439 bytes |

Timings are individual observations, not benchmarks; the small fixtures took
0-7 ms for merman and ferrigura, and 0-148 ms for mermaid-rs-renderer. The
text check only looks for literal source strings in the SVG. It does not prove
they are correctly associated with an accessible image: for example, the C4
output from the first two candidates has no SVG `title` element.

Visual comparison with Mermaid 12.3.0 in Chromium showed merman's basic
fixtures close to the reference, with some spacing differences. Ferrigura's
flowchart, class, ER, state and C4 examples were also similar; its sequence
boxes and git graph styling differed. The third renderer's styling differed
more, and it incorrectly drew accessibility declarations as nodes in the ER
and state examples. These are observations on a small corpus, not a general
fidelity certification.

On the three hostile fixtures, ferrigura and mermaid-rs-renderer emitted
`javascript:` links for the click example. The inspected merman outputs did not
contain script, image or `foreignObject` elements, event attributes, or
non-fragment `href`/`src` attributes. This narrow inspection is not a security
audit: all renderer output still requires allowlist sanitization and limits.

All three candidates compiled to `wasm32-unknown-unknown`. The restricted
merman binding ran in Node and Chromium and produced byte-identical SVGs to
Windows native for all seven valid fixtures; both also rejected the malformed
fixture. Across two independent Windows processes, the 22 successful fixture
SVGs had identical hashes. The seven valid merman outputs also matched
byte-for-byte between Windows and Linux with the same Rust and dependency versions.

With the workspace's size-oriented release profile, the standalone harness
compiled to 9,925,797 bytes with merman, 10,321,284 with ferrigura, and
2,128,572 with mermaid-rs-renderer. These are uncompressed binaries including
the harness, not measurements of the final Admin payload. The current checked-in
Admin WASM module is 437,270 bytes; the actual incremental browser size and
lazy-loading design still need measurement. A `wasm-bindgen`-generated merman
binding alone measured 9,925,169 bytes, before compression.

The published merman and ferrigura crates are MIT/Apache-2.0 and MIT
respectively, but their default transitive layout engines include EPL-2.0.
The measured merman feature set disables its optional ELK engine; its
dependency tree still includes MPL-2.0 components. The
mermaid-rs-renderer crate and its selected runtime dependencies report
permissive licenses. License expressions and notices need review before any
renderer is distributed with the GPL-3.0-or-later application.

## Outstanding before choosing a renderer

- Expand the visual comparison beyond the seven small examples.
- Expand the cross-platform determinism and native/WASM parity coverage.
- Measure optimized, separately loaded browser payloads and establish a budget.
- Test resource limits, panic behavior and hostile inputs, including directives,
  links, external references and HTML. The large-input probe is not a safety test.
- Review licenses and distribution obligations for the exact selected features.
- Assess SVG sanitization, accessible markup and theme styling; no raw output
  from this spike is safe to publish merely because it rendered successfully.
