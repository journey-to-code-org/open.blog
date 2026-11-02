# Netlify publishing workflow

## Trigger and inputs

| Trigger | Source state | Prepared input |
| --- | --- | --- |
| Push to `main` | Exact pushed commit | `scheduled-publisher-linux-x64` from that commit's successful preparation run |
| Daily at 06:23 UTC | Current `main` | Most recent successful preparation artifact for the exact `main` commit |
| Manual scheduled publish | Current `main` | Same exact-commit artifact as the daily run |
| Weekly artifact refresh | Current `main` | Recompiled generator and pinned Netlify CLI; no production deploy |

## Actions and ownership

GitHub Actions owns compilation, site generation, and the production deploy:

1. `prepare-scheduled-publisher.yml` compiles `openblog` and packages it with the pinned Netlify CLI.
2. `netlify-main.yml` consumes a successful main-push artifact, generates `dist/`, and uploads it with `netlify deploy --no-build --prod`.
3. `netlify-schedule.yml` reuses the exact-main artifact, regenerates `dist/` so due posts appear, and uploads it with the same no-build command.
4. The shared `netlify-production` concurrency group prevents production deploys from overlapping.

Netlify owns only atomic hosting, functions packaging, redirects, headers, and CDN delivery. Its build status remains **Stopped builds**. `NETLIFY_AUTH_TOKEN` and `NETLIFY_SITE_ID` live only in GitHub Actions repository secrets.

## Failure contract

- A failed preparation never triggers a main deploy.
- A missing exact-commit artifact stops scheduled publishing instead of using a stale generator.
- Missing Netlify credentials stop before upload.
- GitHub reports build and deploy failures; there is no Netlify-build fallback.
- The owner retries the failed GitHub workflow after correcting credentials or transient service failures.
