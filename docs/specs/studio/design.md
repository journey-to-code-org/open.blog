# Studio design, slice 1: sign in and write

By `studio-senior-ux`, 2026-11-12, from `brief.md` and `studio-ux`. Component names are Zubra UI
elements; "gap N" is a shortfall to fix upstream (section 5).

## 1. Visual identity

**Idea: a well-used kitchen table.** Flour-white surface, ink readable without glasses, one deep
plum accent (damson jam, not terracotta), sage for quiet surfaces. Calm comes from space and large
type, not decoration; nothing is about recipes, so it fits any owner.

### Colours (6 named, light / dark)

| Token | Light | Dark | Use | Feeds Zubra UI |
| --- | --- | --- | --- | --- |
| `--studio-flour` | `#f8f7f2` | `#1b151a` | page | `--background`, `--popover`; `--primary-foreground` (light) |
| `--studio-flour-lift` | `#fdfdfa` | `#251e24` | fields, cards, sheets | `--card` |
| `--studio-ink` | `#291d27` | `#edebe4` | text | `--foreground`, `--card-/--popover-/--secondary-/--accent-foreground`; `--primary-foreground` (dark) |
| `--studio-ink-soft` | `#625760` | `#b4b1a7` | dates, help, meta | `--muted-foreground` |
| `--studio-damson` | `#87305f` | `#eba6c6` | the one accent: primary button, current nav, focus | `--primary`, `--ring` |
| `--studio-sage` | `#e0eee2` | `#232f25` | quiet surfaces: sidebar, chips, hover | `--muted`, `--secondary`, `--accent` |
| `--studio-linen` | `#d3d5cd` / field `#8d828c` | `#3d353c` / field `#70656e` | dividers / field edges | `--border` / `--input` |
| `--studio-beet` | `#af2934` | `#f17070` | danger only | `--destructive` |

Flour-lift and ink-soft are steps, not new hues. Contrast (light / dark): ink on flour 15.0 / 15.1;
ink-soft 6.4 / 8.4; damson both ways 7.5 / 9.3; beet 6.1 / 6.3; field edges 3.4 / 3.2. Success and
warning stay Zubra UI's green and amber (gap 6), always with a word. Written as `oklch()` in
`studio.css`; light and dark follow the device, no switch in this slice.

### Type

| Family | Package (self-hosted woff2, OFL-1.1) | Where |
| --- | --- | --- |
| Atkinson Hyperlegible Next | `@fontsource-variable/atkinson-hyperlegible-next` | all UI text, buttons, labels |
| Literata | `@fontsource-variable/literata` | screen titles, Home's question, and **her writing**: the Title and Words fields |
| Atkinson Hyperlegible Mono | `@fontsource-variable/atkinson-hyperlegible-mono` | Mikey's details only (file path, commit) |

Atkinson is drawn for low-vision readers; Literata for long screen reading, so Words reads like a
page, not a form. Latin subsets only.

**Scale (root 18 px, ratio 1.25):** `--text-sm` 0.875rem (15.75 px, the floor; meta only),
`--text-base` 1rem (18), `--text-lg` 1.25rem (22.5), `--text-xl` 1.5rem (27, screen title in
content), `--text-2xl` 2rem (36, Home's question). Line height 1.55 body, 1.2 headings; headings
weight 600, never all caps, no letter-spaced eyebrow labels.

**Root font size is 112.5 %.** Zubra UI sizes everything in `rem`, so this one line takes every
component up together: `action-button` md becomes 45 px tall (meets 44), field labels 16.6 px,
help 15.3 px. Studio never uses `size="sm"` buttons (36 px).

### Space, radius, elevation, motion

- **Space** `--space-1..8`: 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4 rem. Fields stack at `--space-5`;
  sections at `--space-7`; page gutter `--space-4` (phone) / `--space-6` (desktop).
- **Radius** `--radius: 0.75rem` (feeds Zubra UI's `--radius`; buttons get 0.75rem - 2px). Soft,
  not pill.
- **Elevation, two levels only.** Level 0: flat, separated by linen hairlines and sage surfaces;
  lists are rows, not boxes. Level 1 (menus, sheets, dialogs, toasts): a damson-tinted shadow
  `--shadow-1: 0 0.5rem 1.5rem oklch(0.25 0.05 340 / 0.14)` (gap 7). No grey card shadows.
- **Motion** keeps Zubra UI's tokens, slowed slightly (`--duration-normal: 240ms`); only sheets,
  menus and toasts move, and nothing does under reduced motion.

## 2. Information architecture

The site's own name is the brand at the top of the sidebar ("Grammi's House"), with "Studio"
under it in ink-soft: it is her place, not open.blog's. Areas, in her words, in brief order:

| Area | Job | Slice |
| --- | --- | --- |
| **Home** | "What would you like to do?" | 1 |
| **Posts** | "What have I written?"; Write opens from here | 1 (recipe-aware in 2) |
| **Pictures** | "Which photos do I have?" | 2 |
| **Seasons** | "When does the house change?" (decorations) | 3 |
| **Front page** | "What do visitors see first?" (sign, birthday cards, history) | 4 |
| **Cards** | "Who gets a card, and when?" | 5 |
| **Look and site** | "How does it look, and is it reaching readers?" | 6 |
| Account menu | who is signed in, View my site, Open the old Admin, Sign out | 1 |

Recipes are posts, so they live in Posts (a Recipes filter in slice 2). **Only built areas appear
in the navigation**, no "coming soon"; meanwhile the palette's "Open the old Admin" covers the
rest. Write is not a nav item: you reach it from Home, Posts or the palette, and it shows the way
back. Routes: `#/`, `#/posts`, `#/write`, `#/write/<path>`, `#/sign-in?next=<route>`.

**Desktop (shell over 720 px):** `dashboard-shell`, sidebar open; the top bar holds the screen
title, its actions, Find and the account menu. **Phone (400 px):** the same shell folds itself:
**Menu** opens the areas under the top bar. Primary actions sit at the top of the content; on
Write, in a bar fixed to the bottom, under her thumb. No bottom tab bar: with two areas it would
be furniture, and Zubra UI has none.

## 3. Screens

### Shell

**Job:** "Where am I, and how do I get elsewhere?" **Primary:** none; it hosts the screen's.

```
400 px                                 Desktop (1280 px)
+--------------------------------+     +--------------+---------------------------------------------+
| [Menu] Posts   [Find] [Grammi v]|     | Grammi's     | Posts               [Find  Ctrl K] [Grammi v] |
+--------------------------------+     | House        +---------------------------------------------+
| (Menu open:)  Home             |     | Studio       |   screen content                            |
|   Posts  <current: bold, flour>|     | > Home       |                                             |
+--------------------------------+     |   Posts      |   (sidebar is a sage panel)                 |
| screen content                 |     |              |                                             |
+--------------------------------+     +--------------+---------------------------------------------+
```

- Frame: `dashboard-shell` (`product` = site title, `nav`, `current`, `menu`, `user` = her
  name); `--shell-height: 100dvh`, frameless (gap 2).
- Find: `action-button variant="ghost"` in the `actions` slot, opens `command-palette`; on
  desktop its label carries the hint "Ctrl K" (or "⌘K" on a Mac).
- Account: the shell's own `dropdown-menu` (`menu`): View my site, Open the old Admin, Sign out.
- Statuses: one `toast-region position="bottom-center"` (phone) / `"bottom-end"` (desktop),
  placed above Write's action bar.
- **First layer:** areas, Find, account. **Deeper:** everything else via the palette.

### Command palette (Mikey's front door, Grammi's search)

`command-palette`, opened by Ctrl/Cmd+K or Find. Groups and items:

- **Go to:** Home, Posts.
- **Do:** Write a new post, View my site, Open the old Admin, Sign out.
- **Posts:** every post by title; `hint` = "Draft", "Scheduled Nov 27" or "Published Nov 3".
- **This post** (only in Write): Save draft, Publish/Update/Schedule, Show details.

Typing a title and Enter opens the post: the palette is also "find a post". Ctrl/Cmd+S saves
(draft or Update), shown as a hint.

### Toasts

`toast-region`, 5 s, polite (errors assertive and kept until closed); words match the button:

| Action | Toast |
| --- | --- |
| Save draft | "Saved as a draft." (autosave never toasts; the status line says it) |
| Publish, sent out | "Published. Your readers will see it in about a minute." |
| Publish, no publishing set up | "Published. It's on your site." |
| Schedule | "Scheduled for Friday, November 27 at 8 AM." |
| Update | "Updated. Your readers will see the change in about a minute." |
| Committed, not sent out | warning, stays: "Published here, but it hasn't reached your readers yet." plus an `alert-banner` in Write with **Send it out again**; More shows the server's message |
| Signed out | "Signed out. See you soon." (on the sign-in screen) |

### Sign in

**Job:** "Let me in to my site." **Primary:** **Sign in**.

```
400 px                                 Desktop: the same, 28rem wide, centred on flour
+--------------------------------+     +-----------------------------------------------------+
|  Grammi's House (Literata xl)  |     |            Grammi's House                           |
|  Studio            (ink-soft)  |     |            Studio                                   |
| +----------------------------+ |     |         +-------------------------------+           |
| | Sign in                    | |     |         | Sign in                       |           |
| | [! That name and password  | |     |         | Your name   [grammi        ]  |           |
| |    don't match. ...      ] | |     |         | Password    [******] [Show]   |           |
| | Your name  [            ]  | |     |         | [        Sign in            ] |           |
| | Password   [      ][Show]  | |     |         +-------------------------------+           |
| | [        Sign in         ] | |     |                                                     |
+--------------------------------+     +-----------------------------------------------------+
```

- `signin-block` (heading "Sign in", `busy`, `error`), on `--studio-flour-lift`. Gap 1: it asks
  for an email and always offers "Keep me signed in"; Studio needs `identifier="username"`
  (label "Your name", `type=text`) and `remember={false}`. No forgot or sign-up links (none exist).
- Errors: "That name and password don't match. Check them and try again." / "Too many tries.
  Wait a minute, then try again." / "Studio can't reach your site. Check it's running, then try
  again." **First layer:** two fields and a button; nothing deeper.

### Home

**Job:** "What would you like to do?" **Primary:** **Write something new**.

```
400 px                                 Desktop (content column 52rem max)
+--------------------------------+     +--------------+------------------------------------------------+
| [Menu] Home      [Find] [G v]  |     | sidebar      | Home                       [Find] [Grammi v]   |
+--------------------------------+     |              +------------------------------------------------+
| What would you like            |     |              | What would you like to do?   (Literata 2xl)    |
| to do?          (Literata 2xl) |     |              | [ Write something new ]  action-button lg      |
| [  Write something new     ]   |     |              |                                                |
|   action-button lg, full width |     |              | Keep going                                     |
|                                |     |              | +-------------+ +-------------+ +-------------+|
| Keep going                     |     |              | |[cover]      | |             | |[cover]      ||
| +----------------------------+ |     |              | |Pumpkin bread| |Aunt Mae's.. | |Cranberry .. ||
| |[cover] Pumpkin bread       | |     |              | |Changed today| |Changed Tue  | |Changed Nov 2||
| |        Changed today 3 PM  | |     |              | +-------------+ +-------------+ +-------------+|
| +----------------------------+ |     |              | content-card in auto-grid (min 15rem)          |
| Recently published             |     |              | Recently published                             |
|  Sweet potato pie    Nov 3  >  |     |              |  Sweet potato pie            Published Nov 3 > |
|  Sunday rolls       Oct 28  >  |     |              |  Sunday rolls               Published Oct 28 > |
|  See all posts                 |     |              |  See all posts                                 |
+--------------------------------+     +--------------+------------------------------------------------+
```

- Question: Literata `--text-2xl` (an `h2`; the shell's `h1` says "Home").
- **Keep going:** newest 3 drafts as `content-card href=#/write/<path>` (cover in `media` when
  there is one; "Changed today at 3 PM" as text). Hidden when there are no drafts.
- **Recently published:** newest 3 as a plain list of links (rows with linen hairlines, date in
  ink-soft), then "See all posts". Deliberately not cards: drafts are work in hand, published
  posts are a record.
- Loading: `skeleton-block`s in the shape of the cards, `aria-busy` on the region.
- Nothing yet: `empty-state` "Nothing written yet" / "Your first recipe or story starts here."
  with **Write something new** (the button above is then not repeated).
- **First layer:** the question, the button, two short lists. **Deeper:** Posts, the palette.

### Posts

**Job:** "What have I written, and where is that one?" **Primary:** **Write something new**.

```
400 px                                 Desktop
+--------------------------------+     +--------------+------------------------------------------------+
| [Menu] Posts     [Find] [G v]  |     | sidebar      | Posts                      [Find] [Grammi v]   |
+--------------------------------+     |              +------------------------------------------------+
| [ Write something new      ]   |     |              | 24 posts, 2 waiting as drafts [Write something new]|
| Find a post [pumpkin       ]   |     |              | [All|Drafts|Scheduled|Published]  Find [      ]  |
| [All|Drafts|Sched.|Published]  |     |              | Title              v | Date            | Status  |
|  segmented-control             |     |              | Pumpkin bread        | Today 3 PM      | Draft   |
| ------------------------------ |     |              | Cranberry relish     | Fri Nov 27 8 AM | Sched.  |
| Pumpkin bread                  |     |              | Sweet potato pie     | Tue Nov 3       | Publ.   |
| Today at 3 PM        (Draft)   |     |              | data-table: sortable, Title is the link        |
| Sweet potato pie               |     |              |                                                |
| Tuesday, Nov 3   (Published)   |     |              |   (phone: data-table, stacked rows)            |
+--------------------------------+     +--------------+------------------------------------------------+
```

- Summary line in words: "24 posts, 2 waiting as drafts".
- Filter: `segmented-control` All / Drafts / Scheduled / Published (counts in labels on desktop).
- List: `data-table` (Title, Date, Status), newest first, `page-size` 25, its own filter box
  labelled "Find a post"; Status as `status-badge` (Draft neutral, Scheduled warning, Published
  success, each with `dot` and the word). Gap 3: rows need a link (`href` per row on the first
  column) and a stacked layout under ~32rem instead of sideways scroll.
- Empty: `empty-state` "No posts yet" with **Write something new**; filter with no match:
  "No drafts match "pumpkin"." with **Show all posts**.
- **First layer:** find, filter, the list. **Deeper:** column sorting (desktop), file names (Write).

### Write (new and existing)

**Job:** "Write it, and put it up when it's ready." **Primary:** **Publish** (new or draft) /
**Schedule** (date in the future) / **Update** (already published). **Save draft** is secondary.

```
400 px                                 Desktop
+--------------------------------+     +--------------+------------------------------------------------------+
| [Menu] Write     [Find] [G v]  |     | sidebar      | Write   [Find] [More v] [Save draft] [Publish] [G v] |
+--------------------------------+     |              +------------------------------------------------------+
| Posts > Pumpkin bread  [More v]|     |              | Posts > Pumpkin bread . Draft . saved 2 minutes ago  |
| Draft . saved just now         |     |              | +--------------------------------+ +---------------+ |
| Title                          |     |              | | Title                          | | When          | |
| [Pumpkin bread          ]      |     |              | | [Pumpkin bread           ]     | | Date [Nov 27] | |
| Words                          |     |              | | Words                          | | Time [08:00]  | |
| [My mother made this every  ]  |     |              | |  My mother made this every     | | Tags          | |
| [fall...                    ]  |     |              | |  fall, and the kitchen...      | | [Thanksgiving x]|
| [                           ]  |     |              | |  (Literata, 18 rows, grows)    | | [Bread x] [+] | |
| When it appears                |     |              | | ]                              | | Cover photo   | |
| Date [        ] Time [     ]   |     |              | +--------------------------------+ | [  picture  ] | |
| Empty: the day you publish     |     |              |   main column 40rem max            | Describe it   | |
| Tags [Thanksgiving x][Bread x] |     |              |                                    | [Loaf, sliced]| |
| Cover photo                    |     |              |   sidebar-layout end, side 20rem   +---------------+ |
| [Choose from your pictures]    |     |              |                                                      |
| [ Drop a photo or choose  ]    |     |              |                                                      |
+--------------------------------+     +--------------+------------------------------------------------------+
| [Save draft]  [   Publish   ]  |  <- action bar fixed to the bottom on phone (cluster-layout)
+--------------------------------+
```

- Back: `breadcrumb-trail` (Posts > title, or "New post"); Posts stays current in the nav.
- Status line (`role=status`, Studio part): "Add a title and your draft will save itself." /
  "Draft . saved just now" / "Published Nov 3 . changes not on your site yet" / "Scheduled for
  Friday, November 27 at 8 AM".
- Title: `text-field` (required; Literata `--text-lg`). Words: `text-field rows=18` (Literata),
  plain text, the Markdown as she types it.
- When: `date-field` "Date" + `text-field type="time"` "Time", in a `cluster-layout`; help "Leave
  empty to use the day you publish." A future date relabels the primary to **Schedule**.
- Tags: `tag-input` with `suggestions` from existing posts' tags. Gap 4: the × target is 27 px.
- Cover photo: none yet shows **Choose from your pictures** (`action-button variant="secondary"`,
  opens a `side-sheet` with the pictures to pick from, gap 5) and `file-drop accept="image/*"
  multiple={false}` "Add a photo from this device". Chosen: the picture, **Describe the picture**
  (`text-field`, help: "For people who can't see it, like "Pumpkin bread sliced on a board"."),
  **Change**, **Remove**.
- Actions: desktop in the shell's `actions` slot; phone in the fixed bar. **More** is a
  `dropdown-menu`: Show details, View the live post (published only), Open in the old Admin.
- **Details** (`side-sheet side="right"`, "About this post"): file (`content/posts/pumpkin-bread.md`,
  mono), web address, word count, last save, and the last publish as the server said it:
  message, commit, "Sent to readers: yes/no". Copy buttons for path and commit.
- Errors under the field (`text-field error`), focus to the first: "Give your post a title first."
- **First layer:** title, words, when, tags, cover, two buttons. **Deeper (More/details/palette):**
  file, slug, word count, live link, commit and push result, old Admin.

## 4. Flows

**First sign-in.** She opens the Studio address (a bookmark Mikey made) → `GET session` says no
one → Sign in (`#/sign-in?next=#/`) → name, password, **Sign in** ("Signing in…") → Home. A wrong
password keeps her name, says so, and focuses the password. Any address returns her there after.

**Writing and publishing a new post.** Home → **Write something new** → Write, "New post", focus
in Title; status "Add a title and your draft will save itself." She types the title → three
seconds after she stops typing, `POST document` creates the draft; from then on `PUT` with the
etag; status "Draft . saved just now"; the breadcrumb becomes the title. She adds words, tags, a
cover photo from the phone (`file-drop` → `POST upload`, a progress bar while it goes) and its
description. **Save draft** → toast "Saved as a draft." Later: Home → Keep going → the card →
Write. **Publish** → button `loading` → save without `draft` → if `GET publish` says publishing
is set up, `POST publish` → toast "Published. Your readers will see it in about a minute.";
status "Published today at 4 PM"; primary becomes **Update**. With a future date the same path
says **Schedule** and "Scheduled for ...". If the send-out fails, see the warning toast above:
her post is safe and the banner offers **Send it out again**.

**Fixing a typo in a published post.** Posts → find "pump" → **Pumpkin bread** → Write. She fixes
the word: nothing goes to the site yet; the change is kept on this device at once and the status
says "Published Nov 3 . changes not on your site yet". **Update** → `PUT` (all `fields` back as
received, only Studio's keys changed) → publish as above → "Updated. Your readers will see the
change in about a minute." If she closes the tab first, the next time she opens the post an
`alert-banner` says "You have changes to this post that aren't on your site yet." with **Put my
changes back** and **Use what's on the site**.

**Leaving with unsaved work.** The router asks the screen first. A draft with a title saves at once
and leaves, nothing asked.
- New post with words, no title: `modal-dialog` "Leave without a title?" / "A post needs a
  title to be kept as a draft." / **Add a title** (primary, focus goes to Title) / **Leave and
  throw it away**.
- Published post with changes: "Your changes aren't on your site yet." / **Update now**
  (primary) / **Leave for now** ("They stay on this device until you come back.").
Closing the tab gets the browser's own "Leave site?" in both cases.

**Conflict (`409`, the file changed elsewhere).** Her text stays in the fields and on the device.
An `alert-banner variant="warning"` at the top of Write: "This post was changed somewhere else
while you had it open." / "Your words are kept." / **See the newer version** (primary) and
**Keep mine instead**. *See the newer version* loads it and opens a `side-sheet` "Your version"
with her text and **Copy all**, so she can take back her sentence. *Keep mine instead* asks once
("This replaces the other changes to Pumpkin bread.") and saves over it with the new etag.
Details shows which file and both save times for Mikey.

**Expired session.** A save gets "not signed in": her words stay in the fields and on the device,
and a `modal-dialog` opens with the `signin-block` (heading "Sign in again", intro "You were
signed out. Your words are safe; sign in and Studio will finish saving."). After sign-in the
dialog closes and the same save runs again → its usual toast. If she closes the dialog instead,
the status line says "Not saved: you're signed out." with **Sign in**, and autosave waits.

## 5. Zubra UI gaps (fix upstream, then re-vendor)

1. `signin-block`: `identifier="username"` (label, `type=text`) and `remember={false}`.
2. `dashboard-shell`: frameless full-height mode (`--shell-height: 100dvh`, no outer border);
   a `brand-note` under `product` for "Studio".
3. `data-table`: a link per row (`href`, first column) and stacked rows in a narrow container.
4. `tag-input`: remove button at least 44 px target (now 1.5rem).
5. `choice-cards` items with `image` and `alt`, for the cover picture picker.
6. `status-badge`, `alert-banner`, `toast-region`: read `--success`/`--warning` (today's as fallback).
7. Overlays (`dropdown-menu`, `modal-dialog`, `side-sheet`, `toast-region`): read `--shadow-1`.

Studio-only parts (classes on tokens): status line, Write's action bar, Recently published rows.
