# Troubleshooting

## `openblog check` fails

- Read the exact file path and error message in output.
- Fix front matter formatting and required fields.
- Re-run `openblog check` before build.

## Build output missing content

- Confirm draft status and publish date.
- Rebuild with `openblog build --drafts` for preview scenarios.
- Verify content file placement under expected directories.

## Admin panel access issues

- Ensure `openblog serve --admin` is running.
- Confirm user exists via `openblog user list`.
- Reset credentials with `openblog user passwd <name>`.

## GitHub Pages not updating

- Check the deploy workflow's run in the repository's **Actions** tab.
- Ensure the Pages source is set to **GitHub Actions**.
- Confirm the change is on the branch the workflow deploys (usually `main`).

## Theme/rendering inconsistencies

- Re-run `openblog build` after theme changes.
- Validate theme settings and inheritance.
- Confirm preview and deployed revision are aligned.
