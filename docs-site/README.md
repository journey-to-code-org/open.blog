# The documentation site

This folder is an open.blog project that publishes the repository's [`docs/`](../docs/README.md) folder at
<https://journey-to-code-org.github.io/open.blog/>. The documentation is written once, in `docs/`, and read either
on GitHub or on the site; nothing here is a copy of it.

- `openblog.json` turns on the [documentation section](../docs/docs-sites.md), points `docs.source` at `docs/` on
  GitHub, and uses the engine's own `themes/` and `web/` folders.
- `content/landing.json` is the home page.
- `content/docs/` is filled from `docs/` when the site is built and is never committed.

Build and preview it from the repository root:

```bash
node scripts/build-docs-site.mjs           # copies docs/ into docs-site/content/docs/
cargo run -p openblog-cli -- serve --root docs-site
```

`.github/workflows/docs-pages.yml` does the same and deploys `docs-site/dist/` on every push to `main` that changes
`docs/`, this folder, the engine or the themes.
