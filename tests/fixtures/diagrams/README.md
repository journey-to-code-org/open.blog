# Mermaid renderer spike

These are synthetic inputs for comparing the three renderer candidates in #568.
The standalone harness in `scripts/diagram-spike` does not change the site
renderer. It pins the candidate versions and uses its own lockfile. The
[proposed renderer decision](../../../docs/adr/0411-diagram-rendering-needs-a-bounded-headless-engine.md)
records what must happen before integration.

The renderer-independent `openblog-core::diagram::discover` function validates
fence options, source size and accessible text against this corpus. It does not
render diagrams, check Mermaid syntax or sanitize output, and is not yet a
publication gate. Until the rest of the feature is integrated, Mermaid fences
continue to render as code.

An experimental `openblog-core` feature, `diagram-rendering`, now wraps that
pipeline with accessible title and description markup and stricter rejection
of links, images and interaction/configuration directives. The experimental
`markdown::render_diagrams` entry point adds figure markup, caption, source
disclosure, collision-checked IDs and source-scoped findings; invalid diagrams
remain escaped code. Native builds explicitly compiled with the feature use it
for posts, pages and documentation, failing publication on findings and
warning for drafts and previews. Builds emit digest-named SVG files and full
feeds and portable Markdown/HTML link to those files with text alternatives.
When `openblog export` writes Markdown with diagrams, it also creates a new
sibling directory containing the referenced SVG files. Other content surfaces
are not integrated. This is not yet a complete production feature.
The feature is disabled by default and requires Rust 1.95 or newer. It updates
the shared `pulldown-cmark` lockfile entry from 0.13.5 to 0.13.6.

The feature also enables `serde_json`'s `preserve_order` through merman. Cargo
unifies that feature across the CLI, changing the key order of unrelated JSON
and JSON-LD outputs even when a site has no diagrams. A direct comparison of
default and feature-enabled builds of a newly initialized site showed changes
in seven output files. This violates the epic's byte-for-byte no-diagram
requirement and must be resolved before the feature can be enabled by default.

Test it with:

```sh
cargo test --locked -p openblog-core --features diagram-rendering --lib diagram_svg::tests
cargo test --locked -p openblog-core --features diagram-rendering --lib experimental_diagram
cargo test --locked -p openblog-core --features diagram-rendering --test diagram_publication
```

Its 200-item model budget is not an exact node-count limit, the native timeout
is cooperative, and callers on the web must enforce a timeout by terminating
their Worker. It is not yet a complete or independently security-audited
publication boundary.

Native rendering caches successful SVGs in memory using a digest of source,
options, alternatives, renderer version and SVG ID scope. The cache is limited
to 32 entries and 8 MiB and is discarded when the process exits. It never caches
failures; browser previews continue to use a separately terminated Worker.

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

The standalone merman harness also exercises its constrained resource policy:
all seven small fixtures render with a 16 KiB source cap, a 200-item model
budget and a 1,000,000-byte SVG cap; oversized source and a 100-node graph with
a 10-item model budget are rejected. An already-expired native deadline is
reported as cancelled. Run these checks with
`cargo test --manifest-path scripts/diagram-spike/Cargo.toml --release --features merman --lib`.
The model-item budget is not a separately verified exact node-count limit, and
the renderer's deadline is cooperative, not a hard wall-clock timeout. These
checks do not cover browser-worker termination or make the raw SVG safe.

The bounded harness also exercises merman's static-inline pipeline, including
its ID rebasing: the seven valid fixtures render and the three hostile fixtures
contain none of the active elements or attributes inspected by the test. The
seven results are byte-identical between native and Node WASM with the same
prefix, and malformed input is rejected in both. The static-inline contract is
a hidden renderer API and permits some navigation and raster data; open.blog
still needs its stricter publication allowlist and separate accessibility
markup. The WASM call has no deadline: a host Worker must be terminated on
timeout. This experiment is not a security certification.

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
Admin WASM module is 437,270 bytes. A `wasm-bindgen`-generated merman binding
alone measured 9,925,169 bytes, before compression.

The experimental Admin editor loads a separate module in a Worker only when
needed. To reproduce the currently measured non-LTO build on Windows, with
Rust 1.95 or newer, the `wasm32-unknown-unknown` target and `wasm-bindgen` CLI
installed, run from the repository root:

```powershell
$env:CARGO_PROFILE_RELEASE_LTO = "false"
$env:CARGO_PROFILE_RELEASE_CODEGEN_UNITS = "16"
cargo build --locked -p openblog-wasm --features diagram-rendering --target wasm32-unknown-unknown --release -j 2
wasm-bindgen --target web --out-dir web\admin\diagram-wasm target\wasm32-unknown-unknown\release\openblog_wasm.wasm
cargo about generate --manifest-path crates\openblog-wasm\Cargo.toml --features diagram-rendering --target wasm32-unknown-unknown --config scripts\diagram-spike\about.toml --locked --fail --output-file web\admin\diagram-wasm\NOTICES.txt scripts\diagram-spike\notices.hbs
node -e "const fs=require('fs');const p='web/admin/diagram-wasm/NOTICES.txt';fs.writeFileSync(p,fs.readFileSync(p,'utf8').replace(/[ \t]+$/gm,''))"
node --test tests\web\diagram-preview.test.mjs
```

The checked-in binding was generated with `wasm-bindgen-cli` 0.2.128 and the
notice file with `cargo-about` 0.9.3 (`--features cli`); retain network access
for the notice generation so missing license texts can be obtained from the
upstream packages. Review notices and source availability whenever the locked
dependency tree changes. The Admin dialog links to the notice file, including
versioned crate source downloads for its MPL-covered components.

The generated module measured 10,912,151 bytes raw and 3,565,413 bytes with
gzip level 9. The test enforces budgets of 12 MiB raw and 4 MiB gzip. The
built-in Admin server does not currently compress this response, so the raw
size is the relevant transfer budget there. These are experimental budgets,
not an approval to distribute the binary; the dependency license and source
distribution review below remains necessary.

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
