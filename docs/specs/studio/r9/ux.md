# Studio UX, retirement slice R9: Your writing voice, and Describe a new look

By `studio-ux`, 2026-11-14. Sources: `studio-ux`, `studio-architecture`, `words/spec.md` (ids, `say()`, `{helper}` `{product}` `{owner}`, persona rule), `retirement-plan.md` (§1 A "voice invitation", C `#/design`, G `#/voice`; §1 I "keep the `ob-voice-*` storage keys"; §1 H `voice/catalog` deleted; §4 R9; Decided 1, 2), `r8/ux.md` (writing helper sheet and screen, "what goes" box, `helperProblem`, `companyName`, G54–G62, "voice guide stays in R9"), `r5`–`r7/ux.md` (shape), `docs/admin.md` §Where voice samples are kept … §Move your voice library (l.239–420), §Design a theme (l.1041–1065), `docs/themes.md` l.225; old Admin: `web/admin/voice.js`, `voice-session.js`, `voice-polished.js`, `voice-library.js`, `theme-designer.js`, `admin.js` (`offerVoiceInvitation` 12638, `showVoice` 14628, `showDesigner` 14504, voice-guide propose/merge/save/move 9126–9196 and 23920–24140, palette 12111/12121); server: `admin.rs` routes 934–937, 950–953, 1032–1045, `admin/voice.rs`, `admin/voice_guide.rs`, `admin/theme_draft.rs`, `voice_session.rs` (180 s default, 30–3600, 10 s grace, 60 KiB), `voice_store.rs` (erase kinds, promote), `voice_assistant.rs` (8 samples, 120,000 letters), `admin_preferences.rs` (`voiceInvitationDismissed`); core: `theme_draft.rs` (6 colours × 2 schemes, `readable_scheme`), `look_contrast.rs` (`TEXT` 4.5, `PART` 3, `HIGH` 7); Studio: `screens/look.js`, `parts/look-rules.js`, `screens/decorations.js`, `parts/put-up-now.js`, `parts/preview.js`, `router.js` (`NOT_YET` has `design`, `voice`), `shell.js` (`signOut`), `studio.js`; tests listed under Rules.

**Studio is a product.** The owner is any subscriber: a grandmother writing recipes, a roofer, a developer. Personas below are for judging screens only. Every her-layer string is a word id read with `say(id, vars)`; `{helper}` is whoever set up the site, `{product}` is "your blog" by default, `{company}` is `companyName(status)` from R8. No shipped default names a person, a family, a food or a site.

**Owners:**
- **A non-technical owner** ("Grammi" in tests): "My son says the helper can learn how I write. How?" Wants a prompt, a clock and a box, nothing to set up, and to know none of it goes on her blog.
- **A trade owner** ("Dana"): "Make the site look like my truck: navy, red, white." Describes a look on her phone, sees it on her front page, puts it up.
- **The developer** ("Mikey"): where each file lives (private or portable), moves, the guide's exact text and diff, erase lists, what the server changed in a colour and why.

**The jobs:** "Show my helper how I sound" (three-minute pieces, a voice guide made from them) and "Make a new look from my words" (draft, see it, adjust, save, put it up). After R9 nothing voice- or design-related opens the old Admin.

**Decided (owner):** the `ob-voice-*` keys and their record shapes stay, byte for byte (§Data safety).

**Decisions in this spec the owner should check** (⚑ where they appear):
1. ⚑ Voice becomes **Your writing voice** (`#/voice`), a hub reached from the Writing helper screen, Home's invitation and Find; not in the main navigation. Pieces, not "samples", on her layer; "rough draft" and "polished copy" stay.
2. ⚑ **Erase asks once** in a dialog that lists what goes; Studio sends the server's confirm word itself. The old typed-word box goes.
3. ⚑ **The voice guide is made on Your writing voice**, not in the helper sheet. The sheet only uses it (R8's Sound like me).
4. ⚑ The guide's pieces are **ticked for her** (newest first, rough drafts first, inside the 8-piece / 120,000-letter limit); she can untick.
5. ⚑ **Her Save writes the guide where it already is**, or private when it must be or none exists. Choosing portable is Mikey's.
6. ⚑ The **invitation's dismissal moves to the server** (G64), carrying over old dismissals, because Decided 1 deletes the preferences route that held it.
7. ⚑ **Describe a new look** lives under Look (`#/look/design`) and saves a new look you put up from Decorations. It changes colours by words **and lets her change any one colour by hand**; lettering, corners and size change by words only (Look's own controls stay the one place to choose those for every look).
8. ⚑ A saved new look can be **undone for 10 minutes** while it isn't up or on the calendar (G68).
9. ⚑ The time limit stays **three minutes in Studio**; other lengths stay in the terminal (`--seconds`).
10. ⚑ Signing out with **unsaved polished changes on this phone asks first** (the old Admin cleared them silently).

**Her words:** "your writing voice", "piece", "prompt", "rough draft", "polished copy", "your voice guide", "what goes to {company}", "word for word", "describe a new look", "easy to read", "put it up". **Never on her layer:** sample, portable, private (as a storage word), pack, session, lock, catalog, guide skill, provenance, diff, revision, CSS, hex, contrast ratio, token, theme (say "look"), plus R8's list. Those live under **For {helper}** (`common.forHelper`).

| Job | Lands in | Route | Replaces |
| --- | --- | --- | --- |
| See my pieces, my guide, what's left | **Your writing voice** | `#/voice` | old Sample library `#/voice/library` |
| Write a three-minute piece | **Write a piece** | `#/voice/write[?pack=<id>]` | old `#/voice` session |
| Read a rough draft, polish a copy, make a post | **A piece** | `#/voice/piece/<id>` | old `#/voice/library/<id>` |
| Make or update my voice guide | **Your voice guide** | `#/voice/guide` | old Assistant › Context › Voice guide |
| Erase all voice writing | Your writing voice › More | `#/voice` | old library Erase block |
| Describe a new look | **Describe a new look** | `#/look/design` | old `#/design` |

**`legacyRoute`:** `#/voice` → `#/voice/write` (query kept); `#/voice/library` → `#/voice`; `#/voice/library/<id>` → `#/voice/piece/<id>`; `#/design` → `#/look/design`. `design` and `voice` leave `NOT_YET`. **Area** `voice` for the four voice screens, `look` for design (Look's navigation item stays current). **Find:** "Your writing voice", "Write a piece", "Your voice guide", "Describe a new look".

## Flows

```
Writing helper screen (#/helper) "Your writing voice" link     Home invitation "Try it"     Find
          \___________________________ | _______________________________/
                                       v
                      Your writing voice (#/voice)  -- More: Erase all…
          [Write a piece]      rows: Open           Your voice guide [Make / Update / Read]
                 v                   v                         v
     #/voice/write             #/voice/piece/<id>        #/voice/guide
     choose -> write (clock) -> rough draft saved -> polish a copy -> [Turn it into a post] -> Write

Look (#/look) card "Make a new look from your words" / Find
          v
Describe a new look (#/look/design): describe -> [Draft a look] -> result: colours, lettering, [See it on your front page]
          -> Change it (words) / Change one colour -> Name -> [Save this look] -> [Put it up now] | [Add it to your calendar] | Undo
```

**Getting back:** every screen has a breadcrumb (`Home > Your writing voice > …`, `Home > Look > Describe a new look`). Write a piece's ‹ goes to the hub (asks while the clock runs, below). Nothing depends on browser Back.

## Inventory: every voice and design feature the old Admin had

| Old Admin | Did | R9 | Layer | Why |
| --- | --- | --- | --- | --- |
| Home "Gather your voice" card (`buildVoiceInvitation`) | Once, with no samples, no open session, Assistant module shown | Home card, also only when the helper is set up | her | G64 keeps the dismissal; useless without a helper ⚑ 6 |
| Dismiss saved in Admin preferences | `preferences` PUT | `POST voice/invitation` (G64) | — | Decided 1 deletes preferences |
| Voice nav: Write a sample / Sample library | tabs | hub + its own screens | her | one job per screen |
| Draw three prompts, Draw three more (`exclude`) | `voice/draw` | **What would you like to write about?** + **Show me three others** | her | |
| Draw from one pack (`?pack=`, 404 → every pack) | | `?pack=` + "Showing prompts from {pack}" + link back | her | |
| Standing rule (`catalog.rule`), word range | server text | shown under the choice | her | site-editable text, not an id |
| Private / Portable choice at start | `visibility` | **always private**; move later in details | Mikey | a storage choice before writing is machinery |
| Start the 3:00 timer | `voice/session/start` | **Start writing** | her | |
| Time limit 30–3600 s | `timeLimitSeconds` | **drop** in Studio (CLI keeps `--seconds`) ⚑ 9 | — | one rule; the display honours any limit a terminal session set |
| Rough box refusing every correction (`ROUGH_ATTRIBUTES`) | | same attributes | her | ADR 0266 |
| Server-owned clock, never extended (`createCountdown`) | | lifted | her | |
| Marks at 1:00 and 0:30, lock said once (`createAnnouncer`) | | lifted, words as ids | her | |
| Timer in words + shape (● ▲ ■) | `timerLabel` | lifted | her | not colour alone |
| Autosave 1.5 s, device copy 0.3 s, `pagehide` copy | `voice/session/draft` | same | her | |
| Reconcile longer copy, expired plan, past-grace drop | | lifted | — | |
| Finish early; nothing written refusal | `voice/session/lock` | **I'm done**; "Nothing's written yet…" | her | |
| Lock retries ×8, three failure sentences | | same, her words | her | |
| Start over (ask, scrap) | `DELETE voice/session` | same, `modal-dialog` | her | |
| Already open elsewhere: continue / lock / scrap | 409 `alreadyOpen` | **You have a piece in progress** card | her | |
| Finishing (another window handing over) | `state: finishing` | **Time's up** + Check again | her | |
| Discarded empty session notice | `state: discarded` | one line | her | |
| Rough view read-only + why + where kept + Make portable/private | `voice/samples/{id}/visibility` | read-only region + why on her layer; where kept and move in details | her / Mikey | |
| Polished editor: title, body, Save, Reset to rough, restore copy, conflict (3 choices), words/size, unsaved-bar | `voice/samples` POST/PUT | **Polish a copy**; Reset becomes **Start the copy over** with Undo | her | Undo beats asking |
| `keepBarReachable` | | Studio's `studio-write-bar` (above the keyboard) | — | one bar pattern |
| Start another session (refuses with dirty polish) | | **Write another** | her | |
| Library: packs in order, coverage, rows newest first, badges, words, visibility, date | `voice/samples` | hub list; visibility in details | her / Mikey | |
| Other prompts group; files that need attention | | "Other prompts" group; unreadable files: one line + details | her / Mikey | |
| What is missing (gap list) | `gaps` | packs and rough-only on her layer; one-sample traits on the guide screen | her | |
| Make a post draft (`promote`), link to Write | `voice/samples/{id}/promote` | **Turn it into a post** + Undo | her | `dir` dropped: folders are Mikey's, CLI keeps `--dir` |
| Polished slug/description/tags | sample fields | **drop** in Studio | — | set them in Write once it's a post |
| Erase: plan list, typed word, all-or-nothing, re-check, clear device copies | `voice/erase` GET/POST | one dialog ⚑ 2 | her (+ file list in details) | |
| Voice samples as context, budget | `assistant/context` `voice:` ids | **R8** (sheet details) | — | already there |
| Propose a voice guide from selected samples | `assistant/voice-guide` | **Your voice guide** ⚑ 3, 4 | her | |
| Merge view: Kept / New / Changed with Keep current / Take proposed; quote checks; unknown section; own text kept | `merge` | same, her words | her | |
| Diff view, editable Markdown (hand edits win) | `diff`, `markdown` | details | Mikey | |
| Save as private (primary) / portable; portable blocked when quoting private | `PUT assistant/context` | **Save my voice guide** ⚑ 5; both buttons in details | her / Mikey | |
| Discard | | **Don't save these** | her | |
| Move guide portable ↔ private (plan, confirm) | `voice/guide/move` GET/POST | details, with Undo | Mikey | |
| Tracked private sample warning | `privateSafety` | her: one line; details: the server's sentence | her / Mikey | |
| Palette "Voice session" | | Find entries | — | |
| `voice/catalog` | no caller | **delete** (Decided 2) | — | |
| `#/design` intro, Start from, Describe, five Ideas, Draft a theme | `theme-draft` GET/POST | **Describe a new look** | her | |
| Ideas (Christmas kitchen …) | `IDEAS` | five generic ideas as ids | her | persona rule |
| Result: name, summary, readability notes, swatches light/dark | | same + "Easy to read" per writing colour | her | |
| Preview frame (Phone/Tablet/Desktop, light/dark) | `theme-draft/preview` | Studio's preview sheet (Computer/Phone) + Light/Dark | her | one preview pattern |
| Change it (words, `previous`) | `theme-draft` | same + **Back to the one before** | her | undo |
| Name, Save this theme, "open Seasons" | `theme-draft/save` | **Save this look** → **Put it up now** / **Add it to your calendar** / Undo | her | finish the job in one place |
| Hand-picked colour | — (new) | **Change {role}** ⚑ 7 | her | words can't fix one wrong colour |
| `buildError` after save | | her line + details | her / Mikey | |
| `designerErrorText` | | `designProblem` by code | her / Mikey | |

## Voice and the writing helper

- **One place per fact.** Pieces and the voice guide are made and kept on **Your writing voice**. R8's sheet **uses** them: Sound like me (guide), and in its details the per-request piece picker and budget. The guide's text is never edited in the sheet.
- **Writing pieces needs no helper.** The hub, writing, polishing, making a post and erasing all work with the helper off. Only **Your voice guide** needs it; off, its card says so (`voice.guideHelperOff` + `common.tell`) and Mikey's details link `#/helper`.
- **R8's Writing helper screen gains one line** under "What your helper knows about you": with a guide `helper.voiceHas` "Your helper can make suggestions sound like you, from your voice guide.", without `helper.voiceNone` "Write a few short pieces so your helper learns how you sound.", then link `helper.voiceLink` "Your writing voice" → `#/voice`. This replaces R8's "(R9 adds the way to make one.)".
- **What goes** reuses R8's box and rules: company named, a bullet per thing, **Word for word**, nothing sent until she presses. Errors use `helperProblem` (R8) then the R9 codes below.

## Your writing voice (`#/voice`)

- **Job:** "How do I sound, and what have I written?" Primary **Write a piece** (or **Keep writing** while one is in progress).
- **Loads:** `GET voice/status`, `GET voice/samples`, `GET assistant/status` (guide card only), and the guide descriptor from R8's light catalog `GET assistant/context?content=none` (G58). No piece text is loaded here.

```
400 px                                        Desktop (>= 48rem): 40rem column; sets in a 2-column grid
+------------------------------------------+
| Home > Your writing voice       [More v] |  More: Erase all your voice writing…
| Your writing voice                       |  h1 voice.title
| Write for three minutes about a prompt,  |  voice.lede
| the way you'd say it out loud. Your      |
| writing helper learns how you sound from |
| these pieces. They never appear on your  |
| blog.                                    |
| [ Write a piece ]                        |  primary, full width
| 6 written, 2 polished.                   |  voice.summary
| -- Your voice guide -------------------  |  h2, content-card
| Made from your pieces. Your writing      |  voice.guideHas
| helper uses it when you turn on Sound    |
| like me.                                 |
| [Update it from my pieces] [Read it]     |
| -- Stories ----------------------------  |  h2 per set (server title), catalog order
| 2 of 4 written, 1 polished               |
| +--------------------------------------+ |  one row per rough draft, newest first
| | Explain it to a beginner             | |  prompt title
| | ◆ Polished  ◇ Rough                  | |  status-badge pair, word + shape
| | 180 words · Nov 12, 2026     [Open]  | |
| +--------------------------------------+ |
| [Write one from Stories]                 |  only when prompts are left
| -- Not written yet -------------------   |
| Sets you haven't written from: Trades,   |  voice.notYet
| Humor.                                   |
| Not polished yet: A mistake I made.      |  voice.roughOnly
| > For {helper}                           |  details
+------------------------------------------+
```

At 320 px: rows stack their parts; badges wrap under the title; buttons full width.

| State | When | Words / parts |
| --- | --- | --- |
| Loading | first paint | `skeleton-block` rows |
| Empty | 0 files | `empty-state` `voice.emptyHeading` "No pieces yet" / `voice.emptyText` "A piece is a few minutes of your own writing, on a prompt you choose. It shows your writing helper how you sound, and it never appears on {product}." + **Write a piece** |
| In progress, time left | `status.session.open && !expired` | card `voice.inProgress` "You have a piece in progress: “{title}”, {time} left." + primary `voice.continue` "Keep writing" (replaces Write a piece) |
| In progress, time ran out | `open && expired` | `voice.inProgressDone` "Time ran out on “{title}”. Your rough draft is waiting." + `voice.seeIt` "See it" → `#/voice/write` (the server locks it there) |
| Unreadable record | `open && unreadable` | `voice.sessionStuck` "A piece in progress can't be read." + `common.tell`; details: the session path |
| Unreadable pieces | `invalid.length` | `voice.unreadable` "Some pieces can't be opened." + `common.tell`; details list `file`, `guidance` |
| Tracked by Git | `privateSafety.warning` | `alert-banner warning` `voice.notPrivate` "Your voice writing may not stay private." + `common.tell`; details: server sentence |
| No signal | status 0 | `voice.noSignalList` "Your pieces need a signal to show. Anything you were writing is kept on this phone." |
| Load failed | other | `voice.loadFailed` "Your pieces didn't load." + `common.tryAgain` |

Fixed words: `voice.title` "Your writing voice"; `voice.lede` "Write for three minutes about a prompt, the way you'd say it out loud. Your writing helper learns how you sound from these pieces. They never appear on {product}."; `voice.writeOne` "Write a piece"; `voice.eraseAll` (More); `voice.notYetHeading` "Not written yet"; `voice.summary` "{written}, {polished} polished." (`written` is code: "6 written"), `voice.badgeRough` "Rough", `voice.badgePolished` "Polished", `voice.openRow` "Open" (name `voice.openRowName` "Open: {title}"), `voice.morePack` "Write one from {pack}", `voice.notYet` "Sets you haven't written from: {packs}.", `voice.roughOnly` "Not polished yet: {prompts}.", `voice.otherSet` "Other prompts" / `voice.otherSetHelp` "Prompts your blog doesn't offer any more. Your pieces stay readable." Coverage lines ("2 of 4 written, 1 polished") and word counts are code (`coverageText`, `wordsText`).

**Guide card states** (`guideCard(status, guide, samples)`): helper off → `voice.guideHelperOff` "Your writing helper isn't turned on, so it can't make a voice guide yet." + `common.tell`; no pieces → `voice.guideNeedsPieces` "Write a piece or two first. Then your helper can make a voice guide from them."; no guide → `voice.guideNone` "Your writing helper can read your pieces and write down how you sound, quoting your own words." + `voice.guideMake` "Make my voice guide"; guide → `voice.guideHas` + `voice.guideUpdate` "Update it from my pieces" + `voice.guideRead` "Read it"; guide unreadable → `voice.guideBroken` "Your voice guide can't be read." + `common.tell`.

**For {helper} (details):** per row: file, `Private: .openblog/private/context/voice/…` or `Portable: assistant/context/voice/…`, bytes, revision, and **Make portable** / **Make private** (`voice.makePortable`, `voice.makePrivate`; toast `voice.moved` "Moved to {where}. Copied byte for byte." **Undo** = move back); catalog `warnings`; the session file; the CLI lines (`openblog voice --list`, `voice export`).

## Write a piece (`#/voice/write`)

- **Job:** "Write for three minutes." One `section`; steps replace each other inside it; focus moves to each step's heading (Write: to the box).
- **Loads:** `voice/status` (when a copy is on this phone), then `GET voice/session` → `sessionView(answer)`: `none` → Choose, `active` → Write (resumed), `finishing` → Time's up, `locked` → Saved, `discarded` → Choose with notice. Same sequence as the old `load()`, including the expired-copy plan.

### Choose

```
400 px                                        Desktop: the three choices side by side
+------------------------------------------+
| ‹ Your writing voice                     |
| What would you like to write about?      |  h2 voice.chooseHeading
| Showing prompts from Stories.            |  only with ?pack: voice.fromPack
| Show prompts from every set              |  link voice.fromEveryPack
| Choose one                               |  choice-cards legend voice.chooseLegend
| ( ) STORIES                              |  set title (eyebrow)
|     A mistake I made                     |  prompt title
|     Tell about a time you got it wrong…  |  invitation
|     About 120 to 250 words.              |  voice.wordRange
| ( ) …                                    |
| ( ) …                                    |
| Write it the way you would say it.       |  catalog rule (server text)
| Typos are fine…                          |
| You get three minutes. Nothing gets      |  voice.chooseHelp
| corrected, and it never appears on your  |
| blog.                                    |
|==========================================|
| [Show me three others]  [Start writing]  |  start aria-disabled until chosen
+------------------------------------------+
```

`voice.back` "Your writing voice" (the ‹ link); `voice.chooseHeading` "What would you like to write about?"; `voice.fromPack` "Showing prompts from {pack}."; `voice.fromEveryPack` "Show prompts from every set"; `voice.chooseLegend` "Choose one"; `voice.wordRange` "About {min} to {max} words." (omitted when the prompt has no range); `voice.chooseHelp` "You get three minutes. Nothing gets corrected, and it never appears on {product}." (a resumed terminal session's other length shows as `voice.chooseHelpTime` "You get {minutes} minutes…" with the same ending). `voice.drawMore` "Show me three others" → status `voice.drewMore` "Here are three others." (focus to the first choice). `voice.start` "Start writing". None chosen and Start pressed: `voice.chooseFirst` "Choose a prompt first." under the legend. `voice.discarded` "Your last piece ran out of time with nothing written, so nothing was kept." A `?pack` the site no longer offers draws from every set, silently (as the old 404 fallback). Start sends `{promptId}` only (private, 180 s).

### Write

```
400 px                                        Desktop: same, box 40rem wide, min 16 lines
+------------------------------------------+
| A mistake I made                         |  h2 = prompt title
| Tell about a time you got it wrong…      |  invitation
| ● 2:41  Writing                          |  role=timer, not live; ▲ "30 seconds left"; ■ "Time's up"
| Your rough draft                         |  label voice.roughLabel
| +--------------------------------------+ |  textarea, ROUGH_ATTRIBUTES, >= 40% of the screen
| |                                      | |
| +--------------------------------------+ |
| Spelling and autocorrect are off here on |  voice.roughHelp
| purpose, so it shows how you really write|
| 64 words. About 120 to 250 words.        |  wordsText + voice.wordRange
| Saved.                                   |  save line, polite
|==========================================|
| [Start over]                 [I'm done]  |  sticky above the keyboard
+------------------------------------------+
```

| Event | Words |
| --- | --- |
| Draft saved | `voice.saved` "Saved." |
| Save failed, copy kept | `voice.keptPhone` "Waiting for a signal. Your writing is kept on this phone." |
| Phone won't keep a copy | `voice.phoneRefused` "This phone won't keep a copy, so keep this page open until it says Saved." |
| Restored a longer copy | `voice.restoredCopy` "Your latest words were on this phone. They're back." |
| Marks (polite, once each, ≥ 25 s apart) | `voice.announceLeft` "{time} left." ("1 minute", "30 seconds": `spokenTime`, code) |
| Resumed | `voice.announceResumed` "Back where you were. {time} left." |
| Timer words | `voice.timerWriting` "Writing" ●, `voice.timerLeft` "{time} left" ▲, `voice.timerUp` "Time's up" ■ |
| Lock said | `voice.announceTimeUp` "Time's up. Your rough draft is saved as you wrote it." / I'm done: `voice.announceDone` "Your rough draft is saved as you wrote it." |
| Locking | `voice.locking` "Saving your rough draft…"; retry `voice.lockRetry` "Saving your rough draft… trying again." |
| Lock failed ×8 | sent: `voice.lockFailedSent` "Your rough draft couldn't be saved just now, but your words reached {product}. Open this page again when you have a signal." · copy kept: `voice.lockFailedPhone` "Your rough draft couldn't be saved just now. Your latest words are kept on this phone; open this page again when you have a signal." · no copy: `voice.lockFailedMemory` "Your rough draft couldn't be saved just now, and this phone won't keep a copy. Keep this page open until you have a signal." |
| I'm done with nothing written | `voice.nothingYet` "Nothing's written yet, so there's nothing to save. Write something, or start over." (clock keeps going) |
| Start over | `modal-dialog` `voice.startOverAsk` "Start over and keep nothing?" / `voice.startOverText` "What you've written in this piece is thrown away." **`voice.startOverYes` "Start over"** (destructive) / `voice.keepWriting` "Keep writing" (focused) → Choose with `voice.startedOver` "Started over. Nothing was kept." |

`voice.finish` "I'm done", `voice.startOver` "Start over", `voice.roughLabel` "Your rough draft", `voice.roughHelp` as shown.

**Leaving while the clock runs** (`leave()`): flush the draft, keep the copy, then `modal-dialog` `voice.leaveAsk` "Stop writing for now?" / `voice.leaveText` "The clock keeps going. Come back within {time} to keep writing; after that, your rough draft is saved as it is." `voice.leaveStay` "Keep writing" (focused) / `voice.leaveGo` "Leave". `isDirty()` is true while the clock runs; the rough draft never counts as unsaved after it is saved on the server.

**Already open elsewhere** (409 `already-open`, G63): card in Choose, focus to its heading. `voice.openHeading` "You have a piece in progress"; `voice.openActive` "You started “{title}” somewhere else and the clock is still running." / `voice.openExpired` "You started “{title}” somewhere else and its time ran out."; `voice.openContinue` "Keep writing it" / `voice.openLock` "Save what was written"; `voice.openScrap` "Throw it away" → dialog `voice.scrapAsk` "Throw away “{title}”?" / `voice.scrapText` "Nothing from it is kept." **`voice.scrapYes` "Throw it away"** / `voice.scrapNo` "Keep it" (focused) → `voice.scrapped` "Thrown away. Nothing was kept."

**Time's up, another window finishing:** `voice.finishingHeading` "Time's up" / `voice.finishingText` "Another window is still saving its last words. This checks again in a moment." + `voice.checkAgain` "Check again"; re-checks after `retryAfterSeconds` + 0.5 s.

### Saved, then polish

```
400 px                                        Desktop (>= 64rem): rough draft | polished copy side by side
+------------------------------------------+
| Your rough draft is saved                |  h2 voice.lockedHeading; status
| Time ran out, so it was saved as it was. |  only when expired: voice.lockedTimeUp
| -- Rough draft ------------------------- |  h3
| A rough draft stays exactly as you wrote |  voice.lockedNote
| it, typos and all…                       |
| +--------------------------------------+ |  div role=region tabindex=0, read only,
| | i made the pie crust to thin and…    | |  voice.roughRegion, textContent, pre-wrap
| +--------------------------------------+ |
| 182 words.                               |
| -- Polish a copy ---------------------- |  h3 voice.polishHeading
| This one is yours to change…             |  voice.polishHelp
| Title [A mistake I made              ]   |  text-field, max 200
| Polished copy                            |  text-field rows 12, spell-check ON
| [i made the pie crust to thin and…    ]  |
| 182 words. Not saved yet. It starts as a |  voice.polishNew
| copy of your rough draft.                |
| Start the copy over                      |  ghost button, disabled when equal to rough
|==========================================|
| [Write another]   [Save polished copy]   |
+------------------------------------------+
| After the first save, under the editor:  |
| [Turn it into a post]                    |  secondary + voice.makePostHelp
| See all your pieces                      |  link
```

Words: `voice.lockedHeading` "Your rough draft is saved"; `voice.lockedTimeUp` "Time ran out, so it was saved as it was."; `voice.roughHeading` "Rough draft"; `voice.lockedNote` "A rough draft stays exactly as you wrote it, typos and all, so it keeps showing how you really write. To fix or reshape it, polish a copy."; `voice.roughRegion` "Your rough draft, as you wrote it"; `voice.another` "Write another"; `voice.toList` "See all your pieces".

The same rough-and-polish block is **A piece** (`#/voice/piece/<id>`, `parts/voice-piece.js`, shared): heading = prompt title; meta `voice.pieceBoth` "Rough draft and polished copy · {date}" / `voice.pieceRough` "Rough draft only · {date}"; a polished piece opens with focus in the editor, a rough one on the heading. A rough draft whose polished copy is missing its rough: `voice.pieceNoRough` "Its rough draft is missing, so it can't be opened." + `common.tell`. 404: `voice.pieceGone` "This piece isn't there any more. It may have been moved or erased." + `voice.backToList` "Back to your pieces".

| Polish event | Words |
| --- | --- |
| Headings | `voice.polishHeading` "Polish a copy" / saved one: `voice.polishEditHeading` "Your polished copy" |
| Help | `voice.polishHelp` "This one is yours to change: fix typos, cut, reshape and give it a title. Your rough draft stays as it is." |
| Labels | `voice.polishTitle` "Title", `voice.polishBody` "Polished copy", button `voice.polishSave` "Save polished copy" |
| Unsaved | `voice.polishDirty` "Changes not saved. A copy is kept on this phone." / `voice.polishDirtyMemory` "Changes not saved. Keep this page open until you save." / clean `voice.polishClean` "All changes saved." |
| Saved | `voice.polishSaved` "Saved." / typed during save `voice.polishSavedTyping` "Saved. What you typed while it saved isn't saved yet." |
| Too long (> 60 KiB) | under the box, linked: `voice.polishTooLong` "That's longer than a piece can hold. Shorten it a little before saving." |
| Empty | `voice.polishEmpty` "There's nothing to save yet." |
| Start the copy over | `voice.polishReset` "Start the copy over" → applies at once; toast `voice.polishResetDone` "Your rough draft is back in the copy. Not saved yet." **Undo** |
| Kept copy found | `alert-banner info` `voice.restoreHeading` "Bring back your unsaved changes?" / `voice.restoreText` "Changes you didn't save are kept on this phone." (base changed: `voice.restoreTextChanged` "…The copy was changed somewhere else since, so saving will ask which to keep.") `voice.restoreYes` "Bring them back" / `voice.restoreNo` "Throw them away" → toast `voice.restoreThrown` "Thrown away." **Undo** |
| Changed elsewhere (409 `conflict`) | `modal-dialog` `voice.conflictHeading` "This copy was changed somewhere else" / `voice.conflictText` "Yours has {mine} words; the saved one has {theirs}. Nothing is lost: yours is still here." (gone: `voice.conflictGone` "It was thrown away or replaced somewhere else. Yours is still here.") `voice.conflictMine` "Save mine over it" / `voice.conflictTheirs` "Use the saved one" (toast `voice.conflictUsedSaved` "Showing the saved one." **Undo**) / `voice.conflictKeep` "Keep changing mine" |
| Write another with unsaved polish | `voice.saveFirst` "Save your polished copy first." focus to Save |
| Leave with unsaved polish | `voice.leavePolishAsk` "Save your polished copy?" / `voice.leavePolishText` "You changed it and didn't save. A copy stays on this phone." `voice.leavePolishSave` "Save" / `voice.leavePolishGo` "Leave without saving" |

**Turn it into a post** (`voice.makePost`): help `voice.makePostHelp` "Makes a draft post from your saved polished copy. It isn't published until you publish it." Dirty: `voice.makePostSaveFirst` "Save your polished copy first. The post is made from the saved copy." Working `voice.makingPost` "Making the post…". Done: toast `voice.madePost` "Made a draft post. It isn't published." with **Open it** (`#/write/<editPath>`) and **Undo** (`DELETE document`, R-level restore; toast `voice.madePostUndone` "The draft post is gone. Your piece didn't change."). 409 `slug-taken`: `voice.postTaken` "A post with this name already exists. Change the title of your polished copy, save, and try again." (focus Title). Rough-only pieces have no button (and the server refuses).

## Your voice guide (`#/voice/guide`)

- **Job:** "Write down how I sound, from my pieces." Needs the helper (else the card's off state, full page).
- **Loads:** `GET assistant/status`, `GET voice/samples`, guide text through `GET assistant/context/item?id=<visibility>:voice` (G58) only when **Read it** or after a proposal.

```
400 px (step 1)                               Desktop: 40rem column; step 2 traits full width
+------------------------------------------+
| Home > Your writing voice > Voice guide  |
| Your voice guide                         |  h1 voice.guideHeading
| Your helper reads the pieces you tick    |  voice.guideLede
| and writes down how you sound, quoting   |
| your own words. Nothing is saved until   |
| you say so.                              |
| > Your guide as it is now                |  details (only with a guide), read-only text
| Learn from these pieces                  |  fieldset legend voice.guideFrom
| [x] A mistake I made · rough · 182 words |  defaultGuidePieces, newest first
| [x] A mistake I made · polished · 160    |
| [ ] Explain it to a beginner · rough …   |
| Up to 8 pieces at a time. Rough drafts   |  voice.guideFromHelp
| show best how you really write.          |
| +--------------------------------------+ |
| | What goes to Anthropic               | |  common.whatGoes
| | · The pieces you ticked, about 1,840 | |  voice.guideGoesPieces
| |   words                              | |
| | · Your voice guide as it is now      | |  voice.guideGoesGuide (only with one)
| | Not your posts, photos, or anything  | |  voice.guideGoesNot
| | about your readers. Anthropic's own  | |
| | rules cover what it keeps.           | |
| | > Word for word                      | |  common.wordForWord
| +--------------------------------------+ |
|                [ Update my voice guide ] |  voice.guidePropose / voice.guideProposeNew
+------------------------------------------+
```

Step 1 words: `voice.guideHeading` "Your voice guide", `voice.guideLede` as shown, `voice.guideNow` "Your guide as it is now", `voice.guideFrom` "Learn from these pieces", `voice.guideFromHelp` as shown, `voice.guideStageRough` "rough" / `voice.guideStagePolished` "polished" (row: title · stage · `wordsText`), `voice.guideOver` "That's more than your helper reads at once. Untick a few." (button `aria-disabled`), `voice.guideNoneTicked` "Tick at least one piece.", `voice.guideProposeNew` "Make my voice guide" / `voice.guidePropose` "Update my voice guide". Working `voice.guideWorking` "Reading your pieces… This can take a minute."; after 20 s `voice.guideStill` "Still reading." + `common.stopWaiting` "Stop waiting" → `voice.guideStopped` "Stopped waiting. Nothing was saved."

```
400 px (step 2)
+------------------------------------------+
| ‹ Choose pieces again                    |  voice.guideBack (Alt+←)
| What your helper noticed                 |  h2 voice.guideResultHeading
| Each line quotes your own words. Nothing |  voice.guideResultNote, status
| is saved until you press Save. Your      |
| helper can be wrong.                     |
| -- How you start ---------------------   |  h3 = server section heading
| [Kept] You open with a question:         |  status-badge + trait text
|   “Ever burn a crust?” from “A mistake…” |
| [New] Short sentences when it matters:   |
|   “Then it burned.” (from one piece only)|  voice.traitOne
| +--------------------------------------+ |  fieldset per change
| | Changed: You use “we” for family      | |  legend voice.choiceLegend
| | ( ) Keep what you had: “…”            | |  voice.choiceKeep
| | ( ) Use the new one: “…”              | |  voice.choiceTake
| +--------------------------------------+ |
| -- What it doesn't know yet ----------   |  voice.guideUnknown
| Choose for each change before saving     |  voice.guidePending, polite
| (1 left).                                |
| > For {helper}                           |  diff, editable text, both saves, ids
|==========================================|
| [Don't save these]  [Save my voice guide]|  save aria-disabled while choices left
+------------------------------------------+
```

- **Words:** `voice.guideBack` "Choose pieces again"; `voice.guideResultHeading` "What your helper noticed"; `voice.guideResultNote` "Each line quotes your own words. Nothing is saved until you press Save. Your helper can be wrong."; `voice.guideUnknown` "What it doesn't know yet"; tags `voice.tagNew` "New", `voice.tagKept` "Kept", `voice.tagSame` "Same as before", `voice.tagChanged` "Changed"; `voice.traitFrom` "from “{piece}”"; `voice.choiceLegend` "Changed: {statement}"; `voice.choiceKeep` "Keep what you had"; `voice.choiceTake` "Use the new one"; quote checks `voice.checkGone` "The piece this quotes is gone, so it couldn't be checked. It's kept." / `voice.checkMoved` "These words aren't in that piece any more. It's kept; check it."; `voice.guideFreeKept` "Your own words outside these lines stay where they are."; `voice.guideOwnSections` "Your own sections stay: {sections}."; `voice.guidePending` "Choose for each change before saving ({n} left)."; `voice.guideDecided` "Every change is chosen."; no changes from the saved guide `voice.guideNothingNew` "Your helper found nothing new to add."; `voice.guideSave` "Save my voice guide"; `voice.guideDiscard` "Don't save these" → toast `voice.guideDiscarded` "Nothing was saved."; saved → toast `voice.guideSaved` "Voice guide saved." **Undo** → `voice.guideUndone` "Your voice guide is back as it was."
- **Statements, quotes and headings** come from the helper and the guide: `textContent`, `bdi` for quotes, clipped at 600 letters with **Show all**.
- **Save** (`guideSaveTarget(proposal)`, ⚑ 5): the visibility of the guide that exists, if it's valid and allowed; else private. The text is `voiceGuideAssemble(merge.lines, choices)` or, when Mikey edited the text in details, his text ("hand edits win", as before). `PUT assistant/context {contextType: "voice", visibility, content, etag}` with the proposal's target etag.
- **For {helper}:** the unified diff (`pre`, lines keep `+`/`-`, never colour alone), **The guide's text** (`voice.guideEditLabel` "The guide's text (your edits win)", mono, read-only until every change is chosen), **Save as private** / **Save as portable** (`voice.savePrivate`, `voice.savePortable`; blocked: `voice.guidePortableBlocked` "It quotes private pieces, so it can only be kept private."), skill id and version, provider and model, the provenance line ("Keep the `openblog:voice-provenance` line if you edit it; the portable rule relies on it."), where the guide is kept and **Move** (plan sentence from `voice/guide/move`, confirm, toast `voice.guideMoved` "Moved to {where}." **Undo** = move back), and the one-sample traits list.
- **Leaving step 2** without saving asks: `voice.guideLeaveAsk` "Leave without saving your voice guide?" / `voice.guideLeaveText` "What your helper noticed isn't kept anywhere." `voice.guideLeaveStay` "Stay" (focused) / `voice.guideLeaveGo` "Leave".

## Erase all your voice writing ⚑ 2

More › `voice.eraseAll` "Erase all your voice writing…" → `GET voice/erase` (`voice.eraseChecking` "Checking what's there…"); empty plan: toast `voice.eraseNothing` "There's nothing to erase."

```
+------------------------------------------+
| Erase all your voice writing?            |  modal-dialog, voice.eraseHeading
| This erases 6 pieces, your voice guide   |  eraseSummary(plan): code-built list
| and a piece in progress from your blog's |  + voice.eraseText
| computer. It can't be undone.            |
| Copies kept on this phone go too. Copies |  voice.eraseCopies
| in backups aren't touched; {helper} can  |
| remove those.                            |
| > For {helper}: the 9 files              |  details: path (kind), each
|           [ Keep it ]  [ Erase it all ]  |  Keep it focused; Erase destructive
+------------------------------------------+
```

`voice.eraseText` "…from {product}'s computer. It can't be undone." · `voice.eraseYes` "Erase it all" · `voice.eraseNo` "Keep it" · working `voice.erasing` "Erasing…" · clean → `clearVoiceCopies()` then toast `voice.erased` "Erased. Checked again: nothing is left." and the hub redraws empty · `remaining` → `alert-banner danger` `voice.erasePartial` "Most of it is erased, but some files are still there." + `common.tell` (details: the paths) · failure → `voice.eraseFailed` "Nothing was erased." + the problem words. Studio sends `{confirm: plan.confirm}`; the server's all-or-nothing rule and re-check are unchanged.

## Home: the invitation and kept changes

- **Invitation** (`invitationVisible({ dismissed, status, helperReady })`): helper set up, 0 pieces, no open session, not dismissed (G64). A `content-card` at the top of Home's lower area (below Home's primary), never above her drafts: `home.voiceInviteHeading` "Show your writing helper how you sound" / `home.voiceInviteText` "Write for three minutes on a prompt you choose. It's just for your helper and never appears on {product}." `home.voiceInviteStart` "Try it" (→ `#/voice/write`) / `home.voiceInviteDismiss` "No thanks" → `POST voice/invitation {dismissed: true}`, card goes, focus to the next card, toast `home.voiceInviteGone` "Okay. It's under Writing helper whenever you want it." **Undo**. Failed: card stays, `home.voiceInviteNotSaved` "That couldn't be remembered just now. Try again later."
- **Kept on this phone** (principle 4): when `voiceCopiesOnPhone(storage, user)` finds a rough copy for an open session or a polished copy with changes, Home's kept-on-this-phone list adds `home.voiceKept` "Your writing voice: changes kept on this phone." + **Open** (the piece, or `#/voice/write`).

## Describe a new look (`#/look/design`)

### On Look

Look gains one card after its controls, before the bar, only when the helper is set up (`meta.quizGeneration`, confirmed by `assistant/status`); else nothing (Find still opens the screen in its off state):

```
| -- Make a new look from your words ---- |  h3 look.designHeading
| Describe the colors and feeling you     |  look.designText
| want. Your writing helper drafts a look |
| you can see before you save it.         |
| [Describe a new look]                   |  secondary, look.designOpen
```

**One place per fact.** Look chooses, for every look, the main colour, lettering, size, corners, spacing, width and heading weight on top of whatever look is up. Describe a new look makes a **new look** (a theme folder) with its own six colours per scheme, lettering, corners and size; Decorations decides when it's up. The new-look screen never shows Look's controls; it says which of Look's choices will still apply on top (`lookOverrides(look, honored)`).

### The screen

- **Job:** "Make a new look from my words." Primary **Draft a look**, then **Save this look**.
- **Loads:** `GET theme-draft` (looks to start from), `GET assistant/status`, `GET look` (for the overrides line).

```
400 px (describe)                             Desktop (>= 64rem): form 1fr | result 1fr
+------------------------------------------+
| Home > Look > Describe a new look        |
| Describe a new look                      |  h1 design.title
| Say what you'd like: the colors, the     |  design.lede
| feeling, how big the writing is…         |
| Start from     [Everyday          v]     |  select-field design.baseLabel
| Your new look keeps this look's layout   |  design.baseHelp
| and seasonal touches…                    |
| Describe the look you want               |  text-field rows 4, max 1,000
| [For example: warm and cozy, deep red  ] |  design.describePlaceholder
| [and pine green, big easy-to-read…     ] |
| Or start from an idea                    |  cluster of 5 secondary buttons
| [Warm and cozy] [Spring garden]          |
| [Bold and clear] [Fall harvest]          |
| [Calm night]                             |
| What goes to Anthropic: your description,|  design.goes, + Word for word
| your site's name and the name of the     |
| look you start from. Nothing else.       |
|==========================================|
|                         [ Draft a look ] |
+------------------------------------------+
```

```
400 px (result, below the form; focus to its heading)
+------------------------------------------+
| Warm and cozy                            |  h2 = draft.label (helper text)
| Deep reds and greens with warm gold      |  draft.summary
| links, on a soft cream page.             |
| Here's an idea. See it on your front     |  design.resultNote, status
| page, change it if you like, then save.  |
| (i) Changed a little so it's easy to read|  alert-banner info design.madeReadable
|   · In dark mode, the quiet writing is a |  noteWords(note)
|     little lighter.                      |
| Colors for  (Light | Dark)               |  segmented-control design.schemeLabel
| ■ Page                       [Change]    |  chip (aria-hidden) + role name
| ■ Boxes                      [Change]    |
| ■ Writing     ✓ Easy to read [Change]    |  design.easyToRead on writing roles
| ■ Quiet writing (dates and notes) ✓ …    |
| ■ Edges                      [Change]    |
| ■ Links and buttons ✓ Easy to read [..]  |
| While a main color is chosen on How your |  design.lookAccentNote, only then
| site looks, links and buttons use that.  |
| Lettering: Classic for writing, Modern   |  design.letteringLine
| for headings. Corners: Soft. Writing     |
| size: Large.                             |
| [ See it on your front page ]            |  secondary, opens the preview sheet
| Want something different? Say what to    |  text-field rows 2
| change [a little warmer, less green    ] |
| [Change it]   Back to the one before     |  history link only after a change
| Name [Warm and cozy                ]     |  text-field, max 40
| How it's listed in Decorations.          |  design.nameHelp
| > For {helper}                           |  hex values, ratios, theme.json, base
|==========================================|
|                      [ Save this look ]  |
+------------------------------------------+
```

At 320 px: idea buttons wrap one per line; each swatch row stacks the Change button under its name; the segmented control stays one row (two short words).

| State | Words |
| --- | --- |
| Helper off | `empty-state` `design.helperOff` "Your writing helper isn't turned on, so it can't draft a look." + `common.tell`; details: **Set it up** → `#/helper` |
| No signal | `design.noSignal` "Drafting a look needs a signal. What you typed is kept here." (Draft `aria-disabled`) |
| Empty description | `design.describeEmpty` "Describe the look you want in a few words first." (linked to the field) |
| Too long | `design.describeLong` "That's {n} letters; the most is 1,000. Say it a little shorter." |
| Drafting | `design.drafting` "Drafting a look… This can take a minute."; 20 s `design.still` "Still drafting." + `common.stopWaiting` → `design.stopped` "Stopped waiting. Nothing changed." |
| Changing | `design.changing` "Changing it…"; on success the change box empties |
| Back | `design.back` "Back to the one before" → `design.backDone` "Back to the one before." (history of up to 20 drafts, memory only) |
| Result | `design.resultNote` "Here's an idea. See it on your front page, change it if you like, then save it." |

**Fixed words:** `design.title` "Describe a new look"; `design.lede` "Say what you'd like: the colors, the feeling, how big the writing is. Your writing helper drafts a look and shows it on your own front page. Nothing changes until you save it and put it up."; `design.baseLabel` "Start from"; `design.baseHelp` "Your new look keeps this look's layout and seasonal touches, and changes the colors and lettering."; `design.describeLabel` "Describe the look you want"; `design.describePlaceholder` "For example: warm and cozy, deep red and pine green, big easy-to-read writing."; `design.ideasLabel` "Or start from an idea"; `design.draft` "Draft a look"; `design.goes` "What goes to {company}: your description, your site's name and the name of the look you start from. Nothing else."; `design.changeLabel` "Want something different? Say what to change"; `design.changePlaceholder` "For example: a little warmer, and less green."; `design.change` "Change it"; `design.see` "See it on your front page"; `design.nameLabel` "Name"; `design.nameHelp` "How it's listed in Decorations."; `design.save` "Save this look".

**Ideas** (name / text pairs, `design.idea1Name`/`design.idea1` … 5; pressing one fills the box and focuses it): "Warm and cozy" / "Warm and cozy: deep red, pine green and a little gold, with big easy-to-read writing." · "Spring garden" / "Spring garden: soft greens and lilac on a light page, gentle and airy." · "Bold and clear" / "Bold and clear: navy, white and one strong red, square corners, easy to read from across a room." · "Fall harvest" / "Fall harvest: pumpkin, wheat and deep brown, warm like a farm table." · "Calm night" / "Calm night: a dark blue page with warm gold links, quiet and easy on the eyes."

**Roles** (`design.rolePage` "Page", `design.roleSurface` "Boxes", `design.roleText` "Writing", `design.roleMuted` "Quiet writing (dates and notes)", `design.roleBorder` "Edges", `design.roleAccent` "Links and buttons"); `design.schemeLabel` "Colors for", `design.schemeLight` "Light", `design.schemeDark` "Dark"; `design.easyToRead` "Easy to read"; `design.letteringLine` "Lettering: {body} for writing, {heading} for headings. Corners: {corners}. Writing size: {size}." (values from `look-rules` `CHOICES` labels; `theme` → `design.fromBase` "as in {base}"); `design.lookAccentNote` "While a main color is chosen on How your site looks, links and buttons use that instead." with link `design.lookLink` "How your site looks"; `design.lookOverrides` "Your choices on How your site looks still apply on top: {choices}." (when any other honoured control is set).

### Colours she picks, and what's guaranteed ⚑ 7

- **Change {role}** (`design.changeColor` "Change {role}") opens a native `input type="color"` (labelled "{role} color", `design.colorLabel`), as Look's "Choose your own". The pick goes into the draft (`withColor(draft, scheme, role, hex)`), then `POST theme-draft/preview` returns the readable colours (G66) and the swatch shows **those**. Status: `design.colorPicked` "{role} changed." or, when moved, `design.colorAdjusted` "{role} changed, and made a little {way} so it's easy to read." (`design.darker` "darker", `design.lighter` "lighter"); toast **Undo** (the colour before). `design.useSuggested` "Use the suggested {role}" puts the helper's colour back.
- **Before the answer** (client, `readablePairs(colors)`, a port of `look_contrast::contrast`): a writing colour under 4.5:1 on Page or Boxes says `design.colorWillAdjust` "That's hard to read on this page color, so your blog will adjust it until it's easy to read." The server decides the final colour; the client never saves its own.
- **The guarantee** (server, `ThemeDraft::to_theme`, both schemes, on Page and Boxes): Writing 7:1 where possible and never under 4.5:1; Quiet writing ≥ 4.5:1; Links and buttons ≥ 4.5:1, and the text drawn on a button ≥ 4.5:1; control outlines and focus rings from the accent's border ≥ 3:1; Edges ≥ 1.5:1 (decoration only: nothing relies on them). A colour that can't reach its target is **replaced** (writing → black or white, quiet → writing, links → writing) and said (`design.noteReplaced` "In {scheme}, the {role} couldn't be made easy to read, so it uses {replacement} instead.", G67). Nothing she picks can be saved unreadable: preview and save both rebuild from the draft on the server.
- **Notes in words** (`noteWords(note)`, G67): `design.noteDarker` "In {scheme}, the {role} is a little darker so it's easy to read." / `design.noteLighter` "…a little lighter…"; `{scheme}` is `design.inLight` "light mode" / `design.inDark` "dark mode". Until G67, the server's sentences show as they are.
- **Never colour alone:** each swatch has its role's name; "Easy to read" carries a ✓ shape; hex values and ratios ("Writing on Page: 12.4 to 1") are in details.

### See it, save it, put it up

- **See it on your front page:** `showPreview` with `request: () => api.post("theme-draft/preview", {draft, mode, base})`, heading `design.previewHeading` "Your front page in the new look", back `design.previewBack` "Back to your new look", note `design.previewNote` "Only you can see this. Nothing is saved yet.", frame title `design.previewFrame` "Your front page in the new look"; `preview.js` gains an optional second `segmented-control` (Light / Dark) that re-requests with `mode`. The preview wears the draft with seasons, the owner's scripts and counters off (server, unchanged), and Look's choices applied as the live site applies them (G66).
- **Name:** `design.nameEmpty` "Give your new look a name.", `design.nameLong` "Keep the name to 40 letters or fewer.", `design.nameLine` "Keep the name on one line.", `design.nameTaken` "You already have a look called “{name}”. Choose another name." (client from `GET theme-draft` labels; server G69).
- **Save:** `design.saving` "Saving…" → card (focus to it): `design.saved` "Saved as “{name}”. It isn't on your site yet." + primary `design.putUp` "Put it up now" (Decorations' `askPutUpNow`, unchanged) + secondary `design.addSeason` "Add it to your calendar" (→ `#/decorations?add=<name>`, which opens Decorations' season sheet with that look; a one-line change there) + toast **Undo** (`DELETE theme-draft/<name>` with `undoToken`, G68; toast `design.unsaved` "“{name}” is gone."; after 10 minutes or once it's up or on the calendar, no Undo). `buildError`: `design.savedNotBuilt` "Saved as “{name}”. Your site couldn't be updated just now; it will be with your next change." (details: the server's sentence).
- **Leave guard:** a draft not saved: `design.leaveAsk` "Leave without saving this look?" / `design.leaveText` "The look your helper drafted isn't kept anywhere." `design.leaveStay` "Stay" (focused) / `design.leaveGo` "Leave". Typing in the description alone is not unsaved work.
- **For {helper}:** base theme name, the draft JSON (read-only, mono), hex per role and ratios per pair, `themes/<name>/theme.json` after save, `extends`, skill-free note "The helper may only propose six colours per scheme, a font, corners and a size; the server refuses anything else."

## Errors by code

Every helper call first goes through R8's `helperProblem` (busy, provider busy/down, timeout, invalid result, refused, cut short, key rejected, turned off, 401, no signal). Then:

| Route | Answer (code, G63/G65) | Her words | Mikey (details) |
| --- | --- | --- | --- |
| `voice/session/start` | 409 `already-open` | the in-progress card above | session id, expired |
| | 409 `refused` | `voice.startRefused` "That prompt can't be used. Choose another." | server sentence |
| `voice/session/draft` | 409 `time-up` | locks (no words of its own) | |
| | 409 `other-session` / `no-session` | reloads the step; `voice.sessionMoved` "This piece was finished somewhere else." | |
| | 413 `too-long` | `voice.roughTooLong` "That's more than a piece can hold. What's here is saved." | 60 KiB |
| `voice/session/lock` | 409 `empty` | `voice.nothingYet` (or Choose, when time ran out) | |
| `voice/draw` | 404 `pack-gone` | draws from every set | pack id |
| `voice/samples` POST/PUT | 409 `conflict` | the conflict dialog | revision |
| | 409 `refused` (`not-polished`, unreadable rough) | `voice.cantPolish` "This rough draft can't be read, so it can't be polished." + `common.tell` | guidance |
| | 422 `invalid` | `voice.polishInvalid` "That couldn't be saved. Check the title has no line breaks." | server sentence |
| `…/promote` | 409 `slug-taken` | `voice.postTaken` | slug |
| | 409 `not-polished` | (no button) | |
| `…/visibility`, `voice/guide/move` | 409 `refused` / `already-there` / `ambiguous` | (details only) server sentence | |
| `voice/erase` | 409 `confirm-word` | `voice.eraseFailed` | |
| `assistant/voice-guide` | 400 `no-pieces` / `too-many` / `over-budget` (G55) | `voice.guideNoneTicked` / `voice.guideOver` | ids, budget |
| | 409 skill problem | `voice.guideCantNow` "Your helper can't make a voice guide right now." + `common.tell` | skill sentence |
| `PUT assistant/context` (guide) | 409 etag | `voice.guideChanged` "Your voice guide was changed somewhere else. Make it again to compare with the new one." | |
| | 422 portable refused | (details only) | |
| `theme-draft` | 400 `no-description` / `too-long` | `design.describeEmpty` / `design.describeLong` | |
| | 422 `base-gone` | `design.baseGone` "That look isn't on your site any more. Choose another to start from." | name |
| | 502 `invalid-result` | `design.badIdea` "Your helper's idea couldn't be used, so nothing changed. Try again, or say it another way." | server sentence |
| `theme-draft/preview` | 422 (content problems) | `design.previewFailed` "Your front page couldn't be shown just now. Your new look is still here." | problems |
| `theme-draft/save` | 409 `name-taken` / folder `exists` | `design.nameTaken` | name |
| | 422 `bad-draft` | `design.cantSave` "This look couldn't be saved. Try drafting it again." | reason |
| | 500 | `design.notSaved` "That wasn't saved. Try again in a moment." | sentence |
| any voice route | 500 | `voice.serverTrouble` "{product} couldn't do that just now. Your writing is kept on this phone." | sentence (paths scrubbed) |
| any | status 0 | the screen's no-signal words | |

Until G63/G65, `voiceProblem(error)` and `designProblem(error)` map today's flags (`alreadyOpen`, `timeUp`, `otherSession`, `noSession`, `empty`, `conflict`, `refused`, `ambiguous`, `invalid`) and statuses.

## No signal

- **Writing:** typing continues; the copy is kept (0.3 s) and the clock keeps its server deadline; the save line says `voice.keptPhone`. The lock retries, then says which of the three failure sentences fits. Opening the page again with a signal runs the expired plan: a copy kept before the deadline + 10 s and longer than the server's is locked; nothing gets extra time.
- **Polishing:** unsaved changes stay on the phone (30 days) and are offered back.
- **Hub, piece, guide, design:** need a signal to load or send; each says so in words; nothing is queued to send later.

## Undo

| Action | Undo |
| --- | --- |
| Start the copy over | toast **Undo** (editor text back) |
| Throw away kept changes | toast **Undo** (the copy back from memory) |
| Use the saved one (conflict) | toast **Undo** (her text back) |
| Polished copy saved (again) | none needed: the editor holds the text; first save leaves the rough draft unchanged |
| Turn it into a post | toast **Undo** (`DELETE document`; R-level restore) |
| Move a piece / the guide (details) | toast **Undo** (move back) |
| Voice guide saved | toast **Undo** (PUT the previous text, or `DELETE` the new file) |
| Don't save these | nothing was written; says so |
| Invitation No thanks | toast **Undo** (`POST voice/invitation {dismissed: false}`) |
| Change it / Change {role} | **Back to the one before** / toast **Undo** |
| Save this look | toast **Undo** for 10 minutes while not up (G68) |
| Start over, Throw it away, Erase it all | none: asked once, saying it can't be undone |

## Data safety: the `ob-voice-*` keys

- **Where:** `localStorage` on the Studio origin (the same origin as the old Admin, so copies made in either survive the switch). `ob-voice-draft:<user>` → `{v: 1, sessionId, deadline, text, savedAt}`; `ob-voice-polished:<user>:<roughFile>` → `{v: 1, base, title, body, savedAt}`. `<user>` is the signed-in name (`api.user`). Names, record versions and fields are **unchanged forever**; a record that doesn't parse or has another `v` is ignored, never rewritten or deleted.
- **Bounds:** nothing over 60 KiB is kept; rough copies expire after 1 day, polished after 30 days (lifted constants).
- **Removed only when:** the rough draft is saved on the server (lock answered), the session is scrapped by her, its deadline + grace is past with no session open, she throws away kept changes, a polished save answered and the editor matches it, an erase answered, sign-out, or another user signs in (`clearVoiceCopies({keepUser})`, by prefix only, nothing else in storage). Never because a request failed.
- **Sign-out** (⚑ 10): `shell.js signOut()` checks `voiceCopiesAtRisk(storage, api.user)` first; with a polished copy that has changes or a rough copy of an open session, `modal-dialog` `voice.signOutAsk` "Sign out and throw away your unsaved writing?" / `voice.signOutText` "Changes to your writing voice are kept only on this phone." `voice.signOutStay` "Stay signed in" (focused) / `voice.signOutGo` "Sign out". Then `clearVoiceCopies()`. Studio's sign-in calls `clearVoiceCopies({ keepUser })`, as the old Admin did.
- **Blocked storage** (private window): copies live in page memory and every screen says so (`voice.phoneRefused`, `voice.polishDirtyMemory`).
- **Never in a copy:** prompts, the guide, helper replies, design drafts, anything from `/admin/api/` beyond the two records. The worker never caches API replies (unchanged).

## What each owner sees

| | Non-technical owner | Trade owner | Developer |
| --- | --- | --- | --- |
| Finding it | Home invitation; Writing helper screen line | same; Trades set in "not written yet" | Find, every link, details |
| Writing | prompt, clock, box, I'm done | same | + session file, CLI equivalents |
| Pieces | titles, badges, words, date, Open | same | + file, private/portable, path, bytes, revision, Move |
| Guide | ticked pieces, what goes, traits with Keep/Use, Save | same | + diff, text editing, both saves, provenance, Move, one-sample list |
| Erase | one dialog with counts | same | + every path and kind |
| New look | describe, ideas, colours, Easy to read, Change {role}, front page, Save, Put it up | "Bold and clear" idea; Put it up now | + hex, ratios, draft JSON, theme path, base, server notes |
| Errors | one sentence; nothing of hers lost | same | + code, status, server sentence |

## Rules each part uses (static imports, DOM-free, tested)

| Part | File | Functions |
| --- | --- | --- |
| Voice rules | new `parts/voice-rules.js` (lifted from `web/admin/voice.js` and `voice-session.js`) | `VOICE_LIMITS`, `byteLength`, `wordCount`, `wordsText`, `formatClock`, `spokenTime`, `timerState`, `timerLabel` (→ `{state, symbol, id, vars}`), `createCountdown`, `createAnnouncer` (→ `{id, vars}`), `reconcileDraft`, `expiredPlan`, `copyIsPastGrace`, `polishedDirty`, `groupLibrary`, `coverageText`, `gapLines` (→ data), `STAGE_BADGES`, `ROUGH_ATTRIBUTES`, `invitationVisible({dismissed, status, helperReady})`, new `sessionView(answer)`, `guideCard(...)`, `eraseSummary(plan)`, `voiceProblem(error)`, `voiceHash`, `pieceHash` |
| Copies on the phone | new `parts/voice-copies.js` (storage injected) | `createVoiceDraftStore`, `createPolishedDraftStore`, `clearVoiceCopies`, `ROUGH_COPY_TTL_MS`, `POLISHED_COPY_TTL_MS`, new `voiceCopiesOnPhone(storage, user, now)`, `voiceCopiesAtRisk(storage, user, now)` |
| Voice guide | new `parts/voice-guide-rules.js` | `voiceGuideDiffLines`, `voiceGuideAssemble`, `voiceGuidePendingChanges`, `voiceGuideTraitParts` (was `…TraitText`), `voiceGuideCheckNote` (→ id), `voiceGuideSaveRequest`, `voiceGuidePortableNote`, new `defaultGuidePieces(samples, budget)`, `guideSaveTarget(proposal)`, `guideWhatGoes(selection, current, company)` |
| Design | new `parts/design-rules.js` (lifted from `theme-designer.js`) | `IDEAS` (ids), `MAX_DESCRIPTION`, `MAX_LABEL`, `swatches(theme, scheme)` (role ids), `descriptionProblem`, `labelProblem(text, taken)`, `renamed`, `startFrom`, `designProblem(error)`, new `withColor`, `contrastRatio(hexA, hexB)`, `readablePairs(colors)`, `noteWords(note)`, `lookOverrides(look, honored)`, `pushDraft`/`backDraft` |
| Words | new `parts/writing-voice-words.js` (`voice.*`, `home.voice*`, `helper.voice*`), `parts/design-words.js` (`design.*`, `look.design*`); `parts/common-words.js` adds `common.whatGoes` "What goes to {company}", `common.wordForWord` "Word for word", `common.stopWaiting` "Stop waiting", `common.tryAgain` "Try again" | (`parts/voice-words.js` is R4's voice-note sheet; its ids, when migrated, use `note.*`, so `voice.*` stays this area's) |
| Routing | `router.js` | `legacyRoute` rows above; `NOT_YET` loses `design`, `voice` |

All her-layer ids: `layer: "her"`; details-only ids (`voice.makePortable`, `voice.makePrivate`, `voice.moved`, `voice.savePrivate`, `voice.savePortable`, `voice.guidePortableBlocked`, `voice.guideEditLabel`, `voice.guideMoved`): `layer: "details"`. Ids whose text uses `{helper}` or `{product}` need no `bare`; none use `{owner}`.

- **Port:** `admin-voice-session` → `studio-voice-rules` (clock, countdown, labels) + `studio-voice-write.spec.mjs` (draw, start, finish, start over, already open, autosave, too-late lock, leaving asks); `admin-voice-access` → `studio-voice-rules` (announcer marks, resumed, gap) + `studio-voice-write.spec.mjs` (focus moves, timer not live, Tab order, axe each step, reduced motion); `admin-voice-draft` → `studio-voice-copies` (every case, keys and shapes byte-identical, TTLs, prefix clear, keepUser, blocked storage) + `studio-voice-write.spec.mjs` (reload resumes, no time back, lock fails keeps copy); `admin-voice-guard` → `studio-voice-rules` (`polishedDirty`) + `studio-voice-piece.spec.mjs`; `admin-voice-library` → `studio-voice-rules` (grouping, order, coverage, gaps) + `studio-voice.spec.mjs` (hub); `admin-voice-open` → `studio-voice-piece.spec.mjs` (rough read-only, polish, conflict, reset + Undo, move, make post + slug taken + Undo, 404); `admin-voice-erase` → `studio-voice-erase.spec.mjs` (nothing until asked, list shown, Keep it, clean, partial, failure); `admin-voice-invitation` → `studio-voice-rules` (`invitationVisible`) + `studio-home.spec` case; its "preferences keep their shape" case is **deleted** (route gone; G64 route tests replace it); `admin-voice-context-warning` → `studio-voice.spec.mjs` (tracked private piece: her line + server sentence in details); `admin-assistant-voice` guide cases (diff lines, save request, propose writes nothing, no-sample/over-budget makes no request, portable blocked, private first, assemble only when decided, check notes) → `studio-voice-guide-rules` + `studio-voice-guide.spec.mjs` (its budget/disclosure/voice-match cases went to R8); `admin-theme-designer` → `studio-design-rules`; browser `voice-session.spec`, `voice-accessibility.spec` → `studio-voice-*.spec.mjs`; `voice-assistant.spec` guide propose/merge/move → `studio-voice-guide.spec.mjs`.
- **New:** `ob-voice-*` keys written by the old Admin's code are read by Studio's stores and vice versa (fixture records); `clearVoiceCopies` leaves every non-voice key untouched; `voiceCopiesAtRisk` true for a dirty polished copy and an open rough copy, false for expired ones; `ROUGH_ATTRIBUTES` all present on the rendered box, inside the shadow root if any; `defaultGuidePieces` never exceeds 8 or 120,000 letters and prefers rough; `guideSaveTarget` never returns portable when `portableAllowed` is false; `contrastRatio` equals `look_contrast::contrast` on `tests/fixtures/contrast-pairs.json` (shared with a Rust test); `noteWords` covers every note kind; `IDEAS` and every R9 default pass the persona test and `HER_BANNED`; `withColor` refuses non-hex.
- **Browser:** `studio-design.spec.mjs` against a `custom-https` stub: helper off hides Look's card; draft, swatches light/dark, a stub reply with unreadable colours shows the adjusted swatch and the note; Change Writing to `#777777` on white shows "made a little darker"; preview sheet light/dark; name taken; save → Put it up now (Decorations shows it up) → Undo refused once up; leave guard; 320 px, axe, keyboard only.

## Accessibility and keyboard

- **Writing:** focus lands in the box on Start; the clock is `role="timer"` and silent; one polite region speaks only the marks, resumed and the lock; warning is a word and ▲, never colour alone; under reduced motion nothing pulses. The bar stays reachable above the on-screen keyboard and joins the page when it would take over 40 % of the height (Studio's write-bar rule).
- **Names:** "Open: {title}", "Write one from {pack}", "Change Writing", "Writing color", "Keep what you had: {statement}", "Use the new one: {statement}", the rough region "Your rough draft, as you wrote it", the timer "Time left".
- **Keys:** Ctrl/⌘ Enter = Start writing (Choose), I'm done (Write), Save polished copy (Polish), Make/Update my voice guide (step 1), Save my voice guide (step 2, only when ready), Draft a look / Change it (whichever box has focus). Ctrl/⌘ S = Save polished copy / Save this look. Alt+← = back a step. Escape closes dialogs and the preview; never stops the clock.
- **320 px:** one column everywhere; choice cards stack; the rough box ≥ 40 % of the screen; swatch rows stack; quotes and diff lines wrap (`pre-wrap`); no sideways scroll.
- **Zubra:** `choice-cards`, `text-field` (rough box: must pass `spellcheck`, `autocorrect`, `autocapitalize`, `autocomplete`, `writingsuggestions` and the `data-gramm*` attributes to its `textarea`; if it can't, fix in zubra-ui and re-vendor), `action-button`, `status-badge`, `content-card`, `empty-state`, `modal-dialog`, `alert-banner`, `segmented-control`, `select-field`, `side-sheet` (preview), `toast-region`, `skeleton-block`, `dropdown-menu` (More), `cluster-layout`. Checkboxes and radio pairs in the guide use the native `fieldset` fallback (as R5–R8). The colour picker is the native input (as Look).

## Safety

- **Rough text is never changed by Studio or a helper:** no route writes it; the box refuses browser and extension help; no helper reply is applied to a piece or a polished copy.
- **Helper text is data:** guide statements, quotes, look names and summaries are `textContent`, clipped, never links or markup. The server already checks every quote is word for word in its piece and every look field against a fixed list (unknown fields refused, colours as hex only, fonts from five stacks).
- **Colours reach the page only as checked tokens** in a theme file the server writes; swatches set `--swatch` with `style.setProperty` (policy-safe).
- **Paths:** server answers carry project-relative paths only; shown in details only.
- **Private stays private:** pieces default private and can't be made portable from her layer; a guide that quotes private pieces can't be saved portable (server and client).

## Gaps

- **G63. Voice answers carry codes:** every `voice/*` refusal adds `code` beside today's flags: `already-open`, `time-up`, `other-session`, `no-session`, `empty`, `refused`, `conflict`, `ambiguous`, `invalid`, `too-long`, `pack-gone`, `not-polished`, `slug-taken`, `already-there`, `confirm-word`. Flags stay one release.
- **G64. The invitation's dismissal lives with voice:** `GET voice/status` adds `invitationDismissed`; `POST voice/invitation {dismissed: bool}` writes `.openblog/private/voice/invitation.json` per user (hashed name, like preferences). Reading carries over `voiceInvitationDismissed: true` from `.openblog/private/admin-preferences/<hash>.json` until R15 deletes that file's code; R15 keeps the carry-over read.
- **G65. Theme-draft answers carry codes:** `no-description`, `too-long` (G55 shape), `base-gone`, `bad-draft` (+ `field`), `exists`; provider failures use R8's G54 codes (already listed there for `theme-draft`).
- **G66. The preview says what it made:** `theme-draft/preview` returns the readable `colors.light`/`colors.dark` (as `theme` in `POST theme-draft`) and applies the site's Look choices exactly as a build does, listing them as `lookApplied: ["accent", …]`.
- **G67. Readability notes as data:** each note `{scheme, role, change: "darker" | "lighter" | "replaced", from, to, with?}` plus today's sentence; the fallbacks that are silent today (writing → `text_on`, quiet → writing, accent → writing) become `replaced` notes.
- **G68. Undo a saved look:** `theme-draft/save` returns `undoToken` (random, 10 minutes, this session); `DELETE theme-draft/<name>?undo=<token>` removes only that folder, only if it's not the site's look, not in `seasons.windows`, not `upNow`, and unchanged since save; then rebuilds. 409 `in-use` / `expired` otherwise. Logged without the token.
- **G69. Names are unique:** `theme-draft/save` refuses 409 `name-taken` when another look's label matches (trimmed, case-insensitive), not only a folder.
- **Depends on R8:** G54 (provider codes on `voice-guide`, `theme-draft`), G55 (`over-budget`, `too-many` on `voice-guide`), G58 (light catalog and `context/item` for the guide).
- **Not gaps:** `voice/status`, `draw` (`exclude`, `pack`), `session` GET/DELETE, `start`, `draft`, `lock` (grace, finishing), `samples` GET/POST, `samples/{id}` GET/PUT/visibility/promote, `erase` GET/POST (all or nothing, re-check), `guide/move` GET/POST, `assistant/voice-guide` (merge, provenance, `portableAllowed`, targets), `PUT assistant/context` (voice), `theme-draft` GET/POST/preview/save. **Deleted:** `voice/catalog` (Decided 2).

## Risks to test before release

- The old Admin and Studio open at once on one phone, same user: both write `ob-voice-draft:<user>`; reconcile keeps the longer; neither clears the other's copy except on lock.
- iPhone Safari and Android Chrome: the rough box shows no suggestion bar, no autocorrect, no Grammarly, and the keyboard doesn't capitalise; the bar stays above the keyboard.
- A terminal session (`openblog voice --seconds 600`) resumed in Studio shows 10 minutes, not 3.
- Leaving Write a piece and coming back after the deadline: the server locks the saved text; the longer phone copy wins only if kept before deadline + 10 s.
- Sign-out on a shared iPad with a dirty polished copy asks; another user signing in never sees it.
- A site with both a portable and a private guide: Save writes to the one R8's Sound like me reads (`voiceGuideOf`), and details name both.
- A designed look worn while Look has an accent override: the preview and the live site match (G66).
- A stub helper returning white writing on cream, and a page colour equal to the writing colour: the saved theme passes 4.5:1 everywhere, both schemes.
- Undo of a saved look after it was put up from another tab: refused in words, nothing deleted.
- Erase with a piece in progress in another window: that window's next save gets `no-session` and says so.

## Docs and release note

- Rewrite `docs/admin.md` §Write a voice sample in Admin, §Erase your voice data and the guide part of §Use voice samples as **Your writing voice** (hub, Write a piece, A piece, Your voice guide, Erase), with the old→new addresses; keep the terminal and file sections. §Design a theme → **Describe a new look** (under Look; Change {role}; readability guarantee; Put it up now / calendar; Undo for 10 minutes). `docs/themes.md` l.225: Studio's screen name and route. `docs/studio-words.md` gains the R9 ids (generated).
- **Release note:** Voice is now **Your writing voice** in Studio: write a three-minute piece, polish a copy, turn it into a post, and make your voice guide from your pieces, choosing for each change; erase everything from one dialog. Copies kept on your phone carry over. **Design a theme** is **Describe a new look** under Look: describe it, see it on your front page in light and dark, change any colour (your blog keeps it easy to read), save it and put it up at once. `voice/catalog` is removed. The voice invitation's "No thanks" is remembered on the server; earlier dismissals carry over.

## Changes to `studio-ux` (proposed)

- **Her raw words are sacred.** A screen that collects writing "as she really writes" turns off every correction it can, never lets a helper change it, and says why in one sentence.
- **A clock the server owns.** Timed tasks show time as digits, a word and a shape; announce only marks; never give time back; ask before leaving while it runs.
- **Colours she picks are made readable, and said.** Any colour an owner chooses is checked on the server against both schemes (writing 7:1 target, 4.5:1 floor; controls 3:1); a colour moved or replaced is shown as it will be, with a sentence saying what changed. The client may warn early but never decides.
- **New things are undoable briefly.** Creating a file she can see in a list (a look, a post from a piece) offers Undo until the thing is in use.
- Banned on her layer, add: sample, portable, pack, session, catalog, provenance, diff, revision, hex, contrast ratio, theme (say "look").
- Review checklist: "Anything kept on this phone is named on Home and asked about before sign-out."
