# Retiring the old Admin (2026-11-13)

By `studio-architect`. The owner's decision: `web/admin/` and everything it serves goes. Studio
(`web/studio/`) does every job the old Admin did, redesigned around the job, not copied. This
replaces the "keep the rarely used tools in the old Admin" decision in `parity-audit.md`.

Sources: `web/admin/admin.js` route dispatch (l.12350–12381), `canonicalAdminHash` (l.301),
editor panes (l.22519), palette (l.12095), Advanced tools (l.11961), Personalize (l.12011); the
route table in `crates/openblog-cli/src/admin.rs` (l.593–1140); `web/studio/screens/index.js`, `tools.js`.

Status: **covered** (Studio screen named) · **partial** (what's missing) · **missing** · **drop** (why).

## 1. Inventory: the definition of done

### A. Shell and whole-Admin behaviour (`admin.js`)
| Old Admin | Does | API | Studio |
|---|---|---|---|
| Sign-in form | Username/password | `login` | covered: `screens/signin.js` |
| Session ended | Sign in again, work kept | `session` | covered: shell "Sign in again" dialog |
| Sign out | | `logout` | covered: account menu |
| `#/overview` | Quick create, publishing health, issues, inventory, recent posts | `status`, `documents`, `publish` | covered: Home |
| Overview: recipe notes | Site-wide recipe advice | `recipe-notes` | **missing** (R1, on Home) |
| Overview: ten-minute checklist | Trade-site setup steps | `trade-checklist` | **missing** (R1, on Home) |
| Overview: voice invitation | "Write a voice sample" nudge | `voice/status` | **missing** (R9) |
| Header publish box | Send out what's waiting | `publish` GET/POST, `rebuild` | covered: Home, `parts/publish.js` |
| Command palette (Ctrl K) | Every route + "Show <pane>" | — | covered: Find (`shell.js`); panes come with R5–R8 |
| Advanced tools dialog | Hidden tools of Simple preset | — | drop: Studio shows a screen when the site uses it; More tools disappears in R15 |
| Personalize workspace | Preset, density, default editor mode, module order | `preferences` GET/PUT | drop (Decide 1): Studio has one layout; delete routes and `admin_preferences.rs` |
| Admin light/dark button | Admin's own scheme | localStorage `ob-admin-scheme` | drop: Studio follows the system (`studio.css`) |
| Saved work may vanish | `filesMayVanish` notice | `status`, `publish` | covered: `parts/site-health.js` |
| Kept panels across the research workspace | Unsaved panels kept while moving | — | **missing** (R11; Studio's leave-guard covers single screens) |
| Installed app | Manifest, icons, service worker | `/admin/manifest.webmanifest`, `/admin/icons/*`, `/admin/sw.js` | **missing** (R3) |

### B. Lists and the post editor (`#/posts|pages|series`, `#/new/<kind>`, `#/new/recipe`, `#/edit/<path>[?pane=]`)
| Old Admin | Does | API | Studio |
|---|---|---|---|
| Lists with `?status=` | Posts, pages, series | `documents?kind=` | covered: Posts, Pages, Collections |
| New post / recipe / page / series | | `document` POST | covered: `#/write/new/*`, Pages, Collections |
| Write + Site preview panes | Words, photos, preview | `document`, `upload`, `images`, `preview` | covered: Write, page-edit |
| Delete and restore | | `document` DELETE, `document/restore` | covered (Undo) |
| Unreadable file | "Fix its front matter in a text editor" | `document` (`raw`) | partial: Studio says "open the old Admin", which can't open it either; say the server's reason (R0) |
| Settings pane: core | Title, date, tags, cover + alt, series | `document` | covered: Write details |
| Settings pane: the rest | Subtitle, slug, description, canonical, photo credit, pin title/description, comments, theme, part number, list order, abstract, authorship source | `document` | partial (R5) |
| Content profile + its fields | article, recipe, job, video, field-journal, research | `meta.profiles` | partial: recipe only (R4 job, R5 the rest) |
| Job form | `job.*` fields, checks | `job/check` | **missing** (R4) |
| Credits | Ordered contributor credits per post | `document` (`credits`, `creditEtag`) | **missing** (R5) |
| Visual / Markdown modes | WYSIWYG beside source | — | drop: Studio's Words box and recipe boxes replace both; blocks get forms in R6 |
| Add something | Callouts, tables, task lists, embeds, before/after, pieces | `pieces` | **missing** (R6) |
| Paste cleanup (`paste.js`) | Clipboard HTML to Markdown | — | partial: recipe boxes only (R6) |
| Plain-language checks | Suggestions with "Fix it" | — | **missing** (R6) |
| Portable output | Ghost, Hashnode, Medium copy/download | `portability/acknowledge` | **missing** (R5) |
| Share this job link | | — | **missing** (R1) |
| GPX track upload | | `track-upload` POST/DELETE | **missing** (R7) |
| Pane: Social | OpenGraph card preview | `preview` | **missing** (R7) |
| Pane: Optimize | Search and sharing readiness | `preview` | **missing** (R7) |
| Pane: Accessibility | Findings and repairs | `preview` | **missing** (R7) |
| Pane: Release kit | Video chapters, YouTube description | — (client) | **missing** (R7) |
| Pane: Field review | Route facts, location privacy | — (client) | **missing** (R7) |
| Publication review | Research review before publish | `research/review`, `research/review/acknowledgements` | **missing** (R7) |
| Pane: Evidence | Claims, links, anchors, references, bibliography | `research/claims*`, `citations/library`, `citations/check` | **missing** (R12) |
| Pane: Assistant | Review, autocomplete, knowledge check, runnable code, skills, context, references, URL context, provider | `assistant/*`, `quiz/generate` | **missing** (R8) |
| Beside the draft: research insert, curation | | `research/draft`, `research/curation*` | **missing** (R11, R12) |

### C. Site and look
| Old Admin | Does | API | Studio |
|---|---|---|---|
| `#/landing` | Sections, components, history | `landing*` | covered: Front page |
| `#/look`, `#/appearance` | Look; light/dark button | `look*`, `appearance` | covered: Look |
| `#/seasons` | Theme by calendar | `seasons`, `seasons/preview` | covered: Decorations |
| `#/design` | Describe a theme, preview, save | `theme-draft*` | **missing** (R9) |
| `#/business` | Business facts | `business` | covered: Business |
| `#/services[/new\|/edit/…]`, `#/reviews[…]` | | `documents?kind=`, `document` | covered: Services, Reviews |
| `#/reminders` | Seasonal prompts; topics and dates | `seasonal*` | partial: changing topics and dates (`PUT seasonal`) (R1) |
| `#/distribution` "Where it went" | Every post and where it went | `distribution`, `social/announcements` | **missing** (R1) |
| `#/contributors` | Site contributors, ORCID, roles | `contributors` GET/PUT | **missing** (R5) |

### D. Customers, family, sharing
| Old Admin | Does | API | Studio |
|---|---|---|---|
| `#/quotes` | Requests, status, export, erase | `quote/*` | partial: auto-erase setting (`quote/retention`, `/retention/run`), date-range export (R1) |
| `#/greetings` | Cards, contacts, test | `greetings/*` | covered: Cards |
| `#/social` | Connect, reconnect, choose destination, cancel, disconnect | `social/status`, `social/connections*`, `social/accounts/*` | partial: list + disconnect; connect/reconnect/select/cancel missing (R2) |
| `#/announcements` | Compose, queue, edit, reschedule, resolve, attempts, health | `social/announcements*`, `social/preview`, `social/posts`, `social/destinations` | partial: compose, cancel, retry; edit (PATCH), reschedule, resolve, attempts, health, preview missing (R1) |
| `#/share/<path>` | One job to Google, Facebook, Nextdoor | `job-share`, `job-share/by-hand` | **missing** (R1) |
| `#/capture` | Phone capture: photos, voice note, offline queue | `upload`, `capture-audio`, `document`, `assistant/transcribe`, `assistant/job-draft` | **missing** (R4) |
| `#/notifications` | Push on this device, topics, test, devices | `push/*` | **missing** (R3) |

### E. Readers
| Old Admin | Does | API | Studio |
|---|---|---|---|
| `#/analytics[/<days>]` | Reader numbers | `analytics?days`, `engagement/analytics` | partial: 7/30/90 days; add 365 (R10) |
| Hosted comments and analytics setup | Endpoint, credential, captcha, switches | `engagement/settings` | partial: comments on/off only (R10) |
| `#/moderation[/<state>][?kind=]`, `#/feedback` | Ten kinds, incl. clarification and withdrawn | `engagement/moderation*`, `author-response` | partial: comments and abuse reports only (R10) |
| Inbox: published notes | Publish/unpublish feedback, third perspectives, author responses; respond; revision notes | `engagement/feedback/*`, `third-perspectives/*`, `author-responses/*` | **missing** (R10) |
| Inbox: suggestions | Export, link to a post | `engagement/suggestions/*` | **missing** (R10) |
| Inbox: community features | Preview, feature, note, unfeature | `engagement/community/*` | **missing** (R10) |
| Inbox: continuations | Preview, link, unlink, sweep | `engagement/continuations*` | **missing** (R10) |
| Inbox: retention | Dry run, run | `engagement/retention` | **missing** (R10) |

### F. Research, comparisons, reading paths
| Old Admin | Does | API | Studio |
|---|---|---|---|
| `#/research/overview` | Workflow from source to draft | (aggregates below) | **missing** (R11) |
| `#/research/sources[/<id>]` (old `#/sources`) | Library, import, export, archive | `sources*` | **missing** (R11) |
| `#/research/notebook` (old `#/research`) | Passages, notes, search, backlinks, import/export | `research/notebook`, `passages`, `notes`, `search`, `backlinks`, `archive`, `import`, `export` | **missing** (R11) |
| `#/research/atlas[/<id>\|/relationships/<id>]` (old `#/atlas`) | Entries, relationships, chronology, explore | `research/atlas*` | **missing** (R12) |
| `#/research/compare[/<id>]` (old `#/compare`) | Aligned passages | `research/alignments` | **missing** (R12) |
| `#/research/public` | What will be public | `research/boundary` GET/POST, `research/readiness` | **missing** (R12) |
| `#/comparisons[/new\|/edit/<slug>]` | Interpretation comparison pages, approve/revoke | `comparisons*` | **missing** (R13) |
| `#/paths[/new\|/edit/<slug>]` | Reading paths | `reading-paths*` | **missing** (R13) |

### G. Collaboration and voice
| Old Admin | Does | API | Studio |
|---|---|---|---|
| `#/shared`, `#/shared/new` | Shared reflections; start one from a source | `collaboration/publications*` | **missing** (R14) |
| Shared reflection workspace | Invitations, members, roles, own draft, reveal, approval policy, arrangement, preview, series, synthesis, moments | `collaboration/*` | **missing** (R14) |
| `#/shared/accept/<token>` | Accept or decline an invitation | `collaboration/invitations/accept\|decline` | **missing** (R14) |
| `#/voice` session | Draw prompts, timed rough draft, polished copy | `voice/status`, `draw`, `session*` | **missing** (R9) |
| `#/voice` library, erase, move guide | | `voice/samples*`, `voice/erase`, `voice/guide/move` | **missing** (R9) |

### H. Routes with no caller anywhere
`document/rename`, `reading-paths/reorder`, `collaboration/approve`, `approve/withdraw`, `schedule`, `publish`,
`engagement/feedback/publish-decision`, `decorations/preview`, `voice/catalog`. Status: drop unless
Decide 2 wires them (rename into R5, reorder into R13).

### I. `web/admin/` files
| File | Fate |
|---|---|
| `admin.js`, `admin.css`, `index.html` | delete in R15; each slice lifts the pure helpers it needs (e.g. `MODERATION_KINDS`, `canonicalAdminHash` research map) |
| `look.js`, `landing.js`, `business.js`, `services.js`, `proof.js`, `seasonal.js`, `announcements.js` | move the pure half to `web/studio/parts/<name>-rules.js` (R0) |
| `block-forms.js` | `el()` replaced by `parts/dom.js` `h()` in R0; block forms' pure half to `parts/block-forms.js` (R6) |
| `job-form.js` | `COST_BAND_LABELS` + pure half to `parts/job-rules.js` (R0 for services, rest R4) |
| `checks.js`, `paste.js` | move whole (pure) to `parts/` (R6); `checks-panel.js` redrawn with Zubra |
| `capture-queue.js`, `capture-recorder.js`, `capture-assistant.js`, `job-capture.js` | pure halves to `parts/capture-*.js` (R4); keep DB name `openblog-capture` |
| `distribution.js`, `job-share.js`, `trade-checklist.js` | pure halves to `parts/` (R1) |
| `social.js` | pure half (`safeAuthorizeUrl`, providers) to `parts/social-rules.js` (R2) |
| `notifications.js`, `sw.js`, `icons/` | R3: `web/studio/sw.js`, `web/studio/icons/` |
| `theme-designer.js`, `voice.js`, `voice-session.js`, `voice-polished.js`, `voice-library.js` | R9; keep the `ob-voice-*` storage keys so local copies survive |
| `greetings.js`, `quotes.js`, `seasons.js`, `landing-history.js`, `lasting.js` | drop: Studio has its own (`card-words`, `quote-words`, Decorations, `landing-versions`, `site-health`) |

## 2. Runtime dependencies Studio has on `/admin/*`

Imports (dynamic `import(MODEL)`): `screens/look.js:12`, `landing.js:17`, `business.js:11`,
`reminders.js:11`, `share-new.js:11`, `parts/record-kinds.js:34,51` (services, proof). Each pulls
`block-forms.js` and `job-form.js` transitively. **R0** moves them to `web/studio/parts/*-rules.js`
as static imports and ports `tests/web/admin-{look,landing,landing-components,landing-summary,
business,services,proof,seasonal,announcements,input-scan}.test.mjs` to `studio-*-rules.test.mjs`.

Links out (`href`/`open` to `/admin/...`), each removed by the slice that builds the job:
`tools.js` (all of More tools; R15 deletes the screen), `shell.js:97` "Open the old Admin" (R15),
`write.js:275,337` + `write-page.js:82` (R0 wording, R5 detail), `page-edit.js:169`, `record-edit.js:256`,
`landing.js:234`, `business.js:150`, `cards.js:297` (R0: replace "trouble" fallbacks with Studio's
own details), `reminders.js:184,194`, `quotes.js:22,244`, `sharing.js:62,67,88,91,93,173,205`,
`share-new.js:66` (R1/R2), `comments.js:23,79,479`, `visitors.js:91` (R10).

Other callers of old addresses: invitation links `admin.rs:13009`; push notices
`netlify/functions/engagement.mjs:741,778,813,865,1354`, `quote.mjs:232`, `push.mjs:131`,
`netlify/lib/push-store.mjs:100`; bookmarks. **R0** adds `legacyRoute(hash)` to `router.js`
(pure, tested): `#/overview`→`#/`, `#/edit/<path>`→`#/write|page|collection|service|review/<path>`
by folder, `#/new/recipe`→`#/write/new/recipe`, `#/series`→`#/collections`, `#/landing`→`#/front-page`,
`#/appearance|#/seasons`→`#/look|#/decorations`, `#/moderation|#/feedback`→`#/comments`,
`#/analytics`→`#/visitors`, `#/social|#/announcements`→`#/sharing`, `#/greetings`→`#/cards`; the rest
map as their slices land, and an unbuilt one shows "Not in Studio yet" (never a blank Home).

Old-Admin tests: 74 `tests/web/admin-*.test.mjs` and 60 browser specs that open `/admin/`. Rule: a
test of behaviour Studio keeps is **ported** in the slice that builds it; a test of old chrome is
**deleted** in R15. Delete: `admin-command-palette`, `admin-editor-status`, `admin-preferences`,
`admin-workspace`, `admin-overview`, `admin-appearance`, `admin-lasting`,
`admin-markdown-edit` (visual editor), specs `admin-route-race`, `simple-workspace`. Port by setup only (they test
the public site and use Admin to arrange it; switch to API calls): `author-conversations`,
`curated-context`, `reader-protection`, `comment-captcha-admin`, `public-boundary`. Everything else
is ported in the slice of its area (`admin-behavior` is the Assistant's: R8).

## 3. Serving, server and docs

- `admin.rs:593–673` serves `/admin`, `/admin/` and 34 named files via `site::admin_file`, which
  reads `<paths.web>/admin/<file>` first, then `site.rs:313 EMBEDDED_ADMIN` (`include_str!` of
  every `web/admin` file). Studio is `studio_file()` (`admin.rs:694`) from `studio_files.rs`.
- **Switch (R15):** `/admin` and `/admin/` answer `302 Location: /admin/studio/`. Browsers keep the
  fragment across a redirect, so `/admin/#/quotes` lands on `/admin/studio/#/quotes` and
  `legacyRoute` does the rest. Studio stays at `/admin/studio/` (cookie path, CSP, file list
  unchanged). Delete the file table, `EMBEDDED_ADMIN`, `admin_file` and the `<paths.web>/admin/`
  override (Decide 3). Keep `/admin/manifest.webmanifest`, `/admin/icons/*` (from `web/studio/icons`,
  site override kept) and `/admin/sw.js` (from `web/studio/sw.js`, scope `/admin/`); manifest
  `start_url` becomes `/admin/studio/`, `id` stays `/admin/` so installed apps keep working.
- **`POST document/rename` (R15):** delete the route (`admin.rs` dispatch, `rename_document`) and its
  two route tests. Studio never moves a post's file (R5: "There is no rename"); no file in
  `web/studio` or `web/admin` calls it as of 2026-11-13, so it goes with the old Admin.
- **Sign-in/session/CSRF:** the old Admin owns no separate page; `login`, `session`, `logout` and
  `check_csrf` are API routes Studio already uses. Nothing to move.
- **CSP** (`admin.rs:723`): `'wasm-unsafe-eval'` and `frame-src https://codepen.io` serve the old
  editor's code runner and embeds. Keep only if R8 keeps runnable code previews; otherwise drop in R15.
- **Engine tests to change:** `admin.rs:33388` (CSP on `GET /admin`: assert the redirect, and the
  policy on `/admin/studio/`), `admin.rs:34980` (`/admin` 404 when off: keep), `admin.rs:37173`
  (invitation link), `admin/tests/push_routes.rs:313–318` (manifest). Add: redirect keeps working
  with a query; no `/admin/admin.js`.
- **Docs:** rewrite `docs/admin.md` (1370 lines, old Admin's manual) as Studio's, per screen. Fix
  old addresses in `configuration, jobs, deploy, quote-requests, webmention, README, reviews,
  job-sharing, social-publishing, research-profile, features, greeting-cards, notifications,
  services, seasonal-reminders, field-journal, cross-posting, video-production, content, themes,
  portability/capability-matrix` (`docs/*.md`), root `README.md`, `CONTEXT.md`, `CHANGELOG.md` entry.
  Update `.claude/skills/studio-architecture/SKILL.md` ("keeps working beside it" goes; `parts/*-rules.js`).

## 4. Slices, in order

Each ships alone, passes `studio-ux`, keeps the leave-guard, and ports its listed tests.

| # | Slice | Size | Routes | Risky parts | The job, so it's redesigned |
|---|---|---|---|---|---|
| R0 | Cut the cord: models into Studio, old addresses work | M | none new | Static imports change load order; model tests must stay byte-identical in behaviour | None for the owner; every old link she has still opens the right screen |
| R1 | Finish the trade site: reminder topics/dates, quote auto-erase + date-range export, change/check a share, Where it went, Share this job, checklist + recipe notes on Home | L | `PUT seasonal`, `quote/retention*`, `quote/export?from&to`, `social/announcements` PATCH/`reschedule`/`resolve`/`attempts`/`health`, `social/preview`, `distribution`, `job-share*`, `trade-checklist`, `recipe-notes`; **G7** server change | Erase always dry-run first; strangers' text as `textContent`; CSV as Blob | "Did my work get out, and what's next?" Where it went is a view of Sharing, not a report screen; the checklist lives on Home until done |
| R2 | Accounts in Studio (G6) | M | `social/status`, `social/connections*`, `social/accounts/*`; **G6** server change: `authorizeUrl` returned while pending, provider return lands on `/admin/studio/#/sharing` | OAuth: only `safeAuthorizeUrl` links, no open redirect, app password emptied before send, nothing connected until a destination is chosen | "Make my posts go to my Facebook page": one sheet per provider, health says reconnect in words |
| R3 | Notifications and the installed app | M | `push/*`; manifest, icons, `sw.js` moved; Netlify notice URLs to Studio hashes | Service worker scope and existing subscriptions; old notices still say `/admin/#/…` (legacyRoute) | "Tell my phone when someone writes": a switch on this device, what to hear about, other devices |
| R4 | Jobs: capture on site, job posts in Write | L | `upload`, `capture-audio`, `document`, `assistant/transcribe`, `assistant/job-draft`, `job/check` | Unsent captures in IndexedDB `openblog-capture` must be read, not lost; audio size limits; the Assistant only after she sees what's sent | "I'm on a roof with a phone": photos, three taps, a voice note; the job becomes a draft she finishes later |
| R5 | Write: everything about a post | L | `document` (all fields, `credits`), `meta.profiles`, `contributors`, `portability/acknowledge`, (`document/rename` if Decide 2) | Renaming breaks links unless the old address redirects; profile fields via `field-form` only | "About this post" sheet grouped by question (where it lives, how it's shared, who wrote it); a profile shows only its own fields; Contributors is a People screen |
| R6 | Write: help while writing | L | `pieces` | Paste is untrusted HTML: pure converter, no DOM; block forms write today's Markdown byte for byte | An "Add" menu (table, note box, checklist, video, before/after) with forms; suggestions as a quiet list with Fix it |
| R7 | Write: ready to publish? | L | `preview`, `track-upload`, `research/review*` | GPX location privacy; findings use the preview sandbox | One "Before you publish" checklist (social card, search, accessibility, plus release kit for video, route review for field journals, research review) instead of seven tabs |
| R8 | Writing helper (Assistant) | L | `assistant/*`, `quiz/generate` | Provider key write-only, never echoed; disclosure before anything is sent; replies are untrusted text; CSP decision | "Help me with this draft": check it, suggest next words, make a quiz or example; setup (provider, skills, context) in one Settings page |
| R9 | Voice and Design a theme | L | `voice/*`, `assistant/voice-guide`, `theme-draft*` | Timer owned by the server; rough-draft box refuses assistants; local copies keep `ob-voice-*` keys; erase confirm | "Write by talking/timed prompts" as its own place; "Describe a new look" inside Look, saved theme then worn from Decorations |
| R10 | Readers: every kind of note, setup, a year of visitors | L | `engagement/*`, `analytics?days=365` | Strangers' text; withdrawn notes immutable; retention dry run first; credential write-only | Comments becomes "Readers": one inbox, kinds as filters, each card shows only its decisions; setup behind "How comments work" |
| R11 | Research I: workspace, sources, notebook, cite while writing | XL | `sources*`, `research/notebook`, `passages`, `notes`, `search`, `backlinks`, `archive`, `import`, `export`, `citations/*`, `research/draft` | Imports are untrusted files; kept unsaved panels across screens; screen size (split into parts) | "From a source to a cited draft": the workflow is the screen; cite from a side sheet in Write |
| R12 | Research II: atlas, compare, evidence, what will be public, curation | XL | `research/atlas*`, `research/alignments`, `research/claims*`, `research/boundary`, `research/readiness`, `research/curation*` | Private research must never reach a public preview; BCE dates and precision | "What am I claiming, and what will readers see?": claims in Write, a single public-boundary view |
| R13 | Comparisons and reading paths | L | `comparisons*`, `reading-paths*` (+`reorder` if Decide 2) | Approval covers saved text only | Two more kinds in the Pages/Collections pattern (`parts/document-list`, `reorder-list`) |
| R14 | Writing together | XL | `collaboration/*` | Invitation tokens in the URL (strip after reading); roles; reveal before ready | "Write a reflection with friends": invite, write your part, reveal together; accept page works for a new co-writer |
| R15 | Switch `/admin/` to Studio and delete `web/admin` | M | redirect; removals in §3 | Orphaned old local data (`ob-admin-*` keys: harmless); docs; one release note | She opens the same address and gets Studio; nothing to learn twice |

Order rationale: R0 first so no later slice adds an `/admin/` import; R1–R4 serve the people using the
site now (Grammi, a trade owner); the editor slices (R5–R8) before research, which builds on Write.

## Decide (owner)

1. **Personalize workspace** (presets, density, module order): drop with its routes? Recommended: drop.
2. **Routes with no caller** (§1 H): wire `document/rename` (R5) and `reading-paths/reorder` (R13);
   delete the collaboration approve/schedule/publish set, `publish-decision`, `decorations/preview`,
   `voice/catalog`? Recommended: yes to both.
3. **Override files under `<paths.web>/admin/`** stop working (icons kept). Any site relying on it?
4. **Rarely used, expensive to rebuild**: release kit, field journal (GPX), portable output to
   Ghost/Hashnode/Medium, runnable-code proposals, knowledge checks, continuations, community
   features, shared reflections. Each could be dropped instead of ported; say which have users.
5. **Research tier (R11–R14, three XLs)**: port all, or retire research authoring from Admin and keep
   the public pages buildable from files only.

## Decided (owner, 2026-11-13)

1. **Personalize workspace:** dropped, with its routes.
2. **Routes with no caller:** all 9 are deleted, `document/rename` and `reading-paths/reorder` included. There will be no rename feature, and R5 and R13 don't wire either route.
3. **Override files under `<paths.web>/admin/`:** Grammi's House has none. Mention the change in the release note.
4. **Rarely used tools:** all are ported: the release kit, the field journal (GPX), portable output to Ghost, Hashnode and Medium, and knowledge checks, runnable-code proposals, continuations, community features and shared reflections.
5. **Research tier:** port all of it (R11–R14).
