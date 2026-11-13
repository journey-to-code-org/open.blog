# Studio parity audit (2026-11-13)

By `studio-architect`, against the old Admin (`web/admin/admin.js` and every `/admin/api/*` route in
`crates/openblog-cli/src/admin.rs` and `admin/*.rs`).

## Where Studio stands

Studio covers about 25 of the server's roughly 330 routes. That is all of Grammi's routine:
- sign in;
- posts and recipes, pictures, preview;
- publish, and delete with undo;
- seasons, decoration pieces and gifts.

It has none of these yet:
- Pages, Series, the Landing page, Look;
- comments;
- business, research and hosted-service tools.

## Decision taken (to confirm at sign-off)

"Done" means **Studio is the front door, and the old Admin keeps the rarely used tools** behind
"Open in the old Admin" links:
- research workspace, comparisons, reading paths;
- collaboration, contributors;
- voice, Design a theme, Assistant settings;
- the editor's advanced panes.

Deleting `web/admin` entirely would mean rebuilding or retiring well over a hundred mostly-research
routes. That is a separate decision for later.

## Remaining slices, in order

All reuse existing routes. The one exception is slice 7.

| # | Slice | Size | Routes |
|---|---|---|---|
| 4 | Pages and series, plus "More tools" links to the old Admin | M | `documents?kind=`, `document` CRUD, `document/restore`, `preview` |
| 5 | Home tells the truth about the whole site: needs attention, send out everything waiting, rebuild | S | `status`, `publish` GET/POST, `rebuild` |
| 6 | Landing page: sections, theme components through a generic field form, history and restore | L | `landing` GET/PUT, `landing/preview`, `landing/history*` |
| 7 | Look: colour, font, size, roundness, spacing, width, dark-mode button | M | `look` GET/PUT, `look/preview`, `appearance` GET/PUT. **First:** move `look.rs` and `save_appearance_settings` onto `config_text` so `openblog.json` stays as written |
| 8 | Comments: waiting, approved, removed; approve, reject, reply; on/off | M–L | `engagement/moderation*`, `engagement/author-response`, `engagement/settings` |
| 9 | Family and customer services, each only when switched on: greeting cards, quote requests, social accounts, announcements, visitors (analytics) | M each | `greetings/*`, `quote/*`, `social/*`, `analytics` |
| 10 | Business sites: business facts, services, reviews, reminders | M–L | `business`, `documents?kind=services\|proof`, `seasonal*` |

## Generic parts to build once

1. `parts/field-form.js`: Zubra fields from a field spec (the shape in `web/admin/landing.js`).
   Used by landing sections, theme-component settings, business facts, series and services.
2. `parts/document-list.js`: `store.js` and `post-list.js` over `kind`. Used by posts, pages,
   series, services and reviews.
3. `parts/reorder-list.js`: move up, move down and remove, announced aloud. Used by recipe rows,
   seasons, landing sections and field-form lists.
4. `parts/settings-session.js`: load with an etag, dirty check, save, 409, then send out.
5. `parts/hosted-gate.js`: an optional service's off, misconfigured or on state, in plain words.
6. `parts/preview.js` is already generic. Reuse it.

## Risks and loose ends

- Strangers' text (comments, quote requests, contacts, gifts) is only ever set with `textContent`.
  CSV exports are built as a Blob.
- Look and appearance rewrite `openblog.json` with `to_string_pretty`. That must be fixed before
  slice 7.
- Destructive tools (quote erase, engagement retention) always show their dry run first.
- These routes have no front-end caller anywhere:
  - `POST document/rename`
  - `POST reading-paths/reorder`
  - `collaboration/approve*`, `/schedule`, `/publish`
  - `engagement/feedback/publish-decision`

  Renaming isn't available anywhere, despite slice 1's brief. Mikey to decide whether these are
  features without a front end yet, or dead code.
- `parts/recipe-body.js` is 483 lines, over the limit.
