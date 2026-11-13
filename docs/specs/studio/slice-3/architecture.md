# Studio slice 3: architecture

By `studio-architect`, 2026-11-13. Paths:
- `seasons.rs` is `crates/openblog-cli/src/admin/seasons.rs`
- `core/seasons.rs` is `crates/openblog-core/src/seasons.rs`
- `site.rs` is `crates/openblog-cli/src/site.rs`

## Routes

### GET seasons

`GET seasons` (`seasons.rs:36-78`) returns:

```
{ version: 1, etag, theme, seasons: { enabled, windows: [{ theme, start: "MM-DD", end: "MM-DD" }] },
  themes: [{ name, label }], today: "MM-DD", wearing, next: { day: "YYYY-MM-DD", theme } | null, maxWindows: 24 }
```

### PUT seasons

`PUT seasons` takes `{ etag, theme, seasons }`.

| Status | When |
| --- | --- |
| 413 | The body is over 8 KiB. |
| 400 | The body is not JSON. |
| 422 | A missing etag, a missing theme, `SeasonsConfig::from_value` errors, or an unknown theme. |
| 409 | The stored file changed. The reply is fresh state plus `error`. |
| 200 | The new state plus `buildError`. |

- **Rebuild:** a save always rebuilds.
- **Storage:** the top-level members `theme` and `seasons` of `openblog.json`.

## Today's layout problem

`config_text::set_member` keeps every other member byte for byte. But it re-renders `seasons` through a `serde_json::Map`, and that has sorted keys. So even a save that changes nothing rewrites about 65 lines of Grammi's file.

The fix:
1. **Skip unchanged members:** skip `set_member` when the stored value equals the new one.
2. **Ordered rendering:** render a changed `seasons` with `SeasonsConfig::to_text()`, which writes keys in their documented order (`version`, `enabled`, `windows`; each window `theme`, `start`, `end`).

## How the built site picks a look

- **Picking a window:** `wear_the_season` (`site.rs:929`) runs with the real clock. The first window holding the day wins, and a window may cross New Year.
- **The day is UTC:** `core/seasons.rs:52`. Grammi's hourly build is at :17 UTC, so a December 1 window goes up between about 7:17 and 8:17 pm Eastern on November 30.
- **No override exists:** there is nothing to set "now", and no preview in another look.

## Preview

`POST seasons/preview { theme, seasons, day: "MM-DD" }` returns `{ previewUrl, wearing }`.

- **Model:** `look::preview` (`look.rs:187-276`).
- **Steps:**
  1. Swap in the unsaved theme and seasons, set `config.theme` to the look worn on `day`, and turn seasons off.
  2. Strip snippets and analytics.
  3. Build the home page and store it as a preview.
- **Display:** shown in Studio's sandboxed preview frame.

## Decorations

- **No decoration API:** a decoration is a theme.
- **Theme contents:** `decor*` tokens and theme scripts (snow, leaves).
- **What Studio can show:** `GET seasons` lists `{ name, label }` only, and there are no thumbnails, so the preview stands in for them.

## Writing reminders

Writing reminders (`GET`/`PUT seasonal`, `seasonal/snooze`, `seasonal/open`) are out of slice 3, per the brief: they are prompts for drafts, not decorations.

## Risks

| Risk | Cover |
| --- | --- |
| Config churn | No-op skip, ordered render, byte-identical route test |
| Owner text in labels | `textContent` only |
| Theme scripts in the preview | Sandboxed frame, `preview_csp` |
| Overlapping windows (first wins, silently) | DOM-free check that names the winner |
| UTC switch time | Sentence in her time ("the evening before, around 7 pm") |
| 02-29 in a non-leap year | Node test |
| Every save rebuilds; every preview builds | On request only |

## Files

- **Screen:** `screens/decorations.js`
- **DOM-free parts:**
  - `season-windows.js` (from `web/admin/seasons.js:14-130`)
  - `post-session.js` (the rest of the `write.js` split)
- **Browser part:** `preview.js` widened to take a ready `previewUrl`.
- **Zubra UI:** vendor `toggle-switch` and `select-field`.
- **Server:**
  - `seasons.rs`: no-op skip, `to_text`, the preview route, `upNow`.
  - `core/seasons.rs`: `to_text`, `upNow`.
  - `site.rs`: wear `upNow`.
- **Tests:**
  - Route: `admin/tests/seasons_routes.rs`.
  - Node: `studio-season-windows`, `studio-post-session`.
  - Browser: `studio-decorations.spec.mjs`.
