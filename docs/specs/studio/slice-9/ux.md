# Studio UX, slice 9: Cards and Visitors

By `studio-ux`, 2026-11-13, from `studio-ux`, `admin/greetings.rs`, `web/admin/greetings.js`, the `analytics` and `engagement/analytics` routes and the old Admin's `showAnalytics`. Two nav items, each shown only when set up: **Cards** and **Visitors**. The old Admin keeps setup.

## Cards

- **Job (her words):** "Who gets a card from me, and when?" **Primary action:** **Write a card**, top of the screen.
- **Title:** "Cards". **Question (h2, Literata):** "Who gets a card?" **`when`:** `meta.greetings === true` (settings present, valid or not).
- **Routes:** `#/cards` (list and people), `#/cards/new` (optional `?for=<contactId>`), `#/cards/<id>`. The editor has its own route, like Write, so Back closes it. Back from the editor: the **Back to your cards** link, the browser's Back, or the nav.
- **Loads:** `GET greetings/status`; when `enabled`, `contacts` and `cards` together. Imports `when`, `nextBirthday`, `cardSummary`, `REASONS`, `hourLabel` and `OFF_TEXT` from `/admin/greetings.js`.

### 400 px (list)

```
+--------------------------------------+
| [Menu] Cards        [Find] [Grammi v]|  dashboard-shell
+--------------------------------------+
| Who gets a card?                     |  h2
| Cards go out by email from Grammi,   |  p ink-soft (from.name, else "from you")
| at the time you pick.                |
| [        Write a card          ]     |  action-button primary, full width
| ! 1 card didn't go out. [See why]    |  alert-banner warning (only when failed)
| Coming up                            |  h3
| +----------------------------------+ |
| | Ricky . Birthday     [Every year]| |  content-card, href #/cards/<id>; status-badge
| | Goes out Monday, September 7     | |
| | at 8 AM                          | |
| | [Change]  [Stop sending it]      | |  action-button secondary x2
| +----------------------------------+ |
| Didn't go out                        |  h3 (only when any)
| Sent                                 |  h3, newest 5, [Show all sent]
| Your people                          |  h3
| Ricky . Birthday September 7         |  content-card per person
|   [Write to Ricky] [..]              |  action-button + dropdown-menu (Change, Remove)
| [ Add someone ]                      |  action-button secondary -> side-sheet
| > For the person who set up your site|  details
+--------------------------------------+
```

Desktop (1280 px): list column max 46rem on the left; **Your people** moves to a right column at 70rem and up, as Comments' switch does. 320 px: card buttons stack full width.

### The list

One `content-card` per card, `role="list"`, each labelled "Ricky's birthday card". Heading "Ricky . Birthday" (person name, design `label`; "Someone you removed" when the person is gone). Cancelled cards never show.

| Section | Cards | Line | Buttons |
| --- | --- | --- | --- |
| **Didn't go out** (first when any) | `failed` | "Didn't go out: " + `REASONS[error]` ("something went wrong" otherwise) + ". Open it and schedule it again." | **Open and try again** (primary), **Don't send it** |
| **Coming up** | `scheduled`, `sending`, by `nextSendAt` | "Goes out " + `when(nextSendAt)`; yearly adds badge **Every year** and, after the first, "Last went out September 7, 2026." | **Change**, **Don't send it** / **Stop sending it** (yearly) |
| | `sending` | badge **Going out now**, "It's on its way." | none |
| **Sent** | `sent` | "Went out " + `when(lastSentAt)` | More: **Send it again** (opens a copy in the editor) |

The `"Subject"` sits under each line in ink-soft. Every badge carries words.

### The editor (`#/cards/new`, `#/cards/<id>`)

Heading "Write a card" / "Change Ricky's card" / "Try Ricky's card again" (failed). One column at 400 px; at 70rem the card preview sits in a right column.

```
+--------------------------------------+
| < Back to your cards                 |  link
| Write a card                         |  h2
| Who is it for?   [Ricky          v]  |  select-field (contactId)
| Which card?  (o) Birthday  ( ) ...   |  choice-cards (designs, label)
| Send it on       [ 2027-09-07  ]     |  date-field (sendOn)
| At               [ 8 AM        v]    |  select-field (hour, 6 AM to 9 PM)
| (o) Send it every year               |  toggle-switch (yearly)
| Next one: Tuesday, September 7, 2027 |  p ink-soft
| Subject line     [Happy birthday!  ] |  text-field, placeholder = design subject
| Your message     [               ]   |  text-field multiline, 7 rows
|   [Add their name] [Add their age]   |  action-button quiet
| Sign it          [Love, Grammi     ] |  text-field
| [   Schedule this card   ]           |  action-button primary
| [See the card] [Send me a test]      |  action-button secondary
+--------------------------------------+
```

- **Defaults (new):** first person (or `?for`), Birthday when they have one, its day and every year on; otherwise "Just because" (else the first design), today, 8 AM, once. Sign-off "Love, Grammi" the first time, then her last one (kept on this device).
- **Birthday shortcut:** choosing a person with a birthday while Birthday is picked sets the day and every year, saying "Set to Ricky's birthday, September 7, every year." in the status.
- **Help lines:** subject "Leave it empty to use “Happy birthday!”."; message "Add their name and age with the buttons; See the card shows how it reads." (the buttons insert `{name}` and `{age}`; **Add their age** only when the person has a birthday); every year "The year doesn't matter; it goes out on that day each year."
- **Time zone:** `status.timeZone`, never shown on the first layer; in details.
- **Primary:** **Schedule this card** (new), **Save changes** (scheduled), **Schedule it again** (failed). On success: back to `#/cards`, focus the card, status "Scheduled. " + `cardSummary(card)`, e.g. "Scheduled. Birthday card to Ricky goes out Monday, September 7 at 8 AM, and every year after."
- **Failed card:** an `alert-banner warning` on top: "This card didn't go out: the email service turned it down; the address may be wrong. Check Ricky's address under Your people, pick a day, then Schedule it again." with **Change Ricky's address** (opens the person sheet over the editor).
- **No people:** the editor shows `empty-state` "Add someone first" / "Cards go to the people in your address book." / **Add someone**; after adding, the editor fills in with them.
- **See the card:** `POST greetings/preview` with the form. Shows "Subject: Happy birthday, Ricky! It goes out Monday, September 7 at 8 AM." and the card in an `iframe` (`srcdoc` = `html`, `sandbox=""`, title "How Ricky's card will look"). At 400 px it opens in a full-height `side-sheet` "How it will look", **Close**. After any edit the preview dims with "This is before your last change. See the card again to update." Status: "Here's how it will look."
- **Send me a test:** `POST greetings/test`; button busy; status "Sent a test to grammi@example.com. Check your email." (`to` null: "Sent you a test. Check your email."). It doesn't schedule anything; the status says so once: "Your card isn't scheduled yet."
- **Nothing is lost:** each change is kept on this device (`kept`-style, key `studio:card:<user>:new|<id>`) until scheduled. Coming back offers "You were writing a card to Ricky. Pick up where you left off?" **Pick up** / **Start fresh**. `leave()` with unsaved changes asks: "Leave without scheduling this card?" / "It waits on this device for next time." / **Keep writing** (focused), **Leave for now**, **Throw it away** (destructive).

### Stopping a card

`ask()`: heading "Stop Ricky's birthday card?" (yearly: "Stop sending Ricky's birthday card every year?"); text "It won't be sent. You can bring it back right after."; **Don't send it** / **Stop sending it** (destructive), **Keep it** (focused). Sends `cards/<id>/cancel`. Status "Stopped. That card won't be sent." with **Undo**, which re-creates the card from its fields (`POST greetings/cards`, a new id) and says "Back on. " + `cardSummary`. If its day has passed, Undo opens it in the editor instead: "Pick a new day, then Schedule this card." One Undo, the last stop only.

### Your people (address book)

- Each person: `content-card` heading name; lines email and "Birthday September 7" (or "No birthday added"); **Write to Ricky** (`#/cards/new?for=<id>`); More (`dropdown-menu`, "More for Ricky"): **Change**, **Remove**.
- **Add someone / Change:** `side-sheet` "Add someone" / "Change Ricky". `text-field` Name, `text-field type=email` Email address, `date-field` Birthday (optional), help "Add it and you can send a birthday card every year.". Primary **Add to your people** / **Save**; **Cancel**; Escape closes and asks first if anything was typed. Status "Added Ricky." / "Saved Ricky." Focus returns to the person.
- **Remove:** `ask()`: "Remove Ricky?" / "Ricky's 2 cards are stopped and removed too. This can't be undone." (no cards: "Ricky leaves your people. This can't be undone."); **Remove Ricky** (destructive), **Keep Ricky** (focused). Status "Removed Ricky."
- **Empty:** `empty-state` "Nobody here yet" / "Add the people you send cards to, with their birthdays." / **Add someone**.

### Empty, loading, not ready

- **Loading:** `skeleton-block shape="card"` x3, `aria-busy`.
- **No cards, has people:** `empty-state` "No cards yet" / "Write one and it goes out on the day you pick. Birthdays can go every year." / **Write a card**.
- **No people:** **Write a card** goes to the editor's "Add someone first" state; the list shows only "Nobody here yet".
- **Not ready** (`enabled` false): no list, no button. `alert-banner info` "Cards aren't ready yet" / "The person who set up your site needs to finish setting them up. Your site works the same without them." Details: `OFF_TEXT[state]`, and for `invalid` each of `problems` in `studio-mono`.

### Errors

Studio's words by status and `code`, never the server's text except the 400 field messages (already plain). A 400 with `data.field` puts its message on that field (`text-field` error), focuses it, and repeats it in the status. List errors use an `alert-banner` with **Try again**; action errors use the status line, the form keeps every word.

| What | Words |
| --- | --- |
| 400 + field | the server's line on the field, e.g. "Add the person's name", "Pick a day from the calendar" |
| 400 `invalid-time-zone` | "Studio couldn't work out your time zone. Tell the person who set up your site." (details: the zone) |
| 404 gone | "That card isn't there any more. Here's your list as it is now." (reloads) |
| 409 `too-many` | "Your card list is full. Stop one you don't need, then try again." / "Your address book is full." |
| 409 `busy` | "That card is going out right now. Try again in a minute." |
| 502 `send-failed` (test) | "The test didn't go out: the email service turned it down. Check the address, then try again." |
| 502, 504 | "Your cards service isn't answering right now. Nothing changed. Try again in a few minutes." |
| No connection | "Studio couldn't reach your site's server. Check your connection, then try again." |
| 401 | the shell's sign-in, back here, the editor's words kept |

### Home

When `meta.greetings`, Home loads `greetings/contacts` and `greetings/cards` together after posts (no status call; each card carries `timeZone`). One `content-card` row above "Keep going", `href="#/cards"`:

- A `failed` card first: "Ricky's birthday card didn't go out" (one only; "2 cards didn't go out").
- Else, cards with `nextSendAt` within 7 days: "Ricky's birthday card goes out Sunday" ("today", "tomorrow", weekday); two or more: "3 cards go out this week, Ricky's first, on Sunday".
- Nothing to say, or any error: nothing.

### Layers and palette

- **First layer:** Write a card, the list, Change, Don't send it, Your people, Add someone, and in the editor See the card and Send me a test.
- **More:** Send it again (sent), person Change and Remove. Rare or permanent.
- **Details** ("For the person who set up your site", `studio-mono`): screen: `state`, `from`, `timeZone`, design ids, counts by status (including `cancelled`), `OFF_TEXT`, link "Greeting cards in the old Admin"; per card: `id`, `status`, `error`, `attempts`, `nextSendAt` and `lastSentAt` in UTC ISO, `timeZone`; per error: status, code, field, server message.
- **Palette:** Go to Cards, Write a card, Add someone, Write to <each person>; on the editor: See the card, Send me a test.

## Visitors

- **Job (her words):** "Is anybody reading, and which recipes do they like?" **Primary action:** none to do; the one control is the time picker. Read-only by design.
- **Title:** "Visitors". **Question (h2):** "Who's been reading?" **Route:** `#/visitors`, `#/visitors/7|30|90` (default 30). Back: nav.
- **`when`:** today the data comes from one of two places, exactly as `showAnalytics` chooses: the hosted counter (`GET engagement/analytics?days=`) when `engagement.enabled && engagement.analytics && credential.configured`, else the built-in counter (`GET analytics?days=`), which 404s unless `analytics.builtin` (default true). Meta has neither. **Propose `meta.visitors`:** `"hosted"` for the first, `"counter"` when `analytics.builtin`, else `false`. `when: (meta) => Boolean(meta.visitors)`. Studio calls the one route `meta.visitors` names, never both.

### 400 px

```
+--------------------------------------+
| Who's been reading?                  |  h2
| Over the last  [30 days         v]   |  select-field: 7 / 30 / 90 days
| 214 people visited                   |  stat (Literata, large)
| They looked at 612 pages.            |  p ink-soft
| [bars: one per day]                  |  simple column chart, see below
| What they read most                  |  h3
| 1. Pecan pie            88 people    |  ordered list, title links to post
| 2. Cornbread dressing   61 people    |
| ...  (top 10)  [Show more]           |
| Other pages             40 visits    |  one line
| Where they came from                 |  h3 (only when any)
| facebook.com            52 visits    |  list, top 5
| > For the person who set up your site|  details
+--------------------------------------+
```

Desktop: the two lists sit side by side at 70rem. The picker is a `segmented-control` "Over the last" when gap S1 is fixed.

- **Numbers:** "214 people visited" = `uniques` (1: "1 person visited"); "They looked at 612 pages" = `views`. People per recipe = `uniques`; a recipe's line adds "1,040 all told" from `allTime` only on desktop.
- **Recipe names:** `topPosts.path` matched to `posts.list()` by `url` (trailing slash ignored). `/` is "Your front page". Unmatched paths add up into "Other pages". Never a raw path on the first layer.
- **Chart:** one bar per day from `series.views`, no axes or numbers on it, `role="img"`, label "Visits per day, busiest Thursday, November 26 with 48." Hidden under 7 days of data. Not a line chart: days are separate counts.
- **Since:** when `firstDay` is inside the range: "Counting since Tuesday, November 3."
- **Nothing that identifies anyone:** the data holds no visitor, address or time of day, and Studio adds none. Referrers show the site name only (`host`). Bot and AI counts (`agents`, `agentPages`) are details only.
- **Empty** (`views` 0): `empty-state` "No visits counted yet" / "When people read your recipes, the numbers show up here, a day or so later." No action.
- **Errors:** banner with **Try again**. 404 from the counter: "Visitor counting is switched off." (details: `analytics.builtin`). 502/503: "Your visitor numbers aren't answering right now. Try again in a few minutes." No connection: shell's words.
- **Details:** source (`hosted` or built-in counter), `from`/`to`, `views`, `uniques`, `allTimeViews`, `firstDay`, every top path with views/uniques/allTime, referrers, `agentRequests` and agents, link "Analytics in the old Admin" (365 days lives there).
- **Palette:** Go to Visitors, Visitors in the last 7 / 30 / 90 days.

## Accessibility notes

- Editor fields named by their visible labels; field errors linked with `aria-describedby`, focus to the first.
- The preview iframe is titled and sandboxed; Escape closes its sheet and returns focus to **See the card**.
- Statuses go to the live region; toasts repeat them. Badges are words.
- The chart's numbers are also in the text above and in details; nothing is colour alone.

## Gaps

- **G1.** `greetings/preview` returns `html`, not `previewUrl`; the old Admin's preview frame loads nothing. Studio uses `srcdoc`; fix the old Admin.
- **G2.** No un-cancel route; Undo re-creates the card with a new id. A `cards/<id>/restore` would keep the id and history.
- **G3.** Birthdays need a year; "I don't know what year" can't be said, and `{age}` then lies. Allow `--MM-DD` or a separate "year unknown".
- **G4.** `meta.visitors` doesn't exist (see above). A static host with `analytics.endpoint` elsewhere makes the built-in counter show only what reaches Admin; say so in details until meta knows.
- **G5.** `cardSummary` names the design ("Birthday card to Ricky"); Home wants "Ricky's birthday card". Add a `cardTitle(card, person)` helper to `/admin/greetings.js` so both screens share it.
