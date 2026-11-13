# Studio, slice 2: recipes and pictures

Brief by `studio-stakeholder`, 2026-11-12. Builds on slice 1 (`../brief.md`, `../decisions.md`). The old Admin at `/admin` keeps running untouched beside it.

## Outcome

Grammi can write a recipe the way she thinks about one. She gets a box for the story, a list of ingredients, numbered steps, her notes, and how many it serves and how long it takes. She doesn't have to know about Markdown, headings or the empty line between paragraphs. She can add pictures from her phone to the recipe itself, not only the cover, and find any picture she has already put on her site. Before anyone else sees the post, she can look at it the way her readers will. She can take a post off her site without losing it, and delete one knowing she can bring it back. Mikey gets a promise in return: when Studio saves a post, the file stays exactly as he or Grammi wrote it, except for the values that actually changed. He can do all of this from the keyboard.

### What it takes (in this order; the shape step refines it, it does not grow it)

1. **Files kept as written (`"layout": "keep"`).** Every Studio save changes only the bytes of values that changed. That covers key order, quoting (`draft: true` stays a bare `true`), flow lists (`tags: [thanksgiving]`), `#` comments, blank lines, and the body outside the edited part. Keys Studio adds go at the end. Publish removes only the `draft` line. This lands first, and nothing below ships without it.
2. **Groundwork from the slice 1 review.** Before any new screen: one posts store, a screen registry, a keymap with checked command ids, and route query state (`../decisions.md`, Deferred). The keymap adds Ctrl/Cmd+Enter for Publish, Schedule or Update. *(Store, registry and route query landed in 46e176b; Ctrl/Cmd+Enter in e40d1c1.)*
3. **Recipe writing.** A post with `profile: recipe` opens with these fields:
   - **Your story**: the text before `## Ingredients`.
   - **Ingredients**: one row each. Help: "Start with the amount: 2 cups flour". Rows can be added, removed and moved up or down.
   - **Steps**: numbered rows. Help: "Write times like 'bake for 45 minutes' and readers get a timer".
   - **Grammi's notes**.
   - **Serves**, **Time to get ready**, **Time to cook** (`servings`, `prep`, `cook`).
   - `course`, `cuisine` and `series` go in More.

   These map onto the `## Ingredients` (`- ` list), `## Steps` (`1.` list) and `## Grammi's notes` sections, so scaling, checklists and timers keep working. Headings or blocks Studio doesn't recognise are kept byte for byte and shown read-only in More ("Other parts of this post"). If a body won't map cleanly, the post opens in the plain Words field and More says why. Studio never guesses.
4. **Starting a recipe.** "Write something new" lets her choose **A recipe** or **A story**. A new recipe is a draft with `profile: recipe` and empty sections, never sample ingredients.
5. **Pictures.** A Pictures screen shows every picture on her site, newest first, and lets her **Add a photo**. In Write, **Put a picture in** places a picture at the cursor in the story or notes, either a new one or one already on her site, with "Describe the picture" required.
6. **See it as readers will.** **See how it looks** shows the post rendered by the site's own theme, at phone width on a phone. It works for drafts and for unsaved changes, and does not publish anything.
7. **Take it off my site.** This turns a published or scheduled post back into a draft. It asks once and says when readers stop seeing the post.
8. **Delete with undo.** Delete is in More, in Write and in Posts. Deleting a draft shows "Deleted. Undo" and Undo brings back the identical file. Deleting a published post asks once, offers **Take it off my site** instead, and still has Undo.

## For

**Grammi first.** She judges every first-layer word in the new fields, Pictures, preview, and the delete and take-off flows.

**Mikey must not lose:**
- **His files as written** (item 1). Studio sends only what changed, and the server writes only that.
- **The reader features.** Ingredients stay amount-first `- ` lists and steps stay `1.` lists under the same headings, so scaling, timers, cook mode and recipe structured data still work.
- **The truth.** More shows which file was written, deleted or restored, and the publish result, as in slice 1.
- **The old Admin**, unchanged.

## Out of scope

- **Renaming a post or changing its web address.** Moved to a later slice: Grammi never sees a file name, a published rename breaks links readers already have, and the old Admin covers Mikey until real use asks for it. *(Mikey to confirm.)*
- Deleting, cropping or rotating pictures, and a "where is this picture used" view.
- Ingredient groups as structured fields ("For the crust"). These are kept as written (open question U2).
- Rich text or a visual editor, quizzes, quotes, and other blocks beyond keeping them intact.
- Description, social card, comments, credits, subtitle. These are kept, not edited.
- Typing dates like "fri 8am", details from Posts, and a site-wide publish panel.
- Seasons, landing page, cards and settings (later slices).

## Finish line

All checks run against `openblog serve --admin` on a copy of the Grammi's House content.

1. **Grammi's task** (`user-grammi`, 400 px, screenshots of each step):
   - Open "Grammi's Pumpkin Pie" from Posts. Replace the TODOs with a story, 6 ingredients, 4 steps (one says "bake for 45 minutes") and a note. Set Serves to 8.
   - Move one step up.
   - Put a photo from her phone into the story, with a description.
   - Use **See how it looks**: the ingredients, numbered steps and timer step are shown.
   - Publish. Take it off her site. Publish again.
   - Delete a test post "Pumpkin bread", then Undo.

   Passes with no help read and no blocker reported.
2. **Mikey's task** (`user-mikey`, desktop, keyboard only):
   - Ctrl/Cmd+K, then write a recipe. Add and reorder ingredients without a mouse. Ctrl/Cmd+Enter to publish.
   - Open Pictures from the palette.
   - Delete the post and undo from the keyboard.
   - Check that More shows the file path and what was written, deleted or restored.
3. **Round trip, every post:** a test runs over every file in `content/posts/`.
   - (a) Change `servings` and the file differs only on that line.
   - (b) Change one ingredient and only that line differs.
   - (c) Publish and only the `draft` line goes.
   - (d) A post with `#` comments, `draft: true`, `tags: [x]`, `cover: ""` and two blank lines after the front matter keeps all of them.
4. **Unrecognised body:** a recipe with an extra heading, a sub-grouped ingredient list and a quote opens without loss. Saving an edit to its notes leaves every other byte alone.
5. **Delete and undo:** the file is gone after Delete and comes back byte-identical after Undo. A published post asks first. The status says in words what happened.
6. **Preview:** a test compares the preview's servings, ingredient count and step count with the built page. Nothing is written or published.
7. **Accessibility:**
   - axe-core reports no violations on Write (recipe), Pictures, preview, and the delete and take-off dialogs.
   - Every ingredient and step row is named ("Ingredient 3 of 6"), and moving one is announced.
   - Reordering works without drag.
   - 320 px reflow and reduced motion pass.
8. **Housekeeping:**
   - These all pass: `node --test tests/web/studio-*.test.mjs`, `tests/browser/studio-*.spec.mjs`, `cargo test -p openblog-cli` (with route tests for layout keep, delete and restore), and the old Admin's tests.
   - `scripts/studio-files.mjs` reports nothing to change.
9. **No regressions:** slice 1's finish line checks 1 to 6 still pass.
10. **UX checklist:** every new or changed screen passes `studio-ux`, signed by `studio-qa`.

## Open questions

**Architect**
- **A1.** Does `PUT document` already take `"layout": "keep"`, or is this a new parameter? How is the body changed by section without rewriting the untouched parts: does the client send the whole body, or does the server splice?
- **A2.** Delete and undo: a server trash, or the client holding the bytes and restoring them through a route? What happens to Undo when a publish runs in between?
- **A3.** Preview: can Studio reuse the old Admin's preview under `script-src 'self'`, and with no scripts how do timers show?
- **A4.** Pictures: what metadata does `GET images` give, and where does a picture's description live so she can reuse it?

**Designers**
- **U1.** How does choosing recipe or story keep Home's one primary action?
- **U2.** Should grouped ingredients ("For the crust") show as read-only text, or as plain lines in one field?
- **U3.** How does reordering work on a phone: Move up and Move down, or something else?
- **U4.** How long does Undo last, and what does it say if she leaves the screen first?
- **U5.** Should `course` and `cuisine` move from More to her layer?
