---
title: Contributing to Docs
nav_order: 8
---

# Contributing to Docs

## Docs location

The site has two parts:

- **Hand-written pages** in `docs-site/`: the home page, Quick Start, the CLI, Admin Panel and
  content overviews, deployment, troubleshooting and the FAQ.
- **Everything in `docs/`**: the feature guides, the configuration reference, the command
  reference, the specifications and the decision records. `scripts/build-docs-site.mjs` copies
  them into `docs-site/guides/` when the site is built, adds the navigation front matter and
  makes their links work on the site. `docs-site/guides/` is generated and never committed.

So a feature's guide is written once, in `docs/`, and appears on the site on the next push to
`main`. Do not copy a guide into `docs-site/`; link to it under `guides/` instead.

Two references are checked by tests, so they cannot fall behind the code:

- `docs/cli-reference.md` is generated from `openblog help`. After changing the help text run
  `OPENBLOG_BLESS_DOCS=1 cargo test -p openblog-cli cli_reference`. The test also fails when a
  command is missing from the help.
- `docs/configuration.md` must name every top-level `openblog.json` key; a test in
  `openblog-core` fails when one is missing.

To preview the site locally:

```bash
node scripts/build-docs-site.mjs
cd docs-site && bundle exec jekyll serve   # with the github-pages gem installed
```

## Contribution expectations

- Keep changes scoped and explicit.
- Prefer adding examples over abstract advice.
- Update related pages when behavior or commands change.

## Writing standards

- Use concise technical language.
- Keep command samples runnable.
- Keep page headings predictable and scannable.
- Link related sections when introducing advanced features.

## Review checklist

- Navigation order is correct.
- Internal links resolve.
- Commands match current CLI behavior.
- Deployment workflow still targets `docs-site/`.
- `node scripts/build-docs-site.mjs` reports no warnings.
