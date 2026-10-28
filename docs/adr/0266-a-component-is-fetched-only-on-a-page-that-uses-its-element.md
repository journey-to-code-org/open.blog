# ADR 0266: A component is fetched only on a page that uses its element

- Status: Accepted
- Date: 2026-10-28

## Context

`web/openblog.js` imported all 22 components statically. Every page, including a home page with
none of them, downloaded the Rust playground, the code runner, every lab and their models, about
40 modules up to four levels deep. On a phone that work sits in front of the page's first paint:
Lighthouse put a home page at 85 with most of its time in that module graph.

## Decision

- **A component is imported when its element is on the page.** `openblog.js` lists the element
  names; after the document is parsed it imports `./components/<name>.js` for each element it
  finds. Each file is already named after the element it defines.
- **Elements added later still upgrade.** A `MutationObserver` checks only added nodes for the
  names not yet loaded (a theme may build an `<ob-search>` in a dialog), and disconnects once
  every component is loaded.
- **The embed check covers the list.** `every_relative_script_import_is_embedded` also checks
  that each listed name has an embedded `components/<name>.js`, so a missing file fails the build
  test as a missing static import did.

## Consequences

- A page downloads only the components it shows; the home page of the reference site went from
  about 40 modules to one.
- A new component is added to the list by its element name; its file must be named after the
  element. Pages are unchanged, and without JavaScript nothing differs.
- A component now loads one round trip after `openblog.js` rather than with it. Every element
  already renders its no-JavaScript fallback until it upgrades, so this adds no layout change.
