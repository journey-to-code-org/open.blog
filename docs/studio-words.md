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
| `common.tell` | her | Tell {helper}. | `{helper}` | 40 |
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
| `home.filesVanish` | her | This server doesn't keep its files when it restarts. Ask {helper} to fix that. | `{helper}` | 156 |
| `home.notUpdated` | her | Your site couldn't be updated. Your work is saved. Let {helper} know; the details are under Your site. | `{helper}` | 204 |
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
| `write.collectionHelp` | her | Put it with others, like all your posts on one topic. | none | 106 |
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
