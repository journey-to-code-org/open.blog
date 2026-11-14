# Studio UX, retirement slice R7: Before you publish

By `studio-ux`, 2026-11-13. Sources: `studio-ux`, `studio-architecture`, `retirement-plan.md` (§1 B "GPX track upload", "Pane: Social", "Optimize", "Accessibility", "Release kit", "Field review", "Publication review"; §4 R7; Decided 4), `r4/ux.md` (job check, G32, address rule), `r5/ux.md` (This video, This trip outdoors, the "roughly how it looks" card, Describe the picture, G36–G43), `r6/ux.md` (Suggestions, Fix it, cards, G44–G45), `docs/{field-journal,video-production,accessibility,research-profile}.md`, `docs/admin.md` §What you can do, §Review accessibility while writing, `web/admin/admin.js` (`accessibilityReview` 8218, `PUBLICATION_REVIEW_GROUPS` 8271, `publicationReviewPlace/Target/CountsText` 8321–8410, `createPublicationReview` 8649, `buildVideoReleaseKit` 9330, `analyzeGpx` 9414, `fieldJournalReview` 9475, `analyzeReadiness` 9488, panes 22529–22760, `updateSeoAudit` 23652, `updateReleaseKit` 23723, `updateFieldReview` 23742, `importGpx` 24748, `renderPreview` 24789, `updateAccessibility` 25016, `uploadTrack`/`discardPendingTrack` 25156, `needsPublicationReview`/`showResearchReview`/`save` 26181–26420), `crates/openblog-cli/src/admin.rs` (`staged_track` 16833, `save_document` track handling 17105–17200, `review_before_publication` 18199, `change_acknowledgement` 18395, `preview` 18508, `upload_track`/`discard_track` 19348, `validate_gpx` 19430, meta `authorReady` 4443), `research_review.rs`, `openblog-core/src/{accessibility,field_journal,publication_review,video_release,recipe_check}.rs`, `render.rs` 3105–3160, and Studio's `screens/write.js`, `parts/{write-page,preview,recipe-advice,write-job,job-words,publish,undo}.js`, `router.js`.

**Owners:**
- **Grammi** (recipes): presses Publish on her pumpkin pie and wants to know, once, if anything would make it worse for readers: a photo with no description, how it looks when her sister shares it on Facebook. Then she wants it up.
- **Dana** (roofer): the job check from R4 still stops a job going up without a town; now it says so in the same place as everything else.
- **A writer who posts hikes or videos** (anyone on the site, on her layer): adds a route from a hiking app without ever giving away where she lives; copies words into YouTube.
- **Mikey:** every code, line, WCAG reference, OpenGraph value and search hint the old panes showed, the research review exactly as `openblog check` words it, and the truth about which file goes where.

**The job:** "Is there anything I should look at before people see this?" One checklist, opened at the moment it matters, that never nags and blocks only what the build would refuse. After R7, no check, pane or tool about getting a post out opens the old Admin.

**Decided (owner, 2026-11-13):** the release kit, the field journal route (GPX) and the research review are all ported (Decided 4, 5).

**Decisions in this spec the owner should check** (marked ⚑ where they appear):
1. ⚑ The checklist opens by itself only on a post's **first** Publish or Schedule, and only when it has something to show; Update never opens it unless something blocks. Research posts always open it (as the old Admin did).
2. ⚑ Trimming the route's ends defaults to **500 m**, not the old 200 m.
3. ⚑ **Don't show it** leaves the climb drawing out too (the old Admin always wrote it); a switch puts it back.
4. ⚑ R5's choice "Just the area" is renamed **The whole shape**: `approximate` draws the whole route, ends included, so the old label promised more privacy than it gives.
5. ⚑ Until G47, a post with the exact route **can't be scheduled**, and its route file goes to the blog only on Publish, never on a draft save.
6. ⚑ Words for YouTube follow the engine (`openblog video`): the description gains "Read the article: <address>", and a video with no chapters is fine. The old kit differed on both.
7. ⚑ The search score (%) is dropped; answer-engine hints move to Mikey's details.

**Her words:** "your blog", "before you publish", "suggestion", "needs fixing", "when it's shared", "describe", "route", "route file", "the shape", "where you started and finished", "the climb", "words for YouTube", "chapters", "copy", "mark as checked". **Never on her layer:** OpenGraph, X card, metadata, SEO, score, readiness, audit, finding, outcome, WCAG, accessibility (as a label), alt text, GPX (except the one help sentence below, which names what other apps call it), track, coordinates, latitude, upload, staged, token, privacy mode, profile, canonical, acknowledge, validator, fingerprint, citation-*, "Studio", "Admin". Those go under **For the person who set up your site**.

| Job | Lands in | Route | Replaces |
| --- | --- | --- | --- |
| Look before it goes up | **Before you publish** sheet (heading **Check this post** once published) | `#/write/<path>?sheet=ready` | old Social, Optimize, Accessibility panes; recipe problems in See how it looks; R4's job banner |
| See how a shared link looks | Before you publish › **When it's shared**, and About this post's card (R5) | same / `?sheet=about` | old Social pane; R5's "roughly how it looks" card |
| Research review before publishing | Before you publish › **Research checks** | `?sheet=ready` | old Publication review dialog |
| Copy words into YouTube | **Words for YouTube** sheet (video posts) | `?sheet=youtube` | old Release kit pane |
| Add a route, choose how much shows | **Your route** sheet (trip posts) | `?sheet=route` | old Field review pane, GPX import |

**`legacyRoute`:** `#/edit/<post>?pane=social|optimize|accessibility` → `#/write/<path>?sheet=ready`; `?pane=release` → `?sheet=youtube`; `?pane=field` → `?sheet=route`; `?pane=evidence` waits for R12 (opens Write). One map, `PANE_SHEETS` in `router.js`, extending R5's `settings → about`.

**Route wiring:** `write` reads `?sheet=ready|youtube|route` after `load()`, opens it, and `replaceRoute` drops the query on close. `youtube` on a non-video post and `route` on a non-trip post open `ready` instead.

## Flow

```
Write (#/write/<path>), draft or new
  | [Publish] / [Schedule]  (first time this post goes up)
  v
Checking (button busy "Checking…", status "Checking your post…", at most 8 s)
  |-- nothing to show (or no signal) ------------------> save as today (R4 job check, R5 schedule)
  |-- suggestions / blocks / research post / couldn't check
  v
Before you publish (side-sheet; full screen under 30rem)
  | Needs fixing first · When it's shared · Suggestions · Your video · Your trip · Research checks
  | [Show me] -> closes, focuses the place        [Fix it] -> fixed in place, Undo
  | [Words for YouTube] -> sheet   [Add your route] -> sheet
  | footer: [Keep writing]  [Publish | Schedule]   (aria-disabled while something blocks)
  v
Publish as today: "Published. Your readers will see it in about a minute."

Any time: side card "Before you publish", More, Find, R6 Suggestions' "Check everything" -> same sheet, checks run on open.
```

**Getting back:** **Keep writing**, × or Escape close the sheet without publishing; focus returns to the opener (Publish, the side card or More). **Show me** and **Go to it** close it and focus the place. Step sheets (Words for YouTube, Your route) have **‹ Before you publish** (Alt+←) when opened from it, and **Done**/**Never mind** otherwise. Nothing depends on browser Back.

## Inventory: every check and tool the old Admin had

| Old Admin | Did | R7 | Layer | Why |
| --- | --- | --- | --- | --- |
| Social: card | site, title, description, address, image from `preview.social` | **When it's shared**: the real card | her | R5 promised the real card |
| Social: OpenGraph type, X card, image address | `social.type`, `card`, `image` | details | Mikey | |
| Social: "Matches generated OpenGraph metadata" | status | drop | — | the card is the generated one; nothing to compare |
| Optimize: score % and "n of m ready" | | **drop** ⚑ | — | no scores (counts by kind only); a percentage invites chasing |
| Optimize: search title 10–65 | | over 65 → suggestion `title-long`; under 10 drop | her | short titles aren't a problem |
| Optimize: search description 50–180 | | card note (missing / over 160); under 50 → hint | her / Mikey | R5's Summary owns the field |
| Optimize: readable URL, canonical | | **drop** | — | R5 limits the address and checks the canonical |
| Optimize: subtitle ≤ 160 | | hint | Mikey | R5's line is one line, 200 at most |
| Optimize: topic signals (tags) | | suggestion `no-tags` | her | puts the post with others |
| Optimize: direct opening, sections, depth 150+, external source | | **Search hints** in details | Mikey | answer-engine heuristics, not her concern |
| Optimize: descriptive links | | R6 `vague-link` | her | one rule, written once |
| Optimize: accessible social image | | `cover-description` | her | R5: "R7 lists it" |
| Optimize: author identity | `meta.authorReady`, credits | suggestion `no-name` | her (words) | |
| Accessibility: findings by outcome | `preview.accessibility` | Detected and Potential → **Suggestions**; Needs review → **Worth a look** (closed, never counted) | her | needs-review items can't be "fixed"; they must not nag |
| Accessibility: code, file:line:col, WCAG references, counts | | details | Mikey | |
| Accessibility: "doesn't certify WCAG" note, rendered-page checklist (contrast, focus, keyboard, zoom, motion, targets, layouts, embeds) | | details: **Check on the page yourself** | Mikey | theme matters, not post words |
| Accessibility: site `document-language-missing` | | details only | Mikey | a site setting, would show on every post |
| Release kit: chapters, issues, description, Copy | client `buildVideoReleaseKit` | **Words for YouTube** (title, description, tags, chapters, problems), engine rules ⚑ | her | |
| Release kit: production workflow ○/✓ list | | one line "Where it's at: Editing" + **Change** → About this post | her | R5 owns `productionStatus` |
| Field review: privacy select | `locationPrivacy` | **Your route** › How much readers see (also About this post) | her | |
| Field review: trim metres (number) | | choice 200 m · 500 m ⚑ · 1 km · 2 km; any number in details | her / Mikey | |
| Field review: GPX file + "Analyze GPX locally" | `analyzeGpx` | choose a file; read on this phone at once | her | |
| Field review: issues (area, conditions, exact risk, no distance) | `fieldJournalReview` | **Your trip** suggestions, + address check | her | |
| Field review: facts, charts, "Published track" | | numbers, drawings of what readers see, one line saying what readers get | her | |
| Exact track staging and discard | `track-upload` POST/DELETE | sent on Publish only ⚑; discarded on change or leave | her (in words) | G47 |
| Publication review dialog (publish / schedule) | `research/review` | **Research checks** in the sheet; same gate | her (research writer) | ADR 0123 kept |
| Acknowledge / withdraw | `research/review/acknowledgements` | **Mark as checked** toggle | her | |
| Review: code, validator, fingerprint, counts sentence, place in terminal words | | details | Mikey | parity with `openblog check` |
| Review: links to Sources, Notebook, Atlas, Compare, Evidence | | place in words now; buttons in **R11/R12** | — | those screens don't exist yet |
| Research checks beside What will be public (`previewBoundary`) | | **R12** | — | |
| Evidence pane | | **R12** | — | |
| Recipe problems in See how it looks | `recipeProblems` | **Suggestions**; preview keeps one link to the sheet | her | one place per fact |
| Job check (R4 banner) | `job/check` | **Needs fixing first** | her | one place per fact |
| Build warnings (`preview.warnings`) | Site preview pane | details: **Build notes** | Mikey | |
| Keys Alt+3 … Alt+5 | panes | Find entries | Mikey | Studio has no panes |

## Write after R7

Two changes: Publish runs the checks first (see Flow), and a **Before you publish** card ends the side column, under R5's About this post. R6's Suggestions list ends with **Check everything before you publish**.

```
400 px                                       Desktop (>= 48rem): words 1fr | 22rem side
+------------------------------------------+
| Home > Posts > Pumpkin pie      [More v] |
| Draft · saved just now                   |  status (live)
| Title [Pumpkin pie                    ]  |
| ... words, cards (R6) ...                |
| > 2 suggestions for your words           |  R6 details; ends with link
|   ... [Check everything before you       |
|   publish]                               |
| When it appears ... Tags ... Cover ...   |
| +--------------------------------------+ |
| | About this post                    > | |  R5
| +--------------------------------------+ |
| +--------------------------------------+ |
| | Before you publish                 > | |  action-button secondary, full width:
| | 2 suggestions so far                 | |  name + readyLine()
| +--------------------------------------+ |
|==========================================|
| [See how it looks] [Save draft] [Publish]|  sticky bar
+------------------------------------------+
```

- **`readyLine(state)`** (accessible name "Before you publish: <line>"): never checked, none local: "Not checked yet"; never checked, R6 suggestions: "2 suggestions so far"; checked, unchanged since: "1 thing needs fixing" / "2 suggestions" / "Nothing to check"; changed since: "Changed since the last check". Published: card name **Check this post**.
- **See how it looks** (`parts/preview.js`): the recipe problems banner goes; with any suggestions from the last check its notes show one line "2 things to look at before you publish." with **Show them** (closes the preview, opens the sheet).
- **R6's Suggestions:** unchanged, plus the final link.

## Before you publish (sheet)

- **Job:** "Is there anything I should look at before people see this?" `side-sheet side="right"`, label "Before you publish" (published: "Check this post"), 28rem; full screen under 30rem; built once per Write in `parts/before-publish.js`.
- **Loads** (in parallel, from the form as it stands, saved or not): R6 `checkWords` (local, at once); `POST preview` (G53 `only: "checks"` when available) for `social`, `accessibility`, `recipeProblems`, `warnings`, `firstBodyLine`; `POST job/check` on jobs; `POST research/review` when `researchReviewApplies`; Words for YouTube and trip rules (local). Re-runs 1.5 s after any change made while it's open, and on **Check again**.
- **Opens from:** Publish/Schedule (first time, see *When it opens by itself*), the side card, More "Before you publish…", Find, R6's link, See how it looks' **Show them**, `?sheet=ready`. Focus to the heading; from Publish, to the status line's heading so the count is read first.

```
400 px (full screen)                          Desktop: 28rem sheet over the right of Write
+------------------------------------------+
| Before you publish                    [x]|
| 1 thing needs fixing before your post    |  status, aria-live polite
| can go up. Also 2 suggestions.           |
| -- Needs fixing first (1) -------------  |  h3, only when any; tinted danger
| Add the town where you did the job.      |
|                              [Go to it]  |
| -- When it's shared -------------------  |  h3, always
| +--------------------------------------+ |  figure, the real card
| | [   cover picture   ]                | |
| | GRAMMI'S HOUSE                       | |
| | Pumpkin pie                          | |
| | Moist, spiced and easy. My mother'…  | |
| | grammishouse.com/pumpkin-pie/        | |
| +--------------------------------------+ |
| What Facebook, text messages and other   |
| apps show when someone shares it.        |
| No summary, so your first lines are      |  card note
| used. [Write a summary]                  |
| -- Suggestions (2) --------------------  |  h3
| A photo has no description, so people    |
| who can't see it won't know what it      |
| shows.          [Show me] [Describe it]  |
| No tags yet. A tag puts it with your     |
| other posts, like Thanksgiving.          |
|                            [Add a tag]   |
| > Worth a look (1)                       |  details, closed, never counted
| > For the person who set up your site    |  details, closed
|==========================================|
| [Keep writing]          [ Publish ]      |  sticky; Publish aria-disabled here
| Fix the things under Needs fixing first. |  note, only while blocked
| Your words are kept.                     |
+------------------------------------------+
```

At 320 px: the card's picture sits above its words at full width; buttons under each item wrap to their own line, full width; the footer stacks **Publish** above **Keep writing**; no sideways scroll.

Groups appear in this order, each only when it has something: **Needs fixing first**, **When it's shared** (always, posts with a signal), **Suggestions**, **Your video** (video posts), **Your trip** (trip posts), **Research checks** (research posts), **Worth a look**, details.

### States and words

| State | When | Status line | Footer |
| --- | --- | --- | --- |
| Checking | server checks out | "Checking your post…" (`loading-spinner` inline); local suggestions already listed; card is a `skeleton-block` | Publish enabled, except research posts ("Waiting for the research checks.") |
| Nothing to check | all ran, none found | "Nothing to check." Help: "Checks catch some things, not everything." | Publish |
| Some suggestions | suggestions only | "2 suggestions. None of them stop you publishing." / "1 suggestion. It doesn't stop you publishing." | Publish |
| Something blocks | any blocker | "1 thing needs fixing before your post can go up." / "2 things need fixing…" + " Also 2 suggestions." when any | Publish `aria-disabled` + note "Fix the things under Needs fixing first. Your words are kept." |
| Couldn't check: no signal | `status 0` | "Waiting for a signal to check the rest. What's here was checked on this phone." (`deviceNoun`) | Publish (Write keeps the post and says when it goes, as today) |
| Couldn't check: server | 5xx, 8 s limit | "Some checks didn't run, so this list may be missing things. You can still publish." **Check again** | Publish |
| Couldn't check: research | `research/review` failed | "The research checks didn't run. A research post waits until they do." **Check again** | Publish `aria-disabled` |
| Stale | edited while open | "Checking again…" | unchanged |
| Published, unchanged | | heading **Check this post**; states as above | **Close** only |
| Published, changed | | same | **Keep writing**, **Update** |

Scheduling: the footer says **Schedule**; Make it a draft again isn't offered here. Pressing an `aria-disabled` Publish focuses the first blocker and says "Fix this first." politely.

### When it opens by itself ⚑

`shouldOpenOnPublish({ state, intent, result, research })` (pure):

- Only when the post goes up for the **first** time (draft or new → published or scheduled). **Update** never opens it, except when something blocks (job check, as R4).
- Opens when the checks found any blocker, any suggestion, the exact route, couldn't check (server), or the post is a research post (always, even with nothing found: ADR 0123).
- Doesn't open when nothing was found, when only **Worth a look** items exist, or with no signal (the save path already keeps her work and says "waiting for a signal").
- Publish from inside the sheet publishes; it never reopens it.

### Needs fixing first

Only what the build refuses: R4 job check problems (`jobProblemWords`, unchanged, with **Go to it**), research findings in the `blocking` group (shown under Research checks, counted here), and a `preview` 422 (`build`, G46): "Something in this post stops your blog from building it. Tell the person who set up your site." (server sentence in details). R4's job banner on Write is replaced by this group; **Save draft** always works.

### When it's shared (`parts/share-card.js`)

The real card from `preview.social`, drawn as text in a `figure` (figcaption, visually hidden: "How your post looks when it's shared"): picture (`cardImageSrc(image, meta.siteUrl)`: the site-relative path when the address is the blog's own, else the https address, `referrerpolicy="no-referrer"`, `alt` = `imageAlt`), site name, title, description (or the first lines when empty), address shown as host + path. Help under it: "What Facebook, text messages and other apps show when someone shares it."

**Card notes** (not counted as suggestions; one place per fact):

| Note | When | Button |
| --- | --- | --- |
| "No summary, so your first lines are used." | `description` empty | **Write a summary** → About this post › Summary |
| "Google usually shows about 160 letters; this summary has 212. The rest may be cut off." | over 160 | **Change the summary** |
| "No picture. Add a cover photo and shared links show it." | no image | **Add a cover photo** → focuses Cover photo |
| "The picture couldn't be shown here. It may still show when shared." | image fails to load | — |

The same part replaces R5's card in About this post: real card when the sheet has a signal (asked 1.5 s after title, summary or cover change), else R5's rough card with "Roughly how it looks. The real card shows when you have a signal."

### Suggestions

One list, in post order, merged by `mergeSuggestions(local, server)`: R6 suggestions first by place; a server finding at the same place and of the same kind is dropped (`image-alt-*` ↔ `picture-description`, `link-name-empty` ↔ `empty-link`, `link-purpose-review` ↔ `vague-link`, `heading-level-skip` ↔ `heading-skip`, `raw-html-review` ↔ `html`, recipe `no-author` ↔ `no-name`, recipe `no-image` ↔ the card note). Each item: sentence, **Show me** (closes the sheet, focuses and selects the place, or opens the card's Change, R6), and **Fix it** where R6 has one. After any fix: toast "Fixed." with **Undo**, and the list re-runs.

**From the engine's accessibility checks** (`a11yWords(code, finding)`):

| Code | Outcome | Her layer | Fix |
| --- | --- | --- | --- |
| `image-alt-review` on `coverAlt` | Needs review | Suggestion `cover-description`: "Your cover photo has no description, so people who can't see it won't know what it shows." | **Describe it** (inline "Describe the picture", writes `coverAlt`) |
| `image-alt-placeholder` on `coverAlt` | Potential | "Your cover photo's description looks like a file name (“IMG_2041.jpg”). Say what it shows instead." | **Describe it** |
| `image-alt-review` in the words | Needs review | R6 `picture-description` | R6 |
| `image-alt-placeholder` in the words / before-and-after | Potential | "A photo's description looks like a file name (“IMG_2041.jpg”). Say what it shows instead." | **Describe it** |
| `link-name-empty` | Detected | R6 `empty-link` | R6 |
| `link-purpose-review` | Potential | R6 `vague-link` (with the server's words in quotes) | R6 |
| `heading-level-skip` | Potential | R6 `heading-skip` | R6 |
| `table-structure-review` | Needs review | Worth a look: "Your table: check that the top row names each column, like Weight and Time." | Show me |
| `media-alternatives-review` | Needs review | Worth a look: "Your video or sound: if there's talking, captions or a written version help people who can't hear it." | Show me |
| `embed-accessibility-review` | Needs review | Worth a look: "Something from another website is shown in your post. Check that it works without a mouse." | Show me |
| `raw-html-review` | Needs review | details only (R6 `html`) | — |
| `document-language-missing` | Detected, site | details only | — |
| any other | Detected/Potential | Suggestion: "Something here may be hard for some readers to use." (server sentence in details) | Show me |
| any other | Needs review | Worth a look, same sentence | Show me |

**Search and sharing** (`searchHints(form, meta)`, lifted from `analyzeReadiness` and split):

| Id | Her words | Fix |
| --- | --- | --- |
| `title-long` (> 65) | "Google shows about 65 letters of a title; this one has 82. The rest may be cut off." | **Show me** (title) |
| `no-tags` (posts, none) | "No tags yet. A tag puts it with your other posts, like Thanksgiving." | **Add a tag** (focuses Tags) |
| `no-name` (`!meta.authorReady` and no credited person) | "Your blog doesn't have your name yet, so the post doesn't say who wrote it. Tell the person who set up your site." | — |

**Recipe advice:** `adviceFor` (R0) codes as suggestions with **Go to it**. One word fix: `numbered-step` reads "Step 3 starts with its own number. Take it out; your blog numbers the steps." (today it says "Studio").

Mikey's **Search hints** (details, never counted): "Summary is 38 letters; 50–180 is usual.", "Line under the title is 172 letters; 160 or fewer reads as one line.", "The opening paragraph is 412 letters; 40–350 answers the question early.", "No section headings (## or ###).", "212 words; 150 or more when the topic needs explaining.", "No link to an outside source.". Each has its rule id.

### Your video (video posts)

One row: "Words for YouTube: ready to copy · 5 chapters" or "Words for YouTube: 2 things YouTube won't take" (these count as suggestions: they never stop the post), "Where it's at: Editing" with **Change** (About this post › This video), and **Words for YouTube**. A note when the post isn't live: "Keep the video private on YouTube until this post is on your site."

### Your trip (trip posts)

One row saying what readers get (`routeLine`): "Route: readers see the numbers only." / "…a drawing without the first and last 500 m." / "…a drawing of the whole route." / "…can download your exact route." / "No route added." with **Add your route** or **Change your route**. Then suggestions (`tripSuggestions(fields)`, from `fieldJournalReview`):

| Id | Her words | Fix |
| --- | --- | --- |
| `exact-route` | "Readers can see exactly where you started and finished. Make sure it doesn't show a home, a campsite, or a place where rare plants or animals live." (`alert-banner warning`, always first while exact) | **Show less of the route** (opens Your route at the choice) |
| `no-area` | "Add where you went, as an area that's safe to share, like the Dolly Sods." | **Go to it** (About this post › Where) |
| `area-looks-like-address` | "“12 Laurel Lane” looks like a street address. Use an area name instead, like the Dolly Sods." (R4 `looksLikeAddress`) | **Go to it** |
| `no-conditions` | "Add the conditions: weather, trail, water, what you saw." | **Go to it** |
| `no-distance` | "Add your route, or fill in the distance, so readers know how far you went." | **Add your route** |

### Research checks (research posts, and posts that publish citations)

From `POST research/review`, rendered by `parts/research-review.js` with words from `review-rules.js`. Intro (always): "These are prompts from your research checks, not verdicts: nothing here says the post is true or complete. Only what your blog refuses stops publishing."

```
| -- Research checks --------------------  |  h3
| These are prompts from your research...  |
| Found by a check: 2 (1 checked). Might   |  reviewCountsWords, polite
| need a look: 0. Only you can check: 3.   |
| Needs fixing before it can go up (1)     |  h4, danger tint
| The citation [@smith2020] isn't in your  |  server message (bdi)
| sources.                                 |
| Next: add it to your sources, or take    |  server repair (bdi)
| it out.                                  |
| In your words, near “As Smith showed…”   |  place words
| This can't be marked as checked: your    |  gate note
| blog refuses it, so it has to be fixed.  |
|                              [Show me]   |
| Found by a check (2)                     |  h4
| ... message / Next / place ...           |
| [Show me]  [Mark as checked]             |  toggle, aria-pressed
| You marked this as checked. It stays on  |  when pressed
| the list until it changes.               |
```

| Group (`name`) | Heading | Help |
| --- | --- | --- |
| `blocking` | "Needs fixing before it can go up (1)" | "Your blog won't publish the post with these. They can't be marked as checked." |
| `detected` | "Found by a check (2)" | "Fix them, or mark them as checked if nothing needs to change. They don't stop you publishing." |
| `potential` | "Might need a look (1)" | "They don't stop you publishing." |
| `needs-review` | "Only you can check these (3)" | "Check them against your sources. They don't stop you publishing." |

- **Gate notes** (non-advisory): `withholds` "This can't be marked as checked. The comparison stays off your site until you look at the place and approve it again."; `refuses-when-published` "This can't be marked as checked: once the post is published your blog refuses this citation, so fix it instead. Until then it only warns."; others "This can't be marked as checked: your blog refuses it, so it has to be fixed."
- **Place words** (`reviewPlaceWords(finding, body)`): post line → "In your words, near “<first 30 letters of that line>…”"; post field → "In <Studio field name>" ("In Summary"); another post → "In your post “<title>”"; claim/source/passage/note/entry/relationship/dating/comparison → "In your research: claim c-12" (the id is the writer's own); files and libraries → "In your research notes". **Show me** for lines and fields; research objects get their **Open it** buttons in R11/R12 (until then none).
- **Mark as checked** (`action-button` toggle, constant name, `aria-pressed`, described by the message): PUT/DELETE acknowledgements with the review's `revision`. Status "Marked as checked. It stays on the list and in the count." / "No longer marked as checked." Stale mark: "You marked an earlier version of this as checked; it has changed since. Mark it again if it still needs no change." Disabled while a mark is saving or without a `revision`.
- **Not reviewed:** "Not checked: <server sentence>". **Marks unreadable** (`acknowledgements.error`): "Marks can't be read right now, so none are shown or saved. Tell the person who set up your site." (file and sentence in details).
- **Nothing found:** "The research checks found nothing for this post. Checks can't see everything."
- **`applies: false`** (the post stopped being research while open): the group goes.

### For the person who set up your site (sheet details)

`details`, closed; open per visit (sessionStorage `studio-ready-details`). Rows: **Shared card** (OpenGraph type, X card, image address, page address); **Accessibility** (every finding: code, outcome, `file:line:col` or field, message, repair, WCAG references, and "These checks find some source problems. They don't certify WCAG conformance."); **Check on the page yourself** (colour contrast, visible focus, keyboard order, zoom and reflow, reduced motion, target size, layouts, things from other sites); **Search hints**; **Recipe codes**; **Build notes** (`warnings`); **Research** (`openblog check`'s counts sentence verbatim from `publicationReviewCountsText`, each finding's code, validator, gate, terminal place); **Raw** server sentences for anything worded generically.

## Words for YouTube (sheet, video posts)

- **Job:** "Copy what YouTube needs, right." `side-sheet` "Words for YouTube", 28rem, full screen under 30rem, `parts/youtube-words.js`. Opens from Your video, More "Words for YouTube…", Find, About this post › This video ("Get the words for YouTube"), `?sheet=youtube`.
- **Loads:** G50 `POST video/release` when available; until then `releaseKit()` from `video-rules.js`, which mirrors the engine (`chapters`, `chapter_problems`, `compose_description`, tag count). Re-runs as she types in Write.
- **Lede:** "Paste these into YouTube when you put your video up. Nothing here changes your video."

```
400 px (full screen)
+------------------------------------------+
| ‹ Before you publish                     |  only when opened from it
| Words for YouTube                     [x]|
| Paste these into YouTube when you put    |
| your video up. Nothing here changes ...  |
| -- Before YouTube will take these (1) -  |  h3, only when any
| The first chapter has to start at 0:00.  |
|                              [Show me]   |
| Title          82 of 100 letters         |
| [Zhalendor, Episode 1: The Gate of Em… ] |  read-only text-field
|                            [Copy title]  |
| Description                              |
| +--------------------------------------+ |  read-only, rows 10, mono off
| | Seven travelers reach a sealed ...   | |
| | Read the article: grammishouse.com/… | |
| | Chapters                             | |
| | 0:00 The gate opens ...              | |
| +--------------------------------------+ |
|                      [Copy description]  |  primary
| Tags        Fantasy, Animation   [Copy]  |  only with tags
| 5 chapters, from the lines in your words |
| that start with a time.                  |
| Where it's at: Editing         [Change]  |
| Keep the video private on YouTube until  |  note, not live
| this post is on your site.               |
| > For the person who set up your site    |
|==========================================|
|                               [ Done ]   |
+------------------------------------------+
```

- **Chapter help** (under the count, and the empty state): "Chapters are lines in your words that start with a time, like “0:00 Getting started”. The first starts at 0:00, and YouTube needs at least three, each 10 seconds or longer." No chapters: "No chapters. That's fine; YouTube shows the video without them."
- **Copy:** "Title copied." / "Description copied. Paste it into YouTube." / "Tags copied." Refused: the box's text is selected and the toast says "Select the words and copy them."
- **Primary:** **Copy description**. Problems never disable Copy (YouTube decides); they're listed above.
- **No address yet** (never saved): the "Read the article" line is left out and a note says "Save your post to add its address."

| Code | Her words | Show me / Go to it |
| --- | --- | --- |
| `title-missing` | "Give your post a title first." | title |
| `title-too-long` | "YouTube takes titles of up to 100 letters; this one has 112. Shorten the title." | title (Mikey: YouTube title in About this post details) |
| `title-angle-brackets` | "YouTube doesn't allow < or > in a title. Take them out of the title." | title |
| `description-too-long` | "These words are too long for YouTube, which takes 5,000 at most, counting the chapters. Shorten the summary." | About this post › Summary |
| `description-angle-brackets` | "YouTube doesn't allow < or > in the description. Take them out of the summary, the chapters or the AI note." | first place found |
| `tags-too-long` | "YouTube takes up to 500 letters of tags; yours have 530. Use fewer or shorter tags." | Tags |
| `chapters-first-not-zero` | "The first chapter has to start at 0:00." | that line |
| `chapters-too-few` | "YouTube shows chapters only when there are at least 3. Add more, or take the times out." | first chapter line |
| `chapters-out-of-order` | "The chapters' times have to go up, one after the other." | first line out of order |
| `chapters-duration-missing` | "Add how long the video is, so the last chapter can be checked." | About this post › How long it is |
| `chapters-too-short` | "Each chapter has to be at least 10 seconds long, the last one too." | first short one |
| `article-not-public` (note) | "Keep the video private on YouTube until this post is on your site." | — |
| other | "YouTube may not take these words as they are." (sentence in details) | — |

**Mikey's details:** codes; the engine's steps for YouTube Studio verbatim; release status (Ready / Manual / Blocked) and `digest` (G50); file problems (`source-*`, `caption-*`, `thumbnail-*`, `accessibility-no-text-alternative`, `captions-by-hand`) with the server's sentences; "Check or write out the full release with `openblog video <slug>`; uploading is in docs/video-production.md §Upload an approved release."

## Your route (sheet, trip posts)

- **Job:** "Show my route without showing where I live." `side-sheet` "Your route", 28rem, full screen under 30rem, `parts/route-sheet.js`. Opens from Your trip, About this post › This trip outdoors (**Add your route** / **Change your route**, beside How much of the place readers see), More, Find ("Add your route", "How much of the route readers see"), `?sheet=route`.

```
400 px (full screen)
+------------------------------------------+
| Your route                            [x]|
| Choose the route file from your hiking   |
| app or watch. It stays on this phone:    |
| only the numbers and a drawing go to     |
| your blog.                               |
| +--------------------------------------+ |  file-drop, accept ".gpx"
| |      Choose a route file             | |
| +--------------------------------------+ |
| In AllTrails, Strava or Gaia GPS, use    |  the one help sentence naming GPX
| Export or Share and choose GPX.          |
| -- after a file is read -------------    |
| From “ridge-walk.gpx”:                   |  polite
| 8.4 km · 420 m climb · 2 hr 15 min       |
| This replaces the distance, climb and    |  only when they differ from the post
| time in your post.                       |
| How much of the route readers see        |  radio-group legend
| (o) Don't show it                        |
|     Readers see the numbers only.        |
| ( ) The shape, without where it starts   |
|     and ends                             |
| ( ) The whole shape                      |
| ( ) The exact route                      |
| Show a drawing of the climb   [ off ]    |  toggle-switch
| What readers see                         |  h3
| [ no drawing ]  "Readers see the         |  live
| numbers only: 8.4 km, 420 m, 2 hr 15."   |
| > For the person who set up your site    |
|==========================================|
| [Never mind]          [Use this route]   |
+------------------------------------------+
```

**Choices** (`radio-group`; writes `locationPrivacy`; R5's field uses the same labels ⚑):

| Value | Label | Help | Drawing shown |
| --- | --- | --- | --- |
| `hidden` (default, always preselected for a new file) | **Don't show it** | "Readers see the numbers only." | none; climb drawing only with the switch on (default **off**) ⚑ |
| `trimmed` | **The shape, without where it starts and ends** | "A drawing with no map and no place names. The first and last part are left off." + **Leave off at each end** `select-field`: About 200 m (650 ft) · About 500 m (1,600 ft) (default) ⚑ · About 1 km (0.6 mi) · About 2 km (1.2 mi) | trimmed shape; climb drawing (switch default on) |
| `approximate` | **The whole shape** | "A drawing with no map and no place names. Someone who knows the area may recognise where it starts." | whole shape; climb |
| `exact` | **The exact route** | "Readers can download your route file and see exactly where you started and finished." | whole shape; climb; "Readers can download it." |

- **Choosing exact** asks once (`modal-dialog`): "Show the exact route?" / "Anyone can download it and see exactly where you started and finished. Times and your app's details are taken out first." **Show it** / **Keep it hidden** (focused). **Keep it hidden** leaves the previous choice.
- **What readers see** is drawn from exactly the values that will be written (`routeValues`), never from the file's points: `svg` `role="img"`, named "Drawing of your route as readers see it, without the first and last 500 m" / "…the whole route" / "Drawing of the climb". Same 1000 × 100 shape the published page draws.
- **Use this route** writes `distanceKm`, `elevationGainM` (only if the file has heights), `duration` (only if it has times; else note "No times in the file, so How long stays as you wrote it."), `locationPrivacy`, `routeShape` (empty for hidden), `elevationProfile` (empty unless the drawing is on), and clears `route` unless exact. An ordinary edit (drafts save in 3 s; published waits for Update). Toast: "Route added. <routeLine>" with **Undo** (all seven keys back, and a staged file discarded).
- **Exact:** on **Use this route** the file is cleaned on the phone (`cleanGpx`: only track points with position and height; times, waypoints, names, app and device details removed) and sent to `POST track-upload`; the token stays in sessionStorage `studio-track:<path>` and is sent **only with Publish or Update**, never with a draft save ⚑. Status under the choice: "Your route file waits, private, until you publish." No signal: "Waiting for a signal to send your route file. The numbers and drawing are in. It sends while this page is open." While exact and not yet live, **Schedule** is replaced by a note in When it appears: "A post with the exact route can't be scheduled yet. Publish it on the day, or show less of the route." ⚑ (until G47).
- **Changing the choice later** (no file in this visit): to **Don't show it** works at once (clears `routeShape`, `route`, and `elevationProfile` unless the switch is on). Anything else asks for the file: "Choose your route file again to show it this way." The old choice stays until then. On a published exact post, choosing less: "Your route file comes off your site when you press Update." (the server moves it to `.openblog/trash/tracks/`).
- **Take the route off** (sheet More / About this post): clears the six route keys; toast "Route taken off." **Undo**.
- **Leaving** with a file read but not used asks once: "Use this route?" / "You chose a file but didn't add it." **Use it** / **Leave it out**. A staged file not used is discarded (`DELETE track-upload`), and on leaving Write.
- **Nothing kept on the phone:** the file's text lives only in this page's memory. It is never put in sessionStorage, localStorage or the kept copy (`kept.js` keeps only the written values).

**File problems** (`gpxProblem(error)`, under the file-drop, `role="alert"`):

| Code | Her words |
| --- | --- |
| `not-gpx` | "That isn't a route file. Choose the file that ends in .gpx." |
| `too-big` | "That route file is too big (12 MB). Files up to 10 MB work." |
| `too-many-points` | "That route has too many points to read here. Shorten it in your hiking app, or share a simpler copy." |
| `no-route` | "That file has no route in it. Some apps save only places; choose the one with your track." |
| `unsafe` | "That file has something in it besides a route, so it wasn't read." |
| `unreadable` | "That file couldn't be opened. Choose it again." |
| `too-short-to-trim` | "Your route is too short to leave that much off each end. Choose less, or don't show it." |

**Mikey's details:** points read and kept, track parts, trim in metres (`text-field` 0–5000, "Any number of metres."), the keys and values that will be written, for exact: cleaned size, what was removed, staged or not, where it will live (`static/tracks/uploads/<year>/<name>.gpx`), and "Staged copies are kept privately for up to a day."

## Errors by code

| Answer | Where | Her words |
| --- | --- | --- |
| `preview` 422 `build` (G46; until then any 422) | Needs fixing first | "Something in this post stops your blog from building it. Tell the person who set up your site." (sentence in details) |
| `preview` 413 | status | "This post is too long to check in one piece. You can still publish." |
| `preview` / `research/review` / `job/check` 401 | shell | "Sign in again"; the sheet and her words stay |
| `preview` 0 | status | couldn't-check (no signal) |
| `preview` 5xx or 8 s | status | couldn't-check (server), **Check again** |
| `research/review` 0 / 5xx | Research checks | "The research checks didn't run. A research post waits until they do." **Check again** |
| `research/review` 422 | Research checks | "Your blog couldn't read this post to check it. Tell the person who set up your site." |
| acknowledgements 409 `changed` (G51) | that finding | "This list was changed on another computer. Here it is again; mark it again if you still need to." (review reloads) |
| acknowledgements 422 / 413 | that finding | "That wasn't marked. Nothing changed." (sentence in details) |
| acknowledgements 0 | that finding | "Waiting for a signal. Nothing was marked." |
| `track-upload` 413 `too-large` (G49) | Your route | "That route file is too big for your blog (8 MB at most). Show less of the route, or ask the person who set up your site." |
| `track-upload` 415 `not-gpx` / `unsafe` / `not-utf8` | Your route | "Your blog couldn't read that route file. Choose another, or show less of the route." |
| `track-upload` 400 `empty` | Your route | "That route file is empty. Choose it again." |
| save 422 `track-expired` | Write banner | "Your route file waited too long. Choose it again in Your route, then publish." **Choose it again** |
| save 422 `track-needs-exact` / `bad-token` | Write banner | "Your route file didn't go with the post. Choose it again in Your route." |
| `track-upload` DELETE fails | none | silent retry once; details: "A private copy waits on your blog and is cleared within a day." |
| `job/check` | Needs fixing first | R4 table |
| copy refused | YouTube sheet | "Select the words and copy them." |

Until G46/G49/G51, `readyProblem(error)` maps today's strings (`"staged track expired"`, `"Tracks can be at most"`, `"GPX tracks must be UTF-8"`, `"acknowledgements changed"`) to these codes; anything unmatched uses the row's general sentence.

## No signal

- Local checks (R6 suggestions, search hints, recipe advice Studio owns, trip suggestions, Words for YouTube) work without a signal. The card, accessibility, recipe engine advice and research checks say "Waiting for a signal" in the status line.
- Publish with no signal skips the checks and goes the usual way (kept on this phone; Write says when it goes). The sheet doesn't open.
- Your route works offline for every choice except exact (the file waits in memory, sent when the signal is back while the page is open).
- A mark as checked needs a signal; nothing is queued.

## Undo

| Action | Undo |
| --- | --- |
| Fix it (any) | toast **Undo**: the box or field back exactly (R6) |
| Describe it (cover) | toast **Undo**: `coverAlt` back |
| Use this route | toast **Undo**: seven keys back; staged file discarded |
| Change of route choice | toast **Undo**: previous choice and values |
| Take the route off | toast **Undo** |
| Mark as checked / unmark | press again (toast "Marked as checked." with **Undo** = DELETE) |
| Publish | as today (Take it off my site) |
| Copy | nothing to undo |

## What each owner sees

| | Grammi | Dana | Mikey |
| --- | --- | --- | --- |
| Opens by itself | first Publish of a recipe with suggestions (usually photo descriptions, a course) | first Publish of a job; any Publish that the job check stops | same, plus details open per visit |
| Needs fixing first | (rarely) a build problem | job check problems | + server sentences, codes |
| When it's shared | the card, summary and picture notes | same | OpenGraph type, X card, addresses |
| Suggestions | photos, links, headings, tags, title, recipe advice | photos, tags, title | + rule ids, lines, WCAG refs, search hints |
| Worth a look | table, video | before-and-after, video | + raw HTML, site language, page checklist |
| Your video / trip / research | only on those posts | — | + YouTube steps, digest, file problems; route numbers, metres, file path; terminal review words |

## Rules each part uses (static imports, DOM-free, tested)

| Part | File | Functions |
| --- | --- | --- |
| Checklist | new `parts/ready-rules.js` | `readyState({ local, server, job, research, failure, online })` → `{ state, words, blocks, suggestions, worth }`, `readyLine`, `shouldOpenOnPublish`, `mergeSuggestions`, `a11yWords(code, finding)`, `searchHints(form, meta)` (from `analyzeReadiness`, split `her`/`hints`), `cardNotes(social, fields)`, `cardImageSrc(image, siteUrl)`, `bodyPlace(line, firstBodyLine, body)`, `readyProblem(error)` |
| Research review | new `parts/review-rules.js` (lifted from `admin.js`) | `researchReviewApplies`, `REVIEW_GROUP_WORDS`, `gateWords`, `reviewPlaceWords`, `reviewTarget`, `publicationReviewCountsText` (verbatim, Mikey), `reviewCountsWords`, `markWords(state)`, `acknowledgementRequest(entry, revision)` |
| Video | new `parts/video-rules.js` | `videoChapters(body)`, `chapterProblems(chapters, duration)`, `durationSeconds`, `videoDescription({ summary, url, chapters, ai })`, `youtubeTagsChars`, `releaseKit(fields, body, { url, tags, live })`, `releaseWords(code, detail)` |
| Route | new `parts/route-rules.js` | `analyzeGpx(source, { privacy, trimMeters = 500 })` (lifted; heights `null` when absent), `cleanGpx(source)`, `routeValues(analysis, privacy, { climb })`, `routeLine(fields)`, `routeChange(from, to, haveFile)`, `tripSuggestions(fields)` (from `fieldJournalReview`), `gpxProblem(error)`, `durationWords(seconds)`, `TRIM_CHOICES` |
| Words | `parts/recipe-advice.js` | `numbered-step` wording fix |
| Routing | `router.js` | `PANE_SHEETS` in `legacyRoute` |

- **Port:** `admin-readiness` → `studio-ready-rules` (her/hint split, no score); `admin-behavior` "accessibility findings are grouped…" → `studio-ready-rules`; "GPX analysis…", "field review…" → `studio-route-rules`; "video release kits…" → `studio-video-rules` (expected description gains the article line; zero chapters gives no problem: both changes asserted); `admin-publication-review` post cases (applies, groups/codes order, withholds note, only blocking blocks, mark keeps listed and counted, refused mark changes nothing, every finding has a place, not reviewed / unreadable marks / not applicable) → `studio-review-rules` + `studio-research-review.spec.mjs`; site cases → R12; `admin-readiness-report` place and counts cases → `studio-review-rules`, site cases → R12; browser `publication-review.spec` → `studio-research-review.spec.mjs`.
- **New:** `releaseKit` equals the engine's `youtube_preview` title/description/tags/problem codes on every video post in `examples/` and `content/` (fixture written by a Rust test); `cleanGpx` output holds no `<time>`, `<wpt>`, `<metadata>`, `<extensions>`, `<name>`, `<link>` and still passes `validate_gpx`; hidden writes no `routeShape` and no `elevationProfile` with the switch off; default trim is 500; a route shorter than twice the trim is `too-short-to-trim`; a draft autosave never sends `trackToken`; Schedule is unavailable with an unsent exact route; Publish with nothing found opens no sheet; Update opens it only with a blocker; a research post always opens it; a cover with no description is listed once; Worth a look never counts; no her-layer string in `ready-rules`, `route-rules`, `video-rules`, `review-rules`, `recipe-advice` contains "Studio", "Admin" or a banned word (one test reads the word tables).
- **Browser:** `studio-before-publish.spec.mjs` (first publish opens with suggestions, Fix it + Undo, blocked job, 320 px, axe, keyboard only), `studio-route.spec.mjs` (file read offline, choices and drawings, exact confirm, exact sent only on Publish, Take it off + Undo), `studio-youtube.spec.mjs` (copy, problems, Show me selects the chapter line), `studio-research-review.spec.mjs`.

## Accessibility and keyboard

- **Sheet order:** heading, status, Needs fixing first, When it's shared, Suggestions, Your video, Your trip, Research checks, Worth a look, details, footer. Each group an `h3` with its count in the text ("Suggestions (2)"); research groups `h4`.
- **Live regions:** the status line (`role="status"`, polite) says each state once; per-item results ("Fixed.", "Marked as checked…") go to the toast region. The check re-running after a fix doesn't re-announce unchanged counts.
- **Names:** item buttons carry their item: "Show me: a photo with no description, “Pie cooling”", "Describe it: cover photo", "Mark as checked: the citation [@smith2020]", "Copy description". Disabled Publish is `aria-disabled="true"`, `aria-describedby` the note, stays focusable.
- **Keys:** Ctrl/⌘ Enter in the sheet = its primary (Publish/Schedule/Update; when blocked, focuses the first blocker); Escape = Keep writing / Done (asks if a route file was read and not used); Alt+← back to Before you publish from a step sheet; Enter on **Show me** closes and focuses the place.
- **Find:** "Before you publish" (or "Check this post"), "Check again", "Words for YouTube", "Copy the YouTube description", "Add your route" / "Change your route", "How much of the route readers see", "Research checks".
- **Card:** a `figure`; the picture's `alt` is the post's own description (empty when none, and then a card note says so); text is real text, never an image.
- **Route drawings:** `role="img"` with the names above; the numbers are also text, so nothing is drawing-only.
- **320 px:** full-screen sheets, sticky footers above the keyboard, items' buttons full width, the card stacks, the description box wraps (no sideways scroll), radio cards stack, controls ≥ 44 px. **Reduced motion:** no slide; the "Checking" spinner becomes the static word only.
- **Zubra:** `side-sheet`, `alert-banner`, `action-button`, `content-card`, `status-badge`, `radio-group`, `toggle-switch`, `select-field`, `text-field`, `file-drop`, `modal-dialog`, `toast-region`, `skeleton-block`, `loading-spinner`, `command-palette`, `cluster-layout`. The toggle for Mark as checked is `action-button` with `aria-pressed` (if `action-button` can't carry it, add `pressed` in zubra-ui and re-vendor; noted, not a fork). `radio-group` falls back to the native `fieldset` as in R2/R5.

## Safety

- **Location above all.** Every route starts hidden; the file is read on the phone with the lifted regex reader (no DOM parsing, no network) and its text is never stored. What readers will see is drawn from the values to be written, before anything is written. The exact route needs a confirm, is cleaned of times and app details before it leaves the phone, goes only with Publish/Update, can't be scheduled until G47, and is discarded when not used. Switching away from exact retires the public file on the next save (server, unchanged). The area field refuses street addresses as R4's town does. Photos keep losing their location on the phone and on the server (R4).
- `trackToken` is never part of `kept.js`, an autosave or a draft request; `fieldsForSave` drops it unless the intent publishes.
- Every server value (card title, description, finding messages and repairs, place ids, YouTube words) is `textContent`; research messages in `bdi`. The card's picture loads only `/images/…` or https with `referrerpolicy="no-referrer"`. No frame: checks use `preview`'s JSON, never the preview page.
- Mark as checked sends exactly the finding's validator, code, object, path, id, field and fingerprint with the review's `revision`; a conflict changes nothing.
- CSP unchanged.

## Gaps

- **G46. Codes and lines on `POST preview`:** 422 `{code: "build", error, problems: [{field?, line?, message}]}` and `{code: "not-found"}`; the reply gains `firstBodyLine` (as `research/review` has), so accessibility lines map to her words. Strings stay as `error`.
- **G47. An exact route file is public only with a live post:** a save with `trackToken` on a draft or future-dated post keeps the file private (`.openblog/pending-tracks`, not pruned while a post names it), and the build copies `static/tracks/uploads/*` into the site only for files named by a live post's `route` with `locationPrivacy: exact`. Then Studio may send the token on any save and allow Schedule.
- **G48. The server cleans an exact route file:** `track-upload` rewrites the GPX to track points with `lat`, `lon`, `ele` only (drops `time`, `wpt`, `rte`, `metadata`, `name`, `desc`, `link`, `extensions`) and answers `{token, points}`. Until then Studio sends `cleanGpx`'s output; files staged by other clients aren't cleaned.
- **G49. Codes on track errors:** `track-upload` 400 `empty`, 413 `too-large` + `maxMb`, 415 `not-utf8` / `not-gpx` / `unsafe`, 400 `bad-token`; `document` save 422 `track-expired`, `track-needs-exact`, `bad-token` (inside G36's `problems`).
- **G50. `POST video/release`** `{kind, path, fields, body}` → the engine's `VideoPreview` JSON for the draft (title, description, tags, chapters, problems/manual/notes with `code`, status, steps, digest), so Words for YouTube and `openblog video` can't disagree. Until then `video-rules.js` mirrors the engine, held to it by the fixture test.
- **G51. Codes on acknowledgement errors:** 409 `changed` + `revision`; 422 `invalid-acknowledgement`, `file-invalid` + `file`; 413 `too-large`; 400 `bad-request`.
- **G52. A hidden route keeps no shape in the file:** `document` save drops `routeShape` when `locationPrivacy` is `hidden` (as it drops `route` unless `exact`), so a public repository never holds the shape of a route its post hides.
- **G53. A lighter check:** `POST preview` with `"only": "checks"` skips the portable copy and the preview page and answers `social`, `accessibility`, `recipeProblems`, `warnings`, `firstBodyLine`, so the Publish check fits in its 8 s on a large site.
- **Not gaps:** `preview.social`, `preview.accessibility` (with `code`, `outcome`, `source`), `recipeProblems`, `warnings`; `research/review` and acknowledgements (with `revision`, `gate`, `fingerprint`); `track-upload` POST/DELETE; `meta.authorReady`, `meta.profiles`; R4 `job/check`.

## Risks to test before release

- iPhone: choosing a `.gpx` from Files and from AllTrails' Share sheet (the `accept` filter may grey it out: fall back to no filter and check the contents); a 10 MB file read without freezing the page.
- An exact route on a draft that autosaves for an hour never appears under `static/tracks/uploads/` (until G47 lands, then: never in the built site).
- A published exact route switched to Don't show it: Update moves the file to trash and the next send removes it; Undo before Update keeps it.
- A big site: Publish waits at most 8 s, then publishes or opens the sheet in "couldn't check".
- Grammi's Thanksgiving recipe from the old Admin: first Publish lists photo descriptions once each, no score, and Publish works from the sheet.
- Dana's job without a town: the sheet opens, Go to it focuses Town, Publish works after.
- Two tabs marking the same research finding: the second gets `changed` and loses nothing.
- Words for YouTube on the Zhalendor example equal `openblog video zhalendor-gate-of-embers` byte for byte.
- Edits while the sheet is open: Show me never points at a moved line (re-check first).

## Docs and release note

- Rewrite `docs/admin.md` §What you can do (Social preview, Accessibility Studio, Video release kit, Field Review rows), §Workspace layout (Alt+3–5), §Review accessibility while writing, and the profile paragraph, for Before you publish, Words for YouTube and Your route. `docs/field-journal.md` §Import a GPX track: Studio steps, the 500 m default, Don't show it leaves the climb drawing out unless switched on, the cleaned exact file, sent only on Publish, no scheduling until G47, the renamed choices. `docs/video-production.md`: Release kit becomes Words for YouTube, same words as `openblog video` (article line; no chapters is fine). `docs/research-profile.md`: the review is in Before you publish; acknowledging is Mark as checked. `docs/accessibility.md`: where findings show and why needs-review ones don't count.
- **Release note (Mikey):** the editor's Social, Optimize, Accessibility, Release kit and Field review panes are one **Before you publish** sheet that opens on a post's first Publish when it has something to show; the search score is gone (hints in details); Words for YouTube match `openblog video`; routes default to hidden with 500 m trimmed when shown, the climb drawing is opt-in when hidden, exact route files are cleaned and sent only on Publish, and can't be scheduled yet; acknowledging research findings is **Mark as checked**.

## Changes to `studio-ux` (proposed)

- Banned on her layer, add: OpenGraph, score, readiness, audit, finding, WCAG, track, GPX, coordinates, acknowledge, validator. She hears "suggestion", "needs fixing", "when it's shared", "route", "mark as checked". A file format may be named once, in help, only where another app shows her that name.
- **Checks suggest; only the build blocks.** A check that only advises never disables Publish; a blocker names the fix and Publish says why it waits. No scores or totals: counts by kind.
- **Ask once, at the moment it matters.** A checklist opens by itself only on the first Publish and only with something to show; things that can't be fixed (needs review) never count and never open it.
- **Where someone was stays private by default.** Anything that could show where she lives or was starts hidden, shows what readers will see before it's saved, keeps the source on her phone, and leaves it only by her explicit, confirmed choice, cleaned first.
- Review checklist: "Every check the old screen ran is on her layer, in details, or dropped with a written reason; a suggestion never stops Publish; nothing she types or chooses reveals a location without a confirm."
