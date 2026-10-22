# Deploying

`openblog build` writes a complete static site to `dist/`. Anything that serves files can
host it. The choice is between a static host (simplest, no server to run) and
`openblog serve` on a machine you control (adds the admin editor, the view counter, and
automatic publishing of scheduled posts).

| | Static host (Pages, Netlify, S3, ...) | `openblog serve` |
| --- | --- | --- |
| Pages, feeds, search, themes | yes | yes |
| Scheduled posts | on the next build after the date (schedule a build) | automatic, within seconds |
| Admin editor | no (edit files, push) | yes, with `--admin` |
| View counter and analytics | no (`<ob-views>` hides itself) | yes |
| HTTPS | provided | put a reverse proxy in front |

## GitHub Pages

The repository ships `.github/workflows/pages.yml`. It builds the WebAssembly module and
the site, then deploys `dist/` on every push to `main` and once an hour, so scheduled posts
publish on time. Setup:

1. In the repository settings, under *Pages*, set *Source* to **GitHub Actions**.
2. Set `"url"` in `openblog.json` to the address the site will have.
3. For a custom domain, add the domain to `static/CNAME` (one line) and configure it under
   *Pages*. The build copies the file to the site root.

Two addresses are possible:

- **A custom domain or `user.github.io` user site**: the site lives at the root. With
  `"postPath": "/{slug}/"`, URLs imported from Hashnode stay identical.
- **A project site, `https://user.github.io/repo/`**: set `"url"` to exactly that. The build
  reads the path from it and prefixes every root-relative link, asset, and the search index,
  while feeds and the sitemap use the full address. `openblog serve` honours the same prefix
  locally, so `http://localhost:8080/repo/` previews what Pages will serve.

The build also writes a `.nojekyll` file so Pages serves everything as is.

## Netlify, Cloudflare Pages, Vercel

Point the build at `dist/` with a command that installs Rust, for example:

```sh
curl https://sh.rustup.rs -sSf | sh -s -- -y && . "$HOME/.cargo/env" \
  && rustup target add wasm32-unknown-unknown && cargo install wasm-pack --locked \
  && cargo run --release -p openblog-cli -- build-wasm \
  && cargo run --release -p openblog-cli -- build
```

Or build in CI and deploy the folder with the host's CLI. For scheduled posts, trigger a
build on a schedule (a build hook called from a cron job, or a scheduled workflow).

## Self-hosting with `openblog serve`

```sh
openblog user add you
openblog serve --admin --host 0.0.0.0 --port 8080
```

Put Caddy, nginx, or another reverse proxy in front for HTTPS, set
`admin.secureCookies` to `true` and `admin.trustedProxies` to the proxy's address, and keep
`.openblog/` (users, trash, analytics) out of version control and in your backups. See
[admin.md](admin.md) for the full checklist. Run it under a process manager (systemd, a
container, or a Windows service) so it restarts with the machine.

A common hybrid: run `openblog serve --admin` privately for writing, and let a workflow
deploy `dist/` to a static host for readers. The admin writes the same Markdown files the
workflow builds from.

## Moving URLs

When a post's address changes, keep the old one working with `aliases` in its front matter:

```yaml
aliases:
  - /old-slug/
  - /2024/03/original-title/
```

Each alias becomes a small page that redirects to the post, carries a canonical link to
the new address, and is excluded from the sitemap. An alias that collides with a real page
fails the build instead of overwriting it. Pages support `aliases` too.

The Hashnode importer adds an alias for the original `/slug/` address automatically when
`postPath` is not `/{slug}/`.
