# Studio UX, retirement slice R10: Readers

By `studio-ux`, 2026-11-14. Sources: `studio-ux`, `studio-architecture`, `words/spec.md` (ids, `say()`, `{helper}` `{product}` `{owner}`, persona rule), `retirement-plan.md` (§1 E "Readers", §1 I "lift `MODERATION_KINDS`", §2 links out `comments.js:23,79,479`, `visitors.js:91`, push notice addresses, §2 port-by-setup list, §4 R10, Decided 2 and 4), `r3/ux.md` (G22, G23, G24; "until R10, a tapped reader-note notification opens Comments"), `r7`–`r9/ux.md` (shape), `slice-8/ux.md` (Comments as built, S1, S2), `slice-9/ux.md` (Visitors as built); old Admin `web/admin/admin.js`: inbox helpers l.545–1125 (`MODERATION_STATES`, `MODERATION_KINDS`, `moderationRequest`, `perspectiveLines`, `answerLines`, `answerOffer`, `suggestionLines`, `linkRequest`, `libraryCandidateLines`, `moderationRoleLine`, `moderationReaderLine`, `moderationOutcome`, `feedbackPublicationMismatch`, `perspectivePublicationMismatch`, `answerPublicationMismatch`, `perspectiveAuditNotices`, `featureConsentLine`, `featureCardState`, `featureRequest`, `featureStandingText`, `continuationCardState`, `continuationRequest`, `continuationStandingText`, `featureAuditNotices`, `featureAuditFailure`, `retentionSummaryLines`, `feedbackPreviewText`, `localDay`, `decisionRequest`, `decisionProblem`, `decisionLine`, `decisionOutcome`, `evidenceReviewLines`, `feedbackPassage`, `reportedItem`), `showAnalytics` l.20520–20694, `showModeration` l.20699–21610, palette l.12134, route l.12353; Admin API `crates/openblog-cli/src/admin.rs` routes l.1061–1111 and `analytics` l.1170, `engagement_settings` l.5327, `save_engagement_settings` l.5377, `moderation_inbox_page` l.7943, `moderate_inbox_item` l.8396, `meta` l.4524 (`engagement`, `engagementSetUp`, `visitors`); `analytics.rs` (uniques are per page per day, salt thrown away at midnight; `summary` clamps 1–366; `retention_days` 400); `openblog-core` `config.rs` (`EngagementConfig`, `CaptchaConfig`, `AnalyticsConfig`), `participation.rs` (nine kinds, `SiteSetting`), `moderation.rs` (`RetentionPolicy` 90/30/30/365, reason codes), `moderation_inbox.rs` (`PAGE_SIZE` 50), `community_feature.rs` (no counts, no reactions); `netlify/functions/engagement.mjs` (notices l.741, 778, 813, 865, 1354; `useModerationInbox` l.1100–1104, 1526; `admin/analytics` accepts 7/30/90/365, hosted counter reports no agents), `supabase/openblog.sql` (`openblog_analytics_summary`); `docs/webmention.md` (mention moderation is CLI only); Studio: `screens/comments.js`, `screens/visitors.js`, `parts/comment-words.js`, `parts/visitor-words.js`, `screens/home.js` (waiting line), `screens/index.js`, `router.js` (`legacyRoute`), `parts/notify-link.js`, `parts/notification-rules.js`, `parts/publish.js` (`sendOut`, `wentOutWords`); tests listed under Rules.

**Studio is a product.** The owner is any subscriber. Personas judge screens; no shipped default names a person, family, food or site. Every her-layer string below is a word id read with `say(id, vars)`. Examples in wireframes ("Linda", "Apple pie") are wireframe data, never defaults.

**Owners:**
- **A non-technical owner** ("Grammi" in tests): "Did anyone say something about my pie? Say yes or no, and don't let anything nasty show." Wants one list, two buttons, and to know how many people read her recipes without being flattered or misled.
- **A trade owner** ("Dana"): comments probably off. "Did the Nextdoor post bring anybody to my site this year?" Wants a year at a glance and where people came from, in names she knows.
- **The developer** ("Mikey"): the nine kinds, every server action, roles, the connection (endpoint, key, robot check, hosted counting), retention periods, the setup checklist, codes and ids, keyboard speed.

**The jobs:** "What have readers sent me, and what shows?" (every kind, every state), "How do readers reach me?" (setup, end to end), "Is anybody reading?" (up to a year). After R10 nothing reader-related opens the old Admin.

**Decided (owner):** Decided 2 deletes `engagement/feedback/publish-decision` (no caller in Studio, l.1080) — but see ⚑ 13. Decided 4: continuations and community features are ported.

**Decisions in this spec the owner should check** (⚑ where they appear):
1. ⚑ **Comments and Visitors become one navigation item, Readers,** with three places: **What readers sent** (`#/readers`), **Visitors** (`#/readers/visitors`), **How readers reach you** (`#/readers/setup`). `#/comments…` and `#/visitors…` keep working.
2. ⚑ **One inbox for all nine kinds.** Kinds are a filter; each card shows only the decisions the server offers, in her words. **Published notes are not a second list:** a note's public answer, revision notes and "put it on the post" fixes live on its card in Shown.
3. ⚑ **Visitors counts visits, never people.** Today's Studio headline "N people visited" adds up per-page-per-day uniques and overstates people (one reader of 3 pages on 3 days = 9). R10 says "N visits" and explains a visit once. No comparisons with an earlier period, no arrows, no green/red, no "record", no goals.
4. ⚑ **A year shows by month, 90 days by week**; 7 and 30 days stay by day. Months before counting began are drawn as "not counted yet", never as zero.
5. ⚑ **The comments switch moves to How readers reach you.** The inbox keeps the "Comments are switched off" banner, whose button goes there.
6. ⚑ **Bulk actions:** select on the loaded page; only **Show** and **Don't show** (with one reason for all); one question for two or more; Undo for Don't show (all at once). G82.
7. ⚑ **No blocking, no reactions, no replies to comments.** None exists in the server or the old Admin; R10 adds none. Blocking needs a reader identity the hosted function deliberately never keeps; open.blog forbids counts and reactions (`community_feature.rs`); mention blocking stays in the terminal (`openblog mentions block`), as before. Replies to comments are a product decision for after the retirement.
8. ⚑ **Clearing out old notes stays manual.** How readers reach you shows what's due and when it last ran (G91); one dialog with counts; deleting old private decision records stays on by default, the choice in details.
9. ⚑ **The connection is the developer's:** use the comments service, its address, its key (write-only), the robot check and hosted counting sit in details with their own Save. Her layer sees each only as a sentence that says whether it works.
10. ⚑ **A notification tap opens Waiting filtered to that kind with that note focused** (G85, G86), replacing R3's `#/comments`.
11. ⚑ **One-letter keys on a focused card** (S, N, T, U, J, K) for speed, active only while a card has focus (WCAG 2.1.4).
12. ⚑ **Every old checkbox confirm becomes one dialog** (passage changed, erase, take my answer back, clear out): Studio sends the server's confirm itself.
13. ⚑ **Keep `engagement/feedback/publish-decision`.** Decided 2 deleted it as callerless, but the old inbox **does** call it (`feedbackPublicationMismatch` → "Update the published decision", l.817, called at l.21323 via `mismatch.action`). R10 uses it on the card; R15 must not delete it. Owner to confirm.

**Her words:** "readers", "comment", "note", "what readers sent", "waiting", "show it", "don't show", "take it down", "taken back", "ask them to explain", "your answer under it", "on the post", "visits", "pages opened", "where they came from", "clear out old notes", "robot check". **Never on her layer:** moderation, moderate, pending, approve, reject, purge, retention, audit, consent record, protocol, endpoint, token, credential, captcha, Turnstile, Supabase, Netlify, hosted, analytics, unique, referrer, agent, cursor, schema, front matter, plus `studio-ux`'s list. Those live under **For {helper}** (`common.forHelper`).

| Job | Lands in | Route | Replaces |
| --- | --- | --- | --- |
| Decide on what readers sent, every kind | **What readers sent** | `#/readers[/<view>][?kind=&item=]` | Studio Comments `#/comments`; old `#/moderation`, `#/feedback`, Published on your posts |
| Answer a note in public, note what changed | the note's card in Shown | `#/readers/shown` | old Published on your posts |
| Record what you decided about your post | **Record what you decided** sheet | (sheet on the card) | old Record decision |
| Feature a reflection / link to a later post | sheets on the card | (sheets) | old Feature on the post, Link to a later work |
| See every link to a later post | **Links to later posts** sheet | inbox More | old Continuation links |
| Turn comments on/off; see what readers can send; robot check; connection | **How readers reach you** | `#/readers/setup` | Studio Comments switch; old Hosted comments and analytics |
| Clear out old notes | How readers reach you › Old notes | `#/readers/setup` | old Retention |
| Visitors, up to a year | **Visitors** | `#/readers/visitors[/7\|90\|365]` | Studio `#/visitors`; old `#/analytics[/<days>]` |

**`legacyRoute`:** `#/moderation[/<state>][?kind=]` and `#/feedback[…]` → `#/readers/<view>` (`pending`→"", `clarification`→`asked`, `approved`→`shown`, `rejected`→`not-shown`, `removed`→`taken-down`, `withdrawn`→`taken-back`; `kind` kept when known); `#/analytics[/<d>]` → `#/readers/visitors[/<d>]` (30 → none; unknown → none); Studio's own retired names: `#/comments[/<view>]` → `#/readers[/<view>]` (query kept), `#/visitors[/<d>]` → `#/readers/visitors[/<d>]`. `OLD_RENAMED` loses `moderation`, `feedback`, `analytics`; the special case at `router.js:53` is replaced by `readersRoute(name, rest, search)` in `reader-rules.js`. **Area** `readers` for all three screens. **Nav** "Readers" (`readers.nav`), shown when `meta.engagementSetUp || meta.visitors`; it opens `#/readers` when engagement is set up, else `#/readers/visitors`. **Find:** "What readers sent", "Waiting notes", each view, each kind on this site ("Show only questions"), "Visitors in the last 7 / 30 / 90 days / year", "How readers reach you", "Clear out old notes", "Links to later posts", "Undo the last decision", and always (even when nothing is set up) "How readers reach you" for the developer.

## Flows

```
Home "3 comments are waiting"   notification tap   Readers (nav)   Find
            \___________________ | ______________/
                                 v
               What readers sent (#/readers)   -- area tabs: What readers sent | Visitors | How readers reach you
   view: Waiting | Asked to explain | Shown | Not shown | Taken down | Taken back      kind: Everything | Comments | ...
        card: [Show it] [Don't show v] [Ask them to explain v] [Take it down v] [More v]   -> status + Undo
        select [ ] ... -> bulk bar: [Show 4] [Don't show 4 v] -> asks once -> Undo
        Shown card (note): Your answer under it [Save]  |  Note what changed ›  |  Feature it ›  |  Link to a later post ›
        note with recordDecision: Record what you decided › (sheet) -> Record -> status
                                 |
How readers reach you (#/readers/setup): Comments [switch]  What else readers can send (list)  Robot check (line)
        Old notes: [Check what's due] -> list -> [Clear them out] (asks once)      For {helper}: connection, checklist, Save
                                 |
Visitors (#/readers/visitors[/d]): Over the last [30 days v] -> N visits, chart by day/week/month, What they read most,
        Where they came from, How these numbers are counted (disclosure), See the numbers (table)
```

**Getting back:** breadcrumb `Home > Readers > …` on every screen; sheets close with ✕/Escape to their card, focus returns to the button that opened them. Nothing depends on browser Back.

## Inventory: every reader-engagement and visitors feature the old Admin had

| Old Admin | Did | R10 | Layer | Why |
| --- | --- | --- | --- | --- |
| `#/analytics` ranges 7/30/90/365 | `analytics?days`, `engagement/analytics?days` | **Visitors** with 365 ⚑ 3, 4 | her | |
| Tile Views (from–to) | `views` | "Pages were opened {n} times." under the headline | her | secondary, explained |
| Tile Unique visitors "per page, per day" | `uniques` | headline "{n} visits" ⚑ 3 | her | honest unit |
| Tile All-time views (since) | `allTimeViews`, `firstDay` | details; "Counting since {day}" on her layer when inside the range | Mikey / her | all-time is a vanity total on her layer |
| Tile AI agent requests | `agentRequests` | disclosure sentence (built-in counter only); tables in details | her / Mikey | honest: they're not in her numbers |
| Per-day chart (inline `style` heights) | `series` | buckets by day/week/month, heights by class (policy) ⚑ 4 | her | 365 bars don't fit 400 px |
| Top pages table (path, views, visitors, all time) | `topPosts` (25) | **What they read most** by title, visits; paths, views, all-time in details | her / Mikey | |
| Referrers table | `referrers` (25) | **Where they came from**, known sites by name (`hostWords`), 5 then Show more | her | |
| AI agents, pages requested by AI agents | `agents`, `agentPages` | details tables | Mikey | |
| Privacy footnote | — | **How these numbers are counted** disclosure | her | |
| "Built-in counter is off" | 404 | `visitors.off` + `common.canTurnOn` | her | |
| Hosted settings: Enable hosted engagement | `enabled` | details: **Use the comments service** | Mikey ⚑ 9 | |
| Enable moderated comments | `comments` | **Comments** switch on How readers reach you ⚑ 5 | her | |
| Store analytics in Supabase | `analytics` | details: **Count visits with the comments service** | Mikey | |
| Captcha provider / site key / scope + env help | `captcha` | details: **Robot check**; her layer one line when on | Mikey / her | secrets stay env |
| Public function endpoint | `endpoint` | details, `text-field type=url` | Mikey | |
| Moderation token (write-only), status, Remove saved token | `credential`, `credentialAction` | details: **Replace the key** / **Remove the saved key** (asks once); status sentence | Mikey | write-only, never echoed |
| Required Netlify variables list | static | details: **Setup checklist** with live checks (G84) | Mikey | end to end |
| "Moderate comments … in the Moderation inbox" link | | area tab | — | |
| Inbox states (6 tabs) | `state` | views ⚑ 2; Asked to explain and Taken back only when the site has kinds beyond comments | her | |
| State notes (clarification, withdrawn) | static | view ledes | her | |
| Kind filter (10 entries) | `kind` | `select-field` **What kind**, only kinds on this site (G83) | her | |
| Status line "N items. More are listed…" | | `readers.showing` after Show more; nothing on first load | her | |
| Invalid items skipped / legacy protocol | `invalid`, `protocol` | her: one line; details: counts and protocol | her / Mikey | |
| Card heading "{kind} on {post}" | | `{name}` heading + kind badge + "on “{title}”" | her | |
| Received · status (reason) · shown now | | "on “{title}”, {when}"; decided line in non-Waiting views | her | |
| "No post has this address now" | `post: null` | `readers.postGone` | her | |
| Role line (coordinator / contributing author / site admin) | `role` | her: only when not site admin; site admin in details | her | |
| Standing (stands as … your decision / reader's suggestion) | `standing` | note cards: `readers.standing*` | her | |
| Item id (for Record decision) | | details | Mikey | |
| Clarification asked about this text | `clarification.askedAboutThisText` | `readers.askedText` on the card; Show it not offered (server) | her | |
| Passage check (current / re-anchored / stale / post not found, quoted, revisions) | `passage` | **The words they wrote about** block; revisions in details | her / Mikey | |
| Purged notice | `purged` | `readers.erased` | her | |
| Report ground, reported item (kind, author, state, text) | `report`, `target` | as built (Reported badge, Why, quote) generalised to any kind | her | |
| Body, by kind ("The comment", "The reader's note"…) | `body` | the text, no label (the badge says the kind) | her | one place |
| Suggested source link, suggested wording | `details.sourceUrl`, `suggestedText` | **Their link** (text + Copy + Open, not checked) / **Their wording** | her | strangers' text |
| About this reflection (about, prompt, consent, name matches credit) | `perspective` | **About this reflection** lines in her words; consent number in details | her / Mikey | |
| About this suggestion (kind, hints, missing, standing, outcome, conversions), contact | `suggestion` | **About this idea**; contact with Copy (site admin only) | her | |
| About this answer | `response` | **About this answer** | her | |
| Reader line (named / private / anonymous / reports anonymous) | `reader` | `readers.name*` under the heading | her | |
| Feedback preview ("On the post it is shown quoting…") | `publicPreview` | `readers.previewQuote` / `previewNoQuote` | her | |
| Evidence (what the reader names, compare with published evidence) | `evidence` | **What they point to** lines; published evidence list in a `details` | her | R12 links to Evidence when built |
| Similar items | `similar` | **Maybe about the same thing** links that focus the card | her | |
| Your decisions (history) | `decisions` | `details` **What you decided before ({n})** | her | |
| If approved, shown as "{heading}" | `perspectivePreview` | `readers.reflectionPreview` | her | |
| Actions with reasons, guidance, confirm | `actions` | `buttonsFor(item)` per kind ⚑ 12 | her | |
| Approve with passage acknowledgement checkbox | `passage.acknowledge` | **Show it** opens a dialog ⚑ 12 | her | |
| Request clarification (reason) | `request-clarification` | **Ask them to explain** (reason menu) | her | now offered (as built hid it) |
| Erase (confirm checkbox) | `erase` + `confirm` | More › **Erase it for good** (dialog) | her | |
| Publication mismatch fix (publish / unpublish / publish-decision / republish without name) | `feedback|third-perspectives|author-responses/{publish,unpublish,publish-decision}` | alert on the card + one button ⚑ 13 | her | |
| Published-as lines | `published` | `readers.onPost*` | her | |
| Featuring section (consent, editors' note ≤280, preview, feature, save note, take off) | `community/*` | **Feature it on the post** sheet | her (site admin) | Decided 4 |
| Continuation form (work, relation, note ≤280, preview, link) | `continuations/preview|link` | **Link to a later post** sheet | her (site admin) | Decided 4 |
| Continuation list, remove, sweep | `continuations`, `unlink`, `sweep` | **Links to later posts** sheet from inbox More | her (site admin) | |
| Answer as author (≤4000) | `author-response` POST | **Answer as {author}** on the card | her (that author) | |
| Take my answer back (confirm) | `author-response` PATCH | **Take my answer back** (dialog) | her | |
| Export suggestion to research notebook | `suggestions/export` | More › **Copy to your research notes** | her | |
| Link suggestion to future work (kind, slug/id, credit, full) | `suggestions/link` | **Link to what you made** sheet; picker of posts/collections; source id in details | her / Mikey | |
| Library candidate hints | `suggestion.libraryCandidate` | inside Link to what you made: **Their details about the source (not checked)** | her | |
| Record decision form (outcome, extent, decline reason, rationale ≤2000, revision note, add revision note, evidence link, addressed by, confirm, date) | `moderation/decision`, `feedback/revision-note` | **Record what you decided** sheet; addressed-by as a list (G89) | her | |
| Published on your posts list | `feedback/published` | merged into Shown cards (G90); orphans under **Also on your posts** ⚑ 2 | her | one place per fact |
| Your public response (≤4000), Save, Remove | `feedback/response` PUT (`etag`) | **Your answer under it** on the card, with Undo | her | |
| Record a revision note (date, claim, what changed ≤200) | `feedback/revision-note` | **Note what changed** sheet; claim id in details | her / Mikey | |
| Third Perspectives audit banner (must come off, name hidden later, unknown, answers must come off, truncated) | `third-perspectives/published` | `alert-banner`s above the list, each entry with its button | her | |
| Featured audit banner | `community/features` | same | her | |
| Retention: check, summary, items, confirm, audit box, run, result | `engagement/retention` GET/POST | **Old notes** on How readers reach you ⚑ 8 | her / Mikey | |
| Palette "Moderation inbox" | | Find entries | — | |
| Comment replies, reactions, reader blocking | — (none) | **none** ⚑ 7 | — | no server feature |
| Webmentions inbox | — (CLI only; `docs/webmention.md` "not handled yet … in Admin") | **not in R10** | — | not old-Admin parity; a later slice may add "Mentions from other sites" as a tenth kind |
| `participation.kinds`, `participation.retention`, `engagement.feedback`/`receipts`/`evidence`/`feedbackContact` | file only (old form preserved them) | read-only: her list of kinds; details: every value (G83) | her / Mikey | changing needs SQL and env too |

## What readers sent (`#/readers`)

- **Job:** "What have readers sent me?" **Primary:** the first card's **Show it** (Waiting). No screen-level primary button.
- **Loads:** `GET engagement/moderation?state=&kind=` (50 a page), then, in parallel and never blocking the list: `GET engagement/settings` (switch banner, kinds), `GET engagement/third-perspectives/published` and `GET engagement/community/features` (banners; only when the site has reflections, G83 `kinds`), `GET engagement/continuations` (only when the site has reflections or ideas). With G90 Shown cards carry their published note; until then Shown also loads `GET engagement/feedback/published` and merges by id.
- **Not set up / not ready:** `meta.engagementSetUp` false → `empty-state` `readers.notSetUpTitle` "Comments aren't set up" / `readers.notSetUpText` "When readers can leave comments, what they send waits here for you." + `common.canTurnOn`. Set up but `meta.engagement` false (as built) → `alert-banner` warning `readers.notReadyTitle` "Comments aren't ready yet" / `readers.notReadyText` "{product} is set up for comments but can't reach them." + `common.tell`; details link `#/readers/setup`. Never a link to `/admin/`.

```
400 px
+------------------------------------------+
| Home > Readers                           |  breadcrumb
| What readers sent | Visitors | How rea…  |  area tabs (links, wrap to 2 rows at 320)
| What have readers sent you?              |  h2 readers.title
| New ones wait here until you choose.     |  view lede
| Nobody else sees them yet.               |
| Get a notification on this iPhone when … |  quiet link (R3, unchanged)
| Which ones   [Waiting            v]      |  select-field (S1)
| What kind    [Everything         v]      |  select-field, only when >1 kind on
| [ ] Select                     [More v]  |  checkbox "Select" (Waiting, 2+ cards); More: Links to later posts…, Undo…
| ! 1 reflection must come off its post.   |  alert-banner danger (audit), entries below
|   “Apple pie”: [Take it off the post]    |
| +--------------------------------------+ |
| | Linda                       [More v] | |  h3 name; More menu
| | Comment · on “Apple pie”, 3:10 PM    | |  status-badge kind + meta
| | I made this for my family and the    | |  text (clamped at 600 chars, Read all)
| | crust came out perfect…              | |
| | [ Show it ]  [ Don't show v ]        | |  primary, reason menu
| | > For {helper}                       | |
| +--------------------------------------+ |
| +--------------------------------------+ |
| | Someone                     [More v] | |
| | Question · on “Apple pie”, Tuesday   | |
| | The words they wrote about:          | |  passage block
| | “Bake for 40 minutes”                | |
| | ⚠ Your post changed there since.     | |  passage stale line (word + icon)
| | Is that at 350 or 375?               | |
| | Their name stays private.            | |
| | [ Show it ] [ Ask them to explain v ]| |
| | [ Don't show v ]                     | |
| | Record what you decided ›            | |  only when recordDecision
| +--------------------------------------+ |
| [ Show more ]                            |
| > For {helper}                           |  screen details
+------------------------------------------+

Desktop (>= 70rem): list column 46rem; right column 20rem: "Comments are on. Change" (link to setup),
the notify link, the kind filter (moves here), Links to later posts, screen details.
The bulk bar sticks to the top of the list column while 1+ is selected.
```

### Views

| View id | Server state | Label (`readers.view*`) | Lede (`readers.lede*`) | Empty (`readers.empty*Title` / `…Text`) | Shown when |
| --- | --- | --- | --- | --- | --- |
| "" | pending | Waiting | New ones wait here until you choose. Nobody else sees them yet. | Nothing waiting / When a reader sends something, it waits here for you to say yes. | always |
| `asked` | clarification | Asked to explain | You asked these readers to say more. Their answer comes back here. What they first wrote can't be shown. | Nobody's been asked / When you ask a reader to explain, their note waits here for the answer. | site has a kind beyond comment |
| `shown` | approved | Shown | These are on your posts for everyone to read. | No notes up yet / What you show appears under your posts, and here. | always |
| `not-shown` | rejected | Not shown | You chose not to show these. Only you can see them. | Nothing here / What you choose not to show stays here, out of sight, in case you change your mind. | always |
| `taken-down` | removed | Taken down | These were shown, then you took them down. Only you can see them. | Nothing taken down / If you take something down, it waits here in case you want it back. | always |
| `taken-back` | withdrawn | Taken back | Readers took these back, and their words were deleted. Nothing here can be changed. | Nothing taken back / If a reader takes back what they sent, it shows here. | site has a kind beyond comment |

On a comments-only site the as-built words stay (`readers.ledeShownComments` "These are on your posts…" is the same sentence; empty texts say "comment" instead of "note": ids `readers.empty*Comments`). Never-public kinds in Shown read as their own state on the card (**Kept for later**, **You agreed with this report**); the Shown lede adds `readers.ledeShownPrivate` "Ideas you kept and reports you agreed with are here too, and are never shown." when those kinds are on. Spam is a reason, not a view: a not-shown card says "Not shown: it's spam."

### Kinds

| Kind id | Filter (`readers.kinds.*`) | Badge (`readers.kind.*`) | Public when shown |
| --- | --- | --- | --- |
| `comment` | Comments | Comment | yes |
| `question` | Questions | Question | yes |
| `source-suggestion` | Suggested sources | Suggested source | yes |
| `correction-suggestion` | Suggested corrections | Suggested correction | yes |
| `alternative-interpretation` | Other readings | Another reading | yes |
| `third-perspective` | Reflections | Reflection | yes |
| `author-response` | Authors' answers | Author's answer | yes |
| `abuse-report` | Reports | Report (badge warning) | never |
| `future-suggestion` | Ideas for later | Idea for later | never |

"Everything" (`readers.kinds.all`) first. The filter lists kinds the site has on (G83 `kinds`, comment when `comments`); until G83, the kinds seen on the loaded page plus the current one. An unknown future kind shows under the server's `kindLabel` and is handled by the server's actions (as built: "a new server action still shows").

### The card

Order, top to bottom; a block appears only when its data is there:

1. **Heading** (h3, focusable): reader's name, else `readers.someone` "Someone"; reports: `readers.reportHeading` "{name} reported {what}" (`what` = "a comment" / "a note" / "a reflection" / "an author's answer" from the target kind). Author's answer: `readers.answerHeading` "{author} answered a reflection". **More** menu beside it.
2. **Meta line:** kind badge · `readers.on` "on “{title}”" (link to the post on the site, new tab) or `readers.onSite` "on your site", · `sayWhen(receivedAt)`. No post: `readers.postGone` "No post has this address now. It may have moved or been taken off {product}."
3. **Role** (not site admin only): `readers.roleCoordinator` "You look after this as a coordinator of a shared piece. Only the site's owner sees private names or decides again." / `readers.roleContributor` "You can read this as one of its authors. A coordinator decides."
4. **Asked about this text:** `readers.askedText` "You asked them to explain this. It can't be shown; only their answer can."
5. **The words they wrote about** (`passage`): label `readers.passageLabel`; the quote; the check: current → nothing; re-anchored → `readers.passageMoved` "Your post still says this, in another place."; stale → ⚠ `readers.passageChanged` "Your post has changed there since they wrote."; unknown-work → `readers.postGone`. Revisions in details.
6. **Erased** (`purged`): `readers.erased` "Its words and any name were erased. Only your private record of decisions is kept."
7. **The text** (the reader's body). Reports: `readers.reportWhy` "Why: {ground}" then the reported item quoted (as built), or `readers.reportGone` "What they reported is gone, so this only closes the report."
8. **Their link / Their wording** (`details.sourceUrl`, `suggestedText`): see Strangers' text.
9. **About this reflection / idea / answer** (`aboutLines(item)` → ids): reflection: `readers.aboutWhole` "About the whole piece." / `readers.aboutSection` "About {author}'s part." / `readers.aboutOpening` "About the opening."; `readers.aboutChanged` "That part has changed since they read it."; `readers.prompt` "They answered: “{prompt}”"; `readers.consentName` "They agree to it being shown with their name." / `readers.consentNoName` "…without their name." / `readers.consentWithdrawn` "They no longer agree to it being shown."; `readers.nameMatches` "Their name matches an author of this piece. It's never shown with a reflection." Idea: `readers.ideaKind` "{type}", hints as `readers.ideaHint` "{label} (their words): {value}", `readers.ideaMissing` "Still to find: {list}.", `readers.ideaOutcome` "You marked it: {label}.", `readers.ideaLinked` "Linked to {what} on {day}." Answer: `readers.answerAbout` "{author} wrote this as the author of the part the reflection is about." + standing sentence `readers.answerSection*`.
10. **Who:** `readerLine(item)` → `readers.nameShown` "Shown with their name." (comment) / `readers.nameIfShown` "They agree to show the name {name} if you show it." / `readers.namePrivate` "Their name stays private." / `readers.nameOnlyOwner` "They gave a name only the site's owner can see." / `readers.anonymous` "They didn't give a name." / `readers.reportAnonymous` "Reports don't say who sent them." Comment with `publishName: false`: as built `readers.onlyYou` "Only you see this name."
11. **How it would show:** `readers.previewQuote` "On the post it shows quoting “{quote}”, from {name}." / `readers.previewNoQuote` "On the post it shows without a quote, because that part changed." / `readers.reflectionPreview` "If you show it, it's titled “{heading}”."
12. **What they point to** (`evidence`): `evidenceLines()` → `readers.evidenceClaim` "The claim: {label}", `readers.evidenceLink`, `readers.evidenceCitation`, `readers.evidenceSource`, `readers.evidenceGone` "Something they named isn't on this post any more."; header note `readers.evidenceNote` "Their own statement. Nothing checked it."
13. **Maybe about the same thing:** `readers.similar` + links "{kind}, {when}" that focus that card.
14. **Decided line** (non-Waiting views; as built `decisionLine`), extended per kind: `readers.decidedKept` "Kept for later. You decided {day}.", `readers.decidedReportUpheld` "You agreed and took it down. You decided {day}."
15. **On the post** (`publicationState(item)`): in order of urgency, an `alert-banner` with its one button: `readers.fixPublish` "Shown here, but not on the post yet." **Put it on the post** / `readers.fixUnpublish` "Not shown here, but still on the post." **Take it off the post** / `readers.fixWithdrawn` "The reader took this back, but it's still on the post. Take it off now." / `readers.fixDecision` "The post shows an older decision." **Update the post** / `readers.fixName` "They hid their name after it went up. Put it back up without the name." **Put it back without the name** / `readers.fixUnknown` "{product} can't tell whether this may stay up. Read it, and take it off if it shouldn't be there." Otherwise a quiet line `readers.onPost` "On the post." (reflection: "On the post, as a reader's reflection."; answer: "On the post, under the reflection, as the author's answer.").
16. **Buttons** (below), then the card's status line (`role="alert"` for failures, as built).
17. **Shown note extras:** **Your answer under it**, **Note what changed ›**, **Feature it on the post ›**, **Link to a later post ›**, **Record what you decided ›**, **Answer as {author}** (each below).
18. `details` **What you decided before ({n})** (`decisions`), and **For {helper}** (per card, as built, plus `role`, `standing`, `passage` revisions, consent number, `recordDecision` offer, published file state).

### Buttons and words, by kind

`buttonsFor(item)` maps the server's offered `actions` to Studio's words; an action the server didn't offer never shows; one Studio doesn't know goes to More under the server's label (as built).

| Server action | Comment, note kinds, reflection, answer | Idea for later | Report | Says after (`readers.did*`) | Undo |
| --- | --- | --- | --- | --- | --- |
| `approve` | **Show it** (primary) | **Keep it for later** (primary) | — | comment: "Shown under “{title}”. Readers can see it now."; note kinds: "Shown on “{title}”." + `wentOutWords` ("Your readers will see it in about a minute."); idea: "Kept for later. Nothing was shown or sent." | none (as built: going back records a take-down). **Take it down** is on the card in Shown |
| `reject` | **Don't show** ▾ reasons | **Not for now** ▾ | **Keep the comment** (quiet `no-action`) | "Not shown. Nobody else sees it." / "Not for now. Nothing was shown or sent." / "Kept. It stays where it is." | **Undo** → `reopen` |
| `remove` | **Take it down** ▾ reasons | **Close it** ▾ | — | "Taken down from “{title}”. Readers don't see it any more." (+ `wentOutWords` for published kinds) / "Closed." | **Undo** → `reopen` |
| `request-clarification` | **Ask them to explain** ▾ reasons | — | — | "Asked. They'll see your question when they check their note. Nothing was shown or sent by email." | none; Waiting/Asked card keeps **Don't show** |
| `uphold-report` | — | — | **Take it down** (primary; the report's ground sent, as built) | "Taken down from “{title}”. To bring it back, find it under Taken down." / gone: "It was already out of sight, so only the report is closed." | **Undo** → `reopen` (report) |
| `reopen` | **Put it back in Waiting** | same | **Decide again** | "Back in Waiting." | — |
| `erase` | More › **Erase it for good** | same | same | "Erased. Its words and the name are gone for good." | none: asked once |

Reasons (`readers.reason.*`, the Why menu, as built `REASONS` moved to ids): spam "It's spam" (first), abusive "It's unkind", personal-data "It shares something private", off-topic "It's not about this post", duplicate "They said it twice" (report: "It was already reported"), rights "It copies someone else's work", no-action "It's fine", other "Another reason". Clarification reasons use the server's labels until named.

**Passage changed** ⚑ 12: when `passage.acknowledge`, **Show it** opens `modal-dialog` `readers.ackTitle` "Your post has changed there" / `readers.ackText` "They wrote about words that have changed since. Read your post as it is now before you show this." + link **Open the post** (new tab) · **`readers.ackYes` "Show it anyway"** / `readers.ackNo` "Not now" (focused). Yes sends `acknowledge`.

**Erase** (as built): `readers.eraseTitle` "Erase {name}'s {kind} for good?" / `readers.eraseText` "Its words and the name on it are deleted. Only a private note that you decided stays. This can't be undone." **Keep it** (focused) / **Erase it**. Studio sends the server's `confirm`.

**More menu** (per card): See it on your site · Copy to your research notes (ideas, when offered) · Erase it for good · actions Studio doesn't name · **Copy its link** (`#/readers/<view>?item=<source>:<id>`, Mikey). No "Open in the full inbox".

### Shown notes: answer, what changed, feature, link

- **Your answer under it** (note kinds with a published entry, site admin): `text-field` multiline, label `readers.answerLabel` "Your answer under it", help `readers.answerHelp` "Shown under their note on the post. Nothing is sent to them.", max 4000 with a count past 3600. **Save your answer** → `PUT engagement/feedback/response {id, etag, response}` → `sendOut` → `readers.answerSaved` "Your answer is saved. " + `wentOutWords`. With an answer: More-quiet **Remove your answer** → `response: null` → `readers.answerRemoved` "Your answer is off the post." + **Undo** (PUT the previous text). Empty Save: `readers.answerEmpty` "Write your answer first, or use Remove your answer." on the field. Leaving with an unsaved answer asks (leave-guard; `isDirty()` true).
- **Note what changed ›** opens `side-sheet` `readers.changeTitle` "Note what changed in your post" / `readers.changeHelp` "This adds a public note to your post's list of changes. It doesn't change your post; change the post itself in Write. Don't name or quote the reader." Fields: **What changed** (≤200, required), **Day** (`date-field`, today), details: **Claim** (pattern `[a-z0-9-]*`, R12). **Add the note** → `POST engagement/feedback/revision-note` → `sendOut` → `readers.changeAdded` "Added to your post's list of changes." + `wentOutWords` + **Undo** for 10 minutes (G88). The same sheet opens from Record what you decided.
- **Feature it on the post ›** (reflections, site admin, `featureCardState` not null): `side-sheet` `readers.featureTitle` "Feature this reflection"; consent line (`featureConsentLine` → `readers.featureAgreed` "The reader agreed to have this text featured." / `readers.featureEarlier` "They agreed for an earlier text, not this one. Only they can agree again." / `readers.featureNo` "They haven't agreed, so it can't be featured."); **Your note** (≤280) help `readers.featureNoteHelp` "Say why it's worth reading, in your own words. It can't say how many people liked or agreed with it."; **See how it shows** (preview: the reflection, your note, `readers.featureAlsoShows` "This also puts it with the post's reflections."); **Feature it** → `readers.featured` "Featured on “{title}”." + `wentOutWords` + **Undo** (unfeature). Featured: standing (`featureStandingText` → `readers.featureStands` / `featureHidden` / `featureMustGo` / `featureUnknown`), **Save your note**, **Take the feature off** (toast Undo → feature again with the same note, refused in words if consent changed).
- **Link to a later post ›** (approved reflection, question or idea, site admin, `continuationCardState`): `side-sheet` `readers.linkTitle` "Link to a later post"; help `readers.linkHelp` "A plain link on both pages. It doesn't say the reader caused it or that anyone agrees, and shows none of their words."; **Later post** (`select-field` of published works), **How it relates** (`readers.relTakesUp` "The later post takes it up" / `relRevisits` "…comes back to it" / `relUsesSource` "…uses the source they suggested", ideas only), **Your note** (≤280); **See how it shows**; **Link them** → `readers.linked` "Linked." + `wentOutWords` + **Undo** (unlink). Existing links listed at the top of the sheet.
- **Links to later posts** (inbox More, site admin, when any kind allows links): `side-sheet` listing each link (`readers.linkLine` "“{from}” to “{to}”, {relation}, {day}." + `continuationStandingText` → ids) with **Remove the link** (toast Undo → link again), and **Check for taken-back notes** → sweep → `readers.sweepDropped` "{n} links to notes readers took back were removed." / `readers.sweepNone` "Every link's note still stands."

### Record what you decided ›

Offered when `item.recordDecision` (questions, suggested sources and corrections, other readings). `side-sheet` `readers.decideTitle` "Record what you decided"; lede `readers.decideHelp` "This records what you concluded about your post. It doesn't change your post or show or hide their note." Then, in order, each shown only when the outcome needs it (`decisionFields(offer, values)`):

1. **What did you decide?** `radio-group` (server outcomes, their guidance as descriptions).
2. **How much of it?** All / Part (accepted outcomes).
3. **Why not?** `select-field` (decline reasons).
4. **In your own words** (≤2000; required to decline or for part) help `readers.decideWordsHelp` "Shown with your decision once their note is on the post. Don't name or quote the reader."
5. **The note about what changed** `select-field` of the post's revision notes, + **Note what changed ›** (the sheet above, stacked as a step inside this sheet, not a second sheet).
6. **The evidence you recorded** (`accepted-as-evidence`): `select-field`; none → `readers.decideNoEvidence` "None is recorded for this post yet." (R12 links Evidence).
7. **Or the note that already dealt with it** (`already-addressed`): `select-field` of accepted notes on this post (G89 `addressable`); until G89, a text field in details.
8. **Day** (`date-field`, today).
9. Summary line `readers.decideSummary` "You're recording: {outcome}." **Record it** → passage changed: the ⚑ 12 dialog first → `POST engagement/moderation/decision` → `readers.decided` "Recorded. Your post and their note didn't change." (+ `readers.decidedOnPost` "It shows on their note on the post." + `wentOutWords` when `outcomePublished`). No Undo: decisions are a history; a new one supersedes (`readers.decideNoUndo` under the button: "To change it later, record a new decision.").

`decisionProblem` errors land on their field (as lifted), words as ids `readers.decideNeed*`.

### Answer as {author} / Take my answer back

- Reflection cards with `answerAs` (that section's author): `text-field` multiline label `readers.answerAsLabel` "Answer as {author}", help (`answerOffer` → `readers.answerAsHelp` / `readers.answerAsHelpChanged`) "It goes on the post under the reflection, as your answer, once a coordinator says yes. You can't say yes to your own." **Send it for a yes** → `readers.answerSent` "Sent. It waits for a coordinator. Nothing is shown or sent by email."
- Own answer (`response.withdrawable`): **Take my answer back** → dialog `readers.withdrawTitle` "Take your answer back?" / `readers.withdrawText` "It comes off the post for good, and its words are deleted soon after." **Keep it** (focused) / **Take it back** → `readers.withdrawn` "Taken back. It isn't shown anywhere."

### Ideas for later

- Contact (site admin): `readers.ideaContact` "They said you can reach them at: {contact}" + **Copy**. Help `readers.ideaContactHelp` "Only you see it. It's cleared after a while. {product} never emails it."
- More › **Copy to your research notes** → `readers.ideaCopied` "Copied to your research notes. Nothing was shown, fetched or sent." (link to the note when R11 exists).
- **Link to what you made ›** (`suggestion.link`): sheet `readers.ideaLinkTitle`; **What you made** (a draft post / a collection / a source in your library), **Which one** (`select-field` of posts or collections from `posts.list()`; a library source id as text until R11), the credit line (`offer.credit.line`, the server's sentence); full → `readers.ideaLinkFull` "It's linked as many times as it can be." **Record the link** → `readers.ideaLinked` "Recorded. Nothing was made, shown or sent." Their source details (library candidate) under `readers.ideaSourceDetails` "Their details about the source (not checked)".

### Banners above the list (every view)

`auditBanners(perspectiveAudit, featureAudit)` → `{level, id, vars, entries}`; `danger` for must-come-off, `info` otherwise; each entry "“{title}”" + its one button; done → reload + status.
- `readers.auditAnswers` "{n} author's answers must come off their posts." **Take the answer off**
- `readers.auditMustGo` "{n} reflections must come off their posts: the reader took them back, or no longer agrees." **Take it off the post**
- `readers.auditName` "{n} reflections still show a name the reader has since hidden." **Put it back without the name**
- `readers.auditUnknown` "{product} can't check {n} reflections right now. Read each, and take off any that shouldn't be up." **Take it off the post**
- `readers.featureMustGo` / `featureHidden` / `featureUnknown` (counts) with **Take the feature off**
- `readers.auditTruncated` "Only the first ones were checked."
- Audit failed (not 403): `readers.auditFailed` "{product} couldn't check what's on your posts just now." + **Try again** (never silent).

### Bulk ⚑ 6

- **Select** checkbox (label `readers.select` "Select") above the list in Waiting and Not shown with 2+ cards. Turned on, each card gains a checkbox "Select {label}" and the bar shows `readers.selected` "{n} selected" · **Select all {m}** (loaded only) · **Show {n}** (Waiting) · **Don't show {n} ▾** (one reason for all; Waiting) · **Erase {n} for good** (Not shown) · **Cancel**.
- Asks once when n ≥ 2: `readers.bulkShowTitle` "Show {n} on your posts?" / `readers.bulkShowText` "Everyone will be able to read them." **Show them** / **Not now** (focused); `readers.bulkHideTitle` "Don't show {n}?" / "Only you will see them, under Not shown. You can undo this." ; `readers.bulkEraseTitle` "Erase {n} for good?" / `readers.eraseText` plural.
- Sends `PATCH engagement/moderation/batch` (G82; until then sequential PATCHes, stop at the first 5xx/0). Result: `readers.bulkDone` "{done} not shown." / partial `readers.bulkPartial` "{done} done. {failed} didn't go through; they're still here, marked." Failed cards keep their selection and a line by code. **Undo** (bulk reject): batch `reopen` of the ones done.
- Bulk never offers Ask them to explain, Take it down, or kinds whose Show needs the passage dialog (those cards' checkboxes are disabled with `readers.bulkNotThis` "Decide this one by itself.").

### Paging, focus, conflicts (as built, generalised)

Show more (50), focus to the first new card, `readers.showing` "Showing {n}." A decided card leaves the list; focus to the next card, else the empty state. 409 `changed` → reload keeping the page, line `readers.changedHere` "This changed somewhere else just now. Here it is as it is now. Choose again." or status `readers.decidedElsewhere` "This was already decided somewhere else." Notification deep link `?item=<source>:<id>`: focus that card; not on the page → G85 single item shown first with `readers.itemHere` "The one you tapped:"; already decided → status `readers.itemDecided` "That one was already decided. It's under {view}." with a link.

## How readers reach you (`#/readers/setup`)

- **Job:** "How can readers write to me, and is it working?" **Primary:** the **Comments** switch (her one choice).
- **Loads:** `GET engagement/settings` (G83 adds `kinds`, `retention`, `receipts`, `evidence`, `feedbackContact`), `GET engagement/health` (G84, details only, after first paint), `GET engagement/retention` only on **Check what's due**.

```
400 px                                          Desktop: one 40rem column; details open into two columns at 70rem
+------------------------------------------+
| Home > Readers > How readers reach you   |
| How can readers write to you?            |  h2 readers.setupTitle
| Comments are on and working.             |  readers.setupWorking / NotWorking (state line)
| -- Comments -----------------------------|  h3
| [on ] Let readers leave comments         |  toggle-switch (as built words)
| When it's off, the comments section      |
| leaves your posts and nobody can leave   |
| a new one.                               |
| Each post can turn its own comments off  |  readers.setupPerPost + link "About this post" help
| in About this post.                      |
| -- What else readers can send -----------|  h3 (only when any)
| Questions, Suggested corrections         |  plain list from kinds
| {helper} can change these.               |  common.canChange
| -- Keeping robots out -------------------|  h3 (only when robot check on)
| Readers answer a quick check before      |  readers.setupRobots
| their first comment of a visit.          |
| -- Old notes ----------------------------|  h3
| Words readers sent that you didn't show  |  readers.setupOldText
| are deleted after a while. {product}     |
| does it only when you say.               |
| Last cleared out Monday, October 5.      |  G91
| [ Check what's due ]                     |  secondary
| > For {helper}                           |  connection, checklist, periods, kinds settings
+------------------------------------------+
```

- **State line** (`setupState(settings, health)`): `readers.setupWorking` "Comments are on and working." / `readers.setupOff` "Comments are off." / `readers.setupNotWorking` "Comments are on, but {product} can't reach them." + `common.tell` / `readers.setupNotSetUp` "Comments aren't set up for {product}." + `common.canTurnOn`.
- **Comments switch:** as built (words, confirm when turning off, `sendOut`, 409, failure flips back), moved here ⚑ 5. Shown only when `enabled` and an endpoint exist.
- **Old notes** ⚑ 8: **Check what's due** → `GET engagement/retention` → list (`retentionLines(report)` → ids): `readers.oldExpire` "{n} {kind} waiting longer than {days} days will close without a decision.", `readers.oldPurge` "{n} {kind} you didn't show will have their words and names deleted.", `readers.oldScrub` "{n} ideas you kept will have their contact details cleared.", `readers.oldNone` "Nothing is due. Nothing would change now.", `readers.oldCommentsKept` "Comments are kept until you decide, because no time limit is set for them." (the setting name in details), `readers.oldMore` "More are due than one go clears; check again after." Then **Clear them out** → dialog `readers.oldAskTitle` "Clear out {n} old notes?" / `readers.oldAskText` "Their words and names are deleted for good. Your private record of what you decided is kept longer." **Keep them** (focused) / **Clear them out** → `POST engagement/retention {asOf, audit}` → `readers.oldDone` "Cleared out: {closed} closed, {deleted} deleted." (+ `readers.oldSkipped` "{n} had changed, so they were left."). `audit` = the details checkbox **Also delete private decision records older than {auditDays} days** (default on, as old). 409 `changed` (asOf stale) → re-check and say `readers.oldChanged`.
- **For {helper}** (details, `layer: details`), in this order:
  1. **Setup checklist** (`setupChecklist(settings, health, meta)`, each ✓/✗/? with words): service address set and HTTPS; key saved and bound to this address (or from `OPENBLOG_ENGAGEMENT_API_KEY` + `_ORIGIN`); service answers (G84); tables present (`supabase/openblog.sql`, `moderation.sql`, `feedback.sql` when note kinds on, `protection.sql` when receipts, `third-perspective.sql`, `future-suggestions` when on); Netlify variables named (`SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `OPENBLOG_SITE_ID`, `OPENBLOG_SITE_ORIGIN`, `OPENBLOG_ADMIN_API_KEY`, `OPENBLOG_ANALYTICS_SALT`; robot check: `OPENBLOG_CAPTCHA_PROVIDER`, `OPENBLOG_TURNSTILE_SECRET`, `OPENBLOG_CAPTCHA_SESSION_SECRET`, `OPENBLOG_CAPTCHA_SCOPE` for every-comment; `OPENBLOG_FEEDBACK_ENABLED`, `OPENBLOG_PROTECTION_ENABLED`, `OPENBLOG_CORRECTIONS_ENABLED` per option); built and published since the last change. Unknown checks say "can't tell" (never ✓). Link to `docs/deploy.md` section.
  2. **Connection** (`fieldset`): **Use the comments service** (`enabled`), **Service address** (`endpoint`, url, default `{siteUrl}/api`), **Key** status sentence (`keyStatus(credential)`, the old four sentences) + **Replace the key** (password field, emptied after save, never echoed) + **Remove the saved key** (asks once: "An environment key, if any, keeps working."), **Count visits with the comments service** (`analytics`), **Robot check**: provider Off / Cloudflare Turnstile, public site key, how often (once per visit / before every comment), the env note. One **Save connection** (`PUT` with `etag`, `credentialAction`), then `sendOut`. Validation on the field (`setupProblem(form)`): address must be `https://` with no user, query or fragment; key ≤16 KiB; Turnstile needs a site key.
  3. **What readers can send** (read-only): `participation.kinds` per kind with its setting (off / follow comments / hidden / locked / open), `engagement.feedback`, `receipts`, `evidence`, `feedbackContact`; "Change these in `openblog.json`; each also needs its SQL and Netlify variable."
  4. **Old notes** periods (`participation.retention` or defaults 90/30/30/365, and whether comments are covered), last run (G91).
  5. Raw `settings` minus `credential` secrets, `etag`, health codes.

## Visitors (`#/readers/visitors`)

- **Job:** "Is anybody reading, and what?" **Primary:** none needed; the range picker is the one control. Read-only.
- **Loads:** `GET analytics?days=` or `engagement/analytics?days=` (as built by `meta.visitors`), `posts.list()` for titles.

```
400 px
+------------------------------------------+
| Home > Readers > Visitors                |
| Who's been reading?                      |  h2 visitors.title
| Over the last  [a year           v]      |  select-field: 7 days, 30 days, 90 days, a year
| 14,210 visits                            |  visitors.visits (large)
| A visit is one person reading one page   |  visitors.visitMeans
| on one day.                              |
| Pages were opened 19,880 times.          |  visitors.opened
| Counting since Tuesday, March 3.         |  visitors.since (only when inside range)
|  ▁ ▂ ▂ ▃ ▅ ▇ ▅ ▃ ▂ ▃ ▆ █                 |  12-13 month bars; "not counted yet" months hatched + word
|  N D J F M A M J J A S O                 |  initials, aria-hidden; chart role=img + label
| > See the numbers                        |  details -> data-table Month | Visits | Pages opened
| -- What they read most ------------------|
| 1. Apple pie            2,104 visits     |  title links to the post
| 2. Your front page      1,880 visits     |
| … 10, [Show more]                        |
| Other pages: 312 visits                  |
| -- Where they came from -----------------|
| Google 3,020 · Facebook 1,110 ·          |  hostWords: known names, else host text
| Nextdoor 402 · bsky.app 12  [Show more]  |
| > How these numbers are counted          |  details (her layer)
| > For {helper}                           |
+------------------------------------------+
Desktop: the chart spans 46rem; What they read most and Where they came from sit in two columns.
```

**Honest numbers** ⚑ 3:
- Headline `visitors.visits` "{n} visits" / `visitors.visit1` "1 visit" (from `uniques`), sub `visitors.visitMeans`. Never "people", "visitors" as a count, "readers" as a count, "unique". Per-post `visitors.visitsFor` "{n} visits". `views` appears once, as `visitors.opened` "Pages were opened {n} times."
- No comparisons with an earlier period, no percentages, no arrows, no "busiest ever", no colour meaning good/bad, no celebration, no goal. Exact numbers with grouping (`Intl.NumberFormat`), never "1.2K". Small numbers get no "only".
- The busiest bucket is named once, in the chart's spoken label (`visitors.chartLabel` "Visits per {unit}, most in {period} with {n}.") because a chart needs a summary; nowhere else.
- **How these numbers are counted** (collapsed, her layer, `visitors.how1…4`): "{product} counts without cookies and keeps nothing that could tell who a reader is." / "A person reading the same page twice in a day is one visit. Nothing links one day to the next, so {product} can't tell how many different people came." / "Readers who ask not to be counted aren't counted." / built-in counter only: "Search engines and AI tools also read your pages. They're not in these numbers." / built-in counter only: "This counts what reaches your blog's own computer; if your blog is served from somewhere else, some visits may be missing." (as built details sentence, moved up).

**Ranges and buckets** ⚑ 4 (`buckets(series, days, firstDay)`): 7 and 30 → days; 90 → weeks starting Monday (first and last partial weeks marked `visitors.partWeek` "part of a week" in the table); 365 → calendar months touched (12 or 13; partial first and last marked `visitors.partMonth` "part of the month"). Buckets entirely before `firstDay` are **not counted yet**: drawn as a hatched stub with the word in the table (`visitors.notYet` "not counted yet"), and left out of the spoken label; a bucket after `firstDay` with 0 is a real 0. Heights in twentieths by class (as built, policy-safe). Range picker labels `visitors.range7` "7 days", `range30`, `range90`, `visitors.rangeYear` "a year"; route arg 365.
- **Kept less than the range** (G87 `keptDays` < days): `visitors.keptFor` "{product} keeps numbers for {n} days, so the start of this year isn't here." 
- **Hosted counter** reports no AI tools (`agentRequests` always 0): the AI sentence is hidden, never "0".

**Where they came from** (`hostWords(host)`, pure, tested): `google.*` → Google, `bing.com` → Bing, `duckduckgo.com` → DuckDuckGo, `facebook.com`/`l.facebook.com`/`m.facebook.com`/`lm.facebook.com` → Facebook, `instagram.com`/`l.instagram.com` → Instagram, `nextdoor.com` → Nextdoor, `pinterest.*` → Pinterest, `t.co`/`x.com`/`twitter.com` → X, `bsky.app` → Bluesky, `linkedin.com`/`lnkd.in` → LinkedIn, `reddit.com`/`out.reddit.com` → Reddit, `news.ycombinator.com` → Hacker News; same names merge their counts; anything else shows the host as text (never a link). Five, then **Show more** (up to 25).

**States:** loading skeleton; empty (as built, words generic) `visitors.emptyTitle` "No visits counted yet" / `visitors.emptyText` "When people read {product}, the numbers show up here a day or so later."; off `visitors.off` "Visitor counting is switched off." + `common.canTurnOn`; failure by code (Errors). **Details** (as built) + `keptDays`, counter, per-path views/visits/all-time, raw referrer hosts, agents and agent pages tables, `series` length.

## Home

- The waiting row covers every kind: `waitingLine(page)` → comments only: as built (`home.commentsWaiting` "{n} comments are waiting for you", `home.commentWaiting`, `home.commentsWaitingMore` "More than {n} comments are waiting for you"); any other kind: `home.readersWaiting` "{n} notes from readers are waiting for you" / `home.readerWaiting` "1 note from a reader is waiting for you" / `home.readersWaitingMore`. Links `#/readers`. Audit must-come-off (only when already loaded elsewhere this session; Home makes no extra calls): none. Never a failure, never a nag (as built).

## Notifications (R3 G22 follow-up)

- **Addresses** (G86): `engagement.mjs:741` comment → `/admin/studio/#/readers?kind=comment&item=comment:<id>`; `:778, :813, :865` feedback → `/admin/studio/#/readers?kind=<submission.kind>&item=feedback:<id>`; `:1354` author answer → `/admin/studio/#/readers?kind=author-response&item=feedback:<id>`. Report notices, if any are added later, use `kind=abuse-report&item=report:<id>`. `tag` unchanged.
- **Already delivered** notices with `/admin/studio/#/comments` reach Readers through `legacyRoute` (`comments` → `readers`); old-Admin ones (`/admin/#/moderation`, `#/feedback`) through the worker swap (R3 G24) then `legacyRoute`.
- **Words:** R3 G23's titles stay ("Linda left a comment", "A reader wrote about “Apple pie”.", "An author answered on “Apple pie”."). The R3 switch `feedback` "A reader sends you a note about a post" stays. `quietNotifyLink` on What readers sent: "…when a reader sends you something" (`notify.readersLink`) when kinds beyond comment are on; else as built.
- **`useModerationInbox`** 409 sentences (`engagement.mjs:1100–1104, 1526`) say "…are decided in Readers (/admin/studio/#/readers)." (details only; code unchanged).
- `docs/notifications.md` example address updated.

## Errors by code

Every engagement route answers `{error, code}` (G81); until then `readerProblem(error)` maps today's statuses and sentences. Status 0 → the screen's no-signal words; 401 → shell's sign-in.

| Route | Answer (code) | Her words (id) | Mikey (details) |
| --- | --- | --- | --- |
| `engagement/moderation` GET | 503 `not-set-up` | the not-ready banner | server sentence |
| | 502 `service-down` / 504 `service-slow` | `readers.listServiceDown` "Your comments service isn't answering right now, so {product} can't show what readers sent. Try again in a few minutes." (as built) | status, sentence |
| | 502 `service-bad-answer` | `readers.listFailed` "What readers sent didn't load." + `common.keepsHappening` | sentence |
| | 422 `unknown-state` / `unknown-kind` / `bad-cursor` | reload with defaults; `readers.listReset` "That list couldn't be shown, so here's Waiting." | query |
| `engagement/moderation` PATCH, `…/batch` | 409 `changed` | `readers.changedHere` / `readers.decidedElsewhere` | versions |
| | 422 `reason-needed` / `reason-not-allowed` | `readers.chooseWhy` "Choose why first." (as built) | reason |
| | 422 `not-offered` | `readers.notOffered` "That can't be done to this one any more." + reload | action |
| | 403 `not-yours` | `readers.notYours` "Only the site's owner can decide this one." | role |
| | 404 `gone` | `readers.gone` "This one isn't there any more." + reload | id |
| | 502/504 | `readers.cardServiceDown` "That didn't go through: your comments service isn't answering. Nothing changed. Try again in a few minutes." (as built) | |
| | 200 with `publishError` | decision words + `readers.postNotUpdated` "It's decided, but the post wasn't updated. Use the button on its card." | publishError |
| | 200 with `continuationsError` | + `readers.linksNotUpdated` "Its links to later posts couldn't be taken off. Check Links to later posts." | sentence |
| `…/publish`, `…/unpublish`, `…/publish-decision` | 409 `changed` / 422 `not-publishable` | `readers.fixFailed` "The post wasn't changed. Try again." / reload | sentence |
| `engagement/feedback/response` PUT | 409 `changed` | `readers.answerChanged` "Your answer was changed somewhere else. Here it is now." (field keeps hers below as **Your unsaved words** with **Use mine**) | etag |
| | 422 `too-long` | `readers.answerLong` "That's longer than {max} letters." on the field | |
| `engagement/feedback/revision-note` | 422 `problems` | first problem on its field: `readers.changeEmpty` "Say what changed first." / `readers.changeLong` / `readers.changeBadClaim` (details) | problems |
| `engagement/moderation/decision` | 422 `missing` + `field` | that field's `readers.decideNeed*` | field |
| | 409 `changed` | `readers.decideChanged` "Someone recorded a decision on this just now. Read it, then record yours." + reload | counts |
| `engagement/author-response` POST/PATCH | 409 `changed` / `parent-unavailable` | `readers.answerAsGone` "The reflection changed or was taken down, so your answer wasn't sent. Your words are still here." | code |
| | 422 `empty` / `too-long` | `readers.answerAsEmpty` "Write your answer first." / `readers.answerLong` | |
| `engagement/community/*` | 422 `note-refused` | `readers.noteRefused` "A note can't say how many people liked or agreed with something. Say why it's worth reading." | server reason |
| | 409 `no-consent` / `changed` / `already-featured` | `readers.featureCant` "It can't be featured now: {reason}." (`featureConsentLine`) / reload | |
| `engagement/continuations/*` | 422 `note-refused` / `not-published` | `readers.noteRefused` / `readers.linkNotPublished` "That post isn't published yet." | |
| | 409 `already-linked` | `readers.alreadyLinked` "They're already linked." | |
| `engagement/suggestions/link` | 409 `already-linked` / `full`; 422 `bad-target` | `readers.alreadyLinked` / `readers.ideaLinkFull` / `readers.ideaLinkWhich` "Choose which one you made." | target |
| `engagement/suggestions/export` | 409 `changed` | reload + `readers.changedHere` | |
| `engagement/retention` GET/POST | 404 `off` / 403 `not-owner` | `readers.oldNotHere` "Only the site's owner can clear out old notes." | |
| | 409 `changed` | `readers.oldChanged` "Something changed since you checked. Here's what's due now." | asOf |
| `engagement/settings` PUT | 409 `changed` | as built ("Your comment settings changed somewhere else…") | |
| | 422 `bad-address` / `bad-key` / `key-needs-address` / `bad-robot-check` | details field errors: "Use an https address with nothing after a ? or #." / "That key is empty or too long." / "Save an address before the key." / "Turnstile needs its public site key." | sentence |
| `engagement/health` | any failure | checklist rows "can't tell" | status |
| `analytics`, `engagement/analytics` | 404 `off` | `visitors.off` + `common.canTurnOn` | sentence |
| | 422 `bad-days` | falls back to 30 | |
| | 502/503/504 | `visitors.serviceDown` "Your visitor numbers aren't answering right now. Try again in a few minutes." | |
| | other | `visitors.failed` "Your visitor numbers didn't load." + `common.keepsHappening` | |

## No signal

- Every Readers screen needs a signal to load and to decide; nothing is queued to send later (a decision made offline could show something she meant to hide). Status 0 → `readers.noSignal` "{product} can't reach your site right now. Nothing changed. Try again when you have a signal." Unsaved **Your answer under it**, sheet fields and the decision form stay in the page (leave-guard asks); nothing is written to storage.
- Visitors shows the no-signal words; never stale numbers.

## Undo

| Action | Undo |
| --- | --- |
| Don't show / Take it down / Keep the comment / Not for now / Close it / report upheld | banner **Undo** → `reopen` (as built; one banner, the last decision) |
| Bulk Don't show | banner **Undo** → batch `reopen` of those done |
| Show it / Keep it for later | none; **Take it down** / **Not for now** reachable on the card (as built) |
| Ask them to explain | none; not destructive, says so |
| Put it on / take it off the post, update, without the name | toast **Undo** → the opposite call |
| Your answer saved / removed | toast **Undo** → `PUT` the previous text |
| Note what changed | toast **Undo** for 10 minutes (G88) |
| Feature / take the feature off | toast **Undo** → unfeature / feature with the same note |
| Link / remove a link to a later post | toast **Undo** → unlink / link with the same fields |
| Comments switch | flip back (no confirm turning on; asks turning off, as built) |
| Record what you decided, Erase, Take my answer back, Clear them out, Remove the saved key | none: asked once (decision: shown before Record) |
| Copy to your research notes, Link to what you made | none needed; says nothing else changed |

The banner stays the screen's own (slice 8 S2 still open); the palette's "Undo the last decision" runs it.

## Strangers' text

- **Always text:** every reader name, body, quote, prompt, hint, contact, reason label, kind label, host, post title from the server and audit entry is placed with `textContent`. No Markdown, no HTML, no autolinking, no emoji shortcodes.
- **Isolated:** each stranger's block has `dir="auto"` and the `.studio-stranger` class (`unicode-bidi: isolate; overflow-wrap: anywhere; white-space: pre-wrap`), so right-to-left or control characters can't reorder Studio's own words around them. Names in labels (`aria-label`, menus) are cut at 80 characters with "…".
- **Links readers sent** (`sourceUrl`, idea `url`): shown in full as text, with **Copy** and **Open** (a link only when `http:`/`https:`, `target=_blank`, `rel="noopener noreferrer nofollow"`, `referrerpolicy="no-referrer"`), and `readers.notChecked` "Nothing checked this link." Never a preview, never fetched.
- **Contact details:** text + **Copy**, never `mailto:`/`tel:`.
- **Long text:** clamped at 600 characters with **Read all** (as built).
- **Referrer hosts:** text, never links.
- **Her own text** (answer, notes, rationale): plain text, counted, sent as she typed; the server's popularity and causation checks are said in her words (`note-refused`).

## What each owner sees

| | Non-technical owner | Trade owner | Developer |
| --- | --- | --- | --- |
| Finding it | Readers nav, Home row, notification tap | Readers nav (often Visitors only) | + Find, `?item=` links, details |
| Comments | name, words, Show it / Don't show, Undo, Take it down | same, usually off | + ids, versions, actions and guidance, keys S/N/T/U/J/K, bulk |
| Other kinds | only if turned on; plain kind names; passage block; answer under it | none | + roles, consent numbers, revisions, standings, record-a-decision fields, claim ids |
| Setup | one switch, a list, a robot line, Old notes | same | + checklist, connection, key, robot check, hosted counting, periods, kinds settings, raw settings |
| Visitors | visits, a year by month, what they read, where from (Google, Facebook…), how it's counted | "Nextdoor 402" in a year | + paths, views, all time, raw hosts, AI tools, keptDays, counter |
| Errors | one sentence; nothing changed unless it says so | same | + code, status, server sentence |

## Rules each part uses (static imports, DOM-free, tested)

| Part | File | Functions |
| --- | --- | --- |
| Inbox | new `parts/reader-rules.js` (from `comment-words.js` as built + `admin.js` l.545–1125) | `VIEWS` (six, `shownWhen`), `viewOf`, `KINDS`, `kindsOffered(settings, page)`, `readersRoute(name, rest, search)` (legacy map), `readersHash(view, kind, item)`, `parseItemRef`, `buttonsFor(item)` (all kinds, ⚑ 12 confirm handling), `reasonWords`, `quietReason`, `reportReason`, `decisionRequest` (= old `moderationRequest`, with `acknowledge`, `seenRevision`, `seenConsent`), `batchRequest(items, action, reason)`, `didWords(item, action, result)` (→ `{id, vars}`; replaces `decidedWords` + `moderationOutcome`), `undoWords`, `decisionLine`, `cardLabel`, `readerLine(reader, source, kind)` (was `moderationReaderLine`), `roleLine(role)`, `passageView(passage)`, `publicationState(item)` (= `feedbackPublicationMismatch` + perspective + answer), `waitingLine(page)`, `readerProblem(error, place)` (replaces `troubleWords`), `bulkAllowed(item)`, `aboutLines(item)` (→ ids: `perspectiveLines`, `answerLines`, `suggestionLines`), `similarLinks`, `previewWords(preview)` (was `feedbackPreviewText`) |
| Notes | new `parts/reader-notes-rules.js` (lifted) | `answerOffer`, `answerRequest`, `withdrawAnswerRequest`, `linkRequest`, `libraryCandidateLines`, `featureConsentLine`, `featureCardState`, `featureRequest`, `featureStandingText`, `continuationCardState`, `continuationRequest`, `continuationStandingText`, `auditBanners(perspectiveAudit, featureAudit)` (= `perspectiveAuditNotices` + `featureAuditNotices` + `featureAuditFailure`), `decisionFields`, `decisionProblem`, `outcomeRequest` (= old `decisionRequest`), `outcomeLine` (= old `decisionLine`), `outcomeWords` (= `decisionOutcome`), `evidenceLines` (= `evidenceReviewLines`, → ids), `localDay`, `NOTE_MAX` (280), `ANSWER_MAX` (4000), `RATIONALE_MAX` (2000), `CHANGE_MAX` (200) |
| Setup | new `parts/reader-setup-rules.js` | `setupState(settings, health)`, `setupChecklist(settings, health, meta)`, `keyStatus(credential)`, `setupProblem(form)`, `settingsRequest(settings, form)` (echo + `credentialAction`), `retentionLines(report)` (= `retentionSummaryLines`, → ids), `retentionRequest(report, audit)`, `kindsList(settings)` |
| Visitors | new `parts/visitor-rules.js` (split from `visitor-words.js`) | `RANGES` [7, 30, 90, 365], `rangeOf`, `buckets(series, days, firstDay)`, `chartLabel`, `topReads`, `hostWords(host)`, `mergeHosts(referrers)`, `headlineParts(summary)` (→ ids), `sinceLine`, `keptLine`, `howLines(counter)`, `visitorProblem(error)` |
| Words | `parts/reader-words.js` (`readers.*`, `home.readers*`), `parts/reader-setup-words.js` (`readers.setup*`, `readers.old*`), `parts/visitor-words.js` becomes a `WORDS` catalog (`visitors.*`); `parts/notify-words.js` adds `notify.readersLink` | ids above; all `layer: "her"` except `readers.details*`, the checklist and connection labels (`layer: "details"`) |
| Screens | `screens/readers.js` (list, views, paging; < 400 lines), `parts/reader-card.js`, `parts/reader-sheets.js` (decision, change, feature, link, idea link, links list), `parts/reader-bulk.js`, `parts/reader-banners.js`, `screens/reader-setup.js`, `screens/visitors.js` (moved under the area) | `comments.js` and `comment-words.js` deleted; `index.js` one `readers` entry with three routes |
| Routing | `router.js` | `legacyRoute` rows above; `OLD_RENAMED` loses three names |

Ids whose text uses `{product}` or `{helper}` need no `bare`; none use `{owner}`. Every default passes the persona test and `HER_BANNED`. All migrated strings of `comments.js`, `visitors.js`, `comment-words.js`, `visitor-words.js`, `home.js` (waiting row) are listed as migrated in `studio-words.test.mjs`.

- **Port:** `tests/web/studio-comments.test.mjs` → `studio-reader-rules.test.mjs` (every as-built case, words through `say()`); `tests/web/admin-moderation.test.mjs` (30 cases) → `studio-reader-rules.test.mjs` (states, kinds, hash/route parsing → `readersRoute`, request bodies, reader and role lines, outcome words, publication states) and `studio-reader-notes-rules.test.mjs` (perspective and answer lines, answer offer/request/withdraw, suggestion lines, link request, library lines, feature and continuation states/requests/standing, both audits and the audit failure, retention lines, preview words, decision request/problem/line/outcome, evidence lines, `localDay`); `tests/web/studio-visitors.test.mjs` → `studio-visitor-rules.test.mjs` (+ 365). Browser: `studio-comments.spec.mjs` → `studio-readers.spec.mjs`; `studio-visitors.spec.mjs` kept and extended; `moderation-inbox.spec`, `feedback-moderation.spec` → `studio-readers-notes.spec.mjs`; `suggestion-inbox.spec` → `studio-readers-ideas.spec.mjs`; `community-features.spec`, `continuations.spec` → `studio-readers-feature.spec.mjs`; `author-responses.spec` → `studio-readers-answers.spec.mjs`; by setup only (retirement plan §2): `reader-protection`, `author-conversations`, `comment-captcha-admin` switch their Admin steps to API calls. The `admin-preferences`/`admin-workspace` moderation references are R15 deletions.
- **New pure tests:** `buckets` (365 → 12 or 13 months, partial marks, buckets before `firstDay` are `notYet` not 0, a real 0 stays 0, totals equal the series sum, DST and leap day, 90 → weeks Monday-start); `chartLabel` never names a `notYet` bucket; `headlineParts` never yields "people", "visitor(s)" or "unique" (regex on all `visitors.*` defaults too); `hostWords` table + merge; `buttonsFor` for every kind × state × offered-action fixture (server fixtures from `admin.rs` tests), never shows an action not offered; `bulkAllowed` false when `passage.acknowledge` or `confirm`; `publicationState` priority; `readersRoute` every old address in §legacyRoute; `setupChecklist` never ✓ on unknown; `keyStatus` four cases; `settingsRequest` never includes a key unless replacing; `readerProblem` covers every G81 code; strangers' text: a fixture with `<img onerror>`, RLO, 10k chars and a `javascript:` link renders as text, isolated, clamped, not linked (browser).
- **New browser:** `studio-readers.spec.mjs` against a stub hosted function: every view and kind filter; Show it / Don't show with reason / Undo; Take it down / Undo; report keep / take down; erase dialog; passage dialog; bulk 5 → ask once → partial failure marks the failed → Undo; notification `?item=` focuses the card, decided item says so; S/N/T/U/J/K only with a card focused; switch-off banner button lands on setup's switch; 409 reload; 320 px, axe, keyboard only, reduced motion. `studio-reader-setup.spec.mjs`: switch, checklist, save connection (key field emptied, never in the DOM after), remove key asks, Old notes check → clear → asks → result; 409. `studio-visitors.spec.mjs`: 365 by month with a `firstDay` in April (Jan–Mar "not counted yet"), table, hosts named, no "people" text anywhere on the page, built-in vs hosted sentences.

## Accessibility and keyboard

- **Names:** buttons keep visible words and describe their card (as built: "Show it: Linda's comment on Apple pie"); checkboxes "Select {label}"; sheets labelled by their titles; the chart `role="img"` with `visitors.chartLabel`, and **See the numbers** as a real `data-table` with a caption; kind badges carry words; ⚠ is never the only signal.
- **Focus:** after a decision, the next card's heading (as built); after bulk, the first remaining card or the empty state; a sheet returns focus to its opener; errors focus their field or the card line.
- **Keys:** **J/K** next/previous card, **S** Show it, **N** Don't show (opens the reason menu), **T** Take it down (reason menu), **X** select (bulk on), **U** Undo — only while focus is inside a card (WCAG 2.1.4 component scope), listed in the screen details and Find ("Keys on What readers sent"). Ctrl/⌘ Enter saves **Your answer under it** and submits the open sheet. Escape closes menus, dialogs, sheets. No key ever erases.
- **Live region:** one per screen for statuses (as built); audit banners use `role="alert"` only for must-come-off.
- **320 px:** one column; area tabs wrap to two rows; card buttons stack full width; bulk bar wraps to two rows and stays above the list (not fixed over content); chart bars stay ≥ 4 px wide (a year: 13 bars in 288 px); tables scroll inside their own region with the caption visible (the one allowed sideways scroll, labelled); long words wrap.
- **Zubra:** `select-field`, `status-badge`, `content-card`, `empty-state`, `alert-banner`, `action-button`, `dropdown-menu`, `modal-dialog`, `side-sheet`, `text-field`, `date-field`, `radio-group`, `toggle-switch`, `data-table`, `skeleton-block`, `toast-region`. Checkbox selection uses the native `input type=checkbox` fallback (as R5–R9) until a Zubra checkbox exists.

## Safety

- **Decisions bind what she saw:** every PATCH sends `version` and `from`; reflections send `seenRevision`/`seenConsent`; a changed item is never decided blind (409 → reload).
- **Withdrawn is immutable:** Taken back cards have no buttons except the publication fix (take it off the post).
- **Clear out runs exactly the dry run:** `asOf` from the check; nothing without a check first; a stale check is refused (409).
- **The key is write-only:** never returned, never in the DOM after save, never logged; the password field is `autocomplete="new-password"` and emptied after every save attempt.
- **Robot-check secrets** are environment-only; Studio refuses any field that looks like a secret (the server already refuses non-public captcha fields).
- **No counts or rankings of readers' notes** anywhere (Studio adds none; featuring and linking notes are checked by the server).
- **Policy:** no inline styles (chart heights by class), all text via `textContent`.

## Gaps

- **G81. Engagement answers carry codes:** every `engagement/*` and `analytics` refusal adds `code` (the Errors table: `not-set-up`, `service-down`, `service-slow`, `service-bad-answer`, `unknown-state`, `unknown-kind`, `bad-cursor`, `changed`, `reason-needed`, `reason-not-allowed` (today `reasonNotAllowed`), `not-offered`, `not-yours`, `gone`, `not-publishable`, `too-long`, `empty`, `problems`, `missing` + `field`, `parent-unavailable`, `note-refused`, `no-consent`, `already-featured`, `not-published`, `already-linked` (today `alreadyLinked`), `full`, `bad-target`, `off`, `not-owner`, `bad-address`, `bad-key`, `key-needs-address`, `bad-robot-check`, `bad-days`). Sentences and today's camelCase codes stay one release.
- **G82. Decide many at once:** `PATCH engagement/moderation/batch {items: [{source, id, from, version}] (≤ 50), action: "approve" | "reject" | "reopen" | "erase", reason?}` → `{results: [{id, ok, item?, code?}]}`; each item decided on its own (no all-or-nothing), audit per item, `erase` needs the server's confirm token per item. Refuses items needing `acknowledge`.
- **G83. Settings say what readers can send:** `GET engagement/settings` adds `kinds: [{id, setting}]` (effective, folded included), `retention: {pendingDays, clarificationDays, closedDays, auditDays, coversComments}`, `receipts`, `evidence`, `feedbackContact`. Read-only; `PUT` ignores them.
- **G84. Health check:** `GET engagement/health` → `{checks: [{id, ok: true | false | null, code}]}` for: address valid, key bound, service answers (timed, 5 s), protocol current, tables (`comments`, `moderation`, `feedback`, `protection`, `third-perspective`, `future-suggestions`, `analytics`), robot check secret present (yes/no only), published since the settings changed. Never returns a secret or a raw error body.
- **G85. One item:** `GET engagement/moderation/item?source=&id=` → the inbox item shape (with `actions`), 404 `gone`; for notification taps and Undo checks.
- **G86. Notice addresses go to Readers** (R3 G22 follow-up): the five `engagement.mjs` URLs above with `kind` and `item`; the `useModerationInbox` sentences; `docs/notifications.md`.
- **G87. Visitor numbers say how long they're kept:** both summaries add `keptDays` (built-in `analytics.retentionDays`; hosted: the table's retention or null) and `counter: "builtin" | "hosted"`; the hosted RPC returns every day of the range in `series` and the same keys as the built-in one (`agentRequests` null instead of 0 when not counted).
- **G88. Undo a revision note:** `POST engagement/feedback/revision-note` returns `undoToken` (10 minutes, this session); `DELETE engagement/feedback/revision-note?undo=` removes exactly that note if unchanged and not yet chosen in a decision; 409 `in-use` / `expired`.
- **G89. What already dealt with it:** `recordDecision` adds `addressable: [{id, label}]` (accepted notes on the same post), so "addressed by" is a choice, not a typed id.
- **G90. Shown carries its published note:** approved feedback items add `publishedNote: {response, approved, name, preview}` and the published file's `etag`, so Shown is one place; `GET engagement/feedback/published` stays for notes on the post with no inbox item ("Also on your posts").
- **G91. When old notes were last cleared:** `POST engagement/retention` records `lastRunAt` (private, per site); `GET engagement/retention` returns it and `dueCount`.
- **Not gaps:** `engagement/settings` GET/PUT (etag, credential actions, captcha), `moderation` GET/PATCH (versions, reasons, actions, paging), `author-response` POST/PATCH, `moderation/decision`, `suggestions/export|link`, `retention` GET/POST (asOf, audit), `feedback|third-perspectives|author-responses/{publish,unpublish}`, `feedback/publish-decision` (kept ⚑ 13), `third-perspectives/published`, `community/*`, `continuations*`, `feedback/published`, `feedback/response`, `feedback/revision-note`, `analytics?days=365` (built-in clamps to 366; hosted accepts 365).

## Risks to test before release

- A site with comments only: no new views, no kinds filter, words say "comment"; nothing a Grammi-like owner didn't see in slice 8 except the switch's new place.
- The old Admin and Studio open at once: a decision in one, then Undo in the other → 409 → "It changed again since" (as built).
- A year on a site whose counter started in spring, and one whose built-in `retentionDays` is 200: no fake zeros; `keptLine` shows.
- Hosted counter: no AI sentence; `uniques` semantics match the built-in one (verify the SQL counts per page per day before shipping the visit sentence; if the hosted count differs, its sentence changes, not the headline).
- Bulk 50 on a slow service: progress stays honest (`readers.bulkWorking` "Working… {done} of {n}"), partial failures marked, Undo covers only the done ones.
- A reader's text with right-to-left overrides, 10,000 characters, a `javascript:` link and an `<img>`: inert, isolated, clamped.
- Notification tapped for an item decided on another device: says so, no blank screen.
- Saving the connection with an environment key present: the env key still wins and the status says so; removing the saved key never removes the env key.
- Turning comments off from setup while the inbox is open in another tab: its banner appears on next load; decisions still work.
- `publish-decision` (⚑ 13) still answered after R15's route deletions.

## Docs and release note

- `docs/admin.md` (Studio manual, R15 rewrite): **Readers** chapter: What readers sent (views, kinds, buttons, bulk, Undo, keys), Shown notes (answer, what changed, feature, link), Record what you decided, Ideas for later, How readers reach you (switch, kinds, robot check, Old notes, the checklist and connection for the developer), Visitors (visits, ranges, buckets, how it's counted, where they came from), old→new addresses. `docs/configuration.md` l.239, 252, 630, 642, 661, 701, `docs/deploy.md` l.133, `docs/features.md` l.203: "Moderation inbox" → "Readers in Studio", retention steps → "How readers reach you › Old notes". `docs/features.md` analytics: visits, not unique visitors. `docs/notifications.md` (G86). `docs/studio-words.md` gains the R10 ids (generated).
- **Release note:** Comments and Visitors are now **Readers**. Every kind of note readers send — comments, questions, suggested sources and corrections, other readings, reflections, authors' answers, ideas for later and reports — waits in one list, with only the choices that fit each; select several to show or hide at once, and undo a "don't show". Your public answer to a note now sits on the note itself. **How readers reach you** holds the comments switch, what readers can send, the robot check, clearing out old notes, and, for whoever set up your site, a setup checklist and the connection. **Visitors** goes back a year, by month, and now counts **visits** honestly: earlier versions said "people", which overstated how many different people came. Notifications about readers open the note itself. `engagement/feedback/publish-decision` stays.

## Changes to `studio-ux` (proposed)

- **Strangers' words are inert and isolated.** Anything a reader or another site wrote is text, direction-isolated, clamped, never rendered or linked except a full visible `http(s)` address with **Open** marked "Nothing checked this link".
- **Numbers are honest.** Count only what the system can know and name the unit ("visits", not "people"); explain a unit once; no comparisons, arrows, colours of judgement, rounding to "K", or celebration; a period with no data is "not counted yet", never zero.
- **Many at once asks once.** A bulk action names the count, asks once for two or more, reports partial results per item, and its Undo covers exactly what was done.
- **Shortcut keys live inside a focused item** (WCAG 2.1.4), and none erases.
- **Confirms are dialogs, not checkboxes.** Studio sends the server's confirm word after one question.
- Banned on her layer, add: moderation, pending, approve, reject, purge, retention, audit, consent record, endpoint, token, credential, captcha, hosted, analytics, unique, referrer, agent.
- Review checklist: "Every number has a unit she can check, and no screen compares her with a past self or anyone else."
