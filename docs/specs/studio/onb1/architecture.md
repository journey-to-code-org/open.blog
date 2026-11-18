# ONB1 architecture: feature areas, per-login answers, suggestions

By `studio-architect`, 2026-11-16. Sources: `studio-architecture`, `onboarding/ux.md` (R9b),
`r9/ux.md`, `r15/spec.md` (the old Admin and `GET|PUT preferences` are gone), `admin.rs`
(`meta`, `meta_for`, `is_trade_site`), `admin_preferences.rs`, `config_text.rs`,
`private_file.rs`, `admin/voice.rs` (`draw`, `promote`), `scaffold.rs`, `screens/index.js`,
`shell.js`, `router.js`.

## The pieces

| Piece | Where | What |
| --- | --- | --- |
| Area catalog | `web/studio/parts/area-rules.js` (pure) | `AREAS` (id, essential, words ids), `KINDS` (blog kinds → areas, → voice sets), `SCREEN_AREAS` (every screen name → area), `areaOfRoute(route)`, `areaOfHref(href)`, `visibleAreas(areas, extra)`, `areaVisible(meta, id)`, `isHidden(meta, id)` |
| Answers → areas | `web/studio/parts/welcome-rules.js` (pure) | `QUESTIONS`, `areasFor(answers, inUse)` → `{ shown, hidden, reasons, showEverything }`, `answersFrom(query)`/`answersQuery(answers)`, `questionAfter`/`questionBefore` |
| Words | `parts/area-words.js`, `parts/welcome-words.js` | every new string, through `say()` |
| About your blog | `screens/welcome.js` + `parts/welcome-*.js` | `#/welcome[/<question>|/summary|/suggestions|/voice]?a=...` |
| What you use | `screens/what-you-use.js` | `#/what-you-use` |
| Turned off | `parts/turned-off.js` | the page a hidden area's address shows |
| My stories | `screens/stories.js`, `parts/stories-sheet.js`, `parts/story-list-rules.js` | `#/stories`; Write's **Stories you could tell** sheet |
| Server catalog mirror | `crates/openblog-cli/src/admin/areas.rs` | `AREA_IDS`, `KIND_IDS`, `QUESTION_IDS`, the v2 preferences file, `areas_in_use`, the routes below, suggestions |
| Preferences v2 | `admin_preferences.rs` | read v1 or v2, migrate in memory, write v2 (keeping every other key) |
| init | `scaffold.rs`, `main.rs` | `--kind`, the terminal question, `.openblog/onboarding.json` |
| Voice draw | `admin/voice.rs` | `packs` (a list) and `story: true` on `POST voice/draw` |

Studio code stays in new files; shared files get only the hooks (`screens/index.js` entries, the
shell's filters, one line each in `home.js`, `new-post.js`, `profile-words.js`, `add-words.js`,
`start-stories.js`, `words.js`).

## Routes (new; owner accounts only, listed in `together_owner_routes.in`)

| Route | Body | Reply | Errors |
| --- | --- | --- | --- |
| `GET areas` | | `{ preferences, etag, inUse, hint }` | 500 unreadable file → `{ preferences: default, unreadable: true }` (200) |
| `PUT areas` | `{ etag, onboarding?: {state}, kind?, answers?, hidden?, shown?, showEverything?, storyMarks? }` (any subset) | `{ preferences, etag }` | 409 `stale` (`{ preferences, etag }` of the newer one), 413 over 16 KiB, 400 not an object / wrong types |
| `POST areas/suggestions` | `{ kind?, answers? }` | `{ etag, suggestions: [{ id, type: "change" \| "open", member?, before?, after?, lines?, href? }] }` | 500 unreadable `openblog.json` |
| `POST areas/suggestions/apply` | `{ id, etag }` | `{ applied: id, etag, lines }` | 409 `stale` (file changed since shown), 409 `in-use` (would turn off something used; never happens for today's set, tested), 404 `unknown` |

- **`GET areas`** is also folded into `meta.areas` (by `meta_for`, per login) so the shell starts
  with no extra request: `{ inUse, state, kind, answers, hidden, shown, showEverything, etag, hint }`.
  `inUse` is computed by `meta` from the sources it already loaded, once per request
  (`areas::in_use(root, config, sources)`), nothing stored.
- **Preferences v2** live in the same private per-login file as v1
  (`.openblog/private/admin-preferences/<sha256(user)>.json`, 0600, atomic via `private_file`):
  `schemaVersion: 2`, `onboarding: { state, version: 1, at }`, `kind`, `answers`,
  `areas: { shown, hidden }`, `showEverything`, `storyMarks`, and every v1 key kept as it was
  (`voiceInvitationDismissed` still read by R9). A v1 file reads as v2 in memory (state `done`,
  `full` → `showEverything`, `hiddenModules` `research`/`evidence` → `research`, `analytics` →
  `readers`) and is written as v2 only on a save. No file → state `pending`, nothing hidden.
  Unknown questions, choices and areas are dropped on save. ETag: FNV of the stored bytes (""
  when there is no file).
- **Suggestions** are computed from the kind and answers against the current `openblog.json`
  text. A `change` names one top-level member and its text before and after
  (`config_text::set_member`, layout kept); `lines` is the exact line change. Apply recomputes
  from the same inputs, refuses when the file's etag moved, writes atomically, and returns the
  same `lines`. Today: `docs-section` (`docs.enabled: true` for a documentation blog whose section
  is off) and `recipe-list` (`recipes.listing: true` when a recipe blog's list is off). `open`
  suggestions are screens: `business` (trade, no business facts yet → `#/business`), `seasons`
  (seasons yes, none set up → `#/decorations`), `readers` (readers yes, comments off →
  `#/readers`), `sharing` (sharing yes, no accounts → `#/sharing/accounts`).
- **init** writes `.openblog/onboarding.json` `{ "kind": "<kind>" }` (private folder, not built)
  only when a kind was given or answered; `GET areas` returns it as `hint` and Studio preselects
  it. Each login still answers for itself.
- **`POST voice/draw`** gains `packs: [ids]` (≤ 12; unknown ids dropped; none left → 404
  `pack-gone`) and `story: true` (at least one of the three from `stories`, when that set exists).
  `pack` keeps working.

## The client

- **One source of truth for hiding:** `meta.areas` (server) + `meta.together.takingPart` →
  `visibleAreas`. The shell keeps `meta.areas` current (`context.areas.save(patch)`; a
  `visibilitychange` re-reads `GET areas` and repaints when the etag moved, so another tab's change
  shows) and repaints navigation, account menu and Find. Parts that already take `meta` ask
  `areaVisible(meta, id)`: Write's kinds (`kindChoices`), the new-post chooser, the add menu,
  Home's lines.
- **Router:** a route whose area is hidden makes the turned-off page instead of the screen.
  `areaOfRoute` knows the few sub-addresses that belong elsewhere (`#/sharing/job/*` → trade).
- **About your blog keeps nothing until saved:** answers ride in the address
  (`#/welcome/seasons?a=kind.recipes~together.solo`), so a reload or Back resumes exactly, nothing
  goes to phone storage, and nothing reaches the server before **Save these** or **Skip the
  questions**.
- **Getting started opens it:** `openStartIfDue` sends a due run to `#/welcome` first while this
  login's `state` is `pending` (always in a practice run); the voice offer at its end goes on to
  `#/start`. In a practice run the answers apply to this window only (`context.areas.local`), and
  the server is not written.

## Risks and how each is covered

| Risk | Cover |
| --- | --- |
| Hiding something in use | `inUse` always wins in `visibleAreas` (table test); Write keeps the open post's kind with "Shown because this post uses it" |
| A screen added later with no area | `studio-area-rules.test.mjs` parses `screens/index.js` and fails for a screen name missing from `SCREEN_AREAS` |
| Untrusted text | answers are ids from fixed lists; area names are word ids; story titles and openings are placed with `textContent`; `before`/`after` config text shown in `pre` with `textContent` |
| CSP | no inline styles; classes only |
| Lost answers | nothing to lose before Save (they're in the address); saving is one PUT with etag; a 409 reloads the newer and says so |
| Lost site settings | suggestions change one member, only after a press, refused when the file moved |
| Co-writers | the four routes are owner-only (route-table test) |
| Cost on a 2,000-post site | one front-matter parse per post in `in_use`, reusing `meta`'s loaded sources (Rust test with 2,000 posts under a time bound) |
