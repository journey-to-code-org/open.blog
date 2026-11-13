# Studio, slice 1: sign in and write

Brief by `studio-stakeholder`, 2026-11-12. First slice of Studio, the new Admin on Zubra UI
(see `.claude/skills/studio-architecture/SKILL.md` and `studio-ux/SKILL.md`). The old Admin at
`/admin` keeps running untouched beside it.

## Outcome

Grammi can open Studio on her phone or her computer, sign in, and from a calm Home screen that
asks "What would you like to do?" write a new recipe or story, give it a title, the words, a
date, a few tags and a cover photo, keep it as a draft for later, and publish it when it is ready,
then find it again in her list of posts and fix a typo. She does all of it without help and without
meeting a file name or a technical word. Mikey can do the same loop from the keyboard alone, jump
anywhere with the command palette, and see exactly what Studio did (which file, whether the site
was sent out) one step deeper. This slice proves the whole approach end to end: a Studio page served
by the binary, vendored Zubra UI themed by Studio tokens, the existing Admin API as the only
back end, and tests in a real browser.

### What it takes (the shape step refines this, it does not grow it)

1. **Served page.** `web/studio/` served at `/admin/studio/` from the binary, with the Admin
   session cookie and security policy, per `studio-architecture`.
2. **Sign in and out.** `POST login` (username, password), `GET session` (user, CSRF), `POST logout`.
   A signed-out visit to any Studio address shows sign-in, then returns to that address.
3. **Shell.** Navigation (Home, Posts) that is one column with a menu at 400 px and a sidebar on a
   desktop; account menu (who is signed in, sign out, old Admin); `toast-region` for statuses;
   `command-palette` (Ctrl/Cmd+K: go to Home, Posts, Write a new post, open any post by title, sign
   out, open the old Admin).
4. **Theme bridge.** Studio tokens in `studio.css` feeding Zubra UI's variables; light and dark
   follow the device; 18 px base text and 44 px targets per `studio-ux`.
5. **Home.** "What would you like to do?" with one primary action, **Write something new**, then
   "Keep going" (her newest drafts, up to 3) and "Recently published" (up to 3). Data from
   `GET documents?kind=posts`.
6. **Posts.** All posts, newest first, each with title, date said in words, and a status of
   Draft, Scheduled or Published (from `GET documents`). Find by title; filter by status. Empty
   state invites the first post. Selecting a post opens it in Write.
7. **Write** (new and existing). Fields: title, words (`text-field` with `rows`, the Markdown body
   as plain text), date (`date-field` plus time), tags (`tag-input`, `fields.tags`), cover photo
   (choose from `GET images` or add one with `file-drop` to `POST upload`, plus "Describe the
   picture" saved as `coverAlt`). Load with `GET document?path=`; create with `POST document`
   (`kind: "posts"`); update with `PUT document?path=` sending the `etag`.
   - **Save draft** writes `draft: "true"`. **Publish** removes `draft` and keeps the chosen date
     (or now, when none or a past one is not set); a future date turns the button into **Schedule**
     and the status into "Scheduled for Friday, November 27 at 8 AM".
   - After Publish, if `GET publish` reports publishing is set up, Studio calls `POST publish` so
     her post goes out in the same step; the status says in words whether readers will see it,
     and More shows the server's message, commit and pushed flag.
   - **Nothing lost:** drafts autosave to the server a few seconds after typing stops (once there is
     a title, since the server names the file from it). Edits to a published post are not
     autosaved to the site; they are kept in the browser until **Update** is pressed, and offered
     back after a reload. Leaving with unsaved work asks first.
   - **More** (Mikey's layer): file path, slug, word count, link to view the live post, open
     this post in the old Admin.

## For

**Grammi first.** Every first-layer screen and word in this slice is judged by her.

**Mikey must not lose:**
- **His content.** Saving a post from Studio keeps every front-matter field Studio does not edit
  (recipe fields, `profile`, `series`, `subtitle`, credits, anything else) exactly as it was.
  Studio sends back the full `fields` it received from `GET document`, changing only its own keys.
- **The truth.** Every save and publish result is reported as it happened, including a site that
  has no publishing set up, a publish that committed but did not push, and a file changed on disk
  meanwhile (the server's `409` on a stale `etag`).
- **The old Admin.** It stays reachable (Studio's account menu and palette offer "Open the old
  Admin"), and nothing in this slice changes how it behaves.

## Out of scope

- Deleting, renaming or changing a post's web address (the old Admin does these meanwhile).
- Recipe-aware editing (ingredients, steps, block forms), rich text, preview of the rendered post.
- Series, subtitle, description, comment policy, credits, social card fields, profiles: preserved,
  not edited.
- Pages, seasons and decorations, the landing page, greeting cards, look and settings, research,
  voice, engagement and every other Admin area.
- A site-wide "publish pending changes" panel; this slice publishes only from a post.
- New server routes. If the shape step finds one is needed, the architect brings it back here first.

## Finish line

Each check is run against a real `openblog serve --admin` on a copy of the Grammi's House content.

1. **Grammi's task** (user stand-in `user-grammi`, phone width 400 px, screenshots of each step):
   sign in, write "Pumpkin bread" with two paragraphs, tags "Thanksgiving" and "Bread", a cover
   photo uploaded from the device with a description, save as draft, come back from Home's "Keep
   going", publish it, find it in Posts, fix a word, update. No help read, no blocker reported.
2. **Mikey's task** (`user-mikey`, desktop, keyboard only): Ctrl/Cmd+K to "Write a new post",
   write, schedule for next Friday 8 AM, open it again from the palette by title, check More shows
   its file path and the publish result.
3. **Round trip test:** a Playwright test opens an existing recipe post with fields Studio does not
   edit, changes one word, updates, and the file on disk differs from the original only in that word.
4. **Conflict test:** the file is changed on disk while open in Write; Update shows a plain-words
   message with a way to reload, and no text she typed is lost.
5. **Signed-out test:** an expired session during a save keeps her words and asks her to sign in
   again, then completes the save.
6. **Accessibility:** axe-core reports no violations on sign-in, Home, Posts and Write; keyboard-only
   run of checks 1 and 2 passes; 320 px reflow with no sideways scroll; reduced motion honoured.
7. **Housekeeping:** `node --test tests/web/studio-*.test.mjs`, `tests/browser/studio-*.spec.mjs`,
   `cargo test -p openblog-cli` all pass; `node scripts/studio-files.mjs` reports nothing to change;
   `zubra/components.json` names the zubra-ui commit; the old Admin's own tests still pass.
8. Every Studio screen in this slice passes the `studio-ux` review checklist, signed by `studio-qa`.

## Later slices (priority order)

1. **Recipes and pictures:** recipe-aware writing (ingredients, steps, the recipe blocks her posts
   use), a photo library, preview of the post as readers will see it, delete with undo.
2. **Decorations and seasons:** when the house changes for Thanksgiving and Christmas
   (`seasons`, `seasonal`), urgent for Christmas.
3. **Landing page:** the front page and its pieces (countdown sign, birthday cards) with history
   and restore (`landing`, `landing/history`).
4. **Cards by email:** greeting cards (`greetings/*`).
5. **Look and site:** look, appearance, business details, preferences, and a site-wide publish
   status panel (`look`, `appearance`, `business`, `GET publish`, `status`).
6. **Parity audit:** walk the old Admin screen by screen against Studio, list what is missing,
   and brief the gaps that real use calls for; only then plan retiring `/admin`.
