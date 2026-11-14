# Studio UX, retirement slice R6: Add something (writing help)

By `studio-ux`, 2026-11-13. Sources: `studio-ux`, `retirement-plan.md` (§1 B "Visual / Markdown modes", "Add something", "Paste cleanup", "Plain-language checks", "Beside the draft"; §1 I `block-forms.js`, `checks.js`, `paste.js`; §3 CSP; §4 R6; Decided 4), `r4/ux.md`, `r5/ux.md`, `docs/content.md` §Markdown–§Images, `docs/research-profile.md`, `web/admin/block-forms.js`, `web/admin/admin.js` (format toolbar 22292–22334, `openAddSomething` 23041, `editBlockWithForm` 22990, `visualProtectedLabel` 9604, `chooseBodyImage`/`placeImage` 25202, `openKnowledgeCheck` 25963, `openCodeInteraction` 25307, `codeInteractionMarkdown` 8938, `addResearchSection` 23601, `insertResearchSection` 9971), `web/admin/{checks,checks-panel,paste}.js`, `crates/openblog-core/src/{piece,compare,embed,markdown}.rs`, `crates/openblog-cli/src/admin.rs` (`build_piece` 18446, meta 4436–4470), Studio's `screens/write.js`, `parts/{write-page,body-host,recipe-editor,job-body,write-job,photo-strip,image-markdown,picture-picker,preview,sheet,undo}.js`.

**Owners:**
- **Grammi** (recipes): a tip box ("Make the crust the day before"), a turkey-time table, her pie video, a link to her crust recipe, a "Can I freeze it?" question. She must never see `> [!TIP]` or a fence.
- **Dana** (roofer): opening hours, how to reach her, before-and-after photos on a job.
- **Mikey:** code blocks with titles and highlighted lines, runnable examples, footnotes, CodePen, the words exactly as written, and the truth about what each piece writes.

**The job:** "Put something in my post besides words, right where I am, and change it later without touching anything strange." After R6, nothing about the post body opens the old Admin.

**Her words:** "your blog", "add", "put in", "take out", "tip", "note", "checklist", "table", "video", "link", "heading", "quote", "describe the photo", "words under it". **Never on her layer:** markdown, shortcode, syntax, fence, block, piece, snippet, embed, iframe, HTML, callout, alt text, caption, directive, render, widget, "Studio", "Admin". Those go under **For the person who set up your site**.

| Job | Lands in | Route | Replaces |
| --- | --- | --- | --- |
| Put something in the words | **Add something** sheet | `#/write/<path>?add=1` (and `?add=<kind>`) | old Add something, Insert image, Add knowledge check, toolbar Link/Quote/Heading |
| See and change what's in the words | **Cards in place** in Words, Your story, notes, job parts | `#/write/<path>` | old Visual editor protected blocks + block forms |
| The words exactly as written | **Show the words as written** (Mikey) | same, sessionStorage `studio-as-written:<path>` | old Markdown mode |
| Paste from a website or email | every box she types in | same | old `paste.js` (Visual only) |
| Gentle suggestions | **Suggestions** under the words | same | old `checks-panel.js` |
| Runnable code, footnote, CodePen, code block | Add something › **For the person who set up your site** | same | old Assistant › Interactions (by hand), Code button |

**`legacyRoute`:** nothing new. **Route wiring:** `write` reads `?add=1` (menu) or `?add=<kind>` (that form) after `load()`, then `replaceRoute` drops the query.

## Flow

```
Write (#/write/<path>)
  | caret in a box (Words / Your story / notes / a job part)
  | [Put a photo in] [Add something]   or   "/" alone on a line   or   Find "Add a table"
  v
Add something (side-sheet; full screen under 30rem)
  | "It goes in Your story, after “My mother made this every…”."
  | list of things, grouped  -->  choose one
  v
The thing's form (same sheet, step 2)    [‹ Everything you can add]
  | fields, live sketch, [See it in your post] [Add it]
  v
Write: the card sits in place, focus on it; toast "Tip added." [Undo]
  | card: [Change] [Move v: Move up / Move down / Take it out]
  v
Change -> same form, filled in -> [Done]  ("Tip changed." [Undo])
```

**Getting back:** **Never mind**, × or Escape closes; focus returns to the box at the caret (or the card after Add/Done). **‹ Everything you can add** (Alt+←) goes back to the list. A filled-in form asks before closing.

## Inventory: everything the old Admin puts in a post

| Old Admin | Writes | R6 | Layer | Why |
| --- | --- | --- | --- | --- |
| Insert image; drop/paste a photo | `![alt](url)` | **A photo**: picker + "Describe it" + optional **Words under it** | her | most used; "Put a photo in" keeps its place |
| Image with caption | `piece image` | same item, when Words under it is filled | her | one photo item |
| Heading 2–6 | `## …` | **A heading** (2); 2–6 in details | her / Mikey | |
| Bold, Italic | `**…**`, `_…_` | Ctrl/⌘ B, I wrap the selection | both, no button | |
| Link | `[w](url)` | **A link**: one of your posts, or another website | her | |
| Quote | `> …` | **A quote** (+ who said it) | her | |
| Bullets, Numbers | `- `, `1. ` | drop as buttons | — | Words help says "start each line with a dash" |
| Code | `` ` ``, fences | **Code** (fenced, options); inline typed | Mikey | |
| Call-outs | `> [!TIP]` … | **A tip or a note**: Tip, Note, Watch out (+ Important, Caution in details) | her / Mikey | works with no signal |
| Task list (edit only) | `- [ ] …` | **A checklist**, now also added | her | |
| Table (edit only) | GFM table | **A table**, now also added | her | |
| Video piece | `piece video` | **A video** | her | |
| Bare YouTube/CodePen link | bare URL | edit keeps the bare line; new YouTube is `piece video`; **A CodePen** in details | her / Mikey | |
| Map piece | `piece map` | **A map** from a pasted map link | her | lat/lon in details |
| Opening hours, Contact | `piece hours`, `piece contact` | **Opening hours**, **How to reach you** | her on trade sites, else details | |
| Social links | `piece social` | **Links to your other pages** | her | |
| FAQ | `piece faq` | **Questions and answers** | her | |
| Button | `piece button` | **A button** (look in details) | her | |
| Before and after | `compare` fence | **Before and after photos** (job posts: filled from photos marked Before/After) | her | |
| Knowledge check (+ Generate) | `quiz` fence | **A question for readers**; Generate is **R8** | her | Decided 4 |
| Runnable code (+ Generate) | `codeInteractionMarkdown` | **Code readers can run**; Generate is **R8** | Mikey | Decided 4 |
| Abstract, References | `## Abstract` / `## References` | the same two, research posts only | research author | |
| Cite, Claim, Research panel | — | **R11/R12** | — | |
| Footnote (protected only) | `[^n]` + `[^n]: …` | **A footnote** (insert + edit) | Mikey | |
| Paste cleanup | Markdown | every box | both | |
| Plain-language checks | — | **Suggestions** | her (quiet) | |
| Raw HTML, `demo`, `quote` fence, unknown fences, indented code | as written | **Kept as it is** card, no insert | Mikey edits as written | |
| Setext headings, `---`, strikethrough, reference links, complex lists | as written | stay as text | — | |
| Galleries | — | **drop** | — | neither engine nor old Admin has one; several photos are several photos |

## Write after R6

1. **Add something** sits beside every **Put a photo in**.
2. Photos and every other piece show as **cards in place**; the box never shows syntax. Cards replace today's photo strip; the job's Before/After choice moves onto the photo card.
3. **Suggestions** appear under the words when there are any.

```
400 px                                       Desktop (>= 48rem): words 1fr | 22rem side
+------------------------------------------+
| Home > Posts > Pumpkin pie      [More v] |
| Draft · saved just now                   |
| Title [Pumpkin pie                    ]  |
| Words                                    |  segment 1 (label shown)
| +--------------------------------------+ |
| | My mother made this every            | |
| | Thanksgiving, and so do I.           | |
| +--------------------------------------+ |
| +--------------------------------------+ |  photo card
| | [thumb] Pie cooling on the sill      | |
| |         Words under it: Fresh from   | |
| |         the oven                     | |
| | [Change]              [Move v]       | |
| +--------------------------------------+ |
| +--------------------------------------+ |  tip card, tinted, kind badge
| | (Tip) Make ahead                     | |
| | Bake the crust the day before and    | |
| | keep it wrapped.                     | |
| | [Change]              [Move v]       | |
| +--------------------------------------+ |
| +--------------------------------------+ |  segment 2 ("Words, part 2 of 2")
| | Preheat the oven to 425.             | |
| +--------------------------------------+ |
| [Put a photo in]  [Add something]        |
| > 2 suggestions for your words           |  details, closed (only when any)
|==========================================|
| [See how it looks] [Save draft] [Publish]|
+------------------------------------------+
```

At 320 px the two buttons stack full width; card buttons wrap under the sketch; a table card shows at most three columns then "+2 more columns".

**Words help:** "Leave an empty line between paragraphs. For a list, start each line with a dash (-). Photos, tips and tables show as cards: change them with their buttons."

**Accessible names:** "Add something to Words" (or "…to Your story", "…to Grammi's notes", "…to What we found"). Each recipe/job box that allows pieces gets its own pair.

### Cards in place (`parts/word-blocks.js`, `parts/piece-cards.js`)

- `splitBlocks(text)` → `[{type: "words"|"card", source, kind, gapBefore, gapAfter}]`; `joinBlocks(blocks)` returns the input **byte for byte** when nothing changed (tested on every post in `examples/` and `content/`).
- **Cards:** a photo line alone; callouts; task lists; tables; `piece` fences; `compare`; `quiz`; code fences (incl. `runnable`); a YouTube/Vimeo/CodePen link alone on a line; footnote definitions; raw HTML blocks; `demo`; `quote`; unknown fences; indented code. Everything else stays words.
- **Unclosed fence:** everything from that line on shows as written, with `alert-banner info` "Part of this post is open as written" / "So nothing in it gets moved around." Mikey sees "A code block starting on line 14 never ends".
- **Between cards:** no box between two cards; a quiet **Write here** link adds one. A box ending on a card gets an empty segment after it (placeholder "Keep writing…") that writes nothing until typed in.
- **Card buttons:** **Change** (form, filled in); **Move** (`dropdown-menu`: **Move up**, **Move down**, **Take it out**; moving swaps with the neighbouring block). A card the form can't write back exactly has no **Change** and shows "This one can't be changed here. The person who set up your site can." Move and Take it out still work.
- **Keyboard:** Alt+↑/↓ on a focused card moves it; ↓ on a box's last line and ↑ on its first line move focus to the neighbouring card.
- **Job photos:** the photo card carries R4's "Photo 2 shows" **Before · After · Neither**; `job.media` order follows card order.

| Kind | Card shows | Accessible name |
| --- | --- | --- |
| Photo | thumbnail, description, "Words under it: …" | "Photo: Pie cooling on the sill" |
| Photo by web address | picture + "This photo is on another website." | same |
| Tip / Note / Watch out / Important / Caution | kind badge, heading, first 3 lines | "Tip: Make ahead" |
| Checklist | first 4 items with ☐/☑, "+3 more" | "Checklist, 7 things" |
| Table | first 3 rows × 3 columns, "4 columns, 6 rows" | "Table, 4 columns, 6 rows" |
| Video (piece) | play icon, title, "From YouTube" | "Video: Rolling the crust" |
| Video link alone | "Video from YouTube" + link as text | same |
| Before and after | two thumbnails with their names | "Before and after photos: The dough, The loaf" |
| Questions and answers | "3 questions: Can I freeze it? …" | "Questions and answers, 3" |
| Question for readers | the question, "3 answers" | "Question for readers: …" |
| Button | its words, "Goes to: Order a pie" | "Button: Order a pie" |
| Links to your other pages | names joined with " · " | "Links: Facebook, Instagram" |
| Map | "Map: Elkins, West Virginia" (no tiles) | same |
| Opening hours / How to reach you | the rows / three lines | same |
| Code | "Code" + language + first 3 lines mono | "Code, Rust, 12 lines" |
| Code readers can run | "Code readers can run" + title | same |
| CodePen | "A CodePen" + address | same |
| Footnote | "Note at the bottom, 1: …" | same |
| Kept as it is | "Something the person who set up your site added" (or "A lesson demo", "Your quote request form") | same |

No card loads anything from another site; video and map cards are drawn locally (CSP unchanged).

## Add something (sheet)

- **Job:** "What do you want to put in?" `side-sheet side="right"`, "Add something", 26rem, full screen under 30rem; built once per Write screen in `parts/add-menu.js`.
- **Opens from:** each **Add something** button; Write's More ("Add something…"); Find ("Add something" + "Add a table"-style entries); `/` alone on an empty line in any of her boxes; `?add=`.
- **Where it goes** (lede, live): "It goes in Your story, after “My mother made this every…”." or "It goes at the end of your words." From an Ingredient or Step row: "It goes at the end of Grammi's notes." Pieces never go inside rows.
- **Focus:** by tap/click to the heading; by `/` or keyboard to **Find something to add**.

```
400 px (full screen)
+------------------------------------------+
| Add something                         [x]|
| It goes in Your story, after “My mother  |  aria-live
| made this every…”.                       |
| Find something to add [               ]  |  search, filters name + blurb
| -- Most used --------------------------  |  h3
| [ A photo                              ] |  full-width 56px buttons:
| [  One of your photos, with a few      ] |  name + blurb
| [  words about it.                     ] |
| [ A tip or a note ... ]                  |
| [ A checklist ... ] [ A table ... ]      |
| [ A video ... ] [ A link ... ]           |
| [ A heading ... ]                        |
| -- More things -----------------------   |  h3
| [ Before and after photos ... ] ...      |
| > For the person who set up your site    |  details, closed
|==========================================|
|                          [ Never mind ]  |
+------------------------------------------+
```

**Items** (`parts/add-words.js`, `addItems(meta, post)`):

| Item | Blurb | Shows when |
| --- | --- | --- |
| A photo | "One of your photos, with a few words about it." | always |
| A tip or a note | "A box that stands out, like “Make the crust the day before.”" | always |
| A checklist | "Things to tick off, like what to buy." | always |
| A table | "Rows and columns, like turkey weights and roasting times." | always |
| A video | "From YouTube or Vimeo." | always |
| A link | "To one of your posts or another website." | always |
| A heading | "A short title that starts a new part of your post." | always |
| Before and after photos | "Two photos side by side, like the dough and the loaf." | always; first group on job posts |
| A quote | "Someone's words, set apart." | always |
| Questions and answers | "Questions readers ask. Each opens to show your answer." | always |
| A question for readers | "A quick quiz: readers pick an answer and find out if they're right." | always |
| A button | "Takes readers to a page, an email or a phone number." | always |
| Links to your other pages | "Like your Facebook or Instagram." | always |
| A map | "Shows one place." | always |
| Opening hours | "The days and hours you're open." | trade, first group |
| How to reach you | "Your email, phone and address." | trade, first group |
| Abstract / References | "The short summary research posts start with." / "The list of works you cite, at the end." | research posts, first group |

**For the person who set up your site** (details, open per visit via sessionStorage `studio-add-details`): **Code**, **Code readers can run**, **A CodePen**, **A footnote**, **Opening hours** and **How to reach you** (non-trade sites), the toggle **Show the words as written**, and "Everything here writes ordinary Markdown into `content/posts/<file>.md`. Pieces are checked and written by your blog (`POST /admin/api/pieces`), so the file holds exactly what the build reads."

An item missing from `meta.pieces` (older server) is left out. No filter match: `empty-state` "Nothing called “gallery”." / "Try another word, or close this and keep writing."

### The slash

`/` as the only character on a line in any of her boxes opens the sheet with the filter focused; further letters go into the filter. The `/` stays until she adds something, which replaces that line; **Never mind**/Escape leaves it with the caret after it. "1/2 cup" never triggers (line not empty). Once per visit, toast: "Tip: type / on an empty line to add something."

### Each thing's form (step 2)

Frame: heading = item name; **‹ Everything you can add**; fields; **How it looks** (live sketch via `piece-cards.js`); sticky footer **See it in your post** (secondary) and **Add it** (or **Done** when changing). **See it in your post** opens the existing preview with the piece included; note "Only you can see this. Nothing is added until you press Add it." Client checks run on **Add it** (first problem gets `error` + `aria-describedby` + focus); server-built pieces then go through `POST pieces`.

| Item | Fields | Client checks | Writes | Signal |
| --- | --- | --- | --- | --- |
| **A photo** | picker (Add one from this phone / Your photos) → **Describe the photo** (required; "A few words for people who can't see it, like: A pumpkin pie on a blue plate.") → **Words under it** (optional; "Shown under the photo.") | "Describe the photo so everyone knows what it shows." | no words under: `imageMarkdown` (`/images/uploads/` only); with: `piece image` | needed |
| **A tip or a note** | **Kind** `segmented-control` Tip · Note · Watch out (+ current kind if Important/Caution); **A few words on top** (optional, "Like Make ahead.", max 80); **What it says** (rows 4) | "Write what the tip says." · "This can't hold code like <b>. Take out the part with < and >." | `> [!TIP]`/`[!NOTE]`/`[!WARNING]`; heading as `> **…**` + `>` (same bytes as `Piece::to_markdown`) | not needed |
| **A checklist** | rows: **Ticked** + "Thing 1"; **Add a thing** (Enter in the last row adds one); **Take it out** per row | "Write something on each line, or take the empty ones out." | `taskListMarkdown` | not needed |
| **A table** | desktop grid with top row "Column names"; ≤ 40rem each row a `fieldset` "Row 2" with fields labelled by column; **Add a row**, **Add a column**, **Take it out** per row/column | "Give at least one column a name." | `tableMarkdown` | not needed |
| **A video** | **YouTube or Vimeo link** ("Copy it from Share under the video."); **What it's about** (required; "Said before it plays, for people who can't see it.") | "That isn't a YouTube or Vimeo link. Copy it from Share under the video." · "Say what the video is about." | `piece video` | needed |
| **A link** | **Words to show** (the selection, if any); **Where it goes** One of your posts · Another website; posts → select (title, newest first, `documents?kind=posts` `url`); website → url | "Write the words people tap." · "That needs to be a web address, starting with https://." | `[words](/pumpkin-pie/)` inline at the caret | posts list needs a signal |
| **A heading** | **Heading** (one line, max 120) | "Write the heading." | `## …` own paragraph | not needed |
| **Before and after photos** | per side: picker, **Describe it** (required), **Words under it**, **Name for this side** (placeholder "Before"/"After") | "Choose the before photo." · "Describe the after photo." | `compare` fence | needed |
| **A quote** | **Their words** (rows 4); **Who said it** (optional) | "Write their words." | `> …` + `>` + `> — Name` | not needed |
| **Questions and answers** | rows **Question** + **Answer** (rows 3); **Add a question** (up to `list.max`) | "Write the question." / "Write the answer." | `piece faq` | needed |
| **A question for readers** | **The question**; **Answers** 2–4 with radio **This one is right**; **Add an answer**; **What to tell them after** (optional); **Add another question** (up to 3, each its own card) | "Write the question." · "Fill in each answer, or take it out." · "Choose the right answer." · "A question for readers can't hold links or photos." · "This can't have three ` marks in a row." | `quiz` fence (`quizMarkdown`) | not needed |
| **A button** | **What it says**; **Where it goes**: One of your posts · Another website · An email · A phone number | "Write what the button says." · "That doesn't look like an email address." · "Use only numbers, spaces and + - ( )." | `piece button` | needed |
| **Links to your other pages** | rows **Name** ("Like Facebook") + **Address** | "Write the name." · "A full web address, starting with https://." | `piece social` | needed |
| **A map** | **Place name** ("Shown beside the map."); **Map link** ("In OpenStreetMap or Google Maps, find the place, then copy the address from the top of the page."); live "Found it: 38.93, −79.85." | short link: "That's a short link, which doesn't say where the place is. Open it, then copy the long address from the top of the page." · "That link doesn't say where the place is." | `piece map` (`coordsFromMapLink`) | needed |
| **Opening hours** | **A note** (optional); rows **Days** + **Hours** | "Write the days." / "Write the hours, or Closed." | `piece hours` | needed |
| **How to reach you** | **Email**, **Phone**, **Address** | "Fill in at least one." | `piece contact` | needed |
| **Abstract / References** | no form | — | `## Abstract` at the start / `## References` at the end; caret under it | checked with `POST preview`; offline, a heading check by line |

Abstract or References already there: toast "This post already has an Abstract." with **Go to it**.

**Mikey's details in each form:** **What it writes** (`pre`, exact Markdown, after the check for server-built pieces); Photo **Picture address**; Tip all five kinds; Table column alignment; Video provider; Map **Latitude**, **Longitude**; Heading level 2–6; Button look (Filled/Outlined); Link/button "Or any address: /about/, mailto:, tel:".

**Forms for the person who set up your site:**

| Item | Fields | Checks | Writes |
| --- | --- | --- | --- |
| **Code** | Language (suggestions), Title, Code (mono, rows 12), Highlight lines ("Like 2,4-6"), Line numbers (Automatic · On · On, starting at… · Off) | "Line numbers look like 2,4-6." | fence one backtick longer than any run inside |
| **Code readers can run** | Kind (Example · Challenge), Language (`rust`, `web`, then `meta.codeRunnerLanguages`, `normalizeCodeRunnerLanguage`), Title, What to try, Code, Expected result + Hint (challenge), Explanation | "Fill in title, what to try and code." · "A challenge needs its expected result." · "Web code needs a ---html, ---css or ---js part." · "A challenge's starter code needs a TODO comment." · "No ``` inside." | `codeInteractionMarkdown` (byte for byte) |
| **A CodePen** | Pen address | "That isn't a CodePen address. It looks like https://codepen.io/name/pen/…" | bare link alone on a line |
| **A footnote** | Note text | "Write the note." | `[^n]` at the caret (next free n) + `[^n]: …` at the end |
| **Show the words as written** | toggle | — | each box becomes one plain box (this post, this visit), no cards; Add something inserts Markdown at the caret. Help: "Everything exactly as it's saved. Turn this off to see cards again." |

### Changing a piece already in the words

- **Change** opens the form filled in by the parsers (`parseCallout` + `> **Heading**`, `parseTaskList`, `parseTable`, `parseEmbed`, `parsePieceFence`, new `parseQuiz`, `parseCodeFence`, `parseCodeInteraction`, `parseFootnote`). A YouTube id shows as `https://www.youtube.com/watch?v=<id>`.
- **Done** with nothing changed writes the source back untouched. A change writes the same kind: a bare video link stays bare; an image piece with words under it cleared becomes a plain photo line only when its address is under `/images/uploads/`.
- **Links, headings, quotes** (stay words): caret in one, then Add something opens **Change this link** (heading, quote), filled in; links add **Take the link off** (words stay).
- Your story, notes and the four job parts take cards; Ingredient and Step rows never do.

### Undo, autosave, leaving

- **Statuses** (toast, polite live region): "Photo put in.", "Tip added.", "Checklist added.", "Table added.", "Video added.", "Link added.", "Heading added.", "Before and after photos added.", "Quote added.", "Questions and answers added.", "Question for readers added.", "Button added.", "Links added.", "Map added.", "Opening hours added.", "How to reach you added.", "Code added.", "Footnote added."; "<Thing> changed."; "<Thing> taken out."; "Moved up. It's now after “Preheat the oven…”."
- **Undo:** every add, change, take-out and move gives **Undo**, reversing only that action in the box's text as it is now (`pieceChange`/`undoPieceChange`), so typing since is kept, with the caret moved along. When the lines it changed can't be found intact: "This changed since, so it can't be undone here." and nothing changes. It stays until the next piece action and is in Find as "Undo: table added". Ctrl/⌘ Z in a box undoes typing only.
- **Saving:** an ordinary edit (drafts 3 s later; published waits for **Update**); `kept.js` holds the body.
- **Leaving a filled-in form** asks once via `createSheet`: adding "Add this table?" / "You filled it in but didn't add it." **Add it** / **Leave it out**; changing "Keep your changes to the table?" **Keep them** / **Leave it as it was**.
- **No signal** (server-built pieces): "Waiting for a signal. What you filled in is kept here. Press Add it when you have one."; values in sessionStorage `studio-add:<path>:<kind>`; after a reload the sheet's top shows **Finish adding the video**. Everything Studio writes itself works with no signal.

## Paste

Every box runs `pasteToMarkdown` (moved whole to `parts/paste.js`) on HTML pastes. Notices (`pasteNotice`, reworded): "Pasted. Headings, bold and links kept. Fonts and colours left out." (computer adds "Ctrl+Shift+V pastes plain words." / ⌘⇧V on a Mac); "1 photo was left out because it has no description. Put it in with Put a photo in." (or "3 photos were…"). A pasted or dropped photo file opens Put a photo in at the describe step. Recipe rows keep today's line splitting.

## Suggestions

`details` "2 suggestions for your words" under the last box, closed, shown only when any; updated 600 ms after typing stops. Never block; code and cards other than tips aren't checked (`parts/checks.js`, moved whole). Each: a line + **Show me** (focuses and selects, or opens the card's Change) and, when safe, **Fix it** (a describe-fix opens an inline field with **Use these words**). After a fix: "Fixed." with Undo. None left: "No suggestions. Nothing to fix."

| Rule | Her words | Fix |
| --- | --- | --- |
| `picture-description` | "A photo has no description, so people who can't see it won't know what it shows." | **Describe it** |
| `empty-link` | "A link has no words, so no one can tell where it goes." | **Add words** |
| `vague-link` | "The link “click here” doesn't say where it goes. Words like “my pie crust recipe” are easier to follow." | **Change the words** |
| `empty-address` | "A link doesn't go anywhere yet." | Show me |
| `insecure-address` | "This web address starts with http://. Most sites also work with https://, which is safer." | **Use https** |
| `heading-skip` | "This heading is smaller than it should be after the one before it." | **Fix it** |
| `all-caps` | "This is all in capital letters, which can read like shouting." | Show me |
| `long-paragraph` | "This paragraph is 180 words long. Shorter ones are easier to read on a phone." | Show me |
| `html` | Mikey only: "Line 12 has an HTML tag. It is kept and shown as written." | — |

R7's "Before you publish" lists the same suggestions, written once here.

## Errors by code (`POST pieces`, G44)

| Answer | Where | Her words |
| --- | --- | --- |
| 422 `required` + `field` (+ `item`) | that field | the form's sentence, else "Fill this in." |
| 422 `too-long` + `max` | field | "Shorter, please: 80 letters at most." |
| 422 `one-line` | field | "Keep this on one line." |
| 422 `bad-address` | field | "That needs to be a web address starting with https://, or one of your posts." |
| 422 `bad-video` | link | "That isn't a YouTube or Vimeo link. Copy it from Share under the video." |
| 422 `bad-email` / `bad-phone` | field | "That doesn't look like an email address." / "Use only numbers, spaces and + - ( )." |
| 422 `out-of-range` | Map link | "That map link points somewhere off the map. Copy it again." |
| 422 `html` | field | "This can't hold code like <b>. Take out the part with < and >." |
| 422 `bad-choice` | field | "Choose one of these." |
| 422 `unknown-kind`/`unknown-field`/`repeated` | form banner | "Your blog can't add this yet. The person who set up your site can update it." |
| 413 `too-large`/`too-many` | form banner | "That's too much for one piece. Split it into two." |
| 400 | form banner | "That didn't work. Tell the person who set up your site." |
| 401 | shell | "Sign in again"; form stays filled in |
| no answer | footer | "Waiting for a signal. What you filled in is kept here. Press Add it when you have one." |
| 5xx | footer | "Your blog didn't answer, so it isn't in yet. What you filled in is kept." **Try again** |
| upload refused | picker | today's `photoProblem` |

Until G44, `pieceProblem(message)` maps today's strings to field codes; unmatched: "Check what you filled in against the help under each box." (sentence in details).

## What each owner sees

| | Grammi / Dana | Mikey |
| --- | --- | --- |
| In the words | words and cards | **Show the words as written** |
| Add | 14 things in two groups (+ hours/contact on trade; Abstract/References on research) | + Code, Code readers can run, CodePen, Footnote, hours/contact anywhere |
| A form | plain fields, sketch, See it in your post | What it writes; levels, alignment, kinds, coordinates, addresses |
| Card that can't be changed | Move, Take it out | + source read-only, "Change it in the words as written" |
| Suggestions | sentences, Fix it | + HTML notes |
| Errors | field-linked sentences | + server's sentence |

## Rules each part uses (static imports, DOM-free, tested)

| Part | File | Functions |
| --- | --- | --- |
| Block forms (lifted) | `parts/block-forms.js` | `parseCallout` (+ heading), `calloutMarkdown`, `parseTaskList`, `taskListMarkdown`, `parseTable`, `tableMarkdown`, `parseEmbed`, `embedProblem`, `parsePieceFence`, `editableBlockKind`, `hasHtmlTag` |
| Cards | new `parts/word-blocks.js` | `splitBlocks`, `joinBlocks`, `blockKind`, `insertBlock(text, caret, md)`, `moveBlock`, `removeBlock`, `segmentAt`, `nextFootnote`, `addFootnote` |
| Card words | `parts/piece-cards.js` (DOM) + `parts/piece-words.js` (pure) | `cardSummary`, `cardName`, `thingName` |
| Menu | `parts/add-words.js` | `ADD_ITEMS`, `addItems(meta, post)`, `whereItGoes(box, text, caret)`, `filterItems(q)` |
| Forms | `parts/piece-forms.js` (DOM) | from `meta.pieces`/`meta.compare` with `PIECE_LABELS` |
| Pieces | `parts/piece-rules.js` | `pieceValues`, `videoLink`, `coordsFromMapLink`, `hrefFor`, `pieceProblem` |
| Quiz | `parts/quiz-rules.js` | `quizMarkdown`, `parseQuiz`, `quizProblems` |
| Code | `parts/code-rules.js` | `codeFenceMarkdown`, `parseCodeFence`, `codeInteractionMarkdown` (lifted), `codeInteractionProblems` |
| Research | `parts/research-sections.js` | `insertResearchSection`, `researchSectionIsPresent` (lifted) |
| Paste, checks | `parts/paste.js`, `parts/checks.js` (moved whole) | + `pasteWords`, `checkWords` |

- **Port:** `admin-block-forms`, `admin-compare` (client half) → `studio-block-forms`; `admin-checks` → `studio-checks`; `admin-paste` → `studio-paste`; code-interaction cases of `admin-assistant-interactions` → `studio-code-rules`; research-section cases of `admin-draft-research` → `studio-research-sections`; browser `add-something`, `before-after-editor`, `visual-pieces`, editor half of `photos` → `studio-add.spec.mjs`, `studio-word-cards.spec.mjs`. Visual-editor tests are deleted in R15.
- **New:** every example post round-trips through `splitBlocks`/`joinBlocks` byte for byte; **Done** with no change writes nothing; a tip with a heading equals `POST pieces` callout output; "1/2 cup" opens nothing; Take it out + Undo restores exact bytes; a recipe stays in boxes after a tip in Your story; job Before/After follows card moves; an unclosed fence makes the rest of the box plain words; offline a table goes in and a video waits with its values kept.

## Accessibility and keyboard

- **Write order:** title, numbers, then per box: segments and cards in reading order, **Put a photo in**, **Add something**; then Suggestions, side column, bar.
- **Sheet order:** heading, where it goes, filter, groups (h3), details, **Never mind**. Form: back, heading, fields, sketch, details, **See it in your post**, **Add it**.
- Items are buttons named by the item, `aria-describedby` the blurb; the filter announces "6 things" politely.
- **Keys:** `/` on an empty line; Escape closes (asking if filled in); Alt+← back to the list; Ctrl/⌘ Enter in a form = **Add it** (Publish shortcut suspended while open); Ctrl/⌘ B/I; Alt+↑/↓ moves a card; Ctrl/⌘ K then "Add a table".
- **Find:** "Add something", "Add <item>" per visible item, "Show the words as written", "Suggestions", "Undo: <last piece action>".
- **Rows in forms:** full names ("Take out thing 3", "Row 2, Cups"); adding/removing announced ("Thing 4 added.") and focus follows.
- **Cards:** `role="group"` named by the card; after add/change/move focus to the card; after take-out to the box before it, at its end.
- **320 px:** full-screen sheet, sticky footer above the keyboard; table form becomes row fieldsets; card buttons stack; no sideways scroll; controls ≥ 44 px; item buttons 56 px.
- **Reduced motion:** no slide, no highlight; otherwise a new card's outline fades once.
- **Zubra:** `side-sheet`, `text-field`, `select-field`, `segmented-control`, `toggle-switch`, `file-drop`, `content-card`, `status-badge`, `action-button`, `dropdown-menu`, `alert-banner`, `toast-region`, `empty-state`, `modal-dialog`, `loading-spinner`, `command-palette`, `cluster-layout`. Checkboxes and radios use the native `fieldset` fallback (noted, not a fork).

## Safety

- Studio never builds `piece`/`compare` fences itself: they come from `POST pieces`. Callouts, tasks, tables, quiz and code use the lifted writers with their round-trip rule.
- `hasHtmlTag` on tip text; quiz text refuses links and images.
- Every value in a card, form or suggestion is `textContent`. Photo cards load only `/images/` or the https address in the file, `referrerpolicy="no-referrer"`. No card loads a frame.
- Paste is the pure converter (no DOM parsing of clipboard HTML).
- CSP: R6 adds nothing; `frame-src https://codepen.io` and `'wasm-unsafe-eval'` stay R8's decision.

## Gaps

- **G44. Codes on `POST pieces` problems:** 422 `{error, problems: [{field, item, code, message}]}` with `required`, `too-long` (+ `max`), `one-line`, `bad-address`, `bad-video`, `bad-email`, `bad-phone`, `bad-choice`, `out-of-range`, `html`, `unknown-field`, `repeated`, `unknown-kind`; 413 `too-large`/`too-many`; 400 `bad-request`. Same for `compare`. Strings stay as `message` for one release.
- **G45. Quiz and code checked through `POST pieces`:** `kind: "quiz"` (`question`, `answer`, `right`, `explanation`) and `kind: "code"` (`language`, `title`, `highlight`, `lineNumbers`, `runnable`, `body`) return `markdown` or G44 problems using `markdown.rs`'s validators, so Studio's forms and `openblog check` agree. Until then Studio uses the lifted client checks.
- **Not gaps:** `meta.pieces`, `meta.compare`, `meta.codeRunnerLanguages`, `meta.siteUses.trade`; `upload`, `images`; `documents?kind=posts`; `POST preview`.

## Risks to test before release

- A post from the old Admin with every block kind: open in Write, save with no change, nothing rewritten.
- iPhone at 320 px: `/` on an empty line, add a tip, card, Undo, keyboard over the sticky footer.
- A recipe with a tip in Your story and a table in notes still opens in boxes; scaling and timers unaffected.
- A job: moving a photo card reorders Before/After.
- No signal: a table goes in; a video waits, survives a reload, then goes in.
- A hand-written `piece` fence with an unknown field shows no Change; Move keeps it intact.

## Docs and release note

- Rewrite `docs/admin.md` §Writing (Add something, cards, Show the words as written, Suggestions, paste). In `docs/content.md`, the old "**Add something**" and "**Add knowledge check**" become Write's **Add something**; runnable code becomes "Add something › For the person who set up your site › Code readers can run".
- **Release note (Mikey):** the Visual/Markdown modes are gone; words show pieces as cards and **Show the words as written** gives the raw text; tables and checklists can now be added; knowledge checks and runnable code are added by hand (generation comes in R8); footnotes have a form.

## Changes to `studio-ux` (adopted)

- Banned on her layer, add: markdown, shortcode, syntax, fence, block, piece, snippet, embed, iframe, HTML, callout, alt text, caption. She hears "add", "put in", "take out", "describe the photo", "words under it".
- **No syntax on her layer.** Anything in her words that isn't plain words shows as a card in place with Change, Move and Take it out. Raw text is Mikey's, behind **Show the words as written**.
- **Add says where.** Anything she adds goes where she was, and the screen says where first.
- **A form that writes into the file writes it the way it was.** An unchanged form writes nothing; a form is offered only when it can write the block back exactly.
- Review checklist: "Every kind of thing the old screen could insert or edit is on her layer, in details, or dropped with a written reason; every card can be moved, taken out and undone."
