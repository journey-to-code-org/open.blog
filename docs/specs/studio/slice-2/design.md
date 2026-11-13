# Studio design, slice 2: recipes and pictures

By `studio-senior-ux`, 2026-11-12, on `../design.md`, `brief.md` and `architecture.md`. Vendored Zubra UI only.

## Answers to U1 to U5

- **U1.** Home keeps **Write something new**. A new post's first question is "What are you writing?", answered with **A recipe** or **A story** (§2).
- **U2.** Grouped ingredients open as plain lines in one field she can edit. Read-only would strand her when "2 cups" should be "3 cups" (§1).
- **U3.** Each row has a **Move** menu: Move up, Move down, Remove. Alt+↑/↓ moves a row from the keyboard. There's no dragging, and every move is announced (§8).
- **U4.** Undo is a shell-level banner that stays until she closes it, deletes again, signs out or closes Studio (§7).
- **U5.** Course and cuisine stay in More. See how it looks asks for them when missing; the starter fills them in.

## 1. Write, for a recipe

**Job:** "Write my recipe the way I make it." **Primary:** **Publish**, **Schedule** or **Update**, as in slice 1.

```
400 px                                 Desktop
+--------------------------------+     +-------+----------------------------------------------------+
| Posts > Pumpkin Pie    [More]  |     | side- | [Find][More][Save draft][See how it looks][Publish]|
| Draft . saved just now         |     | bar   | Home > Posts > Grammi's Pumpkin Pie                |
| Title [Grammi's Pumpkin Pie  ] |     |       | Title [Grammi's Pumpkin Pie   ] | Serves [8]       |
| Serves [8]                     |     |       | Your story [Mama taught me... ] | Time to get ready|
| Time to get ready [15 minutes] |     |       | [Put a picture in]              | Time to cook     |
| Time to cook [45 minutes]      |     |       | Ingredients                     | When it appears  |
| Your story [Mama taught me...] |     |       |  Ingredient 1        [Move v]   | Tags             |
| [Put a picture in]             |     |       |  [1 can pumpkin puree     ]     | Cover photo      |
| Ingredients                    |     |       |  [Add an ingredient]            |                  |
| Start with the amount: 2 cups  |     |       | Steps                           |                  |
| flour                          |     |       |  Step 1              [Move v]   |                  |
| Ingredient 1         [Move v]  |     |       |  [Heat the oven to 425.   ]     |                  |
| [1 can pumpkin puree       ]   |     |       |  [Add a step]                   |                  |
| [Add an ingredient]            |     |       | Grammi's notes [...]            |                  |
| Steps ... [Add a step]         |     |       |  [Put a picture in]             |                  |
| Grammi's notes [...]           |     |       | Also in this post: "Wine to go  |                  |
| When it appears / Tags / Cover |     |       | with it". Kept as is. [See them]|               |
+--------------------------------+     +-------+----------------------------------------------------+
| [See how it looks] [ Publish ] |  <- fixed bar, cluster-layout
+--------------------------------+
```

| Part | Component | Words |
| --- | --- | --- |
| Serves | `text-field inputmode="decimal"` | "A number, like 8, so readers can make more or less." |
| Time to get ready, Time to cook | `text-field` ×2 in `cluster-layout` | "Like 15 minutes or 1 hour." Studio writes to whichever alias the post already uses. |
| Your story | `text-field rows=8`, Literata | "Who taught you this, the year it went wrong, who asks for seconds." |
| Ingredients / Steps | `fieldset` + legend | "Start with the amount: 2 cups flour" / "Write times like 'bake for 45 minutes' and readers get a timer" |
| Row | `text-field` (an ingredient is 1 line; a step is 2 rows and grows) + `dropdown-menu`, trigger "Move" | Label "Ingredient 3"; menu **Move up**, **Move down**, **Remove this ingredient** (ends are disabled) |
| Add | `action-button variant="secondary"` | **Add an ingredient** / **Add a step** (adds a row and focuses it) |
| Notes | `text-field rows=5`, Literata | Label is the post's own heading ("Grammi's notes"). Help: "Tips, swaps, what not to do." |

- **Phone order:** Title, the three numbers (as on a recipe card), story, ingredients, steps, notes, When, Tags, Cover. On desktop the numbers head the side column.
- **New recipe:** one empty row per list, never sample text. Empty rows aren't saved. Leftover TODO lines are named by See how it looks.
- **Pasting several lines** splits them into rows (dropping "- " or "1.") and says "Added 6 ingredients."
- **Other parts of this post:** a line under the notes says "Also in this post: "Wine to go with it" and a quote. Studio keeps them just as they are."
  - **See them** opens a `side-sheet`, "Other parts of this post", showing each part read-only as it reads, with line numbers for Mikey.
  - It ends with "To change these, write this post as plain words." and **Write it as plain words**.
- **Grouped ingredients (U2):** Ingredients becomes one `text-field rows=10` with the section's exact lines. Help: "Each ingredient starts with a dash. A line starting with ### is a group name, like "For the crust"."
- **Plain Words fallback:** the post opens in slice 1's Words field.
  - Above it, an `alert-banner variant="info"` says "This recipe is open as plain words, so nothing in it gets moved around."
  - **Why?** opens Details at "Recipe boxes", which gives the reason, for example "Ingredients appears twice (lines 12 and 31)." Studio never guesses.
- **More** (`dropdown-menu`):
  - **More about this recipe**, a `side-sheet` with Course, Cuisine and Series. Course help: "Like Dessert or Dinner. Readers can find recipes by it."
  - **Write it as plain words** or **Use the recipe boxes** (disabled when the post doesn't fit)
  - **Save draft** (phone)
  - **Take it off my site**
  - **Show details**
  - **See it on your site**
  - **Open in the old Admin**
  - **Delete this post**
- **Phone bar:** two buttons, **See how it looks** and the primary. Three don't fit at 400 px. On the phone, Save draft and **Make it a draft again** move into More; autosave and the status line cover them. *This changes a slice 1 decision, so the stakeholder needs to confirm it, and Grammi's walk-through should check it.*
- **Existing bug:** in `studio-write-400.png` the bar covers the Time field. Pad content by the bar's height.

## 2. Starting a recipe or a story (U1)

**Job:** "What am I writing today?" **Primary:** picking one.

```
400 px                                 Desktop
+--------------------------------+     +-------+--------------------------------------------+
| Home > New post                |     |       | What are you writing?                      |
| What are you writing?          |     |       | +-----------------+ +-----------------+    |
| | A recipe                   | |     |       | | A recipe        | | A story         |    |
| | Ingredients, steps, and    | |     |       | | Ingredients ... | | Words and ...   |    |
| | how long it takes.         | |     |       | +-----------------+ +-----------------+    |
| | A story                    | |     +-------+--------------------------------------------+
| | Words and pictures, like a | |
| | letter or a memory.        | |
+--------------------------------+
```

- **Cards:** two `content-card href` in an `auto-grid` (`#/write/new/recipe`, `#/write/new/story`). The route is replaced, so Back returns Home.
- **Focus:** starts on the question (`h2 tabindex=-1`). After she picks, it moves to Title, and the status line says "New recipe. Add a title and your draft will save itself."
- **Changing her mind:** until the first save, a ghost button offers **Make it a story instead** (or the reverse). Sites with no recipe profile skip the question.
- **Palette:** "Write a new recipe" and "Write a new story" go straight there.

## 3. Pictures

**Job:** "Which photos do I have?" **Primary:** **Add photos**. It's a new nav item after Posts, at `#/pictures`.

```
400 px                                 Desktop
+--------------------------------+     +---------+----------------------------------------+
| 48 pictures on your site       |     | Home    | 48 pictures on your site               |
| +- - - - - - - - - - - - - - + |     | Posts   | +- - - - - - - - - - - - - - - - - - + |
| | Add photos                 | |     |>Pictures| | Add photos  From your phone or ... | |
| | From your phone or computer| |     |         | +- - - - - - - - - - - - - - - - - - + |
| +- - - - - - - - - - - - - - + |     |         | [img][img][img][img][img][img]         |
| [img][img][img] (7rem tiles)   |     |         | [img][img][spin][img][img][img] (9rem) |
+--------------------------------+     +---------+----------------------------------------+
```

- **Add:** `file-drop accept="image/*" multiple` with prompt "Add photos" (gap 1) and hint "From your phone or computer. You can choose more than one."
  - Each photo gets a tile at once, with a `loading-spinner` "Adding…".
  - Toast: "Photo added." or "Added 3 photos."
  - If one fails: `alert-banner variant="danger"` "IMG_2041.heic didn't go in", then the server's sentence.
- **List:** an `auto-grid`, newest first.
  - Each tile is a button named by its readable file name ("pumpkin pie"). It opens a `side-sheet`, "Picture": the picture large, plus its address and **Copy the address** for Mikey.
- **States:**
  - **Loading:** `skeleton-block` tiles with `aria-busy`.
  - **Empty:** `empty-state` "No pictures yet" / "Photos you add here or to a post will show up here.", with the `file-drop` inside.
  - **Error:** `alert-banner variant="danger"` "Your pictures didn't load", the reason, **Try again**.
- **More than 300 (`more`):** the lede says "Your newest 300 pictures", and the end of the grid says "Older pictures are still on your site and in your posts."
- **Palette:** "Go to Pictures", "Add photos".

## 4. Put a picture in

- **Button:** a secondary `action-button` under Your story and under the notes. Studio remembers the cursor when the field loses focus; with none, the picture goes at the end.
- **Picker:** a `modal-dialog` in `picture-picker.js`, shared with the cover photo.
  - **Step 1, "Put a picture in":** a `file-drop` "Add a photo" (hint "From your phone or computer."), then "Or use one already on your site" (tile buttons, newest 300, lazy). **Never mind** closes it.
  - **Step 2:** the picture and a required `text-field` "Describe the picture", with help "For people who can't see it, like "Pie cooling on the windowsill"." Buttons: **Put it in** (primary) and **Choose another**.
  - **Empty description:** "Describe the picture first, so everyone can enjoy it." Focus goes to the field.
- **What goes in:** `![description](url)`, escaped by `image-markdown.js`, as its own paragraph at the end of the paragraph holding the cursor. It never goes mid-sentence, where it would split her words.
  - Focus returns after it.
  - Toast: "Picture put in your story." or "…your notes."
- **Under the field:** a thumbnail strip. Each thumbnail is a button named by its description that selects its line. Help: "Each picture is a line starting with ![. Tap one to find it."
- **Focus:** opens on Add a photo, then Describe. Escape inserts nothing and returns to the button.

## 5. See how it looks

**Job:** "Show me what my readers will see." It never publishes.

```
400 px (full screen)                   Desktop (wide sheet; Write still visible at left)
+--------------------------------+     +-------------+--------------------------------------+
| How it looks [Back to writing] |     | (Write)     | How it looks       [Back to writing] |
| Only you can see this. Nothing |     |             | Only you can see this. Nothing is    |
| is published.                  |     |             | published. Show it on [Phone|Computer]|
| ! A few things to check (2)    |     |             | ! A few things to check (2)          |
|   Ingredient 3 ... [Go to it]  |     |             |   Ingredient 3 ...       [Go to it]  |
| [ iframe, full width         ] |     |             | [ iframe                           ] |
+--------------------------------+     +-------------+--------------------------------------+
```

- **Frame:** a `side-sheet side="right"`, which is full screen at 400 px and `min(64rem, 75vw)` on desktop (gap 2).
  - On desktop, a `segmented-control` "Show it on" offers Computer (the default) and Phone (390 px, centred on sage).
  - iframe `sandbox="allow-scripts"`, `title="How Grammi's Pumpkin Pie will look"`, focused once loaded. Escape and **Back to writing** return focus to the opener.
- **Content:** the fields as they are now, saved or not (`POST preview`); a 404 retries once.
- **Loading:** `loading-spinner` "Getting it ready…". After 8 s: "Still working. Your whole site is being put together."
- **Error:** `alert-banner variant="danger"` "The preview didn't open", the reason, **Try again**.
- **Recipe problems:** an `alert-banner variant="warning"`, "A few things to check (2)". Each item's **Go to it** closes the sheet and focuses the field or row. With no problems, nothing shows. `recipe-advice.js` rewrites the old Admin's `RECIPE_ADVICE`, using Studio's field names instead of "In Settings":

| Code | Her words |
| --- | --- |
| `no-ingredients` / `no-steps` | "There are no ingredients yet." / "There are no steps yet." |
| `empty-ingredient` | "Ingredient 3 is empty. Write it or remove it." |
| `unreadable-quantity` | "Ingredient 3 starts with an amount readers can't double. Write it like 2, 1.5, 1/2 or 1 1/2." |
| `numbered-step` | "Step 2 starts with its own number. Take it out; Studio numbers the steps." |
| `servings-not-numeric` | "Serves should start with a number, like 8, so readers can make more or less." |
| `time-not-exported` / `incomplete-times` | "Time to cook can't be read as a length of time. Write it like 20 minutes." / "Only one of the times is filled in. Add the other." |
| no course or cuisine | "Add a course, like Dessert, so readers find it with the others." (opens More about this recipe) |
| TODO left / unknown | "Some lines still say TODO." / "Something in this recipe needs a look." (the code goes in Details) |

## 6. Take it off my site

- **Where:** More and the palette, for published posts only. Scheduled posts keep **Make it a draft again**.
- **The question:** a `modal-dialog`.
  - Heading: "Take Grammi's Pumpkin Pie off your site?"
  - Text: "Readers stop seeing it in about a minute. It stays here as a draft with your latest changes, and you can publish it again any time."
  - Buttons: **Take it off my site** (primary, focused) and **Keep it up**.
- **Afterwards:**
  - Toast (per `publish.js`): "Taken off your site. It's a draft again." The primary becomes **Publish**; Details shows the write and publish result.

## 7. Delete, with Undo (U4)

- **Where:**
  - Write's More: **Delete this post**, last. The palette has it too.
  - Posts: each row ends with a `dropdown-menu`, trigger "⋯", named "More for Pumpkin bread". It holds **Open it** and **Delete**.
- **Drafts and scheduled posts:** nothing is asked. Pending changes save first, so Undo restores what she saw.
- **Published posts:** a `modal-dialog` asks once.
  - Heading: "Delete Sweet potato pie?"
  - Text: "It's on your site now. Deleting takes it off your site and out of your posts. If you only want it off your site for now, take it off and keep it as a draft."
  - Buttons: **Take it off my site instead** (primary, focused), **Delete it** (destructive), **Keep it**. Escape means Keep it.
- **The Undo banner:** a shell-level `alert-banner variant="info" dismissible` under the top bar. Write moves to Posts.
  - Heading: "Deleted "Pumpkin bread"." A published post adds "Readers stop seeing it in about a minute."
  - Buttons: **Undo**, and **Details** (ghost) for "What Studio did": the file, its place in the trash, and the publish result.
  - Focus goes to **Undo**, and the heading is announced politely.
- **Undo:** `POST document/restore`, then the toast ""Pumpkin bread" is back." A published post adds "It's back on your site in about a minute."
  - If the trash file is gone (404): "Pumpkin bread can't come back from here. The person who set up your site may still find it."
  - If the name is taken (409): "There's a new post with that name now. Delete that one first, then Undo."
- **How long it lasts (U4):** until she dismisses it, deletes again (the newest replaces it), signs out or closes Studio.
  - It's in the shell and `sessionStorage`, so leaving a screen or reloading keeps it. Afterwards, Mikey finds the trash path in the palette's "Show what Studio last did".

## 8. Rows: moving, keyboard, screen readers (U3)

- **Phone:** Move up or Move down closes the menu. Focus returns to the moved row's **Move**, so a second tap keeps going. The row flashes sage for 240 ms, or doesn't under reduced motion.
- **Keyboard, inside a row:**

| Keys | Does |
| --- | --- |
| Alt+↑ / Alt+↓ | Moves the row; focus and cursor stay |
| Enter | Adds a row below and focuses it |
| Backspace in an empty row | Removes it and focuses the end of the previous row |
| Tab | Goes field, then Move, then the next row |

- **One polite live region per list:** "Moved to step 2 of 4." / "Ingredient 7 of 7 added." / "Removed ingredient 3. 5 left." / "Can't move up: this is the first step."
- **Names:** "Step 2 of 4", with the list's help via `aria-describedby`; numbers update after a move.
- **Palette, This post:** Move row up/down (Alt ↑/↓), See how it looks, Take it off my site, Delete this post, Write it as plain words.

## 9. Zubra UI gaps (fix upstream, then re-vendor)

1. `file-drop`: `prompt` prop (deferred from slice 1).
2. `side-sheet`: `size` or `--sheet-width`, for the wide preview.
3. `dropdown-menu`: an item `variant="destructive"` and separators.
4. `alert-banner`: shell-level placement. For now it lives in a Studio slot in `shell.js`, noted as a Studio part.

Studio-only parts (classes on tokens): the recipe row, the thumbnail strip, the preview frame wrapper.
