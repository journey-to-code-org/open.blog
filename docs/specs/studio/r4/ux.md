# Studio UX, retirement slice R4: Jobs capture

By `studio-ux`, 2026-11-13. Sources: `studio-ux`, `retirement-plan.md` (§1 B "Job form", "Content profile"; §1 D `#/capture`; §1 I `capture-*.js`, `job-capture.js`, `job-form.js`; §4 R4; Decided), `r1/ux.md`, `r3/ux.md` (`herePhone`, `deviceNoun`, denied steps, G20 manifest), ADRs 0296–0298, 0302–0304, `docs/jobs.md` §"Capturing a job from a phone", `docs/admin.md` §"Transcribing a voice note", `web/admin/{job-capture,capture-queue,capture-recorder,capture-assistant,job-form}.js`, `admin.js:14614,22169,23569,26118`, `crates/openblog-cli/src/admin.rs` (`upload` 18797, `upload_capture_audio`, `save_document` 16870 + `replayed_capture`, `job_check` 3950, meta `job`/`capture` 4174,4281, `SESSION_COOKIE` ttl 3653), `admin/capture_assistant.rs`, `admin/trade_checklist.rs:54`, `openblog-core/src/{capture,job,model}.rs`, `photo.rs`, and Studio's `router.js`, `api.js`, `screens/{index,write,new-post,tools,not-yet,posts}.js`, `parts/{write-page,checklist-rules,picture-picker,photo-strip,record-kinds,post-fields}.js`, `zubra/cdn/file-drop.js`.

Owners: **Dana**, a roofer with a phone on a roof with one bar of signal, who wants the job down before she climbs off and finished at home. **Mikey**, who wants to see what's on the phone, what the server has, and why anything didn't go. **Grammi** isn't a trade site and sees nothing new.

The job, in Dana's words: **"I'm on a roof with a phone. Photos, a few words, and it's on my blog as a draft I finish later."** After R4, nothing about jobs opens the old Admin, and no capture saved by the old Admin is lost.

**Decided (2026-11-13), following the recommendations below:**
1. **G35 yes:** `/admin/sw.js` caches Studio's own static files (versioned, installed all or nothing, network-first with a 3 s limit, never API replies); Studio keeps the last `meta` and user in `localStorage`, so New job opens and keeps jobs with no signal. This narrows R3's "no caching" to "never API replies".
2. **Shrink photos on the phone yes:** before keeping, photos become 2000 px JPEG at quality 0.82 with location dropped (the server's own rule in `photo.rs`); the original is kept when decoding fails (an iPhone's own format too), and refused only when it isn't a picture or is over `maxPhotoBytes`.
3. **Write it up for me moves to Write** (amends ADR 0304; old records with `fields.draft` still send as before).

**Her words:** her layer says "your blog", "this phone" (`deviceNoun`), "a signal", "saved on this phone", "sent", "waiting". Never "Studio", "Admin", "upload", "sync", "offline", "queue", "IndexedDB", "capture", "slot", "ledger", "idempotent", "permission", "device", "browser" (except naming Safari or Chrome), "AI provider", "model". Those go under **Details for the person who set up your site**.

| Job | Lands in | Route | Replaces |
| --- | --- | --- | --- |
| Get a job down on site: photos, voice note, a few words | **New job** | `#/new-job` | old `#/capture`; More tools "Jobs" |
| See what's waiting on this phone; send, retry, save photos out, throw away | New job, "Waiting on this phone" | same | old "Waiting to send" |
| Know something's waiting, from anywhere | Home card, shell sender | `#/` | none (old sent only while Capture was open) |
| Start a job at a desk | Write, "What are you writing?" → **A job** | `#/write/new/job` | old New post + Content profile Job |
| Finish a job: service, town, dates, price, review, before/after | Write, **About this job** | `#/write/<path>` | old Settings pane Job form |
| Check a job before it goes up | Write, Publish runs the check | same | old **Check this job** |
| Turn the voice note into words; write it up from notes | Write (and New job, voice note only) | same | old **Transcribe with AI**, **Draft with AI** |

**`legacyRoute`:** drop `"capture"` from `NOT_YET` and `not-yet.js` `NAMES`. `#/capture` and `#/capture/<anything>` → `#/new-job`, keeping the query. The checklist's job step (`trade_checklist.rs:61`, `href: "#/capture"`) resolves through `stepHref` to `#/new-job`, so **Start a job** gets its button. `tools.js`: "Jobs" becomes `["Jobs", "Post a job from the site, with its photos", "#/new-job", "studio"]`, only when `tradeSite(meta)`.

**Route wiring:** `screens/index.js` gains `{ name: "new-job", nav: "New job", area: "jobs", navWhen: tradeSite, create: createNewJob }`, always present. The `write` route takes `new/job` beside `new/recipe` and `new/story`. Reached from:
- **Navigation** (trade sites): **New job**, after Posts.
- **Home** (trade sites): **Add a job from the site**, secondary, beside **Write something new**. On any site with something waiting: the waiting card.
- **What are you writing?** (trade sites): third card **A job**: "Photos and what you did, for customers to see." → `#/write/new/job`.
- **Palette:** "New job", "Send waiting jobs now" (when any wait), "Write it up for me" (on a job post).
- **Installed app** (trade sites): long-press the icon → **New job** (G34).

## Flow

```
Roof. App icon (long-press: New job) / nav New job / Home "Add a job from the site"
  v
New job (#/new-job)   <- picks up where she left off if the phone reloaded
  | Take a photo (x n) / Choose photos / Record a voice note / a few words
  | [Save this job]
  v
"Saved on this phone."  -- signal? --yes--> "Sending... photo 3 of 6" --> "Sent. Roof repair in
  |                                                                       Elkins is a draft on
  | no                                                                    your blog." [Finish it]
  v                                                                              |
Waiting on this phone (same screen; Home card on any screen)                     |
  | signal comes back / she opens her blog / Send now                            |
  +----------------------------------------------------------------------------->+
                                                                                 v
                                     Write (#/write/<path>): About this job, four parts,
                                     voice note -> words, Write it up for me, Publish
                                     (job check first) -> Share this job (R1)
```

**Getting back:** New job is top-level (nav, breadcrumb "Home › New job"). **Finish it** opens Write (breadcrumb to Posts and Home). Dialogs and sheets close with Escape or ×; focus returns. Nothing depends on browser Back. A saved job is on New job and Home until it sends.

## New job (`#/new-job`)

- **Job:** "Get this job down before I leave the site."
- **Title:** "New job". **Lede:** "Take photos and say what you did. It's kept on this phone until there's a signal, then goes to your blog as a draft."
- **Primary:** **Save this job**, sticky bottom bar (always visible at 400 px). Ctrl/⌘ S does the same.
- **Loads:** nothing from the server is needed to keep a job. Uses `meta` (`capture` limits, `job`, `siteUses`; the cached copy when offline) and `herePhone()`. Opens the waiting list and the in-progress job. `GET assistant/transcribe` runs only once a voice note exists and there's a signal.

```
400 px                                       Desktop (>= 48rem): 1fr + 22rem
+------------------------------------------+
| Home > New job                           |  breadcrumb-trail
| New job                                  |  h2 (tabindex -1, focused on open)
| Take photos and say what you did. It's   |  lede
| kept on this phone until there's a       |
| signal, then goes to your blog as a      |
| draft.                                   |
| [status line]                            |  live region
| 2 jobs waiting on this phone.  See them  |  link (only when any)
| +--------+ +--------+ +--------+         |  auto-grid min 5.5rem thumbnails,
| |  img  x| |  img  x| |  img  x|         |  x = "Remove photo 2"
| +--------+ +--------+ +--------+         |
| [      Take a photo       ]              |  secondary, large (camera)
| [      Choose photos      ]              |  file-drop, button look, multiple
| 3 of 12 photos                           |  help
| Voice note                               |  fieldset legend
| [   Record a voice note   ]              |  secondary
| Up to 3 minutes.                         |  help
| What did you do?                         |  text-field, rows 4
| [                                    ]   |
| Roofing · Roof repair · Elkins  Change   |  summary + link-style button
| > Camera won't open?                     |  details
| Waiting on this phone (2)                |  h3 (side column on desktop)
| +--------------------------------------+ |
| | Gutter job in Beverly      [Waiting] | |  content-card + status-badge
| | 4 photos, voice note. Saved today    | |
| | at 11:40 AM.                         | |
| | No signal when it last tried, at     | |
| | 11:52 AM. It tries again by itself.  | |
| | [ Send now ]                [More v] | |  More: Save the photos, Throw away
| +--------------------------------------+ |
| Sent this visit                          |  h3, only after a send
| Roof repair in Elkins.  Finish it        |
| > Details for the person who set up      |
|   your site                              |
|==========================================|
| [         Save this job          ]       |  sticky bar, primary, full width
+------------------------------------------+
```

Desktop: form in the main column; "Waiting on this computer" and "Sent this visit" in the side column. 320 px: no sideways scroll, three thumbnails a row, buttons full width and stacked.

**No signal and not opened before (until G35's cache is warm):** on phones, under the lede: "Open this before you go up. It keeps working when the signal drops."

### Photos

- **Take a photo** opens the camera (`accept="image/*" capture="environment"`, one at a time). **Choose photos** opens the library (`multiple`). Both add to the same grid. Needs `capture` on `file-drop` (Zubra change).
- Each picked photo is shrunk on the phone (Decided 2) before it is kept; while that runs, its thumbnail shows `skeleton-block`.
- Thumbnail: the picture (`URL.createObjectURL`, `alt=""`) and × "Remove photo 2". Removing says "Removed photo 2." and focuses the next thumbnail or **Take a photo**; an inline **Undo** ("Undo removing photo 2") stays under the status until her next action (any change to the job, adding photos, saving), and puts the photo back where it was: "Photo 2 is back.", focus on its ×.
- A photo this phone can't read (HEIC/HEIF it can't decode, among others) is kept as it was, never refused for its format; if her blog can't show it, the Sent row names it when the job goes ("…is in a format websites can't show.") and the rest of the job goes. **Details** under the photos list each photo's original and kept bytes and types (`photoBytesLines`; the original's size and type live only in the job in progress, never in the `openblog-capture` record).
- Checked at once (`photoProblem`); every problem is named, and usable photos are still added:

| Problem | Words |
| --- | --- |
| Not a picture | "“Invoice.pdf” isn't a photo." |
| Over `maxPhotoBytes` after shrinking (or as it was, when it couldn't be shrunk) | "“IMG_0042” is too big to use. The limit is 40 MB a photo." |
| Over 12 | "A job holds up to 12 photos, so these 2 weren't added: IMG_0050, IMG_0051." |

- **Camera won't open?** (`details`, only this phone's steps): iPhone: "Tap Choose photos, then Take Photo. Or take them in the Camera app and choose them here after." Android: "In the Settings app: Apps, then Chrome, then Permissions, then Camera, then Allow." Computer: "Use Choose photos to pick photos you've already taken." Always there, never an error.

### Voice note

States from `createRecorder` (ported unchanged): `idle`, `starting`, `recording`, `recorded`.

| State | Shows | Buttons |
| --- | --- | --- |
| idle, can record | "Up to 3 minutes." | **Record a voice note** |
| idle, can't | "Voice notes don't work here. Type a few words instead." | none |
| starting | "Your phone may ask to use the microphone. Tap Allow." | loading |
| recording | red dot + "Recording 0:42 of 3:00" (dot static under reduced motion) | **Stop** (primary-styled, focused), **Throw it away** |
| recorded | `<audio controls>` named "Your voice note", "1:12 long." | **Record again** (asks "Replace your voice note?" **Replace** / **Keep it**), **Throw it away**; **Turn it into words** |

| Stopped or refused | Words |
| --- | --- |
| `denied` | "Your blog isn't allowed to use the microphone on this iPhone. To change that:" + `micSteps` + "Or type a few words instead." |
| `unavailable` | "The microphone didn't start. If another app is using it, close that app and try again. Or type a few words." |
| `time` | "Stopped at 3 minutes, the longest a voice note can be. It's kept." |
| `size` | "Stopped: that's as long as a voice note can be. It's kept." |
| `error` | "The recording stopped by itself. What you said up to then is kept." (empty: "Nothing was recorded.") |
| left screen / backgrounded while recording | stops and keeps it; next open: "Your voice note stopped when you left. It's kept." |

**`micSteps(here)`** (one `ol`): iPhone/iPad: "1. Open the Settings app. 2. Tap Apps, then Safari (on older iPhones, just Safari). 3. Tap Microphone and choose Ask or Allow. 4. Come back and tap Record again." Android in Chrome: "1. Tap the small icon at the left end of the address bar. 2. Tap Permissions. 3. Turn on Microphone." Android from the icon: "1. Touch and hold your blog's icon. 2. Tap App info. 3. Tap Permissions, then Microphone, then Allow." Computer: "Click the small icon at the left end of the address bar and allow the microphone."

**Turn it into words** (recorded note, a signal, `GET assistant/transcribe` `available`):
- Sheet "Turn your voice note into words". Local: "Your blog turns it into words on its own computer. Nothing leaves it." Provider: "Your voice note goes to OpenAI to be turned into words. Only the recording goes: not your photos or your notes. OpenAI's own rules cover what it keeps." (`destination` named, never the model.) **Turn it into words** / **Not now**.
- Then `POST capture-audio?capture=<id>`, `POST assistant/transcribe {captureId, confirmed: true}`. Words go under what she typed (`appendTranscript` after `plainNotes`). "Added to your words. A computer wrote them from your voice note, so read them through." With `truncated`: "…It was long, so the end was left off." Toast **Undo** ("Taken out. Your words are as they were.").
- No signal: button hidden; help "When there's a signal, you can turn it into words here or later, when you finish the job."
- Errors: 404 `not-configured` hides it; `empty-transcript` "No words were heard in it. Type a few instead."; 429 `concurrency-limit` "Your blog is busy with another one. Try again in a minute."; else "That didn't work. Your voice note is still here; try again, or type instead."

### What did you do?

`text-field` rows 4, `maxlength` = `maxNotesChars`. Counter only past 90%: "7,412 of 8,000 letters".

### Trade, service, town

Remembered on this phone (`openblog.capture.prefs.v1`, unchanged: `readPrefs`/`rememberPicks`).
- **Summary line** when any remembered: "Roofing · Roof repair · Elkins" + **Change** (expands the fields; focus to the first). Expanded on first use.
- **Trade** (`select-field`): hidden when the site has one trade (`meta.job.siteTrade`, G33); labels from ids ("General contractor").
- **Service** (`select-field`): her Services by title (G33) + **Something else** → `text-field` "What service?", help "Add it under Services later so it shows on your site."
- **Town** (`text-field`): help "Just the town, never the street. Customers see it." Five recent towns as link buttons ("Use Elkins").

### Save this job

1. A running recording is stopped and kept.
2. Empty: "Add a photo, a voice note or a few words first." Focus to **Take a photo**.
3. `makeRecord` (format v1 unchanged, plus `by: <user>`) and `queue.add`. Room problems leave the job on the screen:

| `roomProblem` / store | Words |
| --- | --- |
| `maxQueued` | "This phone is already holding 5 jobs that haven't sent. This one stays here until they go." **Send now** (with a signal) |
| `maxCaptureBytes` | "This job has too many large photos to keep. Take out about 3." (largest first) |
| `maxQueueBytes` | "The jobs waiting on this phone are using all the room your blog has here. Send them first. This one stays here." |
| `QuotaExceededError` / write failed | "This phone is out of room to keep it. Free up some space, or send the waiting jobs first. This one stays here." |
| store closed (another window's `versionchange`, or the browser closed it) | opened again and saved once more; if it can't be opened: "Another window updated your blog's pages. Reload, then save again. This job stays here." (never "out of room") |

4. Kept: form clears (new id), picks remembered, `navigator.storage.persist()` asked once silently, status "Saved on this phone.", focus to status. The sender starts at once.

### The job she's in the middle of

iOS can reload the page when the camera opens, so the form is kept as she goes in a **separate** store (`studio-new-job`, v1, store `open`, key = user) — never in `openblog-capture`, so the old Admin can't send a half-made job. Written on every change, debounced 500 ms.
- Opening with one kept: restored silently; status "Picked up where you left off, Tuesday at 2:14 PM." Older than a day: a quiet **Start over** (asks "Throw away this unsaved job? Its 3 photos and words go." **Keep it** / **Throw it away**).
- Leaving never asks (nothing is lost); the leave-guard asks only while a save runs.
- **Save this job** clears it.

## Waiting on this phone

One list over `openblog-capture` (DB v1, store `captures`). One `content-card` per record, oldest first. Heading `captureTitle` in her words ("Roof repair in Elkins", "Roofing job", "Job notes, November 13"). Meta: "4 photos, voice note. Saved today at 11:40 AM." (never MB).

| State | Badge | Words | Buttons |
| --- | --- | --- | --- |
| Waiting, not tried | Waiting | "It sends by itself when there's a signal." | **Send now** |
| Waiting, tried, retryable | Waiting | "No signal when it last tried, at 11:52 AM. It tries again by itself." | **Send now** |
| Sending | Sending | "Sending photo 3 of 4…" → "Sending the voice note…" → "Making the draft…" (in another window: "Sending in another window…") | none (More has no Throw it away) |
| Sign-in needed (401) | Needs you | "Sign in again to send it." | **Sign in** (shell dialog), then it sends |
| Refused | Didn't send | words by code (below) + "Nothing is lost: it's still on this phone." | **Try again**; More |
| Sent before, deleted since (`duplicate`, `removed`) | Needs you | "This job went to your blog before, and was deleted there since." | **Send it again** (new id: copy, put copy, remove old, send); More |
| Sent, a photo couldn't go (`sent.skipped`) | Sent | "It's a draft on your blog, but 1 photo couldn't go: “IMG_0042” is in a format websites can't show." | **Save that photo to this phone**, **Done**; **Finish it** |
| Saved by someone else (`by` ≠ user) | Needs you | "Saved while Sam was signed in on this phone." | **Send it** asks first (`modal-dialog` "Send Sam's job as you?" / "It goes to your blog as yours." **Send it** / **Not now**), then it goes as hers like her own jobs in this window; the record's `by` is never rewritten and the sent log keeps it; More |
| Newer format (`v` > 1) | Needs you | "This job was saved by a newer version of your blog's pages. Reload to send it. If it still says this, tell the person who set up your site." | **Reload**; More |
| Unreadable | Can't read | "Part of this job can't be read on this phone, so it can't be sent." | More |

- A card that can't be read (unreadable or newer) is titled "A job kept on this phone", the next "A job kept on this phone (2)", and so on, so each card and its **More** have names of their own.
- **Safari tab, waiting more than 5 days** (`safariMayClear`: Safari, not the Home Screen app, not inside another app): the card gets `alert-banner warning` "Safari may clear jobs kept here if your blog isn't opened for a week. Send it, or save its photos to this phone." with **Send now** (the card's own moves into it) and **Save the photos**.
- A card's **Send now** sends that job only; Home's **Send now**, the palette and the account menu send them all.

- **More** ("More for Roof repair in Elkins"): **Save the photos to this phone** (phones: `navigator.share({files})`; computers: one download per photo, `roof-repair-elkins-1.jpg`; refused: "Your phone didn't let them be saved. Try again from the Photos button."), **Throw it away…**.
- **Throw it away** (`modal-dialog`): "Throw away Roof repair in Elkins?" / "Its 4 photos, voice note and words are only on this phone, so they'll be gone for good." **Save the photos first** / **Keep it** (focused) / **Throw it away** (destructive) → `queue.discard` → "Thrown away." No Undo. Disabled while that job sends.
- **None waiting:** section hidden. In the iPhone app: "Saved a job in Safari instead? It's waiting there: open your blog in Safari to send it."
- **Can't keep anything** (`openIndexedStore` → null): `alert-banner warning` "This window can't keep jobs for later" / "Jobs send straight away instead, so save one where there's a signal. In a normal Safari window your blog can keep them." Failed direct send: "It didn't send, and it's still here. Try again when there's a signal."
- **Inside another app:** `alert-banner warning` "This page is open inside another app, which may not keep your jobs. Open your blog in Safari." + **Copy the address**.
- **iPhone Safari tab with something waiting:** "Add your blog to your Home Screen so jobs waiting here are kept safe." (link: R3 sheet).

## Sending

**One sender per window** (`parts/job-sender.js`), started by the shell:
- **Starts when** any Studio screen opens and the store exists (`indexedDB.databases()` lists `openblog-capture`; without `databases()`, only on trade sites or New job). Never creates an empty store on Grammi's phone.
- **Tries:** after a save; on `online`; on `visibilitychange` visible (either of these arriving while a try is failing gets one more pass at once); on **Send now** / **Try again**; while New job or Home is visible after a retryable try: 30 s, 1 min, 2 min, then every 5 min.
- **Order:** oldest first; stops at the first retryable failure or 401; a refused one is marked and the next goes. Background tries use `retry: false` so a 401 marks "Needs you" without popping the sign-in dialog. **Send now** uses the normal dialog.
- **One at a time across windows:** Web Lock `openblog-capture:<id>` (`ifAvailable`); `BroadcastChannel("openblog-capture")` carries "changed" (read the list again), "sending <id>" (at the start and at each step) and "done <id>". Other windows show that card as **Sending** ("Sending in another window…") with no **Send now** and no **Throw it away**, until "done", the sender's lock lets go (its window closed), or, without locks, 2 minutes pass with no word. Without locks the server's idempotency keeps it to one draft.
- **Per record** (`sendCapture`, ported): `GET capture?id=` (G29) first, skipping photos the server has; each photo `POST upload?name&capture&slot`; voice `POST capture-audio?capture=`; `POST document {kind: "posts", captureId, fields: captureFields, body: captureBody}` (honours an old record's `fields.draft`). Each request has a time limit (`api.call` gains `signal`; `AbortSignal.timeout(max(60 s, bytes / 25 KB/s))`); running out counts as no signal.
- **Removed only after** `document` answers with a `path` (201, or 200 `duplicate`). With skipped photos it stays as `sent: {path, skipped}` until **Done**.

| Answer | Treated as | Her words |
| --- | --- | --- |
| 201 / 200 `duplicate` live | sent | toast "Sent. Roof repair in Elkins is a draft on your blog." **Finish it** → `#/write/<path>`; a duplicate from another window is quiet |
| 200 `duplicate`, `removed` | needs her | "deleted since" row |
| status 0, timeout, 5xx, 408, 429, 409 `busy` after retries | waiting | "No signal…" (5xx: "Your blog didn't answer when it last tried, at …") |
| 401 | sign-in | "Sign in again to send it." |
| photo 415 / 413 | skip that photo | named in the Sent row |
| voice 415 / 413 | skip it | "…but the voice note couldn't be kept." |
| `document` 422/400/409 (not `busy`) | refused | `capture-id` "This job's label got damaged on this phone (`deviceNoun`), so it can't be sent. Save its photos, then throw it away."; `ledger-version` "Your blog was updated in a way this page doesn't understand yet. Reload, then try again."; other "Your blog said no to this job. Tell the person who set up your site." |
| 403 / CSRF | refused, reload session | "Sign in again to send it." |

**Status line (New job and Home):** "Sending 1 of 2 jobs…", then "Sent." or "1 job is still waiting for a signal."

## Old Admin and Studio together, and the hand-off

Nothing has to move. Studio reads and writes the **same** IndexedDB under the same rules:
- **Same database, version, format, forever:** `openblog-capture`, version **1**, store `captures`, key `id`, record `v: 1`. Never bump the version, never delete the database or clear the store; close on `versionchange`. Remove a record only after a successful send or **Throw it away**. A record it can't read is left byte for byte.
- **Additive keys only:** `by`, `sent`. The old Admin ignores them (and may drop them on rewrite — harmless).
- **Old captures** appear in Studio's list as soon as any Studio screen opens; the Home card says so and the sender sends them. That is the whole migration.
- **Both open on one phone and browser:** the server makes one draft (`captureId` ledger) and writes each photo once. Studio refreshes on focus. A job thrown away in Studio while the old tab sends it may come back once; nothing is lost.
- **Different browsers / iPhone app vs Safari:** separate storage; covered by the empty-list line and details.
- **After release:** old `#/capture` goes to Studio (G28). R15 removes the old Admin; the database name stays.

## Home and elsewhere

- **Home** (any site, only when the store holds anything): `content-card` "2 jobs waiting on this phone" / sender's words / **Send now** (with a signal) and **See them** (`#/new-job`, focus to "Waiting on this phone"). With anything "Needs you"/"Didn't send": badge "Needs you", "1 needs you: sign in again to send it."
- **Posts:** job posts carry `status-badge` "Job" (from `profile`, G15).
- **Account menu / palette:** "New job", "Send waiting jobs now".

## Write: a job post

A post is a job when `fields.profile === "job"`; everything here shows only for jobs.

**New from Write** (`#/write/new/job`): `profile: job`, Started and Finished today (`localDay`), trade = `siteTrade`, body = `meta.job.scaffold`. Status "New job. Add a title and your draft will save itself."

**About this job** (`fieldset` in `numbersHost`, under the title):

```
| About this job                           |  legend
| Service       [Roof repair         v]    |  select-field: Services + Something else
| Town [Elkins          ] State [WV    ]   |  text-field x2
|  Elkins  Beverly  Davis                  |  recent towns
| Started [Nov 12, 2026] Finished [Nov 13] |  date-field x2
| Price shown  [Don't show a price    v]   |  select-field, COST_BAND_LABELS
| Customer review [No review          v]   |  select-field (meta.job.reviews)
| Trade [Roofing v]  (only if > 1 trade or none set)
| Your voice note from the site            |  only with a kept note (G30)
| [> 1:12 ...........]  Turn it into words |
```

- **Help:** Town "Just the town, never the street." Price "A rough range customers see. It's never a quote." Review "Shown beside this job." (none: "Save a customer's review under Reviews, then choose it here.") Something else "Add it under Services before you publish, so customers can find it."
- **Writes** `applyJobDraft` keys exactly (`job.trade`, `job.service`, `job.place.town`, `job.place.region`, `job.started`, `job.finished`, `job.costBand`, `job.review`, `job.media.before|after`); `durationHours`, `materials` kept as written.
- **Before and after:** each photo in a job's strip gets `segmented-control` "Photo 2 shows": **Before** · **After** · **Neither**, writing `job.media.before/after` in body order. Help: "Mark at least one After photo. It's the one people see when you share the job."
- **Four parts:** when the body is exactly the scaffold's four `## ` headings, Words becomes four boxes labelled with them ("Problem", "What we found", "What we did", "Result"), written back byte for byte (`parts/job-body.js`). Any other shape stays one box.
- **Turn it into words** (G30): same sheet and words; appended to "Problem" (or Words), with Undo.
- **Write it up for me** (More and palette, job posts, `GET assistant/status` `configured`): `side-sheet` "Write it up for me" / "Your words in this job (about 240), its service and town go to Anthropic. It writes a title, a one-line summary and the four parts from what you said, and nothing more. Your photos and voice note don't go." `toggle-switch` "Make it sound like me" (when a voice guide exists), **Write it up**, **Not now**. `POST assistant/job-draft {notes, photoAlts, trade, service, town, contextIds}`. Fills title (only when empty or still "… in Elkins"/"Job notes…"), description, four parts. "Written up. Read it through, then save." Toast **Undo**. Too long: "That's more words than it can take. Shorten them a little." 429: "Your blog's helper is busy. Try again in a minute." Unusable: "It didn't send back anything usable. Your words are as they were."
- **Publish a job:** first `POST job/check {fields}` (G32). With problems it doesn't publish: `alert-banner warning` "Before this job goes on your site (2)" lists each with **Go to it** (focus field, `aria-describedby`). **Save draft** always works.

| Problem | Words |
| --- | --- |
| `job.trade` | "Choose your trade." |
| `job.service` missing | "Choose the service this job was." |
| `unknown-service` | "“Gutter guards” isn't one of your services yet. Choose one, or add it under Services first." |
| `job.place.town` missing / address-like | "Add the town." / "Just the town's name, not a street address or zip code." |
| `job.place.region` missing / other | "Add the state." / "Just the state's name or its two letters." |
| dates | "Add the day you started." / "Add the day you finished." / "Finished can't be before Started." |
| `job.costBand` | "Choose a price range from the list." |
| `job.media.*` | "A photo marked Before or After isn't on your site any more. Mark another." |
| `job.review` | "That review isn't saved any more. Choose another." |
| other | "Something about this job needs fixing. Tell the person who set up your site." (server sentence in details) |

After Publish, R1's "Share this job" link is unchanged.

## Not a trade site (Grammi)

- She sees nothing new: no New job, no Home button or card (no store is created on her phone), no "A job" card, no palette entries, no About this job.
- **Old link, non-trade, nothing waiting:** `empty-state` "Your blog isn't set up for jobs" / "This is for posting work from a job site, like a new roof. To write a recipe or a story, start here." **Write something new**. Details: "New job appears when `meta.siteUses.trade` is true."
- **Something waiting on a non-trade site:** the list always shows and sends.

## What Dana sees and what Mikey sees

| | Dana | Mikey |
| --- | --- | --- |
| A waiting job | title, photo count, voice note, when saved, state | id, `v`, `createdAt`, `by`, `attempts`, `lastError`, bytes vs `maxCaptureBytes`, last HTTP status and `code`; **Copy details** copies id, `v`, `createdAt`, `by`, `attempts`, `lastError`, the last HTTP status/code and the step log of its last try in this window, as text (`detailsText`); a card's Details stay open as the list redraws |
| This phone | "this iPhone" | DB `openblog-capture` v1 / `captures`; count and bytes vs `maxQueued` 5 / `maxQueueBytes` 120 MB; `storage.persist()`; `storage.estimate()`; Web Locks / BroadcastChannel; standalone or tab; "Safari may clear site data after 7 days without a visit; the Home Screen app is exempt; Safari and the Home Screen app don't share storage" |
| Sending | words | per-step log of each job's last try in this window (`sendCapture` `onLog`: what the server had, each photo sent/skipped/already there, the voice note, the document reply incl. `duplicate`, or where it stopped and the answer) |
| Sent from this phone | "Sent this visit" | the last 20 sends, from `localStorage` `studio-sent-jobs` (`parts/sent-log.js`): `{captureId, path, sentAt, skipped, duplicate, by}`, `by` being who saved it; Details only, never her layer |
| Voice to words | where it goes | engine, destination, model, `OPENBLOG_TRANSCRIBE_COMMAND`, transcript in `.openblog/captures/` |
| Old Admin | nothing | "Old Admin windows opened before this update use the same list; sending from both makes one draft (ADR 0297)." |
| Releases | nothing | the worker's (asked by message), the page's (`/admin/studio/release.js`, written by the server) and the server's (first line of `/admin/sw.js`) side by side, read again each time Details opens; a `status-badge` "Releases differ" when the known ones differ; **Clear saved pages** (deletes only `studio-*` caches and reloads; never unregisters the worker, never touches IndexedDB; disabled with no signal) |
| Job check | her words | raw problem sentences |
| Limits | "too big", "5 jobs" | every `meta.capture` value |

## Rules each part uses (static imports, DOM-free, tested)

| Part | From | Functions |
| --- | --- | --- |
| Waiting list | `parts/capture-queue.js` (moved whole; `DB_NAME`, `STORE_NAME`, `RECORD_VERSION`, `DB_VERSION` unchanged) | `makeRecord` (+`by`), `readRecord`, `roomProblem` (codes), `isRetryable` (+ status 0), `createCaptureQueue`, `openIndexedStore` (+`versionchange` close) |
| Sending | new `parts/job-sender.js` | `sendCapture` (+ G29 skip, `signal`), `retryDelay`, `entryState(entry, user)`, `sendOutcome(error, step)` |
| Recording | `parts/capture-recorder.js` (moved whole) | `createRecorder`, `recorderSupport`, `audioLimits`, `clock` |
| Shrinking | new `parts/photo-shrink.js` (DOM-free planner + thin canvas adapter) | `shrinkPlan(width, height, max=2000)`, `shrinkPhoto(file)` (falls back to the original on decode failure, HEIC included) |
| New job | new `parts/new-job-rules.js` | `newCaptureId`, `captureLimits`, `readPrefs`/`rememberPicks`/`writePrefs`, `captureTitle`, `captureSlug`, `captureFields`, `captureBody`, `captureProblem`, `photoProblem`, `photoBytesLines`, `isPermanentPhotoError`, `photosToRemove`, `safariMayClear` |
| Words | new `parts/job-words.js` | `ROOM_WORDS`, `PHOTO_WORDS`, `RECORD_WORDS`, `micSteps`, `cameraHelp`, `waitingWords`, `transcribeDisclosure`, `jobProblemWords` |
| Voice/write-up | `parts/capture-assistant-rules.js` | `plainNotes`, `appendTranscript`, `normalizeDraft`, `draftBody`, `SECTION_KEYS` |
| Job fields | `parts/job-rules.js` | `readJobDraft`, `applyJobDraft`, `bodyTakesScaffold`, `localDay`, `dayValue`, `tradeLabel`, `jobBoxes`/`joinJobBoxes` |
| In progress | new `parts/job-in-progress.js` | store `studio-new-job` v1: `keep`, `get`, `clear` |
| Offline | `web/studio/sw.js` (G35) | versioned static cache, installed all or nothing (one file that fails fails the install; the old copy is deleted only once the new one is whole), network-first for 3 s then the kept copy (kept copies at once for 30 s after such a wait; the server's answer still refreshes them), never `/admin/api/` |

- **Port:** `admin-capture-queue` → `studio-capture-queue` (+ a fixture record written by the old module, read and sent by Studio); `admin-capture-recorder` → `studio-capture-recorder`; `admin-job-capture` → `studio-new-job-rules`; `admin-capture-assistant` → `studio-capture-assistant-rules`; `admin-job-form` → `studio-job-rules`; browser `capture.spec.mjs` → `studio-new-job.spec.mjs`, `job-mode.spec.mjs` → `studio-write-job.spec.mjs`.
- **New:** two windows sending one record make one draft; old and new open together lose nothing; `versionchange` closes; an offline save sends on `online`; a background 401 shows Needs you with no dialog; `duplicate`+`removed` → Send it again with a new id; reload mid-job restores; Grammi's site creates no database; the worker never caches an API reply; New job opens offline after one visit; a release whose install loses a file never takes over (the previous one still opens offline); a server that takes 15 s still opens New job from the kept copy in a few seconds.

## Accessibility

- **Keyboard order:** heading, lede, status, waiting link, thumbnails (×), Take a photo, Choose photos, voice controls, words, summary/Change, camera help, waiting cards (heading, primary, More), Sent, details, sticky **Save this job**. No traps.
- **Recording:** the button's name follows its state; live region "Recording" once, "30 seconds left" once, "Stopped. Your voice note is 1:12 long."; the ticking timer is `aria-live="off"`.
- **Sending:** progress to the live region at each step, at most every 2 s.
- **Errors:** `role="alert"` on the form, linked by `aria-describedby`; focus to the first control that fixes them.
- **Full names:** "Send Roof repair in Elkins now", "More for Roof repair in Elkins", "Remove photo 2", "Use Elkins".
- **320 px:** one column; the sticky bar never covers the focused field (`scroll-padding-bottom`); controls ≥ 44 px; no motion; recording dot static under reduced motion.
- **Zubra:** `breadcrumb-trail`, `action-button`, `file-drop`, `auto-grid`, `text-field`, `select-field`, `date-field`, `segmented-control`, `toggle-switch`, `content-card`, `status-badge`, `alert-banner`, `empty-state`, `dropdown-menu`, `side-sheet`, `modal-dialog`, `toast-region`, `skeleton-block`. Native `<audio controls>` and `fieldset` styled by tokens (Zubra has no audio player). **Zubra change:** `file-drop` gains a `capture` attribute and a `button` look with no drop zone on coarse pointers; fix in zubra-ui and re-vendor.

## Safety

- Photos are shrunk with location dropped on the phone (Decided 2), and the server still strips location (`photo::fit_for_web`); Share this job's `photo-location` check still applies. The town field refuses addresses.
- The voice note never enters the post or site files (`.openblog/captures/`). Nothing goes to a provider before she presses the button in a sheet naming where it goes. Transcripts and write-ups pass `plainNotes`/`normalizeDraft` and are shown as `textContent`.
- Titles, file names, server sentences and `by` are `textContent`. `lastError` clipped to 200 chars, never a path or credential.
- `navigator.share` goes only where she picks. Nothing is sent automatically except to her own blog.
- Studio never deletes a record it can't read, or one newer than it.
- The worker cache holds only Studio's own static files (never API replies, never session data); a new release replaces it.

## Gaps

- **G28. Bridge in the old Admin until R15:** `#/capture` → `location.replace("/admin/studio/#/new-job")`; its Capture tab links there.
- **G29. What the server already has:** `GET capture?id=<id>` → `{photos: [{slot, url}], audio: bool, draft: {path, status} | null}` (auth, same locks). Studio skips sent photos; with a `draft`, skips to `document`.
- **G30. Voice note in Write:** `document` GET gains `capture: {id, audio, transcript}` when a ledger points at the path (reverse index `path → id` in `.openblog/captures/`). Add `GET capture-audio?capture=<id>` (auth, `no-store`, sniffed type).
- **G31. Codes on capture errors:** `upload` (`heic`, `not-image`, `too-large`, `capture-slot`), `capture-audio` (`capture-id`, `not-audio`, `too-large`), `document` with `captureId` (`capture-id`, `ledger-version`), `assistant/transcribe` (`no-note`, plus existing), `assistant/job-draft` (`no-notes`, `notes-too-long`, `bad-photo-alt`).
- **G32. `job/check` that matches the build:** `{ok, problems: [{field, code, message}]}` (keep `messages` strings one release), including the known-service check (`model.rs:1077`, `unknown-service`).
- **G33. `meta.job`:** `services: [{id, title}]`, `siteTrade`, `siteRegion`.
- **G34. App icon shortcut:** G20's manifest gains `shortcuts: [{name: "New job", url: "/admin/studio/#/new-job", icons}]` when `siteUses.trade`.
- **G35. Opens with no signal (Decided 1):** worker caches Studio's static files (versioned, all or nothing, network-first with a 3 s limit, never API replies); last `meta` and user kept in `localStorage`.
- **Not gaps:** idempotent photos/audio/document (ADR 0297); location stripping; mic and camera help; private-mode fallback.

## Risks to test on real phones before release

- An iPhone with 2 captures from the old Admin (Home Screen app): after the update Home shows "2 jobs waiting on this phone" and both send. Same for Safari separately.
- iOS reloading after Take a photo: form restored with every photo.
- A big job over throttled 3G: timeouts become "No signal", G29 skips sent photos, one draft.
- Old Admin tab and Studio together, airplane mode on then off: one draft, no lost record.
- Mic denied then allowed in Settings (iOS 17, 18); a phone call while recording.
- Android Chrome with Camera blocked: **Choose photos** works and the help shows.
- A 401 after a sleeping host restarts: Needs you, Sign in, then it sends.
- New job opened once, then airplane mode and a reload: it opens and keeps a job.

## Docs and release note

- Rewrite `docs/jobs.md` §"Capturing a job from a phone" and §Job form in Studio's words; point `docs/admin.md` §"Transcribing a voice note" at Write and New job; amend ADR 0304 (Decided 3) and add to ADR 0297: "the store's name and version are permanent"; note in ADR 0412/R3 docs that the worker now caches Studio's static files.
- Release note (Mikey): Capture is now **New job**, and Studio sends waiting jobs from any screen. Captures from the old Admin are on the same list. The iPhone app and Safari keep separate lists. Job checks run on Publish. Photos are made smaller on the phone before sending. New job opens with no signal after one visit.

## Changes to `studio-ux` (adopted)

- Banned on her layer, next to "deploy": upload, sync, offline, queue, storage, capture. She hears "saved on this phone", "waiting for a signal", "sent".
- **Nothing is lost** gains: "Anything kept only on this phone says so where she sees it (Home), is never thrown away without asking, and offers a way to save its photos out first."
- "Waiting for a signal" is a state with words and a badge, never an error. Errors are for things she can change.
- Review checklist: "Works with no signal: what she made is kept, and the screen says when it will go."
