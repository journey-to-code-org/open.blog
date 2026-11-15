# Studio UX, retirement slice R5: About this post

By `studio-ux`, 2026-11-13. Sources: `studio-ux`, `retirement-plan.md` (§1 B "Settings pane", "Content profile", "Credits", "Portable output"; §1 C `#/contributors`; §1 H; §2 `write.js:275,337`, `write-page.js:82`; §4 R5; Decided 2), `r3/ux.md`, `r4/ux.md` (About this job, G32, G33), `design.md` §3 Write, `review-mikey.md`, `docs/content.md`, `docs/admin.md` §Scheduling, `web/admin/admin.js` (`render` 21921–22270, `renderCreditEditor` 21737, `validateCreditDraft` 1247, `collect` 26106, `slugHelp` 8072, portable preview 8115–8215 and 24850–25010), `crates/openblog-cli/src/admin.rs` (`meta` 4090, `get_document` 12294, contributors 12420–12610, `credit_sidecar_contents` 16392, `validate_candidate` 16444, `derive_new_path` 16845, `save_document` 16886, `acknowledge_portability` 17731, `tick_scheduler` 447), `openblog-core/src/{model,profile,contributor,visual_card}.rs`, `pinterest.rs`, and Studio's `router.js`, `screens/write.js`, `parts/{write-page,post-fields,post-session,post-details,write-trouble,write-actions,take-off,recipe-numbers,recipe-fields,cover-picker,field-form,record-kinds,dates,publish}.js`.

**Owners:**
- **Grammi** (recipes): a line under the title, a better sentence when her pie is shared on Facebook, "Makes 2 loaves", her sister named on the cornbread post.
- **Dana** (roofer): About this job already exists (R4); wants her company on the byline and a Thanksgiving post scheduled for the morning.
- **Mikey:** every field the old Admin had: the address, first-published-elsewhere, theme, credit roles, the raw truth about the file.

**The job:** "Tell my blog the little things about this post: what it is, who wrote it, and what people see when it's shared." After R5, nothing about a post's settings opens the old Admin.

**Decided (owner, 2026-11-13):** no rename. `document/rename` is deleted; R5 never moves a file. A post's address can be set only while it has never been on her site.

**Decided (2026-11-13), following the recommendations:**
1. A future day with an empty time fills the time with **8:00 AM** her time (today it goes up at midnight UTC, the evening before in the US).
2. Pinterest Pin words show on her layer only when the site sends Pins (G39); otherwise only in Details.

**Changed after the Mikey walkthrough (2026-11-13)** — these override the text below where they differ:
- **Address rule is "never published", not the date.** `slugEditable` is true only for a new post, or a draft the server reports as never published (G38 adds `wasPublished`, true when the file's history or the publish ledger shows it was ever live; unknown counts as true). A published post moved to the future keeps a read-only address.
- **Next-send honesty.** With `meta.schedule: "next-send"`, her help adds "The person who set up your site can make it go up by itself." Details show how the live site is sent out (`publish.mode`), when the next send is if known, and a link to docs on scheduled builds (`docs/deploy.md` §Scheduled builds).
- **Changes not on the site yet are visible.** On a published post with changes kept on this device, Write's status reads "Changed · not on your site yet. Press Update to put them up." and `aboutLine` starts with "Changes not on your site yet". This stays until Update or a discard.
- **Kind change Undo lives on the sheet.** After changing What kind of post, an inline **Undo** sits under the choice until the sheet closes (the toast still shows too).
- **Rename stays dropped** (owner decision). Old addresses stay read-only; Details explain they are changed in the file.

**Her words:** "your blog", "about this post", "summary", "who wrote it", "the address", "when it's shared", "Google and other search engines" (once, plainly). Never on her layer: slug, front matter, metadata, canonical, noindex, profile, sidecar, credits, contributor, registry, role vocabulary, CRediT, Crossref, ORCID, alias, theme, SEO, OpenGraph, portable, representation, acknowledge, "Studio", "Admin".

| Job | Lands in | Route | Replaces |
| --- | --- | --- | --- |
| Say what kind of post it is | **About this post** › What kind of post | `#/write/<path>?sheet=about` | old Content profile select |
| Recipe facts (makes, total time, calories, where it came from) | About this post › This recipe | same | old profile fields; "More about this recipe" sheet (merged in) |
| Video and outdoor-trip facts | › This video / This trip outdoors | same | old profile fields |
| Line under the title; part in a collection; comments | › On the page | same | old Subtitle, Part number, Comments |
| What search and shared links show | › In search and when shared | same | old Description, Pin title/description |
| Who wrote it | › Who wrote it | same | old Contributors editor |
| Who can be named on posts | **People** | `#/people` | old `#/contributors` |
| Address, first published elsewhere, theme, picture by web address, roles, every kind, raw facts | › **Details for the person who set up your site** | same | old Slug, Canonical, Theme, web-address cover, authorship source, roles |
| Photo by | Write › Cover photo | `#/write/<path>` | old Photo by |
| Post later; stop it going up; take it off | Write › When it appears, primary, More | same | old Status radios + Publish at |
| Copy a post to Medium, Ghost, Hashnode, DEV, WordPress | Write › More › **Copy it for another blog** | `#/write/<path>?sheet=copy` | old Preview "Portable" modes |

**`legacyRoute`:** drop `"contributors"` from `NOT_YET` and `not-yet.js` `NAMES`. `#/contributors` → `#/people`. `#/edit/<post>?pane=settings` → `#/write/<path>?sheet=about`. Other `?pane=` unchanged.

**`write.js:275,337`, `write-page.js:82`:** every "open the old Admin" fallback goes; an unreadable file keeps its R0 banner with the server's reason.

**Route wiring:** `screens/index.js` gains `{ name: "people", area: "people", create: createPeople }` (not in the side navigation). `write` reads `?sheet=about|copy` and opens it after `load()`; closing removes the query (`replaceRoute`).

## Flow

```
Posts / Home "Keep going" / New post
  v
Write (#/write/<path>)
  | side column: When it appears · Tags · Collection · Cover photo (+ Photo by)
  | [About this post]  "Summary set · Comments open · By Grammi"
  v
About this post (side-sheet; full screen under 30rem)
  | What kind of post · This recipe · On the page · In search and when shared · Who wrote it
  | > Details for the person who set up your site
  | Who wrote it > "Add someone who isn't listed"  ---------> People (#/people)
  | [Done]  (part of the post: drafts save themselves, published wait for Update)
  v
Write: Publish / Schedule / Update / Make it a draft again / More > Take it off my site
                                                    More > Copy it for another blog
```

**Getting back:** sheets close with **Done**, × or Escape; focus returns to the opener. People has breadcrumb "Home › People"; from a post it adds **Back to “Pumpkin bread”** (`?from=`), which reopens the sheet at Who wrote it. Nothing depends on browser Back.

## Inventory: every post field the old Admin edits

Keys are written under the name the post already uses (aliases as in `recipe-fields.js`). A key Studio doesn't edit is always sent back as it came.

| Field (key) | Before R5 | R5 | Why |
| --- | --- | --- | --- |
| Title | Write | unchanged | |
| Status (`draft`) + date | Write | **her**; adds 8 AM default, past-date words, truth about when it goes up (G37) | |
| Tags, Series (Collection), Cover + alt | Write | unchanged (+ "Not described yet" note) | |
| Part number (`seriesOrder`, `series_order`, `part`) | none | **her**: On the page, only with a Collection | |
| Photo by (`coverCredit`) | none | **her**: under the cover | |
| Cover by web address | none | **Mikey** | not a photo she has |
| Subtitle (`subtitle`, `subheading`, `dek`) | none | **her**: On the page | |
| Description (`description`, `summary`, `brief`, `excerpt`) | none | **her**: "Summary" | what Google and shared links show |
| Pin title / description (`cardTitle`, `cardDescription`) | none | **her** with Pins (G39), else **Mikey** | |
| Comments (`comments`) | none | **her**, only when `meta.engagementSetUp` | |
| Kind (`profile`) | recipe at start only | **her**: Story / Recipe / Job (trade) + the post's own kind; **Mikey**: all six | |
| Recipe: servings, prep, cook | Write | unchanged | |
| Recipe: course, cuisine | "More about this recipe" sheet | **her**: moved into This recipe | one sheet, not two |
| Recipe: yield, totalTime, calories, adaptedFrom | none | **her**: This recipe | |
| Job: `job.*` | R4 About this job | unchanged, not in the sheet | one place per fact |
| Video: videoUrl, duration, thumbnail, productionStatus, madeForKids, syntheticMedia, videoPeople, videoRights, aiDisclosure | none | **her** on video posts: This video | choices via G40 |
| Video: videoFile, captions, videoTitle, videoDescription, season/episode, productionCredits | none | **Mikey** | |
| Field journal: activity, location, locationPrivacy, distanceKm, elevationGainM, duration, conditions | none | **her** on those posts: This trip outdoors | Hidden by default; GPX is R7 |
| Research: doi, license | none | **Mikey**, research posts only | R11–R14 |
| Credits (`.credits.json`) | none | **her**: people and order; **Mikey**: roles, name no one, repair | |
| Contributor registry | `#/contributors` | **People** screen | |
| Slug | none | **Mikey**: "Address", editable only while never live | Decided |
| Canonical (`canonical`, `canonicalUrl`) | none | **Mikey**: "First published somewhere else" | |
| Theme | none | **Mikey** | Decorations is her seasonal look |
| Portable output | none | **her**: Copy it for another blog; **Mikey**: diagnostics, mark checked | |
| noindex | — | **drop** | no per-post noindex in the engine; a draft is how a post stays out |
| Related posts | — | **drop** | chosen by the site |
| Reading path | — | **R13** | not a post field |
| Abstract | — | **R6/R11** | a body block |
| Rename | — | **drop** | Decided |
| `updated`, `aliases`, `sourceUrl`, `coverLight`, `coverDark`, `cardImage*`, `participation`, `webmentions`, `highlight`, `lineNumbers`, `citations`, `citationLocale`, shared-reflection keys | — | **Mikey**, read-only "Also in this post" | kept as written, and visible |

Pages (`description`, `nav`) and collections (`order`) are Page edit's, not R5's.

## Write after R5

Three small changes on her layer: **When it appears** gets truthful help; **Cover photo** gets **Photo by**; one **About this post** button ends the side column. **Show details** and **More about this recipe** leave More; both open About this post.

```
400 px                                       Desktop (>= 48rem): words | 22rem side
+------------------------------------------+
| Home > Posts > Pumpkin bread    [More v] |
| Draft · saved just now                   |  status (live)
| Title [Pumpkin bread                  ]  |
| Serves [8] Ready [15 min] Cook [1 hr]    |  recipe numbers / About this job
| Words ...                                |
| When it appears                          |  fieldset
| Date [Nov 27, 2026]  Time [ 8:00 AM ]    |
| It goes up by itself on Friday,          |  help (state-dependent)
| November 27 at 8 AM.                     |
| Tags [Thanksgiving x] [Bread x] [     ]  |
| Collection [Thanksgiving            v]   |
| Cover photo                              |
| [  photo  ]                              |
| Describe the picture [               ]   |
| Photo by [Aunt Ruth                  ]   |  new
| [Change the photo]  [Remove it]          |
| +--------------------------------------+ |
| | About this post                    > | |  action-button secondary, full width,
| | Summary set · Comments open ·        | |  name + aboutLine()
| | By Grammi                            | |
| +--------------------------------------+ |
|==========================================|
| [See how it looks] [Save draft] [Schedule]  sticky bar (unchanged)
+------------------------------------------+
```

- **`aboutLine(form)`**: up to three facts joined by " · ": kind when not a story ("A recipe"); "Summary set" / "No summary yet"; "Comments open" / "Comments closed" / "No comments" (only when set up); "By Grammi" / "By Grammi and Ruth" / "No one named". Accessible name "About this post: <line>".
- **Photo by** (`maxlength` 200): help "If someone else took it, their name. Leave empty if you did." Cleared by **Remove it** and **Change the photo**. Writes `coverCredit`, spaces collapsed.
- **Describe the picture:** unchanged; with no words, quiet help "Not described yet. A few words let everyone enjoy it, including people who use a screen reader." Never blocks Publish (R7 lists it).
- **Picture by web address:** shows the picture with "This photo is on another website." Editing the address is in Details.

## About this post (sheet)

- **Job:** "The little things about this post."
- `side-sheet side="right"`, label "About this post", 28rem; full screen under 30rem; built once per Write screen in `parts/about-post.js`.
- **Primary:** **Done** (sticky footer) closes it. No separate save: every field is part of the post. Drafts save themselves 3 s after a change; a published post keeps changes on this device until **Update**.
- **Footer status** (live): new "Saves with your post once it has a title." / draft "Saves by itself." / published, changed "Press Update to put these on your site."
- **Opens from:** the Write button, More "About this post", palette ("About this post", "Summary for search and sharing", "Who wrote it", "More about this recipe", "Details for the person who set up your site"), `?sheet=about`, and recipe advice **Go to it** (course, cuisine) — each scrolls to its group with focus on the first field; otherwise focus to the heading.

```
400 px (full screen)
+------------------------------------------+
| About this post                       [x]|
| What kind of post                        |  fieldset legend
| (o) A story   Words and photos.          |  radio-group (choice-cards look)
| ( ) A recipe  Ingredients and steps,     |
|               with a recipe card.        |
| ( ) A job     Work you did for a         |  trade sites only
|               customer.                  |
| This recipe                              |  h3, recipe only
| Course [Dessert, Bread          ]        |
| Cuisine [Southern               ]        |
| Makes [2 loaves                 ]        |
| Time from start to table [      ]        |
| Calories in a serving [         ]        |
| Where you found it [https://... ]        |
| On the page                              |  h3
| A line under the title [        ]        |
| Part in Thanksgiving [ 3 ]               |  with a Collection
| Comments                                 |  when comments set up
| (o) Open  ( ) Show, but no new ones      |
| ( ) Hidden                               |
| In search and when shared                |  h3
| Summary                                  |  rows 3
| [Moist, spiced and easy. My mother's  ]  |
| One or two sentences. Leave empty and    |
| your blog uses the first lines of your   |
| post.                                    |
| +--------------------------------------+ |  content-card "Roughly how it looks in a
| | [img] grammishouse.com > pumpkin-... | |  search or a shared link"
| | Pumpkin bread                        | |
| | Moist, spiced and easy. My mother'...| |
| +--------------------------------------+ |
| > Words for a Pinterest Pin              |  only with Pins (G39)
| Who wrote it                             |  h3
| Grammi                                   |
| [Change who wrote it]                    |
| > Details for the person who set up      |
|   your site                              |
|==========================================|
| Saves by itself.               [ Done ]  |
+------------------------------------------+
```

At 320 px: one column, labels above fields, choice cards stacked, footer status wraps above **Done**.

### What kind of post

`radio-group` (choice-cards look), writes `profile`: "A story" (`article`), "A recipe" (`recipe`), trade sites "A job" (`job`). A video, field journal or research post also lists its own ("A video", "A trip outdoors", "Research"). An unknown id shows "Something else" with "Your blog shows it as a story. The person who set up your site chose this." A legacy recipe with no `profile` shows "A recipe" and writes nothing until changed.

Changing it is an ordinary edit (autosave); toast "Now a recipe." with **Undo** (old kind and boxes back).

| From → to | What happens | Help under the choice |
| --- | --- | --- |
| story → recipe, empty words | recipe starter, boxes and numbers appear | "Your recipe boxes are ready." |
| story → recipe, has words | words unchanged; numbers appear; boxes only if Ingredients and Steps exist | "Your words stay as they are." **Add the recipe parts** appends `## Ingredients` / `## Steps` (from `meta.profiles` `starter`) |
| recipe → story | words unchanged; numbers and boxes go; recipe fields kept, unseen | "Your recipe stays in your words. The recipe card comes off this post. Its numbers are kept if you change back." |
| any → job | R4 About this job appears; empty words take the scaffold | "Fill in About this job, under the title." |
| job → any | About this job goes; `job.*` kept | "The job details are kept if you change back." |

Details (Mikey): "Kind (profile)" `select-field`, all six by `meta.profiles` label + id.

### This recipe / This video / This trip outdoors (only the post's own kind)

No group for a story or a job (About this job is already under the title). Fields drawn by `field-form` from `meta.profiles[].fields`; labels and help are Studio's (`parts/profile-words.js`); choices from G40.

**This recipe**

| Key | Label | Help | Check |
| --- | --- | --- | --- |
| `course` | Course | "Like Dessert or Dinner. Readers can find recipes by it." (no recipe list: drop the second sentence) | — |
| `cuisine` | Cuisine | "Where the dish comes from, like Southern or Italian." | — |
| `yield` | Makes | "What it makes, like 2 loaves or 24 cookies." | — |
| `totalTime` | Time from start to table | "Only when it's more than getting ready plus cooking, like an overnight rise." | — |
| `calories` | Calories in a serving | "Only if you know, like 320." | — |
| `adaptedFrom` | Where you found it | "If it started as a recipe on another website, paste its web address. To thank a person, say so in your words." | not `http(s)://` → "That needs to be a web address, starting with https://. To thank a person, say so in your words." |

**This video**

| Key | Label | Control | Help / check |
| --- | --- | --- | --- |
| `videoUrl` | YouTube link | url | "Copy it from Share under the video." Not YouTube → "That isn't a YouTube link. Copy it from Share under the video." |
| `duration` | How long it is | text | "Like 12:34." |
| `thumbnail` | Picture shown before it plays | picture picker ("Choose one of your photos") | "Leave empty to use the cover photo." |
| `productionStatus` | Where it's at | select: Idea, Writing the script, Storyboard, Making it, Editing, Scheduled, Out | — |
| `madeForKids` | Made for children? | radio Yes / No | "YouTube asks this of every video." |
| `syntheticMedia` | Anything realistic that was made up or changed? | radio Yes / No | "YouTube asks you to say so." |
| `videoPeople` | People in it | radio "Everyone you can recognise said yes" / "No one you can recognise" | — |
| `videoRights` | Rights | radio "It's all mine" / "I have permission for everything in it" | — |
| `aiDisclosure` | Help from AI | text | "A short note, in your words, if AI helped make it." |

**This trip outdoors**

| Key | Label | Control | Help |
| --- | --- | --- | --- |
| `activity` | What you did | text, suggestions Hike, Paddle, Field survey | — |
| `location` | Where | text | "An area name that's safe to share, like the Dolly Sods. Never a home or a private spot." |
| `locationPrivacy` | How much of the place readers see | radio: **Don't show it** (`hidden`, default), Just the area (`approximate`), The route without where it starts and ends (`trimmed`), The exact route (`exact`) | exact asks once: "Show the exact route? Anyone can see where you started and finished." **Show it** / **Keep it hidden** |
| `distanceKm` | Distance (km) | decimal | "A number, like 4.2." |
| `elevationGainM` | Climb (m) | decimal | same |
| `duration` | How long | text | "Like 2 hr 15 min." |
| `conditions` | Conditions | rows 3 | "Weather, trail, water, what you saw." |

### On the page

- **A line under the title** (one line, `maxlength` 200): "Shown under the title on your post. Optional." Writes `subtitle` (line breaks → spaces) and clears `subheading`/`dek` when it changes.
- **Part in <collection name>** (`inputmode=numeric`, only with a Collection; label follows it): "Which part this is, like 3. Leave empty to go by date." Whole number 1–9999, else "A whole number, like 3." Writes `seriesOrder` (or `series_order`/`part`).
- **Comments** (only when `meta.engagementSetUp`): **Open** (no key), **Show, but no new ones** (`locked`), **Hidden** (`hidden`). Help "Only this post. Comments are set up for your whole blog under Comments." Set up but not working (`!meta.engagement`): add "Comments aren't working right now, so nothing shows yet."

### In search and when shared

- **Summary** (rows 3, `maxlength` 500), writes `description` (or `summary`/`brief`/`excerpt`). Past 160: "Google usually shows about 160 letters; this has 212. The rest may be cut off." Never blocks. Empty: card shows the first lines in grey from G43's `excerpt` (until then "The first lines of your post.").
- **The card** (static `content-card`, live): site address › the post's address from `url` (G38; new post: "your blog's address"); title; summary clipped at 160 with "…"; cover thumbnail with its words as `alt` (none: no image). Under it: "Roughly how it looks. To see the real card, use See how it looks." (R7 replaces it with the real card.)
- **Words for a Pinterest Pin** (`details`, only with G39; open when either is set): "Only used when your blog sends a Pin. Leave them empty to use the title and summary." **Pin title** (`maxlength` 300; past 100 "Pinterest shows up to 100 letters; this has 112."), **Pin description** (rows 3; past 500 incl. Photo by: "Pinterest takes 500 letters, and the Photo by name counts; this has 530."). Writes `cardTitle`, `cardDescription`.

### Who wrote it

Reads `credits`, `creditEtag`, `creditError` from `GET document`; names from `GET contributors` (`author`, `contributors`), asked once on open (`skeleton-block` meanwhile).

| State (`creditState`) | Shows | Buttons |
| --- | --- | --- |
| No credit file | "Grammi" (`author.name`) + "The name your blog uses on every post." | **Change who wrote it** |
| A list | names in order | **Change who wrote it** |
| Empty list | "No one is named on this post." | **Change who wrote it** |
| `creditError` | `alert-banner warning` "Who wrote this post can't be read right now" / "Everything else saves as usual. Tell the person who set up your site." | none (repair in Details) |
| No author name | "Your blog doesn't have your name yet. Tell the person who set up your site." | **Change who wrote it** (if anyone is in People) |

**Change who wrote it** turns the group into an editor:
- Each line a `select-field` ("Person 1") over People; people already listed disabled. **Move up**, **Move down**, **Remove** ("Move Ruth up").
- **Add someone** (secondary) adds a line with the first unused person.
- **Add someone who isn't listed** → `#/people?from=<path>&add=1` (leave-guard asks if unsaved; drafts save first).
- **Just me** (link-styled): "Name only Grammi, as on your other posts?" **Yes** / **Keep the list**; **Yes** sends `credits: null`.
- Help: "The first name shows first. Everyone listed is shown as having written it." New lines get role Author (`crossref:author`); others' roles stay.
- Empty People: "Add the people who write with you first." **Open People**.
- Credits sent only when changed, with `creditEtag`, beside `fields` in the same request.
- Client check: "Choose who, or remove this line."

### Details for the person who set up your site

`details`, closed by default; opens from the palette; stays open per visit (sessionStorage `studio-about-details`).

| Row | Control | Words / rule |
| --- | --- | --- |
| Address | `text-field` "Address on your site", mono, live "Will be: grammishouse.com/pumpkin-bread/" | Editable only while new, or a draft with no `date` or a future one. Otherwise read-only: "The address stays as it is once a post may have been on your site, so saved links keep working." Empty = from the title. Sends `slug`. Over 80: "Shorter, please: 80 letters at most." Empty result: "An address needs at least one letter or number." Taken: G36 `slug-taken` |
| Old addresses | read-only `aliases`/`redirectFrom` | "These redirect here. Change them in the file." Hidden when none |
| First published somewhere else | url | "Only if this post first appeared on another site. Search engines then credit that one." Bad: "A full web address, starting with https://." Writes `canonical` (or `canonicalUrl`) |
| Theme | select: "Your blog's usual look" + `meta.themes` | writes `theme` |
| Picture address | url | sets `cover` to a web address |
| Pin title / description | as above | only without G39 |
| Kind (profile) | select, all six | |
| Research: DOI, License | text × 2 | research only. "DOI name or https://doi.org/ link." / "Full https:// address of the license." |
| Video: master file, caption files, YouTube title (≤ 100), YouTube description, season, episode, production credits | text | video only; checks from G40 |
| Roles, per person | `details` "Roles for Ruth (1)" → checkbox groups "Publishing roles" and "CRediT roles" from `meta.creditRoles` | at least one: "Give Ruth at least one role." Unknown: "Not recognised: credit:foo" ("Remove roles your blog doesn't know before saving.") |
| Name no one | `toggle-switch` "Name no one on this post" | sends `credits: []` |
| Broken credit file | `creditError` sentence + **Use the blog's usual name** (`null`) / **Start a new list** (`[]`) | required before any credit change; other fields save meanwhile |
| Also in this post | read-only `dl` of keys Studio doesn't edit | "Kept exactly as written." |
| File, Web address, Words, Last saved, File kept as written, Sending out, Scheduled posts | today's `postDetails` rows | "Scheduled posts" uses G37 |
| Time zone | "Times are in America/New_York (this computer). Your blog's server says it's 3:04 PM." | `Intl` + `meta.now` |
| Search engines | "Only drafts are kept out of search engines. A post can't be hidden from them on its own." | |

## When it appears: scheduling, unscheduling, taking it off

Fields unchanged (`date-field` "Date", time "Time (your time)"). Help follows the state:

| Situation | Help | Primary |
| --- | --- | --- |
| Empty | "Leave it empty to use the day you publish." | Publish |
| Future day, time empty | time fills with 8:00 AM; "It goes up at 8 AM unless you change the time." | Schedule |
| Future, G37 `schedule: "self"` | "It goes up by itself on Friday, November 27 at 8 AM, even with your blog closed." | Schedule |
| Future, `"next-send"` or unknown | "It's ready to go up on Friday, November 27 at 8 AM. Your blog puts it up the next time it's sent out after that." | Schedule |
| Past day, not published | "That day has passed, so it will show as published on Tuesday, March 3." | Publish |
| Published, moved to the future | "Your post comes off your site until Friday, November 27 at 8 AM." | Update (asks "Take it off until Friday, November 27?" **Yes, schedule it** / **Keep it up**) |
| Time without a day | error "Add the day too, or clear the time." | — |

- **Schedule:** status "Scheduled for Friday, November 27 at 8 AM"; toast the same, with `"next-send"` adding " It goes up the next time your blog is sent out after that."
- **Make it a draft again** (scheduled; replaces Save draft): `draft: true`, date kept. Toast "It won't go up on Friday. It's a draft again."
- **Take it off my site** (More, published): unchanged question; words after from `wentOutWords` `takenOff`.
- **Delete this post:** unchanged (Undo).

## Saving and errors

Sheet fields join `read()` as `about` values; `fieldsForSave` merges them under each post's own key (`aboutKeys(fields)`), `onlyChanges` sends just what changed; credits ride beside `fields`. Leave-guard, kept copies (`kept.js` now also keeps `about` and credits) and conflict flow unchanged.

**Client checks** run before any save (autosave too): a problem stops it; status "Not saved yet: one thing in About this post needs a look." with **Go to it** (opens the sheet, focuses the field with `error` + `aria-describedby`). Words stay in the kept copy.

**Server answers** by `code` (G36):

| Answer | Where | Her words |
| --- | --- | --- |
| 409 `changed` | Write | today's conflict choice |
| 409 `credits-changed` | Who wrote it | "Who wrote this post was changed on another computer." **Use that list** / **Keep mine** (resends with the new `creditEtag`) |
| 409 `exists` (new post) | Title | "There's already a post with this title. Change it a little and it will save." |
| 409 `exists` with `slug` | Address | "Another post already has this address. Add a word to it." |
| 413 `too-large` | Write | "This post is too long to save in one piece. Split it into two posts. Your words are kept on this computer." |
| 422 `slug-taken` | Address | "Another post already uses this address. Add a word to it." |
| 422 `date` | Date | "That date can't be read. Pick it from the calendar." |
| 422 `comments` | Comments | "Choose one of the three." |
| 422 `profile-field` + `field` | that field | Studio's words per field; otherwise "This doesn't look right. Check it against the help under it." |
| 422 `job.*` | About this job | R4 table |
| 422 `credit-unknown-person` | Who wrote it | "Someone on the list isn't in People any more. Choose someone else, or remove them." |
| 422 `credit-unknown-role` / `credit-no-role` | Roles | "Remove roles your blog doesn't know." / "Give everyone at least one role." |
| 422 `shared-order` / `shared-rebind` | Who wrote it | "This was written together with others, so who wrote each part can't change here." |
| 422 `alias` | Old addresses | "An old address in this post can't be used. The person who set up your site can fix it in the file." |
| 422 other | Write banner | "Something in this post stops your blog from building it. Tell the person who set up your site." (server sentence in details) |
| 404 | Write banner | "This post isn't on your blog any more. It may have been deleted on another computer." **Save it as a new post** / **Back to your posts** |
| 401 | shell | "Sign in again", work kept |
| 5xx / no answer | status | "Not saved yet. Your blog didn't answer; your words are kept on this computer. It tries again when you next change something." **Try again** |

## People (`#/people`)

- **Job:** "Who can be named on my posts?" **Title:** "People". **Lede:** "The people who write, cook or take photos for your blog. Choose them under Who wrote it on any post." **Primary:** **Add someone**. **Loads:** `GET contributors`.

```
400 px                                       Desktop: list 1fr, editing in a 26rem side-sheet
+------------------------------------------+
| Home > People                            |
| < Back to “Cornbread”                    |  only with ?from=
| People                                   |  h2
| The people who write, cook or take ...   |
| [ Add someone ]                          |
| +--------------------------------------+ |
| | Grammi                  [Your blog's | |  badge on the blog's own name
| | Your blog's usual name.     name]    | |  (author: read-only here)
| +--------------------------------------+ |
| | Ruth Nichols                         | |
| | ruthbakes.com                        | |
| | [ Change ]                 [More v]  | |  More: Remove…
| +--------------------------------------+ |
| > Details for the person who set up      |
|   your site                              |
+------------------------------------------+
```

- **Add someone / Change** (`side-sheet` "Add someone" / "Change Ruth Nichols"): **Name** (required: "Add their name."), **Their website** (optional url: "A full web address, starting with https://."). **Save** → "Saved. Ruth can be chosen on any post." With `?add=1&from=`, Save returns to the post with Ruth added. Mikey's details: **Id** (from the name on add, never changed: "Posts name them by this, so it doesn't change."), **Also at** (`sameAs` url list), **ORCID iD** (16 digits with check digit: "That isn't an ORCID iD.").
- **Remove…** (`modal-dialog`): "Remove Ruth Nichols?" / "She won't be offered on posts any more." **Keep her** (focused) / **Remove** → "Removed." with **Undo** (puts back only her, with the current etag).

| Code (G41) | Words |
| --- | --- |
| 409 `changed` | "People was changed on another computer. Here it is now; make your change again." (reloads) |
| 422 `named-on-posts` (`posts: [{path, title}]`) | "Ruth is named on 3 posts, so she stays for now. Take her off them first:" + links (`#/write/<path>?sheet=about`) |
| 422 `in-shared-reflection` | "Ruth wrote part of a reflection with others, so she stays." |
| 422 `named-in-sources` | "Ruth is named in your research notes, so she stays. The person who set up your site can change that." |
| 422 `invalid` | field-linked with `field`; else "That didn't save. Tell the person who set up your site." |

- **Details:** "Saved in `openblog.json` `contributors`. The blog's own name is `author` there." + raw JSON of the selected person.
- **Empty:** `empty-state` "No one else yet" / "Add the people who write with you, so you can name them on a post." **Add someone**.

## Copy it for another blog (More, posts with a path)

- **Job:** "Put this post on Medium (or another blog) too." `side-sheet` "Copy it for another blog".
- **Where to** (`select-field`): Medium, Ghost, Hashnode, DEV, WordPress, "A web page (HTML)", "Plain words".
- **Loads:** `POST preview` with the form as it stands → `portablePreview`.
- **Shows** the words as they'll go: sandboxed `iframe` for HTML, `pre` for text/Markdown, `tabindex 0`, named "What will be copied".
- **Primary:** **Copy** → "Copied. Paste it into Medium." Refused: "Select the words and copy them." Secondary **Download** (`pumpkin-bread.md` / `.html` / `.txt`) → "Downloaded."
- **Medium** adds "Medium can't take it directly. In Medium choose Import a story, or paste this in."
- **Differences:** "2 things look different there", one line each in Studio's words (G42), e.g. "The recipe card becomes a plain list.", "The checklist's boxes can't be ticked there." With a source range: **Go to it**. None: "It goes across as it is."
- **Unsaved:** "This copies what's on your screen, including changes not on your site yet."
- **Details:** capability id, level, representation, destination policy, tag plan, source revision; **Mark as checked** per warning → `POST portability/acknowledge` → "Marked as checked for this version." Stale: "Checked for an earlier version; check again." 409: "Changed on another computer; showing it again."

## What each owner sees

| | Grammi / Dana | Mikey |
| --- | --- | --- |
| Kind | Story / Recipe / Job | all six; unknown id kept |
| Address | the card's address | editable `slug` while never live; aliases |
| Search | Summary, card | key used, canonical, theme, "no per-post noindex" |
| Who wrote it | names in order | roles, empty list, broken-file repair |
| People | name, website | id, sameAs, ORCID, etag |
| When | "Friday at 8 AM"; truth from G37 | time zone, server `now`, `nextDue` |
| Copy | where, Copy, Download, differences | diagnostics, policies, Mark as checked |
| Everything else | nothing | "Also in this post", read-only |

## Rules each part uses (static imports, DOM-free, tested)

| Part | File | Functions |
| --- | --- | --- |
| Sheet values | new `parts/about-rules.js` | `ABOUT_KEYS`, `aboutKeys(fields)`, `aboutFromDocument`, `aboutToFields`, `aboutLine`, `slugEditable(state, date, now)`, `slugPreview`, `aboutProblems(about, profile)`, `kindChange(from, to, body)` |
| Profiles | new `parts/profile-words.js` | `PROFILE_GROUPS`, `kindChoices(meta, current)` |
| Credits | new `parts/credit-rules.js` (lifted from `admin.js`) | `normalizeCreditDraft`, `toggleCreditRole`, `moveCredit`, `validateCreditDraft`, `creditHasAuthor`, `creditState`, `creditsToSend(before, after)` |
| Scheduling | `parts/post-fields.js`, `parts/dates.js` | `whenHelp(state, date, schedule, now)`, `defaultTime(date, time, now)` |
| People | new `parts/people-rules.js` | `newId(name, taken)`, `orcidOk`, `peopleProblem(error)` |
| Copy | new `parts/portable-rules.js` (lifted) | `portablePreviewArtifact`, `portabilityGroups`, `portabilityAcknowledgementScope`, `portabilitySourceSelection`, `previewDestinationPolicy`, `differenceWords` |
| Errors | `parts/write-trouble.js` | `saveProblem(error)` → `{field, words, where}` |

- **Port:** `admin-credits*` → `studio-credit-rules`; `admin-profile*` → `studio-about-rules`; `admin-portable*`/`admin-portability*` → `studio-portable-rules`; `admin-contributors` → `studio-people-rules`; browser `credits`, `profiles`, `portable-export`, `contributors` specs → `studio-about.spec.mjs`, `studio-people.spec.mjs`, `studio-copy.spec.mjs`.
- **New:** a post with `summary:` keeps `summary:`; `subheading:` cleared when the subtitle changes; story → recipe → story keeps `yield`; credits never sent unless changed; a broken credit file doesn't block saving the title; address read-only for a draft with a past date; a future day with no time sends 08:00 with her offset; the sheet never shows `job.*`; Grammi's site shows no Job choice.

## Accessibility and keyboard

- **Write order:** title, numbers/About this job, words, When, Tags, Collection, Cover (words, Photo by), **About this post**, bar.
- **Sheet order:** heading, kind, profile group, On the page, In search and when shared, Who wrote it, Details, footer status, **Done**.
- Focus to the heading (or the asked-for group's first field); Escape and × return focus to the opener. Ctrl/⌘ S saves from inside; Ctrl/⌘ Enter publishes.
- **Palette:** "About this post", "Summary for search and sharing", "Who wrote it", "More about this recipe", "Details for the person who set up your site", "Copy it for another blog", "People".
- Radio groups use arrow keys. Credit buttons have full names ("Move Ruth Nichols up"); after moving, live region "Ruth Nichols is now number 1 of 2." and focus follows.
- Counters `aria-live="polite"`, spoken only when crossing a limit.
- Errors: `text-field error` + `aria-describedby`; a failed save focuses the first problem field, opening the sheet if needed.
- **320 px:** full-screen sheet with sticky footer; choice cards stack; the card wraps with the thumbnail above; no sideways scroll; controls ≥ 44 px. Reduced motion: no slide.
- **Zubra:** `side-sheet`, `radio-group`, `choice-cards`, `text-field`, `select-field`, `toggle-switch`, `date-field`, `content-card`, `status-badge`, `alert-banner`, `action-button`, `dropdown-menu`, `modal-dialog`, `toast-region`, `skeleton-block`, `empty-state`, `breadcrumb-trail`, `file-drop`, `command-palette`. If `radio-group`/`choice-cards` still aren't vendored, re-vendor them from zubra-ui, or use the native `fieldset` fallback from R2 (noted, not a fork). The copy preview `iframe` uses `sandbox` without `allow-same-origin`.

## Safety

- Every value (names, summaries, server sentences, diagnostics, "Also in this post") is `textContent`. Copy preview iframe `sandbox="allow-scripts"` only, `srcdoc` escaped as the old Admin did.
- Credits sent only on change, always with `creditEtag`.
- A field journal's exact route asks first; the server still strips `route` unless `exact`.
- The address is never editable once a post may have been seen; no file is ever moved.
- A removal the server refuses changes nothing; Undo writes back only the person removed, with the current etag.

## Gaps

- **G36. Codes on `document` errors:** 409 `changed`, `credits-changed`, `exists` (+ `slug: true`), `credit-file-exists`; 413 `too-large`; 400 `bad-request`, `bad-path`; 422 `{error, problems: [{field, code, message}]}` with `slug-taken`, `date`, `comments`, `profile-field`, `job.*` (R4 G32), `credit-unknown-person`, `credit-unknown-role`, `credit-no-role`, `credit-duplicate`, `shared-order`, `shared-rebind`, `alias`, `build`. Strings stay as `message` for one release.
- **G37. Scheduled posts that go up by themselves:** `tick_scheduler`'s rebuild calls `auto_publish("Publish scheduled post <title>")` when publishing is automatic. `meta.schedule`: `"self"` when this server rebuilds and sends out (or serves the site), `"next-send"` when the live site is built elsewhere, `null` when unknown. The build reply's `nextDue` also appears in `GET publish`.
- **G38. `GET document` gains** `url`, `status` (`draft|scheduled|published|error`), `slug` (resolved).
- **G39. `meta.siteUses.pinterest`:** true when `syndication.pinterest.enabled`.
- **G40. Profile fields in `meta.profiles`:** `kind` gains `url`, `path`, `choice` with `choices: [{value}]` for `productionStatus`, `locationPrivacy`, `videoRights`, `videoPeople`, `madeForKids`, `syntheticMedia`; plus `max` (`videoTitle` 100).
- **G41. Codes on `PUT contributors`:** 409 `changed`; 422 `named-on-posts` with `posts: [{path, title}]`, `in-shared-reflection`, `named-in-sources`, `invalid` with `field`.
- **G42. Portable diagnostics carry `code`** (keep `message`). Until then: "1 thing looks different there." with the message in Details.
- **G43. `excerpt`** in `POST preview` (or `GET document`): the 180-letter excerpt the engine would use.
- **Not gaps:** `credits`/`creditEtag` on `document` POST/PUT; `contributors` GET/PUT; `portability/acknowledge`; `meta.profiles`, `themes`, `creditRoles`, `engagementSetUp`.

## Risks to test before release

- A Grammi post from the old Admin with `summary:`, `dek:`, `prep:`: changing only the summary rewrites one line (`layout: kept`).
- A legacy `recipe: true` post switched to a story writes `profile: article`; switching back restores the card.
- Credits changed in two tabs: the second gets `credits-changed`; neither list is lost.
- A post scheduled for 8 AM on a site built by GitHub Actions says "the next time it's sent out".
- A US time zone, future day, empty time: goes up at 8 AM local.
- iPhone at 320 px: full-screen sheet, keyboard over the sticky footer, Escape from a hardware keyboard.
- Removing a person named on posts: refused with links; nothing changes.

## Docs and release note

- Rewrite `docs/admin.md` §Scheduling, settings, Contributors and portable output for About this post, People, Copy it for another blog. Note in `docs/content.md` that `noindex` is not a post field.
- **Release note (Mikey):** every post setting is in Write's **About this post** (technical ones under its details); addresses can't change once a post may have been seen; Contributors is now **People**; future days default to 8 AM; portable output is **Copy it for another blog**.

## Changes to `studio-ux` (adopted)

- Banned on her layer, beside "deploy": slug, front matter, metadata, canonical, noindex, profile, credits, contributor, SEO. She hears "address", "summary", "what kind of post", "who wrote it".
- **One place per fact:** a field shows in one spot on her layer; a profile shows only its own fields, never twice.
- **Settings are part of the thing they describe:** a sheet of a post's settings has no Save of its own; it saves with the post and says how.
- **Times she picks are complete:** a future day with no time gets a visible default time. A promise about when something happens is made only when the system keeps it.
- Review checklist: "Every field the old screen edited is on her layer, in details, or dropped with a written reason."
