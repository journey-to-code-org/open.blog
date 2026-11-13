# Studio slice 3b: architecture

By `studio-architect`, 2026-11-13. This is a condensed record; the full report with file references is in the slice 3b PR.

## Decorations as pieces

- **Today:** a season decorates through `decor*` tokens in its `theme.json`. `grammis` sets them all to `none`, `house.css` places them, and `snow.js` draws snow and twinkles the garland.
- **Each theme declares its pieces.** `theme.json` gains a `decorations` manifest: `{ piece: { label, tokens: [names], off: { token: value }, variants: { id: { label, tokens: { … } } } } }`, inherited through `extends`. At load, the engine checks that `off` and each variant only set tokens their piece lists.
- **The owner's choices live in config.** `openblog.json` gains `decorations: { theme: { piece: false | variantId } }`. It holds names only, never CSS, and is skipped when empty.
- **Applying them.** `Theme::with_decorations` runs next to `with_look`. It overwrites only the declared tokens and changes the tokens URL hash. With no choices, the output is byte-identical. A stale choice is ignored at build time with a warning.
- **Routes.** `GET`/`PUT /admin/api/decorations` gets its own etag, so seasons never sees false conflicts. It keeps the file as written (`set_member_pretty`), then rebuilds and auto-publishes. `POST decorations/preview` previews the choices.
- **Snow** is a piece too: `snow.js` reads `--gh-snow` (a `grammis-house` change).

## The tree

- **What it is:** a theme component, `grammis-tree`, on the landing page. It has about 12 named spots (a `choice` setting each), a topper and a lights toggle. That is within `MAX_PROPS = 20`.
- **Where it's stored:** `content/landing.json`, through the existing landing routes. The engine doesn't change.
- **Where she decorates it:** Studio has no landing screen yet. A generic `screens/landing.js` with `parts/component-form.js` would serve every component. Until then, she uses the old Admin's Landing page.

## Gifts

- **Where they live:** a new private `gifts` function on the notes service (Netlify plus Supabase, `supabase/gifts.sql`). Row-level security is on, with no policies; only the service role reads the table.
- **Family only:**
  - a family code from the environment, compared timing-safe;
  - quote-style form tokens with a minimum fill time;
  - a honeypot;
  - per-visitor, per-hour and per-season caps.
- **Public routes:**
  - `GET /api/gifts/token`
  - `POST /api/gifts/submit`, with a note of up to 1,000 characters, or a card as structured JSON: template, palette, message, sign-off and up to 8 stickers, all enums or bounded text.
  - `GET /api/gifts/tree`: wrapped boxes only, never contents.
- **Unwrap on Christmas:** each gift stores `opens_at`, December 25 at 00:00 in `OPENBLOG_GREETINGS_TIME_ZONE`. The open route answers 423 before then. The function enforces this, not Studio.
- **Admin side:** a proxy, `admin/gifts.rs`, modelled on `greetings.rs`, with its own admin key. It lists wrapped gifts, opens, approves a tag, and hides. Hiding never deletes.
- **Not switched on yet:** `engagement` is off and its endpoint is empty, so the family service setup must be run first.

## Ship order (today is November 13)

| When | What |
| --- | --- |
| Nov 13–26 | Decorations: engine, route, Studio part, then the `OPENBLOG_REV` bump. The new Christmas look and `grammis-tree`. |
| By Dec 1 | The tree is live, decorated in the old Admin's Landing page. |
| Dec 1–10 | Family service setup, then gifts: SQL, function, the guest's note and card maker, wrapped boxes on the tree. |
| Dec 10–20 | Studio Gifts screen and proxy, rehearsed with a fake opening date. |
| Dec 25 | She opens them. |

**Cut lines, in order:**
1. The Studio landing screen.
2. Variants.
3. The card maker.
4. Names on the tree.
5. If the Studio Gifts screen slips, the hourly sender emails her the gifts on Christmas morning.

## Rights

The new Christmas look is original artwork. Studio doesn't draw Rudolph, the Island of Misfit Toys, or anything recognisable as them.
