# ADR 0409: Components with a Zubra source are rendered ahead by the `zubra` command when it is installed

- Status: Accepted
- Date: 2026-11-12
- Builds on: [ADR 0408](0408-a-theme-offers-components-an-owner-places-with-a-form-and-a-section-holds-only-a-name-and-checked-values.md)

## Context

A component an owner places (ADR 0408) is an empty element until its script runs. Admin's preview runs no
scripts, so it showed only the component's fallback line, and readers without JavaScript saw nothing more.
Zubra compiles a component to server HTML from its source and the values it is given; that is what fills the gap.

Linking Zubra's compiler into open.blog was tried first and set aside: it is not on crates.io, it needs Rust 1.97
(open.blog supports 1.85), it adds a large parser to the build, and its `serde_json` features unify with
open.blog's and changed the key order of JSON open.blog writes (five tests failed with it enabled).

## Decision

- **A component may name its `source`**, a `.zb` file in the theme folder, beside its script.
- **The build runs the `zubra` command** when one is installed (`OPENBLOG_ZUBRA` names another, such as
  `npx -y @zubra/compiler@5.8.0`): `zubra compile <source> --props <values> --partial`, with the section's values
  after defaults. The content between the element's own tags is written inside the element the engine renders; the
  engine still writes the element and its attributes, so ADR 0408's escaping holds. With content, the fallback is
  left out.
- **Partial rendering.** What only the browser can compute is left for the element, as Zubra's server rendering
  always does for `Date`, `Intl` and the like.
- **Cached by source, modification time and values**, so Admin's live preview runs the compiler only when
  something changed.
- **Optional, and never a failed build.** Without the command, every element is written empty as before. A source
  that cannot be compiled is a warning naming the section; the element still renders in the browser.

## Consequences

- open.blog's dependencies, Rust version and default output are unchanged; the HTML is byte for byte what Zubra's
  own server renderers produce.
- A site that wants it installs the command where it builds (CI installs it for its test).
- The plain element (`--emit element`) replaces rendered content when it starts rather than hydrating it; a
  component compiled with `--emit js` and the runtime would hydrate in place.
