# Studio's words

Studio (the new Admin) speaks to the person who writes on the blog in plain words. Its built-in
words read right for any owner: it says "the person who set up your site" for whoever helps her,
"your blog" for the site, and names no particular person, family or food. A site, or a host
serving many sites, can change those words without changing Studio: name the person who helps
("Tell Mikey."), sign new cards with love, or call the blog "your website".

Nothing here is edited in Studio itself: the developer changes a file, and Studio shows the new
words the next time it opens.

## Where the changes live

- **The site:** `studio.words` in `openblog.json`. It is versioned with the site.
- **The host:** a JSON file named by the `OPENBLOG_STUDIO_WORDS_PATH` environment variable, for a
  host serving many sites (point each site's server at the same file). The variable is read when
  the server starts; the file itself is read every time Studio opens, so editing it needs no
  restart.

For each variable and each word id, the more specific place wins: **built-in words < the host's
file < the site**. A site that wants the built-in words back writes them out.

## The format

Both places have the same shape:

```json
{
  "vars": { "helper": "Mikey", "owner": "Grammi" },
  "text": { "cards.signOff": "Love, {owner}", "recipe.notesHeading": "{owner}'s notes" }
}
```

In `openblog.json` it sits under `studio.words`:

```json
"studio": { "words": { "vars": { "helper": "Mikey" } } }
```

### The three variables

| Variable | Built-in value | What it is |
| --- | --- | --- |
| `{helper}` | the person who set up your site | Who she asks when something needs fixing |
| `{product}` | your blog | What she calls her site |
| `{owner}` | the first word of `author.name`, or nothing | Her name, for sign-offs and headings |

A variable that starts a sentence (at the start, or after `.`, `!` or `?` and a space) starts with a
capital: `"{helper} can turn it on."` reads
"Mikey can turn it on." or "The person who set up your site can turn it on." Write sentences that
read right with any value: "Tell {helper}.", never "Tell him."

When the blog has no name for her (`author.name` is empty and no `owner` is set), words that need
`{owner}` use a form without it: a new card starts with no sign-off, and a recipe's notes are
called "Notes".

### Word ids

Each sentence Studio lets a site change has a stable id, `area.name`, listed in the table below
with its built-in words. Ids are never renamed or reused; one Studio stops using is reported as no
longer a word id. A changed sentence may use the three variables plus any its built-in words use
(`{theme}`, `{title}`...).

### Limits, and why

A change that breaks a rule is dropped and the built-in words show; the rest still apply. Studio
never stops because of a bad entry.

| Rule | Why |
| --- | --- |
| Text only: no `<` or `>`, no links (`://`, `www.`), no control or direction characters, no spaces at either end | Words are always shown as text, never as markup or a link |
| Letters written whole: an accent typed as a separate mark ("e" then "´") is refused; type "é" | The same words always compare and count the same (Unicode NFC) |
| A variable's value: 60 characters at most, no `{` or `}` | It fills many sentences |
| A sentence: its own limit in the table (twice its built-in length, at least 40, at most 240) | It has to fit where it is shown, on a phone |
| Only known ids and variables | A typo is reported, not silently ignored |
| Sentences she reads (layer `her`) and every variable: none of the words `studio-ux` keeps off her layer ("deploy", "sync", "upload"...) | She never meets the system's words |
| The host's file: 64 KiB and 500 entries at most | |

`studio` and `studio.words` accept only the keys above; anything else stops the site's
configuration from loading, like any other unknown key.

## Where problems show

Problems are for the developer only, never on her screens:

- **Home → "For {helper}"** (the details at the bottom of Home) has **Words**: how many sentences
  this site and the host's file change, each as `id: text (site)`, then each problem in words.
  Hidden when nothing is changed and nothing is wrong.
- **`openblog check`** prints the same problems. It fails only for a problem in the site's own
  `openblog.json`; a problem in the host's file is a warning.

## Examples

**Grammi's House**, a recipe blog. Mikey set it up for his mother, who asked to see his name
instead of "the person who set up your site":

```json
"author": { "name": "Grammi" },
"studio": { "words": {
  "vars": { "helper": "Mikey", "owner": "Grammi" },
  "text": {
    "cards.signOff": "Love, {owner}",
    "recipe.notesHeading": "{owner}'s notes",
    "decorations.everyday": "Your house is wearing its everyday look: {theme}.",
    "decorations.decorated": "Your house is decorated for {theme}."
  }
} }
```

She reads "Tell Mikey.", "Details for Mikey" and "Mikey can turn it on."; a new card starts
"Love, Grammi", a new recipe's notes are "Grammi's notes", and Decorations says "Your house is
decorated for Christmas."

**Dana's roofing site**, on a host serving many sites. The host's file
(`OPENBLOG_STUDIO_WORDS_PATH=/etc/openblog/studio-words.json`):

```json
{ "vars": { "helper": "Hillside Web Care" } }
```

Dana's `openblog.json`:

```json
"studio": { "words": {
  "vars": { "product": "your website", "owner": "Dana" },
  "text": { "cards.signOff": "Thanks, {owner} at Ridgeline Roofing" }
} }
```

Dana reads "Tell Hillside Web Care." and "Your website is decorated for Autumn."; if her site set
`helper` too, the site's value would win.

## For Studio's developers

Words come from `say("area.name", values)` in `web/studio/parts/words.js`; each id's built-in words
live in a pure `parts/*-words.js` file exporting `WORDS`. After adding or changing an id, run
`node scripts/studio-words.mjs` (it writes `web/studio/words.json`, which the server checks changes
against, and the table below), then `node scripts/studio-files.mjs`. The tests fail when either is
out of date. See `.claude/skills/studio-architecture/SKILL.md`.

## Every word id

<!-- words:start -->
| Id | Layer | Built-in words | Variables | Limit |
| --- | --- | --- | --- | --- |
| `about.aliasFix` | her | An old address in this post can't be used. {helper} can fix it in the file. | `{helper}` | 150 |
| `add.alreadyThere` | her | This post already has an {thing}. | `{thing}` | 66 |
| `add.alreadyThereRefs` | her | This post already has its {thing}. | `{thing}` | 68 |
| `add.asWritten` | details | Show the words as written | none | 50 |
| `add.asWrittenHelp` | details | Everything exactly as it's saved. Turn this off to see cards again. | none | 134 |
| `add.back` | her | ‹ Everything you can add | none | 48 |
| `add.button` | her | Add something | none | 40 |
| `add.buttonTo` | her | Add something to {box} | `{box}` | 44 |
| `add.cleared` | her | Cleared. | none | 40 |
| `add.count` | her | {count} things | `{count}` | 40 |
| `add.countOne` | her | 1 thing | none | 40 |
| `add.detailsNote` | details | Everything here writes ordinary Markdown into content/posts/{file}. Pieces are checked and written by {product} (POST /admin/api/pieces), so the file holds exactly what the build reads. | `{file}` `{product}` | 240 |
| `add.find` | her | Find something to add | none | 42 |
| `add.findAdd` | her | Add {thing} | `{thing}` | 40 |
| `add.findSuggestions` | her | Suggestions | none | 40 |
| `add.finish` | her | Finish adding the {thing} | `{thing}` | 50 |
| `add.heading` | her | Add something | none | 40 |
| `add.more` | her | Add something… | none | 40 |
| `add.moreThings` | her | More things | none | 40 |
| `add.mostUsed` | her | Most used | none | 40 |
| `add.never` | her | Never mind | none | 40 |
| `add.nothing` | her | Nothing called “{words}”. | `{words}` | 50 |
| `add.nothingHelp` | her | Try another word, or close this and keep writing. | none | 98 |
| `add.photoTo` | her | Put a photo in {box} | `{box}` | 40 |
| `add.putPhoto` | her | Put a photo in | none | 40 |
| `add.slashTip` | her | Tip: type / on an empty line to add something. | none | 92 |
| `add.whereAfter` | her | It goes in {box}, after “{words}”. | `{box}` `{words}` | 68 |
| `add.whereEnd` | her | It goes at the end of {box}. | `{box}` | 56 |
| `add.whereIn` | her | It goes in {box}. | `{box}` | 40 |
| `add.whereStart` | her | It goes at the start of {box}. | `{box}` | 60 |
| `add.wordsHelp` | her | Leave an empty line between paragraphs. For a list, start each line with a dash (-). Photos, tips and tables show as cards: change them with their buttons. | none | 240 |
| `add.yourWords` | her | your words | none | 40 |
| `bluesky.nameError` | her | Type your Bluesky name, like yourname.bsky.social. | none | 100 |
| `bluesky.namePlaceholder` | her | yourname.bsky.social | none | 60 |
| `card.answers` | her | {count} answers | `{count}` | 40 |
| `card.asWritten` | details | Change it in the words as written | none | 66 |
| `card.button` | her | Button: {words} | `{words}` | 40 |
| `card.cantChange` | her | This one can't be changed here. {helper} can. | `{helper}` | 90 |
| `card.change` | her | Change | none | 40 |
| `card.checklist` | her | Checklist, {count} things | `{count}` | 50 |
| `card.code` | details | Code, {language}, {count} lines | `{language}` `{count}` | 62 |
| `card.codepen` | details | A CodePen: {words} | `{words}` | 40 |
| `card.compare` | her | Before and after photos: {words} | `{words}` | 64 |
| `card.elsewhere` | her | This photo is on another website. | none | 66 |
| `card.faq` | her | Questions and answers, {count} | `{count}` | 60 |
| `card.footnote` | her | Note at the bottom, {n}: {words} | `{n}` `{words}` | 64 |
| `card.fromVimeo` | her | From Vimeo | none | 40 |
| `card.fromYouTube` | her | From YouTube | none | 40 |
| `card.goesTo` | her | Goes to: {words} | `{words}` | 40 |
| `card.keepWriting` | her | Keep writing… | none | 40 |
| `card.map` | her | Map: {words} | `{words}` | 40 |
| `card.more` | her | +{count} more | `{count}` | 40 |
| `card.moreColumns` | her | +{count} more columns | `{count}` | 42 |
| `card.move` | her | Move | none | 40 |
| `card.moveDown` | her | Move down | none | 40 |
| `card.moveUp` | her | Move up | none | 40 |
| `card.part` | her | {label}, part {part} of {parts} | `{label}` `{part}` `{parts}` | 62 |
| `card.photo` | her | Photo: {words} | `{words}` | 40 |
| `card.photoNoWords` | her | A photo with no description | none | 54 |
| `card.quiz` | her | Question for readers: {words} | `{words}` | 58 |
| `card.social` | her | Links: {words} | `{words}` | 40 |
| `card.table` | her | Table, {columns} columns, {rows} rows | `{columns}` `{rows}` | 74 |
| `card.takeOut` | her | Take it out | none | 40 |
| `card.unclosed` | her | Part of this post is open as written | none | 72 |
| `card.unclosedLine` | details | A code block starting on line {line} never ends. | `{line}` | 96 |
| `card.unclosedWhy` | her | So nothing in it gets moved around. | none | 70 |
| `card.video` | her | Video: {words} | `{words}` | 40 |
| `card.videoLink` | her | Video from YouTube | none | 40 |
| `card.wordsUnder` | her | Words under it: {words} | `{words}` | 46 |
| `card.writeHere` | her | Write here | none | 40 |
| `cards.notSetUp` | her | {helper} needs to finish setting them up. Your site works the same without them. | `{helper}` | 160 |
| `cards.signOff` | her | {owner} (with no name: "") | `{owner}` | 80 |
| `check.addWords` | her | Add words | none | 40 |
| `check.allCaps` | her | This is all in capital letters, which can read like shouting. | none | 122 |
| `check.changeWords` | her | Change the words | none | 40 |
| `check.describeIt` | her | Describe it | none | 40 |
| `check.emptyAddress` | her | A link doesn't go anywhere yet. | none | 62 |
| `check.emptyLink` | her | A link has no words, so no one can tell where it goes. | none | 108 |
| `check.fixIt` | her | Fix it | none | 40 |
| `check.headingSkip` | her | This heading is smaller than it should be after the one before it. | none | 132 |
| `check.html` | details | Line {line} has an HTML tag. It is kept and shown as written. | `{line}` | 122 |
| `check.insecure` | her | This web address starts with http://. Most sites also work with https://, which is safer. | none | 178 |
| `check.longParagraph` | her | This paragraph is {count} words long. Shorter ones are easier to read on a phone. | `{count}` | 162 |
| `check.many` | her | {count} suggestions for your words | `{count}` | 68 |
| `check.none` | her | No suggestions. Nothing to fix. | none | 62 |
| `check.one` | her | 1 suggestion for your words | none | 54 |
| `check.photoDescription` | her | A photo has no description, so people who can't see it won't know what it shows. | none | 160 |
| `check.showMe` | her | Show me | none | 40 |
| `check.useHttps` | her | Use https | none | 40 |
| `check.useWords` | her | Use these words | none | 40 |
| `check.vagueLink` | her | The link “{words}” doesn't say where it goes. Words that name the place are easier to follow. | `{words}` | 186 |
| `checklist.freeSpot` | her | Ask {helper} to free that spot. | `{helper}` | 62 |
| `common.ask` | her | Ask {helper}. | `{helper}` | 40 |
| `common.canChange` | her | {helper} can change that. | `{helper}` | 50 |
| `common.canTurnOn` | her | {helper} can turn it on. | `{helper}` | 48 |
| `common.catchesUp` | her | Your public site catches up when {helper} sends it out. | `{helper}` | 110 |
| `common.chose` | her | {helper} chose this. | `{helper}` | 40 |
| `common.detailsFor` | her | Details for {helper} | `{helper}` | 40 |
| `common.forHelper` | her | For {helper} | `{helper}` | 40 |
| `common.keepsHappening` | her | Try again, and if it keeps happening, tell {helper}. | `{helper}` | 104 |
| `common.letKnow` | her | Let {helper} know. | `{helper}` | 40 |
| `common.stopWaiting` | her | Stop waiting | none | 40 |
| `common.tell` | her | Tell {helper}. | `{helper}` | 40 |
| `common.tryAgain` | her | Try again | none | 40 |
| `common.whatGoes` | her | What goes to {company} | `{company}` | 44 |
| `common.wordForWord` | her | Word for word | none | 40 |
| `copy.notReady` | her | Your blog can't make a copy for it right now. Try another, or tell {helper}. | `{helper}` | 152 |
| `decorations.betweenOff` | her | The look {product} wears while the calendar is off. | `{product}` | 102 |
| `decorations.byItself` | her | {product} changes by itself on the days below. | `{product}` | 92 |
| `decorations.calendarOff` | her | {product} wears {theme} every day. The calendar is off. | `{product}` `{theme}` | 110 |
| `decorations.decorated` | her | {product} is decorated for {theme}. | `{product}` `{theme}` | 70 |
| `decorations.everyDay` | her | {product} wears {theme} every day. | `{product}` `{theme}` | 68 |
| `decorations.everyday` | her | {product} is wearing its everyday look: {theme}. | `{product}` `{theme}` | 96 |
| `decorations.noSeasons` | her | Add one, like Christmas from December 1 to January 6, and {product} changes by itself. | `{product}` | 172 |
| `decorations.putUpEarly` | her | {product} is decorated for {theme}, put up early. It stays up through {until}. | `{product}` `{theme}` `{until}` | 156 |
| `decorations.whenYouSave` | her | When you save, {product} wears {theme} every day. Your seasons are kept for when you turn this back on. | `{product}` `{theme}` | 206 |
| `design.addSeason` | her | Add it to your calendar | none | 46 |
| `design.another` | her | Describe another look | none | 42 |
| `design.back` | her | Back to the one before | none | 44 |
| `design.backDone` | her | Back to the one before. | none | 46 |
| `design.badIdea` | her | Your helper's idea couldn't be used, so nothing changed. Try again, or say it another way. | none | 180 |
| `design.baseGone` | her | That look isn't on your site any more. Choose another to start from. | none | 136 |
| `design.baseHelp` | her | Your new look keeps this look's layout and seasonal touches, and changes the colors and lettering. | none | 196 |
| `design.baseLabel` | her | Start from | none | 40 |
| `design.baseOwn` | her | The look your site has now | none | 52 |
| `design.cantSave` | her | This look couldn't be saved. Try drafting it again. | none | 102 |
| `design.change` | her | Change it | none | 40 |
| `design.changeColor` | her | Change {role} | `{role}` | 40 |
| `design.changeLabel` | her | Want something different? Say what to change | none | 88 |
| `design.changePlaceholder` | her | For example: a little warmer, and less green. | none | 90 |
| `design.changeShort` | her | Change | none | 40 |
| `design.changing` | her | Changing it… | none | 40 |
| `design.colorAdjusted` | her | {role} changed, and made a little {way} so it's easy to read. | `{role}` `{way}` | 122 |
| `design.colorLabel` | her | {role} color | `{role}` | 40 |
| `design.colorPicked` | her | {role} changed. | `{role}` | 40 |
| `design.colorReplaced` | her | {role} couldn't be made easy to read, so it uses {replacement} instead. | `{role}` `{replacement}` | 142 |
| `design.colorUndo` | her | Undo | none | 40 |
| `design.colorUndone` | her | {role} is back as it was. | `{role}` | 50 |
| `design.colorWillAdjust` | her | That's hard to read on this page color, so {product} will adjust it until it's easy to read. | `{product}` | 184 |
| `design.darker` | her | darker | none | 40 |
| `design.describeEmpty` | her | Describe the look you want in a few words first. | none | 96 |
| `design.describeLabel` | her | Describe the look you want | none | 52 |
| `design.describeLong` | her | That's {n} letters; the most is 1,000. Say it a little shorter. | `{n}` | 126 |
| `design.describePlaceholder` | her | For example: warm and cozy, deep red and pine green, big easy-to-read writing. | none | 156 |
| `design.detailsBase` | details | Extends the theme “{base}”. | `{base}` | 54 |
| `design.detailsColor` | details | {role}: {given} given, {made} saved | `{role}` `{given}` `{made}` | 70 |
| `design.detailsColors` | details | Colors as they will be saved ({scheme}) | `{scheme}` | 78 |
| `design.detailsDraft` | details | The draft as it is sent | none | 46 |
| `design.detailsLimits` | details | The helper may only propose six colours per scheme, a font, corners and a size; the server refuses anything else. | none | 200 |
| `design.detailsLook` | details | Look choices applied in the preview: {list} | `{list}` | 86 |
| `design.detailsPath` | details | Saved in {path}. | `{path}` | 40 |
| `design.detailsRatio` | details | {role} on {ground}: {ratio} to 1 | `{role}` `{ground}` `{ratio}` | 64 |
| `design.draft` | her | Draft a look | none | 40 |
| `design.drafting` | her | Drafting a look… This can take a minute. | none | 80 |
| `design.easyToRead` | her | Easy to read | none | 40 |
| `design.findDesign` | her | Describe a new look | none | 40 |
| `design.fromBase` | her | as in {base} | `{base}` | 40 |
| `design.goes` | her | What goes to {company}: your description, your site's name and the name of the look you start from. Nothing else. | `{company}` | 226 |
| `design.helperOff` | her | Your writing helper isn't turned on, so it can't draft a look. | none | 124 |
| `design.home` | her | Home | none | 40 |
| `design.idea1` | her | Warm and cozy: deep red, pine green and a little gold, with big easy-to-read writing. | none | 170 |
| `design.idea1Name` | her | Warm and cozy | none | 40 |
| `design.idea2` | her | Spring garden: soft greens and lilac on a light page, gentle and airy. | none | 140 |
| `design.idea2Name` | her | Spring garden | none | 40 |
| `design.idea3` | her | Bold and clear: navy, white and one strong red, square corners, easy to read from across a room. | none | 192 |
| `design.idea3Name` | her | Bold and clear | none | 40 |
| `design.idea4` | her | Fall harvest: burnt orange, wheat and deep brown, warm like a farm table. | none | 146 |
| `design.idea4Name` | her | Fall harvest | none | 40 |
| `design.idea5` | her | Calm night: a dark blue page with warm gold links, quiet and easy on the eyes. | none | 156 |
| `design.idea5Name` | her | Calm night | none | 40 |
| `design.ideasLabel` | her | Or start from an idea | none | 42 |
| `design.inDark` | her | dark mode | none | 40 |
| `design.inLight` | her | light mode | none | 40 |
| `design.leaveAsk` | her | Leave without saving this look? | none | 62 |
| `design.leaveGo` | her | Leave | none | 40 |
| `design.leaveStay` | her | Stay | none | 40 |
| `design.leaveText` | her | The look your helper drafted isn't kept anywhere. | none | 98 |
| `design.lede` | her | Say what you'd like: the colors, the feeling, how big the writing is. Your writing helper drafts a look and shows it on your own front page. Nothing changes until you save it and put it up. | none | 240 |
| `design.letteringLine` | her | Lettering: {body} for writing, {heading} for headings. Corners: {corners}. Writing size: {size}. | `{body}` `{heading}` `{corners}` `{size}` | 192 |
| `design.lighter` | her | lighter | none | 40 |
| `design.loadFailed` | her | This didn't load. | none | 40 |
| `design.look` | her | Look | none | 40 |
| `design.lookAccentNote` | her | While a main color is chosen on How your site looks, links and buttons use that instead. | none | 176 |
| `design.lookLink` | her | How your site looks | none | 40 |
| `design.lookOverrides` | her | Your choices on How your site looks still apply on top: {choices}. | `{choices}` | 132 |
| `design.madeReadable` | her | Changed a little so it's easy to read | none | 74 |
| `design.nameEmpty` | her | Give your new look a name. | none | 52 |
| `design.nameHelp` | her | How it's listed in Decorations. | none | 62 |
| `design.nameLabel` | her | Name | none | 40 |
| `design.nameLine` | her | Keep the name on one line. | none | 52 |
| `design.nameLong` | her | Keep the name to 40 letters or fewer. | none | 74 |
| `design.nameTaken` | her | You already have a look called “{name}”. Choose another name. | `{name}` | 122 |
| `design.noSignal` | her | Drafting a look needs a signal. What you typed is kept here. | none | 120 |
| `design.notSaved` | her | That wasn't saved. Try again in a moment. | none | 82 |
| `design.noteDarker` | her | In {scheme}, the {role} is a little darker so it's easy to read. | `{scheme}` `{role}` | 128 |
| `design.noteLighter` | her | In {scheme}, the {role} is a little lighter so it's easy to read. | `{scheme}` `{role}` | 130 |
| `design.noteReplaced` | her | In {scheme}, the {role} couldn't be made easy to read, so it uses {replacement} instead. | `{scheme}` `{role}` `{replacement}` | 176 |
| `design.previewBack` | her | Back to your new look | none | 42 |
| `design.previewFailed` | her | Your front page couldn't be shown just now. Your new look is still here. | none | 144 |
| `design.previewFrame` | her | Your front page in the new look | none | 62 |
| `design.previewHeading` | her | Your front page in the new look | none | 62 |
| `design.previewNote` | her | Only you can see this. Nothing is saved yet. | none | 88 |
| `design.putUp` | her | Put it up now | none | 40 |
| `design.resultNote` | her | Here's an idea. See it on your front page, change it if you like, then save it. | none | 158 |
| `design.roleAccent` | her | Links and buttons | none | 40 |
| `design.roleBorder` | her | Edges | none | 40 |
| `design.roleMuted` | her | Quiet writing (dates and notes) | none | 62 |
| `design.rolePage` | her | Page | none | 40 |
| `design.roleSurface` | her | Boxes | none | 40 |
| `design.roleText` | her | Writing | none | 40 |
| `design.save` | her | Save this look | none | 40 |
| `design.saved` | her | Saved as “{name}”. It isn't on your site yet. | `{name}` | 90 |
| `design.savedNotBuilt` | her | Saved as “{name}”. Your site couldn't be updated just now; it will be with your next change. | `{name}` | 184 |
| `design.savedToast` | her | Saved as “{name}”. | `{name}` | 40 |
| `design.schemeDark` | her | Dark | none | 40 |
| `design.schemeLabel` | her | Colors for | none | 40 |
| `design.schemeLight` | her | Light | none | 40 |
| `design.see` | her | See it on your front page | none | 50 |
| `design.setUp` | details | Set it up | none | 40 |
| `design.still` | her | Still drafting. | none | 40 |
| `design.stopped` | her | Stopped waiting. Nothing changed. | none | 66 |
| `design.title` | her | Describe a new look | none | 40 |
| `design.undo` | her | Undo | none | 40 |
| `design.undoTooLate` | her | “{name}” is in use or was changed, so it stays. | `{name}` | 94 |
| `design.unsaved` | her | “{name}” is gone. | `{name}` | 40 |
| `design.useSuggested` | her | Use the suggested {role} | `{role}` | 48 |
| `design.wfwBase` | her | The look you start from: {base} | `{base}` | 62 |
| `design.wfwChange` | her | What to change: {description} | `{description}` | 58 |
| `design.wfwDescription` | her | Your description: {description} | `{description}` | 62 |
| `design.wfwPrevious` | her | The look as drafted so far: {draft} | `{draft}` | 70 |
| `design.wfwSite` | her | Your site's name: {site} | `{site}` | 48 |
| `design.withBlack` | her | black | none | 40 |
| `design.withPage` | her | the page color | none | 40 |
| `design.withText` | her | the writing color | none | 40 |
| `design.withWhite` | her | white | none | 40 |
| `did.added` | her | {thing} added. | `{thing}` | 40 |
| `did.cantMoveDown` | her | This is already at the end. | none | 54 |
| `did.cantMoveUp` | her | This is already at the top. | none | 54 |
| `did.cantUndo` | her | This changed since, so it can't be undone here. | none | 94 |
| `did.changed` | her | {thing} changed. | `{thing}` | 40 |
| `did.fixed` | her | Fixed. | none | 40 |
| `did.movedDown` | her | Moved down. It's now after “{words}”. | `{words}` | 74 |
| `did.movedTop` | her | Moved up. It's now at the top. | none | 60 |
| `did.movedUp` | her | Moved up. It's now after “{words}”. | `{words}` | 70 |
| `did.photoIn` | her | Photo put in. | none | 40 |
| `did.takenOut` | her | {thing} taken out. | `{thing}` | 40 |
| `did.undo` | her | Undo | none | 40 |
| `did.undoFind` | her | Undo: {what} | `{what}` | 40 |
| `did.undone` | her | Taken back. | none | 40 |
| `form.addColumn` | her | Add a column | none | 40 |
| `form.addIt` | her | Add it | none | 40 |
| `form.addRow` | her | Add a row | none | 40 |
| `form.addThing` | her | Add a thing | none | 40 |
| `form.addThis` | her | Add this {thing}? | `{thing}` | 40 |
| `form.addThisText` | her | You filled it in but didn't add it. | none | 70 |
| `form.after` | her | After | none | 40 |
| `form.align` | details | Line up column {n} | `{n}` | 40 |
| `form.alignCenter` | details | Centre | none | 40 |
| `form.alignLeft` | details | Left | none | 40 |
| `form.alignNone` | details | As the site does | none | 40 |
| `form.alignRight` | details | Right | none | 40 |
| `form.anyAddress` | details | Or any address: /about/, mailto:, tel: | none | 76 |
| `form.badAddress` | her | That needs to be a web address starting with https://, or one of your posts. | none | 152 |
| `form.badEmail` | her | That doesn't look like an email address. | none | 80 |
| `form.badPhone` | her | Use only numbers, spaces and + - ( ). | none | 74 |
| `form.badVideo` | her | That isn't a YouTube or Vimeo link. Copy it from Share under the video. | none | 142 |
| `form.before` | her | Before | none | 40 |
| `form.buttonFilled` | details | Filled | none | 40 |
| `form.buttonLook` | details | Look | none | 40 |
| `form.buttonOutlined` | details | Outlined | none | 40 |
| `form.buttonTarget` | her | Address, email or number | none | 48 |
| `form.buttonWords` | her | What it says | none | 40 |
| `form.cantAddYet` | her | {product} can't add this yet. {helper} can update it. | `{product}` `{helper}` | 106 |
| `form.cell` | her | Row {row}, {column} | `{row}` `{column}` | 40 |
| `form.changeHeading` | her | Change this heading | none | 40 |
| `form.changeLink` | her | Change this link | none | 40 |
| `form.changeQuote` | her | Change this quote | none | 40 |
| `form.checkHelp` | her | Check what you filled in against the help under each box. | none | 114 |
| `form.checklistThings` | her | Things on the list | none | 40 |
| `form.choose` | her | Choose one of these. | none | 40 |
| `form.choosePost` | her | Choose a post | none | 40 |
| `form.code` | details | Code | none | 40 |
| `form.codeAuto` | details | Automatic | none | 40 |
| `form.codeBadLines` | details | Line numbers look like 2,4-6. | none | 58 |
| `form.codeFrom` | details | On, starting at… | none | 40 |
| `form.codeHighlight` | details | Highlight lines | none | 40 |
| `form.codeHighlightHelp` | details | Like 2,4-6 | none | 40 |
| `form.codeLanguage` | details | Language | none | 40 |
| `form.codeNeed` | details | Write the code. | none | 40 |
| `form.codeNumbers` | details | Line numbers | none | 40 |
| `form.codeOff` | details | Off | none | 40 |
| `form.codeOn` | details | On | none | 40 |
| `form.codeStart` | details | Start at | none | 40 |
| `form.codeTitle` | details | Title | none | 40 |
| `form.column` | her | Column {n} | `{n}` | 40 |
| `form.columnAdded` | her | Column {n} added. | `{n}` | 40 |
| `form.columnGone` | her | Column {n} taken out. | `{n}` | 42 |
| `form.columnNames` | her | Column names | none | 40 |
| `form.contactAddress` | her | Address | none | 40 |
| `form.contactEmail` | her | Email | none | 40 |
| `form.contactPhone` | her | Phone | none | 40 |
| `form.describe` | her | Describe the photo | none | 40 |
| `form.describeAfter` | her | Describe the after photo. | none | 50 |
| `form.describeBefore` | her | Describe the before photo. | none | 52 |
| `form.describeSide` | her | Describe it | none | 40 |
| `form.didntWork` | her | That didn't work. Tell {helper}. | `{helper}` | 64 |
| `form.done` | her | Done | none | 40 |
| `form.email` | her | An email | none | 40 |
| `form.faqAdd` | her | Add a question | none | 40 |
| `form.faqAdded` | her | Question {n} added. | `{n}` | 40 |
| `form.faqAnswer` | her | Answer | none | 40 |
| `form.faqGone` | her | Question {n} taken out. | `{n}` | 46 |
| `form.faqQuestion` | her | Question | none | 40 |
| `form.faqRow` | her | Question {n} | `{n}` | 40 |
| `form.faqTakeOut` | her | Take out question {n} | `{n}` | 42 |
| `form.fillThis` | her | Fill this in. | none | 40 |
| `form.footnote` | details | Note text | none | 40 |
| `form.heading` | her | Heading | none | 40 |
| `form.headingLevel` | details | Level | none | 40 |
| `form.hoursAdd` | her | Add a row | none | 40 |
| `form.hoursAdded` | her | Row {n} added. | `{n}` | 40 |
| `form.hoursDays` | her | Days | none | 40 |
| `form.hoursGone` | her | Row {n} taken out. | `{n}` | 40 |
| `form.hoursHours` | her | Hours | none | 40 |
| `form.hoursNote` | her | A note | none | 40 |
| `form.hoursRow` | her | Row {n} | `{n}` | 40 |
| `form.hoursTakeOut` | her | Take out row {n} | `{n}` | 40 |
| `form.howItLooks` | her | How it looks | none | 40 |
| `form.keepChanges` | her | Keep your changes to the {thing}? | `{thing}` | 66 |
| `form.keepChangesText` | her | You changed it but didn't press Done. | none | 74 |
| `form.keepThem` | her | Keep them | none | 40 |
| `form.leaveAsWas` | her | Leave it as it was | none | 40 |
| `form.leaveOut` | her | Leave it out | none | 40 |
| `form.linkAddress` | her | That needs to be a web address, starting with https://. | none | 110 |
| `form.linkWhere` | her | Where it goes | none | 40 |
| `form.linkWords` | her | Words to show | none | 40 |
| `form.mapFound` | her | Found it: {place}. | `{place}` | 40 |
| `form.mapLat` | details | Latitude | none | 40 |
| `form.mapLink` | her | Map link | none | 40 |
| `form.mapLinkHelp` | her | In OpenStreetMap or Google Maps, find the place, then copy the address from the top of the page. | none | 192 |
| `form.mapLon` | details | Longitude | none | 40 |
| `form.mapNone` | her | That link doesn't say where the place is. | none | 82 |
| `form.mapPlace` | her | Place name | none | 40 |
| `form.mapPlaceHelp` | her | Shown beside the map. | none | 42 |
| `form.mapShort` | her | That's a short link, which doesn't say where the place is. Open it, then copy the long address from the top of the page. | none | 240 |
| `form.moved` | her | This changed while the form was open. Close it and try again. | none | 122 |
| `form.needAfter` | her | Choose the after photo. | none | 46 |
| `form.needAnswer` | her | Write the answer. | none | 40 |
| `form.needBefore` | her | Choose the before photo. | none | 48 |
| `form.needButton` | her | Write what the button says. | none | 54 |
| `form.needColumn` | her | Give at least one column a name. | none | 64 |
| `form.needContact` | her | Fill in at least one. | none | 42 |
| `form.needDays` | her | Write the days. | none | 40 |
| `form.needDescribe` | her | Describe the photo so everyone knows what it shows. | none | 102 |
| `form.needHeading` | her | Write the heading. | none | 40 |
| `form.needHours` | her | Write the hours, or Closed. | none | 54 |
| `form.needHttps` | her | A full web address, starting with https://. | none | 86 |
| `form.needLinkWords` | her | Write the words people tap. | none | 54 |
| `form.needName` | her | Write the name. | none | 40 |
| `form.needNote` | details | Write the note. | none | 40 |
| `form.needPhoto` | her | Choose a photo first. | none | 42 |
| `form.needQuestion` | her | Write the question. | none | 40 |
| `form.needQuote` | her | Write their words. | none | 40 |
| `form.needThings` | her | Write something on each line, or take the empty ones out. | none | 114 |
| `form.needTip` | her | Write what the tip says. | none | 48 |
| `form.needVideoAbout` | her | Say what the video is about. | none | 56 |
| `form.noAnswer` | her | {product} didn't answer, so it isn't in yet. What you filled in is kept. | `{product}` | 144 |
| `form.noTags` | her | This can't hold code like <b>. Take out the part with < and >. | none | 124 |
| `form.noTicks` | her | This can't have three ` marks in a row. | none | 78 |
| `form.offMap` | her | That map link points somewhere off the map. Copy it again. | none | 116 |
| `form.oneLine` | her | Keep this on one line. | none | 44 |
| `form.onePost` | her | One of your posts | none | 40 |
| `form.penAddress` | details | Pen address | none | 40 |
| `form.penBad` | details | That isn't a CodePen address. It looks like https://codepen.io/name/pen/… | none | 146 |
| `form.phone` | her | A phone number | none | 40 |
| `form.photoAdd` | her | Add a photo | none | 40 |
| `form.photoAddHelp` | her | From your phone or computer. | none | 56 |
| `form.photoAdding` | her | Adding your photo… | none | 40 |
| `form.photoAnother` | her | Choose another | none | 40 |
| `form.photoLoading` | her | Finding your photos | none | 40 |
| `form.photoNoSignal` | her | Your photos show here when there's a signal. | none | 88 |
| `form.photoNone` | her | There are no photos on your site yet. Add one above. | none | 104 |
| `form.photoOnSite` | her | Or use one already on your site | none | 62 |
| `form.pictureAddress` | details | Picture address | none | 40 |
| `form.postsNeedSignal` | her | Your posts show here when there's a signal. | none | 86 |
| `form.quizAddAnswer` | her | Add an answer | none | 40 |
| `form.quizAfter` | her | What to tell them after | none | 46 |
| `form.quizAnother` | her | Add another question | none | 40 |
| `form.quizAnswer` | her | Answer {n} | `{n}` | 40 |
| `form.quizAnswerAdded` | her | Answer {n} added. | `{n}` | 40 |
| `form.quizNeedAnswers` | her | Fill in each answer, or take it out. | none | 72 |
| `form.quizNeedRight` | her | Choose the right answer. | none | 48 |
| `form.quizNoLinks` | her | A question for readers can't hold links or photos. | none | 100 |
| `form.quizNumber` | her | Question {n} | `{n}` | 40 |
| `form.quizQuestion` | her | The question | none | 40 |
| `form.quizRight` | her | This one is right | none | 40 |
| `form.quizTakeOut` | her | Take out answer {n} | `{n}` | 40 |
| `form.quoteWho` | her | Who said it | none | 40 |
| `form.quoteWords` | her | Their words | none | 40 |
| `form.row` | her | Row {n} | `{n}` | 40 |
| `form.rowAdded` | her | Row {n} added. | `{n}` | 40 |
| `form.rowGone` | her | Row {n} taken out. | `{n}` | 40 |
| `form.runChallenge` | details | Challenge | none | 40 |
| `form.runExample` | details | Example | none | 40 |
| `form.runExpected` | details | Expected result | none | 40 |
| `form.runExplain` | details | Explanation | none | 40 |
| `form.runHint` | details | Hint | none | 40 |
| `form.runKind` | details | Kind | none | 40 |
| `form.runNeed` | details | Fill in title, what to try and code. | none | 72 |
| `form.runNeedExpected` | details | A challenge needs its expected result. | none | 76 |
| `form.runTodo` | details | A challenge's starter code needs a TODO comment. | none | 96 |
| `form.runTry` | details | What to try | none | 40 |
| `form.runWeb` | details | Web (HTML, CSS, JavaScript) | none | 54 |
| `form.runWebParts` | details | Web code needs a ---html, ---css or ---js part. | none | 94 |
| `form.seeIt` | her | See it in your post | none | 40 |
| `form.seeItNote` | her | Only you can see this. Nothing is added until you press Add it. | none | 126 |
| `form.shortened` | her | Shortened to {max} letters, the most it can hold. | `{max}` | 98 |
| `form.shorter` | her | Shorter, please: {max} letters at most. | `{max}` | 78 |
| `form.sideName` | her | Name for this side | none | 40 |
| `form.signedOut` | her | You're signed out, so it isn't in yet. What you filled in is kept. Press Try again to sign in. | none | 188 |
| `form.socialAdd` | her | Add a link | none | 40 |
| `form.socialAdded` | her | Link {n} added. | `{n}` | 40 |
| `form.socialAddress` | her | Address | none | 40 |
| `form.socialGone` | her | Link {n} taken out. | `{n}` | 40 |
| `form.socialName` | her | Name | none | 40 |
| `form.socialNameHelp` | her | Like Facebook | none | 40 |
| `form.socialRow` | her | Link {n} | `{n}` | 40 |
| `form.socialTakeOut` | her | Take out link {n} | `{n}` | 40 |
| `form.takeLinkOff` | her | Take the link off | none | 40 |
| `form.takeOutColumn` | her | Take out column {n} | `{n}` | 40 |
| `form.takeOutRow` | her | Take out row {n} | `{n}` | 40 |
| `form.takeOutThing` | her | Take out thing {n} | `{n}` | 40 |
| `form.thing` | her | Thing {n} | `{n}` | 40 |
| `form.thingAdded` | her | Thing {n} added. | `{n}` | 40 |
| `form.thingGone` | her | Thing {n} taken out. | `{n}` | 40 |
| `form.ticked` | her | Ticked | none | 40 |
| `form.tipEvery` | details | Every kind | none | 40 |
| `form.tipKind` | her | Kind | none | 40 |
| `form.tipText` | her | What it says | none | 40 |
| `form.tipTitle` | her | A few words on top | none | 40 |
| `form.tipTitleHelp` | her | Like Before you start. | none | 44 |
| `form.tooMuch` | her | That's too much to add at once. Split it into two. | none | 100 |
| `form.tryAgain` | her | Try again | none | 40 |
| `form.videoAbout` | her | What it's about | none | 40 |
| `form.videoAboutHelp` | her | Said before it plays, for people who can't see it. | none | 100 |
| `form.videoLink` | her | YouTube or Vimeo link | none | 42 |
| `form.videoLinkHelp` | her | Copy it from Share under the video. | none | 70 |
| `form.waiting` | her | Waiting for a signal. What you filled in is kept here. Press Add it when you have one. | none | 172 |
| `form.webAddress` | her | Web address | none | 40 |
| `form.website` | her | Another website | none | 40 |
| `form.whatItWrites` | details | What it writes | none | 40 |
| `form.wordsUnder` | her | Words under it | none | 40 |
| `form.wordsUnderHelp` | her | Shown under the photo. | none | 44 |
| `form.yourPosts` | her | Your posts | none | 40 |
| `found.back` | her | ‹ Read it over again | none | 40 |
| `found.bringBack` | her | Bring it back | none | 40 |
| `found.bringBackName` | her | Bring it back: suggestion {n} | `{n}` | 58 |
| `found.cantUndo` | her | Your words changed here since, so this one can't be put back for you. | none | 138 |
| `found.cantUse` | her | Your words changed here, so this one can't be used. Show me to change it yourself. | none | 164 |
| `found.changed` | her | Changed. | none | 40 |
| `found.changedMany` | her | Changed {count} places. | `{count}` | 46 |
| `found.count` | her | {count} suggestions. From your writing helper. It can be wrong. | `{count}` | 126 |
| `found.countOne` | her | 1 suggestion. From your writing helper. It can be wrong. | none | 112 |
| `found.detail` | details | Skill {skill} {version} · {category} · {severity} · {verification} · letters {start}–{end} | `{skill}` `{version}` `{category}` `{severity}` `{verification}` `{start}` `{end}` | 240 |
| `found.fromNotes` | her | Based on your notes. | none | 40 |
| `found.heading` | her | What your helper found | none | 44 |
| `found.inBox` | her | In {box} | `{box}` | 40 |
| `found.near` | her | Near “{words}” | `{words}` | 40 |
| `found.notThis` | her | Not this one | none | 40 |
| `found.notThisList` | her | Not this one ({count}) | `{count}` | 44 |
| `found.notThisName` | her | Not this one: suggestion {n} | `{n}` | 56 |
| `found.putBack` | her | Put back as it was. | none | 40 |
| `found.showAll` | her | Show all | none | 40 |
| `found.showMe` | her | Show me | none | 40 |
| `found.showMeName` | her | Show me: suggestion {n}, {place} | `{n}` `{place}` | 64 |
| `found.sources` | details | Sources: {list} | `{list}` | 240 |
| `found.try` | her | Try: “{words}” | `{words}` | 40 |
| `found.tryNothing` | her | Try: take these words out | none | 50 |
| `found.undo` | her | Undo | none | 40 |
| `found.useAll` | her | Use all {count} | `{count}` | 40 |
| `found.useThis` | her | Use this | none | 40 |
| `found.useThisName` | her | Use this: change “{from}” to “{to}” | `{from}` `{to}` | 240 |
| `found.used` | her | Used | none | 40 |
| `helper.alsoNone` | details | None | none | 40 |
| `helper.alsoPost` | details | Also send another post | none | 44 |
| `helper.alsoSend` | details | Also send | none | 40 |
| `helper.budget` | details | {samples} of {maxSamples} samples, {letters} of {maxLetters} letters | `{samples}` `{maxSamples}` `{letters}` `{maxLetters}` | 160 |
| `helper.budgetOver` | details | That's too many voice samples for one go. Choose fewer. | none | 110 |
| `helper.busy` | her | Your writing helper is busy with something else. Try again in a minute. | none | 142 |
| `helper.busyDetail` | details | Two helper calls are already running on this server (shared by every user). | none | 150 |
| `helper.cardName` | her | Writing helper: {line} | `{line}` | 44 |
| `helper.changedUnder` | her | Something your helper uses has changed. Close this and open it again. | none | 138 |
| `helper.changedUnderDetail` | details | No longer usable: {id}. | `{id}` | 240 |
| `helper.changedWhile` | her | You changed the post while it was reading, so some suggestions may not fit any more. | none | 168 |
| `helper.checking` | her | Checking your writing helper… | none | 58 |
| `helper.close` | her | Close | none | 40 |
| `helper.companyBusy` | her | {company} is busy right now. Try again in a few minutes. | `{company}` | 112 |
| `helper.companyBusyDetail` | details | Provider answered HTTP 429; retry after {seconds} s. | `{seconds}` | 104 |
| `helper.companyBusyPlain` | details | Provider answered HTTP 429. | none | 54 |
| `helper.companyDown` | her | {company} didn't answer, so nothing came back. Your words are as they were. Try again later. | `{company}` | 184 |
| `helper.cutShort` | her | The answer was cut off, so nothing changed. Try a smaller part. | none | 126 |
| `helper.didntWork` | her | That didn't work, and nothing changed. Try again. | none | 98 |
| `helper.findSelected` | her | Read the words I selected | none | 50 |
| `helper.findSetup` | her | Set up the writing helper | none | 50 |
| `helper.finishedToast` | her | Your helper finished reading. | none | 58 |
| `helper.foundNothing` | her | Your helper found nothing to change. It can miss things. | none | 112 |
| `helper.goToSetup` | details | Go to setup | none | 40 |
| `helper.goesDetails` | her | This post's details: {list} | `{list}` | 54 |
| `helper.goesNever` | her | Not your photos, other posts, or anything about your readers. It doesn't look anything up on the web. {company}'s own rules cover what it keeps. | `{company}` | 240 |
| `helper.goesNeverPosts` | her | Not your photos or anything about your readers. It doesn't look anything up on the web. {company}'s own rules cover what it keeps. | `{company}` | 240 |
| `helper.goesNotes` | her | Your notes: {list} | `{list}` | 40 |
| `helper.goesOther` | her | Also, chosen by {helper}: {list} | `{helper}` `{list}` | 64 |
| `helper.goesPart` | her | Your title and the part you're in, about {count}, and the rest of the post, so it reads them in place | `{count}` | 202 |
| `helper.goesSelected` | her | Your title and the words you selected, about {count}, and the rest of the post, so it reads them in place | `{count}` | 210 |
| `helper.goesTo` | her | What goes to {company} | `{company}` | 44 |
| `helper.goesVoice` | her | Your voice guide | none | 40 |
| `helper.goesWords` | her | Your title and your words, about {count} | `{count}` | 80 |
| `helper.groupJob` | her | job details | none | 40 |
| `helper.groupOther` | her | what kind of post it is | none | 46 |
| `helper.groupRecipe` | her | recipe facts | none | 40 |
| `helper.groupSummary` | her | summary | none | 40 |
| `helper.groupTags` | her | tags | none | 40 |
| `helper.groupTrip` | her | trip numbers | none | 40 |
| `helper.groupVideo` | her | video facts | none | 40 |
| `helper.groupWhen` | her | when it appears | none | 40 |
| `helper.keyRejected` | her | {company} didn't accept the key for {product}. Tell {helper}. | `{company}` `{product}` `{helper}` | 122 |
| `helper.keyRejectedDetail` | details | The key was refused (HTTP 401/403). Replace it on the Writing helper screen. | none | 152 |
| `helper.lineFinished` | her | Your helper finished reading. {count} suggestions. | `{count}` | 100 |
| `helper.lineFinishedOne` | her | Your helper finished reading. 1 suggestion. | none | 86 |
| `helper.lineIdle` | her | Read it over, or get a quiz. | none | 56 |
| `helper.lineLeft` | her | {count} suggestions left | `{count}` | 48 |
| `helper.lineLeftOne` | her | 1 suggestion left | none | 40 |
| `helper.lineNoSignal` | her | Needs a signal. | none | 40 |
| `helper.lineNoneLeft` | her | Nothing left to look at. | none | 48 |
| `helper.lineReading` | her | Reading it over… | none | 40 |
| `helper.lookCopy` | her | Spelling, grammar and clear sentences | none | 74 |
| `helper.lookFacts` | her | Facts that need a source | none | 48 |
| `helper.lookFlow` | her | How it flows from start to finish | none | 66 |
| `helper.lookFor` | her | What to look for | none | 40 |
| `helper.lookNone` | her | Choose at least one thing to look for. | none | 76 |
| `helper.lookVoice` | her | Whether it sounds like me | none | 50 |
| `helper.moreHelp` | her | More help | none | 40 |
| `helper.name` | her | Writing helper | none | 40 |
| `helper.noSignal` | her | Your helper needs a signal. Your words are kept here. | none | 106 |
| `helper.nonsense` | her | Your helper sent back something that didn't make sense, so nothing changed. Try again. | none | 172 |
| `helper.noteAuthor` | her | About you | none | 40 |
| `helper.notePost` | her | About this post | none | 40 |
| `helper.noteSite` | her | About {product} | `{product}` | 40 |
| `helper.nothingThere` | her | There are no words there yet. Choose the whole post, or write a little first. | none | 154 |
| `helper.offHeading` | her | Your writing helper isn't turned on | none | 70 |
| `helper.offText` | her | {helper} can turn it on. | `{helper}` | 48 |
| `helper.open` | her | Writing helper… | none | 40 |
| `helper.otherSkills` | details | Other things it can look for | none | 56 |
| `helper.overBudget` | her | That's too many voice samples for one go. Choose fewer under For {helper}. | `{helper}` | 200 |
| `helper.overBudgetDetail` | details | {samples} samples, {letters} letters; one request carries at most {maxSamples} and {maxLetters}. | `{samples}` `{letters}` `{maxSamples}` `{maxLetters}` | 200 |
| `helper.part` | her | The part I'm in | none | 40 |
| `helper.partAll` | her | All of {box} | `{box}` | 40 |
| `helper.partFrom` | her | From “{heading}” to the next heading | `{heading}` | 72 |
| `helper.readOver` | her | Read it over | none | 40 |
| `helper.reading` | her | Reading it over… This can take a minute. | none | 80 |
| `helper.ready` | her | Your helper reads what you choose and suggests changes. Nothing changes until you say so. | none | 178 |
| `helper.reasonBadAddress` | details | The address isn't https. | none | 48 |
| `helper.reasonNoAddress` | details | No address is set. | none | 40 |
| `helper.reasonNoKey` | details | No key is set. | none | 40 |
| `helper.reasonNoModel` | details | No model is chosen. | none | 40 |
| `helper.reasonOtherKey` | details | The saved key is for another company or address. | none | 96 |
| `helper.reasonUnknown` | details | The server says it isn't ready. | none | 62 |
| `helper.refused` | her | {company} wouldn't answer this one. Your words are as they were. | `{company}` | 128 |
| `helper.selectedCount` | her | The words I selected ({count} words) | `{count}` | 72 |
| `helper.selectedOne` | her | The words I selected (1 word) | none | 58 |
| `helper.sendsContext` | details | Context: {list} | `{list}` | 240 |
| `helper.sendsContextNone` | details | Context: none | none | 40 |
| `helper.sendsModel` | details | Model: {model}. Destination: {destination}. Research: off. | `{model}` `{destination}` | 240 |
| `helper.sendsSkills` | details | Skills: {list} | `{list}` | 240 |
| `helper.setItUp` | her | Set it up | none | 40 |
| `helper.signIn` | her | Sign in again, then try once more. Your choices are still here. | none | 126 |
| `helper.skillNoFit` | details | Not for the words you selected | none | 60 |
| `helper.soundLikeMe` | her | Sound like me | none | 40 |
| `helper.stillReading` | her | Still reading. Long posts take longer. | none | 76 |
| `helper.stopWaiting` | her | Stop waiting | none | 40 |
| `helper.stopped` | her | Stopped waiting. Nothing changed in your post. | none | 92 |
| `helper.stoppedDetail` | details | The request may still finish on the server and holds one of its two places until it does. | none | 178 |
| `helper.tooLong` | her | That's more than your helper can read at once. Select a smaller part. | none | 138 |
| `helper.tooLongDetail` | details | At most {max} {unit} ({field}). | `{max}` `{unit}` `{field}` | 62 |
| `helper.tooLongReview` | her | That's more than your helper can read at once. Choose the part you're in, or select less. | none | 178 |
| `helper.tooMuch` | her | That's more than your helper reads at once (about 3,000 words). Select less, or read the whole post. | none | 200 |
| `helper.tookTooLong` | her | {company} took too long, so nothing came back. Try a smaller part. | `{company}` | 132 |
| `helper.tookTooLongDetail` | details | Provider timeout. | none | 40 |
| `helper.turnedOff` | her | Your writing helper was turned off. Tell {helper}. | `{helper}` | 100 |
| `helper.useNotes` | her | Use what your helper knows about you | none | 72 |
| `helper.voiceHas` | her | Your helper can make suggestions sound like you, from your voice guide. | none | 142 |
| `helper.voiceLink` | her | Your writing voice | none | 40 |
| `helper.voiceNone` | her | Write a few short pieces so your helper learns how you sound. | none | 122 |
| `helper.wfwCant` | her | (This one couldn't be shown just now. It still goes.) | none | 106 |
| `helper.wfwDetails` | her | This post's details: | none | 40 |
| `helper.wfwLoading` | her | Getting the words… | none | 40 |
| `helper.wfwNote` | her | {name}: | `{name}` | 40 |
| `helper.wfwReading` | her | Reading this part: | none | 40 |
| `helper.wfwTitle` | her | Title: {title} | `{title}` | 40 |
| `helper.wfwWords` | her | Your words: | none | 40 |
| `helper.whatToRead` | her | What to read | none | 40 |
| `helper.whole` | her | The whole post | none | 40 |
| `helper.wordForWord` | her | Word for word | none | 40 |
| `helper.writeUp` | her | Write it up for me | none | 40 |
| `hgen.backAgain` | her | Back as you had it. | none | 40 |
| `hgen.badLanguage` | details | This site can't run {language}. Choose Rust or Web, or ask {helper}. | `{language}` `{helper}` | 200 |
| `hgen.codeButton` | details | Draft it for me | none | 40 |
| `hgen.codeKind` | details | {kind}, in {language} | `{kind}` `{language}` | 42 |
| `hgen.codeWrite` | details | Draft it | none | 40 |
| `hgen.codeWriting` | details | Drafting the code… | none | 40 |
| `hgen.codeWritten` | details | Drafted. Read the code before you add it. It can be wrong, and nothing has run. | none | 158 |
| `hgen.empty` | her | Write a little first, or select some words. | none | 86 |
| `hgen.goesAll` | her | All your words, about {count} | `{count}` | 58 |
| `hgen.goesPart` | her | The part you're in, about {count} words (“{heading}”) | `{count}` `{heading}` | 106 |
| `hgen.goesSelected` | her | The words you selected, about {count} | `{count}` | 74 |
| `hgen.howMany` | her | How many questions | none | 40 |
| `hgen.never` | her | Never mind | none | 40 |
| `hgen.nothingElse` | her | Nothing else: not your title, notes, photos or readers. It writes questions with answers for you to check. Nothing goes in your post until you press Add it. | none | 240 |
| `hgen.nothingElseCode` | details | Nothing else: not your title, notes, photos or readers. Nothing runs here, and nothing goes in your post until you press Add it. | none | 240 |
| `hgen.putBack` | her | Put back what I had | none | 40 |
| `hgen.quizButton` | her | Write questions for me | none | 44 |
| `hgen.replaces` | her | This replaces the question you started. | none | 78 |
| `hgen.replacesCode` | details | This replaces what's in the form. | none | 66 |
| `hgen.tooMuch` | her | That's more than your helper can read at once (about 8,000 words). Select a part first. | none | 174 |
| `hgen.write` | her | Write them | none | 40 |
| `hgen.writing` | her | Writing questions… | none | 40 |
| `hgen.written` | her | Written. Check each answer before you add it. Your helper can be wrong. | none | 142 |
| `hnote.about` | her | About you | none | 40 |
| `hnote.aboutHelp` | her | Things like how you write and who you write for. Saves by itself. | none | 130 |
| `hnote.backAgain` | her | Your note is back. | none | 40 |
| `hnote.cantRead` | details | This note's file can't be read, so it isn't used. {why} | `{why}` | 240 |
| `hnote.conflict` | her | This note was changed somewhere else. Here it is now; make your change again. | none | 154 |
| `hnote.constraints` | details | Anything else it should keep to | none | 62 |
| `hnote.goWith` | her | These go with your posts only when you leave “Use what your helper knows about you” on. | none | 174 |
| `hnote.goal` | her | What you want it to do | none | 44 |
| `hnote.goalHelp` | her | Like: get someone through it the first time. | none | 88 |
| `hnote.keptPrivate` | details | Kept private: {path}, out of Git. | `{path}` | 200 |
| `hnote.keptShared` | details | Shared with the project: {path}, in Git. | `{path}` | 200 |
| `hnote.knows` | her | What your helper knows about you | none | 64 |
| `hnote.notPrivate` | her | Your notes may not stay private. Tell {helper}. | `{helper}` | 94 |
| `hnote.notSaved` | her | That note wasn't saved. Try again. | none | 68 |
| `hnote.outcomes` | details | Learning outcomes | none | 40 |
| `hnote.removed` | her | Note removed. | none | 40 |
| `hnote.saveFirst` | her | Save your post first, then you can tell your helper about it. | none | 122 |
| `hnote.saved` | her | Saved. | none | 40 |
| `hnote.saving` | her | Saving… | none | 40 |
| `hnote.site` | her | About {product} | `{product}` | 40 |
| `hnote.siteHelp` | her | What it's for and what you put on it. Saves by itself. | none | 108 |
| `hnote.soundsLike` | her | Your helper can make suggestions sound like you, from your voice guide. | none | 142 |
| `hnote.sources` | details | Sources | none | 40 |
| `hnote.tell` | her | Tell your helper about this post | none | 64 |
| `hnote.tooLong` | her | That's too long for your helper. Shorten it a little. | none | 106 |
| `hnote.waiting` | her | Waiting for a signal to save this note. It's kept while this page is open. | none | 148 |
| `hnote.who` | her | Who it's for | none | 40 |
| `hnote.whoHelp` | her | Like: people new to this, or friends who already know it. | none | 114 |
| `home.filesVanish` | her | This server doesn't keep its files when it restarts. Ask {helper} to fix that. | `{helper}` | 156 |
| `home.notUpdated` | her | Your site couldn't be updated. Your work is saved. Let {helper} know; the details are under Your site. | `{helper}` | 204 |
| `home.startCardGo` | her | Continue | none | 40 |
| `home.startCardHeading` | her | Finish getting started | none | 44 |
| `home.startCardText` | her | Step {n} of {total}: {step}. | `{n}` `{total}` `{step}` | 56 |
| `home.storyKept` | her | A recorded story is kept on this phone. | none | 78 |
| `home.storyKeptOpen` | her | Open | none | 40 |
| `home.voiceInviteDismiss` | her | No thanks | none | 40 |
| `home.voiceInviteGone` | her | Okay. It's under Writing helper whenever you want it. | none | 106 |
| `home.voiceInviteHeading` | her | Show your writing helper how you sound | none | 76 |
| `home.voiceInviteNotSaved` | her | That couldn't be remembered just now. Try again later. | none | 108 |
| `home.voiceInviteStart` | her | Try it | none | 40 |
| `home.voiceInviteText` | her | Write for three minutes on a prompt you choose. It's just for your helper and never appears on {product}. | `{product}` | 210 |
| `home.voiceInviteUndo` | her | Undo | none | 40 |
| `home.voiceKept` | her | Your writing voice: changes kept on this phone. | none | 94 |
| `home.voiceKeptOpen` | her | Open | none | 40 |
| `hsetup.accepted` | details | {company} accepted the key. Checked just now. | `{company}` | 90 |
| `hsetup.add` | details | Add | none | 40 |
| `hsetup.added` | details | Added. | none | 40 |
| `hsetup.address` | details | Address | none | 40 |
| `hsetup.addressHelp` | details | An https address that takes open.blog's helper requests. | none | 112 |
| `hsetup.backAgain` | details | It's back. | none | 40 |
| `hsetup.badAddress` | details | The address has to start with https:// and have no name or password in it. | none | 148 |
| `hsetup.badCompany` | details | Choose a company from the list. | none | 62 |
| `hsetup.badgeChecking` | her | Checking | none | 40 |
| `hsetup.badgeOff` | her | Off | none | 40 |
| `hsetup.badgeReady` | her | Ready | none | 40 |
| `hsetup.billed` | details | Each request goes to {destination} and is billed to that key. | `{destination}` | 240 |
| `hsetup.builtIn` | details | Built in | none | 40 |
| `hsetup.cancelSkill` | details | Never mind | none | 40 |
| `hsetup.cantLoad` | details | The settings couldn't be read just now. Close this and open it again. | none | 138 |
| `hsetup.changeSkill` | details | Change | none | 40 |
| `hsetup.changeSkillName` | details | Change {name} | `{name}` | 160 |
| `hsetup.checkIt` | details | Check it | none | 40 |
| `hsetup.checking` | details | Checking the key… | none | 40 |
| `hsetup.company` | details | Company | none | 40 |
| `hsetup.conflict` | details | These settings were changed somewhere else. They're shown again now; the key you typed wasn't saved. Paste it again. | none | 240 |
| `hsetup.conflictPlain` | details | These settings were changed somewhere else. They're shown again now; make your change again. | none | 240 |
| `hsetup.connection` | details | Connection | none | 40 |
| `hsetup.engineGuide` | details | Every request carries open.blog's engine guide: what the build supports, as facts, not instructions. | none | 200 |
| `hsetup.getHeading` | details | Get this page once? | none | 40 |
| `hsetup.getIt` | details | Get it | none | 40 |
| `hsetup.getOnce` | details | Get it once | none | 40 |
| `hsetup.getText` | details | {product} fetches it now and keeps the text; it's never fetched again. | `{product}` | 140 |
| `hsetup.getting` | details | Getting the page… | none | 40 |
| `hsetup.got` | details | Got it. Read it before you keep it. | none | 70 |
| `hsetup.home` | her | Home | none | 40 |
| `hsetup.insecure` | details | This page isn't sent privately (http), so a key typed here could be read on the way. Set up https first. | none | 240 |
| `hsetup.insecureServer` | details | The server refused the key because the request didn't reach it over https. It wasn't saved. Put the proxy in admin.trustedProxies, or set the key in the server's environment. | none | 240 |
| `hsetup.keepIt` | details | Keep it | none | 40 |
| `hsetup.keepIt2` | details | Keep it | none | 40 |
| `hsetup.kept` | details | Kept. It's never fetched again. | none | 62 |
| `hsetup.key` | details | Key | none | 40 |
| `hsetup.keyChanged` | details | The saved key is for {was}. After you save, paste a key for {company}. | `{was}` `{company}` | 140 |
| `hsetup.keyNone` | details | No key is set. | none | 40 |
| `hsetup.keyOther` | details | The saved key is for another company or address, so it isn't used. Paste a key for {company}. | `{company}` | 186 |
| `hsetup.keyRemoved` | details | Key removed. | none | 40 |
| `hsetup.keySaved` | details | Key saved. It won't be shown again. | none | 70 |
| `hsetup.keyServer` | details | A key is set by the server ({name}). It's used instead of any key saved here. | `{name}` | 154 |
| `hsetup.keyServerAlso` | details | A saved key is also kept. | none | 50 |
| `hsetup.keySet` | details | A key is set. It's kept on the computer that runs {product} and never shown. | `{product}` | 152 |
| `hsetup.keyTooLong` | details | That's too long to be a key. | none | 56 |
| `hsetup.leave` | details | Leave | none | 40 |
| `hsetup.leaveHeading` | details | Leave without saving the key? | none | 58 |
| `hsetup.leaveText` | details | It isn't kept anywhere. | none | 46 |
| `hsetup.lede` | her | {product} can read your posts over and suggest changes, using {company}'s AI. It only sends what you choose, and says what before it does. | `{product}` `{company}` | 240 |
| `hsetup.ledeOff` | her | {product} can read your posts over and suggest changes, using AI from a company {helper} chooses. It only sends what you choose, and says what before it does. | `{product}` `{helper}` | 240 |
| `hsetup.model` | details | Model | none | 40 |
| `hsetup.modelHelp` | details | The model's name as {company} writes it. | `{company}` | 80 |
| `hsetup.move` | details | Move | none | 40 |
| `hsetup.moveName` | details | Move {name} | `{name}` | 40 |
| `hsetup.moveTaken` | details | There's already a note in the other place. Remove one of them first. | none | 136 |
| `hsetup.moved` | details | Moved. | none | 40 |
| `hsetup.nameBad` | details | The name needs to end in .md or .txt, with letters, numbers and dashes before it. | none | 162 |
| `hsetup.nameTaken` | details | Something with that name is already kept. Choose another name. | none | 124 |
| `hsetup.newKey` | details | New key | none | 40 |
| `hsetup.newKeyHelp` | details | Paste a new key to replace it. Leave it empty to keep the one that's set. Replacing a key can't be undone here. | none | 222 |
| `hsetup.newKeyHelpNone` | details | Paste the key. It's sent once and never shown again. | none | 104 |
| `hsetup.newSkill` | details | New skill | none | 40 |
| `hsetup.noSignal` | her | Your helper needs a signal. | none | 54 |
| `hsetup.notDone` | details | That didn't work. {why} | `{why}` | 240 |
| `hsetup.notNow` | details | Not now | none | 40 |
| `hsetup.notSaved` | details | That wasn't saved. {why} | `{why}` | 240 |
| `hsetup.notSavedPlain` | details | That wasn't saved, and the key you typed wasn't kept. Try again. | none | 128 |
| `hsetup.off` | her | Your writing helper isn't turned on. {helper} can turn it on here. | `{helper}` | 132 |
| `hsetup.on` | her | Your helper is on. | none | 40 |
| `hsetup.page` | details | A web page | none | 40 |
| `hsetup.pageAddress` | details | The page's address | none | 40 |
| `hsetup.pageBad` | details | Type the page's whole address, starting with https://. | none | 108 |
| `hsetup.pageFacts` | details | From {source}. Final address {final}. Fetched {when}. Type {type}. | `{source}` `{final}` `{when}` `{type}` | 240 |
| `hsetup.pageHelp` | details | Text from web pages is someone else's words. Your helper is told to treat it as data, but read it before you keep it. | none | 240 |
| `hsetup.pageName` | details | Name to keep it under | none | 42 |
| `hsetup.pageText` | details | What the page says (someone else's words) | none | 82 |
| `hsetup.private` | details | Private (out of Git) | none | 40 |
| `hsetup.raw` | details | Status, raw | none | 40 |
| `hsetup.readLine` | details | {where} · {letters} letters | `{where}` `{letters}` | 240 |
| `hsetup.reads` | details | Things it can read | none | 40 |
| `hsetup.remove` | details | Remove | none | 40 |
| `hsetup.removeHeading` | details | Remove the saved key? | none | 42 |
| `hsetup.removeIt` | details | Remove it | none | 40 |
| `hsetup.removeKey` | details | Remove the saved key | none | 40 |
| `hsetup.removeName` | details | Remove {name} | `{name}` | 160 |
| `hsetup.removeText` | details | Your helper stops working until another key is set. The key can't be shown or brought back here. | none | 192 |
| `hsetup.removeTextServer` | details | The server's key keeps working. The saved key can't be shown or brought back here. | none | 164 |
| `hsetup.removed` | details | Removed. | none | 40 |
| `hsetup.replacedByYours` | details | Replaced by yours | none | 40 |
| `hsetup.replacesBuiltIn` | details | Replaces the built-in one | none | 50 |
| `hsetup.save` | details | Save | none | 40 |
| `hsetup.saveAnyway` | details | Save it anyway | none | 40 |
| `hsetup.saveSkill` | details | Save skill | none | 40 |
| `hsetup.saved` | details | Saved. | none | 40 |
| `hsetup.saving` | details | Saving… | none | 40 |
| `hsetup.scopePart` | details | a part | none | 40 |
| `hsetup.scopeSelected` | details | selected words | none | 40 |
| `hsetup.scopeWhole` | details | the whole post | none | 40 |
| `hsetup.shape` | details | That doesn't look like a key from {company} (they start with {prefix}). Check you pasted the key, not a password. | `{company}` `{prefix}` | 240 |
| `hsetup.shared` | details | Shared with the project (in Git) | none | 64 |
| `hsetup.signedOut` | details | You were signed out, so that wasn't saved. Sign in, then save again. | none | 136 |
| `hsetup.signedOutKey` | details | You were signed out, so that wasn't saved, and the key you typed wasn't kept. Sign in, then paste it again. | none | 214 |
| `hsetup.skillBack` | details | The skill is back as it was. | none | 56 |
| `hsetup.skillConflict` | details | This skill was changed somewhere else. Open it again to see it as it is now. | none | 152 |
| `hsetup.skillEmpty` | details | Write the skill first. | none | 44 |
| `hsetup.skillInvalid` | details | {source} · needs fixing | `{source}` | 46 |
| `hsetup.skillLine` | details | {source} · version {version} · reads {scopes} | `{source}` `{version}` `{scopes}` | 200 |
| `hsetup.skillNotSaved` | details | The skill wasn't saved. {why} | `{why}` | 240 |
| `hsetup.skillSaved` | details | Skill saved. | none | 40 |
| `hsetup.skillSource` | details | The skill, as written | none | 42 |
| `hsetup.skills` | details | What it can look for | none | 40 |
| `hsetup.skillsHelp` | details | Skills are instructions only: they can't run anything, reach the network or read files. Posts and notes are always handed over as data, never as instructions. | none | 240 |
| `hsetup.stay` | details | Stay | none | 40 |
| `hsetup.text` | details | Text | none | 40 |
| `hsetup.textEmpty` | details | Paste the text first. | none | 42 |
| `hsetup.textName` | details | Name (ends in .md or .txt) | none | 52 |
| `hsetup.textTooLong` | details | That's more than it can read (64 KiB). Shorten it. | none | 100 |
| `hsetup.texts` | details | Text you add | none | 40 |
| `hsetup.title` | her | Writing helper | none | 40 |
| `hsetup.tooLongSetting` | details | The address or the model's name is too long. | none | 88 |
| `hsetup.tooSoon` | details | It was checked a moment ago. Wait ten seconds, then check again. | none | 128 |
| `hsetup.twoAtOnce` | details | Two helper calls can run at once on this server, shared by everyone signed in. | none | 156 |
| `hsetup.where` | details | Where it's kept | none | 40 |
| `hsetup.yours` | details | Yours | none | 40 |
| `install.signInFirst` | her | You'll sign in once more from the new icon, so have your password handy. If you don't know it, ask {helper} first. | `{helper}` | 228 |
| `item.abstract` | her | Abstract | none | 40 |
| `item.abstractAbout` | her | The short summary research posts start with. | none | 88 |
| `item.button` | her | A button | none | 40 |
| `item.buttonAbout` | her | Takes readers to a page, an email or a phone number. | none | 104 |
| `item.checklist` | her | A checklist | none | 40 |
| `item.checklistAbout` | her | Things to tick off, like what to buy. | none | 74 |
| `item.code` | details | Code | none | 40 |
| `item.codeAbout` | details | A code block with a language, a title and highlighted lines. | none | 120 |
| `item.codepen` | details | A CodePen | none | 40 |
| `item.codepenAbout` | details | A pen shown in the post, by its address. | none | 80 |
| `item.compare` | her | Before and after photos | none | 46 |
| `item.compareAbout` | her | Two photos side by side, like the room before and after. | none | 112 |
| `item.contact` | her | How to reach you | none | 40 |
| `item.contactAbout` | her | Your email, phone and address. | none | 60 |
| `item.faq` | her | Questions and answers | none | 42 |
| `item.faqAbout` | her | Questions readers ask. Each opens to show your answer. | none | 108 |
| `item.footnote` | details | A footnote | none | 40 |
| `item.footnoteAbout` | details | A numbered note at the bottom of the post. | none | 84 |
| `item.heading` | her | A heading | none | 40 |
| `item.headingAbout` | her | A short title that starts a new part of your post. | none | 100 |
| `item.hours` | her | Opening hours | none | 40 |
| `item.hoursAbout` | her | The days and hours you're open. | none | 62 |
| `item.link` | her | A link | none | 40 |
| `item.linkAbout` | her | To one of your posts or another website. | none | 80 |
| `item.map` | her | A map | none | 40 |
| `item.mapAbout` | her | Shows one place. | none | 40 |
| `item.photo` | her | A photo | none | 40 |
| `item.photoAbout` | her | One of your photos, with a few words about it. | none | 92 |
| `item.quiz` | her | A question for readers | none | 44 |
| `item.quizAbout` | her | A quick quiz: readers pick an answer and find out if they're right. | none | 134 |
| `item.quote` | her | A quote | none | 40 |
| `item.quoteAbout` | her | Someone's words, set apart. | none | 54 |
| `item.references` | her | References | none | 40 |
| `item.referencesAbout` | her | The list of works you cite, at the end. | none | 78 |
| `item.runnable` | details | Code readers can run | none | 40 |
| `item.runnableAbout` | details | An example or a challenge readers edit and run. | none | 94 |
| `item.social` | her | Links to your other pages | none | 50 |
| `item.socialAbout` | her | Like your Facebook or Instagram. | none | 64 |
| `item.table` | her | A table | none | 40 |
| `item.tableAbout` | her | Rows and columns, like sizes and prices. | none | 80 |
| `item.tip` | her | A tip or a note | none | 40 |
| `item.tipAbout` | her | A box that stands out, like “Book a week ahead.” | none | 96 |
| `item.video` | her | A video | none | 40 |
| `item.videoAbout` | her | From YouTube or Vimeo. | none | 44 |
| `job.newerVersion` | her | This job was saved by a newer version of your blog's pages. Reload to send it. If it still says this, tell {helper}. | `{helper}` | 232 |
| `kinds.collectionsAbout` | her | A collection gathers posts on one page, like all your posts on one topic. Put a post in one from the post itself. | none | 226 |
| `kinds.collectionsEmpty` | her | A collection gathers posts on one page, like all your posts on one topic. | none | 146 |
| `kinds.pagesAbout` | her | Pages stay put, like About or Contact. Posts come and go by date. | none | 130 |
| `look.designHeading` | her | Make a new look from your words | none | 62 |
| `look.designOpen` | her | Describe a new look | none | 40 |
| `look.designText` | her | Describe the colors and feeling you want. Your writing helper drafts a look you can see before you save it. | none | 214 |
| `look.notAccepted` | her | Your site's settings didn't accept these choices. Your choices are still here; try a different one, or tell {helper}. | `{helper}` | 234 |
| `notify.appSwitch` | her | News from your other apps | none | 50 |
| `notify.canTurnOn` | her | {helper} can turn them on. Your blog works the same without them. | `{helper}` | 130 |
| `notify.nameHelp` | her | So you can tell them apart, like Work phone. | none | 88 |
| `notify.nameMissing` | her | Give it a name, like Work phone. | none | 64 |
| `paste.kept` | her | Pasted. Headings, bold and links kept. Fonts and colours left out. | none | 132 |
| `paste.photoLeftMany` | her | {count} photos were left out because they have no description. Put them in with Put a photo in. | `{count}` | 190 |
| `paste.photoLeftOne` | her | 1 photo was left out because it has no description. Put it in with Put a photo in. | none | 164 |
| `paste.plainKeys` | her | Ctrl+Shift+V pastes plain words. | none | 64 |
| `paste.plainMac` | her | ⌘⇧V pastes plain words. | none | 46 |
| `photo.altHelp` | her | For people who can't see it, like “A red front door with a wreath”. | none | 134 |
| `quote.hostChose` | her | {helper} chose this, so it can't be changed here. | `{helper}` | 98 |
| `ready.addCover` | her | Add a cover photo | none | 40 |
| `ready.addTag` | her | Add a tag | none | 40 |
| `ready.also` | her | Also {count} suggestions. | `{count}` | 50 |
| `ready.alsoOne` | her | Also 1 suggestion. | none | 40 |
| `ready.blockedNote` | her | Fix the things under Needs fixing first. Your words are kept. | none | 122 |
| `ready.blocks` | her | {count} things need fixing before your post can go up. | `{count}` | 108 |
| `ready.build` | her | Something in this post stops {product} from building it. Tell {helper}. | `{product}` `{helper}` | 142 |
| `ready.cardCaption` | her | How your post looks when it's shared | none | 72 |
| `ready.cardFirstLines` | her | The first lines of your post. | none | 58 |
| `ready.cardHelp` | her | What Facebook, text messages and other apps show when someone shares it. | none | 144 |
| `ready.cardLongSummary` | her | Google usually shows about 160 letters; this summary has {count}. The rest may be cut off. | `{count}` | 180 |
| `ready.cardName` | her | {name}: {line} | `{name}` `{line}` | 40 |
| `ready.cardNoPicture` | her | No picture. Add a cover photo and shared links show it. | none | 110 |
| `ready.cardNoSummary` | her | No summary, so your first lines are used. | none | 82 |
| `ready.cardPictureFailed` | her | The picture couldn't be shown here. It may still show when shared. | none | 132 |
| `ready.cardRough` | her | Roughly how it looks. The real card shows when you have a signal. | none | 130 |
| `ready.cardRoughFixFirst` | her | Roughly how it looks. The real card shows once the things above are fixed. | none | 148 |
| `ready.cardRoughHeading` | her | Roughly how it looks in a search or a shared link | none | 98 |
| `ready.cardYourTitle` | her | Your title | none | 40 |
| `ready.changeSummary` | her | Change the summary | none | 40 |
| `ready.checkAgain` | her | Check again | none | 40 |
| `ready.checkEverything` | her | Check everything before you publish | none | 70 |
| `ready.checking` | her | Checking your post… | none | 40 |
| `ready.checkingAgain` | her | Checking again… | none | 40 |
| `ready.checkingShort` | her | Checking… | none | 40 |
| `ready.close` | her | Close | none | 40 |
| `ready.coverDescription` | her | Your cover photo has no description, so people who can't see it won't know what it shows. | none | 178 |
| `ready.coverFileName` | her | Your cover photo's description looks like a file name (“{name}”). Say what it shows instead. | `{name}` | 184 |
| `ready.describeCoverLabel` | her | Describe it: cover photo | none | 48 |
| `ready.describeIt` | her | Describe it | none | 40 |
| `ready.describeLabel` | her | Describe the picture | none | 40 |
| `ready.detailsA11y` | details | Accessibility | none | 40 |
| `ready.detailsBuild` | details | Build notes | none | 40 |
| `ready.detailsCard` | details | Shared card | none | 40 |
| `ready.detailsCardRows` | details | OpenGraph type: {type}. X card: {card}. Image: {image}. Page: {url}. | `{type}` `{card}` `{image}` `{url}` | 136 |
| `ready.detailsCertify` | details | These checks find some source problems. They don't certify WCAG conformance. | none | 152 |
| `ready.detailsPage` | details | Check on the page yourself | none | 52 |
| `ready.detailsPageList` | details | Colour contrast, visible focus, keyboard order, zoom and reflow to 320 px, reduced motion, target size, layouts at phone and desktop widths, and things from other sites. | none | 240 |
| `ready.detailsRaw` | details | Server sentences | none | 40 |
| `ready.detailsRecipe` | details | Recipe codes | none | 40 |
| `ready.detailsSearch` | details | Search hints | none | 40 |
| `ready.fillThis` | her | Write a few words first. | none | 48 |
| `ready.fixFirst` | her | Fix this first. | none | 40 |
| `ready.fixed` | her | Fixed. | none | 40 |
| `ready.goToIt` | her | Go to it | none | 40 |
| `ready.hardToUse` | her | Something here may be hard for some readers to use. | none | 102 |
| `ready.hintDepth` | details | {count} words; 150 or more when the topic needs explaining. | `{count}` | 118 |
| `ready.hintNoOpening` | details | No opening paragraph before the first heading or list. | none | 108 |
| `ready.hintOpening` | details | The opening paragraph is {count} letters; 40–350 answers the question early. | `{count}` | 152 |
| `ready.hintSections` | details | No section headings (## or ###). | none | 64 |
| `ready.hintSource` | details | No link to an outside source. | none | 58 |
| `ready.hintSubtitle` | details | Line under the title is {count} letters; 160 or fewer reads as one line. | `{count}` | 144 |
| `ready.hintSummary` | details | Summary is {count} letters; 50–180 is usual. | `{count}` | 88 |
| `ready.keepWriting` | her | Keep writing | none | 40 |
| `ready.lineBlockOne` | her | 1 thing needs fixing | none | 40 |
| `ready.lineBlocks` | her | {count} things need fixing | `{count}` | 52 |
| `ready.lineChanged` | her | Changed since the last check | none | 56 |
| `ready.lineMany` | her | {count} suggestions | `{count}` | 40 |
| `ready.lineNotChecked` | her | Not checked yet | none | 40 |
| `ready.lineNothing` | her | Nothing to check | none | 40 |
| `ready.lineOne` | her | 1 suggestion | none | 40 |
| `ready.lineSoFar` | her | {count} suggestions so far | `{count}` | 52 |
| `ready.lineSoFarOne` | her | 1 suggestion so far | none | 40 |
| `ready.media` | her | Your video or sound: if there's talking, captions or a written version help people who can't hear it. | none | 202 |
| `ready.needsFixing` | her | Needs fixing first ({count}) | `{count}` | 56 |
| `ready.noName` | her | {product} doesn't have your name yet, so the post doesn't say who wrote it. Tell {helper}. | `{product}` `{helper}` | 180 |
| `ready.noSignal` | her | Waiting for a signal to check the rest. What's here was checked on this {phone}. | `{phone}` | 160 |
| `ready.noTags` | her | No tags yet. A tag puts it with your other posts on the same topic. | none | 134 |
| `ready.nothing` | her | Nothing to check. | none | 40 |
| `ready.nothingHelp` | her | Checks catch some things, not everything. | none | 82 |
| `ready.oneBlock` | her | 1 thing needs fixing before your post can go up. | none | 96 |
| `ready.oneSuggestion` | her | 1 suggestion. It doesn't stop you publishing. | none | 90 |
| `ready.open` | her | Before you publish… | none | 40 |
| `ready.openPublished` | her | Check this post… | none | 40 |
| `ready.otherSite` | her | Something from another website is shown in your post. Check that it works without a mouse. | none | 180 |
| `ready.photoFileName` | her | A photo's description looks like a file name (“{name}”). Say what it shows instead. | `{name}` | 166 |
| `ready.previewMany` | her | {count} things to look at before you publish. | `{count}` | 90 |
| `ready.previewOne` | her | 1 thing to look at before you publish. | none | 76 |
| `ready.sheet` | her | Before you publish | none | 40 |
| `ready.sheetPublished` | her | Check this post | none | 40 |
| `ready.showMe` | her | Show me | none | 40 |
| `ready.showMeLabel` | her | Show me: {what} | `{what}` | 40 |
| `ready.showThem` | her | Show them | none | 40 |
| `ready.someDidntRun` | her | Some checks didn't run, so this list may be missing things. You can still publish. | none | 164 |
| `ready.suggestions` | her | {count} suggestions. None of them stop you publishing. | `{count}` | 108 |
| `ready.suggestionsHeading` | her | Suggestions ({count}) | `{count}` | 42 |
| `ready.table` | her | Your table: check that the top row names each column, like Weight and Time. | none | 150 |
| `ready.titleLong` | her | Google shows about 65 letters of a title; this one has {count}. The rest may be cut off. | `{count}` | 176 |
| `ready.tooLong` | her | This post is too long to check all at once. You can still publish. | none | 132 |
| `ready.undone` | her | Undone. | none | 40 |
| `ready.useWords` | her | Use these words | none | 40 |
| `ready.whenShared` | her | When it's shared | none | 40 |
| `ready.worth` | her | Worth a look ({count}) | `{count}` | 44 |
| `ready.writeSummary` | her | Write a summary | none | 40 |
| `ready.yourTrip` | her | Your trip | none | 40 |
| `ready.yourVideo` | her | Your video | none | 40 |
| `recipe.askAddName` | her | This recipe doesn't say who wrote it. Ask {helper} to add your name. | `{helper}` | 136 |
| `recipe.notesHeading` | her | Notes | none | 60 |
| `recipe.numberedStep` | her | Step {n} starts with its own number. Take it out; {product} numbers the steps. | `{n}` `{product}` | 156 |
| `review.blocking` | her | Needs fixing before it can go up ({count}) | `{count}` | 84 |
| `review.blockingHelp` | her | {product} won't publish the post with these. They can't be marked as checked. | `{product}` | 154 |
| `review.cantRead` | her | {product} couldn't read this post to check it. Tell {helper}. | `{product}` `{helper}` | 122 |
| `review.countChecked` | her | {count} ({checked} checked) | `{count}` `{checked}` | 54 |
| `review.counts` | her | Found by a check: {detected}. Might need a look: {potential}. Only you can check: {review}. | `{detected}` `{potential}` `{review}` | 182 |
| `review.detailsMarksFile` | details | Marks file: {file}. {error} | `{file}` `{error}` | 54 |
| `review.detected` | her | Found by a check ({count}) | `{count}` | 52 |
| `review.detectedHelp` | her | Fix them, or mark them as checked if nothing needs to change. They don't stop you publishing. | none | 186 |
| `review.didMark` | her | Marked as checked. It stays on the list and in the count. | none | 114 |
| `review.didUnmark` | her | No longer marked as checked. | none | 56 |
| `review.didntRun` | her | The research checks didn't run. A research post waits until they do. | none | 136 |
| `review.gateRefuses` | her | This can't be marked as checked: {product} refuses it, so it has to be fixed. | `{product}` | 154 |
| `review.gateRefusesWhenPublished` | her | This can't be marked as checked: once the post is published, {product} refuses this citation, so fix it instead. Until then it only warns. | `{product}` | 240 |
| `review.gateWithholds` | her | This can't be marked as checked. The comparison stays off your site until you look at the place and approve it again. | none | 234 |
| `review.heading` | her | Research checks | none | 40 |
| `review.intro` | her | These are prompts from your research checks, not verdicts: nothing here says the post is true or complete. Only what {product} refuses stops publishing. | `{product}` | 240 |
| `review.mark` | her | Mark as checked | none | 40 |
| `review.markChanged` | her | This list was changed on another computer. Here it is again; mark it again if you still need to. | none | 192 |
| `review.markLabel` | her | Mark as checked: {what} | `{what}` | 46 |
| `review.markNoSignal` | her | Waiting for a signal. Nothing was marked. | none | 82 |
| `review.markRefused` | her | That wasn't marked. Nothing changed. | none | 72 |
| `review.marked` | her | You marked this as checked. It stays on the list until it changes. | none | 132 |
| `review.markedStale` | her | You marked an earlier version of this as checked; it has changed since. Mark it again if it still needs no change. | none | 228 |
| `review.marksUnreadable` | her | Marks can't be read right now, so none are shown or saved. Tell {helper}. | `{helper}` | 146 |
| `review.needsReview` | her | Only you can check these ({count}) | `{count}` | 68 |
| `review.needsReviewHelp` | her | Check them against your sources. They don't stop you publishing. | none | 128 |
| `review.next` | her | Next: | none | 40 |
| `review.notChecked` | her | Not checked: {reason} | `{reason}` | 42 |
| `review.nothing` | her | The research checks found nothing for this post. Checks can't see everything. | none | 154 |
| `review.placeField` | her | In {field} | `{field}` | 40 |
| `review.placeLine` | her | In your words, near “{words}” | `{words}` | 58 |
| `review.placeNotes` | her | In your research notes | none | 44 |
| `review.placeOtherPost` | her | In another of your posts | none | 48 |
| `review.placeResearch` | her | In your research: {thing} {id} | `{thing}` `{id}` | 60 |
| `review.placeWords` | her | In your words | none | 40 |
| `review.potential` | her | Might need a look ({count}) | `{count}` | 54 |
| `review.potentialHelp` | her | They don't stop you publishing. | none | 62 |
| `review.showMe` | her | Show me | none | 40 |
| `review.showMeLabel` | her | Show me: {what} | `{what}` | 40 |
| `review.waiting` | her | Waiting for the research checks. | none | 64 |
| `route.addRoute` | her | Add your route | none | 40 |
| `route.added` | her | Route added. {line} | `{line}` | 40 |
| `route.approximate` | her | The whole shape | none | 40 |
| `route.approximateHelp` | her | A drawing with no map and no place names. Someone who knows the area may recognise where it starts. | none | 198 |
| `route.appsHelp` | her | In AllTrails, Strava or Gaia GPS, use Export or Share and choose GPX. | none | 138 |
| `route.askExact` | her | Show the exact route? | none | 42 |
| `route.askExactText` | her | Anyone can download it and see exactly where you started and finished. Times and your app's details are taken out first. | none | 240 |
| `route.askUse` | her | Use this route? | none | 40 |
| `route.askUseText` | her | You chose a file but didn't add it. | none | 70 |
| `route.back` | her | Before you publish | none | 40 |
| `route.canDownload` | her | Readers can download it. | none | 48 |
| `route.changeRoute` | her | Change your route | none | 40 |
| `route.changed` | her | Changed. {line} | `{line}` | 40 |
| `route.choose` | her | Choose a route file | none | 40 |
| `route.chooseAgain` | her | Choose your route file again to show it this way. | none | 98 |
| `route.climb` | her | Show a drawing of the climb | none | 54 |
| `route.climbM` | her | {m} m climb | `{m}` | 40 |
| `route.comesOff` | her | Your route file comes off your site when you press Update. | none | 116 |
| `route.detailsCleaned` | details | Cleaned file: {size}, {points} track points with position and height. Removed: times, waypoints, routes, names, descriptions, links, the app's details and extensions. | `{size}` `{points}` | 240 |
| `route.detailsKeys` | details | Keys written: {keys} | `{keys}` | 40 |
| `route.detailsPoints` | details | Points read: {points}; kept for the drawing: {kept}; track parts: {parts}. | `{points}` `{kept}` `{parts}` | 148 |
| `route.detailsStaged` | details | Staged: {token} | `{token}` | 40 |
| `route.detailsTrim` | details | Metres left off each end | none | 48 |
| `route.detailsTrimHelp` | details | Any number of metres, 0 to 5000. | none | 64 |
| `route.detailsWhere` | details | Held privately in .openblog/pending-tracks/held/ while the post is a draft or scheduled; at {address} once it is live. Staged copies are kept privately for up to a day. | `{address}` | 240 |
| `route.didntGo` | her | Your route file didn't go with the post. Choose it again in Your route. | none | 142 |
| `route.done` | her | Done | none | 40 |
| `route.drawClimb` | her | Drawing of the climb | none | 40 |
| `route.drawTrimmed` | her | Drawing of your route as readers see it, without the first and last {trim} | `{trim}` | 148 |
| `route.drawWhole` | her | Drawing of your route as readers see it, the whole route | none | 112 |
| `route.exact` | her | The exact route | none | 40 |
| `route.exactHelp` | her | Readers can download your route file and see exactly where you started and finished. | none | 168 |
| `route.expired` | her | Your route file waited too long. Choose it again in Your route, then save. | none | 148 |
| `route.from` | her | From “{name}”: | `{name}` | 40 |
| `route.hidden` | her | Don't show it | none | 40 |
| `route.hiddenHelp` | her | Readers see the numbers only. | none | 58 |
| `route.howMuch` | her | How much of the route readers see | none | 66 |
| `route.keepHidden` | her | Keep it hidden | none | 40 |
| `route.km` | her | {km} km | `{km}` | 40 |
| `route.leaveOff` | her | Leave off at each end | none | 42 |
| `route.leaveOut` | her | Leave it out | none | 40 |
| `route.lede` | her | Choose the route file from your hiking app or watch. It stays on this {phone}: only the numbers and a drawing go to {product}. | `{phone}` `{product}` | 240 |
| `route.ledeExact` | her | Choose the route file from your hiking app or watch. It's read on this {phone}, then a cleaned copy of the route file goes to {product} too, times and your app's details taken out. | `{phone}` `{product}` | 240 |
| `route.ledeHidden` | her | Choose the route file from your hiking app or watch. It stays on this {phone}: only the numbers go to {product}, and a drawing of the climb if you switch it on. | `{phone}` `{product}` | 240 |
| `route.lineExact` | her | Route: readers can download your exact route. | none | 90 |
| `route.lineHidden` | her | Route: readers see the numbers only. | none | 72 |
| `route.lineNone` | her | No route added. | none | 40 |
| `route.lineTrimmed` | her | Route: readers see a drawing without the first and last {trim}. | `{trim}` | 126 |
| `route.lineTrimmedPlain` | her | Route: readers see a drawing without the first and last part. | none | 122 |
| `route.lineWhole` | her | Route: readers see a drawing of the whole route. | none | 96 |
| `route.neverMind` | her | Never mind | none | 40 |
| `route.noDrawing` | her | No drawing. | none | 40 |
| `route.noRoute` | her | That file has no route in it. Some apps save only places; choose the one with your route. | none | 178 |
| `route.noTimes` | her | No times in the file, so How long stays as you wrote it. | none | 112 |
| `route.notGpx` | her | That isn't a route file. Choose the file that ends in .gpx. | none | 118 |
| `route.numbersOnly` | her | Readers see the numbers only: {numbers}. | `{numbers}` | 80 |
| `route.replaces` | her | This replaces the distance, climb and time in your post. | none | 112 |
| `route.sendEmpty` | her | That route file is empty. Choose it again. | none | 84 |
| `route.sendTooBig` | her | That route file is too big for {product} ({max} MB at most). Show less of the route, or ask {helper}. | `{product}` `{max}` `{helper}` | 202 |
| `route.sendUnreadable` | her | {product} couldn't read that route file. Choose another, or show less of the route. | `{product}` | 166 |
| `route.sheet` | her | Your route | none | 40 |
| `route.showIt` | her | Show it | none | 40 |
| `route.takeOff` | her | Take the route off | none | 40 |
| `route.takenOff` | her | Route taken off. | none | 40 |
| `route.tooBig` | her | That route file is too big ({size}). Files up to 10 MB work. | `{size}` | 120 |
| `route.tooManyPoints` | her | That route has too many points to read here. Shorten it in your hiking app, or share a simpler copy. | none | 200 |
| `route.tooShort` | her | Your route is too short to leave that much off each end. Choose less, or don't show it. | none | 174 |
| `route.trim1000` | her | About 1 km (0.6 mi) | none | 40 |
| `route.trim200` | her | About 200 m (650 ft) | none | 40 |
| `route.trim2000` | her | About 2 km (1.2 mi) | none | 40 |
| `route.trim500` | her | About 500 m (1,600 ft) | none | 44 |
| `route.trimmed` | her | The shape, without where it starts and ends | none | 86 |
| `route.trimmedHelp` | her | A drawing with no map and no place names. The first and last part are left off, and so is anywhere it comes close to where it starts or ends. | none | 240 |
| `route.undone` | her | Undone. Your route is as it was. | none | 64 |
| `route.unreadable` | her | That file couldn't be opened. Choose it again. | none | 92 |
| `route.unsafe` | her | That file has something in it besides a route, so it wasn't read. | none | 130 |
| `route.use` | her | Use this route | none | 40 |
| `route.useIt` | her | Use it | none | 40 |
| `route.waitsPrivate` | her | Your route file waits, private, until your post is on your site. | none | 128 |
| `route.waitsSignal` | her | Waiting for a signal to send your route file. The numbers and drawing are in. It sends while this page is open. | none | 222 |
| `route.whatReadersSee` | her | What readers see | none | 40 |
| `share.tellOrSkip` | her | Tell {helper}, or choose Don't share it. | `{helper}` | 80 |
| `social.canTurnOn` | her | {helper} can turn it on. Your site works the same without it. | `{helper}` | 122 |
| `social.facebookNoPage` | her | Facebook didn't show any Page you can post to. You need to run the Page. If you do, ask {helper} to add you to its Facebook app. | `{helper}` | 240 |
| `social.noPlaces` | her | {helper} needs to add Facebook or another place first. | `{helper}` | 108 |
| `social.orgsTruncated` | her | LinkedIn sent only some of your company pages. If yours isn't here, tell {helper}. | `{helper}` | 164 |
| `social.pagesTruncated` | her | Facebook sent only some of your Pages. If yours isn't here, tell {helper}. | `{helper}` | 148 |
| `social.signInAgain` | her | {service} will ask you to sign in. Use the {service} account you used the first time. If {service} shows someone else's name, tell {helper}. | `{service}` `{helper}` | 240 |
| `start.back` | her | Back | none | 40 |
| `start.backToPost` | her | Back to your post | none | 40 |
| `start.chooseLegend` | her | What would you like to tell about? | none | 68 |
| `start.detailsHeading` | details | Getting started | none | 40 |
| `start.detailsMode` | details | Getting started is {value}, set by {source}. | `{value}` `{source}` | 88 |
| `start.doneHeading` | her | You're ready | none | 40 |
| `start.doneHelperOff` | her | Your writing helper isn't on yet. {helper} will set it up. | `{helper}` | 116 |
| `start.doneHelperOn` | her | Your writing helper is on. | none | 52 |
| `start.doneHome` | her | Go to Home | none | 40 |
| `start.doneSeeStories` | her | See your stories | none | 40 |
| `start.doneStories` | her | {n} stories kept, private. | `{n}` | 52 |
| `start.doneStoriesNone` | her | No stories yet. You can tell some any time under Your writing voice. | none | 136 |
| `start.doneStoriesOne` | her | 1 story kept, private. | none | 44 |
| `start.doneVoice` | her | Your helper has learned how you sound. | none | 76 |
| `start.doneVoiceLater` | her | When your writing helper is on, it can learn from your stories under Your writing voice. | none | 176 |
| `start.doneWrite` | her | Write your first post | none | 42 |
| `start.doneWriteAgain` | her | Write a post | none | 40 |
| `start.enough` | her | That's enough for now | none | 42 |
| `start.filesReset` | details | Getting started can't remember where she got to on this server. | none | 126 |
| `start.findStories` | her | Tell a few stories | none | 40 |
| `start.finishLater` | her | Finish later | none | 40 |
| `start.heard` | her | Here's what you said | none | 40 |
| `start.heardNote` | her | A computer wrote this from your voice, so a few words may be wrong. It's kept as you said it. You can polish a copy later in Your writing voice. | none | 240 |
| `start.heardNothing` | her | No words were heard in it. Tell it again, or type it. | none | 106 |
| `start.heardRegion` | her | Your story, as you said it | none | 52 |
| `start.howLegend` | her | How would you like to tell it? | none | 60 |
| `start.keyAccepted` | her | {company} accepted the key. Your writing helper is on. | `{company}` | 108 |
| `start.keyChanged` | her | These settings were changed somewhere else, so the key wasn't saved. Paste it again. | none | 168 |
| `start.keyCheckLater` | her | The key is saved, but it couldn't be checked just now. Your helper will try it when you use it. | none | 190 |
| `start.keyChecking` | her | Checking the key with {company}… | `{company}` | 64 |
| `start.keyEmpty` | her | Paste the key first. | none | 40 |
| `start.keyHeading` | her | Turn on your writing helper | none | 54 |
| `start.keyHelp` | her | It's kept on {product}'s computer and never shown again, not even here. | `{product}` | 142 |
| `start.keyInsecure` | her | This page isn't sent privately, so a key can't be typed here. {helper} can set it up. | `{helper}` | 170 |
| `start.keyLabel` | her | Paste the key | none | 40 |
| `start.keyLeaveAsk` | her | Leave without saving the key? | none | 58 |
| `start.keyLeaveGo` | her | Leave | none | 40 |
| `start.keyLeaveStay` | her | Stay | none | 40 |
| `start.keyLeaveText` | her | It isn't kept anywhere. | none | 46 |
| `start.keyLede` | her | {product} has a writing helper that can read your posts over and suggest changes, using {company}'s AI. To turn it on, it needs a key from {company}. | `{product}` `{company}` | 240 |
| `start.keyNeedsHelper` | her | Your writing helper needs {helper} to finish setting it up. | `{helper}` | 118 |
| `start.keyNext` | her | Next: tell a few stories | none | 48 |
| `start.keyNoSignal` | her | Saving a key needs a signal. Nothing was saved. | none | 94 |
| `start.keyNotSaved` | her | The key wasn't saved. Try again in a moment. | none | 88 |
| `start.keyRejected` | her | {company} didn't accept that key. Check you copied all of it, then paste it again. | `{company}` | 164 |
| `start.keySave` | her | Save the key | none | 40 |
| `start.keySaveAnyway` | her | Save it anyway | none | 40 |
| `start.keySaving` | her | Saving the key… | none | 40 |
| `start.keyShape` | her | That doesn't look like a {company} key. Check you pasted the key, not a password. | `{company}` | 162 |
| `start.keySignedOut` | her | You were signed out, so the key wasn't saved. Sign in, then paste it again. | none | 150 |
| `start.keySkip` | her | Skip — {helper} will set this up | `{helper}` | 64 |
| `start.keyState` | details | Company: {company}. Model: {model}. Sends to: {destination}. Key: {state} | `{company}` `{model}` `{destination}` `{state}` | 146 |
| `start.keyStep1` | her | Go to {site} and sign in, or make an account. | `{site}` | 90 |
| `start.keyStep2` | her | Under Billing, add a way to pay. | none | 64 |
| `start.keyStep3` | her | Open API keys and choose Create key. | none | 72 |
| `start.keyStep4` | her | Copy it and paste it here. | none | 52 |
| `start.keyTooLong` | her | That's too long to be a key. | none | 56 |
| `start.keyWhat` | her | A key is a long code, like a password, that lets {product} use {company}'s helper. {company} charges the account the key belongs to. | `{product}` `{company}` | 240 |
| `start.keyWhere` | her | Where do I get a key? | none | 42 |
| `start.keyWhereOther` | her | {helper} can tell you where to get one. | `{helper}` | 78 |
| `start.laterToast` | her | It'll be here when you come back. | none | 66 |
| `start.loadFailed` | her | Getting started didn't load. | none | 56 |
| `start.markDone` | her | Done: | none | 40 |
| `start.markNotYet` | her | Not yet: | none | 40 |
| `start.menu` | her | Getting started | none | 40 |
| `start.more` | her | More | none | 40 |
| `start.moreName` | her | More: Getting started | none | 42 |
| `start.next` | her | Next | none | 40 |
| `start.noSignal` | her | Getting started needs a signal. Anything you were writing is kept on this phone. | none | 160 |
| `start.practice` | details | Practice run: stories and voice guides made here aren't kept. A key you save is kept. | none | 170 |
| `start.practiceNoSave` | details | Practice: not saved | none | 40 |
| `start.problemMode` | details | {problem} | `{problem}` | 40 |
| `start.readClose` | her | Close | none | 40 |
| `start.readIt` | her | Read it | none | 40 |
| `start.readItName` | her | Read it: {title} | `{title}` | 40 |
| `start.recAgain` | her | Tell it again | none | 40 |
| `start.recAgainAsk` | her | Throw away this recording and tell it again? | none | 88 |
| `start.recAgainYes` | her | Tell it again | none | 40 |
| `start.recCant` | her | Recording doesn't work here. Type it instead. | none | 90 |
| `start.recDenied` | her | {product} isn't allowed to use the microphone on this {phone}. To change that: | `{product}` `{phone}` | 156 |
| `start.recError` | her | The recording stopped by itself. What you said up to then is kept. | none | 132 |
| `start.recKeep` | her | Keep it | none | 40 |
| `start.recLeft` | her | Your recording stopped when you left. It's kept on this phone. | none | 124 |
| `start.recLength` | her | {time} long. | `{time}` | 40 |
| `start.recListen` | her | Your recording | none | 40 |
| `start.recOrType` | her | Or type it instead. | none | 40 |
| `start.recStarting` | her | Your phone may ask to use the microphone. Tap Allow. | none | 104 |
| `start.recStop` | her | Stop | none | 40 |
| `start.recStopName` | her | Stop recording | none | 40 |
| `start.recTime` | her | Stopped at 3 minutes, the longest a story can be. It's kept. | none | 120 |
| `start.recTooBig` | her | That recording is too big to send. Tell a shorter one. | none | 108 |
| `start.recTryAgain` | her | Try again | none | 40 |
| `start.recUnavailable` | her | The microphone didn't start. If another app is using it, close that app and try again. Or type it instead. | none | 212 |
| `start.recUnreadable` | her | That recording can't be read. Tell it again, or type it. | none | 112 |
| `start.recUse` | her | Use this recording | none | 40 |
| `start.recording` | her | Recording {time} of 3:00 | `{time}` | 48 |
| `start.resetFailed` | details | That didn't work. Try again in a moment. | none | 80 |
| `start.resetGone` | details | That account isn't on this site any more. | none | 82 |
| `start.resetKeeps` | details | Their stories stay; erase them under Your writing voice. | none | 112 |
| `start.resumed` | her | Picked up where you left off. | none | 58 |
| `start.sayEngine` | details | Heard by: {engine}. {seconds} seconds, {bytes} bytes. | `{engine}` `{seconds}` `{bytes}` | 106 |
| `start.sayGoesLocal` | her | {product} turns your recording into words on its own computer. Nothing leaves it. | `{product}` | 162 |
| `start.sayGoesOnly` | her | Only the recording goes, not your posts, photos or other stories. {company}'s own rules cover what it keeps. | `{company}` | 216 |
| `start.sayGoesProvider` | her | Your recording, when you finish. | none | 64 |
| `start.sayGone` | her | Out loud isn't available any more. Type it instead. | none | 102 |
| `start.sayHeading` | her | Before you start | none | 40 |
| `start.sayIt` | her | Say it out loud | none | 40 |
| `start.sayItHelp` | her | Out loud: up to three minutes. A computer writes down what you say. | none | 134 |
| `start.sayLocalHeading` | her | Where your recording goes | none | 50 |
| `start.sayNoSignal` | her | Turning it into words needs a signal. Your recording is kept on this phone. | none | 150 |
| `start.sayNotKept` | her | The recording isn't kept after that; the words are. | none | 102 |
| `start.sayStart` | her | Start recording | none | 40 |
| `start.sayType` | her | Type it instead | none | 40 |
| `start.showAgain` | details | Show it again at next sign-in | none | 58 |
| `start.showAgainName` | details | Show it again at next sign-in: {user} | `{user}` | 74 |
| `start.shownAgain` | details | Next time, {user} will see Getting started. | `{user}` | 86 |
| `start.shownAgainUndo` | details | Undo | none | 40 |
| `start.shownAgainUndone` | details | Undone: {user} is back where they were. | `{user}` | 78 |
| `start.signOutRecording` | her | Sign out and throw away your unsaved writing, and a recorded story that hasn't been turned into words? | none | 204 |
| `start.skipRest` | her | Skip the rest | none | 40 |
| `start.skipRestDone` | her | Okay. Getting started is in the menu if you want it. | none | 104 |
| `start.skipStories` | her | Skip stories for now | none | 40 |
| `start.stepAnnounce` | her | Step {n} of {total}: {step}. | `{n}` `{total}` `{step}` | 56 |
| `start.stepHelper` | her | Turn on your writing helper | none | 54 |
| `start.stepName` | her | Getting started, step {n} of {total} | `{n}` `{total}` | 72 |
| `start.stepOf` | her | Step {n} of {total} | `{n}` `{total}` | 40 |
| `start.stepStories` | her | Tell a few short stories | none | 48 |
| `start.stepVoice` | her | Let your helper learn how you sound | none | 70 |
| `start.storiesDone` | her | That's three. Thank you. | none | 48 |
| `start.storiesHeading` | her | Tell a few short stories | none | 48 |
| `start.storiesKept` | her | Your stories so far | none | 40 |
| `start.storiesLede` | her | Your writing helper learns how you sound from your own stories, so its suggestions sound like you. Tell three short ones, the way you'd tell them to a friend. | none | 240 |
| `start.storiesPrivate` | her | They're kept private on {product}'s computer. They never appear on {product}, and nothing is sent anywhere unless you say so. | `{product}` | 240 |
| `start.storiesProgress` | her | {n} of 3 told | `{n}` | 40 |
| `start.storyBusy` | her | That story is still being told somewhere else. | none | 92 |
| `start.storyGone` | her | That story was already thrown away. | none | 70 |
| `start.storyRefused` | her | That one couldn't be kept. Choose another to tell. | none | 100 |
| `start.storyRowSpoken` | her | {title} · told out loud · {words} | `{title}` `{words}` | 66 |
| `start.storyRowTyped` | her | {title} · typed · {words} | `{title}` `{words}` | 50 |
| `start.storySaved` | her | Kept. That's {n} of 3. | `{n}` | 44 |
| `start.storyThrow` | her | Throw this one away | none | 40 |
| `start.storyThrowAsk` | her | Throw away this story? | none | 44 |
| `start.storyThrowName` | her | Throw this one away: {title} | `{title}` | 56 |
| `start.storyThrowNo` | her | Keep it | none | 40 |
| `start.storyThrowText` | her | It's taken off {product}'s computer. It can't be brought back. | `{product}` | 124 |
| `start.storyThrowYes` | her | Throw it away | none | 40 |
| `start.storyThrown` | her | Thrown away. | none | 40 |
| `start.tellAnother` | her | Tell another | none | 40 |
| `start.title` | her | Getting started | none | 40 |
| `start.turnFailed` | her | That couldn't be turned into words, but your recording is still on this phone. Try again, or type it. | none | 202 |
| `start.turning` | her | Turning it into words… | none | 44 |
| `start.turningStill` | her | Still working. Long stories take longer. | none | 80 |
| `start.typeIt` | her | Type it | none | 40 |
| `start.typeItHelp` | her | Typing: you get three minutes. Spelling isn't fixed, so it reads like you. | none | 148 |
| `start.voiceFrom` | her | Learn from these stories | none | 48 |
| `start.voiceHeading` | her | Let your helper learn how you sound | none | 70 |
| `start.voiceKeyProblem` | her | {company} didn't accept the key for {product}, so your helper can't learn yet. Your stories are kept. | `{company}` `{product}` | 202 |
| `start.voiceLearn` | her | Let my helper learn | none | 40 |
| `start.voiceLede` | her | Your helper reads your stories and writes down how you sound, quoting your own words. You see it before anything is saved. | none | 240 |
| `start.voiceRowSpoken` | her | {title} · told · {words} | `{title}` `{words}` | 48 |
| `start.voiceRowTyped` | her | {title} · typed · {words} | `{title}` `{words}` | 50 |
| `start.voiceSaved` | her | Saved. Your helper's suggestions will sound more like you. | none | 116 |
| `start.voiceSkip` | her | Not now | none | 40 |
| `start.welcome` | her | Welcome, {owner} (with no name: "Welcome") | `{owner}` | 40 |
| `start.welcomeLede` | her | A few minutes to get {product} ready for you. You can skip any part. | `{product}` | 136 |
| `suggest.added` | her | Added. | none | 40 |
| `suggest.announce` | her | Suggestion: “{words}”. Press Tab to use it, Escape to skip. | `{words}` | 240 |
| `suggest.billed` | details | Each pause is one billed request. | none | 66 |
| `suggest.findOff` | her | Suggestions as you type: turn off | none | 66 |
| `suggest.findOn` | her | Suggestions as you type: turn on | none | 64 |
| `suggest.label` | her | Suggestion | none | 40 |
| `suggest.noThanks` | her | No thanks | none | 40 |
| `suggest.offToast` | her | Suggestions as you type are off. | none | 64 |
| `suggest.on` | her | Suggestions as you type: on | none | 54 |
| `suggest.onToast` | her | Suggestions as you type are on for this post. | none | 90 |
| `suggest.stopped` | her | Suggestions as you type stopped: {why} | `{why}` | 240 |
| `suggest.toggle` | her | Suggest the next words as I type | none | 64 |
| `suggest.tooLong` | her | Your post is too long for suggestions as you type. | none | 100 |
| `suggest.turnOff` | her | Turn off | none | 40 |
| `suggest.useIt` | her | Use it | none | 40 |
| `suggest.useItName` | her | Use it: suggested words | none | 46 |
| `suggest.waiting` | her | Suggestions as you type: waiting for a signal | none | 90 |
| `suggest.what` | her | While this is on, each time you stop typing your post goes to {company}, which suggests the next few words. Nothing goes in unless you choose it. | `{company}` | 240 |
| `suggest.whatNotes` | her | Your notes go with it: {list}. | `{list}` | 60 |
| `thing.abstract` | her | Abstract | none | 40 |
| `thing.button` | her | Button | none | 40 |
| `thing.caution` | her | Caution | none | 40 |
| `thing.checklist` | her | Checklist | none | 40 |
| `thing.code` | details | Code | none | 40 |
| `thing.codepen` | details | A CodePen | none | 40 |
| `thing.compare` | her | Before and after photos | none | 46 |
| `thing.contact` | her | How to reach you | none | 40 |
| `thing.demo` | her | A lesson demo | none | 40 |
| `thing.faq` | her | Questions and answers | none | 42 |
| `thing.footnote` | details | Footnote | none | 40 |
| `thing.heading` | her | Heading | none | 40 |
| `thing.hours` | her | Opening hours | none | 40 |
| `thing.important` | her | Important | none | 40 |
| `thing.kept` | her | Something {helper} added | `{helper}` | 48 |
| `thing.link` | her | Link | none | 40 |
| `thing.map` | her | Map | none | 40 |
| `thing.note` | her | Note | none | 40 |
| `thing.photo` | her | Photo | none | 40 |
| `thing.quiz` | her | Question for readers | none | 40 |
| `thing.quote` | her | Quote | none | 40 |
| `thing.quoteForm` | her | Your quote request form | none | 46 |
| `thing.references` | her | References | none | 40 |
| `thing.runnable` | details | Code readers can run | none | 40 |
| `thing.social` | her | Links | none | 40 |
| `thing.table` | her | Table | none | 40 |
| `thing.tip` | her | Tip | none | 40 |
| `thing.video` | her | Video | none | 40 |
| `thing.watchOut` | her | Watch out | none | 40 |
| `trip.areaAddress` | her | “{area}” looks like a street address. Use an area name instead, like a park or a mountain range. | `{area}` | 192 |
| `trip.areaField` | her | Just an area's name, not a street address or a house number. | none | 120 |
| `trip.exactRoute` | her | Readers can see exactly where you started and finished. Make sure it doesn't show a home, a campsite, or a place where rare plants or animals live. | none | 240 |
| `trip.noArea` | her | Add where you went, as an area that's safe to share, like a park or a mountain range. | none | 170 |
| `trip.noConditions` | her | Add the conditions: weather, trail, water, what you saw. | none | 112 |
| `trip.noDistance` | her | Add your route, or fill in the distance, so readers know how far you went. | none | 148 |
| `trip.showLess` | her | Show less of the route | none | 44 |
| `undo.askHelp` | her | There's a new {one} with that name now. Ask {helper} to help bring this one back. | `{one}` `{helper}` | 162 |
| `undo.mayFind` | her | “{title}” can't come back from here. {helper} may still find it. | `{title}` `{helper}` | 128 |
| `voice.announceDone` | her | Your rough draft is saved as you wrote it. | none | 84 |
| `voice.announceLeft` | her | {time} left. | `{time}` | 40 |
| `voice.announceResumed` | her | Back where you were. {time} left. | `{time}` | 66 |
| `voice.announceTimeUp` | her | Time's up. Your rough draft is saved as you wrote it. | none | 106 |
| `voice.another` | her | Write another | none | 40 |
| `voice.back` | her | Your writing voice | none | 40 |
| `voice.backToList` | her | Back to your pieces | none | 40 |
| `voice.badgePolished` | her | Polished | none | 40 |
| `voice.badgeRough` | her | Rough | none | 40 |
| `voice.badgeSpoken` | her | Told out loud | none | 40 |
| `voice.cantPolish` | her | This rough draft can't be read, so it can't be polished. | none | 112 |
| `voice.catalogWarning` | details | Your own prompts file: {warning} | `{warning}` | 64 |
| `voice.checkAgain` | her | Check again | none | 40 |
| `voice.checkGone` | her | The piece this quotes is gone, so it couldn't be checked. It's kept. | none | 136 |
| `voice.checkMoved` | her | These words aren't in that piece any more. It's kept; check it. | none | 126 |
| `voice.choiceKeep` | her | Keep what you had | none | 40 |
| `voice.choiceLegend` | her | Changed: {statement} | `{statement}` | 40 |
| `voice.choiceTake` | her | Use the new one | none | 40 |
| `voice.chooseFirst` | her | Choose a prompt first. | none | 44 |
| `voice.chooseHeading` | her | What would you like to write about? | none | 70 |
| `voice.chooseHelp` | her | You get three minutes. Nothing gets corrected, and it never appears on {product}. | `{product}` | 162 |
| `voice.chooseHelpTime` | her | You get {minutes} minutes. Nothing gets corrected, and it never appears on {product}. | `{minutes}` `{product}` | 170 |
| `voice.chooseLegend` | her | Choose one | none | 40 |
| `voice.cli` | details | In a terminal: openblog voice --list shows the same; openblog voice export copies the portable ones. | none | 200 |
| `voice.conflictGone` | her | It was thrown away or replaced somewhere else. Yours is still here. | none | 134 |
| `voice.conflictHeading` | her | This copy was changed somewhere else | none | 72 |
| `voice.conflictKeep` | her | Keep changing mine | none | 40 |
| `voice.conflictMine` | her | Save mine over it | none | 40 |
| `voice.conflictText` | her | Yours has {mine} words; the saved one has {theirs}. Nothing is lost: yours is still here. | `{mine}` `{theirs}` | 178 |
| `voice.conflictTheirs` | her | Use the saved one | none | 40 |
| `voice.conflictUsedSaved` | her | Showing the saved one. | none | 44 |
| `voice.continue` | her | Keep writing | none | 40 |
| `voice.detailsFiles` | details | Each file: where it is kept, its size and its revision | none | 108 |
| `voice.discarded` | her | Your last piece ran out of time with nothing written, so nothing was kept. | none | 148 |
| `voice.drawMore` | her | Show me three others | none | 40 |
| `voice.drewMore` | her | Here are three others. | none | 44 |
| `voice.emptyHeading` | her | No pieces yet | none | 40 |
| `voice.emptyText` | her | A piece is a few minutes of your own writing, on a prompt you choose. It shows your writing helper how you sound, and it never appears on {product}. | `{product}` | 240 |
| `voice.eraseAll` | her | Erase all your voice writing… | none | 58 |
| `voice.eraseChecking` | her | Checking what's there… | none | 44 |
| `voice.eraseCopies` | her | Copies kept on this phone go too. Copies in backups aren't touched; {helper} can remove those. | `{helper}` | 188 |
| `voice.eraseFailed` | her | Nothing was erased. | none | 40 |
| `voice.eraseFile` | details | {path} ({kind}) | `{path}` `{kind}` | 40 |
| `voice.eraseFiles` | details | The {n} files | `{n}` | 40 |
| `voice.eraseHeading` | her | Erase all your voice writing? | none | 58 |
| `voice.eraseNo` | her | Keep it | none | 40 |
| `voice.eraseNothing` | her | There's nothing to erase. | none | 50 |
| `voice.erasePartial` | her | Most of it is erased, but some files are still there. | none | 106 |
| `voice.eraseText` | her | This erases {what} from {product}'s computer. It can't be undone. | `{what}` `{product}` | 130 |
| `voice.eraseYes` | her | Erase it all | none | 40 |
| `voice.erased` | her | Erased. Checked again: nothing is left. | none | 78 |
| `voice.erasing` | her | Erasing… | none | 40 |
| `voice.fileLine` | details | {where} · {bytes} bytes · revision {revision} | `{where}` `{bytes}` `{revision}` | 90 |
| `voice.findGuide` | her | Your voice guide | none | 40 |
| `voice.findHub` | her | Your writing voice | none | 40 |
| `voice.findWrite` | her | Write a piece | none | 40 |
| `voice.finish` | her | I'm done | none | 40 |
| `voice.finishingHeading` | her | Time's up | none | 40 |
| `voice.finishingText` | her | Another window is still saving its last words. This checks again in a moment. | none | 154 |
| `voice.fromEveryPack` | her | Show prompts from every set | none | 54 |
| `voice.fromPack` | her | Showing prompts from {pack}. | `{pack}` | 56 |
| `voice.guideBack` | her | Choose pieces again | none | 40 |
| `voice.guideBroken` | her | Your voice guide can't be read. | none | 62 |
| `voice.guideCantNow` | her | Your helper can't make a voice guide right now. | none | 94 |
| `voice.guideCardHeading` | her | Your voice guide | none | 40 |
| `voice.guideChanged` | her | Your voice guide was changed somewhere else. Make it again to compare with the new one. | none | 174 |
| `voice.guideCrumb` | her | Voice guide | none | 40 |
| `voice.guideDecided` | her | Every change is chosen. | none | 46 |
| `voice.guideDiff` | details | What changes in the file | none | 48 |
| `voice.guideDiscard` | her | Don't save these | none | 40 |
| `voice.guideDiscarded` | her | Nothing was saved. | none | 40 |
| `voice.guideEditLabel` | details | The guide's text (your edits win) | none | 66 |
| `voice.guideEditWait` | details | Read-only until every change is chosen. | none | 78 |
| `voice.guideFreeKept` | her | Your own words outside these lines stay where they are. | none | 110 |
| `voice.guideFrom` | her | Learn from these pieces | none | 46 |
| `voice.guideFromHelp` | her | Up to 8 pieces at a time. Rough drafts show best how you really write. | none | 140 |
| `voice.guideGoesGuide` | her | Your voice guide as it is now | none | 58 |
| `voice.guideGoesNot` | her | Not your posts, photos, or anything about your readers. {company}'s own rules cover what it keeps. | `{company}` | 196 |
| `voice.guideGoesPieces` | her | The pieces you ticked, about {count} words | `{count}` | 84 |
| `voice.guideHas` | her | Made from your pieces. Your writing helper uses it when you turn on Sound like me. | none | 164 |
| `voice.guideHeading` | her | Your voice guide | none | 40 |
| `voice.guideHelperOff` | her | Your writing helper isn't turned on, so it can't make a voice guide yet. | none | 144 |
| `voice.guideLeaveAsk` | her | Leave without saving your voice guide? | none | 76 |
| `voice.guideLeaveGo` | her | Leave | none | 40 |
| `voice.guideLeaveStay` | her | Stay | none | 40 |
| `voice.guideLeaveText` | her | What your helper noticed isn't kept anywhere. | none | 90 |
| `voice.guideLede` | her | Your helper reads the pieces you tick and writes down how you sound, quoting your own words. Nothing is saved until you say so. | none | 240 |
| `voice.guideMade` | details | Made by {skill} with {model}. | `{skill}` `{model}` | 58 |
| `voice.guideMake` | her | Make my voice guide | none | 40 |
| `voice.guideMove` | details | Move it to {where} | `{where}` | 40 |
| `voice.guideMoveAsk` | details | Move the voice guide? | none | 42 |
| `voice.guideMoveNo` | details | Leave it | none | 40 |
| `voice.guideMovePlan` | details | From {from} to {to}, {bytes} bytes, copied unchanged. | `{from}` `{to}` `{bytes}` | 106 |
| `voice.guideMoveYes` | details | Move it | none | 40 |
| `voice.guideMoved` | details | Moved to {where}. | `{where}` | 40 |
| `voice.guideNeedsPieces` | her | Write a piece or two first. Then your helper can make a voice guide from them. | none | 156 |
| `voice.guideNone` | her | Your writing helper can read your pieces and write down how you sound, quoting your own words. | none | 188 |
| `voice.guideNoneTicked` | her | Tick at least one piece. | none | 48 |
| `voice.guideNotSaved` | her | Your voice guide wasn't saved. Try again in a moment. | none | 106 |
| `voice.guideNothingNew` | her | Your helper found nothing new to add. | none | 74 |
| `voice.guideNow` | her | Your guide as it is now | none | 46 |
| `voice.guideNowFailed` | her | Your guide couldn't be shown just now. | none | 76 |
| `voice.guideNowLoading` | her | Getting your guide… | none | 40 |
| `voice.guideOneSample` | details | Lines that rest on one piece: {list} | `{list}` | 72 |
| `voice.guideOver` | her | That's more than your helper reads at once. Untick a few. | none | 114 |
| `voice.guideOwnSections` | her | Your own sections stay: {sections}. | `{sections}` | 70 |
| `voice.guidePending` | her | Choose for each change before saving ({n} left). | `{n}` | 96 |
| `voice.guidePortableBlocked` | details | It quotes private pieces, so it can only be kept private. | none | 114 |
| `voice.guidePropose` | her | Update my voice guide | none | 42 |
| `voice.guideProposeNew` | her | Make my voice guide | none | 40 |
| `voice.guideProvenance` | details | Keep the openblog:voice-provenance line if you edit it; the portable rule relies on it. | none | 174 |
| `voice.guideRead` | her | Read it | none | 40 |
| `voice.guideResultHeading` | her | What your helper noticed | none | 48 |
| `voice.guideResultNote` | her | Each line quotes your own words. Nothing is saved until you press Save. Your helper can be wrong. | none | 194 |
| `voice.guideRow` | her | {title} · {stage} · {words} | `{title}` `{stage}` `{words}` | 54 |
| `voice.guideSave` | her | Save my voice guide | none | 40 |
| `voice.guideSaved` | her | Voice guide saved. | none | 40 |
| `voice.guideStagePolished` | her | polished | none | 40 |
| `voice.guideStageRough` | her | rough | none | 40 |
| `voice.guideStill` | her | Still reading. | none | 40 |
| `voice.guideStopped` | her | Stopped waiting. Nothing was saved. | none | 70 |
| `voice.guideUndone` | her | Your voice guide is back as it was. | none | 70 |
| `voice.guideUnknown` | her | What it doesn't know yet | none | 48 |
| `voice.guideUpdate` | her | Update it from my pieces | none | 48 |
| `voice.guideWhere` | details | The guide is kept in {path}. | `{path}` | 56 |
| `voice.guideWhereNone` | details | No guide is saved yet; a new one is kept private. | none | 98 |
| `voice.guideWorking` | her | Reading your pieces… This can take a minute. | none | 88 |
| `voice.home` | her | Home | none | 40 |
| `voice.inProgress` | her | You have a piece in progress: “{title}”, {time} left. | `{title}` `{time}` | 106 |
| `voice.inProgressDone` | her | Time ran out on “{title}”. Your rough draft is waiting. | `{title}` | 110 |
| `voice.keepWriting` | her | Keep writing | none | 40 |
| `voice.keptPhone` | her | Waiting for a signal. Your writing is kept on this phone. | none | 114 |
| `voice.leaveAsk` | her | Stop writing for now? | none | 42 |
| `voice.leaveGo` | her | Leave | none | 40 |
| `voice.leavePolishAsk` | her | Save your polished copy? | none | 48 |
| `voice.leavePolishGo` | her | Leave without saving | none | 40 |
| `voice.leavePolishSave` | her | Save | none | 40 |
| `voice.leavePolishText` | her | You changed it and didn't save. A copy stays on this phone. | none | 118 |
| `voice.leaveStay` | her | Keep writing | none | 40 |
| `voice.leaveText` | her | The clock keeps going. Come back within {time} to keep writing; after that, your rough draft is saved as it is. | `{time}` | 222 |
| `voice.lede` | her | Write for three minutes about a prompt, the way you'd say it out loud. Your writing helper learns how you sound from these pieces. They never appear on {product}. | `{product}` | 240 |
| `voice.loadFailed` | her | Your pieces didn't load. | none | 48 |
| `voice.loading` | her | Loading… | none | 40 |
| `voice.lockFailedMemory` | her | Your rough draft couldn't be saved just now, and this phone won't keep a copy. Keep this page open until you have a signal. | none | 240 |
| `voice.lockFailedPhone` | her | Your rough draft couldn't be saved just now. Your latest words are kept on this phone; open this page again when you have a signal. | none | 240 |
| `voice.lockFailedSent` | her | Your rough draft couldn't be saved just now, but your words reached {product}. Open this page again when you have a signal. | `{product}` | 240 |
| `voice.lockRetry` | her | Saving your rough draft… trying again. | none | 76 |
| `voice.lockedHeading` | her | Your rough draft is saved | none | 50 |
| `voice.lockedNote` | her | A rough draft stays exactly as you wrote it, typos and all, so it keeps showing how you really write. To fix or reshape it, polish a copy. | none | 240 |
| `voice.lockedTimeUp` | her | Time ran out, so it was saved as it was. | none | 80 |
| `voice.locking` | her | Saving your rough draft… | none | 48 |
| `voice.madePost` | her | Made a draft post. It isn't published. | none | 76 |
| `voice.madePostUndone` | her | The draft post is gone. Your piece didn't change. | none | 98 |
| `voice.makePortable` | details | Make portable | none | 40 |
| `voice.makePost` | her | Turn it into a post | none | 40 |
| `voice.makePostHelp` | her | Makes a draft post from your saved polished copy. It isn't published until you publish it. | none | 180 |
| `voice.makePostSaveFirst` | her | Save your polished copy first. The post is made from the saved copy. | none | 136 |
| `voice.makePrivate` | details | Make private | none | 40 |
| `voice.makingPost` | her | Making the post… | none | 40 |
| `voice.more` | her | More | none | 40 |
| `voice.morePack` | her | Write one from {pack} | `{pack}` | 42 |
| `voice.moveFailed` | details | That wasn't moved: {reason} | `{reason}` | 54 |
| `voice.moveUndo` | details | Undo | none | 40 |
| `voice.moved` | details | Moved to {where}. Copied byte for byte. | `{where}` | 78 |
| `voice.noSignal` | her | That needs a signal. Your writing is kept on this phone. | none | 112 |
| `voice.noSignalList` | her | Your pieces need a signal to show. Anything you were writing is kept on this phone. | none | 166 |
| `voice.notPrivate` | her | Your voice writing may not stay private. | none | 80 |
| `voice.notYet` | her | Sets you haven't written from: {packs}. | `{packs}` | 78 |
| `voice.notYetHeading` | her | Not written yet | none | 40 |
| `voice.nothingYet` | her | Nothing's written yet, so there's nothing to save. Write something, or start over. | none | 164 |
| `voice.openActive` | her | You started “{title}” somewhere else and the clock is still running. | `{title}` | 136 |
| `voice.openContinue` | her | Keep writing it | none | 40 |
| `voice.openExpired` | her | You started “{title}” somewhere else and its time ran out. | `{title}` | 116 |
| `voice.openHeading` | her | You have a piece in progress | none | 56 |
| `voice.openLock` | her | Save what was written | none | 42 |
| `voice.openPost` | her | Open it | none | 40 |
| `voice.openRow` | her | Open | none | 40 |
| `voice.openRowName` | her | Open: {title} | `{title}` | 40 |
| `voice.openScrap` | her | Throw it away | none | 40 |
| `voice.otherSet` | her | Other prompts | none | 40 |
| `voice.otherSetHelp` | her | Prompts {product} doesn't offer any more. Your pieces stay readable. | `{product}` | 136 |
| `voice.phoneRefused` | her | This phone won't keep a copy, so keep this page open until it says Saved. | none | 146 |
| `voice.pieceBoth` | her | Rough draft and polished copy · {date} | `{date}` | 76 |
| `voice.pieceGone` | her | This piece isn't there any more. It may have been moved or erased. | none | 132 |
| `voice.pieceNoRough` | her | Its rough draft is missing, so it can't be opened. | none | 100 |
| `voice.pieceRough` | her | Rough draft only · {date} | `{date}` | 50 |
| `voice.pieceThrow` | her | Throw this piece away… | none | 44 |
| `voice.pieceThrowAsk` | her | Throw away “{title}”? | `{title}` | 42 |
| `voice.pieceThrowBusy` | her | That one is still being written somewhere else. Finish it there first. | none | 140 |
| `voice.pieceThrowFailed` | her | That didn't work. Nothing was thrown away. | none | 84 |
| `voice.pieceThrowNo` | her | Keep it | none | 40 |
| `voice.pieceThrowText` | her | Its rough draft and any polished copy are taken off {product}'s computer. It can't be brought back. Your voice guide keeps what it learned until you update it. | `{product}` | 240 |
| `voice.pieceThrowYes` | her | Throw it away | none | 40 |
| `voice.pieceThrown` | her | Thrown away. | none | 40 |
| `voice.pieceTitle` | her | A piece | none | 40 |
| `voice.polishBody` | her | Polished copy | none | 40 |
| `voice.polishClean` | her | All changes saved. | none | 40 |
| `voice.polishDirty` | her | Changes not saved. A copy is kept on this phone. | none | 96 |
| `voice.polishDirtyMemory` | her | Changes not saved. Keep this page open until you save. | none | 108 |
| `voice.polishEditHeading` | her | Your polished copy | none | 40 |
| `voice.polishEmpty` | her | There's nothing to save yet. | none | 56 |
| `voice.polishHeading` | her | Polish a copy | none | 40 |
| `voice.polishHelp` | her | This one is yours to change: fix typos, cut, reshape and give it a title. Your rough draft stays as it is. | none | 212 |
| `voice.polishInvalid` | her | That couldn't be saved. Check the title has no line breaks. | none | 118 |
| `voice.polishNew` | her | Not saved yet. It starts as a copy of your rough draft. | none | 110 |
| `voice.polishReset` | her | Start the copy over | none | 40 |
| `voice.polishResetDone` | her | Your rough draft is back in the copy. Not saved yet. | none | 104 |
| `voice.polishSave` | her | Save polished copy | none | 40 |
| `voice.polishSaved` | her | Saved. | none | 40 |
| `voice.polishSavedTyping` | her | Saved. What you typed while it saved isn't saved yet. | none | 106 |
| `voice.polishTitle` | her | Title | none | 40 |
| `voice.polishTooLong` | her | That's longer than a piece can hold. Shorten it a little before saving. | none | 142 |
| `voice.postTaken` | her | A post with this name already exists. Change the title of your polished copy, save, and try again. | none | 196 |
| `voice.restoreHeading` | her | Bring back your unsaved changes? | none | 64 |
| `voice.restoreNo` | her | Throw them away | none | 40 |
| `voice.restoreText` | her | Changes you didn't save are kept on this phone. | none | 94 |
| `voice.restoreTextChanged` | her | Changes you didn't save are kept on this phone. The copy was changed somewhere else since, so saving will ask which to keep. | none | 240 |
| `voice.restoreThrown` | her | Thrown away. | none | 40 |
| `voice.restoreYes` | her | Bring them back | none | 40 |
| `voice.restoredCopy` | her | Your latest words were on this phone. They're back. | none | 102 |
| `voice.roughHeading` | her | Rough draft | none | 40 |
| `voice.roughHelp` | her | Spelling and autocorrect are off here on purpose, so it shows how you really write. | none | 166 |
| `voice.roughLabel` | her | Your rough draft | none | 40 |
| `voice.roughOnly` | her | Not polished yet: {prompts}. | `{prompts}` | 56 |
| `voice.roughRegion` | her | Your rough draft, as you wrote it | none | 66 |
| `voice.roughTooLong` | her | That's more than a piece can hold. What's here is saved. | none | 112 |
| `voice.saveFirst` | her | Save your polished copy first. | none | 60 |
| `voice.savePortable` | details | Save as portable | none | 40 |
| `voice.savePrivate` | details | Save as private | none | 40 |
| `voice.saved` | her | Saved. | none | 40 |
| `voice.scrapAsk` | her | Throw away “{title}”? | `{title}` | 42 |
| `voice.scrapNo` | her | Keep it | none | 40 |
| `voice.scrapText` | her | Nothing from it is kept. | none | 48 |
| `voice.scrapYes` | her | Throw it away | none | 40 |
| `voice.scrapped` | her | Thrown away. Nothing was kept. | none | 60 |
| `voice.seeIt` | her | See it | none | 40 |
| `voice.serverTrouble` | her | {product} couldn't do that just now. Your writing is kept on this phone. | `{product}` | 144 |
| `voice.sessionFile` | details | The piece in progress is kept in {path} until it is saved. | `{path}` | 116 |
| `voice.sessionMoved` | her | This piece was finished somewhere else. | none | 78 |
| `voice.sessionStuck` | her | A piece in progress can't be read. | none | 68 |
| `voice.setUpHelper` | details | Set it up | none | 40 |
| `voice.showAll` | her | Show all | none | 40 |
| `voice.signIn` | her | Sign in again to keep going. Your writing is kept on this phone. | none | 128 |
| `voice.signOutAsk` | her | Sign out and throw away your unsaved writing? | none | 90 |
| `voice.signOutGo` | her | Sign out | none | 40 |
| `voice.signOutStay` | her | Stay signed in | none | 40 |
| `voice.signOutText` | her | Changes to your writing voice are kept only on this phone. | none | 116 |
| `voice.start` | her | Start writing | none | 40 |
| `voice.startOver` | her | Start over | none | 40 |
| `voice.startOverAsk` | her | Start over and keep nothing? | none | 56 |
| `voice.startOverText` | her | What you've written in this piece is thrown away. | none | 98 |
| `voice.startOverYes` | her | Start over | none | 40 |
| `voice.startRefused` | her | That prompt can't be used. Choose another. | none | 84 |
| `voice.startedOver` | her | Started over. Nothing was kept. | none | 62 |
| `voice.starting` | her | Starting… | none | 40 |
| `voice.summary` | her | {written}, {polished} polished. | `{written}` `{polished}` | 62 |
| `voice.summaryNone` | her | {written}. | `{written}` | 40 |
| `voice.tagChanged` | her | Changed | none | 40 |
| `voice.tagKept` | her | Kept | none | 40 |
| `voice.tagNew` | her | New | none | 40 |
| `voice.tagSame` | her | Same as before | none | 40 |
| `voice.timerLeft` | her | {time} left | `{time}` | 40 |
| `voice.timerName` | her | Time left | none | 40 |
| `voice.timerUp` | her | Time's up | none | 40 |
| `voice.timerWriting` | her | Writing | none | 40 |
| `voice.title` | her | Your writing voice | none | 40 |
| `voice.toList` | her | See all your pieces | none | 40 |
| `voice.traitFrom` | her | from “{piece}” | `{piece}` | 40 |
| `voice.traitOne` | her | (from one piece only) | none | 42 |
| `voice.undo` | her | Undo | none | 40 |
| `voice.unreadable` | her | Some pieces can't be opened. | none | 56 |
| `voice.unreadableFile` | details | {file}: {guidance} | `{file}` `{guidance}` | 40 |
| `voice.wherePortable` | details | Portable: {path} | `{path}` | 40 |
| `voice.wherePrivate` | details | Private: {path} | `{path}` | 40 |
| `voice.wordRange` | her | About {min} to {max} words. | `{min}` `{max}` | 54 |
| `voice.writeOne` | her | Write a piece | none | 40 |
| `voice.writeTitle` | her | Write a piece | none | 40 |
| `write.collectionHelp` | her | Put it with others, like all your posts on one topic. | none | 106 |
| `write.storyNudgeHeading` | her | Want your helper to sound like you? | none | 70 |
| `write.storyNudgeLater` | her | Not now | none | 40 |
| `write.storyNudgeLaterDone` | her | Okay. It's under Getting started whenever you want it. | none | 108 |
| `write.storyNudgeStop` | her | Don't ask again | none | 40 |
| `write.storyNudgeStopped` | her | Okay, it won't ask again. Getting started is in the menu if you change your mind. | none | 162 |
| `write.storyNudgeText` | her | Tell it a few short stories, typed or out loud. It learns how you talk and write, so its suggestions sound like you, not like a computer. It takes about ten minutes, and the stories never appear on {product}. | `{product}` | 240 |
| `write.storyNudgeUndo` | her | Undo | none | 40 |
| `write.storyNudgeYes` | her | Tell a few stories now | none | 44 |
| `youtube.change` | her | Change | none | 40 |
| `youtube.chapterHelp` | her | Chapters are lines in your words that start with a time, like “0:00 Getting started”. The first starts at 0:00, and YouTube needs at least three, each 10 seconds or longer. | none | 240 |
| `youtube.chapters` | her | {count} chapters, from the lines in your words that start with a time. | `{count}` | 140 |
| `youtube.copyDescription` | her | Copy description | none | 40 |
| `youtube.copyFind` | her | Copy the YouTube description | none | 56 |
| `youtube.copyRefused` | her | Select the words and copy them. | none | 62 |
| `youtube.copyTags` | her | Copy tags | none | 40 |
| `youtube.copyTitle` | her | Copy title | none | 40 |
| `youtube.description` | her | Description | none | 40 |
| `youtube.descriptionBrackets` | her | YouTube doesn't allow < or > in the description. Take them out of the summary, the chapters or the AI note. | none | 214 |
| `youtube.descriptionCopied` | her | Description copied. Paste it into YouTube. | none | 84 |
| `youtube.descriptionTooLong` | her | These words are too long for YouTube, which takes 5,000 at most, counting the chapters. Shorten the summary. | none | 216 |
| `youtube.detailsCli` | details | Check or write out the full release with `openblog video {slug}`; uploading is in docs/video-production.md §Upload an approved release. | `{slug}` | 240 |
| `youtube.detailsLocal` | details | Worked out on this page with the engine's rules; the server's copy shows when there is a signal. | none | 192 |
| `youtube.detailsStatus` | details | Release: {status} · digest {digest} | `{status}` `{digest}` | 70 |
| `youtube.done` | her | Done | none | 40 |
| `youtube.durationMissing` | her | Add how long the video is, so the last chapter can be checked. | none | 124 |
| `youtube.firstNotZero` | her | The first chapter has to start at 0:00. | none | 78 |
| `youtube.get` | her | Get the words for YouTube | none | 50 |
| `youtube.keepPrivate` | her | Keep the video private on YouTube until this post is on your site. | none | 132 |
| `youtube.lede` | her | Paste these into YouTube when you put your video up. Nothing here changes your video. | none | 170 |
| `youtube.noAddress` | her | Save your post to add its address. | none | 68 |
| `youtube.noChapters` | her | No chapters. That's fine; YouTube shows the video without them. | none | 126 |
| `youtube.oneChapter` | her | 1 chapter, from the line in your words that starts with a time. | none | 126 |
| `youtube.other` | her | YouTube may not take these words as they are. | none | 90 |
| `youtube.outOfOrder` | her | The chapters' times have to go up, one after the other. | none | 110 |
| `youtube.problems` | her | Before YouTube will take these ({count}) | `{count}` | 80 |
| `youtube.rowProblem` | her | Words for YouTube: 1 thing YouTube won't take | none | 90 |
| `youtube.rowProblems` | her | Words for YouTube: {count} things YouTube won't take | `{count}` | 104 |
| `youtube.rowReady` | her | Words for YouTube: ready to copy · {chapters} | `{chapters}` | 90 |
| `youtube.sheet` | her | Words for YouTube | none | 40 |
| `youtube.showMe` | her | Show me | none | 40 |
| `youtube.tags` | her | Tags | none | 40 |
| `youtube.tagsCopied` | her | Tags copied. | none | 40 |
| `youtube.tagsTooLong` | her | YouTube takes up to 500 letters of tags; yours have {count}. Use fewer or shorter tags. | `{count}` | 174 |
| `youtube.title` | her | Title | none | 40 |
| `youtube.titleBrackets` | her | YouTube doesn't allow < or > in a title. Take them out of the title. | none | 136 |
| `youtube.titleCopied` | her | Title copied. | none | 40 |
| `youtube.titleCount` | her | {count} of 100 letters | `{count}` | 44 |
| `youtube.titleMissing` | her | Give your post a title first. | none | 58 |
| `youtube.titleTooLong` | her | YouTube takes titles of up to 100 letters; this one has {count}. Shorten the title. | `{count}` | 166 |
| `youtube.tooFew` | her | YouTube shows chapters only when there are at least 3. Add more, or take the times out. | none | 174 |
| `youtube.tooShort` | her | Each chapter has to be at least 10 seconds long, the last one too. | none | 132 |
| `youtube.whereAt` | her | Where it's at: {stage} | `{stage}` | 44 |
<!-- words:end -->
