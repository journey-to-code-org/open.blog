# ADR 0268: A theme may name its own favicon and logo

- Status: Accepted
- Date: 2026-10-28

## Context

The favicon and the header logo come from the site's `favicon` and `logo`. A site whose series each
have their own theme and colour wanted a matching icon per series, and the only way to get one was a
theme script that read a CSS custom property at startup and swapped `<link rel="icon">` and the
header `<img>` after load. That forced an early style calculation (about 660 ms of main-thread work
on a phone in Lighthouse), fetched the icon twice and changed the header after it had painted.

## Decision

- **`theme.json` takes optional top-level `favicon` and `logo`**, resolved against the theme folder
  like its other files (or a site path such as `/images/x.png`) and inherited by child themes.
- **The renderer prefers them.** A page whose theme sets one writes it into `<link rel="icon">` or
  the header's `.ob-brand-logo`; otherwise the site's own are used, exactly as before. The logo is
  shown only when the site has a logo, so a theme cannot add one to a site that shows its name.

## Consequences

- A series theme gets its own icon with no script and no change after paint.
- Nothing changes for a theme that sets neither.
