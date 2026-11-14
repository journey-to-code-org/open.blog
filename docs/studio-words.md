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

A sentence that starts with a variable starts with a capital: `"{helper} can turn it on."` reads
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
| `form.shorter` | her | Shorter, please: {max} letters at most. | `{max}` | 78 |
| `form.sideName` | her | Name for this side | none | 40 |
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
| `recipe.askAddName` | her | This recipe doesn't say who wrote it. Ask {helper} to add your name. | `{helper}` | 136 |
| `recipe.notesHeading` | her | Notes | none | 60 |
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
| `undo.askHelp` | her | There's a new {one} with that name now. Ask {helper} to help bring this one back. | `{one}` `{helper}` | 162 |
| `undo.mayFind` | her | “{title}” can't come back from here. {helper} may still find it. | `{title}` `{helper}` | 128 |
| `write.collectionHelp` | her | Put it with others, like all your posts on one topic. | none | 106 |
<!-- words:end -->
