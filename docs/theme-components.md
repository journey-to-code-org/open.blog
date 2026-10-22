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
