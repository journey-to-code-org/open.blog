# ADR 0267: A theme preloads the fonts its first screen draws

- Status: Accepted
- Date: 2026-10-28

## Context

A theme's web fonts are declared in the generated `tokens.css`, so a browser only discovers them
after that stylesheet arrives. With `font-display: swap` the text paints first in a fallback and
re-wraps when the font lands; on a phone the hero moved enough to fail Lighthouse's layout-shift
check (CLS 0.247 on one home page).

A child theme inherits its parent's faces. A preload chosen by the parent can be wrong for the
child: a child that draws its headings in a system font would still download the parent's heading
face on every page.

## Decision

- **A face may set `"preload": true`.** Each page in the theme then writes
  `<link rel="preload" as="font" type="font/<format>" crossorigin>` for it before the stylesheets,
  with the same versioned URL the `@font-face` uses, so the file is fetched once and in parallel
  with the CSS. It is off by default; a subset most pages never draw (a `unicodeRange` for rare
  characters) should stay off.
- **A child narrows the inherited preloads with `fonts.preloadOnly`.** Of the faces marked
  `preload`, inherited or its own, only those of the listed families are preloaded. The faces stay
  declared, so a page that does use them still loads them on demand.

## Consequences

- Themes that set it paint their first screen in their own fonts, without the swap shift: the
  reference home page went from CLS 0.247 to 0.002 on mobile Lighthouse.
- Nothing changes for a theme that sets neither option.
