# Native HTML and no-JavaScript behavior

open.blog uses custom elements as progressive enhancements. Public content, navigation, labels,
links, and source code remain understandable in the host markup when JavaScript or CSS is absent.
An enhancement may add interaction, but it must not become the only place where authored meaning
exists. The Admin is the deliberate exception: it is an application and says plainly that it needs
JavaScript.

## Built-in custom-element contract

This inventory is checked against every `customElements.define` call in `web/`. Adding or removing
a component requires updating this table and its no-JavaScript contract.

| Element | Semantic host markup without JavaScript | Runtime dependency and enhanced behavior |
| --- | --- | --- |
| `<ob-admin>` | A `noscript` notice explains that the editing application needs JavaScript. It never replaces public reading. | `web/admin/admin.js`; authenticated editing, preview, settings, and publishing workflows. |
| `<ob-back-to-top>` | Empty and absent from keyboard navigation; ordinary document navigation and the skip link remain. | `ob-back-to-top.js`; creates a convenience button after scrolling. |
| `<ob-code>` | Native `pre` and `code` retain source, language, title, and document order. | `ob-code.js`; highlighting, line decoration, and copy controls. |
| `<ob-code-runner>` | Native labelled `pre` and `code` retain the complete source. | `ob-code-runner.js` plus the configured external runner endpoint; editor, input, execution, reset, copy, and output. |
| `<ob-comments>` | A paragraph states that comments require JavaScript; the article remains complete. | `ob-comments.js` plus the configured engagement endpoint; approved thread loading and moderated submission. |
| `<ob-quiz>` | A native `fieldset`, `legend`, radio choices, explanation, and `noscript` limitation notice remain in reading order. | `ob-quiz.js`; answer checking, retry, and local attempt persistence. |
| `<ob-recipe>` | Native article, summary, ingredients, and ordered steps remain complete. | `ob-recipe.js`; scaling, checklists, timers, cook mode, and printing. |
| `<ob-rust-playground>` | Native labelled `pre` and `code` retain the complete Rust source. | `ob-rust-playground.js` and the official Rust Playground API; editor, execution, reset, copy, and output. |
| `<ob-share>` | A labelled `nav` contains ordinary destination links. | `ob-share.js`; device share sheet and clipboard action when those browser APIs exist. |
| `<ob-search>` | A `noscript` notice links to the archive and tags; an inert form is hidden until enhancement succeeds. | `ob-search.js`, the local search index, and optional bundled WASM; query input and ranked results. |
| `<ob-theme-toggle>` | Hidden; the system color scheme and readable theme tokens remain active. | `ob-theme-toggle.js` and browser storage; manual scheme selection. |
| `<ob-views>` | A build-time count remains when available; otherwise the empty host contributes no authored meaning. | `ob-views.js` plus the configured analytics endpoint; privacy-aware live count. |
| `<ob-web-sandbox>` | Native labelled `pre` and `code` retain the complete HTML, CSS, and JavaScript source. | `ob-web-sandbox.js`; local editors and an opaque-origin, network-blocked preview. |

Theme scripts follow the same rule. A theme may enhance semantic host markup, but disabling its
scripts and styles must preserve content order, labels, safe links, and native form behavior. Theme
authors can start with the [component contract](theme-components.md#the-contract-progressive-enhancement).

## Author-supplied custom elements

Raw HTML is a trusted-author boundary, not a sanitizer. The accessibility audit reports an authored
`<ob-*>` host whose native fallback is empty, missing, or contains an executable `javascript:` or
`data:text/html` URL. Findings point to the canonical Markdown line and explicitly distinguish the
native fallback from behavior that only exists after JavaScript runs. Auditing never rewrites the
source or calls a remote service.

An honest fallback keeps the same meaning and order in native HTML:

```html
<ob-map>
  <p>Interactive map unavailable. <a href="/places/">Browse the place list</a>.</p>
</ob-map>
```

The release gate renders static fixtures with JavaScript and CSS absent, verifies quiz and search
labels, links, controls, Unicode paths, and reading order, and runs browser tests for enhanced
behavior. See the broader [capability portability matrix](content-portability.md) for feed,
preview, and syndication behavior.
