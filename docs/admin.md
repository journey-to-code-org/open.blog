# The admin editor: log in, edit, create, schedule

`openblog serve --admin` adds a login-protected editor at `/admin` to the same server that
serves your blog. The editor reads and writes the same Markdown files you would edit by
hand, so your content stays plain files you own. There is no database.

```sh
openblog user add you              # create a login (prompts for a password)
openblog serve --admin             # http://localhost:8080/admin
```

Passwords need at least 12 characters. To avoid typing one where it is echoed, use
`echo "your passphrase" | openblog user add you --password-stdin` or set
`OPENBLOG_PASSWORD`. Other commands: `user passwd <name>`, `user remove <name>`,
`user list`. Changing a password or removing a user ends that person's open sessions
immediately.

## What you can do

| | |
| --- | --- |
| **Edit** | Every post, page, and series. Front matter fields become a form; unknown fields you added by hand are kept. |
| **Create** | New posts, pages, and series. The file is named from the date and slug. |
| **Preview** | A full-page preview produced by the same site model, document renderer, theme inheritance, metadata, and components as a real build. Front matter stays in the settings form and is never printed into the preview. |
| **Social preview** | A card built from the generated OpenGraph title, description, canonical URL, type, image, and X card mode—not a separate browser-side approximation. |
| **SEO & answer readiness** | A transparent, local checklist for search metadata, direct-answer structure, supporting sources, authorship, links, and image accessibility. Its readiness score is guidance, not a ranking guarantee. |
| **Accessibility Studio** | Production-backed source findings grouped as detected, potential, or needs review, with exact locations and repair guidance. It also keeps rendered-site checks visible without claiming WCAG conformance. |
| **Evidence Studio** | Research-profile structure and metadata findings from the publishing engine, plus authored DOI (normalized to a resolver URL when valid), valid absolute license URL, and linked-reference inspection without truth or authority scoring. |
| **Images** | Insert by button, drag and drop, or paste. Saved under `static/images/uploads/<year>/`. |
| **Formatting** | Apply H2, bold, italic, link, quote, list, and inline/fenced-code Markdown without converting or hiding the source. `Ctrl+B`/`Command+B` and `Ctrl+I`/`Command+I` work in the editor. |
| **Content profiles** | Choose field-specific authoring and rendering behavior for a post. Legacy recipes are recognized without silently rewriting their front matter, and unknown profile ids remain intact with visible fallback guidance. |
| **Knowledge checks** | Insert one to three multiple-choice questions through a form, with optional author-time generation. Reader attempts stay in the reader's browser. |
| **Delete** | Moves the file to `.openblog/trash/`; nothing is destroyed. |
| **Schedule** | See below. |
| **Analytics** | Views, unique visitors, a per-day chart, top pages and referrers from the built-in counter. See [features.md](features.md). |
| **Publish** | A button in the header commits changed content with git and pushes it, so a Pages workflow deploys. Drafts stay local. See [publishing.md](publishing.md). |

## Workspace layout

The admin is organized like a writing studio. The tool groups at the top move between
content, analytics, and the public site; the status bar keeps unpublished changes and
the publish action visible. Inside the editor, **Write**, **Site preview**, **Social**,
**Optimize**, **Settings**, **Accessibility**, and **Evidence** are separate full-width
views, so writing is not squeezed beside a permanent preview.
Switching views never loses edits, and opening Site preview refreshes it from the current draft.

Press `Ctrl+K` on Windows or Linux, or `Command+K` on macOS, to search workspace
commands. The palette opens content lists, creates documents, switches editor panes,
saves the current document, changes the color scheme, and reaches account actions. Use
the arrow keys and Enter to choose a result, or Escape to close it.

The editor footer shows whether the document is saved plus its line, word, and character
counts. Press `Alt+1` through `Alt+5` to focus Write, Site preview, Social, Optimize, or
Settings; `Alt+6` opens Accessibility Studio and `Alt+7` opens Evidence Studio. The preview
toolbar can constrain the canvas to wide, tablet, or mobile width; this preference is stored
in the browser and does not change the published theme.

### Test a theme before publishing

The Site preview reports the theme it resolved and renders through the same site model,
theme compiler, document renderer, and components as a public build. Theme precedence is
the same in both places:

1. A post or page theme selected in **Settings** is an explicit override.
2. A post without an override inherits the theme selected by its series.
3. Content without either override uses the site theme from `openblog.json`.

To test a series design, set the theme on the series document, leave the post's theme
unset, and open **Site preview** on a post in that series. To compare a one-off design,
select a theme on the post instead. The preview includes unsaved changes to the document
you are editing but does not expose unrelated drafts or scheduled posts. Front matter
remains in **Settings** and is never printed into the preview.

### Review accessibility while writing

Open **Accessibility** to run the publishing engine's source audit against the current
unsaved document. The view includes site-wide configuration findings, such as a missing
default language, but excludes findings that belong only to other documents. It reports
what was located, the canonical file/line or field, and what to do next.

The outcome labels have deliberately different meanings: **Detected** is a source condition
the engine can establish, **Potential** is a useful heuristic that still needs context, and
**Needs review** is a decision only an author can make. The pane never turns an empty result
into a score or conformance claim. See [Accessibility checks and manual review](accessibility.md)
for every check, the CLI workflow, and the rendered-page checklist.

### Review research evidence while writing

Choose the Research content profile, then open **Evidence**. The preview API runs the same
core audit used by `openblog check` and builds, scoped to the current unsaved document. It
shows the authored DOI (normalized to a resolver URL when valid), valid absolute license
URL, number of linked references, and findings for missing
visible Abstract or References/Bibliography sections, malformed work metadata, unresolved
footnotes, references without resolvable links, and non-preferred DOI links.

The **Abstract** and **References** toolbar actions ask the publishing engine whether the
section already exists before changing Markdown. This keeps formatted headings, code
examples, containers, and HTML blocks consistent with the actual build parser. Profile
metadata drafts survive profile switches and are included when the document is saved.

Evidence Studio does not score truth, source authority, peer review, methodology, or
whether a citation supports a claim. Outside the Research profile it explicitly reports
that the checks are inactive. See [Research posts and Evidence Studio](research-profile.md).

The **Overview** is the admin home. It summarizes the publishing pipeline, links to quick
creation flows, shows the size of the content library and recent posts, and surfaces the
next scheduled post or last build error without requiring a trip through each content list.

Markdown remains the source of truth. The source-preserving formatting toolbar provides
rich-writing ergonomics without an HTML-to-Markdown round trip, so existing custom blocks,
embeds, quizzes, and front matter cannot be lost by switching editor modes. Saving,
conflict detection, preview sandboxing, and publishing use the same file-based workflow
and security checks.

In a post's **Settings** view, **Content profile** defaults to Article. Recipe posts select
Recipe and continue through the existing recipe renderer and structured-data path. Files
using `recipe: true` or another legacy recipe alias appear as Recipe but keep that original
field unless you explicitly change the selector. An unknown `profile` value appears as its
own option with a warning; saving without changing it preserves the value.
Research posts select Research and expose DOI and license fields. Values entered there are
preserved when switching profiles and saved without discarding explicit clears.

Every save is checked against the whole site before anything is written (duplicate slugs,
unknown themes, bad dates), then the site is rebuilt. A save that would break the build is
refused with the reason. If the file changed on disk since you opened it (for example you
edited it in your text editor), the save is refused instead of overwriting your changes.

Posts with an adjacent `<stem>.credits.json` file keep that contributor data throughout the
Admin lifecycle. The server validates the Markdown and credits together, preserves the
sidecar when an older editor does not send credit fields, checks it independently for
concurrent edits, and moves it to `.openblog/trash/` with the post. Preview requests can
include unsaved credits and are rendered through the same contributor rules as a build.
An explicit empty credits list remains distinct from having no sidecar and inheriting the
site author. A malformed sidecar does not hide the Markdown document: Admin reports the
credit error and keeps a separate revision token so a credits-aware client can safely repair
or remove it. Editing the JSON files by hand remains supported.

### Credit contributors and roles

For posts, open **Settings → Contributors** to choose between inheriting the site author
and an explicit ordered credit list. Add people from the contributor registry, arrange the
public byline order with the arrow buttons, and choose publishing roles or CRediT taxonomy
roles for each person. Every selected person needs at least one role. An explicit list with
no people intentionally suppresses inherited authorship; the editor labels this state so it
cannot be confused with inheritance.

The people available in the picker come from the site contributor registry. Open
**Site → Contributors** to add or update a public name, stable ID, profile URL, same-as
profiles, and optional ORCID iD. Existing IDs cannot be renamed in Admin because post
sidecars refer to them; a contributor cannot be removed while any sidecar still uses that
ID. If the registry is empty, **Prefill legacy author** copies the existing site author into
an unsaved draft for review—it does not change configuration or post credits until you save.

Registry saves use their own `openblog.json` revision token. If configuration changed on
disk after the workspace opened, Admin refuses the stale save and asks you to reload. It
updates only the `contributors` member of the parsed JSON object, preserving unrelated and
future configuration members, validates the complete candidate with the publishing engine,
then rebuilds the preview. ORCID iDs entered here are manual and unauthenticated: format and
checksum validation does not verify the person or ownership of the record.

If a sidecar is malformed, Settings shows the error without hiding
the Markdown and requires an explicit repair choice: inherit to remove the broken sidecar,
or set new explicit credits to replace it. Credit-only changes participate in unsaved-change
warnings, production preview, conflict detection, and the normal save validation.

## Scheduling

A post's status is one of:

- **Draft**: never public (`draft: true`).
- **Published**: the date is now or in the past.
- **Scheduled**: the date is in the future.

Pick *Scheduled* and a date and time (your local time; it is stored as UTC) and save. The
post is held back from the pages, feeds, sitemap, search index, tags, series, and the
latest-posts JSON. The server checks every few seconds and rebuilds at the moment the post
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

Entries in `trustedProxies` are exact IP addresses, not ranges, or the single entry `"*"`
to trust every connection's `X-Forwarded-For` (only right when nothing can reach the
server except through the proxy, as in a container on a PaaS; the
`OPENBLOG_BEHIND_PROXY=1` environment variable sets this and `secureCookies` together). A connection from one of
them takes the client address from the last `X-Forwarded-For` entry, the one that proxy
appended; if the header is missing, the proxy's own address is used and every visitor
shares one login limit. Connections from a trusted proxy are also exempt from the
per-address connection cap, so the whole readership is not squeezed through one slot.

```sh
openblog serve --admin --port 8080
```

Keep the default `--host 127.0.0.1` when the proxy runs on the same machine, so only the
proxy can reach the plain-HTTP port; use `--host 0.0.0.0` only when the proxy is elsewhere,
and firewall the port. The proxy must pass the original `Host` header through and add
`X-Forwarded-For` (Caddy does both by default; nginx needs `proxy_set_header Host $host;`
and `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`). Without the `Host`
header every login and save is refused as cross-origin; without `X-Forwarded-For` all
visitors share one login limit. [Deploying](deploy.md) has a complete nginx example.

Without HTTPS, passwords and sessions cross the network in clear text; the server prints a
warning if you expose it that way with `secureCookies` off. Keep `.openblog/` (users file and
trash) out of version control; `openblog init` adds it to `.gitignore`.

The public site and the admin share one process, so the blog is served by this server too.
If you would rather host the static output elsewhere, run the admin where the content lives
and publish `dist/` onward (for example with a git push or rsync after each build).

### Troubleshooting local styles and sessions

If the browser refuses `/assets/base.css` or `/themes/.../tokens.css` because the response
has the `text/html` MIME type, first restart `openblog serve --admin` after upgrading. Sites
whose configured URL includes a base path, such as `https://example.github.io/project/`,
still open the private editor at `/admin`; in admin mode the server maps its root-relative
asset requests to the same built styles used by the public site. A stale pre-0.6.1 server
does not provide that mapping. If restarting does not help, run `openblog build` and confirm
the corresponding files exist under `dist/assets/` and `dist/themes/`.

An initial `GET /admin/api/session` response of `401 Unauthorized` is expected when no valid
admin cookie exists: it is how the editor decides to show the sign-in form. A `401` after
you have signed in means the session expired, the user was removed, or the password changed;
sign in again. It is unrelated to stylesheet MIME errors.

## Optional question generation

Knowledge checks work without an AI service. To add **Generate draft** to their editor,
site owners can configure an HTTPS endpoint and keep its bearer token in the server
environment:

```jsonc
// openblog.json
"knowledgeChecks": {
  "generationEndpoint": "https://lessons.example.com/generate",
  "model": "your-model-name"
}
```

```sh
export OPENBLOG_LESSONS_API_KEY="your secret"
openblog serve --admin
```

The endpoint receives JSON with `context`, `count`, `model`, task instructions, and the
expected response shape. It returns one to three questions:

```json
{
  "questions": [{
    "prompt": "What stays in the reader's browser?",
    "choices": ["Quiz attempts", "Published posts"],
    "correctIndex": 0,
    "explanation": "Attempts are private local progress."
  }]
}
```

The key and endpoint are used only by the admin server. The browser calls the authenticated
same-origin admin API, public builds contain only the reviewed Markdown, and readers never
contact the generation service.

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
- The admin page is served with a strict Content-Security-Policy (no inline scripts). Full-page
  previews are kept in a small in-memory cache behind an authenticated random URL and rendered in
  an opaque-origin sandbox. Built-in components and the selected theme's local or configured-CDN
  assets can run, while owner-supplied analytics, comments, and other raw HTML snippets are removed
  from unpublished previews. The preview cannot submit forms or access the admin document.
- Front matter values are always quoted so a value containing a newline cannot add fields.
- Limits: 64 concurrent connections (16 per address, not applied to trusted proxies),
  header and body size caps, deadlines for slow senders and slow readers, and no chunked
  bodies.

What it does not do: multi-factor login or per-user roles (every user can edit everything).
