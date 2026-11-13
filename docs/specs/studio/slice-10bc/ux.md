# Studio UX, slices 10b and 10c: Quote requests, Reminders, Sharing

By `studio-ux`, 2026-11-13, from `studio-ux`, `admin/quote.rs`, `admin/seasonal.rs`, core `seasonal.rs`, `seasonal_store.rs`, `admin/social.rs`, `admin/announcements.rs` and `web/admin/{quotes,seasonal,social,announcements}.js`. Owner: **Dana**, a roofer, reading on her phone between jobs. Three nav items, each only when it applies: **Requests** (10b), **Reminders** (10b), **Sharing** (10c, holding accounts one step down). Studio draws every screen; it never mounts `createQuoteRequests`, `createSeasonalReminders`, `createSocialAccounts` or `createAnnouncementsPanel`. More tools' four old-Admin links become Studio links.

| Nav | `when(meta)` | Routes | Home line |
| --- | --- | --- | --- |
| **Requests** | `meta.quote === true` (env set, valid or not) | `#/quotes` | "2 new quote requests" when any are New |
| **Reminders** | `meta.siteUses.reminders` | `#/reminders` | "Time to write: Get the roof ready before winter" when one is due |
| **Sharing** | `meta.social === true` | `#/announcements`, `#/announcements/new?post=`, `#/social` | none; failures show on Sharing itself |

Nav order after Business: Requests, Reminders, Sharing. Home lines are `content-card`s in `.studio-waiting`, never a failure (as Comments and Cards).

## Requests (`#/quotes`)

- **Job:** "Who wants a quote, and have I called them back?" **Primary:** **Call** on the newest New request.
- **Title:** "Quote requests". **Question (h2):** "Who's asking for a quote?" **Lede:** "Newest first. Only you see these; they're never on your site."
- **Loads:** `GET quote/status`; when `enabled`, `GET quote/requests` once, no query (up to 500); Studio splits by status itself so the counts are right. Imports `STATUS_WORDS`, `MAX_NOTIFY_ATTEMPTS`, `emailTrouble`, `emailNote`, `countdown`, `OFF_TEXT` (details only) from `/admin/quotes.js`.

```
400 px                                   Desktop: list 46rem; at 70rem a right column
+--------------------------------------+  holds "Email trouble" and More's sheets
| [Menu] Requests      [Find] [Dana v] |  dashboard-shell
| Who's asking for a quote?    [More v]|  h2 + dropdown-menu (screen More)
| Newest first. Only you see these...  |  p ink-soft
| ! The email about 2 requests didn't  |  alert-banner warning (only when any)
|   reach you. They're safe here.      |
|   [Send those emails again]          |
| [ New 3 | Handled 12 | Archived 4 ]  |  segmented-control (counts in words)
| Service [All services          v]    |  select-field (only with 2+ services)
| +----------------------------------+ |
| | Pat Miller            [* New]    | |  content-card; status-badge (symbol+word)
| | Roof repair . Elkins             | |  service . town
| | Today at 9:14 AM                 | |  sayWhen(createdAt)
| | "Water coming in over the back   | |  p, textContent, white-space: pre-line
| |  bedroom after the storm..."     | |
| | [img][img]                       | |  up to 5 thumbnails 96px, link new tab
| | [ Call (304) 555-0101 ]          | |  action-button primary, href tel:
| | [Email] [Mark handled]   [More v]| |  secondary x2 + dropdown-menu
| +----------------------------------+ |
| > For the person who set up your site|  details
+--------------------------------------+
```

- **Card:** heading = `name`; line `service . town`; `sayWhen(createdAt)`; `description` as text; photos with alt "Photo 1 of 2 from Pat Miller"; when `photoCount` but no URLs: "2 photos can't be shown right now. Reload to try again." **Call** `href="tel:"+digits` (only `0-9` and a leading `+` kept; label shows the phone as sent). **Email** `mailto:` only when `email`. Handled/Archived cards: Call is secondary. Archived cards add `countdown` as Studio words: "Erased automatically in 12 days." Email trouble line: `emailNote(request)` with "!" icon, under the photos.
- **Card More:** Copy phone, Copy email, Archive / Mark as new (whichever is not current; Handled cards also Mark as new), Erase this request…
- **Status changes** (`POST quote/requests/<id>/status`): Mark handled → "Pat Miller: handled." with **Undo** (sets the old status back); Archive → "Archived. It's under Archived." (+ " It's erased automatically in 30 days." when retention is on) with **Undo**; Mark as new → "Pat Miller is back under New." Focus moves to the next card's heading, or the segmented control when none is left.
- **Strangers' text:** every request value (`name`, `phone`, `email`, `town`, `service`, `description`, `page`) only via `textContent`/attributes; never `innerHTML`, Markdown, the assistant or the page title. Photo `src` is the server-checked signed URL only.
- **Empty:** New: `empty-state` "No new requests" / "When someone fills in your quote form, it shows up here." Handled / Archived: "Nothing here yet." Filtered: "No requests for Roof repair here."
- **Email trouble** (`emailTrouble` on any): banner "The email about 2 requests didn't reach you. The requests are safe here." Button **Send those emails again** when `notifyEnabled` and any `notifyAttempts < MAX_NOTIFY_ATTEMPTS`; else "They were tried 5 times. Tell the person who set up your site." / (notify off) "Emails to you are turned off. Tell the person who set up your site." Retry result: "Sent 2 emails." / "1 email still didn't go out." (`POST quote/notifications/retry` counts).

### Screen More (rare, one step down)

| Item | Opens | Words and flow |
| --- | --- | --- |
| **Download a spreadsheet…** | `side-sheet` | `date-range` "Which days?" (both empty = all). Help: "It has customers' phone numbers, so keep it somewhere private." **Download** → `GET quote/export?from&to` → file → "Downloaded 14 requests." |
| **Erase a customer's requests…** | `side-sheet` | For a customer who asks to be forgotten. `text-field` "Their name, phone or email"; matches from the loaded list as toggles (all on), "Pat Miller . Roof repair . October 3". **Check what goes** → preview (below). |
| **Clean up archived requests…** | `side-sheet` | `radio-group`: "Keep them until I erase them" / "Erase them [30] days after I archive them" (`text-field` inputmode=numeric, 1 to 3650). **Save** → `POST quote/retention {days}` → "Saved. Archived requests are erased 30 days after you archive them." Quiet **Erase the old ones now** (`retention/run`) → "Erased 3 old requests." Host-set (`retentionSource` not `admin`): line "Archived requests are erased after 30 days. The person who set up your site chose this." and no fields. |

- **Erase, always previewed:** every erase (card or sheet) first `POST quote/erase/preview {ids}`, then `modal-dialog` "Erase Pat Miller's request?" / "Erase 3 requests?": "This removes them and their 2 photos for good. It can't be undone. If anything goes wrong, nothing is removed." **Keep them** (focused), **Erase for good** (danger) → `POST quote/erase {ids, token}`. Done: "Erased, and checked: they're gone." `photosPending`: add "1 photo is still being removed; nothing points to it." A 409 `preview-required` previews again once and re-asks; `changed` reloads: "Something changed while you looked. Here's the list now; nothing was erased."

### States and errors (Requests)

| What | Words |
| --- | --- |
| Loading | `skeleton-block shape=card` x3, `aria-busy` |
| `state: invalid`, or 404 `not-enabled`, or 502 key refused | `alert-banner danger` "Studio can't open your quote requests" / "The quote form isn't connected properly. Tell the person who set up your site." `OFF_TEXT` and setting names in details. |
| `unreadable > 0` | `alert-banner warning` "2 requests can't be shown here. They're still stored. Tell the person who set up your site." |
| 502 / 504 / none | banner "Your quote requests didn't load" / "Check your connection and try again." **Try again**. Status changes: "That didn't save. Try again." Server text only in details. |

**Details:** request `id`s, `page` (where it was sent from), raw `createdAt`/`handledAt`/`eraseAfter`, `notify`, `notifyAttempts`, `notifyError`, `retentionDays`/`retentionSource`, quote status `state` and `problems`. **Palette:** Go to Quote requests, Show new / handled / archived, Download a spreadsheet, Erase a customer's requests, Call <name> (New only).

## Reminders (`#/reminders`)

**What they are (verified):** writing prompts for **Dana**, not messages to customers. Each topic (bundled per trade, e.g. roofing's "Get the roof ready before winter", September 1 to October 31) is listed while its window is open or opens within 30 days. **Start a draft** writes an unpublished post (title = topic, first paragraph = prompt) in `posts/`; nothing publishes, builds or sends. More tools' "Seasonal reminders for customers" is wrong and becomes "What to write about, by season".

- **Job:** "What should I write about this time of year?" **Primary:** **Start a draft** on the first due reminder.
- **Title:** "Reminders". **Question (h2):** "What's worth writing about now?" **Lede:** "At the right time of year, Studio suggests something your customers are wondering about. You choose: write it, wait, or skip it."
- **Loads:** `GET seasonal`. Imports `STATUS_TEXT`, `dayText`, `monthDayText`, `withDisabled`, `withWindow`, `windowProblems`, `seasonalErrorText` from `/admin/seasonal.js` (not `editHref`: Studio uses `postHref`).

```
400 px                                   Desktop: one column 46rem; topics sheet on the right
+--------------------------------------+
| Reminders                    [More v]|  h2 + dropdown-menu
| At the right time of year, ...       |  lede
| Time to write                        |  h3 (due)
| +----------------------------------+ |
| | Get the roof ready before winter | |  content-card heading
| | "Gutters, flashing and loose     | |  prompt, Literata, textContent
| |  shingles to deal with..."       | |
| | Best before October 31           | |  sayDay(closes)
| | [ Start a draft ]                | |  action-button primary
| | [Not now]                [More v]| |  secondary + dropdown-menu
| +----------------------------------+ |
| Coming up                            |  h3 (upcoming, snoozed, opened)
| After a storm . Starts May 15        |  content-card, quiet; [Start early]
| Roof check . Snoozed to Nov 20       |  status-badge words
| Pre-winter . Draft started [Open it] |
+--------------------------------------+
```

- **Start a draft** (`POST seasonal/open {key}`) goes straight to `#/write/<document>` with toast "Here's a draft to start from. It's not on your site." (`created: false`: "You started this one already. Here it is."). `voiceReady` adds to the toast: "The Assistant can help write it in your voice." Back from Write lands here, the card now "Draft started" with **Open it**. `document: null`: status "Started a draft, but Studio can't open it here. Find it under Posts."
- **Not now:** `snooze {days: 7}` → "I'll remind you again Friday, November 20." **Card More:** Remind me in a month (30), Not this season (days to `closes`, at most 90; "Skipped until next season."), Stop suggesting this (`withDisabled(..., true)`, **Undo** turns it back on). Upcoming cards: **Start early** (secondary) and the same More.
- **Off** (`enabled: false`): `empty-state` "Reminders are off" / "Turn them on and Studio suggests what to write for your trade, at the right time of year. It never publishes anything." **Turn on reminders** (primary) → PUT `{enabled: true, topics: entries}` → "Reminders are on."
- **Nothing listed:** "Nothing to write about for the next month. Studio will tell you when something comes up." **No trade:** help under the lede: "Pick your trade in Business facts for roofing topics." (link `#/business`).
- **Screen More:** **Change topics and dates…** (side-sheet), **Turn reminders off** (Undo), Show details.
- **Topics sheet:** heading "Topics for roofing"; one row per topic: name, `toggle-switch` "Suggest this", "Starts [September v] [1 v]" / "Ends [October v] [31 v]" (`select-field` month + day; Studio joins `MM-DD`, so `windowProblems` never fires on her), **Save dates** → `withWindow` → "Moved to September 1 through October 31." Below: **Add your own topic** → Topic, What to write about (rows=3, 600 max), Starts, Ends → **Add it** (custom entry, id = slug of the topic; G4). Own topics get **Remove** (ask once).
- **Errors:** `seasonalErrorText` words, except: 409 with `etag` → reload, "These changed on another device. Here they are now; make your change again."; 404 on open/snooze → "That reminder isn't listed any more." and reload; 422 → on the topic row, server text in details.

**Details:** reminder `key`, `opens`/`closes`, `draft` path, `today`, `etag`, `entries` JSON, `trade`. **Palette:** Go to Reminders, Start a draft: <topic> (each due), Change topics and dates, Turn reminders on/off.

## Sharing (`#/announcements`) and Your accounts (`#/social`)

One nav item: **Sharing** answers "Where have my posts gone out, and what's going out next?" Accounts are set up once, so they sit one step down at `#/social`, reached by the **Your accounts** button, the empty state and Find. Sharing never happens by itself: Publish never shares (decided).

### Sharing (`#/announcements`)

- **Primary:** **Share a post** (→ `#/announcements/new`). **Question:** "Where have your posts been shared?" Secondary: **Your accounts (2)**.
- **Loads:** `GET social/destinations`, `social/posts`, `social/announcements` together; `announcements/health` after. Imports from `/admin/announcements.js`: `DELIVERY_BADGES`, `deliveryOf`, `nextStepText`, `problemWords`, `lockedReason`, `REFRESH_CODES`, `fieldForCode`, `errorText` (details), `eventText`, `healthLines`, `destinationLabel`, `captionLimitFor`, `captionCount`, `blueskyNotes`, `mastodonNotes`, `localToInstant`, `instantToLocalInput`, `browserZone`, `newKey`.

```
400 px                                   Desktop: list 46rem; composer opens in
+--------------------------------------+  a right column at 70rem
| Where have your posts been shared?   |  h2
| [   Share a post   ] [Your accounts] |  primary + secondary
| ! Facebook needs reconnecting before |  alert-banner (accounts-need-reconnect)
|   it can share. [Reconnect]          |
| Needs you                            |  h3 (failed, unknown)
| Ice dams: what to do . Facebook      |  content-card; badge "x Didn't go out"
|  The provider refused the post.      |  problemWords(lastErrorCode)
|  [Try again]                 [More v]|
| Going out                            |  h3 (pending, retrying, processing)
| Ice dams . Bluesky . Today at 3:05 PM|  badge "Scheduled"; [Change] [More v]
| Shared                               |  h3 (published, newest 10; [Show all])
| Storm season tips . Facebook . Nov 2 |  badge "Shared"; More: See it there
+--------------------------------------+
```

- **Row:** heading = the post's title (matched by `work` from `social/posts`; else "A post"); line `destinationLabel` short ("Facebook, Ridgeline Roofing") and `sayWhen(scheduledFor)`; badge from `DELIVERY_BADGES` with Studio words: Scheduled, Sending, Trying again, Shared, Didn't go out, Check this, Not shared. `nextStepText` under Sending/Trying again. Captions shown as text only.
- **Going out:** **Change** → `side-sheet` caption + day/time → PATCH (caption) or `reschedule` → "Changed. It goes out Friday at 9 AM." More: **Don't share it** → ask once "Don't share Ice dams on Bluesky?" / "It won't go out. You can share it again later." **Don't share it** / **Keep it** → "It won't be shared."
- **Didn't go out:** `problemWords(lastErrorCode)`; **Try again** (`retry {version}`) → "It'll be tried again within a minute." Auth codes (`provider-auth`, `needs-reauth`) show **Reconnect** instead (→ `#/social`).
- **Check this** (`unknown`): **Check it** → `side-sheet` "Facebook didn't say whether it posted. Look at your Facebook Page." `radio-group` "It's there" / "It isn't there"; "It's there" shows "Paste the link to that post" (`text-field` type=url) → `resolve` → "Marked as shared." / "Marked as not shared. You can try again."
- **Empty:** no accounts: `empty-state` "Nothing to share to yet" / "Connect your Facebook Page or another account, then share posts from here or right after you publish." **Connect an account**. Accounts but nothing shared: "Nothing shared yet" / **Share a post**.
- **Stale** (`REFRESH_CODES`): reload, status "Something changed while you looked. Here's the list now."

### Share a post (`#/announcements/new`, `?post=<work>`)

```
+--------------------------------------+
| < Back to Sharing                    |
| Share a post                         |  h2
| Which post?  [Ice dams: what to d v] |  select-field (eligible posts; others in details)
| Share to                             |  fieldset
| (o) Facebook, Ridgeline Roofing      |  toggle-switch per healthy account (G11)
| (o) Bluesky, @ridgeline              |
| What to say  [Ice dams can ruin a ]  |  text-field rows=4, prefilled with the title
| 42 of 300 (Bluesky is the shortest)  |  captionCount against the smallest limit
| When  [ In a few minutes | Pick ]    |  segmented-control
|       [2026-11-14] [9:00 AM]         |  date-field + text-field type=time (Pick only)
| > How it looks on Bluesky            |  details per account: blueskyNotes/mastodonNotes
| The link to your post goes with it.  |  p ink-soft
| [      Share it      ]               |  action-button primary
+--------------------------------------+
```

- **Defaults:** `?post` or the newest eligible post; every healthy account on (her last choice kept on this device); caption = post title; "In a few minutes" = now + 5 minutes, so the page is up before anyone clicks.
- **Preview:** `POST social/preview` per chosen provider (350 ms debounce) gives `problems` by `field` (shown on that field) and `card`/`cover` for the notes. Notes and link are text only.
- **Share it:** one `POST social/announcements` per account, each with its own `newKey()` made when the composer opens and kept across retries. All ok: "On its way. Facebook and Bluesky get it in about 5 minutes." (or "Friday at 9 AM"), back to Sharing. Some fail: stay, "Shared to Facebook. Bluesky didn't take it: the caption is 12 characters too long." Problems go on their field (`fieldForCode`), focus the first. `replayed`: "Already set to share there."
- **Leaving** with a changed caption asks "Share this post?" / "You wrote something and didn't share it." **Share it**, **Leave without sharing**.

### From Write and Posts (decided)

- **Write:** after Publish or Update on a published post, when `meta.social` and at least one healthy account, the status line gets **Share it** beside "See it on your site" → `#/announcements/new?post=<url>`. Nothing else in Write changes.
- **Posts:** each published row's More gets **Share it**. Palette: "Share <title>".

### Your accounts (`#/social`)

- **Job:** "Which of my accounts can Studio share to?" **Primary:** **Connect** on the first unconnected provider (or **Reconnect** on one that needs it).
- **Loads:** `GET social/status`, `social/accounts`, `social/connections`. Imports `HEALTH`, `SCOPE_WORDS`, `VISIBILITY_WORDS`, `APP_PASSWORD_HINT`, `safeAuthorizeUrl`, `OFF_TEXT` (details) from `/admin/social.js`.

```
+--------------------------------------+
| < Back to Sharing                    |
| Your accounts                        |  h2
| Connected                            |  h3
| Ridgeline Roofing      [v Connected] |  content-card; status-badge from HEALTH
| Facebook Page        [Reconnect][..] |  More: Disconnect…, Show details
| Add an account                       |  h3
| Facebook   [Connect Facebook]        |  content-card per provider in status
| Bluesky    [Connect Bluesky]         |  -> side-sheet (handle + app password)
+--------------------------------------+
```

- **Connect (sign-in page):** `POST social/connections {provider}`; the card becomes "Continue to Facebook to say yes. It opens in a new tab." with **Continue to Facebook** (primary link, `safeAuthorizeUrl` only) and **Cancel**. On window focus Studio reloads; when `authorized`: "Facebook said yes. Where should posts go?" `radio-group` of destinations (ineligible ones disabled with the reason in words) → **Connect this one** → "Ridgeline Roofing is connected." No link after a reload: "Start again; the link only works from this page." (G6).
- **Connect Bluesky:** `side-sheet` fields "Bluesky handle" (placeholder name.bsky.social) and "App password" (type=password, emptied as it's sent), help `APP_PASSWORD_HINT`. Errors on their field in Studio words: "Type your handle, like name.bsky.social." / "That isn't an app password. Make one in Bluesky's settings; never use your real password."
- **Health:** `expiring`: "Facebook stops working soon. Reconnect it, signing in as the same account." `needs-reauth`: same, "stopped working". Reconnect becomes the card's primary.
- **Disconnect** (card More): `modal-dialog` "Disconnect Ridgeline Roofing?" / "Posts waiting to go there won't be shared, and Studio forgets how to post there. You can connect it again later." **Keep it connected** (focused), **Disconnect** → "Disconnected. 1 waiting post won't be shared." (`canceledAnnouncements`).
- **Not set up:** `state` invalid/unavailable or no providers: `alert-banner` "Sharing isn't set up yet" / "The person who set up your site needs to finish it." Setting names, problems, scopes, redirect address, API version, Mastodon instance and visibility only in details.

### Errors (Sharing and accounts)

Server text never on the first layer (some carries setting names). 502 `hosted-key-rejected`/`hosted-unavailable`: "Sharing isn't working right now. Tell the person who set up your site." Other 502/504/none: "Studio couldn't reach your sharing service. Try again in a minute." 422 caption/time codes: on the field. 401: the shell's sign-in, caption kept.

**Details:** account ids, `externalId`, `credential` dates and scopes, connection ids and `notes`, announcement id, `version`, `canonicalUrl`, UTC times and zone, `eventText` history (loaded on open), attempts with HTTP status, `healthLines`. **Palette:** Go to Sharing, Share a post, Share <title>, Go to Your accounts, Connect <provider>.

## Accessibility notes

- Badges carry words; symbols are `aria-hidden`. Thumbnails are links named "Open photo 1 of 2 from Pat Miller". **Call** is named "Call Pat Miller at (304) 555-0101".
- After a status change or erase, focus goes to the next card's heading; sheets and dialogs return focus to their opener; statuses in the live region.
- Caption count is `aria-describedby` on the caption and announced only when crossing the limit.

## Gaps

- **G1.** Home's quote line fetches every request (with signed photo URLs) through the hosted function. Add `GET quote/summary` → `{new, emailTrouble}`.
- **G2.** Quote errors lack stable codes where it matters (401 key refused, 502 unreachable, 504) and their text names env settings. Add `code` to every quote error; Studio maps codes, never words.
- **G3.** `countdown` and `emailNote` print ISO dates. Give both an optional `sayDate` so Studio shows "November 30".
- **G4.** `seasonal.js` has no `withCustomTopic(entries, topic)` / `withoutTopic(entries, id)`; the server takes custom topics but nothing writes them. Add both (pure, tested). No un-snooze route either; Undo on Not now is left out.
- **G5.** `social.js` keeps destination `REASONS`, `KIND_WORDS` and `providerName` inside the component; `announcements.js` keeps its own `providerName`. Export one set from `social.js`.
- **G6.** An OAuth attempt's `authorizeUrl` is lost on reload, and the provider's return page doesn't come back to Studio. Return the URL from `GET social/connections` while `pending`, and let the callback redirect to `/studio/#/social`.
- **G7.** `resolve` with `published` requires `providerPostId`; Dana can paste a link (it passes the shape check) but shouldn't have to. Make it optional.
- **G8.** Sharing to several accounts is N `POST`s; a partial failure is handled per account. A batch route would be simpler but is not needed.
- **G9.** `formatWhen` is en-GB 24-hour; Studio uses `sayWhen` and keeps `formatWhen` for details.
- **G10.** More tools: "Seasonal reminders for customers" is wrong. Change all four Business-group rows to Studio links; Reminders reads "What to write about, by season".
- **G11.** Account choice and erase picks want the `check-group` from slice 10a G4; until then `toggle-switch` per row.
