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

A blog made with `openblog init` is a folder of Markdown, settings, and themes. It has
no Rust code of its own: the `openblog` command does the building. The instructions below
assume that layout. (If you instead work inside a clone of the open.blog repository, its
own `.github/workflows/pages.yml` builds the starter site from source; replace
`openblog build` with `cargo run --release -p openblog-cli -- build` in the commands here.)

## GitHub Pages

1. Create the blog with the workflow included, or add it to an existing blog:

   ```sh
   openblog init my-blog --github-pages
   ```

   This writes `.github/workflows/pages.yml`. It installs `openblog` on the build machine
   (cached between runs), runs `openblog build`, and deploys `dist/`, on every push to `main`
   and once an hour so scheduled posts publish on time. Edit the `cron` line if you want a
   different rhythm.

2. Push the blog to a GitHub repository.
3. In the repository settings, under *Pages*, set *Source* to **GitHub Actions**.
4. Set `"url"` in `openblog.json` to the address the site will have.

Two kinds of address are possible:

- **A custom domain, or a `user.github.io` user site**: the site lives at the root. Add the
  domain to `static/CNAME` (one line) and configure it under *Pages*; the build copies the
  file to the site root. With `"postPath": "/{slug}/"`, URLs imported from Hashnode stay
  identical.
- **A project site, `https://user.github.io/repo/`**: set `"url"` to exactly that. The build
  reads the path from it and prefixes every root-relative link, asset, and the search index,
  while feeds and the sitemap use the full address. `openblog serve` honours the same prefix
  locally, so `http://localhost:8080/repo/` previews what Pages will serve.

The build also writes a `.nojekyll` file so Pages serves everything as is.

## Netlify, Cloudflare Pages, Vercel, and others

Set the publish directory to `dist/` and use a build command that installs Rust and the
`openblog` command, then builds:

```sh
curl https://sh.rustup.rs -sSf | sh -s -- -y && . "$HOME/.cargo/env" \
  && cargo install --git https://github.com/journey-to-code-org/open.blog openblog-cli \
  && openblog build
```

The install step compiles the engine, which takes a few minutes the first time; most
hosts cache `~/.cargo` between builds. Alternatively build in GitHub Actions (the Pages
workflow above, minus the deploy job) and push `dist/` with the host's own tool.

For scheduled posts, trigger a build on a schedule: a build hook called from a cron job,
or a scheduled workflow.

## Self-hosting with `openblog serve`

```sh
openblog user add you
openblog serve --admin --port 8080
```

Then put a reverse proxy with HTTPS in front (Caddy, nginx, Traefik, ...) and set, in
`openblog.json`:

```jsonc
"admin": {
  "secureCookies": true,              // required over HTTPS
  "trustedProxies": ["127.0.0.1"]     // the proxy's address, exact IP (no ranges)
}
```

Three things the proxy must do, or logins and saves are refused as cross-origin and
every visitor shares one login limit:

- Pass the original `Host` header through. Caddy does by default. For nginx add
  `proxy_set_header Host $host;`.
- Add `X-Forwarded-For`. Caddy does by default. For nginx add
  `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`.
- Reach `openblog serve` on the address it listens on. Keep the default `--host 127.0.0.1`
  when the proxy runs on the same machine, so only the proxy can reach the plain-HTTP port.
  Use `--host 0.0.0.0` or the machine's private address only when the proxy is elsewhere,
  and firewall the port so it is not reachable from the internet.

A minimal nginx location:

```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

Run the server under a process manager (systemd, a container, or a Windows service) so it
restarts with the machine, and keep `.openblog/` (users, trash, analytics) out of version
control and in your backups. [The admin editor](admin.md) has the full checklist.

A common hybrid: run `openblog serve --admin` privately for writing, and let the Pages
workflow deploy `dist/` for readers. The editor writes the same Markdown files the
workflow builds from; commit and push after writing.

## A theme that is not in the repository

Builds in CI only see committed files. If a theme is kept out of the repository
(private fonts, a design you do not want to publish), either commit it after all, add a
workflow step that checks the theme out from a private repository into `themes/<name>/`
(a second `actions/checkout` with a deploy key or token), or build locally and upload
`dist/` instead of building in CI. A missing theme fails the build with
"theme `name` not found".

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

Changing `postPath` moves every post at once; add an alias for the old address to each
post you care about, or keep `postPath` as it was.
