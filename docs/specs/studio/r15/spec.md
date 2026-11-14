# R15: the switch (`/admin/` opens Studio, `web/admin/` goes)

By `studio-architect` (with `studio-ux`), 2026-11-14. Sources: `studio-architecture`, `studio-ux`,
`retirement-plan.md` (§1 H, §1 I, §2, §3 Switch, §4 R15, Decided), every slice spec (`r1`–`r11`
(R11 and R12 share `r11/ux.md`), `r13`, `r14`, `onboarding/ux.md`, `words/spec.md`),
`crates/openblog-cli/src/{admin.rs, site.rs, serve.rs, studio_files.rs, workspace.rs,
admin_preferences.rs, admin/push.rs, admin/trade_checklist.rs}`, `web/admin/`, `web/studio/`
(`router.js`, `sw.js`, `shell.js`, `screens/{tools,not-yet,cards,business}.js`), `tests/web`,
`tests/browser`, `scripts/deployment-smoke.mjs`, `docs/`, `CHANGELOG.md`.

**The job, in her words:** "I open my blog the way I always do." The same address, icon, bookmark
and notification all open Studio. She learns nothing new, and nothing she made is lost.
**Mikey's job:** one release that removes 33 files and their server code, can be rolled back by a
revert, and leaves no address that 404s.

## Decisions the owner should check (⚑)

1. ⚑ **The 302 drops the query and keeps the fragment.** `GET|HEAD /admin` and `/admin/` (with any
   query) answer `302 Location: /admin/studio/`. The old Admin never read a query, and Studio's kept
   copy only matches a query-less address (`worker-rules` `keeps`), so keeping it would stop
   Studio opening with no signal. The fragment never reaches the server. Browsers carry it across a
   redirect whose `Location` has none, so `legacyRoute` maps it. Use 302, never 301/308, so no
   browser caches the redirect and a rollback works at once. `secured()` already adds `no-store`.
2. ⚑ **The worker gives the same answer when there is no signal** (client, `sw.js`). A navigation
   to exactly `/admin` or `/admin/` is answered by the worker with `Response.redirect("/admin/studio/", 302)`.
   An iPhone app installed before R3 still starts at `/admin/`, because iOS never re-reads the
   manifest. Today that icon fails with no signal. After R15 it opens Studio from the kept copy. The
   Chrome static route "not Studio → network" gets an earlier rule that sends `/admin` and `/admin/`
   navigations to the worker (`source: "fetch-event"`).
3. ⚑ **Five of Decided 2's nine routes stay.** `engagement/feedback/publish-decision` stays
   (R10 ⚑ 13: the old inbox did call it, and Readers uses it). `collaboration/approve`,
   `approve/withdraw`, `schedule` and `publish` stay (R14 ⚑ 1 / G118: without them nothing written
   together can be published). R15 deletes `reading-paths/reorder`, `decorations/preview`,
   `voice/catalog` and Personalize (`GET|PUT preferences`). `document/rename` is already gone; a
   test confirms it. **R15 does not start until both reversals are written under "Decided" in
   `retirement-plan.md`.**
4. ⚑ **Unsaved Front page and Look edits from the old Admin are brought back once.** No slice owns
   these copies: `localStorage` `ob-landing-draft:<user>` and `ob-look-draft:<user>`, written by
   `createDraftStore`, which `landing-rules.js` already has. When one exists and differs from what
   is saved, Front page and Look show `alert-banner info`. Studio has no `ob-*` key that is safe to
   remove, so these two are the only ones R15 reads (§Local data).
5. ⚑ **More tools and the not-yet screen are deleted.** They are not replaced by anything. Every
   screen they reached has its own entry in navigation, the account menu or Find (Business facts on
   a non-trade site is reached through Find and the account menu).
6. ⚑ **Override files under `<paths.web>/admin/` stop being read** (Decided 3). The exception is
   `admin/icons/`. Build still skips `admin/` in `web_dir_assets`, so a stale override folder is
   never published.

## Preconditions (all must hold before the R15 branch is cut)

**Slices done.** "Done" means merged with a CHANGELOG entry, the slice's ports and new tests green,
`studio-ux` checklist passed, its blocking gaps closed, and its "After Rn nothing … opens the old
Admin" sentence true:
R0, R1, R2, R3 (G20–G27), R4 (G28–G35), R5, R6, R7, R8 (CSP change of ⚑ 2 shipped), R9 (G64
carry-over read in place), R10 (G86 notice addresses, `useModerationInbox` wording), R11, R12 (from
`r11/ux.md`), R13, R14a and R14b (G110–G120, G119 invitation links), onboarding (G71), words
(catalog, `say()`, every touched screen migrated).

**Mechanical gates** (a script in the PR description runs them; each must print nothing):

| Gate | Check |
|---|---|
| Nothing waits for Studio | `router.js` has no `NOT_YET` entries; `TOGETHER_NOT_YET` and any other `*_NOT_YET` are empty; `not-yet.js` `NAMES` is empty |
| No Studio links to the old Admin | `grep -rnE "/admin/(#\|\"\|'\|\`)" web/studio` matches only `sw.js` / `parts/notification-rules.js` (`studioAddress`, kept forever for queued notices), `parts/push-here.js` (`WORKER`, `SCOPE`), `index.html` (manifest, icons). `shell.js` "Open the old Admin", `tools.js`, `not-yet.js`, `cards.js:298` and `business.js:150` are R15's own removals (see below) and are the only other hits allowed |
| No imports from the old Admin | nothing in `web/studio` names `/admin/*.js` or `web/admin` except provenance comments |
| Tests | the only `tests/web/admin-*.test.mjs` left are R15's delete list (§Tests); no browser spec opens `/admin/` or `/admin/#…` except R15's delete list and the specs R15 rewrites |
| Server | CSP has no `'wasm-unsafe-eval'` and no `codepen.io` (R8). `invitation_link` gives `/admin/studio/#/together/join/…` (G119). Netlify `engagement.mjs`, `quote.mjs` and `push.mjs` only send `/admin/studio/#/…` |
| Parity | every row of `retirement-plan.md` §1 is **covered** or **drop**, with no **partial** or **missing** left |

## The switch

### Server (G121, G122)

- **G121. `/admin` and `/admin/` redirect.** In `admin.rs route()`, before the file table:
  read-only `"/admin" | "/admin/"` → `Response::new(302, …)` with `Location: /admin/studio/` and an
  empty body. It goes through `secured()` (CSP, `X-Frame-Options`, `Referrer-Policy`, `no-store`).
  A non-read method stays 405. With `--admin` off it stays 404 (`serve.rs` sends `/admin*` to
  `admin::handle`).
- **G122. Old Admin serving removed.** Delete the 33-row `match` (`admin.rs:672–705`) and the
  `site::admin_file` call. Delete `site::admin_file` and `EMBEDDED_ADMIN` (`site.rs:311–`). Every
  other `/admin/<x>` answers 404 as now. These stay unchanged: `/admin/studio/*` (`studio_file`,
  `release.js`), `/admin/sw.js` (`studio_bytes("sw.js")` + release line, `no-cache`),
  `/admin/manifest.webmanifest` (`push::manifest`; `id` `/admin/`, `start_url` `/admin/studio/` and
  `scope` `/admin/` are already right since R3), `/admin/icons/*` (`site::admin_icon`, override
  kept), and `CODE_RUNNER_LANGUAGE_PATH`. Keep the `admin/` skip in `site::web_dir_assets`.
- Sign-in, session, logout, CSRF and the cookie (`Path=/admin`) are not touched. Studio already
  uses them.

### Routes and code removed (G123)

- **G123. Callerless routes and Personalize.** Remove the dispatch arms and handlers of
  `POST reading-paths/reorder` (+`reading_paths::reorder`), `POST decorations/preview`
  (+ its body-limit arm, `admin.rs:560`, and `decorations::preview_decorations`), `GET voice/catalog`
  (+`voice::catalog`), and `GET|PUT preferences` (+`admin_preferences`, `save_admin_preferences`).
  Shrink `admin_preferences.rs` to one read-only function, `voice_invitation_dismissed(root, user)`,
  so R9 G64's carry-over keeps working. Delete `Preferences`, `save`, `SaveError` and
  `MAX_REQUEST_BYTES`. Files under `.openblog/private/admin-preferences/` stay on disk and in
  workspace backups (`workspace.rs:302, 385` unchanged). Nothing on the server is deleted from the
  owner's data. Each removed route then answers the same 404 as any unknown route; a test lists all
  five plus `document/rename`.
- **G124. Checklist addresses are Studio's.** `trade_checklist.rs steps()` emits `#/new-job`
  (was `#/capture`) and `#/write/<path>` (was `#/edit/<path>`). `stepHref` and `legacyRoute`
  still accept the old forms, because a cached `GET trade-checklist` reply may hold them.
  Not blocking.
- **Kept on purpose:** `publish-decision` and the four collaboration routes (⚑ 3), and every
  `/admin/api/*` route that Studio calls.

### Client

- Delete `web/admin/`, all 33 files (`admin.js`, `admin.css`, `index.html`, and the 30 modules
  listed in §1 I; `sw.js`, `icons/` and `notifications.js` already left in R3). This also removes the
  bridges **G25** (`#/notifications`, and an empty-hash standalone launch → Studio) and **G28**
  (`#/capture` → New job), together with `studioBridge`. Their behaviour is now G121 + `legacyRoute`:
  `#/notifications?sheet=home-screen` stays Studio's own, `#/capture?x` → `#/new-job?x`, and an
  empty hash → Home.
- Delete `screens/tools.js` and `screens/not-yet.js` and their rows in `screens/index.js`. Also
  delete the account-menu item **More tools** (`shell.js:35, 104`), the palette item
  **Open the old Admin** (`shell.js:141`) and the details links `cards.js:298` and
  `business.js:150`, whose details already show everything. Their word ids are reported "no longer
  used" by `scripts/studio-words.mjs`, never reused.
- `router.js`: delete `NOT_YET` and its branch. Add `tools` → `#/`. Map `not-yet/<name>` through
  `legacyRoute("#/<name>")`, falling back to `#/`, so a bookmarked not-yet page lands on the screen
  that replaced it. **`legacyRoute` is kept forever.** Bookmarks, notices queued on other devices
  and old invitation links need it.
- `sw.js` (⚑ 2): add `adminRedirect(url, mode)` to `parts/worker-rules.js` (pure, tested), used in
  `fetch` and by the static-route rule. `studioAddress` stays as it is.
- Front page and Look (⚑ 4): on `load()`, `createDraftStore("ob-landing-draft:<user>")` or
  `createDraftStore("ob-look-draft:<user>")`. If the copy differs from the saved page, show
  `alert-banner info` with `restore.oldHeading` "Bring back changes you didn't save?" and
  `restore.oldText` "They were kept on this {device} before your blog's screens changed."
  The buttons are **Bring them back** (puts them in the form as unsaved work, so the leave-guard
  covers them) and **Throw them away** (asks once). Either button removes that one key. In details
  the key name and its date are shown.

## Every old address still works

The browser keeps the fragment and Studio maps it. One table, enforced by the coverage test below:

| Arrives as | Lands on |
|---|---|
| `/admin`, `/admin/`, `/admin/?anything` | `/admin/studio/` → Home |
| `/admin/#/<old>` (bookmark, history, typed) | `/admin/studio/#/<old>` → `legacyRoute` → its screen, and `replaceState` fixes the address bar |
| Installed app from before R3 (iPhone `start_url` `/admin/`) | the same → Home. With no signal, the worker answers (⚑ 2) and Studio opens from the kept copy |
| Installed app from R3 on | `start_url` `/admin/studio/`, unchanged |
| A notice already delivered or queued with `/admin/#/moderation…`, `#/feedback…`, `#/quotes`, `#/notifications` | on tap, the worker's `studioAddress` (R3 G24) gives `/admin/studio/#…`, then `legacyRoute`. If the notice was opened outside the worker, G121 then `legacyRoute` |
| An invitation link from before G119, `/admin/#/shared/accept/<t>` | G121, then `legacyRoute`, then Join. `joinToken` strips the token before the first request (R14) |
| R1 checklist replies cached with `#/capture`, `#/edit/<p>` | `legacyRoute` (and G124 for new replies) |
| A Studio tab open on an old address | already Studio's. Nothing changes |
| An old Admin tab left open across the deploy | its API calls work. Its next lazy `import("/admin/<x>.js")` gets 404 and it shows its own fatal message, and a reload lands in Studio. Unsaved work in that tab is saved by its own Save (API unchanged). The release note says to reload |

### The `legacyRoute` coverage test (`tests/web/studio-legacy-routes.test.mjs`)

- **Fixture written before deleting `admin.js`**, in R15's first commit:
  `tests/web/fixtures/old-admin-addresses.json`. It holds every old hash, generated from the old
  dispatch (`admin.js:12350–12381`), `canonicalAdminHash`, `RESEARCH_PANELS` (ids and `legacy`
  names), `KINDS`, and every query the old Admin read. Each entry gives the expected Studio
  address. At minimum it covers:
  - `#/`, `#`, empty, `#/overview?focus=x`
  - `#/posts|pages|series?status=draft|scheduled|published`, and an unknown head (old Admin: posts list; now Home)
  - `#/new/posts|pages|series|recipe`
  - `#/edit/<post|page|series|service|proof path>`, with each `?pane=` of `write preview settings social optimize accessibility release field evidence assistant`
  - `#/analytics[/7|30|90|365]`
  - `#/moderation[/pending|clarification|approved|rejected|removed|withdrawn][?kind=…]`, `#/feedback[…]`
  - `#/contributors`
  - `#/voice[/session|library|…][?…]`
  - `#/social[/…]`, `#/announcements`
  - `#/quotes`, `#/greetings`, `#/notifications[?sheet=home-screen]`, `#/capture[/x][?q]`
  - `#/landing`, `#/look`, `#/appearance`, `#/business`, `#/seasons`, `#/design`, `#/reminders`, `#/distribution[?…]`
  - `#/services[/new|/edit/<p>]`, `#/reviews[…]`, `#/share/<path>`
  - `#/paths[/new|/edit/<slug>]`, `#/comparisons[/new|/edit/<slug>]`
  - `#/research[/overview|sources[/<id>]|notebook|atlas[/<id>|/relationships/<id>]|compare[/<id>]|public|<unknown>]`, `#/sources[/<id>]`, `#/atlas[/…]`, `#/compare[/<id>]`
  - `#/shared[/new|/accept/<t>|/<x>]`, `#/tools`, `#/not-yet/<each old name>`
  - mangled `%` encodings
- **Assertions:**
  - `legacyRoute(old)` equals the fixture.
  - The route name of every result is in `screens/index.js` (read as text) and is never `not-yet`.
  - Applying it twice changes nothing: `legacyRoute(result)` is `null`.
  - No result keeps an invitation token.
  - Every notice URL ever sent is in a second list (`engagement.mjs` v0.33 → today, `quote.mjs`, `push.mjs`, `invitation_link` before G119). Each goes through `studioAddress` and then `legacyRoute`, and lands on its screen.
- A browser case (`studio-switch.spec.mjs`) runs one address from each row of the table above
  against a real `openblog serve --admin`.

## Local data on her phone and computer

| Kept by the old Admin | After R15 |
|---|---|
| IndexedDB `openblog-capture` v1 | unchanged forever (ADR 0297). Studio sends what is waiting |
| `ob-voice-draft:<user>`, `ob-voice-polished:<user>`, `ob-voice-session`, `ob-voice-library` | R9 reads and writes the same keys |
| `ob-admin-synthesis-prompts-dismissed` | read once by R14b |
| `ob-landing-draft:<user>`, `ob-look-draft:<user>` | brought back once (⚑ 4), then that key is removed |
| `ob-admin-scheme`, `ob-scheme`, `ob-admin-editor-mode`, `ob-admin-preview-width`, `ob-landing-tour:<user>` | **left alone, harmless.** Nothing reads them. Studio never clears storage it didn't write; `ob-scheme` may also be the public site's |
| Push sign-ups | same worker URL and scope. Untouched |

## Tests

**Delete (old chrome; each case first checked for a Studio counterpart, and any case missing one is ported in this PR):**
- `tests/web/admin-command-palette`, `admin-editor-status`, `admin-preferences`, `admin-workspace`,
  `admin-overview`, `admin-appearance`, `admin-lasting`, `admin-markdown-edit`,
  `admin-studio-bridge` (G25/G28), `admin-greetings`, `admin-quotes`, `admin-seasons` (their
  screens were dropped in §1 I; Cards, Quotes and Decorations have their own tests),
  `admin-input-scan`.
- `tests/browser/admin-route-race.spec.mjs`, `simple-workspace.spec.mjs`, and the helper
  `tests/browser/guided.mjs` (Personalize presets), once no spec imports it (the voice specs drop
  it in R9).
- Cases: `studio-new-job.spec.mjs:676` (old and new tabs together; R4's job is done),
  `studio-notifications.spec.mjs:416–424` (G25), and the `admin.js` "keyboard operable, never
  drag-only" source check (R13, replaced by its browser test).
- Rust: preference route tests (`admin.rs:26277–26445`). Remove `"preferences"` from the route
  lists at `admin.rs:23090, 23506`. Delete `admin.rs:36947` (the old page linked the site's CSS).

**Rewrite:**
- `tests/web/studio-input-scan-rules.test.mjs`: scan `web/studio/` (`.js`, `.html`, leaving out
  `zubra/`) instead of `web/admin/`. This is ADR 0263's guard. Any finding is fixed in Studio, not
  allowed.
- `studio-capture-queue`, `studio-job-sender`, `studio-capture-assistant-rules`: drop
  `import * as old`. Their old-module facts become a frozen fixture,
  `tests/web/fixtures/old-admin-capture.json` (constants and a record written by the old
  `makeRecord`), generated in commit 1 while the module still exists.
- `social-release-gates.test.mjs:197`: use `web/studio/parts/social-rules.js` and
  `announcements-rules.js`.
- `studio-landing-rules.test.mjs:382`: change the hint to name its own file.
- `studio-notifications.spec.mjs`: `/admin/#/notifications?sheet=home-screen` → 302 → the sheet
  opens. `studio-new-job.spec.mjs:762`: `/admin/#/capture` → New job, through G121.
- Rust:
  - `admin.rs:33726`: CSP on `GET /admin/studio/`, and the 302 carries it too.
  - `admin.rs:36880` becomes `admin_redirects_to_studio`: `/admin` and `/admin/?x=1` give 302 with `Location: /admin/studio/`; HEAD likewise; POST gives 405.
  - `admin.rs:35329` (404 when off) is kept.
  - `push_routes.rs:382–386`: only Studio's page links the manifest.
  - `workspace.rs:1971–2003`: write the preferences file directly, not through the API.
- `scripts/deployment-smoke.mjs:55–64`: `/admin` and `/admin/` expect 302 to `/admin/studio/`;
  `/admin/studio/` 200 HTML; `/admin/sw.js` 200 JS; `/admin/manifest.webmanifest` 200;
  `/admin/admin.js` and `/admin/admin.css` 404.

**New:**
- `studio-legacy-routes.test.mjs` (above).
- `worker-rules` `adminRedirect`: only navigations, only `/admin` and `/admin/`, same origin.
- Rust:
  - `old_admin_files_are_gone`: every one of the 33 old paths gives 404, and so does `/admin/index.html`.
  - `removed_routes_answer_404`: the five removed routes and `document/rename`.
  - `kept_routes_still_answer`: `publish-decision` and the four collaboration routes.
  - `voice_invitation_carry_over_still_read` (G64).
  - `web_dir_admin_overrides_are_ignored_but_never_published`.
- Browser `studio-switch.spec.mjs`:
  - each address row
  - offline: a worker that is installed, `context.setOffline(true)`, then `/admin/` opens Studio Home
  - a Front page draft under `ob-landing-draft:<user>` is offered, brought back, and its key removed
  - axe on the restore banner

## Docs rewrite

- **`docs/admin.md`** becomes Studio's manual, at the same path because others link to it. Title:
  "Studio: running your blog". It has one chapter per screen, built from each slice's
  "`docs/admin.md` (R15 rewrite)" note:
  - Getting started (onboarding)
  - Home, Write (About this post R5, Add something R6, Before you publish R7, Writing helper R8)
  - Pages, Collections, Reading paths (R13)
  - Front page, Look, Describe a new look (R9), Decorations
  - Business, Services, Reviews, New job (R4), Quotes, Reminders
  - Sharing and Your accounts (R1/R2), Cards and Gifts
  - Readers and Visitors (R10)
  - People
  - Research (R11/R12, Readings side by side R13)
  - Writing together (R14)
  - Your writing voice (R9)
  - Notifications and the Home Screen (R3)
  - Running it for real, Security design (policy without `wasm-unsafe-eval`, no `web/admin`
    override)
  - **Old addresses**, the table above. This is the only place in `docs/` (outside ADRs and
    specs) where `/admin/#/` may appear. A docs check greps for it.
- **Fix old addresses and "Admin's/old Admin" screen names** in `docs/`:
  - `configuration`, `content`, `cross-posting`, `deploy` (also: override folder gone, the
    Railway smoke expects 302)
  - `faq`, `features`, `field-journal`, `gifts`, `greeting-cards`
  - `interpretation-comparisons`, `job-sharing`, `jobs`, `notifications`
  - `provider-capabilities`, `quote-requests`, `research-profile`, `reviews`, `seasonal-reminders`
  - `services`, `social-publishing`, `theme-components`, `themes`, `trades`
  - `video-production`, `webmention`, `docs/README`
  - `portability/{capability-matrix, portable-html-pipeline, native-html-no-javascript-audit}`
- Outside `docs/`:
  - root `README.md`
  - `CONTEXT.md`: "Admin" is the server and its API; "Studio" is its face; avoid "old Admin"
  - comments in `site.rs`, `crates/openblog-core/tests/{landing_starters,readiness_report}.rs` and `netlify/lib/social-mastodon.mjs`
- **ADR 0413** "The old Admin is retired; `/admin/` redirects to Studio". It records the 302, kept
  routes, the worker redirect, `legacyRoute` forever, `openblog-capture` forever, and overrides.
  ADRs 0001–0412 are not edited.
- **Skills:**
  - `studio-architecture`: "is being retired" → "was retired in R15". Drop "Studio never loads from `/admin/*.js`" (nothing is there). Add "`legacyRoute` is permanent" and "the worker answers `/admin/` navigations".
  - `studio-ux`: the last checklist line becomes "Every field the file holds is on her layer, in details, or left in the file with a written reason".
  - `retirement-plan.md` gets a closing status line. `parity-audit.md` gets a superseded line.

## Release note

**CHANGELOG (`[Unreleased]`):** "The old Admin is retired (Studio R15, ADR 0413).
- `/admin/` now opens Studio (302 to `/admin/studio/`), and every old `/admin/#/…` address,
  bookmark, notification and invitation link opens the matching Studio screen.
- `web/admin/` and its files are gone, and so are the routes `reading-paths/reorder`,
  `decorations/preview`, `voice/catalog` and `preferences` (Personalize workspace).
- Files under `<paths.web>/admin/` no longer replace Admin's, except `admin/icons/`.
- Installed apps, notification sign-ups, jobs waiting on a phone and writing-voice copies carry
  over, and unsaved Front page and Look changes from the old screens are offered back once.
- Reload any Admin tab that was open during the update."

**For the owner (Mikey), to pass on as he sees fit:** "Nothing to do. The icon, bookmarks and
notifications open the same screens as before. If a Front page or Look change you never saved
shows up, choose whether to bring it back." No her-layer word changes: Studio never says "Admin".

## Verification checklist

- [ ] Preconditions table: every gate prints nothing. ⚑ 3 is recorded as Decided.
- [ ] `cargo test`, `node --test tests/web/*.test.mjs tests/portability-contracts.test.mjs`, the
      Playwright suite, `node scripts/studio-files.mjs` and `node scripts/studio-words.mjs` report
      nothing to change.
- [ ] `grep -rn "web/admin" --exclude-dir={target,node_modules,.git} . | grep -v docs/adr | grep -v docs/specs`
      is empty. `ls web/admin` fails.
- [ ] `grep -rn "Grammi" web/` is empty (`greetings.js` "Love, Grammi" is gone, words spec).
- [ ] `curl -sI localhost:<port>/admin/` gives 302 with `Location: /admin/studio/`, CSP and `no-store`.
      `/admin/admin.js` gives 404. `/admin/sw.js` gives 200 and its first line is the release line.
- [ ] The binary is smaller by about the old Admin's size (`EMBEDDED_ADMIN` gone). The release
      notes give the number.
- [ ] `scripts/deployment-smoke.mjs` passes against a staging deploy.
- [ ] Real-phone checks (below) all pass on staging before production.

## Real-phone checks (staging, then production)

1. **iPhone, Home Screen app installed before R3** (old `start_url`): opens Studio Home, still signed in. Airplane mode, then open it: Studio opens from the kept copy (⚑ 2). Notifications show **On**.
2. **iPhone app installed after R3**: unchanged. Long-press shows **New job** on a trade site.
3. **Tap a notification sent before R10 (`/admin/#/moderation/pending`)**, both with the app closed and with it open: Readers, at the note.
4. **Safari bookmark `/admin/#/quotes`** and **`/admin/#/edit/posts/<x>.md`**: Quotes, and Write on that post. The address bar shows Studio's address.
5. **Old invitation link** in Messages: Join, with no token in the address or in history (Back does not show it).
6. **Two jobs waiting from the old Admin era** on the iPhone app and in Safari: both send. Nothing is lost.
7. **Android Chrome installed app**: opens Studio. Chrome may say the app was updated.
8. **Desktop with an old Admin tab open during the deploy**: reload lands in Studio. A Front page draft left there is offered back.
9. **Sign out and sign in again** from the app: the cookie path is unchanged. No second sign-in.

## Rollback plan

- Tag the last release before R15 (`pre-r15`). R15 ships as one PR in three commits:
  1. fixtures and test rewrites, green with `web/admin` still present
  2. switch and deletions
  3. docs
- **Rollback = revert commits 2 (and 3) and redeploy.** Nothing on disk, in IndexedDB, in
  `localStorage` or in push sign-ups was migrated or removed (preferences files stay; the two
  draft keys are removed only after she chooses), so the old Admin comes back with all its data.
  The 302 is never cached (302, `no-store`). The reverted `sw.js` has no `/admin/` redirect, and it
  replaces the R15 worker on the next navigation (`no-cache`, byte change, `skipWaiting`). At worst
  one navigation still lands in Studio, which is harmless.
- **Roll back if** any of these happens: sign-in fails, an installed app opens blank, a
  notification tap lands on the wrong screen, a waiting job is not sent, or `legacyRoute` lands an
  old address on Home when the table says otherwise.

## Follow-ups after retirement (not R15)

- **zubra-ui:** merge the `file-drop` branch (the `capture` attribute R4 needed) and the other
  Studio fixes into zubra-ui `main`:
  - `nav-bar` `style` attribute
  - `tag-input` label and targets
  - `date-field` `error`
  - `file-drop` `prompt`

  Then re-vendor from a `main` commit, so `components.json` `source.commit` names `main`, and
  check that the vendored diff is only the expected changes.
- **Railway integration the owner deferred:** not part of R15. When it's picked up, update
  `docs/deploy.md` "Railway: the editor and the hosted functions" and the Grammi's House `railway/`
  smoke to expect the 302, keep `.openblog` on the volume (onboarding note), and limit watch paths
  to `web/studio/` and `crates/`.
- `legacyRoute`, `studioAddress`, the `openblog-capture` database and the G64 carry-over read are
  permanent. They have no removal date.
- A later, optional release may stop sending `#/edit/…` from any remaining server text
  (`engagement.mjs` `useModerationInbox` sentences are R10's).

## Server gaps

| # | Change | Blocking |
|---|---|---|
| G121 | `/admin`, `/admin/` → 302 `/admin/studio/` (query dropped), through `secured()` | yes |
| G122 | Old Admin file table, `EMBEDDED_ADMIN`, `admin_file` and the `<paths.web>/admin/` override removed; manifest, icons (override kept), `sw.js` and Studio kept | yes |
| G123 | `reading-paths/reorder`, `decorations/preview`, `voice/catalog`, `preferences` removed; `admin_preferences.rs` reduced to the G64 read; `publish-decision` and four collaboration routes kept | yes |
| G124 | Checklist `href`s are Studio's (`#/new-job`, `#/write/<path>`) | no |
