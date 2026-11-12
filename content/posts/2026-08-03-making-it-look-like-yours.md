---
title: Making it look like yours
subtitle: Looks you can tap, a home page you can arrange, and themes for when you want more.
date: 2026-08-03
series: running-your-blog
seriesOrder: 4
theme: paper
tags:
  - guide
  - themes
  - admin
description: Change colours, fonts and spacing by tapping in the Admin, arrange the home page from ready-made sections, and give a series or a single post its own theme.
---

This post looks different from its neighbours. Its front matter says `theme: paper`, so it
renders with the `paper` theme while the rest of the series uses the site's default. That is one
of four ways to change how your blog looks, from the easiest to the most flexible.

## 1. Customize look: tap, preview, save

Open **Customize look** in the Admin and choose by tapping:

- one of eight ready-made looks: Calm, Warm, Bold, Night, Garden, Paper, Ocean or Sunset;
- a main colour, from swatches or a colour picker;
- a font style (Modern, Classic, Friendly or Techie), text size, corner roundness, spacing, page
  width and heading weight.

The preview is your real home page, built from your unsaved choices, in light and dark. If a
colour would be hard to read, it is adjusted just enough, and the screen tells you so. **Undo**
takes back the last change, and **Reset everything** starts over. Nothing changes on the public
site until you save and publish.

## 2. The landing page: arrange the home page

By default, the home page lists your latest posts and your series. Open **Landing page** in the
Admin to build your own from sections: a welcome banner with buttons, text, latest posts,
series, a featured post, pictures, a video, a map, opening hours, contact details, social links,
a FAQ and call-outs. These are the same [pieces](/posts/buttons-maps-hours-and-faqs/) you can put
in posts.

Start from one of four ready-made layouts (Welcome, Small business, Portfolio or Newsletter), or
from scratch. Move sections up and down, hide them, and preview at phone, tablet and desktop
sizes. Your last twenty saves are kept, so you can always go back.

The page is saved as `content/landing.json`, which you can also edit by hand:

```json
{ "format": "openblog-landing", "version": 1, "sections": [
  { "id": "hello", "type": "welcome", "heading": "Fresh from the oven",
    "button": { "label": "See the recipes", "href": "/series/from-the-kitchen/", "style": "primary" } },
  { "id": "latest", "type": "latest-posts", "heading": "Newest", "count": 5 }
] }
```

There is no box that accepts HTML or CSS anywhere in either screen, so the home page cannot be
broken by a stray tag.

## 3. A theme per series or per post

open.blog ships with three themes: `base`, `demo` and `paper`. Run `openblog themes` to list the
themes in your project. The site's theme is `theme` in `openblog.json`. A series can choose its
own, and a post can override both:

```yaml
# content/series/from-the-kitchen.md
theme: paper

# or in a single post's front matter
theme: paper
```

A post uses its own `theme`, then its series' theme, then the site's. The
[Getting started](/series/getting-started/) series uses `demo`, and
[From the kitchen](/series/from-the-kitchen/) uses `paper`. Compare them.

Readers can switch between light and dark with the button in the header. Their choice is
remembered, and by default it follows their device's setting.

## 4. Your own theme

A theme is a folder in `themes/` with a `theme.json` of design tokens (colours, fonts, spacing),
optional stylesheets, and optional web components. It can `extend` another theme and change only
what differs:

```json
{
  "extends": "base",
  "colors": {
    "light": { "accent": "#b4532a", "page": "#fffaf3", "text": "#2b2118" },
    "dark": { "accent": "#f0a372", "page": "#1d1712", "text": "#f2e9da" }
  },
  "customizable": ["accent", "textSize", "roundness"]
}
```

`customizable` lists which **Customize look** controls the theme honours. The
[themes guide](https://github.com/journey-to-code-org/open.blog/blob/main/docs/themes.md) covers
every token, and the
[components guide](https://github.com/journey-to-code-org/open.blog/blob/main/docs/theme-components.md)
explains the animated heading on the Getting started series.

Next: [A post from the future](/posts/a-post-from-the-future/), which you can only read once its
date arrives.
