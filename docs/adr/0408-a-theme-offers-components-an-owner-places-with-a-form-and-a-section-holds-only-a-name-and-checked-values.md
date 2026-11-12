# ADR 0408: A theme offers components an owner places with a form, and a section holds only a name and checked values

- Status: Accepted
- Date: 2026-11-12
- Builds on: [ADR 0245](0245-the-landing-page-is-a-versioned-list-of-typed-data-sections-with-no-html-section-and-no-markup-from-content.md), [ADR 0398](0398-services-recent-jobs-and-reviews-are-landing-sections-in-version-3-that-render-nothing-until-there-is-something-to-list.md), [ADR 0407](0407-seasons-change-the-site-theme-by-the-calendar-and-the-stored-theme-is-the-look-between-them.md)

## Context

Themes can already ship web components, but only the theme decides where they appear: a heading wrapper,
or a script that finds its place by selector. An owner with no coding skills (the first is a grandmother
running a family recipe site) cannot put a component on her own page. The landing page is the place she
arranges things, and it deliberately never accepts markup. Zubra, which compiles components to plain
custom elements, makes components cheap to write; this is how they reach an owner.

## Decision

- **A theme declares components in `theme.json`**, keyed by custom element name: a plain `label` and
  `description`, a `script` that must be a `.js` file inside the theme folder, an optional one-line
  `fallback`, and up to 20 typed settings (`text`, `choice`, `number`, `toggle`) with labels, help and
  defaults. Declarations are checked when the theme resolves; a script elsewhere, an attribute name that is
  an event handler or one the page relies on, or a default the setting would refuse stops the build.
  Components are inherited through `extends`.
- **A `component` landing section holds only `tag`, an optional `heading` and `props`.** Props are plain
  values. The renderer writes the declared element with each value checked against its declaration and
  escaped as an attribute, the fallback in `<noscript>`, and the theme's module script. Nothing an owner
  types is ever markup, which keeps ADR 0245's rule.
- **Version 4.** A page holding a component section is written as landing version 4; every other page is
  written exactly as before, and an older release refuses a version 4 file without changing it.
- **Checked against every theme the site can wear.** The page has to read the same whichever theme is up,
  so a component must be offered, and its values accepted, by the site theme and every season's theme. A
  problem stops the build naming the section, and Admin refuses the save before writing.
- **Admin offers what the themes offer.** `GET landing` lists the components common to the wearable themes
  with their settings; **Add a section** lists them after the built-in sections, and the form is generated
  from the settings (a select, a text field, a number field, a checkbox).

## Consequences

- An owner can place a theme's components, choose their settings and preview the page without code.
- The preview runs no scripts, so it shows the fallback line, not the component itself. Server-rendered
  component HTML (Zubra's compiler is a Rust crate and can produce it at build time) would close that gap
  and is the next step; it can be added behind a feature without changing the stored section.
- Placing a component anywhere but the landing page (a fence in posts) is left for when an author asks.
