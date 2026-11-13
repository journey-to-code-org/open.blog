# Studio slice 2: architecture

By `studio-architect`, 2026-11-12, against the working tree at 46e176b. `admin.rs` = `crates/openblog-cli/src/admin.rs`, `fm.rs` = `crates/openblog-core/src/frontmatter.rs`. Answers the brief's A1–A4.

## A1. Files kept as written

- **Today:** `save_document` (admin.rs:16758) rebuilds the whole file with `frontmatter::compose` (fm.rs:597). That puts known keys in `KEY_ORDER` and the rest alphabetically, drops empties (`cover: ""`), turns inline lists into block lists, quotes `true` (`quote_scalar`, :622), strips the body's leading blank lines (:615), and loses `#` comments (`parse_fields` skips them, :115).
- **Change:** `pub fn splice(original, fields, body) -> Option<String>` in `fm.rs`. `save_document` uses it when the request has `"frontMatter": "keep"` and the file exists, falls back to `compose` on `None`, and replies `"layout": "kept" | "rewritten"`. The request key is `frontMatter` because `layout: recipe` is already a legacy recipe marker in front matter.
- **Algorithm:**
  - **Spans:** split the front matter into spans: a top-level `key:` line, its indented or `- ` lines, and comments or blank lines between items.
  - **Unchanged keys:** keep their bytes.
  - **Changed scalars:** keep their quoting style; a value that was bare `true`/`false`, and `draft`, is written bare; a trailing ` # comment` stays.
  - **Changed lists:** keep inline or block form.
  - **Emptied or removed keys:** delete only their span.
  - **`job.*` and `faq.*`:** regenerate as a whole span.
  - **New keys:** go next to their `KEY_ORDER` neighbour; unknown keys go at the end.
  - **Body:** kept byte-for-byte when unchanged; otherwise it keeps the original line ending, and a final newline only if the original had one.
  - **Self-check:** `parse(result)` must equal the request (minus empties), else `None`.
  - **Edge cases:** BOM, CRLF, no front matter.
- **Default later:** keep is opt-in for slice 2 and becomes the default once the whole suite passes with it on. The one sensitive existing test is the claims-anchor test (admin.rs:24024).

## A1b. Recipe fields

- **Fields** (`recipe.rs` :238–268, first alias wins):
  - `servings`/`serves`
  - `prepTime`/`prep`/`prep_time`
  - `cookTime`/`cook`/`cook_time`
  - `totalTime`/`total`
  - `yield`/`makes`
  - `course`/`category`/`recipeCategory`
  - `cuisine`
  - `adaptedFrom`/`basedOn`
- **Gap:** `profile::field_aliases` (`profile.rs`:350) only lists `course`'s aliases. Add the rest, and Studio edits whichever alias the post already uses, so `prepTime` never shadows her `prep`.
- **Body the site understands** (`markdown.rs`:1599–1697, `recipe::classify_heading`):
  - the story, then `## Ingredients` with amount-first `- ` items (`### For the crust` sub-groups allowed);
  - `## Steps` with `1.` items, where times become timer buttons (`ob-quantity.js` `findDurations`);
  - `## Grammi's notes` (any same-level heading ends a section).
- **Server offers:**
  - `meta.profiles` (the recipe starter, fields, help);
  - `POST preview` → `recipeProblems` (codes in `recipe_check.rs`:29; the old Admin's sentences are `RECIPE_ADVICE`, admin.js:8029).

## A2. Delete and undo

- **Today:** `DELETE document?path=` (admin.rs:17292) moves the post and its sidecars (credits, track, contexts) to `.openblog/trash/<stamp>-<rel with / → _>` and replies with `trashedTo`, `trashedCreditsTo`, `trashedTrackTo` and `trashedContextTo`. It has no etag check and no restore.
- **New route:** `POST document/restore {path, trashedTo, trashedCreditsTo?, trashedTrackTo?, trashedContextTo?[]}`.
  - **Checks:** bare names inside the trash that end with the name expected for `path`.
  - **Restore:** moves the files back transactionally under the content lock, then rebuilds.
  - **Errors:** 404 "no longer in the bin"; 409 when the path is taken or locked; 422 for names that don't match.
- **Undo means:** put back exactly what was moved, while the name is free and the trash file still exists. Re-sending the post from Studio's memory is not safe: it loses sidecars and can rename the file.
- **Decision (stakeholder delegate):** delete and restore trigger `auto_publish` like a save does, so a deleted post leaves the readers' site and comes back on Undo.

## A3. Preview

- **Route:** `POST preview {kind, path, fields, body}` builds the site in memory and returns `previewUrl` (`/admin/api/preview/<hex>`, session-only, own CSP with inline scripts). The last 16 previews are kept, across all users. It also returns `recipeProblems`.
- **Studio's frame:** `<iframe sandbox="allow-scripts">`, without `allow-same-origin`, as in the old Admin (admin.js:21970). Studio's CSP already has `frame-src 'self'`. Timers run inside the preview's own page.
- **When it builds:** on request only, since each preview builds the whole site. A 404 asks for a fresh one.

## A4. Pictures

- **Upload:** `POST upload?name=` takes raw bytes. PNG, JPEG, GIF, WebP and AVIF are accepted; HEIC is refused in a plain sentence. Photos are resized to 2000 px with location data removed, capped at `maxUploadMb`, and saved under `static/images/uploads/<year>/`.
- **List:** `GET images` returns the newest 300 as `{url, name}` plus `more`.
- **Missing:** delete, rename, stored descriptions and usage checks. A description lives only in the post (`coverAlt`, `![alt](url)`). Picture delete is deferred: the trash can't restore static files.
- **Library in slice 2:** list, upload, and insert at the cursor.

## Risks

| Risk | Cover |
| --- | --- |
| Alt text or file names breaking Markdown | DOM-free escaper for `]`, `\` and newlines; `url` must start with `/images/uploads/`; tests. |
| Preview scripts | Sandbox without `allow-same-origin`; a browser test checks it. |
| Recipe editor losing text | The body parser must round-trip exactly, or the post opens in the plain Words box. Tested on every Grammi post. |
| Splice errors | Self-check plus `compose` fallback; the reply says `layout`. |
| `prepTime` overriding `prep` | `field_aliases` fix. |
| Undo in a toast times out (WCAG 2.2.1) | Undo lives in an `alert-banner` that stays until dismissed. |
| `write.js` growing | Split the save and conflict flow out first. |

## Files

- **Server**
  - `fm.rs` (`splice` + tests)
  - `profile.rs` (aliases)
  - `admin.rs` (keep flag, `restore_document`, route)
  - `admin/tests/document_keep_routes.rs`, `document_restore_routes.rs`
- **Screens**
  - `screens/pictures.js` (new)
  - `screens/write.js` (slimmed)
  - `screens/index.js` (Pictures; `#/write/new/recipe`)
- **Parts**
  - Browser: `save-flow.js` (split from Write), `recipe-editor.js`, `picture-picker.js` (from `cover-picker.js`), `preview.js`, `delete.js`
  - DOM-free: `recipe-body.js`, `recipe-fields.js`, `recipe-advice.js`, `image-markdown.js`
- **Tests**
  - Node: `studio-recipe-body`, `-recipe-fields`, `-recipe-advice`, `-image-markdown`
  - Browser: `studio-recipe`, `-pictures`, `-preview`, `-delete-undo`, and a round trip over a Grammi-shaped fixture site
