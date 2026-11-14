---
name: studio-architecture
description: How open.blog Studio (the new Admin on Zubra UI) is built: folders, vendored Zubra UI, the Admin API contract, routing, security policy and tests. Use when adding, changing or reviewing Studio code.
---

# Studio architecture

Studio is a new face on the existing Admin server. The server, its sessions and its `/admin/api/*` routes stay; Studio replaces only what runs in the browser. The old Admin (`web/admin/`) is being retired (docs/specs/studio/retirement-plan.md): Studio must do everything it did, and at the end `/admin/` opens Studio and `web/admin/` is deleted. Studio never loads anything from `/admin/*.js`; an old Admin address opens its Studio screen through `legacyRoute()` in `router.js`.

## Where things live

```
web/studio/
  index.html          the one page; loads studio.css, zubra/theme.css, studio.js
  studio.css          Studio's tokens, the bridge to Zubra UI's variables, layout
  studio.js           start-up: session, router, shell
  api.js              the only code that talks to the server
  router.js           #/... routes → screens, leave-guard for unsaved work
  shell.js            frame: navigation, account, command palette, toasts
  screens/<name>.js   one screen per job (posts.js, write.js, seasons.js, ...)
  parts/<name>.js     pieces shared by screens (field rows, status line, ...)
  zubra/              vendored Zubra UI, never edited by hand (see below)
```

Served at `/admin/studio/` (under the `/admin` cookie path, so the Admin session works unchanged), embedded in the binary from `crates/openblog-cli/src/studio_files.rs`, which `scripts/studio-files.mjs` generates from the folder. Run the script after adding or removing a file; a test fails when the list and the folder disagree.

## Rules

- **Plain modules, no build step, no framework.** ES modules the browser loads as they are. Zubra UI elements are the components; Studio code composes them.
- **Rules live in `parts/*-rules.js`.** Pure data and functions (no DOM, no `document.`/`window.`; a test enforces it), imported statically by screens and tested in `tests/web/studio-*-rules.test.mjs`. Rules moved from the old Admin keep their behaviour and their tests.
- **The API is the contract.** Screens call `api.js`, which calls the existing `/admin/api/*` routes with the CSRF header. A screen that needs something the API lacks gets a new route in Rust, with route tests, agreed by the architect. Studio never reads or writes files any other way.
- **Security policy stays strict.** Studio runs under Admin's policy: `script-src 'self'`, `style-src 'self'`. No inline scripts, no `style` attributes, no `innerHTML` with data. Set styles through classes, custom properties set from script (`element.style.setProperty`) or Zubra UI's constructed stylesheets, which the policy allows.
- **Text is text.** Everything from the server or the owner is placed with `textContent` or as element properties.
- **Opens with no signal, never stale data.** The one worker (`/admin/sw.js`, scope `/admin/`) keeps Studio's own files from the list the server writes on its first line: versioned per release and installed all-or-nothing (an old release's complete copy stays until the new one is whole), network first with a short time limit before falling back to the kept copy, never an `/admin/api/` reply or anything of the session. Details compare the page's release (`/admin/studio/release.js`), the worker's and the server's. Studio keeps the last `meta` and user in `localStorage` to start without a signal; everything else is asked of the server. The policy allows `blob:` images and media only for previews the page made itself.
- **Data kept on the phone is permanent in shape.** IndexedDB `openblog-capture` v1 / `captures` / record `v: 1` is shared with the old Admin forever (ADR 0297): never bump, delete or clear it, merge changes into the stored value, and remove a record only after a send answered with a path or when she throws it away. Open it only when it already exists (or to keep a job), so a phone that never kept one gets nothing.
- **Screens are small.** A screen module exports `create(context)` returning `{ element, load(), isDirty(), leave() }`. Past about 400 lines, split it into parts.
- **Tokens, not values.** Colours, spacing, radius and type come from Studio's tokens in `studio.css`; Zubra UI reads them through the bridge (`--primary`, `--border`, `--radius`, ...). A raw colour in a screen is a bug.

## Vendored Zubra UI

`web/studio/zubra/` holds Zubra UI's plain elements (`--emit element` builds, no runtime), the one runtime piece two of them import (`runtime/primitives.js`), and the default theme. `zubra/components.json` lists what Studio uses and the zubra-ui commit they came from. To add a component or update:

1. Add its name to `zubra/components.json`.
2. Run `node scripts/vendor-zubra-ui.mjs <path-to-zubra-ui checkout>`; it builds zubra-ui and copies only the listed elements.
3. Run `node scripts/studio-files.mjs` and commit both.

A bug in a component is fixed in zubra-ui and re-vendored, never patched here.

## Tests

- **Logic** (formatting, routing, validation) as pure functions, tested with `node --test tests/web/studio-*.test.mjs`.
- **Screens** in a real browser, because custom elements need one: `tests/browser/studio-*.spec.mjs` with Playwright against a real `openblog serve --admin`, including keyboard-only use, 320 px reflow and an axe-core scan with no violations.
- **Server** changes with Rust route tests beside the route.

A change is done when its tests pass, the screen passes the `studio-ux` checklist, and `scripts/studio-files.mjs` reports nothing to change.
