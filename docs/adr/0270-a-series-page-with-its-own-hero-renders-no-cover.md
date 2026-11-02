# ADR 0270: A series page with its own hero renders no cover

- Status: Accepted
- Date: 2026-10-28

## Context

A series page shows its cover in a figure above the series description. Themes whose series pages
bring their own hero hid that figure with `display: none`, but a browser still downloads an `<img>`
inside a hidden element: 318 KB on one page, counted by Lighthouse ahead of the page's largest
contentful paint (a simulated 3.8 s against a real 0.8 s).

## Decision

- **A theme option, `seriesPageCover`, default `true`.** With `false`, the series page writes no
  cover figure. The cover is unchanged everywhere else, such as the series cards on the home and
  series index pages.

## Consequences

- A theme with its own hero stops downloading an image nobody sees, and can drop the CSS that hid it.
- Nothing changes for a theme that does not set it.
