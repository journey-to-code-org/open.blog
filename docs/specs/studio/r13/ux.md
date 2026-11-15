# Studio UX, retirement slice R13: Reading paths and readings side by side

By `studio-ux`, 2026-11-14. Sources: `studio-ux`, `studio-architecture`, `words/spec.md` (ids, `say()`, `{helper}` `{product}` `{owner}`, persona rule, `HER_BANNED`), `docs/studio-words.md`, `retirement-plan.md` (§1 F rows `#/comparisons`, `#/paths`; §1 H; §2 test rules; §4 R13 "two more kinds in the Pages/Collections pattern"; Decided 2: `reading-paths/reorder` deleted, no rename; Decided 5), `r11/ux.md` (R11/R12: research gate G92, area tabs, `researchProblem`, kept forms, What readers see, Compare = alignments), `r6/ux.md` (cards, Alt+arrow moves), `r5/ux.md` (Publish/Update words, sheets save with the thing); old Admin `web/admin/admin.js`: path helpers l.10780–10977 (`pathFollowedIndex` … `readingPathListText`), comparison helpers l.10979–11200 (`comparisonDraft` … `comparisonLeftOutText`), nav l.11777–11831, `showReadingPaths`/`showReadingPathList`/`showReadingPathEditor` l.12923–13570, `showComparisons`/`showComparisonList`/`showComparisonEditor` l.15183–16110, `BOUNDARY_PROJECTIONS` l.8411; Admin API `admin.rs` l.1022–1058, `admin/reading_paths.rs` (`list`, `targets`, `get`, `preview`, `save`, `remove`; `reorder` deleted), `admin/comparisons.rs` (`list`, `references`, `get`, `preview`, `save`, `decide`, `remove`, `settle_approvals`), `reading_path_store.rs` / `comparison_store.rs` (`delete` → `.openblog/trash`); core `reading_path.rs` (`Relationship`, `Difficulty`, `MAX_*`, `check_steps`, `DiagnosticKind`), `scholarly_comparison.rs` (`Level`, `RelationKind`, `Certainty`, `Attribution`, `Standing`, `WithheldReason`, `JUDGEMENT_FIELDS`, `ExplanationMode`, `Withdrawal`, `MAX_*`), `config.rs` (`readingPaths.publish`, `interpretations.publish`); docs `interpretation-comparisons.md`, `configuration.md` l.493–510, `admin.md` l.857–890, ADRs 0207–0215, 0226–0234; tests `tests/web/admin-{reading-paths,comparisons}.test.mjs`, browser `reading-paths.spec`, `interpretation-comparisons.spec`; Studio `router.js` (`NOT_YET`, `legacyRoute`), `screens/landing.js` (explicit Save, Undo), `screens/decorations.js` (Alt+Shift+arrow), `parts/conflict.js`, `parts/undo.js`.

**Studio is a product.** Every string below is a word id read with `say(id, vars)`; personas judge screens and never appear in defaults. Wireframe data ("Start here", "Plato's cave") is data.

## Who this is for

- **The non-technical owner** (recipes, family stories): may want **a reading path**: "read these four posts in this order, and here's why". She never sees readings side by side (it is research).
- **The trade owner** (a roofer): same as above ("Before your new roof: read these three"), nothing more. Paths are hers only once her site has one (⚑ 1).
- **The research owner**: both. Paths may include public atlas entries; **readings side by side** lives in Research beside Compare.
- **The developer:** the file as written (old "Edit as source"), step and item keys, relationship values, trash names, the two switches (`readingPaths.publish`, `interpretations.publish`), the server's own sentences. One step deeper, under **For {helper}** (`common.forHelper`).

**The jobs.** "Give readers a route through my posts, and say why each comes next." "Set the readings of one subject side by side, fairly, and say who holds each." After R13 nothing about paths or comparisons opens the old Admin.

**Decisions the owner should check** (⚑ where they appear):
1. ⚑ **Reading paths show where they're used** (G96 `meta.siteUses.paths`: a path exists, or `readingPaths.publish` is on). Otherwise the only door is Find › **Make a reading path** (her layer, always listed). Nav: **Reading paths** after Collections.
2. ⚑ **The old "Interpretation comparisons" are called "Readings side by side"** (tab **Readings**, one item "a comparison of readings"), inside Research, gated by G92. "Compare" stays R12's alignments ("versions of a passage"). §One place per fact.
3. ⚑ **Explicit Save** (Front page pattern), not autosave: both are public pages, and a published path would change under readers on each keystroke. A draft says **Save draft** / **Publish**; a published one **Update**. Leaving with changes asks.
4. ⚑ **Order is saved by saving the whole path** (`PUT reading-paths` with every step in order and the revision read). The deleted `reorder` route is not wired and `readingPathOrder` is not lifted. A move changes only the draft until Save.
5. ⚑ **No drag.** Reorder is **Move** (menu on each card) and Alt+Shift+↑/↓/Home/End on a focused card, on every device. One way, fully keyboard, no hidden gesture to test.
6. ⚑ **A reason held by a step that became first is kept until Save, then Save asks once** ("Save without the reason for “{title}”?"); Undo after the save brings it back (G97).
7. ⚑ **Approval is read, not ticked:** **Read and approve** opens a dialog showing the *saved* words (from the server), and **Approve these words**. With unsaved changes it first offers **Save now**. Studio never builds or carries an approval.
8. ⚑ **Undo for every save, publish, approve, withdraw and delete** through G97 (the server keeps the replaced file in its trash and puts it back byte for byte, approvals included). Until G97: paths Undo by re-sending the previous copy; comparisons whose previous copy holds an approval ask once instead.
9. ⚑ **Explanation details the old Admin never edited stay in the file** (authors, before-reading note, reading modes, language, translation of, revision, withdrawal): shown read-only on the card, named in details. Same rule as R11 ⚑ 9.
10. ⚑ **R12's word `compare.approvedNotPublished` changes** from "...doesn't publish comparisons yet" to "...doesn't publish aligned passages yet", so "comparison" means one thing on her layer.

## One place per fact: three ways to "compare"

| Thing | What it is | Where (only there) | Public address | Switch |
| --- | --- | --- | --- | --- |
| **Alignment** (R12 Compare) | Places in versions of one passage, side by side | Research › **Compare** `#/research/compare` | `/comparisons/<id>/` | `comparisons.publish` |
| **Comparison of readings** (R13) | Attributed readings of one subject, with explanations by audience | Research › **Readings** `#/research/readings` | `/interpretations/<slug>/` | `interpretations.publish` |
| **Interpretation in the library** (R11) | Who read one located place; never published | Your research (Write), Compare members | none | none |

- Each tab's lede says what it is not: `readings.notCompare` "To read versions of one passage side by side, use Compare." and R12 Compare gains `compare.notReadings` "To set readings of a subject side by side, use Readings."
- What readers see (R12) lists both kinds plus Reading paths, each with **Open it** to its R13 screen; the item's public preview lives only in its editor.
- A reading path is not a Collection: `paths.notCollection` "A collection keeps posts that belong together. A reading path is an order to read them in, with why each comes next. A post can be on many paths." on the empty state and in Collections' help.

## Navigation and routes

| Job | Lands in | Route | Replaces |
| --- | --- | --- | --- |
| See my reading paths | **Reading paths** | `#/paths` | old `#/paths` |
| Make one | path editor | `#/paths/new` | old `#/paths/new` |
| Change one | path editor | `#/path/<slug>` | old `#/paths/edit/<slug>` |
| See my comparisons of readings | **Readings** (Research tab) | `#/research/readings` | old `#/comparisons` |
| Make / change one | readings editor | `#/research/readings/new`, `#/research/reading/<slug>` | old `#/comparisons/new`, `/edit/<slug>` |

(`new` is a valid slug, so one item uses the singular route.)

- **`legacyRoute`:** remove `comparisons` and `paths` from `NOT_YET`. `#/paths/edit/<slug>` → `#/path/<slug>`; `#/paths`, `#/paths/new` are Studio's own (null); `#/comparisons` → `#/research/readings`; `#/comparisons/new` → `#/research/readings/new`; `#/comparisons/edit/<slug>` → `#/research/reading/<slug>`; any other `#/paths/…` → `#/paths`, `#/comparisons/…` → `#/research/readings`. Query kept. An address always opens its screen, gate or not (it is the developer's door).
- **Nav:** **Reading paths** (`paths.nav`) when `meta.siteUses.paths`. Research area tabs gain **Readings** (`research.tabReadings`) after Compare; under 30rem the tabs stay a `select-field`.
- **Find:** always "Make a reading path" (`paths.findMake`); with paths: "Reading paths"; in a path: "Add a step", "See what readers will see", "Save", "Show the path as written (for {helper})". With research: "Readings", "New comparison of readings"; in one: "Add a reading", "Add a relation", "Add an explanation", "See what readers will see", "Show the comparison as written (for {helper})". "Undo: {last}" while a toast offers it.
- **Getting back:** breadcrumb `Home > Reading paths > {title}` / `Home > Research > Readings > {title}`; **‹ All reading paths** / **‹ All comparisons of readings** above the title; sheets close with ✕/Escape to their opener.

## Flows

```
Reading paths ──[Make a reading path]──> editor: Title (address suggested) ──[Add a step]── pick a post
     │                                    ──[Add a step]── second post ──> its card asks "How it relates" + "Why it follows"
     │                                    Move (menu / Alt+Shift+arrows) · Change (sheet) · Take it out (Undo)
     │                                    [See what readers will see] (sheet at 400 px, column on desktop)
     │                                    [Save draft] / [Publish] ──> "Published. Readers see it at /paths/x/ ..." Undo
     └── a path ── More: Make it a draft again · Delete (Undo) · Show the path as written (for {helper})

Research › Readings ──[New comparison of readings]──> Title, What they're about
     ──[Add a reading]── sheet: who holds it, how firmly, what it holds, what's uncertain, evidence, drafted with AI?
     ──[Add a relation]── "This reading … differs from … that reading"
     ──[Add an explanation]── for beginners / students / scholars, about the whole or one reading
     [Save draft] ──> AI-drafted card: [Read and approve] ──dialog (saved words)──> "Approved." Undo
     [Publish] ──> "Published." or "Saved, but readers can't see it yet: two readings must be your own words or approved."
```

## Inventory: every feature the old Admin had

| Old Admin | API | Decision | Layer |
| --- | --- | --- | --- |
| **Paths list**: title, Published/Draft, step count, "not shown yet", unreadable file with first problem | `GET reading-paths` | list rows, words by ids | her (problem text in details) |
| List: "site does not publish paths" notice naming `readingPaths.publish` | `publish` | `paths.siteOff` + `common.tell`; switch name in details | her / dev |
| List: targets couldn't be read | `targetsProblem` | `paths.targetsTrouble` banner; server text in details | her / dev |
| New reading path | `POST reading-paths` | **Make a reading path** (primary) | her |
| Title (120) | | Title, counter near limit | her |
| Address name, fixed after create | `slug` | **Address**, suggested from the title (`suggestAddress`), **Change** until first save, then a plain line; no rename (Decided 2) | her |
| Summary (600) | | **A line about this path** | her |
| Status select | `status` | **Save draft** / **Publish** / **Update** / More › **Make it a draft again** ⚑ 3 | her |
| Listed checkbox | `listed` | toggle **Show it in lists and search** (help: still at its own address) | her |
| Add step: published posts + public atlas entries, already-used hidden, 100 max | `GET reading-paths/targets` | **Add a step** sheet: search + list (posts; atlas entries group on research sites) | her |
| Step title, state badge | preview `states` | card heading + `status-badge` in words | her |
| Move up / Move down, announced, focus kept | — | **Move** menu + keys ⚑ 5; order saved by Save ⚑ 4 | her |
| `reading-paths/reorder` (no caller) | deleted | **drop** (Decided 2) | — |
| Remove step | — | **Take it out** + Undo | her |
| Held reason on a step moved first | — | kept in memory, card note, Save asks ⚑ 6 | her |
| Relationship (7 kinds) + "It follows step n" | `relationships` | **How it relates** (`choice-cards` of ids); "influenced" only between two atlas entries | her |
| Why it follows (600, required) | | **Why it follows, in your words** | her |
| Basis (atlas relationship id) for "influenced" | | **Which atlas link says so**: picker (G100); until G100 a text field with its help | her |
| Rationale, prerequisites (400), difficulty, optional | | **Why it's on the path**, **What to know first**, **How hard** (3 ids), **A side step readers may skip** (not the first) | her |
| Step id (auto) | `readingPathStepId` | automatic; details | dev |
| Problems list with "Go to step" | `problems` | errors on the step card and field; banner with links ⚑ G98 | her (+ server text in details) |
| Preview "What readers will see": title, summary, steps with reason, kind, optional, difficulty, before-you-start; draft note; withheld | `POST reading-paths/preview` `projection` | **See what readers will see** | her |
| "For you only: why readers do not see some steps" | `projection.diagnostics` | **Only you see this** list, by step | her (kinds in details) |
| Refresh preview | | **drop**: refreshes 600 ms after a change and after Save; Find "See what readers will see" | — |
| Edit as source / Check source / Back to the form | `preview` `source`, save `source` | **Show the path as written (for {helper})** in More | dev |
| Unreadable file opens in source mode | `valid: false` | `paths.unreadable` + `common.tell`; the as-written view opens for the developer | her / dev |
| Conflict: load newer / keep mine | 409 `conflict`, `current` | `askWhichToKeep` (`parts/conflict.js`) | her |
| Move to trash (confirm) | `DELETE reading-paths` | More › **Delete** + Undo ⚑ 8 | her |
| **Comparisons list**: status, counts, AI drafts waiting, not shown yet, unreadable | `GET comparisons` | Readings list | her |
| Research files unreadable | `researchProblem` | `readings.researchTrouble` | her / dev |
| Title, address, subject (neutral), status | | **Title**, **Address**, **What the readings are about** (help: neutral words) ⚑ 3 | her |
| Reading: attribution (named / source / anonymous), who, certainty | `attribution` | **Who holds it**: three choices; name, source picker or description; **How firmly it's theirs** | her |
| Statement (4000), uncertainty (1000), language | | **What this reading holds**, **What's uncertain**, **Language, if not the blog's** (`combo-box` of tags) | her |
| `translationOf` on a reading | file | read-only "Translates {reading}"; field in details ⚑ 9 | her / dev |
| Evidence: link or source + place, states public/private/missing | `references`, `states.evidence` | **Evidence** rows with state words; picker labelled (G101) | her |
| Drafted by AI + tool name; standing | `origin`, `standing` | **An AI tool drafted these words** + **Which tool**; standing badge | her |
| Approve this exact text / Withdraw approval; "save first" hint; unpublish confirm | `comparisons/approve`, `revoke` | **Read and approve** dialog ⚑ 7; **Withdraw approval** (asks when published) | her |
| Approval "by {user} at {time}" | `approval` | "You approved these words on {date}." (user in details) | her / dev |
| Move / remove reading (cascades relations, explanations' about, translations) | — | Move, **Take it out** + Undo restoring the cascade | her |
| Relations (from, kind ×4, to, note) | `relations` | **How the readings relate** rows | her |
| Explanations: level, about, text (6000), evidence, AI, approve, move, remove | `explanations` | **Explanations by audience** cards + sheet | her |
| Explanation authors, prerequisite, modes, language, translationOf, revision, withdrawn | file only | read-only line on the card ⚑ 9 | her / dev |
| Notes "Evidence to check" (never blocking) | `notes` | `readings.checkEvidence` list in the preview | her |
| Preview: attribution, certainty, statement, uncertainty, provenance, evidence count, explanations | `projection.public` | **See what readers will see** | her |
| "For you only: what readers do not see" (7 reasons; old lacked `withdrawn`) | `projection.leftOut` | **Only you see this** with 8 reason ids | her |
| Saved with approvals withdrawn | `approvalsWithdrawn` | `readings.approvalDropped` status | her |
| Source mode (approvals kept, never added) | | **Show the comparison as written (for {helper})** | dev |
| Conflict, delete | 409, `DELETE` | as paths | her |
| Portable copies (`portable.html/md/txt`) | build only | **drop** here: the old Admin had none; R5's portable output is for posts | — |
| Nav tabs "Reading paths", "Comparisons" in Content; Simple-preset hiding | — | nav item / Research tab by gate ⚑ 1, 2 | — |

## Reading paths (`#/paths`)

- **Job:** "Which routes through my posts do readers have?" **Primary:** **Make a reading path**.
- **Loads:** `GET reading-paths` (one call: rows, `publish`, `shown`, `targetsProblem`).

```
400 px                                         Desktop (>= 48rem): one 44rem column; rows as a data list
+------------------------------------------+
| Home > Reading paths                     |
| Reading paths        [Make a reading path]|  h2 paths.title, primary
| An order to read your posts in, with why |  paths.lede
| each comes next.                         |
| ! {Product} doesn't show reading paths   |  alert-banner info, only when publish off
|   yet. Tell {helper}.                    |
| Start here                     (On your blog) |  row: link + status-badge
|   4 steps                                |
| Pie basics                         (Draft)|
|   2 steps                                |
| Holiday baking         (Not shown yet)   |
|   3 steps · a step isn't on your blog    |
| winter-x          (Can't be read)        |  invalid: name = address, Tell {helper}
+------------------------------------------+
```

- Empty: `empty-state` `paths.emptyTitle` "No reading paths yet" / `paths.emptyText` "Choose posts already on {product} and put them in the order to read them." + `paths.notCollection` + **Make a reading path**.
- Row menu (`dropdown-menu`, "More for {title}"): **Open it**, **See it on {product}** (only when shown), **Delete** (+ Undo).

## A reading path (`#/paths/new`, `#/path/<slug>`)

- **Job:** "In what order should readers go, and why?" **Primary:** **Publish** (draft or new) / **Update** (published). **Save draft** secondary.
- **Loads:** `GET reading-paths/targets` and, for one, `GET reading-paths/path?slug=` (parallel). Preview: `POST reading-paths/preview` 600 ms after the last change, one in flight, only the newest answer applied.

```
400 px                                          Desktop (>= 70rem): editor 40rem | preview 26rem (sticky)
+------------------------------------------+    +---------------------------+-------------------------+
| ‹ All reading paths                      |    | ‹ All reading paths       | What readers will see    |
| Start here               [More v]        |    | Start here      [More v]  | Start here               |
| Draft · not on {product} yet             |    | Title [Start here______]  | Begin with the basics... |
| Title  [Start here___________________]   |    | Address /paths/start-here/| 1 Pie crust 101          |
| Address /paths/start-here/      [Change] |    | A line about this path    | 2 Fillings — Builds on   |
| A line about this path (optional)        |    | [___________________]     |   step 1: "Once the..."  |
| [Begin with the basics, then...______]   |    | [x] Show it in lists...   | -- Only you see this --  |
| [x] Show it in lists and search          |    | Steps (3)                 | Step 3 is a draft, so    |
| Steps (3)                                |    | 1 Pie crust 101   [Move v]|   readers skip it.       |
| +--------------------------------------+ |    |   ...                     |                         |
| | 1  Pie crust 101       (On your blog)| |    |                           |                         |
| |    Where every reader starts.        | |    |                           |                         |
| |    [Change] [Move v] [Take it out]   | |    |                           |                         |
| +--------------------------------------+ |    |                           |                         |
| | 2  Fillings            (On your blog)| |    |                           |                         |
| |    Builds on step 1: “Once the crust | |    |                           |                         |
| |    is right, choose what goes in.”   | |    |                           |                         |
| |    [Change] [Move v] [Take it out]   | |    |                           |                         |
| +--------------------------------------+ |    |                           |                         |
| | 3  Lattice tops   (Draft: readers    | |    |                           |                         |
| |    won't see this step)              | |    |                           |                         |
| |    ! Say why it follows. [Change]    | |    |                           |                         |
| +--------------------------------------+ |    |                           |                         |
| [ Add a step ]                           |    |   [Add a step]            |                         |
| [See what readers will see]              |    |   [Save draft] [Publish]  |                         |
| [Save draft]               [ Publish ]   |  sticky bar (studio-write-bar)
+------------------------------------------+    +---------------------------+-------------------------+
```

- **Card:** `content-card`, h3 "Step {n} of {count}: {title}", `status-badge` (state words), the reason line (`paths.follows` "{relation} step {n}: “{why}”") or `paths.firstStep` "Where every reader starts.", optional/difficulty chips, its error. Buttons **Change** (sheet), **Move** (`dropdown-menu`: Move up, Move down, Move to the top, Move to the end; impossible ones absent), **Take it out**.
- **Step sheet** (`side-sheet`, "Step {n}: {title}", footer **Done**, line `paths.savesWithPath` "Saves with the path."): **How it relates to step {m}: {title}** (`choice-cards`, the 7 ids; "influenced" only atlas → atlas), **Why it follows, in your words** (required after the first), **Which atlas link says so** (influenced only), **Why it's on the path** (optional), **What to know first** (optional), **How hard** (Not said / Introductory / Intermediate / Advanced), **A side step readers may skip** (toggle; absent on step 1 with `paths.firstNotOptional`). "Follows" is always the nearest earlier required step (`pathFollowedIndex`).
- **Add a step sheet:** `text-field` "Find a post"; list of published posts (newest first), then **Atlas entries** (research sites); each row "Add" → appended as last step, sheet stays open with status `paths.added` "Added “{title}” as step {n}. Say why it follows." (focus to the new card's Change after close). Not offered: drafts, scheduled, private entries, steps already in the path; `paths.onlyPublished` "Only posts already on {product} can be steps." Full: `paths.full` "A path holds at most {max} steps."
- **Held reason ⚑ 6:** a step moved to first keeps its why in memory; card note `paths.heldReason` "The first step doesn't say why it follows. Your words are kept here until you save; move it down to keep them." Save → `ask` `paths.dropReasonTitle` "Save without the reason for “{title}”?" / **Save without it** / **Go back** (focused).
- **Preview** (column ≥ 70rem, else **See what readers will see** opens a sheet): server projection as text; `paths.asPublished` "This is a draft. Here is how it would read once published."; withheld `paths.withheld` "Readers can't see this path yet: it needs at least two steps on {product}, and every step must follow one that's there."; `paths.onlyYou` "Only you see this" with one line per diagnostic (`stepUnavailable` → `paths.diagStep` "Step {n} isn't on {product}, so readers skip it."; `transitionDropped` → `paths.diagReason` "Step {n}'s reason can't be shown as written, so the path is held back."; `pathWithheld` → `paths.withheld`) and `paths.neverTold` "Readers are never told a step was left out."; no signal: `paths.previewNoSignal`. Shown and published: **See it on {product}** (link to `projection.public.url` when it matches `^/paths/[a-z0-9-]+/$`).
- **More:** **Make it a draft again** (published only; Undo), **Delete**, **Show the path as written (for {helper})**.

### Words (`parts/path-words.js`, `layer: "her"` unless marked)

| Id | Default |
| --- | --- |
| `paths.nav` / `paths.title` / `paths.lede` | Reading paths / Reading paths / An order to read your posts in, with why each comes next. |
| `paths.findMake` / `paths.make` | Make a reading path / Make a reading path |
| `paths.siteOff` | {product} doesn't show reading paths yet. You can make and save them now; readers see them once it does. |
| `paths.targetsTrouble` | Your posts couldn't be read just now, so every step shows as not on {product}. Nothing changed. |
| `paths.rowSteps` / `paths.rowOneStep` | {count} steps / 1 step |
| `paths.state.shown` / `.draft` / `.notShown` / `.unreadable` | On {product} / Draft / Not shown yet / Can't be read |
| `paths.notShownWhy` | A step isn't on {product}, so readers can't see this path yet. |
| `paths.emptyTitle` / `paths.emptyText` / `paths.notCollection` | (above) |
| `paths.titleLabel` / `paths.addressLabel` / `paths.addressHelp` / `paths.addressFixed` | Title / Address / Lowercase letters, numbers and dashes. It can't change after the first save. / Its address can't change. |
| `paths.summaryLabel` / `paths.listedLabel` / `paths.listedHelp` | A line about this path / Show it in lists and search / When it's off, the path is still at its own address. |
| `paths.stepsHeading` / `paths.stepHeading` | Steps ({count}) / Step {n} of {count}: {title} |
| `paths.firstStep` / `paths.follows` | Where every reader starts. / {relation} step {n}: “{why}” |
| `paths.step.published` / `.draft` / `.scheduled` / `.missing` / `.private` / `.unchecked` | On {product} / Draft: readers won't see this step / Scheduled: readers won't see this step yet / Gone: this post isn't on {product} any more / Private: readers won't see this atlas entry / Not checked yet |
| `paths.rel.next` / `.background` / `.buildsOn` / `.contrastsWith` / `.respondsTo` / `.applies` / `.influenced` | Comes next / Gives background for / Builds on / Contrasts with / Responds to / Puts into practice / Was influenced by |
| `paths.relHelp.next` … `.influenced` | No other link claimed. / … / Only when a published atlas link says so. Order and dates never mean influence. |
| `paths.relateLabel` / `paths.whyLabel` / `paths.basisLabel` / `paths.basisHelp` | How it relates to step {n}: {title} / Why it follows, in your words / Which atlas link says so / Until the list is here: the atlas link's key, from Atlas. |
| `paths.rationaleLabel` / `paths.prereqLabel` / `paths.hardLabel` / `paths.hard.none` / `.introductory` / `.intermediate` / `.advanced` | Why it's on the path / What to know first / How hard, in your judgement / Not said / Introductory / Intermediate / Advanced |
| `paths.optionalLabel` / `paths.firstNotOptional` | A side step readers may skip / The first step is where every reader starts, so it can't be skipped. |
| `paths.savesWithPath` / `paths.done` | Saves with the path. / Done |
| `paths.addStep` / `paths.findPost` / `paths.groupPosts` / `paths.groupEntries` / `paths.added` / `paths.onlyPublished` / `paths.full` / `paths.nothingLeft` | Add a step / Find a post / Posts / Atlas entries / (above) / (above) / (above) / Everything on {product} is already on this path. |
| `paths.move` / `.moveUp` / `.moveDown` / `.moveTop` / `.moveEnd` / `paths.moved` | Move / Move up / Move down / Move to the top / Move to the end / Moved “{title}” to step {n} of {count}. |
| `paths.takeOut` / `paths.takenOut` | Take it out / Took out “{title}”. {count} steps left. |
| `paths.heldReason` / `paths.dropReasonTitle` / `paths.dropReasonText` / `paths.dropReasonYes` | (above) / (above) / The first step follows nothing, so its reason isn't saved. You can bring it back with Undo. / Save without it |
| `paths.saveDraft` / `paths.publish` / `paths.update` / `paths.unpublish` / `paths.delete` | Save draft / Publish / Update / Make it a draft again / Delete |
| `paths.savedDraft` / `paths.published` / `paths.updated` / `paths.unpublished` / `paths.deleted` | Saved as a draft. / Published. Readers see it at {address}. / Updated. Readers see the new order in about a minute. / It's a draft again. Readers no longer see it. / Deleted “{title}”. |
| `paths.publishedHidden` | Published, but readers can't see it yet: {why} |
| `paths.publishedSiteOff` | Saved as published. {product} doesn't show reading paths yet, so readers can't see it. |
| `paths.see` / `paths.seeOnBlog` / `paths.asPublished` / `paths.withheld` / `paths.onlyYou` / `paths.neverTold` / `paths.diagStep` / `paths.diagReason` | See what readers will see / See it on {product} / (above) |
| `paths.previewNoSignal` | What readers will see can't be checked without a signal. Your changes are still here. |
| `paths.unreadable` | This path can't be read, so it can't be shown here. Nothing changed. |
| `paths.asWritten` (`details`) | Show the path as written (for {helper}) |
| `paths.details.*` (`details`) | file `content/paths/{slug}.json`, revision, step keys, relationship values, `readingPaths.publish`, diagnostics kinds, trash name |

## Readings side by side (`#/research/readings`)

- **Job:** "Which subjects have I set readings of side by side?" **Primary:** **New comparison of readings**.
- **Loads:** `GET comparisons`. Research area tabs; `readings.notCompare` under the title.

```
400 px                                          Desktop: one 44rem column
+------------------------------------------+
| Home > Research > Readings               |
| Overview|Sources|…|Readings [v]          |  tabs / select
| Readings side by side                    |
|           [New comparison of readings]   |
| Set readings of one subject side by side,|  readings.lede
| say who holds each, never rule between.  |
| The cave: what the prisoners stand for   |
|   (Published) 3 readings · 2 explanations|
|   1 AI draft waiting for you to approve  |
| Free will in Book X          (Draft)     |
+------------------------------------------+
```

- Empty: `readings.emptyText` "Start from two readings of the same subject."
- Row states: `readings.state.shown` "On {product}", `.draft` "Draft", `.notShown` "Not shown yet: two readings must be your own words or approved", `.unreadable`; `readings.waiting` "{count} AI drafts waiting for you to approve".

## A comparison of readings (`#/research/readings/new`, `#/research/reading/<slug>`)

- **Job:** "Who reads this how, and what helps each audience?" **Primary:** **Publish** / **Update**; **Save draft**.
- **Loads:** `GET comparisons/references` and `GET comparisons/item?slug=`. Preview as paths (`POST comparisons/preview`).

```
400 px                                          Desktop (>= 70rem): editor | preview column
+------------------------------------------+
| ‹ All comparisons of readings            |
| The cave                    [More v]     |
| Draft · not on {product} yet             |
| Title [The cave______________________]   |
| Address /interpretations/the-cave/       |
| What the readings are about (neutral)    |
| [What the prisoners in the cave stand…]  |
| Readings (3)                             |
| +--------------------------------------+ |
| | Iris Murdoch          Your own words | |  h3 who; badge standing
| | “The cave is a picture of the moral  | |  first 160 letters, bdi, lang
| | life…”   Stated · 2 evidence (1 priv)| |
| | [Change] [Move v] [Take it out]      | |
| +--------------------------------------+ |
| | Someone unknown: a 12th-c. commentator |
| | Drafted with AI (WriterTool): not    | |
| | approved, readers don't see it       | |
| | [Read and approve] [Change] [Move v] | |
| +--------------------------------------+ |
| [ Add a reading ]                        |
| How the readings relate (1)              |
| Murdoch · differs from · commentator     |
|   [Change] [Take it out]                 |
| [ Add a relation ]  (2 readings needed)  |
| Explanations by audience (2)             |
| For beginners · about the whole          |
|   [Change] [Move v] [Take it out]        |
| [ Add an explanation ]                   |
| [See what readers will see]              |
| [Save draft]               [ Publish ]   |
+------------------------------------------+
```

- **Reading sheet** ("Reading: {who}", **Done**, `readings.savesWith` "Saves with the comparison."): **Who holds it** (`radio-group`: `readings.who.named` "A person, school or tradition" / `.source` "A source in your library" / `.anonymous` "Someone unknown"), then **Name** / **Source** (`combo-box` of library titles) / **Describe them** ("like an anonymous twelfth-century commentator"); **How firmly it's theirs** (`readings.certainty.none` "Not said", `.stated` "Stated", `.attributed` "Attributed", `.uncertain` "Uncertain", `.disputed` "Disputed"); **What this reading holds** (required); **What's uncertain** (help `readings.uncertaintyHelp` "Honest uncertainty is welcome, with or without evidence."); **Language, if not {product}'s**; **Evidence** rows (picker groups **Evidence links** / **Sources**, **Where in the source**, each row's state, **Take it out**; `readings.noEvidence` "No evidence yet. You can still save: say so under What's uncertain."); **An AI tool drafted these words** toggle + **Which tool** (required when on; switching says `readings.markedAi` / `readings.markedOwn`). A source attribution not held: `readings.sourceGone` "That source isn't in your library."
- **Relation row** (inline, stacks at 400 px): **This reading** / **relates by** (`readings.rel.differsFrom` "Differs from", `.agreesWith` "Agrees with", `.buildsOn` "Builds on", `.respondsTo` "Responds to") / **That reading** / **Note**; help `readings.relHelp` "No relation says which reading is right." Symmetric kinds say `readings.eitherWay` "Either way round means the same."
- **Explanation sheet:** **For** (`readings.level.beginner` "Beginners", `.student` "Students", `.scholarly` "Scholars"), **About** (the whole comparison / one reading), **The explanation** (required), **Evidence** (only evidence its reading already cites: `explanationEvidenceChoices`; `readings.evidenceFromReading` "An explanation uses only evidence its reading already cites."), AI toggle + tool. Read-only file facts (⚑ 9): `readings.fileFacts` "By {authors} · Before reading: {prerequisite} · For {modes} reading · Translates {other}"; withdrawn: `readings.withdrawn` "Withdrawn: readers don't see it." Lede `readings.explanationLede` "An explanation adds to your words for one audience. It never replaces them."
- **Approve ⚑ 7:** card **Read and approve** → unsaved: `ask` `readings.saveFirstTitle` "Save first?" / `readings.saveFirstText` "You approve the words as saved." / **Save now** / **Not now**; then `modal-dialog` `readings.approveTitle` "Approve these words?" showing the saved attribution, statement, uncertainty and language (from the server's item, never the draft), `readings.approveMeans` "Approving says you read these words, checked them against the evidence and take responsibility for them. Readers see them labelled as drafted with AI." **Approve these words** / **Not now** (focused). Approved card: `readings.approvedOn` "You approved these words on {date}." + **Withdraw approval** (published: asks `readings.withdrawPublishedTitle` "Withdraw and make it a draft again?" / `readings.withdrawPublishedText` "A published comparison can't hold AI words nobody approved, so the whole comparison goes back to draft." / **Withdraw and make it a draft** / **Not now**).
- **Standing badges:** `readings.standing.authored` "Your own words", `.approved` "Drafted with AI, approved by you", `.awaiting` "Drafted with AI: not approved, readers don't see it", `.stale` "Changed after you approved it: readers don't see it until you approve it again".
- **Evidence states:** `readings.evidence.public` "Readers can see this", `.private` "In your research, private: readers won't see it", `.missing` "Not in your library", `.unchecked` "Not checked: your research couldn't be read".
- **Preview:** projection as text (attribution, certainty, statement, uncertainty, `readings.provenanceAi` "Drafted with AI ({tool}), approved by the author" / `readings.provenanceOwn` "Written by the author", evidence count, explanations by level); `readings.checkEvidence` "Evidence to check (saving still works):" + notes; `readings.withheld` "Readers can't see this comparison yet: it needs two readings that are your own words or approved."; **Only you see this** with `readings.leftOut.awaiting` "not approved", `.stale` "changed after you approved it", `.subjectWithheld` "explains a reading readers don't see", `.evidenceNotPublic` "some evidence is private and was left out", `.attributionNotPublic` "its source isn't public, so the reading is left out", `.withdrawn` "withdrawn", `.draft` "the comparison is a draft", `.tooFew` "fewer than two readings can be shown" (each "{name}: {why}").
- **More:** **Make it a draft again**, **Delete**, **Show the comparison as written (for {helper})**.
- Statuses: `readings.savedDraft`, `readings.published` "Published. Readers see it at {address}.", `readings.publishedHidden` "Published, but readers can't see it yet: {why}", `readings.siteOff` "{product} doesn't show comparisons of readings yet. Tell {helper}.", `readings.approved` "Approved the words of “{who}”.", `readings.approvalWithdrawn` "Withdrew the approval.", `readings.approvalDropped` "Saved. You changed words you'd approved in “{who}”, so readers won't see them until you approve them again.", `readings.removedReading` "Took out “{who}” and the relations that named it." Words file: `parts/readings-words.js`.

## The file as written (developer, both kinds)

More › **Show the path / comparison as written (for {helper})** opens a full-width sheet (`parts/file-as-written.js`): the canonical text from the server in a monospace `textarea` (`spellcheck=false`, `dir=ltr`), **Check it** (`preview` with `source`), **Use the form again** (only when valid), **Save as written** (same save, same Undo). Help (`details`): "This is the file itself. Saving writes the canonical form, keeps fields this release doesn't know and refuses anything invalid without changing the file. An approval can be kept but never added here." Problems list with the server's sentences verbatim. A file that can't be read opens here directly (her layer shows only `paths.unreadable` / `readings.unreadable` + `common.tell`).

## Saving, no signal, leaving

- **Save draft / Publish / Update** send the whole item (`PUT` with `revision`, `POST` when new); Publish sets `status: published`. Before sending, Studio's own checks (`pathProblems`, `readingsProblems`) put errors on fields and nothing is sent. After a new item's first save the route becomes `#/path/<slug>` (`replaceState`).
- **Busy:** buttons stay enabled; a second press waits for the first.
- **No signal:** status `paths.keptHere` / `readings.keptHere` "No signal, so it isn't saved yet. It's kept in this tab; press Save again when you have a signal." The draft is kept in `sessionStorage` (`studio:kept:path:<slug|new>`, `studio:kept:reading:<slug|new>`), removed on save; reopening the screen offers **Go back to it** (`research.kept` pattern). Never sent by itself (a revision may be stale by then).
- **Leaving** with unsaved changes: the router's leave-guard asks (Studio standard words).

## Errors by code

`pathProblem(error)` / `readingsProblem(error)` (pure) map each answer to `{field, step|item, id, vars}`; the server's sentence and code go in details. Until G98 they read today's shapes (`conflict`, `exists`, `missing`, `needsUnpublish`, `stale`, `notAi`, `problems[].step|item`).

| Answer | Where | Her words (id) |
| --- | --- | --- |
| 401 | shell | Sign in again; the draft stays |
| 0 / network | status | `paths.keptHere` / `readings.keptHere` |
| 409 `changed` (`conflict`) | dialog | `askWhichToKeep` (name, "path"/"comparison"); "theirs" loads `current`; "mine" keeps the draft on the newer revision |
| 409 `exists` | Address | `paths.addressTaken` "Another path has that address. Choose another." / `readings.addressTaken` |
| 404 `missing` | screen | `paths.gone` "This path isn't there any more. It may have been deleted somewhere else." + **‹ All reading paths** |
| 413 `too-large` | banner | `paths.tooLarge` "That's too much for one path. Take something out." / `readings.tooLarge` |
| 400 `bad-request`, 5xx `storage` | status | `paths.failed` / `readings.failed` "{product} didn't save that, so nothing changed. Your changes are still here." **Try again**; persistent: + `common.tell` |
| 422 `required` (title / subject / why / statement / explanation text / who / tool) | that field | `form.fill` (new in `parts/form-words.js`) "Fill this in." (title: `paths.needTitle` "Give the path a title."; who: `readings.needWho` "Say who holds this reading, or choose Someone unknown and describe them."; tool: `readings.needTool` "Name the AI tool that drafted these words.") |
| 422 `too-long` | that field | `form.tooLong` (new) "Shorten this to {max} letters." |
| 422 `bad-address` | Address | `paths.addressHelp` as the error |
| 422 `needs-relationship` / `needs-reason` | step card → sheet field | `paths.needRelation` "Choose how this step relates to step {n}." / `paths.needWhy` "Say why this step follows." |
| 422 `first-has-reason` | Save | handled by ⚑ 6 before sending; else `paths.heldReason` |
| 422 `first-optional` / `nothing-to-follow` | step card | `paths.firstNotOptional` / `paths.noRequiredBefore` "No required step comes before this one. Make an earlier step required." |
| 422 `repeat-target` | step card | `paths.repeat` "This is already step {n}. A path never comes back to a step." |
| 422 `influence-needs-atlas` / `influence-needs-basis` / `bad-basis` | How it relates / Which atlas link | `paths.influenceAtlas` "Influence joins two atlas entries. Choose another way they relate." / `paths.needBasis` "Choose the atlas link that says so." |
| 422 `too-many` (steps, readings, relations, explanations, evidence) | add button | `paths.full` / `readings.full` "A comparison holds at most {max} {what}." |
| 422 `duplicate-id` | item | `readings.duplicateKey` "Two items share a key. " + `common.tell` (keys are automatic) |
| 422 `unknown-reference` (relation end, about, translationOf) | that row | `readings.badEnd` "Choose a reading that's still here." |
| 422 `self-relation` | relation row | `readings.selfRelation` "A relation joins two different readings." |
| 422 `explanation-evidence` | Evidence | `readings.evidenceFromReading` |
| 422 `judgement-field` (verdict, score, rank…) | banner | `readings.noRanking` "Comparisons never rank readings, so this can't be saved with “{field}”. " + `common.tell` |
| 422 `approval-added` | banner | `readings.approvalOnlyByButton` "Only Approve these words can approve. " + `common.tell` |
| approve 422 `stale` | dialog | `readings.approveStale` "These words changed since you opened them. Nothing was approved. Read them again." (dialog reloads with the new words) |
| approve 422 `not-ai` / revoke `no-approval` | card | `readings.nothingToApprove` "There's nothing to approve here now." (reload) |
| revoke 422 `needs-unpublish` | dialog | the withdraw-published dialog above |
| any other code | its field, else banner | `form.checkField` (new) "Check this against the help under it." / `paths.failed`; server sentence in details |

## Undo

| Action | Undo |
| --- | --- |
| Move, take out (step, reading, relation, explanation), add, change in a sheet | toast **Undo** in memory, exact previous draft (a taken-out reading brings back its relations, abouts and translations); order and focus restored |
| Save draft, Publish, Update, Make it a draft again, Save as written | toast **Undo** → G97 `restore` of the replaced copy (status `paths.undone` "Put back as it was."); until G97: paths `PUT` the previous canonical text; comparisons the same unless that text holds an approval, then no Undo and the status says `readings.noUndo` "To change it back, edit it again." |
| Approve / withdraw approval | **Undo** → G97; until G97: approve on a draft → revoke; withdraw → approve with the returned digest; on a published comparison no Undo (the dialog was the one question) |
| Delete | **Undo** (shell undo slot, `parts/undo.js`, survives moving screens) → G97 restore from trash; until G97: paths `POST` the previous text; a comparison holding approvals asks once instead: `readings.deleteAsk` "Delete “{title}”? Its approvals can't be put back." |
| Undo refused (changed since) | 409 → `paths.undoChanged` "It changed again since, so it wasn't undone." |

Toasts stay until the next action on that screen; Find lists "Undo: {last}".

## What each owner sees

| | Non-technical owner | Trade owner | Research owner | Developer |
| --- | --- | --- | --- | --- |
| Nav | Reading paths once she has one; else Find › Make a reading path | same | + Research › Readings | same |
| Path steps | her posts | her posts | + atlas entries; "Was influenced by" | + step keys |
| Readings side by side | never | never | everything above | + as written, keys, approver login |
| Errors | one sentence on the field | same | same | + code, server sentence, file |
| Site switch off | "{product} doesn't show … yet" + Tell {helper} | same | same | + `readingPaths.publish` / `interpretations.publish` |

## Safety

- **Text is text.** Titles, reasons, statements, names, descriptions, notes, explanations and server sentences: `textContent`, `bdi`, `dir="auto"`, `lang` from a reading's language. The preview is built from the server's projection as text: no iframe, no markup, no links except **See it on {product}** when `url` matches `^/(paths|interpretations)/[a-z0-9]+(-[a-z0-9]+)*/$`.
- **Addresses:** slug checked by `^[a-z0-9]+(-[a-z0-9]+)*$`, ≤ 64, before any call; route args `encodeURIComponent`; query `slug`/`revision` encoded.
- **Approvals only by the server.** Studio never builds, copies or edits an `approval`; the payload carries back exactly what the server sent (lifted `comparisonPayload`, tested). The approve dialog shows the server's saved item, and sends its `digest`.
- **Nothing is sent to an AI.** "Drafted with AI" is her statement; R13 offers no writing helper on these screens.
- **Private research stays private:** source titles and evidence links appear in her pickers only; the preview shows only the server's public projection; held-back reasons are "Only you see this".
- **Unread text is untrusted:** a hand-edited file may hold anything; it is shown as text and saved only through the server's check. `sessionStorage` holds only an unsent draft and is cleared on save. G97 trash names are the server's own, validated server-side (no separators).

## Accessibility and keyboard

- **Names:** cards "Step {n} of {count}: {title}" (h3, `tabindex=-1` for focus); Move menu "Move {title}"; items "Move up", etc.; Take it out "Take out {title}"; reading cards "Reading: {who}"; relation rows "Relation {n}: {from} {kind} {to}"; Approve "Read and approve the words of {who}".
- **Reorder by keyboard ⚑ 5:** focus a card; Alt+Shift+↑/↓ moves one place, Alt+Shift+Home/End to the top/end (same as Decorations); the card keeps focus; polite live region says `paths.moved`; impossible moves do nothing and say nothing. The Move menu does the same for pointer, touch and screen reader users. Same on readings and explanations.
- **Focus:** after add, the new card's Change; after take out, the next card (else Add); sheets return focus to their opener; after Save, the status; errors focus the first field (or the first card's Change when the field is in a sheet) with `aria-describedby`.
- **Keys:** Ctrl/⌘ Enter saves (Update when published, else Save draft); Escape closes sheets/menus (asks only when a sheet's required field is half-filled); ↑/↓ between list rows (roving tabindex), Enter opens.
- **Live regions:** one polite status per screen; `role="alert"` only for conflicts and unreadable files.
- **320 px:** one column; cards full width, button rows wrap; Move is a menu, never a row of arrows; preview is a sheet; relation rows stack ("This reading" / "relates by" / "That reading"); address line wraps (`overflow-wrap:anywhere`); long unbroken titles wrap; the sticky bar holds two buttons; no sideways scroll; controls ≥ 44 px.
- **Reduced motion:** no card slide on move; the moved card gets a static outline for one announcement.
- **Zubra:** `content-card`, `status-badge`, `dropdown-menu`, `side-sheet`, `modal-dialog`, `text-field`, `select-field`, `combo-box`, `choice-cards`, `radio-group`, `toggle-switch`, `action-button`, `alert-banner`, `empty-state`, `skeleton-block`, `toast-region`, `command-palette`, `breadcrumb-trail`.

## Rules each part uses (static imports, DOM-free, tested)

| File | Functions (lifted from `admin.js` unless new) |
| --- | --- |
| `parts/path-rules.js` | `pathFollowedIndex`; `pathDraft` (= `readingPathDraft`), `pathPayload`, `pathSame`, `pathStepId`, `pathNewStep`, `pathTargetKey`, `moveStep` (= `readingPathMoveStep`), `stepStateFor`; to ids: `stepStateWords` (`readingPathStateText`), `pathProblems` (`readingPathProblems` → `{step, field, id, vars}`), `pathProblem(error)` (`readingPathErrorText`), `pathRowWords` (`readingPathListText`), `movedWords`; **not lifted:** `readingPathOrder` (route deleted); new: `relationshipChoices(steps, index)`, `heldReasons(draft)`, `suggestAddress(title, taken)`, `targetChoices(targets, steps, query)`, `moveTo(list, from, to)` (top/end), `diagnosticWords(diagnostic, steps)` |
| `parts/readings-rules.js` | `readingsDraft` (= `comparisonDraft`), `readingsPayload`, `readingsSame`, `readingsNewId`, `newReading`, `newExplanation`, `attributionAs`, `setOrigin`, `attributionLabel`; to ids: `standingWords`, `evidenceWords`, `readingsProblems`, `readingsProblem(error)`, `readingsRowWords`, `leftOutWords` (+ `withdrawn`); new: `removeReading(draft, id)` → `{draft, restore}`, `explanationEvidenceChoices(draft, explanation)`, `fileFacts(item)`, `approvalView(stateItem)` |
| `parts/path-words.js`, `parts/readings-words.js` | the ids above; `layer: "her"` except `*.asWritten`, `*.details.*`; none uses `{owner}`; every default passes `HER_BANNED` and the persona test |
| DOM parts | `parts/reorder-list.js` (cards + Move menu + Alt+Shift keys + announcements; shared by steps, readings, explanations), `parts/file-as-written.js`, `parts/item-preview.js` (column/sheet switch) |
| Screens | `screens/paths.js`, `screens/path-edit.js` + `parts/path-step-sheet.js`, `parts/path-add-step.js`; `screens/readings.js`, `screens/reading-edit.js` + `parts/reading-sheet.js`, `parts/explanation-sheet.js`, `parts/reading-relations.js`, `parts/reading-approve.js` (each < 400 lines) |
| Router | `legacyRoute` cases above; `NOT_YET` loses `comparisons`, `paths` |

**Port:** `admin-reading-paths.test.mjs` → `studio-path-rules.test.mjs` (golden round-trip, empty fields left out, held reason never in the file, moving clamps, follows nearest required, new ids, problems scoped to the step, state words, server words verbatim in details; the "keyboard operable, never drag-only" source check of `admin.js` is deleted in R15, replaced by the browser test). `admin-comparisons.test.mjs` → `studio-readings-rules.test.mjs` (all 7; "never builds an approval" kept as a test of `readingsPayload` and of `reading-approve.js` sending only the server's digest). Browser: `reading-paths.spec` (9) → `studio-paths.spec.mjs`; `interpretation-comparisons.spec` (6) → `studio-readings.spec.mjs`. Untouched (public site): `reading-path-pages.spec`, `interpretation-pages.spec`, `reading-path.test.mjs`, `interpretation-copy.test.mjs`. `comparisons.spec` is R12's.
**New tests:** `moveTo` never loses or duplicates a step; a held reason survives move-first-then-back; `relationshipChoices` offers "influenced" only atlas → atlas; `suggestAddress` never collides and is ≤ 64; `removeReading` + restore is byte-identical through `readingsPayload`; `explanationEvidenceChoices` ⊆ the reading's evidence; `pathProblem`/`readingsProblem` cover every G98 code (fixture per code, so a new code fails); `legacyRoute` for every old address; no her-layer default contains "comparison" in R12's alignment sense (⚑ 10), "slug", "file", "JSON", "Studio", "Admin" or a banned word.
**New browser:** `studio-paths.spec.mjs`: gate (no nav without a path; Find entry works); make → publish → Undo; reorder by Alt+Shift keys and by menu with announcements and focus; held reason ask; site switch off words; preview as sheet at 400 px and column at 1280 px; conflict; delete → Undo; no-signal keep; 320 px, axe, keyboard only; request log shows no `reading-paths/reorder`. `studio-readings.spec.mjs`: approve dialog shows saved words, refuses while unsaved, stale digest; editing withdraws approval; withdraw on published asks; take out a reading → Undo restores relations; judgement field refused in the as-written view; 320 px, axe.

## Server gaps

- **G96. Paths in use and both switches:** `meta.siteUses.paths` (any file in `content/paths` or `readingPaths.publish`); `meta.publishes { readingPaths, interpretations }`. G92's research gate also turns on for any file in `content/comparisons` or `interpretations.publish`.
- **G97. Put back:** every write of a path or comparison (`POST`/`PUT`, `approve`, `revoke`, `DELETE`) moves the copy it replaces into `.openblog/trash` and answers `replaced: "<name>"`; new `POST reading-paths/restore` and `POST comparisons/restore` `{slug, name, revision|null}` put that copy back byte for byte (approvals included: it is the server's own file), refusing with 409 `changed` when the current revision differs and 404 when the name is gone. Route tests: round-trip, approvals kept, stale refused, name with a separator refused.
- **G98. Codes:** top-level `code` on every refusal (`changed`, `exists`, `missing`, `invalid`, `too-large`, `bad-request`, `storage`, `stale`, `not-ai`, `no-approval`, `needs-unpublish`) and `code` + `field` on every `problems[]` entry (`required`, `too-long`, `bad-address`, `needs-relationship`, `needs-reason`, `first-has-reason`, `first-optional`, `nothing-to-follow`, `repeat-target`, `influence-needs-atlas`, `influence-needs-basis`, `bad-basis`, `too-many`, `duplicate-id`, `unknown-reference`, `self-relation`, `explanation-evidence`, `judgement-field`, `approval-added`, `bad-value`). Sentences stay one release.
- **G99. Comparison publish state:** `GET comparisons` and `comparisons/item` add `publish` (`interpretations.publish`), per item `shown`, and `url` when published and shown; `reading-paths/path` adds `url` likewise.
- **G100. Atlas links for influence:** `reading-paths/targets` adds `atlasLinks: [{id, from, to, label}]` (published relationships between public entries), so **Which atlas link says so** is a picker filtered to the two steps' entries.
- **G101. Evidence labels:** `comparisons/references` `links[]` add `label` (the claim's statement, cut at 80 letters) and `sourceTitle`, so the evidence picker shows words, not keys.
- **Not gaps:** `GET reading-paths`, `targets`, `path`; `POST reading-paths/preview`; `POST/PUT/DELETE reading-paths`; `GET comparisons`, `references`, `item`; `POST comparisons/preview`, `approve`, `revoke`; `POST/PUT/DELETE comparisons`. **Removed, never called:** `POST reading-paths/reorder` (Decided 2).

## Risks to test before release

- A path written by the old Admin (or by hand) with fields this release doesn't know: open, change nothing, Update → byte-identical file; move one step → only order changes.
- A step moved to first and back before Save keeps its reason; moved first and saved: asked once, Undo (G97) restores it.
- Two tabs: reorder in one, change a reason in the other → conflict dialog, nothing lost.
- A comparison with an approved AI reading: change one letter, Save → approval dropped and said; Undo (G97) brings the approved text and approval back; without G97, no Undo offered.
- Delete a comparison with approvals → Undo restores approvals (G97); before G97 it asks.
- A non-research recipe site: no Readings anywhere, no atlas group in Add a step, no new request at start; `#/comparisons` bookmark still opens Readings.
- RTL and polytonic Greek statements keep direction and language in cards, dialog and preview.
- 320 px with a 100-step path: Move menu reachable, list usable, no sideways scroll; a 50-reading comparison stays responsive (cards render in pages of 20 with **Show more**).
- Site switch off: Publish says readers can't see it yet; switch on later shows it without a resave.

## Docs and release note

- `docs/admin.md` (R15 rewrite): **Reading paths** (make, steps and reasons, reorder by Move or Alt+Shift+arrows, what readers see, the switch) and, in Research, **Readings side by side** (readings, relations, explanations, AI drafts and approval, evidence states, what readers see); old → new addresses. Replace l.857–890.
- `docs/interpretation-comparisons.md`: "the Admin form" → Studio's Research › Readings; "Approve this exact text" → "Read and approve"; "Admin's What will be public" → "What readers see". `docs/configuration.md` l.493–510: "in Admin under Content → …" → Studio's places. `docs/specs/reading-paths.md` mention of the reorder route: removed with the route. `docs/studio-words.md`: generated ids.
- `CHANGELOG.md` / **release note (R13):** "Reading paths and comparisons of readings are in Studio. Put steps in order with Move or the keyboard; every save, approval and delete can be undone. Old addresses open the same places. Comparisons of readings are now called Readings side by side, beside Compare in Research."

## Changes to `studio-ux` (proposed)

- **Principles, after 2:** "**Order is a button and a key, never only a drag.** Anything she puts in order has a Move menu on each item and Alt+Shift+↑/↓/Home/End on the focused item, announces where it went and keeps focus on it; the new order saves with the thing it orders."
- **Principles, 4 (Nothing is lost), add:** "Words she wrote that a change would drop are kept until she saves, and the save asks once."
- **Principles, 3, add:** "One word, one thing: when two features could share a name, each gets its own and each screen says what it is not."
- **Review checklist, add:** "[ ] Reordering works from the keyboard and the Move menu, announced, focus kept." and "[ ] An approval or other statement she makes is given only on text the server shows her as saved."
