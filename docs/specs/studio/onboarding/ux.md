# Studio UX, slice R9b: Getting started (onboarding)

By `studio-ux` with `studio-architect`, 2026-11-14. Sources: the owner's request of 2026-11-14 (below), `studio-ux`, `studio-architecture`, `words/spec.md` (`say(id, vars)`, `{helper}` `{product}` `{owner}`, precedence, persona rule, banned list), `r8/ux.md` (key write-only, `keyShape`, `keyFieldAllowed`, `settingsRequest`, `helperProblem`, `companyName`, "what goes" box, G54–G62), `r9/ux.md` (pieces, `voice/session/*`, rough box, three-minute clock, voice guide steps 1–2, 8-piece / 120,000-letter limit, `ob-voice-*` keys, Home invitation, G63–G69), `r4/ux.md` (`createRecorder` states, `micSteps(here)`, Turn it into words disclosure, `transcribeTrouble`), `r3/ux.md` (installed app: no Back button, `herePhone`, `deviceNoun`), `retirement-plan.md` §4; `docs/deploy.md` (Docker/Render/Railway variables, `OPENBLOG_STUDIO_WORDS_PATH`); server: `auth.rs` (users in `.openblog/users.json`, sessions in memory, all accounts equal), `admin_preferences.rs` (per-user private file under `.openblog/private/admin-preferences/<sha256>.json`, `voiceInvitationDismissed`), `admin.rs:4586–4625` (provider → env key name: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, …), `assistant/transcribe.rs` (only OpenAI/Gemini or `OPENBLOG_TRANSCRIBE_COMMAND` can hear), `voice_store.rs` (site-wide library, private/portable, `SITE_CATALOG_PATH`), `voice_prompts/catalog.md` (bundled packs), `admin/studio_words.rs`, `docker-entrypoint.sh` (`OPENBLOG_ADMIN_USER`/`PASSWORD`); old Admin: no first-run flow exists (searched `onboard`, `first run`, `welcome`, `setup`, `getting started` in `web/admin`); its only first-use prompt is the voice invitation (`admin.js:12638`, `buildVoiceInvitation`); Studio: `router.js`, `shell.js`, `parts/capture-recorder.js`, `zubra/components.json` (no `step-indicator` yet).

**The owner's request (Mikey, 2026-11-14, verbatim):** "On first load it should walk a user through a user onboarding that starts off gathering the users API key for an LLM unless it's already in the environment file (when I launch grammis it will be) the first thing it should do is prompt the user to tell some stories, just short stories and do its best to get the users natural writing and speaking voice. They can choose to skip but if they do and end up trying to write a post, it should nudge them again to do it and explain how it helps. Other than that with onboarding an environment flag should be able to trigger it so that I can test it for my mom then give her the password and set the flag to true so I know she will be on boarded well."

**Studio is a product.** Personas judge screens; no default names a person, family, food or site. Every her-layer string is a word id (`say(id, vars)`); `{company}` is R8's `companyName(status)`, passed per call.

**Owners:**
- **A non-technical owner** ("Grammi" in tests): signs in for the first time with a password her son gave her. Wants to be told what to do next, in plain words, and to know her stories stay hers.
- **A trade owner** ("Dana"): would rather say a story out loud in the truck than type it.
- **The developer** ("Mikey"): wants to rehearse the whole thing signed in as her, then hand it over knowing she gets it fresh; wants to see where each account is, and reset it.

**The job:** "Get me ready to write, and teach the helper how I sound." In at most three short steps: turn on the writing helper (only when no key exists), tell a few short stories (typed or out loud), let the helper learn from them. Skippable everywhere; nothing lost when she leaves; one gentle reminder in Write if she skipped the stories.

**Decisions the owner should check** (⚑ where they appear):
1. ⚑ **The flag** is `OPENBLOG_STUDIO_ONBOARDING` with four values: `off` (default), `on`, `on:<round>` (changing the round re-arms every account once), `rehearse` (shows every time, keeps nothing personal, never touches the real record). Rehearse with it, switch to `on`, hand over the password.
2. ⚑ **The environment wins over the site file** for this switch (`studio.onboarding` in `openblog.json` takes only `off`/`on`). This departs from the words precedence (site wins) because this is an operator's switch for one server, like `OPENBLOG_FILES_RESET`, not words.
3. ⚑ **"Environment file"** means the server's environment (Railway Variables, `docker run -e`/`--env-file`, compose `env_file`). open.blog does not read a `.env` file itself and this slice doesn't add that.
4. ⚑ **The word "key"** appears on her layer in this one step (R8 banned it), explained in one sentence; "API keys" appears once, in the steps naming the button she'll see on Anthropic's site.
5. ⚑ **Stories are R9 pieces** from a new bundled set, **Getting started** (6 generic prompts, 40–150 words). Typed stories use R9's three-minute clock and rough box unchanged; spoken stories are up to three minutes and their transcript becomes the rough draft, as said.
6. ⚑ **Three stories** is the ask; one is enough to count as done. Stories are private, never published, and each can be thrown away (a per-piece **Throw this piece away** is added to R9's A piece, G78).
7. ⚑ **Out loud only when something can hear.** Speaking needs OpenAI or Gemini, or a local engine (`OPENBLOG_TRANSCRIBE_COMMAND`). With an Anthropic helper, G76 lets an `OPENAI_API_KEY`/`GEMINI_API_KEY` in the environment be used for turning recordings into words only. Without any, **Say it out loud** isn't offered.
8. ⚑ **The nudge** appears only when she opens a new post, never while typing; at most once every 7 days, at most 3 times ever; **Don't ask again** stops it for good. It comes only if she skipped the stories and has no pieces at all.
9. ⚑ **Auto-open** happens only on a fresh Studio load at Home (or the start address), never over a screen she opened from a notification or link; after **Finish later**, at most once a day, otherwise a Home card.
10. ⚑ **Any account can see and reset any account's Getting started** in Home's details (accounts are equal on a site today); every reset is logged.
11. ⚑ **New sites are onboarded by default**: `openblog new` writes `"studio": {"onboarding": "on"}` (G80). Existing sites see nothing until the flag or the file says `on`.

**Her words:** "getting started", "your writing helper", "key" (this step only), "story", "tell", "type it", "say it out loud", "kept private", "never appears on {product}", "what goes to {company}", "finish later", "skip". **Never on her layer:** onboarding, flag, environment, round, rehearse, record, mode, transcribe, transcript, audio, sample, piece-file words, plus `studio-ux`'s and R8/R9's lists. Those live under **For {helper}** (`common.forHelper`).

| Job | Lands in | Route | Replaces |
| --- | --- | --- | --- |
| Get ready on first sign-in | **Getting started** | `#/start` → `#/start/<step>` (`helper`, `stories`, `voice`, `done`) | none (new; old Admin had no first run) |
| Come back to it any time | account menu **Getting started**, Find, Home card | `#/start` | — |
| Be reminded about stories when writing | Write, new post: quiet card | `#/write/new/*` | — |
| See or throw away stories later | **Your writing voice** (R9) | `#/voice`, `#/voice/piece/<id>` | — |
| See and reset each account's progress | Home › For {helper} › **Getting started** | `#/` | — |

**Route wiring:** `screens/index.js` gains `{ name: "start", area: "start", chrome: "focus", create: createStart }`. `chrome: "focus"` (new in `shell.js`) hides the navigation and Find button but keeps the account menu, so nothing pulls her away and sign-out is always there. Not in the navigation. Find: "Getting started", "Tell a few stories". No `legacyRoute` rows.

## When it shows

**Mode** (`onboardingMode`, server, G70): `OPENBLOG_STUDIO_ONBOARDING` if set, else `studio.onboarding`, else `off`.

| Value | Shows by itself | Writes | Use |
| --- | --- | --- | --- |
| `off` (or unset, or unreadable → problem) | never; still runs from the account menu, and its nudge is off | the real record when run from the menu | default for existing sites |
| `on` | once per account, round `1`, until that account's record is `done` or `skipped` | real record, real pieces, real guide | normal |
| `on:<round>` (`[a-z0-9-]{1,32}`) | as `on`, and again once for any account whose record finished a different round | same | re-arm every account without a shell (e.g. `on:2026-11-20`) |
| `rehearse` | at every sign-in and every fresh load, for every account, whatever its record says | **practice only**: a separate record and practice stories under `.openblog/private/onboarding/practice/`; the guide is proposed but never saved; a key you save **is** saved (it belongs to the site) | Mikey trying it signed in as her |

- **Practice is swept** when the server starts in any mode but `rehearse`: `.openblog/private/onboarding/practice/` is deleted and the log says "onboarding: cleared practice (3 stories)". Nothing in practice is ever read by Your writing voice, the helper or the voice guide.
- **Per account record** (G71): `.openblog/private/onboarding/<sha256(user)>.json`, mode 0600, `{v: 1, round, status: "in-progress" | "done" | "skipped", step, steps: {helper, stories, voice}, stories: [pieceId…], startedAt, finishedAt, lastAutoOpen, nudge: {shown: [isoDate…], stopped}}`. Step states: `not-needed` · `done` · `skipped` · `not-ready`. A missing record is "never started".
- **Due** (`onboardingDue(mode, record, now)`, server; `meta.onboarding` = `{mode, practice, due, step, total, resume}`): `on`/`on:r` → due when no record, or record `in-progress`, or the record's round ≠ r; `rehearse` → always due; `off` → never. **Done** = she reached the last screen (every shown step `done`, `skipped`, `not-needed` or `not-ready`). **Skipped** = **Skip the rest**. Both stop it showing by itself for that round.
- **Opening** (`startDecision(onboarding, route, now)`, client, pure): on a **fresh load with a fresh `meta`** (never the kept no-signal copy) whose route is Home or empty, when `due`: go to `#/start/<step>`, write `lastAutoOpen`. Not when the load came with another route (a tapped notification, a shared link, a Write address): Home shows the card instead. After **Finish later**, auto-open waits 20 hours (`lastAutoOpen`), the Home card stays.
- **Steps shown** (`startSteps(status, voice, record)`): **helper** only when `assistant/status` says no usable key (G56 `credential.state` `not-set` or `other-provider`); a key in the environment or saved → `not-needed`, silently, no mention. **stories** always. **voice** only when the helper is ready after step 1 and at least one story exists; otherwise `not-ready` and the done screen says why. Total shown in "Step n of N" is computed once at start and fixed (a step that turns `not-ready` is passed over without renumbering).
- **Resume:** the record keeps the step; R9's server session keeps a typed story's clock and `ob-voice-draft:<user>` its words; a recording is kept on the phone (`studio-story` below). Reload, a killed installed app or another phone all land on the same step: "Picked up where you left off." (`start.resumed`). Two phones at once: the record's etag refuses the older one, which quietly reloads to the newer step.

## The frame (every step)

```
400 px                                        Desktop (>= 48rem): one 40rem column, centred;
+------------------------------------------+  navigation hidden (chrome: focus); account menu stays
| Getting started            [Account v]   |  page title start.title; account menu (sign out)
| Welcome, Grammi                          |  h1 start.welcome (first step shown only; bare "Welcome")
| A few minutes to get your blog ready for |  start.welcomeLede (first step only)
| you. You can skip any part.              |
| Step 1 of 2  ●──○                        |  step-indicator, name "Getting started, step 1 of 2"
| -- Turn on your writing helper -------   |  h2 = the step's heading, focused on arrival
| …step body…                              |
| > For {helper}                           |  details, closed
|==========================================|
| [‹ Back]  Finish later   [ Primary ]     |  sticky above the keyboard; Back hidden on step 1
+------------------------------------------+  More (in the bar, "More: Getting started"): Skip the rest
```

- **Getting back** without browser Back (installed app): **‹ Back** (previous shown step; Alt+←), **Finish later** (Home; the step is kept; toast `start.laterToast` "It'll be here when you come back."), account menu. Escape closes only dialogs and sheets.
- **Skip the rest** (More): no dialog (nothing is lost; everything already told is kept); record `skipped`; Home; toast `start.skipRestDone` "Okay. Getting started is in the menu if you want it."
- **Practice strip** (only in `rehearse`, every step, `alert-banner info`, `layer: details`): `start.practice` "Practice run: stories and voice guides made here aren't kept. A key you save is kept."
- **No signal:** steps need a signal to load and send. `start.noSignal` "Getting started needs a signal. Anything you were writing is kept on this phone." + **Finish later**. A typed story keeps going (R9).

## Step: Turn on your writing helper (`#/start/helper`)

Shown only with no usable key. Uses R8's settings rules unchanged: `keyShape`, `keyFieldAllowed`, `settingsRequest` (field emptied before the request is built), `PUT assistant/settings` with `credentialAction: "replace"`, then G57 `POST assistant/check`. Company is the one already configured (default Anthropic); the model is left as configured, or the company's default when empty.

```
400 px                                        Desktop: same 40rem column
+------------------------------------------+
| Step 1 of 2  ●──○                        |
| Turn on your writing helper              |  h2 start.keyHeading
| Your blog has a writing helper that can  |  start.keyLede (the one "AI" sentence)
| read your posts over and suggest changes,|
| using Anthropic's AI. To turn it on, it  |
| needs a key from Anthropic.              |
| A key is a long code, like a password,   |  start.keyWhat
| that lets your blog use Anthropic's      |
| helper. Anthropic charges the account    |
| the key belongs to.                      |
| Paste the key                            |  text-field type=password (R8 attributes)
| [••••••••••••••••••••••••            ]   |
| It's kept on your blog's computer and    |  start.keyHelp
| never shown again, not even here.        |
| > Where do I get a key?                  |  details start.keyWhere
|     1. Go to console.anthropic.com and   |  start.keyStep1..4 (Anthropic only; link
|        sign in, or make an account.      |   from code, never from words)
|     2. Under Billing, add a way to pay.  |
|     3. Open API keys and choose Create   |
|        key.                              |
|     4. Copy it and paste it here.        |
| [ Skip — Mikey will set this up ]        |  secondary start.keySkip
|==========================================|
| Finish later               [Save the key]|  primary start.keySave
+------------------------------------------+
```

| State | When | Words / parts |
| --- | --- | --- |
| Ready | no key, https or localhost | as drawn |
| Can't type a key here | `keyFieldAllowed` false (plain http) | field hidden; `start.keyInsecure` "This page isn't sent privately, so a key can't be typed here. {helper} can set it up." Primary becomes `start.next` "Next"; step `skipped` |
| Needs the helper person | company is Custom HTTPS, or `reason` `no-endpoint`/`bad-endpoint` | field hidden; `start.keyNeedsHelper` "Your writing helper needs {helper} to finish setting it up." + **Next**; step `skipped` |
| Empty | Save with nothing | `start.keyEmpty` "Paste the key first." (linked to the field) |
| Wrong shape | `keyShape` fails | `start.keyShape` "That doesn't look like a {company} key. Check you pasted the key, not a password." Save becomes `start.keySaveAnyway` "Save it anyway" for one press |
| Too long | > 16 KiB | `start.keyTooLong` "That's too long to be a key." |
| Saving | PUT out | `start.keySaving` "Saving the key…" (button `loading`) |
| Checking | G57 out | `start.keyChecking` "Checking the key with {company}…" |
| Accepted | check ok | `start.keyAccepted` "{company} accepted the key. Your writing helper is on." Primary `start.keyNext` "Next: tell a few stories" (focus); step `done` |
| Refused by the company | check `key-rejected` | `start.keyRejected` "{company} didn't accept that key. Check you copied all of it, then paste it again." The saved key is removed (`credentialAction: "clear"`, only if it was the one just saved) so a bad key never sits there; field empty, focus to it |
| Couldn't check | check failed otherwise, or G57 not built | `start.keyCheckLater` "The key is saved, but it couldn't be checked just now. Your helper will try it when you use it." + **Next**; step `done` |
| Changed elsewhere | 409 | `start.keyChanged` "These settings were changed somewhere else, so the key wasn't saved. Paste it again." |
| Refused (http, G62) | 422 `insecure` | as Can't type a key here |
| No signal | status 0 | `start.keyNoSignal` "Saving a key needs a signal. Nothing was saved." |
| Other | 5xx etc. | `start.keyNotSaved` "The key wasn't saved. Try again in a moment." |
| Skip | `start.keySkip` | step `skipped`; next step; Home details show "skipped the helper's key" |

- **Leaving** with something typed: `modal-dialog` `start.keyLeaveAsk` "Leave without saving the key?" / `start.keyLeaveText` "It isn't kept anywhere." `start.keyLeaveStay` "Stay" (focused) / `start.keyLeaveGo` "Leave". Applies to Back, Finish later, Skip the rest and the account menu.
- **Other companies:** steps are shown only for Anthropic; otherwise `start.keyWhereOther` "{helper} can tell you where to get one." The `console.anthropic.com` link lives in `PROVIDERS` (R8), not in words.
- **For {helper}:** R8's `keyState` line, company, model, destination, and "Set by the server" never appears here (that state skips the step).

## Step: Tell a few short stories (`#/start/stories`)

Stories are R9 pieces, private, from the **Getting started** set (G77). Typed: R9's Choose → Write → saved, embedded (`parts/voice-write.js` shared with `#/voice/write`), with this step's words around it. Spoken: new `parts/story-recorder.js` (R4's `createRecorder`) and G75. Nothing here needs the writing helper.

```
400 px (choose)                               Desktop: three choice cards side by side
+------------------------------------------+
| Step 2 of 3  ●──●──○                     |
| Tell a few short stories                 |  h2 start.storiesHeading
| Your writing helper learns how you sound |  start.storiesLede
| from your own stories, so its suggestions|
| sound like you. Tell three short ones,   |
| the way you'd tell them to a friend.     |
| (lock) They're kept private on your      |  start.storiesPrivate (icon aria-hidden)
| blog's computer. They never appear on    |
| your blog, and nothing is sent anywhere  |
| unless you say so.                       |
| 0 of 3 told                              |  start.storiesProgress, polite
| What would you like to tell about?       |  choice-cards legend start.chooseLegend
| ( ) A meal you love                      |  prompt title (catalog)
|     Who makes it, when you have it, and  |  invitation (catalog)
|     what it tastes like.                 |
|     About 40 to 150 words.               |  voice.wordRange
| ( ) A place from when you were young     |
| ( ) Someone who taught you something     |
| [Show me three others]                   |  voice.drawMore
| How would you like to tell it?           |  start.howLegend (after a choice)
| [  Type it  ]  [  Say it out loud  ]     |  start.typeIt / start.sayIt (only if something can hear)
| Typing: you get three minutes. Spelling  |  start.typeItHelp
| isn't fixed, so it reads like you.       |
| Out loud: up to three minutes. A computer|  start.sayItHelp
| writes down what you say.                |
| Skip stories for now                     |  ghost button start.skipStories
|==========================================|
| [‹ Back]  Finish later                   |  no primary until a way is chosen
+------------------------------------------+
```

- **Prompts:** `GET voice/draw?pack=getting-started` (three; **Show me three others** passes `exclude`). A site whose catalog drops the set draws from every set (R9's fallback). Prompts already told in this run are excluded.
- **No choice and a way pressed:** `voice.chooseFirst` "Choose a prompt first."
- **Type it** → R9's Write step in place (heading = prompt, clock, rough box with `ROUGH_ATTRIBUTES`, **I'm done** / **Start over**, every R9 word and rule, including leaving while the clock runs). The lock answer returns here.
- **After each story:** status `start.storySaved` "Kept. That's {n} of 3." The new story shows as a row ("A meal you love · typed · 112 words" / "· told out loud ·"), with **Read it** (opens the rough text read-only in a `side-sheet`) and **Throw this one away** (`start.storyThrow`, G78; dialog `start.storyThrowAsk` "Throw away this story?" / `start.storyThrowText` "It's taken off {product}'s computer. It can't be brought back." **`start.storyThrowYes` "Throw it away"** / `start.storyThrowNo` "Keep it" (focused) → toast `start.storyThrown` "Thrown away."). Then primary `start.tellAnother` "Tell another" and secondary `start.enough` "That's enough for now". At 3: `start.storiesDone` "That's three. Thank you." and primary `start.next` "Next". She may tell more than three from Your writing voice later; this step stops asking at three.
- **Skip stories for now:** step `skipped`, next step; arms the nudge. With 1+ stories the step is `done` (skip isn't shown after the first).
- **How long:** typed: R9's three minutes (`voice.chooseHelp`'s rule); spoken: 3:00 cap. Words 40–150 is guidance, never enforced.

### Say it out loud

First press each run opens a `side-sheet` (full screen under 30rem), `start.sayHeading` "Before you start":

```
+------------------------------------------+
| Before you start                      [x]|
| +--------------------------------------+ |  "what goes" box (R8 shape)
| | What goes to OpenAI                  | |  common.whatGoes
| | · Your recording, when you finish.   | |  start.sayGoesProvider
| | Only the recording goes, not your    | |
| | posts, photos or other stories.      | |
| | OpenAI's own rules cover what it     | |
| | keeps.                               | |
| | The recording isn't kept after that; | |  start.sayNotKept
| | the words are.                       | |
| +--------------------------------------+ |
|=========================================|
| [Type it instead]     [Start recording]  |  start.sayType / start.sayStart
+------------------------------------------+
```

Local engine: `start.sayGoesLocal` "{product} turns your recording into words on its own computer. Nothing leaves it." (heading `start.sayLocalHeading` "Where your recording goes").

| Recorder state | Words | Buttons |
| --- | --- | --- |
| starting | `start.recStarting` "Your phone may ask to use the microphone. Tap Allow." | — |
| recording | red dot (static under reduced motion) + `start.recording` "Recording {time} of 3:00" | **Stop** `start.recStop` (focused) |
| recorded | `<audio controls>` named `start.recListen` "Your recording"; `start.recLength` "{time} long." | primary `start.recUse` "Use this recording", `start.recAgain` "Tell it again" (asks `start.recAgainAsk` "Throw away this recording and tell it again?" `start.recAgainYes` "Tell it again" / `start.recKeep` "Keep it") |
| stopped at 3:00 | `start.recTime` "Stopped at 3 minutes, the longest a story can be. It's kept." | as recorded |
| denied | `start.recDenied` "{product} isn't allowed to use the microphone on this {phone}. To change that:" + R4 `micSteps(here)` + `start.recOrType` "Or type it instead." | **Type it** |
| unavailable | `start.recUnavailable` "The microphone didn't start. If another app is using it, close that app and try again. Or type it instead." | **Try again**, **Type it** |
| error | `start.recError` "The recording stopped by itself. What you said up to then is kept." | as recorded |
| left / backgrounded | stops and keeps it; next open `start.recLeft` "Your recording stopped when you left. It's kept on this phone." | as recorded |
| can't record here | `start.recCant` "Recording doesn't work here. Type it instead." | **Type it** |

**Use this recording** → `POST voice/spoken?promptId=<id>` (G75, audio body, CSRF) → `start.turning` "Turning it into words…" (20 s: `start.turningStill` "Still working. Long stories take longer.") → the rough draft is saved by the server as said, and shown:

```
| Here's what you said                     |  h3 start.heard
| A computer wrote this from your voice, so|  start.heardNote
| a few words may be wrong. It's kept as   |
| you said it. You can polish a copy later |
| in Your writing voice.                   |
| +--------------------------------------+ |  role=region tabindex=0, read only,
| | well my mother always made the gravy | |  start.heardRegion "Your story, as you said it"
| | first, before anything else…         | |  textContent, pre-wrap
| +--------------------------------------+ |
| 138 words.            Throw this one away|
```

Errors (G75 codes, then R8 `helperProblem` for provider codes): `empty-transcript` `start.heardNothing` "No words were heard in it. Tell it again, or type it."; `too-large` `start.recTooBig` "That recording is too big to send. Tell a shorter one."; `not-audio` `start.recUnreadable` "That recording can't be read. Tell it again, or type it."; `no-transcriber` (setup changed) `start.sayGone` "Out loud isn't available any more. Type it instead." (button hidden); provider/timeout/other `start.turnFailed` "That couldn't be turned into words, but your recording is still on this phone. Try again, or type it."; status 0 `start.sayNoSignal` "Turning it into words needs a signal. Your recording is kept on this phone." In every failure the recording stays (below) with **Try again**.

**Kept on the phone** (principle 4): a finished recording is written at once to IndexedDB `studio-story` v1, store `recording`, key = user, record `{v: 1, promptId, type, seconds, savedAt, blob}` (permanent shape). Removed only when G75 answers with a piece id, she taps **Tell it again** or **Throw this one away**, she signs out (R9's sign-out question gains `start.signOutRecording` "…and a recorded story that hasn't been turned into words"), or another user signs in. Opened only when a recording exists. Home's kept-on-this-phone list adds `home.storyKept` "A recorded story is kept on this phone." + **Open** (`#/start/stories`, or `#/voice` when Getting started is finished).

## Step: Let your helper learn how you sound (`#/start/voice`)

Shown when the helper is ready and 1+ story exists. R9's Your voice guide steps 1 and 2, embedded (`parts/voice-guide-steps.js` shared with `#/voice/guide`), with the pieces fixed to **this account's** stories (G79 `by`) and every R9 rule: the "what goes" box names `{company}` with **Word for word**; nothing is sent until she presses; nothing is saved until **Save my voice guide**; with an existing guide, R9's Keep/Use choices.

```
400 px                                        Desktop: 40rem; step 2 traits full width
+------------------------------------------+
| Step 3 of 3  ●──●──●                     |
| Let your helper learn how you sound      |  h2 start.voiceHeading
| Your helper reads your stories and writes|  start.voiceLede
| down how you sound, quoting your own     |
| words. You see it before anything is     |
| saved.                                   |
| Learn from these stories                 |  fieldset start.voiceFrom
| [x] A meal you love · typed · 112 words  |
| [x] A place from when… · told · 138 words|
| +--------------------------------------+ |
| | What goes to Anthropic               | |  common.whatGoes
| | · The stories you ticked, about 250  | |  voice.guideGoesPieces
| |   words                              | |
| | Not your posts, photos, or anything  | |  voice.guideGoesNot
| | about your readers. Anthropic's own  | |
| | rules cover what it keeps.           | |
| | > Word for word                      | |  common.wordForWord
| +--------------------------------------+ |
|==========================================|
| [‹ Back]  Not now      [Let my helper    |  start.voiceSkip / start.voiceLearn
|                          learn]          |
+------------------------------------------+
```

- **Working / result / save / discard:** R9 ids (`voice.guideWorking`, `voice.guideStill`, `common.stopWaiting`, `voice.guideResultHeading`, `voice.guideResultNote`, tags, `voice.guideSave`, `voice.guideDiscard`). Saved → toast `start.voiceSaved` "Saved. Your helper's suggestions will sound more like you." **Undo** (R9's), step `done`, next. **Don't save these** → step `skipped`. **Not now** → step `skipped`.
- **Practice:** **Save my voice guide** is replaced by `start.practiceNoSave` "Practice: not saved" (`aria-disabled`); the proposal runs for real so Mikey sees it.
- **Errors:** R8 `helperProblem`, then R9's guide rows. Key rejected here sends `start.voiceKeyProblem` "{company} didn't accept your blog's key, so your helper can't learn yet. Your stories are kept." + **Next** (step `not-ready`).

## Done (`#/start/done`)

```
400 px                                        Desktop: same column
+------------------------------------------+
| You're ready                             |  h2 start.doneHeading (focused)
| ✓ Your writing helper is on.             |  start.doneHelperOn / start.doneHelperOff
| ✓ 3 stories kept, private.               |  start.doneStories / start.doneStoriesNone
| ✓ Your helper has learned how you sound. |  start.doneVoice / start.doneVoiceLater
| See your stories                         |  link start.doneSeeStories → #/voice
|==========================================|
| Go to Home       [Write your first post] |  start.doneHome / start.doneWrite → #/write/new
+------------------------------------------+
```

`start.doneHelperOff` "Your writing helper isn't on yet. {helper} will set it up."; `start.doneStoriesNone` "No stories yet. You can tell some any time under Your writing voice."; `start.doneVoiceLater` "When your writing helper is on, it can learn from your stories under Your writing voice."; with posts already, `start.doneWriteAgain` "Write a post". Marks are a word + ✓/–, never colour alone. Reaching this screen sets `done`. Opened from the nudge, the primary is `start.backToPost` "Back to your post" (the Write address it came from).

## The nudge in Write

`parts/story-nudge.js`; rules `nudgeDue(record, pieces, now)` (pure, mirrored by the server, which decides).

- **Eligible:** mode is `on`, `on:<r>` or `rehearse`; this account's stories step is `skipped` (or the record is `skipped` with stories not `done`); the site has **0** pieces by this account (G79); not `stopped`; fewer than 3 shown; last shown ≥ 7 days ago (or never); a signal.
- **When:** only as Write opens for a **new** post (`#/write/new*`), after `GET onboarding/nudge` answers `{due: true}` within 1.5 s (else not this time). Never on an existing post, never after the first keystroke in this visit: if she has typed before the answer arrives, it isn't shown. Showing it is recorded (`POST onboarding/nudge {event: "shown"}`).
- **Where:** a `content-card` above the title at 400 px, in the side column on desktop. It doesn't move or close by itself; typing in the post doesn't remove it (no layout jump under her fingers); it's gone next visit.

```
400 px                                        Desktop: same card at the top of the side column
+------------------------------------------+
| Home > Posts > New post                  |
| +--------------------------------------+ |
| | Want your helper to sound like you?  | |  h3 write.storyNudgeHeading
| | Tell it a few short stories, typed   | |  write.storyNudgeText
| | or out loud. It learns how you talk  | |
| | and write, so its suggestions sound  | |
| | like you, not like a computer. It    | |
| | takes about ten minutes, and the     | |
| | stories never appear on your blog.   | |
| | [Tell a few stories now] [Not now]   | |  write.storyNudgeYes / write.storyNudgeLater
| | Don't ask again                      | |  ghost write.storyNudgeStop
| +--------------------------------------+ |
| Title [                              ]   |
```

- **Tell a few stories now** → Write's leave-guard (anything typed is saved as a draft first, as usual) → `#/start/stories?back=<write route>`. Event `accepted`. The stories step's footer shows `start.backToPost` "Back to your post" in place of Finish later.
- **Not now** → card goes, focus to Title, toast `write.storyNudgeLaterDone` "Okay. It's under Getting started whenever you want it." Event `later`.
- **Don't ask again** → event `stop` (and R9 G64 `voice/invitation {dismissed: true}`), card goes, focus to Title, toast `write.storyNudgeStopped` "Okay, it won't ask again. Getting started is in the menu if you change your mind." **Undo** (`event: "unstop"`).
- **R9's Home invitation** is hidden while this account has an onboarding record and the mode isn't `off` (`invitationVisible` gains `onboardingOwnsIt`), so she is never asked about stories in two places.

## Home

- **Card** (`home.startCard*`), at the top of Home's lower area, when the record is `in-progress` (any mode but `off`) or due and not auto-opened: `home.startCardHeading` "Finish getting started" / `home.startCardText` "Step {n} of {total}: {step}." (step names: `start.stepHelper` "Turn on your writing helper", `start.stepStories` "Tell a few short stories", `start.stepVoice` "Let your helper learn how you sound") / `home.startCardGo` "Continue".
- **For {helper} › Getting started** (`layer: details`): `start.detailsMode` "Getting started is {value}, set by {source}." (`source`: "the server's environment" / "openblog.json" / "nothing (off)"); problems (`start.problemMode` "OPENBLOG_STUDIO_ONBOARDING is “{value}”, which isn't off, on, on:<round> or rehearse, so Getting started is off."); then one row per account from `GET onboarding/accounts`: "grammi · in progress · stories 1 of 3 · helper's key skipped · started Nov 20" / "mikey · skipped · round 1" / "dana · not started", each with **Show it again at next sign-in** (`start.showAgain`; `POST onboarding/reset {user}`; toast `start.shownAgain` "{user} will see Getting started next time." **Undo** restores the record). Reset never touches stories; the row says `start.resetKeeps` "Their stories stay; erase them under Your writing voice." Hidden when mode is `off` and no record exists.
- **Account menu:** **Getting started** always (runs it now; when finished, starts a new run at the first needed step without changing the round).

## Errors by code (`startProblem(error)`, then the step's own tables)

| Route (G) | Answer | Her words | Mikey (details) |
| --- | --- | --- | --- |
| `GET onboarding` (G71) | status 0 / 5xx | `start.noSignal` / `start.loadFailed` "Getting started didn't load." + `common.tryAgain` | server sentence |
| `PUT onboarding` | 409 `stale` | none: reload the record, go to its step | etag |
| | 422 `bad-step` | none: reload | step |
| | 409 `practice-only` | none (bug) | mode |
| `onboarding/nudge` | any failure | none: no card this time | |
| `onboarding/reset` | 404 `unknown-user` | (details) `start.resetGone` "That account isn't on this site any more." | user |
| `voice/spoken` (G75) | `empty-transcript`, `too-large`, `not-audio`, `no-transcriber`, `refused` (`voice/*` practice/limits), G54 codes | the Say it out loud rows above | engine, seconds, bytes |
| `voice/samples/<id>` DELETE (G78) | 404 `gone` | `start.storyGone` "That story was already thrown away." | id |
| | 409 `in-session` | `start.storyBusy` "That story is still being told somewhere else." | |
| `assistant/settings`, `assistant/check` | R8 codes | key table above | R8 |
| `voice/session/*`, `voice/draw`, `assistant/voice-guide` | R9 codes | R9 words | R9 |
| any | 401 | shell "Sign in again"; step kept | |

## What each owner sees

| | Non-technical owner | Trade owner | Developer |
| --- | --- | --- | --- |
| First sign-in | Getting started, 2 steps (key in env) | same; 3 if no key | `rehearse`: practice strip on every step |
| Key | paste, Where do I get a key?, Skip — {helper} will set this up | same | + R8 key state, company, model in details |
| Stories | three prompts, Type it / Say it out loud, rows with Read it and Throw away | Say it out loud in the truck | + piece ids, files, practice folder, engine |
| Voice | ticked stories, what goes, traits, Save | same | + R9 diff, provenance, both saves |
| Later | a Home card; one card in Write, three times at most | same | Home details: every account, mode, source, problems, Show it again |
| Errors | one sentence; nothing of hers lost | same | + code, status, server sentence |

## Safety and privacy

- **Stories are private by default and always in this slice:** written to `.openblog/private/context/voice/` (R9 private), never portable from her layer, never in Git (R9's tracked-private warning applies), never published, never in a build, never in `dist/`.
- **Nothing leaves without the box:** typed stories go nowhere. A recording goes only after the Before you start sheet named the company (or said "Nothing leaves it"); the guide only after the "what goes" box. Nothing is queued to send later.
- **Audio is not kept on the server:** G75 writes it to a private temp file (0600), transcribes, deletes it in all outcomes (including errors and timeouts) and returns only the piece. On the phone, only until saved (above).
- **Never in logs:** story text, transcripts, prompt answers, audio bytes, the key. The server logs only events: "onboarding: grammi finished (helper not-needed, stories 3, voice done)", "onboarding: mikey reset grammi", "voice: spoken piece saved for grammi (138 words)". A route test captures stderr for known story text and audio bytes and asserts neither appears.
- **Never in phone storage beyond the two records:** `ob-voice-draft:<user>` (R9) and `studio-story` (above). Getting started keeps nothing in `localStorage` or `sessionStorage`: its record is on the server.
- **The key:** R8's rules exactly (write-only, field emptied before send, `new-password`, refused over http, never in DOM after send, logs, toasts or storage). A key the company refused is cleared at once.
- **Practice is isolated** (G74): the server refuses `practice: true` unless the mode is `rehearse`; practice files live only under `.openblog/private/onboarding/practice/` and are swept at the next non-rehearse start.
- **Transcripts and catalog text are data:** shown with `textContent`, `bdi`, `pre-wrap`; never links.
- **Multiple writers:** each story records `by: <user>` (G79); the guide step ticks only her own; the nudge counts only her own.

## Accessibility and keyboard

- **Order:** title, welcome (first step), step indicator, step heading (focused on arrival), body, details, bar. Each step change moves focus to its heading and says `start.stepAnnounce` "Step {n} of {total}: {step}." politely.
- **Names:** step indicator "Getting started, step {n} of {total}"; "Read it: {title}"; "Throw this one away: {title}"; recorder "Stop recording"; audio "Your recording"; the region `start.heardRegion`; the key field "Paste the key", described by its help.
- **Keys:** Ctrl/⌘ Enter = the step's primary (Save the key; Use this recording; Let my helper learn; R9's keys inside a typed story); Alt+← = Back; Escape closes sheets and dialogs, never stops a clock or a recording (Stop is a button).
- **Live regions:** one polite status per step (saved, kept, progress, turning into words); R9's clock marks only; the recorder's time is `role="timer"`, not live.
- **320 px:** one column; choice cards stack; Type it / Say it out loud stack full width; the bar wraps to two rows (primary on top, full width); the transcript and story rows wrap; nothing scrolls sideways. **Reduced motion:** no slide between steps; the red dot is static; the spinner is the word only.
- **Zubra:** `step-indicator` (**add to `zubra/components.json` and re-vendor**), `choice-cards`, `action-button`, `text-field`, `content-card`, `side-sheet`, `modal-dialog`, `alert-banner`, `status-badge`, `toast-region`, `skeleton-block`, `loading-spinner`, `dropdown-menu` (More), `cluster-layout`. The guide's checkboxes use the native `fieldset` fallback (as R5–R9). Native `<audio controls>` as R4.

## Installed app and phones

- No Back button: every step has ‹ Back, Finish later and the account menu; Done has two ways out. A reload in the installed app resumes the step (server record) and the story (R9 session and phone copy, `studio-story`).
- iPhone: the microphone question appears inside the installed app the first time; `micSteps(here)` names this phone's own Settings steps. A recording stops when the app goes to the background and is kept.
- The key field: password managers offer her blog password; `new-password` and `keyShape` catch it (R8 risk).

## Rules each part uses (static imports, DOM-free, tested)

| Part | File | Functions |
| --- | --- | --- |
| Getting started | new `parts/onboarding-rules.js` | `startSteps(status, voice, record)`, `stepRoute(step)`, `nextStep(steps, current)`, `previousStep`, `stepNumber(steps, step)`, `startDecision(onboarding, route, now)` (auto-open, Home card, none), `AUTO_OPEN_GAP_MS = 20 h`, `startProblem(error)`, `recordAfter(record, event)` (pure transitions: `step-done`, `step-skipped`, `skip-rest`, `finished`), `storyRows(pieces, user)`, `storyProgress(n)` (cap 3), `doneLines(record, status)`, `modeLine(onboarding)` (details) |
| Nudge | `parts/onboarding-rules.js` | `nudgeDue(record, ownPieces, now)` (mirror of the server's), `NUDGE_GAP_DAYS = 7`, `NUDGE_MAX = 3`, `nudgeAllowed(typedThisVisit, routeIsNew)` |
| Spoken stories | new `parts/story-rules.js` | `STORY_MAX_SECONDS = 180`, `sayAvailable(transcribeStatus)`, `sayGoes(transcribeStatus)` (→ `{id, vars}`: provider or local), `spokenProblem(error)`, `recordingRecord(...)` / `readRecording(raw)` (v1 shape, unknown `v` ignored) |
| Recorder | `parts/capture-recorder.js` (R4, reused unchanged) | `createRecorder` with `maxSeconds` |
| Words | new `parts/start-words.js` (`start.*`, `home.start*`, `home.storyKept`, `write.storyNudge*`), R9's `parts/writing-voice-words.js` gains `voice.pieceThrow*`, `voice.badgeSpoken` | |
| Shell | `shell.js` | `chrome: "focus"`; sign-out question includes `studio-story` |

Words: every id listed in this spec, `layer: "her"` except `start.practice`, `start.practiceNoSave`, `start.detailsMode`, `start.problemMode`, `start.showAgain`, `start.shownAgain`, `start.resetKeeps`, `start.resetGone` (`layer: "details"`). `start.welcome` uses `{owner}` with `bare` "Welcome". `start.keyHeading`, `start.keyLede`, `start.keyWhat`, `start.keyLabel` "Paste the key", `start.keyHelp`, `start.keySave`, `start.keySkip`, `start.keyWhere`, `start.keyStep1`–`4`, `start.keyWhereOther`, `start.keyLeave*`, the `start.key*` state ids, and `start.sayGoesProvider` are allowed the word "key"/"API keys" by an exception list in the banned-word test (⚑ 4), and no other id. Reused: `common.whatGoes`, `common.wordForWord`, `common.stopWaiting`, `common.tryAgain`, `common.forHelper`, `common.tell`, `voice.wordRange`, `voice.drawMore`, `voice.drewMore`, `voice.chooseFirst`, R9's guide ids. Other new ids: `start.title` "Getting started", `start.welcomeLede`, `start.stepOf` "Step {n} of {total}", `start.back` "Back", `start.finishLater` "Finish later", `start.skipRest` "Skip the rest", `start.next` "Next", `start.resumed`, `start.howLegend`, `start.chooseLegend`, `start.storiesHeading`, `start.storiesLede`, `start.storiesPrivate`, `start.storiesProgress` "{n} of 3 told", `start.storyRowTyped` "{title} · typed · {words}", `start.storyRowSpoken` "{title} · told out loud · {words}", `start.readIt` "Read it", `start.voiceFrom` "Learn from these stories". R9 additions: `voice.badgeSpoken` "Told out loud" (shape ◎), `voice.pieceThrow` "Throw this piece away…", `voice.pieceThrowAsk` "Throw away “{title}”?", `voice.pieceThrowText` "Its rough draft and any polished copy are taken off {product}'s computer. It can't be brought back. Your voice guide keeps what it learned until you update it.", `voice.pieceThrowYes` "Throw it away", `voice.pieceThrowNo` "Keep it", `voice.pieceThrown` "Thrown away."

## Tests

- **`tests/web/studio-onboarding-rules.test.mjs`:** `startSteps` with key from env / saved / none / other-provider / custom; voice step `not-ready` without helper or stories; numbering fixed when a step turns `not-ready`; `startDecision`: fresh meta + Home → open; kept meta → none; notification route → card; within 20 h of Finish later → card; `recordAfter` transitions; `doneLines` for every combination; `nudgeDue`: never when stories done, pieces > 0, stopped, 3 shown, < 7 days, mode off; `nudgeAllowed` false after typing or on an existing post; `storyProgress` caps at 3.
- **`tests/web/studio-story-rules.test.mjs`:** `sayAvailable` false for Anthropic with no hearing key, true for local engine; `sayGoes` names the company or says local; `readRecording` ignores another `v` and never rewrites it; `spokenProblem` covers every G75 code.
- **Words:** every `start.*`/`write.storyNudge*`/`home.start*` id exists, is used with a literal, passes `HER_BANNED` except the listed key ids; `start.welcome` has `bare`; persona test (no names, foods, family in defaults).
- **Rust (G70–G80):** mode parsing (`off`, `on`, `on:abc-1`, `rehearse`, `ON`, `on:`, `on:x y`, 33-char round → problem and off); env beats `studio.onboarding`; `studio.onboarding: "rehearse"` refused (`deny_unknown_fields`-style problem); `onboarding_due` table for every mode × record (none, in-progress, done round 1 vs `on:2`, skipped); rehearse never writes the real record or the voice library; practice swept at a non-rehearse start and kept at a rehearse start; `practice: true` refused 409 `practice-only` otherwise; record files 0600 under hashed names, atomic, etag 409; nudge rule server-side (7 days, 3, stop/unstop, only new posts reported); reset by any signed-in account, 404 for unknown, logged; `voice/spoken` writes a rough piece with `told: spoken` and `by`, deletes the temp audio on success, error and timeout (file system check), refuses > limit and non-audio, uses G76's hearing key; `DELETE voice/samples/<id>` removes rough + polished only, refuses an open session's piece; catalog pack ids stable; logs captured for a known story string, transcript and audio bytes: never present; `meta.onboarding` absent of anything but mode/practice/due/step/total/resume; `openblog check` reports a bad value; `openblog onboarding status|reset <user>|reset --all`.
- **Browser, `tests/browser/studio-start.spec.mjs`** (against `openblog serve --admin`, `custom-https`/transcription stubs): `off` never opens; `on` opens at Home on first load, not over `#/comments`; env key → no key step, "Step 1 of 2"; no key → key step: wrong shape, Save it anyway, stub refuses → field empty and key cleared, accepted → Next; Skip — {helper} will set this up; typed story with the clock (R9 parts), reload mid-story resumes; spoken story with a fake media stream: disclosure first, recording kept across reload (IndexedDB), stub transcript shown read-only; throw a story away; voice step what goes → Save; done → `done`, no auto-open next load; Finish later → card, no auto-open for 20 h (clock faked); `rehearse`: strip on every step, nothing in `#/voice`, guide save disabled, record untouched; switch to `on` → fresh; nudge: skip stories, open new post → card; Not now; 7 days later (faked) → again; third time last; Don't ask again + Undo; never after typing; Home details rows and Show it again; key bytes and story text appear nowhere in DOM after send, storage, console; 320 px, axe, keyboard only, reduced motion at each step.

## Server gaps

- **G70. The switch:** `OPENBLOG_STUDIO_ONBOARDING` read at start into `AppState` (values above; bad → off + problem + one start-up warning line); `SiteConfig.studio.onboarding: "off" | "on"` (beside `words`, `deny_unknown_fields` kept); env wins ⚑ 2; `openblog check` prints the mode, source and problems.
- **G71. Per-account record and routes:** `admin/onboarding.rs`; files above; `GET onboarding` (record + `due`, `steps` hint, etag), `PUT onboarding {etag, step?, steps?, status?, stories?}` (validates transitions; writes `finishedAt`, `round`); `meta.onboarding: {mode, practice, due, step, total, resume}`; the auto-open timestamp via `PUT {lastAutoOpen: true}` (server time). Logs events only.
- **G72. Nudge:** `GET onboarding/nudge` → `{due}` by the server's rule; `POST onboarding/nudge {event: "shown" | "later" | "accepted" | "stop" | "unstop"}`; at most one `shown` per day counted.
- **G73. Accounts and reset:** `GET onboarding/accounts` (every user from `users.json`, their record summary, no story text); `POST onboarding/reset {user}` (removes the record; returns the old one for Undo via `PUT onboarding/restore`); CLI `openblog onboarding status`, `openblog onboarding reset <user>`, `--all`.
- **G74. Practice:** `practice: true` on `voice/draw` (exclusions only), `voice/session/start|draft|lock`, `voice/spoken`, `voice/samples` (GET own practice list), `assistant/voice-guide` (practice piece ids), refused unless `rehearse`; practice root `.openblog/private/onboarding/practice/{records,voice}/`; start-up sweep.
- **G75. Spoken stories:** `POST voice/spoken?promptId=<id>[&practice=1]`, audio body ≤ 12 MiB (`webm`, `ogg`, `m4a`, `wav`, `mp3` sniffed), under the shared helper permit; transcribes with the site's transcriber (G76); writes the rough draft once (`voice_store::write_rough` path, front matter `told: spoken`, `by`), no session needed and no clock (the 3-minute cap is the recorder's; the server refuses audio over 200 s when the format says its length); deletes the audio always; returns `{id, words, text}`; codes `empty-transcript`, `too-large`, `not-audio`, `no-transcriber`, `bad-prompt`, G54 provider codes. Transcript cleaned exactly as `assistant/transcribe` does (bounded, control characters removed) and nothing else.
- **G76. A key that can hear:** when the helper's company can't take audio, transcription uses `OPENAI_API_KEY`, then `GEMINI_API_KEY`, from the server environment if present (only for audio; never sent text); `GET assistant/transcribe` reports `{available, destination: "local" | company}` so Studio can name it ⚑ 7.
- **G77. The Getting started set:** bundled `voice_prompts/catalog.md` gains `## getting-started: Getting started` ("Short stories, the way you'd tell them to a friend.") with `a-meal-you-love` "A meal you love", `a-place-from-when-you-were-young` "A place from when you were young", `someone-who-taught-you` "Someone who taught you something", `a-day-you-still-remember` "A day you still remember", `something-you-make-or-do-well` "Something you make or do well", `something-that-made-you-laugh` "Something that made you laugh"; `words: 40-150`; one-sentence invitations, generic; ids forever.
- **G78. Throw one piece away:** `DELETE voice/samples/<id>` (rough, its polished copy, nothing else; refuses a piece whose session is open; returns what went) and R9's A piece gains More › **Throw this piece away…** with the dialog above. No undo (said in the dialog).
- **G79. Who and how:** new pieces carry optional front matter `by: <user>` and `told: typed | spoken`; `voice/samples` returns them; old pieces have neither (treated as "anyone", "typed").
- **G80. New sites onboard:** `openblog new` writes `"studio": {"onboarding": "on"}` ⚑ 11.
- **Depends on R8:** G54 (provider codes on `voice/spoken`), G56 (`credential.state`, `reason`), G57 (`assistant/check`), G62 (no key over http). **On R9:** G63 (voice codes), G64 (invitation dismissal), the light catalog G58 via R8. **Not gaps:** `assistant/settings` write-only replace/clear, `voice/draw` with `pack`/`exclude`, `voice/session/*`, `assistant/voice-guide`, `PUT assistant/context` (voice), users and sessions.

## Build order

**R9b, right after R9 and before R10.** It reuses R8's key rules and check, R9's choose/write parts, pieces, guide steps and hub, and R4's recorder; building it earlier would mean writing those twice. Inside the slice: G70–G73 + G77 + frame + key step + typed stories + done + Home details (enough to onboard Grammi with her key in the environment, typing) → G75/G76/G79 spoken stories → G78 throw away → nudge (G72) → G74 rehearse. ⚑ If Grammi should start before R10, ship the first part with `rehearse` as the last item of R9b, not later: Mikey needs it to test before handing over.

## Risks to test before release

- Grammi's real phone and iPad, installed app: first sign-in opens Getting started; reload mid-story; recording, background, come back; microphone denied then allowed.
- Railway: changing the variable redeploys; `.openblog` must be on the volume, or the record (and her stories) vanish and Getting started reappears. With `OPENBLOG_FILES_RESET=1` and no workspace store, Home details say "Getting started can't remember where she got to on this server." (`start.filesReset`, details).
- Rehearse left on by mistake when she signs in: the practice strip shows and nothing is kept; docs make `rehearse` → `on` the last step before handing over.
- An Anthropic helper with no `OPENAI_API_KEY`: Say it out loud absent everywhere, nothing broken.
- A transcript in another language or with names misheard: kept as said; polishing later works.
- Mikey's own account on her site with `on`: he sees it once; Skip the rest; his skip never touches her record.
- Two accounts telling stories: the voice step ticks only her own; R9's hub shows both (by `by` in details).
- A password manager filling her blog password into the key field (R8).
- Nudge timing with two phones: the server's count keeps it to once per 7 days.

## Docs and release note

- **`docs/deploy.md`**, new section "Getting started for a new owner": the variable and its four values, env beats `studio.onboarding`, the hand-over recipe (1. set `OPENBLOG_STUDIO_ONBOARDING=rehearse`, redeploy, sign in as her and go through it; 2. set `on` and redeploy, which sweeps the practice; 3. give her the password; 4. watch Home › For {helper} › Getting started, or `openblog onboarding status`), `on:<round>` to ask everyone again, `openblog onboarding reset <user>`, that open.blog reads the server's environment and not a `.env` file, and that `ANTHROPIC_API_KEY` there skips the key step. Mention `OPENAI_API_KEY`/`OPENBLOG_TRANSCRIBE_COMMAND` for stories told out loud.
- **`docs/configuration.md`:** `studio.onboarding` (`off`/`on`). **`docs/admin.md`:** a Getting started section (steps, skip, nudge rule, where stories live, throw one away). **`docs/studio-words.md`:** generated ids. **`docs/cli.md`** (or the CLI help): `openblog onboarding`.
- **Release note:** New owners get **Getting started** on their first sign-in: turn on the writing helper (skipped when the server already has a key), tell a few short stories typed or out loud so the helper learns how they sound, and let it learn, seeing what goes before anything is sent. Stories stay private and can be thrown away one at a time. Skipped stories get one gentle reminder in Write, at most three times. Turn it on with `OPENBLOG_STUDIO_ONBOARDING=on` (or `rehearse` to try it first); new sites have it on.

## Changes to `studio-ux` (proposed)

- **First use is a path, not a tour.** Getting started asks only what can't be known already, one step per screen, each skippable, each resumable after a reload, with its own way home.
- **Ask again once, gently, and stop.** A reminder appears only where it helps, never while she types, at a fixed restrained rate, and always offers "Don't ask again".
- Review checklist: "A first-use step hides itself when the answer is already known, and leaving it midway loses nothing."
