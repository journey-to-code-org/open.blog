# Studio UX, slice 10a: Business, Services and Reviews

By `studio-ux`, 2026-11-13, from `studio-ux`, `admin/business.rs`, `web/admin/business.js`, `web/admin/services.js`, `web/admin/proof.js`, `doc-kinds.js`, `documents.js`, `page-edit.js` and `siteUses` in `admin.rs`. The owner here is **Dana**, a roofer: on a roof all day, answers the phone from the truck, wants the right number on Google. Mikey set the site up. Three nav items for a trade site: **Services**, **Reviews**, **Business**. The old Admin keeps service areas, jobs, quotes and reminders.

## When they show (decided)

`siteUses.business` is false until a fact is set, and `siteUses.services` until a service exists, so neither can be the door. A **trade site** is `su.business || su.services || su.reviews || su.reminders` (`reviews` is already true once a trade is named, a job is posted or a review exists; `reminders` once a trade is named or reminders are on).

| Screen | `when(meta)` | Also always |
| --- | --- | --- |
| **Business** | trade site | More tools ("Business facts", now a Studio link, not the old Admin) and Find: "Business facts" |
| **Services** | `su.services \|\| su.reviews` | More tools and Find: "Add a service" |
| **Reviews** | `su.reviews \|\| su.services` | More tools and Find: "Add a review" |

So a fresh site (Grammi's) never sees them; Mikey starts a trade site by naming the trade in Business facts (from More tools or Find), and the three appear at once. Nav order after Front page: Services, Reviews, Business. Gap G1 moves the rule to the server.

## Business

- **Job (her words):** "What should customers know to call me?" **Primary action:** **Save**, in the sticky bar.
- **Nav:** "Business". **Title:** "Business facts". **Question (h2, Literata):** "What should customers know about you?" **Route:** `#/business`. Back: nav.
- **Loads:** `GET business` (`business`, `etag`, `problems`, `trades`). Imports `WEEKDAYS`, `PAYMENT_METHODS`, `DAY_MODES`, `formFromBusiness`, `businessFromForm`, `sameBusiness`, `validateForm`, `copyDay`, `normalizePhone`, `formatPhone`, `businessErrorText` from `/admin/business.js`. Studio draws its own fields; it never mounts `createBusinessFacts`.
- **Lede (p ink-soft):** "Say it once here. Your name, phone and hours go at the bottom of every page and on your front page, and Google and other search engines use them, so people looking for a roofer find the right number. Everything here is public."

### 400 px

```
+--------------------------------------+
| [Menu] Business      [Find] [Dana v] |  dashboard-shell
| What should customers know about you?|  h2
| Say it once here. ...                |  p ink-soft (lede)
| Who you are                          |  h3 (fieldset legend)
| Name customers know you by [       ] |  text-field
| Your trade         [Roofing      v]  |  select-field (trades, "Choose your trade")
| Year you started   [1998]            |  text-field inputmode=numeric
| How to reach you                     |  h3
| Phone   [(304) 555-0142        ]     |  text-field type=tel
| Email   [dana@example.com      ]     |  text-field type=email
| Opening hours                        |  h3
| [Copy Monday to Tuesday-Friday]      |  action-button secondary
| Monday   [Open            v]         |  select-field (DAY_MODES)
|   Opens [ 7:00 AM ] Closes [ 5:00 PM]|  text-field type=time x2 (only when Open)
| Tuesday  [Not shown       v]  ...    |  x7
| License and insurance                |  h3
| License number   [WV061234   ]       |  text-field
| Who issued it    [WV Contractor..]   |  text-field
| (o) We're insured                    |  toggle-switch
| Ways customers can pay               |  h3
| (o) Cash  (o) Check  ( ) Credit card |  toggle-switch x7 (PAYMENT_METHODS), see G4
| > More about your business           |  details: Legal name
| > For the person who set up your site|  details
|======================================|
| You have changes.          [ Save ]  |  sticky bar, action-button primary
+--------------------------------------+
```

Desktop (1280 px): the form is one column at 46rem; hours become a `data-table`-like grid (day, mode, opens, closes) on one row each; payment toggles in two columns. A right column at 70rem shows **How it looks** (see below). 320 px: day mode and times stack.

### Fields and words

| Field | Label | Help (one line, only where needed) |
| --- | --- | --- |
| `displayName` | Name customers know you by | "Shown at the bottom of every page and in search results." |
| `trade` | Your trade | "Search engines use it to describe you, like a roofing contractor." Options: `trades` with hyphens as spaces. |
| `foundedYear` | Year you started | none (placeholder "1998") |
| `phone` | Phone | "Type it the way you'd say it." On blur, show `formatPhone(normalizePhone(v))`. Never show +1… on the first layer. |
| `email` | Email | none |
| hours | Opening hours / per day: Monday … | group help "Leave a day as Not shown if you'd rather not say." Modes: `DAY_MODES` labels (Not shown, Open, Open 24 hours, Closed). |
| `licenseNumber` | License number | none |
| `licenseIssuer` | Who issued it | "Like your state's contractor licensing board." |
| `insured` | We're insured | "With a license number, your site shows a Licensed and insured badge. It's your word; nobody checks it." |
| `paymentMethods` | Ways customers can pay | none |
| `legalName` | Legal name (under More about your business) | "Only if it's different, like Ridgeline Roofing LLC." |

- **Copy Monday:** `copyDay(form, "monday", [tue..fri])`; status "Monday's hours are on Tuesday to Friday now. Save to keep them." Disabled with Monday on Not shown.
- **How it looks (desktop column; at 400 px a `details` "How it looks" above the bar):** a plain mock of the footer line built with `textContent`: "Ridgeline Roofing . (304) 555-0142 . Open Monday to Friday, 7 AM to 5 PM . Licensed and insured". Updates as she types. Not a preview iframe.
- **Save:** `validateForm` first; each problem on its field (`text-field error`; an hours problem on that day's mode field), focus the first, status "2 things need fixing before this can be saved." Then `PUT business {etag, business: businessFromForm(form)}`, then `sendOut(api, "Change the business facts")` and `wentOutWords(…, {action: "saved"})`, e.g. "Saved. Your readers will see it in about a minute." The form takes the stored values back (phone in her format) only when nothing changed during the save.
- **Nothing is lost:** `leave()` with `!sameBusiness(form, saved)` asks "Save your business facts?" / "You changed them and didn't save." / **Save** (focused), **Leave without saving**. Sticky bar says "You have changes." or "Everything's saved."
- **Stored problems** (GET `problems` non-empty): `alert-banner warning` "Something here needs fixing" / "Your site is using the facts as they were. Fix the marked line, then Save." Problems on their fields.

### Errors (Business)

| What | Words |
| --- | --- |
| 422 `problems` | On each field, Studio's own line for that field from `validateForm`'s wording; `trade`: "Choose your trade from the list."; a problem with no field: in the banner. Server text only in details. |
| 409 | `askWhichToKeep({ name: "Your business facts", what: "changes" })`: Keep mine re-sends with the 409 body's `etag`; Use theirs fills the form from its `business`. Status "Here are the facts from the other device." |
| 200 with `buildError` | `alert-banner warning` "Saved, but your site didn't update yet" / "Something elsewhere on your site needs fixing first. Tell the person who set up your site." (error in details) |
| 413 / 401 / none | `businessErrorText` words for 413; 401 the shell's sign-in, form kept; no connection "Studio couldn't reach your site's server. Your changes are still here." |

**Details:** stored `business` JSON, `etag`, phone as stored (E.164), trade id, `buildError`, server problem text, link "Business facts in the old Admin". **Palette:** Go to Business facts, Save business facts, Copy Monday to weekdays.

## Services and Reviews: one list, one editor (decided: reuse KINDS)

Both are documents like Pages: `GET documents?kind=…`, `GET/PUT/DELETE document?path=`, `POST document {kind}`. Add `services` and `proof` entries to `KINDS` and teach the two screens three optional hooks; nothing else forks:

- **`k.model`**: the pure functions from `/admin/services.js` or `/admin/proof.js` (`blankService`/`blankReview`, `formFromDocument`, `fieldsFromForm`, `validateForm`, `problemsFromServer`, `serviceErrorText`/`reviewErrorText`, plus `slugId`/`reviewId`). When present, `page-edit.js` swaps its name/description/menu/look column for a `field-form.js` form from **`k.fields`** (spec shape it already reads: text, select, date, toggle, list, group) and saves `fieldsFromForm(form)` whole with `etag` and `kind` (not `onlyChanges`: the FAQ keys are flattened and must be rewritten as a set).
- **`k.row(item)`**: the list line under the title (Reviews: stars, platform, day). **`k.sort`**: `"title"` (default) or `"server"` (Reviews: newest first as listed).
- Kept from page-edit as is: breadcrumb, status line, banner, More, details sheet, `leave()`, `askWhichToKeep` on 409, `sendOut` + `wentOutWords`, delete with Undo. Errors on fields come from `problemsFromServer`; anything unplaced goes in the "Not saved" banner, her words kept.
- **Ids never on the first layer.** New: id = `slugId(name)` / `reviewId(author, date)` at first save; Mikey can change it before then in the details sheet ("Address ends in" / "Review id"). A 409 on create: name field "You already have a service called that. Change the name a little." / review: "This review is already saved." with **Open it**.

### Services (`#/services`, `#/service/<path>`, `#/service/new`)

- **Job:** "What work do I do, and what does each job include?" **Primary:** **Add a service** (list), **Save** (editor).
- **KINDS words:** heading "Your services"; lede "1 service on your site" / "4 services on your site"; about "Each service gets its own page, with what's included and the questions people ask. A job can say which service it was."; add "Add a service"; empty-state "No services yet" / "Start with the work you're asked for most, like a roof repair." / **Add a service**; newTitle "New service". Draft row: `status-badge` "Off your site".

```
400 px, editor                          | Desktop: fields left (46rem), page words right
+--------------------------------------+
| Home > Services > Roof repair [More] |  breadcrumb-trail, dropdown-menu
| Changes you make go on your site ... |  status
| Name  [Roof repair               ]   |  text-field
| In one sentence [We find the leak..] |  text-field rows=3 (summary)
| What's included                      |  list of text-field, "Add an item"
|  [Finding the leak     ] [..]        |  per row dropdown-menu: Move up, Move down, Remove
| Starting price [$500 to $2,000  v]   |  select-field: "Don't show a price" + PRICE_BAND_CHOICES
| How long it usually takes [1 day  ]  |  text-field
| Questions people ask                 |  list of group (Question, Answer rows=3), "Add a question"
| More about it, in your words         |  body-host (services body)
|======================================|
| [See how it looks]          [ Save ] |  sticky bar
+--------------------------------------+
```

- **Help lines:** included "One short line each, like Tear-off of old shingles."; price "A guide, never a quote. Shown in words."; questions "Each one shows on the service's page; search engines read them too."; body "Optional. Anything else a customer should know."
- **Validation words:** `validateForm` (name, summary, includes, price, FAQ), placed by `field`/`index`/`part`; the `id` problems never show on the first layer (Studio fills the id; if one remains, it goes to the details sheet field and the banner says "Open details to fix the address.").
- **More:** Keep it off your site for now / Put it on your site (`draft`; status "Off your site. It's kept here." / "On your site."), Delete this service (Undo; note "Jobs that name it keep their words."), Show details, Open in the old Admin.
- **Preview:** **See how it looks** uses `showPreview` (`services` is supported). **Details:** file, id, address, `typicalTimeline`, kept extra keys, server problem text.

### Reviews (`#/reviews`, `#/review/<path>`, `#/review/new`)

- **Job:** "What have customers said about my work?" **Primary:** **Add a review** (list), **Save** (editor).
- **KINDS words:** heading "Your reviews"; lede "12 reviews from customers"; about "Save real reviews customers left you, with the link to where they left them. They go on your Reviews page, and beside the job they're about."; add "Add a review"; empty-state "No reviews yet" / "Paste the link to a review a customer left you on Google or Facebook, and Studio copies it in." / **Add a review**; newTitle "New review".
- **Row (`k.row`):** title = author ("Pat M."); line "★★★★★ 5 stars . Google . October 20, 2026" (stars `aria-hidden`, words read); "Off your site" badge for drafts. Every value set with `textContent`.

```
400 px, new review
+--------------------------------------+
| Home > Reviews > New review   [More] |
| Copy it from its link                |  h3
| Link to the review [https://g.page..]|  text-field type=url
| [ Copy the review ]                  |  action-button secondary (busy while fetching)
| What the page said  (after a copy)   |  text-field rows=8 readonly, textContent only
| Reviewer's name  [Pat M.          ]  |  text-field
| Day it was written [2026-10-20]      |  date-field
| Where it was left [Google        v]  |  select-field (PLATFORMS)
| Link to the review [https://...   ]  |  text-field type=url (readonly after a copy)
| Stars            [5 stars        v]  |  select-field: No stars, 5 stars ... 1 star
| The review       [               ]   |  text-field rows=8 (the body)
| Copied from Google on November 13.   |  p ink-soft (provenance)
|======================================|
| Only save what a customer wrote.[Save]|  sticky bar
+--------------------------------------+
```

- **Copy the review (cheap, decided: in):** `POST assistant/context/url/retrieve` with `snapshotRequest(link)`; refuse with `snapshotProblem` before changing the form; else `formFromSnapshot`, show "What the page said" and focus Reviewer's name. Status "Copied. Check each line against the page, then Save." Errors: `snapshotErrorText` words, each ending "You can type the review in instead." Help under the link: "Studio reads the page once, now, and never again. Pages that need a sign-in usually can't be copied." Name, day and stars are never guessed. On an existing review the copy section is hidden: a new copy is a new review.
- **Help lines:** name "As it shows on the review. Customers see it on your site."; link "Your site links to it, so anyone can check."; stars "Only what the reviewer gave."; review "Their own words, as they wrote them." Provenance: entered "Typed in by you. Your site says so."; snapshot "Copied from Google on November 13, 2026. Your site says so." **Paste a different link** (quiet button) under a read-only link clears the copy.
- **Strangers' text:** the page copy and the review's words are only ever `value`/`textContent`; never `innerHTML`, never rendered as Markdown in Studio, never sent to the assistant.
- **More:** Keep it off your site for now / Put it on your site, Delete this review (Undo; note "If a job shows it, that job will need another review."), Show details, Open in the old Admin. No **See how it looks** (G3); after save, status adds **See your Reviews page**.
- **Delete with a job still showing it:** if the rebuild fails (`deleteBuildText`), banner "Deleted, but a job still shows this review" / "Open that job and choose another review, or Undo." with **Undo**.
- **Details:** file, `id`, `provenance`, `retrievedAt` (UTC ISO), snapshot `canonicalUrl`, kept extra keys, server problem text.

### Empty, loading, errors (both lists)

- **Loading:** `skeleton-block lines=4`, `aria-busy`. **Empty:** the KINDS empty-state above. **List error:** `alert-banner danger` "Your services didn't load" / "Your reviews didn't load", "Check your connection and try again.", **Try again**. **Broken file:** row line "Something's wrong with this service. Ask the person who set up your site." (path and error in details).
- **Editor errors:** 401 the shell's sign-in, words kept; 404 "That review isn't there any more." with **Back to your reviews**; 413 `serviceErrorText`/`reviewErrorText` words; 409 on an existing file `askWhichToKeep`.

### Layers and palette

- **First layer:** each list and Add; every field above; Copy the review; Save; See how it looks (services).
- **More:** off-site/on-site, Delete, Show details, Open in the old Admin. Rare or reversible.
- **Details** ("For the person who set up your site", `studio-mono`): files, ids, addresses, E.164 phone, `etag`, raw problems, provenance and times.
- **Palette:** Go to Services / Reviews / Business facts; Add a service; Add a review; Open <each service>; Open <each reviewer>'s review; on editors Save and See how it looks.

## Accessibility notes

- Each weekday is a `fieldset` named by its day; the time fields are named "Monday opens" / "Monday closes" and hidden (not just disabled) unless Open.
- Field errors linked with `aria-describedby`; focus the first; statuses in the live region. Stars are words; ★ is decoration.
- Sticky bars never cover a focused field (scroll-padding = bar height); 320 px reflows to one column.

## Gaps

- **G1.** Studio re-derives "trade site" from four flags. Add `siteUses.trade` in `admin.rs` (`business.trade` set, any service, review or job post, or reminders on) and use it for all three `when`s.
- **G2.** Business 422 messages are engine text ("phone must be …"). Return the field and a stable `code` so Studio can show its own line without matching words.
- **G3.** Preview has no `proof` target; a Reviews page preview would let Dana see the stars before saving.
- **G4.** Zubra UI has no checkbox group; seven `toggle-switch`es for payments are heavy. Add `check-group` to zubra-ui and re-vendor.
- **G5.** No `time-field` in zubra-ui; `text-field type=time` relies on the browser's picker (12/24 h follows the device).
- **G6.** `field-form.js` lists need Move up/down/Remove as a per-row `dropdown-menu`; confirm the `list` kind has it, or add it there once for both kinds.

## As built

- **G1 done:** `meta.siteUses.trade` is computed on the server. Services and Reviews show only on a trade site. Business is in the nav on a trade site (`navWhen`), and its address works on any site, so More tools (as a Studio link) and Find can start one.
- Services and Reviews use `documents.js` (with `row` and `sort` hooks) and one editor, `record-edit.js`, built on `field-form.js` and the old Admin's models. The editor doesn't fork `page-edit.js`.
- Problems are listed in a banner that names each field, rather than shown on each field (field-form has no per-field error yet).
- Payment methods are toggle switches (G4). Hours use `text-field type=time` (G5).
