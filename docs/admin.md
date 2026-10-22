# The admin editor: log in, edit, create, schedule

`openblog serve --admin` adds a login-protected editor at `/admin` to the same server that
serves your blog. The editor reads and writes the same Markdown files you would edit by
hand, so your content stays plain files you own. There is no database.

```sh
openblog user add mikey            # create a login (prompts for a password)
openblog serve --admin             # http://localhost:8080/admin
```

Passwords need at least 12 characters. To avoid typing one where it is echoed, use
`echo "your passphrase" | openblog user add mikey --password-stdin` or set
`OPENBLOG_PASSWORD`. Other commands: `user passwd <name>`, `user remove <name>`,
`user list`. Changing a password or removing a user ends that person's open sessions
immediately.

## What you can do

| | |
| --- | --- |
| **Edit** | Every post, page, and series. Front matter fields become a form; unknown fields you added by hand are kept. |
| **Create** | New posts, pages, and series. The file is named from the date and slug. |
| **Preview** | Live Markdown preview. It runs the same Rust renderer as the build, compiled to WebAssembly in your browser, inside a sandboxed frame. It falls back to the server if WASM is missing. |
| **Images** | Insert by button, drag and drop, or paste. Saved under `static/images/uploads/<year>/`. |
| **Delete** | Moves the file to `.openblog/trash/`; nothing is destroyed. |
| **Schedule** | See below. |
| **Analytics** | Views, unique visitors, a per-day chart, top pages and referrers from the built-in counter. See [features.md](features.md). |

Every save is checked against the whole site before anything is written (duplicate slugs,
unknown themes, bad dates), then the site is rebuilt. A save that would break the build is
refused with the reason. If the file changed on disk since you opened it (for example you
edited it in your text editor), the save is refused instead of overwriting your changes.

## Scheduling

A post's status is one of:

- **Draft**: never public (`draft: true`).
- **Published**: the date is now or in the past.
- **Scheduled**: the date is in the future.

Pick *Scheduled* and a date and time (your local time; it is stored as UTC) and save. The
post is held back from the pages, feeds, sitemap, search index, tags, series, and the
portfolio snapshot. The server checks every few seconds and rebuilds at the moment the post
comes due, so it appears by itself.

This works in plain files too: any post with a future `date:` stays hidden until a build
runs after that time. So a scheduled post also goes live on a static host if something runs
`openblog build` periodically, such as a cron job or a scheduled GitHub Action.

```yaml
date: 2026-12-25T09:00:00Z      # offsets work too: 2026-12-25T09:00:00-05:00
```

`openblog build --drafts` and `serve --drafts` include drafts and scheduled posts, for
previewing.

## Running it for real

By default the server listens on `127.0.0.1` only. To use the admin from anywhere, run it on
a machine you control and put it behind HTTPS (a reverse proxy such as Caddy or nginx), then:

```jsonc
// openblog.json
"admin": {
  "secureCookies": true,      // mark the session cookie Secure (required over HTTPS)
  "sessionHours": 12,
  "maxUploadMb": 10,
  "usersFile": ".openblog/users.json",
  "trustedProxies": ["127.0.0.1"]   // the proxy's address, so login limits see real clients
}
```

With `trustedProxies` set, a connection from one of those addresses takes the client address
from the last `X-Forwarded-For` entry, the one that proxy appended. Without it, every visitor
behind the proxy would share one login limit.

```sh
openblog serve --admin --host 0.0.0.0 --port 8080
```

Without HTTPS, passwords and sessions cross the network in clear text; the server prints a
warning if you expose it that way with `secureCookies` off. Keep `.openblog/` (users file and
trash) out of version control; `openblog init` adds it to `.gitignore`.

The public site and the admin share one process, so the blog is served by this server too.
If you would rather host the static output elsewhere, run the admin where the content lives
and publish `dist/` onward (for example with a git push or rsync after each build).

## Security design

- Passwords are hashed with Argon2id. Session and CSRF tokens are 256 random bits from the
  operating system.
- The session cookie is `HttpOnly` and `SameSite=Strict`, scoped to `/admin`. Every API route
  except login checks it **before any request body is read**, so anonymous clients cannot make
  the server buffer uploads.
- Every state-changing request needs the CSRF token header and, when the browser sends one, a
  same-origin `Origin`. JSON endpoints require `Content-Type: application/json`.
- Failed logins are limited two ways. A client address is locked for five minutes after five
  failures (the attempt is counted before the password is checked, so parallel guesses do not
  slip past). A username is never locked, only slowed down with a growing delay, so someone who
  knows your username cannot shut you out. Unknown usernames take as long as wrong passwords.
- File paths from the browser are matched against a strict allow-list (`posts/`, `series/`,
  `pages/`, `.md` only) and resolved inside the content directory, including through symlinks.
- Uploads are accepted by their bytes, not their names: PNG, JPEG, GIF, WebP, and AVIF only.
  SVG is refused because it can carry scripts.
- The admin page is served with a strict Content-Security-Policy (no inline scripts), and the
  Markdown preview is rendered in a sandboxed iframe that cannot run scripts.
- Front matter values are always quoted so a value containing a newline cannot add fields.
- Limits: 64 concurrent connections (16 per address), header and body size caps, deadlines
  for slow senders and slow readers, and no chunked bodies.

What it does not do: multi-factor login or per-user roles (every user can edit everything).
