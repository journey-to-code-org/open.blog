# Themes and the design system

A theme is a folder in `themes/<name>/` with a `theme.json`. The renderer emits the
same semantic HTML for every theme. A theme changes the look in three layers, from
cheapest to most powerful:

1. **Tokens** in `theme.json`: colours, fonts, sizes, radii. They compile to CSS
   custom properties (`--ob-*`) in a generated `tokens.css`.
2. **Options** in `theme.json`: small rendering switches (code-label headings, typing
   effect, navigation label template, list style).
3. **A stylesheet** (`theme.css`, listed under `stylesheets`) for anything tokens can't
   express. Scope its rules with `[data-ob-theme="<name>"]`.

`web/base.css` holds structure only and reads nothing but tokens, so a theme that
overrides a handful of values is a complete theme.

## theme.json

```jsonc
{
  "label": "Shown in theme lists",
  "extends": "base",            // inherit everything, override what differs
  "colorScheme": "dark",        // scheme used when the visitor has no preference
  "colors": {
    "dark":  { "page": "#111", "text": "#f3f3f4", "accent": "#e3de13" },
    "light": { "page": "#fafaf3", "text": "#202516", "accent": "#e3de13" }
  },
  "fonts": {
    "body": "\"CallingCode\", monospace",
    "heading": "\"Larabie\", monospace",
    "mono": "ui-monospace, monospace",
    "faces": [{ "family": "Larabie", "src": "fonts/Code-Squared.woff2", "format": "woff2" }]
  },
  "tokens": { "maxWidth": "70rem", "radius": "12px", "headingWeight": "400" },
  "options": {
    "headingCodeLabels": true,
    "headingWrapper": "my-effect",      // wrap titles in your own custom element
    "navLabel": "//{index}. <{label}/>",
    "listStyle": "rows",
    "postCovers": true
  },
  "stylesheets": ["theme.css"],
  "scripts": ["effect.js"]              // ES modules the theme ships, e.g. web components
}
```

Every key under `colors.<scheme>` becomes `--ob-color-<kebab-name>`; every key under
`tokens` becomes `--ob-<kebab-name>`. Add your own and use them in `theme.css`.
Relative `src`, `stylesheets`, and `scripts` paths resolve against the theme folder.
A theme's scripts are linked on every page that uses it; see
[Adding web components to a theme](theme-components.md) and the `demo` theme.

### Colour tokens `base.css` uses

`page`, `outer`, `surface`, `surfaceRaised`, `text`, `muted`, `subtle`, `border`,
`accent`, `accentSoft`, `accentBorder`, `accentContrast`, `link`, `glow`, `codeBg`,
`codeText`, `ink` (text drawn on top of the accent fill).

### Other tokens

`maxWidth`, `readingWidth`, `gutter`, `radius`, `radiusSm`, `borderWidth`, `bodySize`,
`bodyLeading`, `headingLeading`, `headingWeight`, `headingTransform`, `headingTracking`,
`titleSize`, `sectionTitleSize`, `rowTitleSize`, `shadow`, `focusRing`, `rowBorderWidth`,
`hoverText`, `motion`. The full defaults are in `themes/base/theme.json`.

### Options

| Option | Effect |
| --- | --- |
| `headingCodeLabels` | Wrap page titles in dim `<h1>` / `</h1>` labels, as on mnix.dev |
| `headingWrapper` | Custom element name to wrap page and section titles in, for a theme's own effect (see [theme-components.md](theme-components.md)) |
| `navLabel` | Template for nav text; `{index}` is 01, 02, ... and `{label}` the link text |
| `listStyle` | `rows` (compact, hover fill) or `cards` (cover images) |
| `postCovers` | Show the cover image on the post page |

## Light and dark

Both schemes are compiled. The theme's `colorScheme` is the default, the other scheme
applies through `prefers-color-scheme`, and the header toggle (`<ob-theme-toggle>`)
overrides both and remembers the choice.

## Different themes for different series

Resolution order for a post: its own `theme:` front matter, then its series' theme, then
the site `theme` in `openblog.json`.

```markdown
---
# content/series/rustbound-build-your-first-rust-app.md
name: Rustbound
theme: paper
---
```

Every post in that series, and the series page itself, then render with `paper`. A single
post can override with `theme: mnix` in its own front matter. Pages work the same way.
Series cards on the home page preview each series in its own theme.

## Reproducing mnix.dev

The author's `mnix` theme (kept in a private repository, not in this one) reproduces the
portfolio: the yellow-on-black palette (sampled values from the portfolio's `src/index.css`,
including the light variant), the CallingCode body font and the Larabie "Code Squared"
headings, `<h2>` code labels, `//01. <Home/>` navigation, bordered rows that fill with the
accent on hover, and typing headings. The typing effect is a web component the theme ships
itself (`"scripts": ["typewriter.js"]` plus `"headingWrapper": "mnx-typewriter"`); the
engine knows nothing about it. It uses a stylesheet only for the centred headings and a few
details; delete `theme.css` and it still works from tokens.

The fonts are copied from the portfolio repository into `themes/mnix/fonts/` and are
git-ignored on purpose. Check their licences before committing them to a public repo.
Without them the theme falls back to system monospace.

## Making a theme

1. Create `themes/mytheme/theme.json` with `"extends": "base"`.
2. Override a few colours and fonts. Run `openblog serve`; edits rebuild instantly.
3. Set it as `theme` in `openblog.json`, or per series/post in front matter.
4. `openblog themes` lists every theme and its inheritance chain.

The WebAssembly module also exports `themeCss(themesJson, name)`, which compiles a theme
in the browser with the exact code the build uses. It is the basis for a live theme editor.
