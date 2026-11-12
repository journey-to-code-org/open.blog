# open.blog GitHub Pages Documentation

This folder contains the standalone technical documentation suite intended for GitHub Pages.

## Structure

- `index.md` – entry page
- `getting-started.md` – install + first publish flow
- `cli/` – CLI overview and workflows (the command reference is generated into `guides/`)
- `admin-panel/` – Admin usage and publishing flow
- `content/` – Markdown, front matter, and quality guidance
- `advanced/` – architecture, research, syndication, themes, analytics, migrations
- `deployment.md` – GitHub Pages deployment notes
- `troubleshooting.md` – operational troubleshooting
- `contributing.md` – documentation maintenance guidance
- `versioning-and-migrations.md` – changelog policy and upgrade runbook
- `faq.md` – quick answers to common usage questions
- `guides/` – generated from the repository's `docs/` folder by `scripts/build-docs-site.mjs`;
  not committed (see `contributing.md`)

## Deployment

Deployment is handled by `.github/workflows/docs-pages.yml`.
