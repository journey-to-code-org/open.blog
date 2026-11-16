# ONB1 design: About your blog, What you use, turned-off pages, My stories

By `studio-senior-ux` and `studio-junior-ux`, 2026-11-16, after `brief.md` and
`architecture.md`. Every her-layer string is a word id (`say(id, vars)`) in
`parts/welcome-words.js` or `parts/area-words.js`; `{product}`, `{helper}`, `{owner}` as usual.
No default names a person, family, food or site. Details-layer ids are marked (details).

## The areas (catalog, `area-rules.js`)

Essential, never hidden and not listed in What you use: Home, Posts, Write, Pictures, Look, Front
page, People, Notifications, Writing helper, Your writing voice, My stories, Getting started,
About your blog, What you use.

| Id | Name (`area.<id>`) | One line (`area.<id>About`) | Turned on by | What it holds in Studio |
| --- | --- | --- | --- | --- |
| `pages` | Pages | Pages that aren't posts, like About or Contact. | technical, trade, teaching, research, docs | Pages, a page |
| `collections` | Collections | Posts you group together, like a series. | technical, recipes, teaching, podcast, docs, personal | Collections, a collection |
| `recipes` | Recipes | Recipe boxes for ingredients, steps and times. | recipes | Write's "A recipe", the recipe-or-story question, Find's "Write a new recipe", Home's recipe notes |
| `trade` | Your business | Services, reviews, jobs, requests for a price and business facts. | trade | New job, Services, Reviews, Business, Requests, Reminders, Share this job, Write's "A job", Home's ready list and jobs, the add menu's hours and contact |
| `seasonal` | Seasons and holidays | Decorations, greeting cards and gifts for the holidays. | seasons: Yes | Decorations, Cards, Gifts, Find's "Put a look up now", Home's card line |
| `sharing` | Sharing | Announcing posts on other sites, and where each post went. | sharing: Yes | Sharing |
| `readers` | Readers | Comments, reactions and how many people visit. | readers: Yes | Readers, Home's waiting line |
| `research` | Research | Sources, citations and notes for posts backed by research. | research | Research, Write's "Research", citations in the add menu |
| `teaching` | Teaching | Reading paths and questions for readers. | teaching | Reading paths, the add menu's question for readers |
| `code` | Code and diagrams | Code examples, diagrams, and code readers can run. | technical, docs | the add menu's code, runnable code and CodePen |
| `together` | Writing together | Writing one post with other people. | together: A few people | Writing together |

**In use** (server, nothing stored): pages (any page), collections (any series), recipes (a post
with the recipe kind), trade (as `meta.siteUses.trade`, or the quote form set up), seasonal (seasons on, decorations chosen,
greeting cards or gifts set up), sharing (accounts set up, anything shared, Pinterest on, a
cross-posting target), readers (comments or the visitor counter on), research (as
`siteUses.research`, or readings), teaching (a reading path, or a post with a question for
readers), code (a post with a diagram, a ```` ```mermaid ```` fence: plain code examples don't count, because every new site's first post has one and an example already in a post shows in Write whatever is hidden), together (taking part in one).

## The questions (`#/welcome/<id>`)

| # | Id | Question (`welcome.q.<id>`) | Choices (`welcome.c.<id>.<choice>`) | Help under a choice |
| --- | --- | --- | --- | --- |
| 1 | `kind` | What will you mostly write? | `technical` Technical writing and code · `recipes` Recipes and family stories · `trade` A trade or local business · `teaching` Teaching and lessons · `research` Research with sources · `podcast` A podcast or audio show · `docs` Documentation for a project · `personal` A personal journal, or something else | none |
| 2 | `together` | Will anyone else write with you? | `solo` Just me · `few` A few people | `few`: "You can invite them later." |
| 3 | `seasons` | Should your blog dress up for holidays and seasons? | `yes` Yes · `no` No | `yes`: "Decorations, greeting cards and gifts." |
| 4 | `sharing` | Do you want to share posts beyond your blog? | `yes` Yes · `later` Maybe later · `no` No | `yes`: "Announce new posts on other sites you use." |
| 5 | `readers` | Do you want readers to comment or react? | `yes` Yes · `no` No | none |
| 6 | `amount` | How much would you like to see? | `essentials` Just what I need · `everything` Show me everything | `essentials`: "Anything else stays one step away." · `everything`: "Every tool, whatever you answered." |

**What each answer does** (`areasFor`): only an explicit answer hides; a question left
unanswered hides nothing. The kind turns on its areas (table above) and hides the kind-areas it
doesn't name (recipes, trade, research, teaching, code, pages, collections). `seasons: no` hides
seasonal; `sharing: later|no` hides sharing; `readers: no` hides readers; `together: solo` hides
together. `amount: everything` sets **Show everything** (hiding is kept but not
applied). Areas in use and essentials are always shown, with the reason "Already on your blog".

Reasons (`welcome.why.*`): `kind` "Because you write {what}." (`what` = the choice in lower case,
e.g. "recipes and family stories"); `together` "Because others write with you."; `seasons`
"Because your blog dresses up for the seasons."; `sharing` "Because you share posts beyond your
blog."; `readers` "Because readers comment and react."; `inUse` "Already on your blog.";
`unasked` "You didn't say, so it stays."

### The frame (each question)

```
400 px                                           Desktop: one 40rem column, centred;
+------------------------------------------+     chrome "focus" (navigation and Find hidden,
| About your blog            [Account v]   |     account menu stays)
| Welcome, {owner}                         |  welcome.hello (first question only; bare "Welcome")
| A few questions so {product} shows you   |  welcome.lede (first question only)
| what you need. Skip any of them.         |
| Question 1 of 6                          |  welcome.of, polite
| What will you mostly write?              |  h2 (focused on arrival)
| ( ) Technical writing and code           |  choice-cards, one column at 400 px,
| ( ) Recipes and family stories           |  two on desktop; legend = the question
| ...                                      |
| > For {helper}                           |  details: the area ids this answer turns on
|==========================================|
| [‹ Back]  Skip this one       [ Next ]   |  welcome.back / welcome.skipOne / welcome.next
+------------------------------------------+  More (welcome.more): Skip the questions
```

- **Next** is enabled always; with no choice it acts as **Skip this one** (nothing is chosen for
  her). Choosing a card does not move on by itself (so a mis-tap is free).
- **Back** keeps every answer (they're in the address). Hidden on question 1.
- **Skip the questions** (More): saves `onboarding.state: "skipped"` and nothing else, toast
  `welcome.skippedToast` "Okay. You can answer them any time under What you use.", then the voice
  offer.
- **Reload** anywhere: the same question with the same answers (the address carries them).
- **The kind from init** is preselected on question 1 with `welcome.fromInit` "Chosen when your
  blog was made. Change it if you like." under the legend.
- Keys: Alt+← Back; Ctrl/⌘ Enter = Next; arrows move between cards (component).

### Summary (`#/welcome/summary`)

```
+------------------------------------------+
| Here is what {product} will show you     |  h2 welcome.summaryHeading
| ✓ Recipes                                |  list: name, then its reason under it
|   Because you write recipes and family   |
|   stories.                    [Change]   |  link → the question that decided it
| ✓ Pages · Already on your blog.          |
| Tucked away                              |  h3 welcome.tuckedHeading
| – Sharing  · You said maybe later.       |  (reason: welcome.why.hidden.<q>)
|                               [Change]   |
| Tucked away means one step away: Find,   |  welcome.tuckedNote
| or What you use in the menu.             |
| Always here: writing, posts, pictures    |  welcome.always
| and the look of your blog.               |
|==========================================|
| [‹ Back]                  [ Save these ] |  welcome.save
+------------------------------------------+
```

Hidden reasons: `welcome.why.hidden.kind` "You write {what}."; `.together` "You write alone.";
`.seasons` "No seasons and holidays."; `.sharing` "You said {answer}." (`maybe later`/`no`);
`.readers` "No comments or reactions." With **Show me everything**: a line
`welcome.everythingNote` "You asked to see everything, so nothing is tucked away. Your answers
are kept for later." Marks are ✓/– plus a hidden word (`welcome.markShown` "Shown",
`welcome.markTucked` "Tucked away"), never colour alone.

| State | Words |
| --- | --- |
| Saving | button loading; `welcome.saving` "Saving your answers…" |
| Saved | toast `welcome.saved` "Saved. {product} now shows what you need."; go to Suggestions (or the voice offer) |
| Changed elsewhere (409) | `welcome.changedElsewhere` "Your answers were changed on another screen. Here they are; save again if these are right." The newer answers fill the summary |
| No signal | `welcome.noSignal` "Saving needs a signal. Your answers are still here." |
| Other failure | `welcome.notSaved` "Your answers weren't saved. Try again." + details code |
| Practice run | (details) `welcome.practice` "Practice run: your answers apply to this window only and aren't kept." Save applies them locally |

### Suggestions (`#/welcome/suggestions`, only when there are any)

```
+------------------------------------------+
| Want your blog set up to match?          |  h2 welcome.suggestHeading
| Nothing changes unless you say so.       |  welcome.suggestLede
| +--------------------------------------+ |  content-card per suggestion
| | Add a documentation section          | |  welcome.s.docsSection
| | Pages for your project's guides, at  | |  welcome.s.docsSectionAbout
| | /docs/ with their own menu.          | |
| | [Do this]                            | |  welcome.doThis
| | > For {helper}: the exact change     | |  details: member, - / + lines (pre, textContent)
| +--------------------------------------+ |
| | Add your business details            | |  welcome.s.business (open)
| | [Open Business facts]                | |  welcome.s.businessGo
| +--------------------------------------+ |
|==========================================|
| [‹ Back]                  [ Next ]       |  welcome.next
+------------------------------------------+
```

Change suggestions: `docsSection` "Add a documentation section" / "Pages for your project's
guides, with their own menu."; `recipeList` "List your recipes on one page" / "Readers can look
through every recipe by course and cuisine." Open suggestions: `business` "Add your business
details" / "Your name, phone and where you work, so readers can reach you." → **Open Business
facts** (`welcome.s.businessGo`); `seasons` "Choose decorations for the seasons" → **Open
Decorations**; `readers` "Let readers comment" → **Open Readers**; `sharing` "Connect the sites
you share on" → **Open Sharing**. An open suggestion leaves for its screen; the questions are
already saved.

| State | Words |
| --- | --- |
| Applying | `welcome.applying` "Changing your blog…" (button loading) |
| Applied | the card says `welcome.applied` "Done. Readers will see it after the next update." (role status); its button goes |
| File changed (409 `stale`) | `welcome.suggestStale` "The settings of {product} changed a moment ago. Here's the change again; press Do this if it's still right." (refetched) |
| Failure | `welcome.suggestFailed` "That wasn't changed. Nothing else was touched." + details |
| None to suggest | the screen is passed over |

Declining is simply **Next**: nothing is written.

### The voice offer (`#/welcome/voice`)

```
+------------------------------------------+
| Want {product} to learn how you write?   |  h2 welcome.voiceHeading
| Three short questions, three minutes     |  welcome.voiceLede
| Nothing is corrected or put up, and it   |
| stays private.                           |
| One of them is always a true story from  |  welcome.voiceStory
| your life.                               |
| (You've written 2 already. Add more?)   |  welcome.voiceHas ({n}) / welcome.voiceHasOne, when there are any |
|==========================================|
| No thanks    Later          [ Start ]    |  welcome.voiceNo / welcome.voiceLater / welcome.voiceStart
+------------------------------------------+
```

- **Start** → `#/start` (Getting started: its key step if needed, then the stories, drawn from
  the kind's sets with one story, then the voice guide).
- **Later** → Home; toast `welcome.voiceLaterToast` "It'll be on Home when you want it." A due
  Getting started run is marked for later (R9b's 20 hours), so Home shows its card; otherwise R9's
  invitation card shows until the first piece exists.
- **No thanks** → `voice/invitation {dismissed: true}` and a due run is ended as skipped; toast
  `welcome.voiceNoToast` "Okay. It's under Getting started in the menu if you change your mind."
- Failures of these calls are quiet (Home still opens): the offer is a nicety.

## Turned off (any hidden area's address)

```
+------------------------------------------+
| [empty-state]                            |
| Seasons and holidays is turned off for   |  area.offHeading "{area} is turned off for you"
| you                                      |
| Decorations, greeting cards and gifts    |  area.<id>About
| for the holidays.                        |
| [Turn it on]   [Not now]                 |  area.turnOn / area.notNow (→ Home)
+------------------------------------------+
```

**Turn it on** saves (removes it from hidden), toast `area.turnedOn` "{area} is on.", and opens
the address asked for. Failure: `area.turnOnFailed` "It wasn't turned on. Try again." (status 0:
`area.noSignal` "Turning it on needs a signal.").

## What you use (`#/what-you-use`; account menu and Find "What you use")

```
400 px                                           Desktop: same, 40rem
+------------------------------------------+
| What you use                             |  h2 area.useHeading
| Choose what {product} shows you. Nothing |  area.useLede
| is deleted when you turn something off.  |
| [toggle] Show everything                 |  area.everything / area.everythingAbout
| Recipes                         [on ]    |  toggle-switch per area: label = name,
| Recipe boxes for ingredients...          |  description = one line
| Pages                         [Shown]    |  in use: no switch, a badge, description
| In use on your blog, so it stays.        |  area.inUse
| ...                                      |
| [Ask me the questions again]             |  area.askAgain → #/welcome
| Always here: writing, posts, ...         |  welcome.always
| > For {helper}                           |  details: answers, kind, ids hidden, etag
+------------------------------------------+
```

Each switch saves by itself (principle 11): status `area.saved` "Saved." in the live region;
409 → `area.changedElsewhere` "This changed on another screen, so here it is as it is now." and
the list reloads; failure → the switch goes back and `area.notSaved` "That wasn't saved. Try
again." With Show everything on, the switches stay usable, and a line says
`area.everythingOn` "Everything shows while this is on; your choices below are kept."

## My stories (`#/stories`) and Stories you could tell (Write)

```
+------------------------------------------+
| My stories                               |  h2 stories.heading
| True stories you've told. Reach for one  |  stories.lede
| when a post needs it. Private, never put |
| up.                                      |
| A mistake I made                         |  content-card: prompt title,
| "It was the first Thanksgiving..." ·     |  opening line (first 14 words),
| 154 words                                |  word count
| [Read it]  [Start a post from this]      |  stories.read / stories.startPost
| [Write another story]                    |  stories.another → #/voice/write?pack=stories
+------------------------------------------+
```

Stories are rough pieces from the Stories, People and Getting started sets, plus any piece she
added from **Other things you've written** (a closed `details` under the list, each row with
**Add to my stories**; a marked one has **Take out of my stories**). Marks are kept in her
preferences (`storyMarks`), never on the piece.
Empty: `stories.empty` "No stories yet. Tell one in a few minutes." + **Write a story**
(`stories.writeFirst`). Load failure: `stories.loadFailed` "Your stories didn't load." + Try again.

**Start a post from this** makes a polished copy when there isn't one (word for word), then R9's
make-a-post route; the new draft opens in Write. Status `stories.made` "A draft post was made from
it. The story itself is unchanged." Failure: `stories.makeFailed` "A post couldn't be made from it
just now." The rough story is never edited.

**Write: Stories you could tell** (Write's More and Find): a side-sheet with the same list; choosing
one shows its words read-only in the sheet beside the editor (`stories.besideNote` "It isn't put
in your post. Copy what you need."); **Start a post from this** is offered from the sheet too
(Write's leave-guard asks first). Shown when she has at least one story.

## Write, Home, Find

- **Write's kinds:** "A recipe" only while recipes show; "A job" while business shows; "Research"
  while research shows. The open post's own kind always shows; when its area is hidden, under the
  choice: `area.shownForPost` "Shown because this post uses it."
- **New post:** the recipe-or-story question only while recipes show.
- **Add menu:** code, runnable code and CodePen only while code shows; a question for readers
  while teaching shows; hours and contact while business shows.
- **Home:** the recipe notes, the business ready list, jobs, requests and reminders lines, the
  cards line and the comments line follow their areas. The empty Home says
  `area.homeEmptyRecipes` "Your first recipe or story starts here." with recipes, else
  `area.homeEmpty` "Your first post starts here."
- **Find:** a hidden area's items go; "Turn on <area>" (`area.findTurnOn`) is offered for each
  hidden area; "What you use" and "Ask me the questions again" always.

## Accessibility

- Focus moves to each screen's h2; the question count is polite (`welcome.of`).
- Choice cards are a radio group named by the question; every button has a visible name; More is
  named "More: About your blog" (`welcome.moreName`).
- 320 px: one column; the bar wraps with the primary first and full width; the config lines in
  details wrap (`pre` with `white-space: pre-wrap`).
- Reduced motion: no transitions are added.
- The ✓/– marks have a visually hidden word.

## Tests

- `tests/web/studio-area-rules.test.mjs`: every screen in `screens/index.js` has an area;
  `visibleAreas` table (kinds, Show everything, in use, essentials, unknown ids ignored);
  `areaOfRoute`/`areaOfHref`; kinds → voice sets (always stories).
- `tests/web/studio-welcome-rules.test.mjs`: `areasFor` for every kind and answer, "technical +
  seasons no" → no seasonal, recipes or trade; "recipes + seasons yes" → recipes, seasonal, no
  sharing or research (sharing answered later); in-use wins with its reason; the address round
  trip; question order.
- Rust: v1 → v2, unknown dropped, pending for new logins, etag 409, owner-only; `in_use` one test
  per area plus none; 2,000 posts bounded; suggestions byte-for-byte; draw with `packs`/`story`;
  init `--kind`.
- Browser `tests/browser/studio-onboarding.spec.mjs`: Grammi (phone): first sign-in → questions →
  summary → voice offer → Start → a story → My stories → Write's panel; Mikey (keyboard): technical
  answers, nothing seasonal or recipe anywhere, a suggestion's details, turns on Code and diagrams
  in What you use and Research from Find; a recipe site answered as technical keeps recipes; the
  turned-off page; axe, 320 px, reduced motion on each new screen.
