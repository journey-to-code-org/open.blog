# Studio UX, retirement slice R1: Finish the trade site

By `studio-ux`, 2026-11-13, from `studio-ux`, `retirement-plan.md` (§1 C, D; §4 R1), `slice-10bc/ux.md`, `admin/{seasonal,quote,announcements,job_sharing,trade_checklist}.rs`, `outcomes.rs`, `admin.rs` (`recipe-notes`, `documents`), core `seasonal.rs`, `job_destination.rs`, `recipe_listing.rs`, `netlify/lib/{quote-admin,social-announcements}.mjs` and `web/admin/{seasonal,quotes,announcements,distribution,job-share,trade-checklist}.js`. Owners: **Dana** (roofer, phone, between jobs) and **Grammi** (recipes; the recipe notes are hers). The job of the whole slice, in her words: **"Did my work get out, and what's next?"** After R1 no Studio screen links to `/admin/` for Requests, Reminders or Sharing (accounts stay with R2).

| Job | Lands in | Route | Replaces |
| --- | --- | --- | --- |
| Change topics and dates; add or remove her own | Reminders, screen More | `#/reminders` (sheet) | `reminders.js:183,193` links |
| Auto-erase archived requests; download chosen days | Requests, screen More | `#/quotes` (sheets) | `quotes.js:22,244` links |
| Change a share's words or time; check an unclear one; its history; running late | Sharing rows | `#/sharing` (sheets) | `sharing.js:91,93,205` links |
| How it looks, before sharing | Share a post | `#/sharing/new` | (never built) |
| Where it went | Sharing, second view | `#/sharing?view=posts[&days=]` | old `#/distribution` |
| Share this job | its own screen under Sharing | `#/sharing/job/<path>` | old `#/share/<path>` |
| Ten-minute checklist; recipe notes | Home | `#/` | old Overview |

`legacyRoute`: `#/distribution` → `#/sharing?view=posts`; `#/share/<path>` → `#/sharing/job/<path>`; drop `distribution` from `NOT_YET`. Still to the old Admin until R2: Connect / Reconnect (`sharing.js:62,67,88,173`, `share-new.js:65`).

## Reminders: Change topics and dates (side-sheet)

- **Job:** "When does Studio nudge me, and about what?" **Primary:** **Save** on the topic she opened.
- **Opens from:** screen More **Change topics and dates…** (drop "(old Admin)"); card More **Change its dates…** (opens the sheet with that topic expanded and its first field focused); palette "Change topics and dates". Details link to the old Admin goes.
- **Uses** `data.topics` (resolved: `id`, `topic`, `prompt`, `start`, `end`, `disabled`, `custom`) and `data.entries`; every save is one `PUT seasonal {etag, seasonalPrompts: {enabled, topics: entries}}` and redraws from the reply.

```
400 px (side-sheet, full width)          Desktop: side-sheet 32rem on the right
+--------------------------------------+
| Topics for roofing              [x]  |  side-sheet heading ("Your topics" with no trade)
| Turn one off, or move when Studio    |  p ink-soft
| suggests it.                         |
| +----------------------------------+ |
| | Get the roof ready before winter | |  content-card (one per topic, by start date)
| | September 1 to October 31        | |  monthDay words
| | [o] Suggest this        [Change] | |  toggle-switch + action-button secondary
| +----------------------------------+ |
| | Ice dams          (expanded)     | |
| | Topic [Ice dams               ]  | |  text-field, 80 max
| | What to write about              | |  text-field rows=3, 600 max, count at 500+
| | [What do you tell people ...  ]  | |
| | Starts [December v] [1 v]        | |  select-field month + select-field day
| | Ends   [February v] [28 v]       | |
| | Runs across the new year.        | |  p help (only when Ends is before Starts)
| | [ Save ]  [Cancel]      [More v] | |  primary + secondary + dropdown-menu
| +----------------------------------+ |
| [ Add your own topic ]               |  action-button secondary -> same form, empty
+--------------------------------------+
```

- **Pickers:** month `select-field` (January…December); day `select-field` 1 to the month's last day (February to 29). Changing the month clamps the day. Studio joins `MM-DD`; she never types a date, so `windowProblems` is only a guard before PUT.
- **Toggle** saves at once (`withDisabled`): off → "Studio won't suggest “Ice dams” any more." with **Undo**; on → "“Ice dams” is back."
- **Save** (bundled topic): changed dates via `withWindow`, changed words via `withWords` (G4) → "Saved. Studio suggests “Ice dams” from December 1 to February 28." Nothing changed: Save stays disabled.
- **Topic More:** bundled and changed: **Put back the original** (`withoutTopic`, G4) → "“Ice dams” is back to how it came." with **Undo**. Own topic: **Remove this topic…** → `modal-dialog` "Remove “Gutter day”?" / "Studio stops suggesting it. A draft you started from it stays." **Keep it** (focused) / **Remove** → "Removed “Gutter day”." with **Undo** (puts the entry back).
- **Add your own topic:** same fields, empty; Starts defaults to today's month and day, Ends a month later. **Add it** (`withTopic`, G4; id `own-<slug>` so it never collides with a bundled topic of any trade) → "Added. Studio suggests “Gutter day” from April 1 to April 30." Card scrolls into view and takes focus.
- **Field errors** (focus the first): empty Topic "Give the topic a name." / empty What to write about "Say what to write about, in a sentence or two." / 60 topics reached "You have 60 topics changed or added, the most there can be. Remove one first."
- **Server errors:** 409 with `etag`: reload, keep her open form's values, "These changed on another device. Here they are now; press Save again." 422: "That didn't save. Tell the person who set up your site." (server `problems` in details). Leaving a changed form asks "Save this topic?" / **Save** / **Leave without saving**.
- **Details** (sheet foot): `id`, `custom`, raw `start`/`end`, the entry JSON.

## Requests: two sheets in screen More

Screen More becomes: **Download a spreadsheet…**, **Clean up archived requests…** (no "(old Admin)"); details lose the old-Admin link.

```
Download a spreadsheet (side-sheet)      Clean up archived requests (side-sheet)
+--------------------------------------+ +--------------------------------------+
| Which days?                          | | [o] Erase archived requests          |  toggle-switch
| From [ November 1, 2026  ]           | |     by themselves                    |
| To   [ November 13, 2026 ]           | | After [ 30 ] days                    |  text-field numeric (on only)
| Leave both empty for every request.  | | Counted from the day you archive one.|
| It has customers' phone numbers, so  | | [ Save ]                             |  primary
| keep it somewhere private.           | | Your site does this once a day.      |
| [ Download ]                         | | [Erase the old ones now]             |  secondary (on only)
+--------------------------------------+ +--------------------------------------+
```

- **Download:** two `date-field`s (Zubra has no `date-range` vendored; this is the fallback, not a fork). To before From: on To, "Pick a day on or after November 1." → `GET quote/export?from&to` → CSV Blob → "Downloaded 14 requests from November 1 to November 13." (no days: "Downloaded all 214 requests."). `count: 0`: nothing downloads, "No requests in those days, so there's nothing to download." Errors: `quoteTrouble`.
- **Clean up:** toggle on shows the days field (1 to 3650, starts at 30). **Save** → `POST quote/retention {days}` (off: `null`) → "Saved. Archived requests are erased 30 days after you archive them." / "Saved. Archived requests stay until you erase them." Bad number, on the field: "Write a number of days from 1 to 3650." Host-set (`retentionSource` not `admin`): no fields, "Archived requests are erased 30 days after you archive them. The person who set up your site chose this." plus **Erase the old ones now**.
- **Erase the old ones now** (always checked first): `POST quote/retention/run {dryRun: true}` (G12) → 0: status "Nothing is old enough to erase yet." Else `modal-dialog` "Erase 3 old requests now?" / "They were archived more than 30 days ago. They and their 2 photos go for good; this can't be undone." **Keep them** (focused) / **Erase for good** → `retention/run {before}` (the dry run's cutoff) → "Erased 3 old requests." (`photosPending`: + " 1 photo is still being removed; nothing points to it."). Reload the list after. An older requests service (409 `hosted-too-old`): "Your requests service needs updating before Studio can clean up. Tell the person who set up your site." Nothing is erased.
- **Details:** `retentionDays`, `retentionSource`, the dry-run reply, an error's status and code.

## Sharing: change, check, history, running late

Row actions by state (badges stay `share-words` `BADGES`):

| State | First layer | Row More |
| --- | --- | --- |
| Scheduled, Trying again | **Change** (secondary), **Don't share it** (secondary) | Show its history |
| Sending | "It's going out now. This updates in a minute." (no buttons; reload after 60 s) | Show its history |
| Check this | **Check it** (primary) | Show its history |
| Didn't go out | **Try again** or **Reconnect** (as built) | Show its history |
| Shared | none | Show its history |

```
Change this share (side-sheet)           Check it (side-sheet)
+--------------------------------------+ +--------------------------------------+
| Ice dams: what to do                 | | Ice dams: what to do                 |
| To Bluesky, @ridgeline               | | Facebook didn't say whether it       |
| What to say                          | | posted. Look at your Facebook Page.  |
| [Ice dams can ruin a ceiling...   ]  | | Is it there?                         |
| 212 of 300                           | | [ It's there | It isn't there ]      |  segmented-control
| Day [Friday, Nov 20] Time [9:00 AM]  | | [ Save ]                             |
| > How it looks on Bluesky            | | > For the person who set up the site |  details: "The post's id" text-field
| [ Save changes ]  [Cancel]           | +--------------------------------------+
+--------------------------------------+
```

- **Change:** fields prefilled (`splitInstant(scheduledFor, zone)`); count by `captionWords(caption, [provider])`; `POST social/preview {provider, caption, work, scheduledFor, timeZone}` 350 ms after typing stops, `problems` on their field by `fieldForCode`, notes from `blueskyNotes`/`mastodonNotes` (`card`/`cover`). **Save changes** (disabled until something changes) → one `PATCH social/announcements?id= {version, caption?, scheduledFor?, timeZone}` with only what changed (`reschedule` is not used: PATCH covers time alone). Done: "Changed. It goes out Friday, November 20 at 9 AM." Time in the past, on Time: "Pick a time from now on." 409 `not-editable`: close, reload, "It started going out, so it can't be changed now." Other `REFRESH_CODES`: reload, "Something changed while you looked. Here's the list now." Leaving changed: "Save your changes?" / **Save changes** / **Leave without saving**.
- **Check it:** **Save** disabled until she picks. "It's there" → `resolve {version, outcome: "published"}` (no id needed, G7) → "Marked as shared." "It isn't there" → `resolve {version, outcome: "not-posted"}` → "Marked as not shared. You can try again." (the row moves to Didn't go out with **Try again**). Mikey may type the provider's post id in details; it is sent as `providerPostId`.
- **Show its history:** `side-sheet` "What happened to this share", `GET social/announcements/attempts?id=` on open; one line each, newest last, Studio words: "Friday at 3:05 PM: scheduled." / "3:06 PM: tried, didn't go out. Facebook was busy." / "3:12 PM: shared." plus "Tried 2 times." Raw `eventText`, HTTP status, codes in the sheet's details. History not installed: "The history isn't kept on this site."
- **Running late** (`GET social/announcements/health` after the list): only two alerts reach the first layer, as one `alert-banner warning`: `backlog-overdue` "Shares are running late" / "Some posts should have gone out by now. Tell the person who set up your site."; `provider-not-configured` "2 shares are waiting for an account that isn't set up to post. Tell the person who set up your site, or choose Don't share it." The rest are already rows (`needs-review`, reconnect) or Mikey's: `healthLines` in details.
- **Share a post** gains the preview above (same calls, all chosen providers); words as `slice-10bc/ux.md`.

## Where it went (`#/sharing?view=posts`)

- **Job:** "Where did each post end up, and did people come from there?" No primary of its own; **Share a post** stays the screen's primary.
- **Switch:** `segmented-control` under the lede: **Going out** | **Where each post went** (sets `?view=posts`; Back returns to the last view).
- **Loads:** `GET distribution?days=30` and the already-loaded `social/announcements` → `mergeReport(report, items.map(announcementRow).filter(Boolean), visits)`.

```
400 px                                   Desktop: cards in auto-grid 20rem
+--------------------------------------+
| [ Going out | Where each post went ] |  segmented-control
| Reached 14 places in the last 30 days|  h3; screen More: last 90 days / last year
| +----------------------------------+ |
| | Pre-winter roof check            | |  content-card; heading links to the post on her site
| | Facebook, Ridgeline . Shared     | |  place . status words
| |   About 12 visits from there     | |  only when the counter is on and > 0
| | Nextdoor . You posted it         | |
| | Pinterest . Check this [Check it]| |  unknown: link to the row in Going out
| +----------------------------------+ |
| Visits are estimates; some people's  |  p help, once
| browsers hide where they came from.  |
+--------------------------------------+
```

- **Status words** (`placeWords`): delivered "Shared", by-hand "You posted it", pending "Going out", unknown "Check this", not-delivered "Didn't go out", draft "Saved there as a draft". Place = `DESTINATION_NAMES` + `place` ("Facebook, Ridgeline Roofing"). Evidence ("confirmed", "your word"), `remoteId`, `permalink`, attempts, `problem` live in each card's details. A platform's own numbers are never shown.
- **Counter off:** one line "Your site isn't counting visits, so there are no visit numbers." **Unreadable record:** `alert-banner warning` "Studio couldn't read what went to Pinterest, so it isn't here. Tell the person who set up your site." **Social unreadable:** "Your shares to Facebook and others didn't load, so they aren't here. **Try again**".
- **Empty:** `empty-state` "Nothing has gone anywhere yet" / "When you share a post, or post a job somewhere yourself, it shows up here." **Share a post** (only with `meta.social`).
- **Days:** screen More **Show the last 90 days** / **Show the last year** (`days=365`) / **Show the last 30 days**; heading follows ("in the last year"). 400: "Studio couldn't read that. Try again."
- **Nav:** Sharing shows when `meta.social` **or** `meta.siteUses.shared` (G16); without social, only this view (no switch, no Share a post).

## Share this job (`#/sharing/job/<path>`)

- **Job:** "Where should customers see this job?" **Primary:** the first not-done place's main action.
- **Reached from:** Write status line after Publish on a job ("Share this job" beside "See it on your site"), Write More, Posts row More on jobs (G15), the checklist, palette "Share this job: <title>". Back link "< Back to Sharing" (or to Write when she came from it, by `history`).
- **Loads:** `GET job-share?path=`; when `announcements`, `social/destinations` and `social/announcements?work=` too.

```
+--------------------------------------+
| < Back to Sharing                    |
| Share this job                       |  h2
| New roof on Maple Street. Post it    |  lede (title as text)
| where customers look.                |
| +----------------------------------+ |
| | Facebook               [Not yet] | |  content-card + status-badge
| | "New roof on Maple Street in ... | |  words, pre-line, tabindex 0
| | [photo]                          | |  96px thumb; "Save the photo" link
| | [ Post to Ridgeline Roofing ]    | |  primary (connected Page, pageOpen)
| +----------------------------------+ |
| | Nextdoor               [Not yet] | |
| | [Copy the words] [Open Nextdoor] | |  secondary; Open = new tab openUrl
| | [I posted it]                    | |
| | Google Business Profile  [Done]  | |  "Your site sends this to Google." when googleSending
+--------------------------------------+
```

- **Post to <Page>:** `POST social/announcements {accountId, work, caption: text, scheduledFor: soon(), idempotencyKey}` (key per job+words, made once) → "On its way to Ridgeline Roofing in about 5 minutes." Badge then follows the share (`BADGES`).
- **By hand:** **Copy the words** → "Copied. Paste them into Nextdoor." (clipboard refused: select the words, "Select the words and copy them.") **I posted it** → `POST job-share/by-hand {path, destination, digest}` → "Noted: you posted it on Nextdoor." with **Undo** (G17). Google by hand adds: "Add a Learn more button with the link, and the photo."
- **Badges:** Not yet / Going out / Done / You posted it / Check this / Didn't go out. `changedSince`: "You changed the job since. Post the new words if you like."
- **Fix first** (blocking problems, Studio words by code, server `message` in details): no-photo "Add a photo of the finished work to the job." / link-not-public "Publish the job first, so the link works." / other photo-* "The first after photo can't be used. Pick another in Write." / photo-location "The first photo may show where your customer lives. Use a copy without location." Buttons off; **Fix it in Write**.
- **Errors:** 422 `not-shareable`: "This isn't a published job, so there's nothing to share." 409 `changed`: reload, "The job changed while you looked. Here are the new words." 409 `sent`: "Your site already sent this, or may have. Look on Nextdoor first." 409 `not-ready`: on the card.

## Home: checklist and recipe notes

```
+--------------------------------------+
| What would you like to do?           |
| [2 new quote requests            >]  |  .studio-waiting lines (as built)
| ! About your recipe list             |  alert-banner info (recipe notes)
|   Your page “My recipes” uses the    |
|   address your recipe list wants...  |
|   [Open “My recipes”]                |
| Get your site ready      [More v]    |  h3 + dropdown-menu (Hide this list)
| 3 of 5 done                          |  p ink-soft
| v Add your phone number or email     |  status-badge "Done" per done step
| v Publish your first service         |
| o Publish your first job             |  first open step: hint + secondary button
|   Photos from the site and a few     |
|   words about the work.              |
| o Save your first review  [Open]     |
| o Share a job where customers look   |  waiting: "Publish a job first."
| Keep going ...                       |  (as built)
+--------------------------------------+
```

- **Checklist** (`meta.siteUses.trade`, `GET trade-checklist`, shown while `checklistVisible`): Studio's step words: business "Add your phone number or email" / "So customers can reach you." **Open Business facts**; service "Publish your first service" / "Change an example service to your own, then Publish it." **Open Services**; job "Publish your first job" / "Photos from the site and a few words about the work." **Start a job**; review "Save your first review" / "Copy a real customer's review, or type it in." **Open Reviews**; destination "Share a job where customers look" / "Google, Facebook or Nextdoor." **Share your newest job**. `href` goes through `legacyRoute`; `#/edit/<job>` for destination becomes `#/sharing/job/<job>`; a step whose route is still not built (Capture until R4) shows its hint and no button.
- **Hide this list** → G13 → "Hidden. Find “Get your site ready” to see it again." with **Undo**. Palette "Get your site ready" shows it again. All done: gone, toast once "Your site is ready."
- **Recipe notes** (`GET recipe-notes`, any site, only when notes): one banner, one line per note in Studio words (G14): taken address "Your page “My recipes” uses the address your recipe list wants, so the list is at /recipe-index/ instead." **Open “My recipes”** (`#/page/<path>`; by alias: "Ask the person who set up your site to free the address.") / no address "There's no list of all your recipes, because two pages use its addresses." / wordless "Readers can't browse by the course “???” because it has no letters. Add a word, like Dessert."

## Rules each part uses (runtime-moved, static imports)

| Part | From | Functions |
| --- | --- | --- |
| Topics sheet | `parts/seasonal-rules.js` | `withDisabled`, `withWindow`, `seasonalErrorText`, `windowProblems` (guard), `monthDayText` (details); new (G4) `withWords`, `withTopic`, `withoutTopic`, `ownTopicId` |
| Requests sheets | `parts/quote-words.js` | `quoteTrouble`, `statusWords`; new `retentionWords(days, source)`, `exportWords(count, from, to)` |
| Change / Check / history / late | `parts/announcements-rules.js`, `parts/share-words.js` | `captionLimitFor`, `blueskyNotes`, `mastodonNotes`, `browserZone`, `localToInstant`, `fieldForCode`, `REFRESH_CODES`, `lockedReason`, `eventText`, `healthLines` (details); `BADGES`, `deliveryOf`, `captionWords`, `problemLine`, `accountLabel`; `dates.js` `splitInstant`, `joinInstant`, `sayWhen`; new `historyLine(event)`, `lateBanner(health)` |
| Where it went | new `parts/distribution-rules.js` (pure half of `admin/distribution.js`) | `DESTINATION_NAMES`, `pagePath`, `announcementRow`, `reconcileRows`, `totals`, `mergeReport`; new `placeWords(row)` |
| Share this job | new `parts/job-share-rules.js` (pure half of `admin/job-share.js`) | `facebookAnnouncement`, `wayFor`, `pageOpen`, `soon`, `newKey`; `standingText` rewritten on `share-words`; new `JOB_PROBLEMS` |
| Home | new `parts/checklist-rules.js` (pure half of `admin/trade-checklist.js`) | `checklistSteps`, `checklistVisible`; `STEP_TEXT` in Studio words; new `stepHref(step)`; new `recipeNoteWords(note)` (G14) |

Port `tests/web/admin-{distribution,job-share,trade-checklist}.test.mjs` to `studio-*-rules.test.mjs`; extend `studio-seasonal-rules` (G4) and `studio-quotes-sharing`.

## Accessibility notes

- Month and day pickers are named "Starts, month" / "Starts, day"; the "Runs across the new year" line is `aria-describedby` on Ends.
- Every sheet returns focus to its opener; a saved topic card, the changed share row or the checked row takes focus after reload; statuses in the live region.
- The job's words block is focusable and named "Words for Nextdoor"; **Copy the words** is named "Copy the words for Nextdoor".
- Checklist steps are a list; done ones carry the word "Done", not a tick alone.

## Gaps

- **G4** (open since 10b, web only). `parts/seasonal-rules.js`: `withWords(entries, id, {topic, prompt})`, `withTopic(entries, {topic, prompt, start, end})` (id `own-<slug>`, at most 40, `-2` on clash), `withoutTopic(entries, id)`. The server already accepts own topics and changed words (core `parse_entry`, `incomplete`); nothing new there.
- **G7.** `resolve` with `published` requires `providerPostId`. Smallest change, no migration: `ResolveBody` accepts `("published", None)`; hosted `resolve` stores `owner-checked:<announcement id>` when none is sent (passes the 1–300 check and the unique index), and `postView` reports such a value as `providerPostId: null, checkedByOwner: true`; `announcementRow` gives it evidence `author`.
- **G12.** `quote/retention/run` has no dry run. Accept `{dryRun: true}` (Rust `object_body` allows `dryRun`) → hosted counts `archivedBefore` without `eraseRows` → `{enabled, wouldErase, photos, before}`; the erase passes `{before}` back and erases only what was archived before it. An older function ignores `dryRun` and erases, so Rust first reads hosted `GET retention` (`dryRun: true`, `eraseBefore: true`) and, without them, refuses with 409 `hosted-too-old`, sending nothing that could erase.
- **G13.** The checklist's dismissal lived in `preferences`, which Decide 1 deletes. Add `PUT trade-checklist {dismissed}` (stored in `.openblog/`), and `dismissed` in the GET.
- **G14.** `recipe-notes` returns finished sentences in old-Admin words ("Settings", "Slug", "Admin has no setting"). Return `{code, address, fallback, page: {path, kind, title}, byAlias, value}` beside `text`, so Studio words them and links the page.
- **G15.** `GET documents` items lack `profile`, so Posts can't tell a job. Add `profile`.
- **G16.** Sharing needs `meta.siteUses.shared`: any distribution record readable and non-empty (`outcomes::report` families).
- **G17.** No way to undo **I posted it**. Add `POST job-share/by-hand {path, destination, undo: true, at}`, taking back only the `posted-by-hand` mark stamped `at` (else 409 `marked-again`) and putting back the record it replaced (kept beside the mark as `replaced`).
- Not gaps: `reschedule` unused (PATCH covers it); trade-checklist hrefs stay old hashes, mapped by `legacyRoute` until R15.
