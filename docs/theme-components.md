# Adding web components to a theme

A theme is not limited to tokens and CSS. It can ship JavaScript, and it can ask the
renderer to wrap every heading in a custom element of its own. That is how a theme adds a
heading effect (typing, revealing, glitching, whatever you like) without touching the
engine. The open-source engine ships no effects; `themes/demo/` is a worked example to copy.

## The two hooks

```jsonc
// themes/<name>/theme.json
{
  "extends": "base",
  "options": {
    "headingWrapper": "demo-reveal"     // a custom element name (must contain a hyphen)
  },
  "scripts": ["reveal.js"],             // ES modules, relative to the theme folder
  "stylesheets": ["theme.css"]
}
```

- **`scripts`** are copied with the theme and linked on every page that uses it, after
  the engine's own `openblog.js`, as `<script type="module">`. Any theme in the `extends`
  chain contributes its scripts, parents first.
- **`options.headingWrapper`** makes the renderer emit each page or section title as
  `<h1 class="ob-title"><demo-reveal>Title</demo-reveal></h1>` instead of plain text. The
  wrapper is applied to page and section titles only, not to headings inside post bodies.
  Leave it unset and titles stay plain.

Because the element wraps text that is already in the HTML, the page is complete before
JavaScript runs, and search engines and feed readers see ordinary headings.

## Components an owner can place

A theme can also offer components for the owner to put on the landing page herself, with no code:
Admin's **Landing page** lists them under **Add a section**, and each gets a form built from the settings
the theme declares ([ADR 0408](adr/0408-a-theme-offers-components-an-owner-places-with-a-form-and-a-section-holds-only-a-name-and-checked-values.md)).

```jsonc
// themes/<name>/theme.json
{
  "components": {
    "holiday-countdown": {                               // the custom element's name
      "label": "Countdown sign",                         // what the owner sees in the list
      "description": "A little sign that counts the days until the holiday.",
      "script": "components/holiday-countdown.js",       // a file in this theme's folder
      "fallback": "A countdown sign to the holiday hangs here.",
      "props": [
        { "name": "holiday", "type": "choice", "label": "Which holiday", "default": "thanksgiving",
          "choices": [ { "value": "thanksgiving", "label": "Thanksgiving" },
                       { "value": "christmas", "label": "Christmas" } ],
          "help": "The sign counts down to this day." }
      ]
    }
  }
}
```

- **Settings** are `text` (one line; `maxLength`, default 200), `choice` (`choices`), `number` (`min`, `max`),
  `toggle` (written as an attribute with no value when on, left out when off) or `date` (a calendar day
  written `2026-12-25`; Admin shows a date picker and refuses a day that doesn't exist, such as February 30).
  Each has a `name` (the attribute), a `label`, and optionally `help`, `required` and `default`. A name is lowercase letters,
  digits and hyphens and never an event handler (`on…`), `id`, `class`, `style`, `src` or `href`.
- **The script** is a `.js` file inside the theme folder. An address elsewhere is refused, so a theme
  never loads code from another site through a component.
- **The section** the owner adds holds only the component's name, an optional heading and the values:
  `{ "id": "sign", "type": "component", "tag": "holiday-countdown", "props": { "holiday": "christmas" } }`.
  The build checks every value against the declaration and writes the element with escaped attributes,
  followed by its module script (a browser runs a module once, however often it is linked).
- **`fallback`** is one plain line shown where scripts do not run: Admin's preview, and readers without
  JavaScript, when the component has no content rendered ahead (below).
- **`source`** (optional) is the component's Zubra `.zb` file in the theme folder. When the `zubra` command is
  installed, the build renders it with the section's values and writes that HTML inside the element, so the
  component is there before its script runs: readers without JavaScript and Admin's preview see the component
  itself, and the fallback is left out.
- **Every theme the site can wear must offer it.** With [seasons](themes.md#seasons), that is the site
  theme and every season's, so declare components on the theme the seasons extend. A page that places a
  component no wearable theme offers, or a value its declaration refuses, stops the build and names the section.
- Components are inherited through `extends`, and a child theme may add more or redeclare one by name.

A component written in [Zubra](https://github.com/journey-to-code-org/zubra) compiles to a plain custom
element with `zubra compile <file>.zb --emit element`, which needs nothing installed on the page; a
hand-written element works the same way.

### Rendered ahead with Zubra

A component with a `source` gets its content at build time
([ADR 0409](adr/0409-components-with-a-zubra-source-are-rendered-ahead-by-the-zubra-command-when-it-is-installed.md)):

```sh
npm install --global @zubra/compiler      # or the Rust CLI; or set OPENBLOG_ZUBRA, e.g. "npx -y @zubra/compiler"
zubra compile components/my-sign.zb --emit element --output components/my-sign.js   # the script
zubra compile components/my-sign.zb --emit css > components/my-sign.css            # its styles, for before the script runs
```

List the CSS file under the theme's `stylesheets` so the rendered content is styled before the script adopts
its own copy. The build runs `zubra compile <source> --props <values> --partial` once per placed component and
keeps the result while the source and the values are unchanged, so Admin's live preview does not run it again.
Whatever only the browser can compute (today's date, the window size) is left for the element to fill in when it
starts: write those parts so the server has something to say without them, such as "Counting down to Christmas"
before the number of days is known. The plain element replaces the rendered content with its own when it starts.

Without the `zubra` command, nothing is rendered ahead: every element is written empty with its fallback, as
before. A source that cannot be compiled is a warning naming the section, never a failed build.

## Styling the landing page

When a site has a landing page, each section is written as
`<section class="ob-section ob-home-section ob-home-<type>" id="ob-home-<id>">`. The page has one `<h1>` (the
first heading) and `<h2>` for the rest. The engine styles these classes with the `--ob-*` tokens, so most
themes need nothing; a theme may restyle them.

- Structure: `ob-home-section`, `ob-home-title`, `ob-home-lede`, `ob-home-welcome` and `ob-home-welcome-hook`,
  `ob-home-actions`, `ob-home-all`, `ob-home-link`, `ob-home-note`, `ob-home-place`.
- Section types: `ob-home-rich-text`, `ob-home-latest-posts`, `ob-home-series`, `ob-home-featured-post`,
  `ob-home-buttons`, `ob-home-image` and `ob-home-figure`, `ob-home-video`, `ob-home-map`,
  `ob-home-opening-hours` and `ob-home-hours`, `ob-home-contact`, `ob-home-social-links` and `ob-home-social`,
  `ob-home-faq` and `ob-home-faq-item`, `ob-home-business-facts`.
- Buttons: `ob-home-button` with `ob-home-button-primary` or `ob-home-button-secondary`.
- Call-outs: `ob-home-callout`, `ob-home-callout-box`, `ob-home-callout-title` and the kind classes
  `ob-home-callout-info`, `ob-home-callout-success` and `ob-home-callout-warning`.

The classes are a stable hook, not a promise about the markup inside them. Keep text contrast at WCAG AA and
focus rings visible when you restyle buttons and links.

## Styling business facts

The business facts (`business` in `openblog.json`, [Configuration](configuration.md#business-facts)) are written by
the engine as one block, `ob-business`, in two places: the footer of every page (inside
`<section class="ob-footer-business" aria-label="Business details">`) and the Landing page's Business facts section.
The engine styles it in `base.css` with `--ob-*` tokens, so a theme gets it with no markup or CSS of its own and
restyles it by changing tokens or by overriding the hooks. Do not rebuild the markup in a theme: the same block
must read the same on every page.

- Block: `ob-business`, `ob-business-name`, `ob-business-badge` with `ob-badge` (the "Licensed and insured" badge).
- Contact: `ob-business-contact` (a list with `ob-business-phone` and `ob-business-email`).
- Hours: `ob-business-hours`, a `dl` with one `div` per run of days; closed days read "Closed".
- Notes: `ob-business-notes` (license and issuer, accepted payment kinds, the year founded).

A site with no business facts writes none of these.

## Styling reviews

A saved review ([Reviews](reviews.md)) is written by the engine as one block wherever it shows:

```html
<figure class="ob-proof" id="review-<id>">
  <blockquote class="ob-proof-text" cite="…"><p>…</p></blockquote>
  <figcaption>
    <p class="ob-proof-source"><span class="ob-proof-rating" role="img" aria-label="Rated 5 out of 5">★★★★★</span>
      <span class="ob-proof-author">Dana R.</span>, <time>…</time>, <a class="ob-proof-link">read it on Google</a></p>
    <p class="ob-proof-provenance">Copied from the review's link on …</p>
    <p class="ob-proof-job">About the job: <a>…</a></p>
  </figcaption>
</figure>
```

On a job's page it sits in `<section class="ob-proof-section">` under an `<h2>`; on `/reviews/` each one is an item of
`<ul class="ob-proof-list">` and only there has `ob-proof-job`. A review without stars has no `ob-proof-rating`. A jobs
list adds `<span class="ob-proof-line">` inside the link of a job that has a review. Every bundled theme styles these
in `web/base.css` with the `--ob-*` tokens, so a theme needs nothing and restyles them by changing tokens or these
hooks. Keep the stars' text alternative: the stars themselves are hidden behind it.

## Styling before and after pairs

A `compare` fence in a post (see [Content](content.md#before-and-after)) renders as one component:

```html
<ob-compare class="ob-compare">
  <figure class="ob-compare-pane ob-compare-before"><img src alt><figcaption><span class="ob-compare-label">Before</span>: caption</figcaption></figure>
  <figure class="ob-compare-pane ob-compare-after"><img src alt><figcaption>…</figcaption></figure>
</ob-compare>
```

Without JavaScript, and for a reader who prefers reduced motion, the two figures sit side by side (one above the other on
a narrow screen). Where the element runs it adds `data-enhanced`, moves the pictures into a `.ob-compare-stage` with a
native range input (`.ob-compare-range`, arrow keys, Home and End all work), a `.ob-compare-bar` with a
`.ob-compare-knob`, and two `.ob-compare-tag` labels; the captions stay below. It keeps nothing and asks for nothing.

Every bundled theme gets this from `web/base.css` through the tokens it already has, so a theme needs nothing. To
restyle it, set these custom properties on `ob-compare` or on `:root` in a theme stylesheet:

| Token | Default | What it sets |
| --- | --- | --- |
| `--ob-compare-radius` | `--ob-radius` | Corners of the pictures and the stage |
| `--ob-compare-gap` | `--ob-space-4` | Space between the two figures in the side-by-side layout |
| `--ob-compare-line` | `#fff` | The dividing line and the knob's border |
| `--ob-compare-line-width` | `2px` | Width of the dividing line |
| `--ob-compare-handle` | `--ob-color-accent` | The knob's fill |
| `--ob-compare-handle-ink` | `--ob-color-accent-contrast` | The arrow on the knob |
| `--ob-compare-handle-size` | `2.75rem` | The knob's diameter; keep it at least 2.75rem for touch |
| `--ob-compare-focus` | `--ob-color-accent` | The ring around the knob while the control has keyboard focus |
| `--ob-compare-tag-bg`, `--ob-compare-tag-ink` | translucent black, white | The Before and After labels on the picture |

The component sets `--ob-compare-pos` (the reveal, `0%` to `100%`) and `--ob-compare-ratio` (the first picture's shape);
leave those alone. Keep the line and knob visible against light and dark pictures, and the focus ring at 3:1 or better.

## Styling series navigation

The engine's series box is the shared structure for lesson navigation, so themes restyle
it rather than rebuild it: `.ob-series-box > .ob-eyebrow` (position), `.ob-series-path`
(shortcut cells, one `li` per part, `data-current` on this part), `.ob-series-nav` with
`.ob-series-prev` and `.ob-series-next` (both always present; `.ob-series-edge` marks the
series-overview link used at either end), and the `All parts` list. Keep the eyebrow a
direct child of the box, because several themes read it.

The strip's `ob-series-previews` enhancement opens a native Popover API tooltip on
hover or keyboard focus, including the current part (a focusable non-link).
Each `.ob-series-preview` shows the lesson title, description, optional lazy-loaded
cover, part number, publication date, reading time, and collaborative credit where
applicable. Covers reuse the site's light/dark variants. Escape or interacting
outside dismisses the tooltip; moving onto it keeps it open. Links still navigate
on the first click or tap. Without JavaScript or Popover API support, the nodes
keep ordinary `title` tooltips and the All parts list remains available.

## Try the demo

`openblog init` writes the `demo` theme (and `paper`) into your blog's `themes/` folder,
so it is there to try and to copy. In an older blog without it, copy `themes/demo/` from
the open.blog repository.

```sh
openblog serve
```

Set `"theme": "demo"` in `openblog.json`, or give one series `theme: demo` in its front
matter to see the effect on that series only. Every title's words rise into place when the
heading scrolls into view. The whole effect is three small files in `themes/demo/`:

- `theme.json` declares the wrapper element and the script.
- `reveal.js` defines `<demo-reveal>` in about forty lines.
- `theme.css` holds the transition the element toggles.

## Writing your own

Copy `themes/demo/` to `themes/<yours>/`, rename the element (names must contain a hyphen,
and a short prefix of your own avoids clashes with other themes), and change what
`connectedCallback` does. The rules that keep an effect from degrading the page:

1. **The text is already there.** Read `this.textContent`; never fetch or reconstruct it.
2. **Keep an accessible copy.** Screen readers should get the heading as text, not as a
   stream of animated spans. The demo appends a visually hidden span with the full text
   and marks the animated copy `aria-hidden="true"`.
3. **Respect reduced motion.** Check `matchMedia("(prefers-reduced-motion: reduce)")` first
   and return without changing anything.
4. **No layout shift.** Reserve the heading's final size before animating. The demo
   animates `opacity` and `transform` only, which never move surrounding content. A
   typing effect needs a hidden full-width copy underneath the growing visible text.
5. **Start on view, once.** Use an `IntersectionObserver` so an effect far down the page
   waits until it is seen, and mark the element done so re-connection does not replay it.
6. **Guard the definition.** Wrap `customElements.define` in `if (!customElements.get(...))`
   so loading the script twice (for example from two themes in a chain) is harmless.
7. **Clean up.** Disconnect observers and clear timers in `disconnectedCallback`.

## Sketch of a typing effect

A typewriter is a reveal that adds characters over time instead of toggling a class. The
shape of such an element:

```js
class XTypewriter extends HTMLElement {
  connectedCallback() {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const full = this.textContent;
    // 1. accessible copy (visually hidden) with the full text
    // 2. an invisible sizer with the full text, so the box is final size at once
    // 3. a positioned, visible span that grows by one character every ~35 ms
    //    once an IntersectionObserver reports the heading is on screen
    // 4. a CSS rule such as `x-typewriter[typing]::after { content: "_" }` for a cursor
  }
}
```

The behaviour lives in the theme, so a blog that switches themes loses the effect and
gains whatever the next theme brings. That is the point: effects are a theme's identity,
not the engine's.

## Beyond headings

A theme script is an ordinary module and can define any number of elements, register
event listeners, or enhance other parts of the page by class name (`.ob-row`,
`.ob-card`, `.ob-prose`, see `web/base.css` for the full set). The heading wrapper is the
only place where the engine changes its markup for a theme; everything else is reached by
selector from your script and stylesheet.
