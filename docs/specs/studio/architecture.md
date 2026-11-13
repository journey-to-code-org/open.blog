# Studio, slice 1: architecture

By `studio-architect`, 2026-11-12, for [brief.md](brief.md). Line numbers are from the `feat/studio`
working tree on that date (`admin.rs` is being edited, so search the function name if a line drifted).
Facts marked **verified** were run against `openblog serve --admin` on a copy of Grammi's House.

## 1. Data needs → existing routes

Every call goes through `api.js` as `fetch("/admin/api/<name>", { credentials: "same-origin" })`,
the same as the old Admin's `Api.call` (`web/admin/admin.js:9990`; CSRF header at :10001; a JSON
error body `{ error }` becomes an `ApiError` with `status` and `data`). Errors are always
`{ "error": "<sentence>" }` (`http.rs:83`) unless noted.

**Common to every route** (`admin.rs`): `preflight` :494 refuses a request with no valid session
**401** before its body is read (login excepted, 4 KB cap); `api` :699 → `authenticate` :1127 gives
**401** "Not signed in" / "Session expired; sign in again" / "Session ended; sign in again" (user
removed or password changed). Every non-GET also passes `check_csrf` :1150: header `X-CSRF-Token`
must equal the session's token, and a sent `Origin`/`Sec-Fetch-Site` must be same-origin (`check_origin`
:1158), else **403**. Routes that read JSON call `require_json` :1177 (**415** without
`Content-Type: application/json`). With a durable workspace, any write can also answer **409** (another
writer holds the content lock, :725) or **503** "Workspace save NOT acknowledged" (:737, :758).
Bodies over the route's cap get **413** from `http.rs:220`.

| Need | Route | Request | Reply (2xx) | Errors | Handler | Old Admin |
| --- | --- | --- | --- | --- | --- | --- |
| Session check | `GET session` | — | `{ user, csrf, now }` | 401 | :804 | `start` :11289 (401 → login) |
| Sign in | `POST login` | `{ username, password }` (JSON) | 200 `{ user, csrf, now }` + `Set-Cookie: openblog_session…; HttpOnly; SameSite=Strict; Path=/admin; Max-Age=` | 400 bad JSON / password too long, 401 "Invalid username or password" (after a ≥300 ms delay), 403 origin, 405, 415, 429 + `Retry-After` (address locked), 500, 503 "No users exist yet" | `login` :3527, cookie :3520 | :11689 |
| Sign out | `POST logout` | `{}` + CSRF | `{ ok: true }` + expiring cookie | 401 if the session is already gone (treat as signed out), 403 | `logout` :3648 | :11737 (errors ignored) |
| CSRF | the `csrf` from session or login | — | — | — | — | kept in `api.csrf` |
| Meta | `GET meta` | — | uses: `siteTitle`, `siteUrl`, `tags` (all tags used, for suggestions), `maxUploadMb`, `capture.maxPhotoBytes` (the real intake limit; larger photos are shrunk server-side), `now` | 500 | `meta` :4021 | `enter` :11300 |
| Posts list | `GET documents?kind=posts` | — | `{ kind, items: [{ path, title, slug, date (RFC 3339), status: draft\|scheduled\|published\|error, series, tags[], url, words, creditMode }] }`, newest first; an `error` item has `{ path, title: path, status: "error", error }` | 400 bad kind, 500 | `list_documents` :12027 | :13593 |
| Read one post | `GET document?path=posts/…md` | — | `{ path, kind, etag, fields, body, resolvedProfile, credits, creditEtag, creditError }`. `fields` is every front-matter key as a string or string list (`fields_to_json` :3925), so `draft: true` arrives as `"true"`. Front matter that fails to parse gives `{ path, kind, etag, raw, error, … }` and no `fields`. | 400 missing/bad path, 404 | `get_document` :12163 | `showEditor` :21650 (`raw` → refuse to edit) |
| Create | `POST document` | `{ kind: "posts", fields, body }` | **201** `{ path, etag, creditEtag, status, url, build: { ok, posts, scheduled, nextDue } \| { ok: false, error }, trackUrl }` | 409 "A file with that name already exists…" (:16844), 413 body > 2 MB, 415, 422 `{ error }` (bad field name/value, or no title: `derive_new_path` :16714) or `{ error: "This can't be saved yet.", problems: [string] }` (:16968) | `save_document` :16755 | `save` :26418 |
| Update | `PUT document?path=…` | `{ fields, body, etag }` | 200, same shape as create | as create, plus **409** "This file changed on disk since you opened it…" when `etag` ≠ hash of the file now (:16865, **verified**), 404, 400 missing `?path=` | :1037 → `save_document` | :26417 |
| Pictures to choose from | `GET images` | — | `{ images: [{ url, name }], more }`, newest 300 | 500 | `list_images` :18624 | :11408 |
| Upload cover | `POST upload?name=<file name>` | raw bytes, `Content-Type: application/octet-stream`, CSRF | **201** `{ url: "/images/uploads/<year>/<stem>.<ext>", markdown }` | 400 empty, 413 (sentence says the limit), 415 not an image / HEIC (sentence says what to do), 409/503 | `upload` :18507 | :11409 |
| Is publishing set up | `GET publish` | — | `{ repo: false }` or `{ repo: true, branch, remote (null if none), changed[], drafts[], ahead, behind, lastCommit, auto }` + `filesMayVanish` | 500 | :1069, `publish::status` `publish.rs:61` | `loadPublishStatus` :12230 |
| Send it out | `POST publish` | `{ summary: "<post title>" }` (≤120 chars) | `{ ok: true, message, commit, pushed, committed[], drafts[] }` | 409 no remote under a durable workspace / `NOWHERE_TO_PUBLISH` (`publish.rs:201`), 415, 500 `{ ok: false, error, reason?, detail? }` | :1079–1117 | :12259 |

Save rules Studio follows (from `save_document` and `fields_from_json` :3965):
- Send back **the whole `fields` object received**, changing only `title`, `date`, `tags`, `cover`,
  `coverAlt`, `draft`. A key set to `null` (or left out) is removed; empty strings and lists are
  dropped by `compose`. Never send `credits`, `creditEtag`, `captureId` or `trackToken`: their absence
  leaves the credit sidecar and tracks untouched (`requested_credit_edit`).
- Save draft: `draft: "true"`. Publish: `draft: null`; `date` = the chosen instant, else the post's
  existing past date, else now (same rule as old Admin `collect`, admin.js :26124). Future date →
  the server reports `status: "scheduled"`. A date she did not touch is sent back **as received**
  (`2026-04-09` stays a date, not a UTC instant).
- New files are named `posts/<date>-<slug of title>.md` once, at creation (:16714); later title edits
  do not rename the file (renaming is out of scope).
- After every save the server may auto-publish in a background thread (`auto_publish` :326, called at
  :17016) when `publish.auto` is on. So: if `GET publish` says `auto: true`, Studio does **not** call
  `POST publish`; it says "Your readers will see it in about a minute" and More shows "sent
  automatically". If `repo && remote` and not auto, Publish calls `POST publish` and reports
  `pushed`/`commit`/`message` as they came. If `repo` is false, or there is no remote, the status says
  the post is saved on this server only (and with `filesMayVanish`, the `NOWHERE_TO_PUBLISH` sentence).
- `POST publish` commits **every** pending non-draft change in the site, not just this post; More
  lists `committed` so Mikey sees exactly what went out.

### Blocker: front matter is rewritten on every save (verified)
`save_document` rebuilds the file with `frontmatter::compose` (:16809, `frontmatter.rs:597`): known
keys first in `KEY_ORDER`, the rest alphabetical, inline lists as block lists, `true` quoted, empty
values (`cover: ""`) dropped. Changing one word in `posts/2026-04-09-pappys-meatloaf.md` produced a
diff on 9 front-matter lines. Values survive, so Mikey's fields are safe, but finish-line check 3
("differs only in that word") **cannot pass** with the route as it is. The brief requires that this
come back here. Proposal for the stakeholder: an opt-in body key `"layout": "keep"` on `PUT document`
that makes the server patch the original front-matter text in place (change only the lines of keys
whose value changed, append new keys, delete removed ones). That logic goes in a new
`frontmatter::splice(original, fields, body)` in `openblog-core`, with unit tests. Old Admin does not
send the key, so its behaviour stays the same. Until that is agreed, check 3 runs on a file already in
canonical `compose` form, and the gap is written in the report.

## 2. Files (web/studio/)

| File | Responsibility |
| --- | --- |
| `index.html` | The one page: `<link>` `zubra/theme.css` then `studio.css`, `<script type="module" src="/admin/studio/studio.js">`, `<toast-region>`, a `<main>` mount point; absolute URLs only |
| `studio.css` | Tokens (light/dark via `prefers-color-scheme`), the bridge to Zubra's variables, `html { font-size: 112.5% }` (18 px), layout classes |
| `studio.js` | Start-up: `GET session` → sign-in or shell; builds the router; registers command-palette items |
| `api.js` | The only `fetch`: CSRF header, JSON in and out, `ApiError { status, message, data }`; a 401 pauses the call, asks the shell to sign in again, then retries it once with the new token |
| `router.js` | `#/`, `#/posts`, `#/write`, `#/write/<path>` → screens; the leave guard (`isDirty()` + `beforeunload`); keeps the requested hash across sign-in |
| `shell.js` | The frame: `nav-bar` (Home, Posts), account `dropdown-menu` (who, Sign out, Open the old Admin), `command-palette`, toasts via `document.dispatchEvent(new CustomEvent("toast", …))`, sign-in-again dialog |
| `zubra.js` | `use(...names)`: `import()` of `zubra/cdn/<name>.js` on demand, so each screen loads only what it needs |
| `screens/signin.js` | Username + password form; on success returns to the requested address |
| `screens/home.js` | "What would you like to do?": Write something new; Keep going (3 newest drafts); Recently published (3) |
| `screens/posts.js` | Every post, find by title, filter by status, empty state; a row opens Write |
| `screens/write.js` | The form, save / publish / schedule / update, autosave, conflict and More (path, slug, words, live link, old Admin link, last publish result) |
| `parts/post-list.js` | A list of posts as links (title, date in words, status badge); used by Home and Posts |
| `parts/cover-picker.js` | Cover: choose from `GET images` in a `modal-dialog`, or add with `file-drop` → `POST upload`; "Describe the picture" |
| `parts/dialogs.js` | Shared `modal-dialog` prompts: leave with unsaved work, conflict, sign in again |
| `parts/dates.js` | DOM-free: "Friday, November 27 at 8 AM"; date + time fields ↔ the instant to send |
| `parts/post-fields.js` | DOM-free: merge Studio's keys into received `fields`; the draft/publish/schedule rule; status words |
| `parts/kept.js` | DOM-free over a `Storage`: edits kept in the browser for published posts, keyed by user + path + etag |
| `parts/search.js` | DOM-free: title search and status filter for the posts list and palette |
| `zubra/…` | Vendored, never edited (§4) |

`write.js` is the only screen at risk of passing 400 lines; cover, dialogs and field logic are split
out from the start. Pure modules live in `parts/` and import nothing from the DOM, so
`tests/web/studio-*.test.mjs` imports them directly.

## 3. Zubra UI components

All are light-DOM custom elements (no shadow root). Styles come from constructed stylesheets, which the CSP allows.
None set `style` attributes (CSSOM `style.setProperty`/`.left` only), except `nav-bar` (see below).
"Form" means the native control inside the element submits with an enclosing `<form>`;
"FA" means `static formAssociated` with `ElementInternals`.

| Component | Studio uses | Form | Gap → fix |
| --- | --- | --- | --- |
| `text-field` | `label`, `value` (two-way) / `valuechange`, `type` (`text`, `password`, `time`, `search`), `rows` (the words), `required`, `autocomplete` (`username`, `current-password`), `description`, `error` (server problems) | native input/textarea | none; `type="time"` stands in for the missing time field |
| `date-field` | `label`, `value` "YYYY-MM-DD" / `valuechange`, `description` | native | no `error`/`aria-invalid`: Studio puts a date+time error on the time `text-field`. zubra-ui: add `error` like text-field |
| `tag-input` | `value` (array) / `valuechange`, `suggestions` (`meta.tags`), `label`, `max` (set 20; default 6) | FA | label is `aria-label` only, not shown; × targets are small (under 44 px). **zubra-ui fix**: a visible `<label>`, larger remove buttons. Until then Studio puts a visible caption, the same text, above it |
| `file-drop` | `label`, `hint`, `accept="image/*"`, `multiple={false}`, `max-size` = `capture.maxPhotoBytes`/MiB / `fileschange` | native | none |
| `action-button` | `variant`, `type`, `loading`, `disabled`, `href` (old Admin link) | native button | `md` is 2.5rem: 45 px at Studio's 18 px root, so OK; never use `sm` |
| `toast-region` | the `toast` document event: `message`, `variant`, `duration`, `action: { label, href }` | — | none |
| `command-palette` | `items` `[{ id, label, group, hint, href }]`, `select` (id), `open` | — | none; post items use `href: "#/write/<path>"`, actions use `select` |
| `nav-bar` | `brand`, `href`, `links` `[{ label, href, current }]`, `actions` slot | — | **CSP break**: its markup has `<nav style="display: contents">`, which `style-src 'self'` blocks. **zubra-ui fix before vendoring**: move it to the stylesheet (`.navbar > nav { display: contents }`) |
| `dropdown-menu` | `label`, `items` `[{ value, label }]`, `itemselect` | — | imports `zubra/runtime/primitives.js` (vendored) |
| `modal-dialog` | `open` (two-way), `label`, `heading`/`actions` slots, `[data-close]` | — | none |
| `side-sheet` | Write's More: `open`, `side="right"` (bottom at 400 px), `label` | — | none |
| `sidebar-layout` | Write on desktop: form + details column (`side`, `content-min`) | — | none (custom properties set by script) |
| `status-badge` | `variant` (neutral = Draft, warning = Scheduled, success = Published), text | — | none |
| `empty-state` | `heading`, default + `actions` slots | — | none |
| `segmented-control` | Posts filter: `options`, `value`, `label`, `valuechange` | — | none |
| `alert-banner` | Inline problems (save refused, conflict, publish failed) | — | none |
| `content-card` | Home cards: `heading`, `href`, picture slot | — | none |
| `loading-spinner` | First load and long waits, `label` | — | none |

Not used: `signin-block` (email-only with `type="email"` rejects usernames like `grammi`, and its
"keep me signed in" switch means nothing here; sign-in is a `<form>` of two `text-field`s and an
`action-button`; a `username` mode in zubra-ui is an option later). `data-table` (it scrolls sideways
at 400 px; a list is better), `breadcrumb-trail`, `check-box`, `choice-cards`, `popover-panel`,
`radio-group`, `select-field`, `skeleton-block`, `stat-card`, `step-indicator`, `tab-list`,
`toggle-switch`, `tool-tip`, `user-avatar`: drop them from `components.json` until a slice needs
them.

## 4. Serving Studio

Already in the working tree: `route` returns `studio_file(path)` for `/admin/studio[/…]` (admin.rs
:590, :664), after the read-only check. So it is GET/HEAD only, needs no session (static files),
and passes through `secured` :687 (CSP, `X-Frame-Options`, `no-store`). `studio_files.rs` (generated)
holds `STUDIO_FILES: &[(&str, &[u8])]` with `include_bytes!`. `site::web_dir_assets` skips `studio/`
(site.rs:1055), so Studio never reaches the public site. Changes to make:
1. **Mirror `site::admin_file`** (site.rs:1037: the site's `<paths.web>/admin/<rel>` overrides
   `EMBEDDED_ADMIN`). Add `site::studio_file(root, config, rel)`: look `rel` up in `STUDIO_FILES`
   first (an unknown name is 404, so a path can never escape), then prefer
   `<paths.web>/studio/<rel>` on disk if present. `admin::studio_file` calls it.
2. `/admin/studio` (no slash) → **308** to `/admin/studio/`, so relative URLs cannot resolve under `/admin/`.
3. Caching: `secured` only adds headers that are missing (`header_default`), so `studio_file` sets
   `Cache-Control: no-cache` and `ETag` (FNV hash of the bytes, `etag_bytes` :3882) and answers
   `If-None-Match` with **304**. Keep `no-store` for `index.html`.
4. `index.html` gets `X-Content-Type-Options: nosniff` (already global) and nothing inline.

Vendoring: `web/studio/zubra/components.json` lists names + `source.commit`;
`node scripts/vendor-zubra-ui.mjs <zubra-ui>` builds zubra-ui, copies `dist/cdn/<name>.js`, follows
relative imports (brings `runtime/primitives.js`), copies `dist/themes/default.css` → `theme.css` and
`LICENSE`, and records the commit. Then `node scripts/studio-files.mjs` rewrites `studio_files.rs`
(skips `*.md` and `zubra/LICENSE`); `--check` exits 1 when out of date. Order for this slice: fix
`nav-bar` (and ideally `tag-input`) in zubra-ui, prune `components.json`, re-vendor, regenerate.
Theme note: `theme.css` switches dark mode by a `.dark` class, not a media query, so `studio.css`
sets the bridge variables under `@media (prefers-color-scheme: dark)` itself.

## 5. Risks and cover

| Risk | Cover |
| --- | --- |
| CSP (`script-src 'self'`, `style-src 'self'`) | No inline script, `style` attribute or `on*` attribute; styles go through classes, `setProperty` and Zubra's sheets. The `nav-bar` fix comes before vendoring. The browser suite fails on any `securitypolicyviolation` event or CSP console error |
| Untrusted text (titles, tags, file names, server `error`/`problems`/`message`) | `textContent` or element properties only; `innerHTML` is banned in Studio (a node test greps `web/studio/*.js`, not `zubra/`). Zubra binds text as text. Image `name` goes into `alt`/label text, `url` must start with `/images/uploads/` |
| CSRF | The cookie is `SameSite=Strict`, `Path=/admin` (so it covers `/admin/studio/`), and the server checks token + Origin. `api.js` sends `X-CSRF-Token` on every non-GET; the token is replaced after sign-in again |
| Unsaved edits | Drafts: autosave `PUT` 3 s after typing stops. The first `POST` waits until the title field is left with ≥ 3 characters, because the title names the file for good. Published posts: kept in `localStorage` (via `parts/kept.js`) on each change, offered back on reload, cleared after Update. Leave guard on route change and `beforeunload`. The Save state is announced in a live region |
| Conflict (409) | A 409 on PUT can mean a stale etag or a busy lock. `write.js` re-reads `GET document`: a changed etag means a conflict dialog ("This post was changed somewhere else. Your words are kept.") with Keep mine (re-PUT with the new etag) or See the other version (her text stays kept and copyable). Same etag means retry once, then a plain error. A 409 on POST (name taken) says so and offers to change the title |
| Losing front-matter fields | Send back the full received `fields`. Values are kept (verified), the layout is not: §1 blocker. `raw` documents open read-only with "This post can only be fixed in the old Admin" |
| Session expiry | Any 401 → `api.js` holds the call, the shell opens the sign-in dialog over the screen (her words stay in memory and in `kept`). After login the call is retried once with the new CSRF token, so the save completes. A different user signing in drops the kept edits (as the old Admin does, admin.js :11591) |
| Performance: ~18 elements, 700 KB unminified JS (98 KB gzip), served with `no-store` and no compression | `zubra.js` loads on demand (the sign-in screen needs 2 elements, the shell 5, Write 9 more). ETag/304 per §4.3. Bundling or gzip is a later decision |
| Publish truth | Results are shown as they came: `pushed:false` → "Saved and recorded, but not sent out yet"; `auto` mode never double-publishes; `committed` is listed in More |
| Accessibility gaps in components | `tag-input` label and targets, `date-field` error (§3), all tracked as zubra-ui issues. axe runs on every screen |

## 6. Test plan

**Node** (`node --test tests/web/studio-*.test.mjs`, the CI job runs `tests/web/*.test.mjs`):
- `studio-dates.test.mjs`: words for dates (today, other years, midnight, DST), date + time → ISO, an
  untouched date round-trips unchanged.
- `studio-post-fields.test.mjs`: unknown keys kept exactly; draft/publish/schedule rule; `null`
  removes; tags trimmed and de-duplicated; never adds `credits`.
- `studio-kept.test.mjs` (with a fake `Storage`): keyed by user + path, cleared on Update, a
  different user sees nothing.
- `studio-search.test.mjs`; `studio-router.test.mjs` (hash parsing, the `next` address after sign-in).
- `studio-files.test.mjs`: `node scripts/studio-files.mjs --check` exits 0; no `innerHTML`,
  `style=`/`.setAttribute("style"` or `<script>` text in Studio's own files; `components.json` has a commit.

**Browser** (`tests/browser/studio-*.spec.mjs`; config `tests/browser/playwright.config.mjs`: chromium,
headless, `workers: 1`, 60 s). Start the server as `admin-route-race.spec.mjs` :72–92 does:
`mkdtempSync`, `openblog init <root> --no-voice` (or copy the fixture), `openblog user add <name>
--root <root>` with `OPENBLOG_PASSWORD`, a free port from `net.createServer().listen(0)`, spawn
`target/debug/openblog serve --admin --root <root> --port <p>`, poll until `/admin/studio/` is OK,
kill it in `afterAll`, `removeTree`. Fixture: `tests/fixtures/studio-site/` with a recipe post
carrying `profile`, `series`, `course`, `servings`, `subtitle` (in canonical form until §1 is decided).
axe: `page.evaluate(axeSource)` as `quote-form.spec.mjs` :181 does, so the CSP stays on. Specs:
`studio-signin` (bad password message, 429 text, return to the requested hash, sign out),
`studio-grammi` (check 1 at 400 px with screenshots), `studio-mikey` (check 2, keyboard only, palette),
`studio-roundtrip` (check 3: byte diff of the file), `studio-conflict` (check 4: write the file during
editing), `studio-session` (check 5: delete the session by restarting the server or with
`context.clearCookies()` before Update), `studio-a11y` (axe on sign-in/Home/Posts/Write in light and
dark, 320 px with no `scrollWidth > clientWidth`, `reducedMotion: "reduce"`), and a CSP listener in
every spec. Upload uses `setInputFiles` on `file-drop`'s input with a small PNG.

**Rust** (`crates/openblog-cli/src/admin/tests/studio_routes.rs`, registered in `mod tests` admin.rs
:18905, using the existing `fixture`/`req`/`login_ok` helpers):
`/admin/studio/` serves `index.html` with CSP and `no-store`; `/admin/studio` → 308; every
`STUDIO_FILES` entry has the right `Content-Type`; unknown and `../` paths → 404; POST → 405;
ETag + `If-None-Match` → 304; a site's `web/studio/x.js` override wins only for listed names;
`STUDIO_FILES` equals a walk of `web/studio/` (minus `*.md`, LICENSE); Studio is 404 without
`--admin`. If `"layout": "keep"` is agreed: `PUT document` splice tests (one changed word → one line
diff; key removed; key added; inline list kept) plus `frontmatter::splice` unit tests in
`openblog-core`.
