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
| `about.goesUpNext` | her | It goes up the next time {product} is sent out after that. | `{product}` | 116 |
| `about.goesUpSelf` | her | It goes up by itself on {when}, even with {product} closed. | `{when}` `{product}` | 118 |
| `about.gone` | her | This post isn't on {product} any more | `{product}` | 74 |
| `about.goneDeleted` | her | This post isn't on {product} any more. It may have been deleted on another computer. | `{product}` | 168 |
| `about.listGoes` | her | The list on this post goes, and {product}'s usual name shows. | `{product}` | 122 |
| `about.nameOnEvery` | her | The name {product} uses on every post. | `{product}` | 76 |
| `about.noAnswer` | her | {product} didn't answer. Your words are kept on this computer, and it tries again when you next change something. | `{product}` | 226 |
| `about.noHistory` | her | {product} has no history of this post, so its address is kept as it is. It can be changed only in the file. | `{product}` | 214 |
| `about.pinOnly` | her | Only used when {product} sends a Pin. Leave them empty to use the title and summary. | `{product}` | 168 |
| `about.readyOn` | her | It's ready to go up on {when}. {product} puts it up the next time it's sent out after that. | `{when}` `{product}` | 182 |
| `about.stopsBuild` | her | Something in this post stops {product} from building it. | `{product}` | 112 |
| `about.summaryHelp` | her | One or two sentences. Leave empty and {product} uses the first lines of your post. | `{product}` | 164 |
| `about.unknownRoles` | her | Remove roles {product} doesn't know. | `{product}` | 72 |
| `about.usualLook` | her | {product}'s usual look | `{product}` | 44 |
| `add.alreadyThere` | her | This post already has an {thing}. | `{thing}` | 66 |
| `add.alreadyThereRefs` | her | This post already has its {thing}. | `{thing}` | 68 |
| `add.asWritten` | details | Show the words as written | none | 50 |
| `add.asWrittenHelp` | details | Everything exactly as it's saved. Turn this off to see cards again. | none | 134 |
| `add.back` | her | Everything you can add | none | 44 |
| `add.button` | her | Add something | none | 40 |
| `add.buttonTo` | her | Add something to {box} | `{box}` | 44 |
| `add.citation` | her | A citation | none | 40 |
| `add.citationBlurb` | her | Point to a source in your library, and where in it. | none | 102 |
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
| `add.quotation` | her | A quotation | none | 40 |
| `add.quotationBlurb` | her | Exact words from your notebook, with their citation. | none | 104 |
| `add.slashTip` | her | Tip: type / on an empty line to add something. | none | 92 |
| `add.whereAfter` | her | It goes in {box}, after “{words}”. | `{box}` `{words}` | 68 |
| `add.whereEnd` | her | It goes at the end of {box}. | `{box}` | 56 |
| `add.whereIn` | her | It goes in {box}. | `{box}` | 40 |
| `add.whereStart` | her | It goes at the start of {box}. | `{box}` | 60 |
| `add.wordsHelp` | her | Leave an empty line between paragraphs. For a list, start each line with a dash (-). Photos, tips and tables show as cards: change them with their buttons. | none | 240 |
| `add.yourWords` | her | your words | none | 40 |
| `atlas.about` | her | About (c.) | none | 40 |
| `atlas.add` | her | Add an entry | none | 40 |
| `atlas.addAlias` | her | Add another name | none | 40 |
| `atlas.addDating` | her | Add a dating | none | 40 |
| `atlas.addDissent` | her | Add someone who disagrees | none | 50 |
| `atlas.addEvidence` | her | Add evidence | none | 40 |
| `atlas.addFrom` | her | Add a link from {name} | `{name}` | 44 |
| `atlas.addIt` | her | Add it | none | 40 |
| `atlas.addLink` | her | Add a link | none | 40 |
| `atlas.addTo` | her | Add a link to {name} | `{name}` | 40 |
| `atlas.added` | her | Added to your atlas. | none | 40 |
| `atlas.after` | her | after | none | 40 |
| `atlas.againstItself` | her | A dating can't be dated against itself. | none | 78 |
| `atlas.aliasRow` | her | Other name {n} | `{n}` | 40 |
| `atlas.aliases` | her | Also called | none | 40 |
| `atlas.alsoCalled` | her | also called {names} | `{names}` | 40 |
| `atlas.and` | her | and | none | 40 |
| `atlas.anyAspect` | her | Anything | none | 40 |
| `atlas.anyKind` | her | Any kind | none | 40 |
| `atlas.approveHelp` | her | You agree to show this on {product}'s atlas pages once {product} publishes the atlas. | `{product}` | 170 |
| `atlas.aspectActive` | her | activity | none | 40 |
| `atlas.aspectBirth` | her | birth | none | 40 |
| `atlas.aspectComposition` | her | composition | none | 40 |
| `atlas.aspectDeath` | her | death | none | 40 |
| `atlas.aspectEmergence` | her | emergence | none | 40 |
| `atlas.aspectPublication` | her | publication | none | 40 |
| `atlas.aspectSpan` | her | span | none | 40 |
| `atlas.backToList` | her | ‹ Your atlas | none | 40 |
| `atlas.badAspect` | her | This entry can't be dated that way. | none | 70 |
| `atlas.badCentury` | her | A century is a number from 1 to {max}, like 4. | `{max}` | 92 |
| `atlas.badDate` | her | That date can't be right. Check the year and era. | none | 98 |
| `atlas.badDay` | her | That month has days 1 to {max}. | `{max}` | 62 |
| `atlas.badDecade` | her | A decade is a year ending in 0, like 380. | none | 82 |
| `atlas.badEnds` | her | That kind of link can't join these entries. | none | 86 |
| `atlas.badYear` | her | Type the year from 1 to {max}, and choose BCE or CE. There is no year 0. | `{max}` | 144 |
| `atlas.bce` | her | BCE | none | 40 |
| `atlas.before` | her | before | none | 40 |
| `atlas.between` | her | between | none | 40 |
| `atlas.byNamed` | her | A named person or group | none | 46 |
| `atlas.bySource` | her | A source in your library | none | 48 |
| `atlas.byYou` | her | You | none | 40 |
| `atlas.cantShow` | her | Readers can't see this while {what} stays private. | `{what}` | 100 |
| `atlas.ce` | her | CE | none | 40 |
| `atlas.century` | her | century | none | 40 |
| `atlas.centuryNumber` | her | Century, like 4: {which} | `{which}` | 48 |
| `atlas.checkDating` | her | Check dating {n} of {name} | `{n}` `{name}` | 52 |
| `atlas.checkNote` | her | Prompts, never verdicts: these datings can't all hold as stated. None says which is right. | none | 180 |
| `atlas.chooseAspect` | her | Choose what this dating dates. | none | 60 |
| `atlas.chooseAspectOption` | her | Choose one | none | 40 |
| `atlas.chooseEntryOption` | her | Choose an entry | none | 40 |
| `atlas.chooseEvidenceSource` | her | Choose the source for evidence {n}. | `{n}` | 70 |
| `atlas.chooseFrom` | her | Choose the entry the link starts from. | none | 76 |
| `atlas.chooseHolder` | her | Choose the source that says so. | none | 62 |
| `atlas.chooseLinkKind` | her | Choose what kind of link this is. | none | 66 |
| `atlas.chooseLinkKindOption` | her | Choose a kind of link | none | 42 |
| `atlas.chooseMonth` | her | Choose a month. | none | 40 |
| `atlas.chooseOther` | her | Choose the entry it's dated against. | none | 72 |
| `atlas.chooseSourceOption` | her | Choose a source | none | 40 |
| `atlas.chooseTo` | her | Choose the entry the link goes to. | none | 68 |
| `atlas.chooseWork` | her | Choose a work from your library, or none. | none | 82 |
| `atlas.chronology` | her | Chronology | none | 40 |
| `atlas.chronologyFilters` | her | Show | none | 40 |
| `atlas.chronologyFind` | her | Entry or link | none | 40 |
| `atlas.chronologyLede` | her | Every dating in your atlas, as words. Competing datings stand side by side; nothing is preferred, merged or averaged. | none | 234 |
| `atlas.circa` | her | c. | none | 40 |
| `atlas.contested` | her | Disputed by {who}. | `{who}` | 40 |
| `atlas.count` | her | {shown} of {total} entries | `{shown}` `{total}` | 52 |
| `atlas.cycle` | her | That would make a loop of links. | none | 64 |
| `atlas.dateLabel` | her | {which} of dating {n} | `{which}` `{n}` | 42 |
| `atlas.datingApproveHelp` | her | Shown only while what it dates is shown too, with who says so. | none | 124 |
| `atlas.datingN` | her | Dating {n} | `{n}` | 40 |
| `atlas.datingNote` | her | Note | none | 40 |
| `atlas.datingsCount` | her | {count} datings. | `{count}` | 40 |
| `atlas.datingsOf` | her | Datings of the {aspect} of {name} | `{aspect}` `{name}` | 66 |
| `atlas.day` | her | Day: {which} | `{which}` | 40 |
| `atlas.decade` | her | Decade, like 380: {which} | `{which}` | 50 |
| `atlas.dissentNeedsWhy` | her | Give evidence or a note saying why they disagree ({n}). | `{n}` | 110 |
| `atlas.dissentNote` | her | Why they disagree ({n}) | `{n}` | 46 |
| `atlas.dissentWho` | her | Who disagrees ({n}) | `{n}` | 40 |
| `atlas.dissents` | her | Who disagrees | none | 40 |
| `atlas.dissentsHelp` | her | Anyone who disputes this link, with their evidence or a note saying why. | none | 144 |
| `atlas.duplicate` | her | These entries already have that link. | none | 74 |
| `atlas.during` | her | during | none | 40 |
| `atlas.duringLasts` | her | During needs a date that lasts: a span, an activity or a composition. | none | 138 |
| `atlas.edit` | her | Change this entry | none | 40 |
| `atlas.editEntry` | her | Change the entry | none | 40 |
| `atlas.editLink` | her | Change | none | 40 |
| `atlas.editLinkTitle` | her | Change the link | none | 40 |
| `atlas.emptyText` | her | Add the people, works, ideas, movements and events you study, then note who says what about them. | none | 194 |
| `atlas.emptyTitle` | her | Your atlas is empty | none | 40 |
| `atlas.endsHelp` | her | Only entries this kind of link can join are offered. | none | 104 |
| `atlas.era` | her | BCE or CE: {which} | `{which}` | 40 |
| `atlas.evidence` | her | Evidence | none | 40 |
| `atlas.evidenceCount` | her | On {count} pieces of evidence. | `{count}` | 60 |
| `atlas.evidenceHelp` | her | A source, and where in it. A passage from your notebook is optional and stays private. | none | 172 |
| `atlas.evidencePassage` | her | Passage for evidence {n} | `{n}` | 48 |
| `atlas.evidenceSource` | her | Source of evidence {n} | `{n}` | 44 |
| `atlas.explore` | her | Explore {name} | `{name}` | 40 |
| `atlas.exploreNote` | her | Only links someone asserted. Nothing is worked out from dates or order. | none | 142 |
| `atlas.find` | her | Find an entry | none | 40 |
| `atlas.firm` | her | How firmly they hold it | none | 46 |
| `atlas.firmHelp` | her | How firmly they hold it, not how widely it's accepted. | none | 108 |
| `atlas.firmPlausible` | her | Plausible | none | 40 |
| `atlas.firmStrong` | her | Strong | none | 40 |
| `atlas.firmTentative` | her | Tentative | none | 40 |
| `atlas.formAt` | her | On a date | none | 40 |
| `atlas.formRange` | her | Between two dates | none | 40 |
| `atlas.formRelative` | her | Before, after or during another entry's date | none | 88 |
| `atlas.formUnknown` | her | Unknown: they say it isn't known | none | 64 |
| `atlas.formWindow` | her | Sometime within a window | none | 48 |
| `atlas.from` | her | from | none | 40 |
| `atlas.fromYear` | her | from {year} | `{year}` | 40 |
| `atlas.gone` | her | That isn't in your atlas any more. | none | 68 |
| `atlas.groupBy` | her | Group by | none | 40 |
| `atlas.howDated` | her | How it's dated | none | 40 |
| `atlas.isContested` | her | Disputed. | none | 40 |
| `atlas.key` | her | Key | none | 40 |
| `atlas.keyHelp` | her | Lowercase letters, numbers and dashes. It's part of the page's address and can't change later. | none | 188 |
| `atlas.keyTaken` | her | Something else in your atlas has that key. Choose another. | none | 116 |
| `atlas.kind` | her | Kind | none | 40 |
| `atlas.kindConcept` | her | Concept | none | 40 |
| `atlas.kindEvent` | her | Event | none | 40 |
| `atlas.kindMovement` | her | Movement | none | 40 |
| `atlas.kindPerson` | her | Person | none | 40 |
| `atlas.kindWork` | her | Work | none | 40 |
| `atlas.label` | her | Name | none | 40 |
| `atlas.linkApproveHelp` | her | Shown only while both entries are shown too, with who says so and who disagrees. | none | 160 |
| `atlas.linkKind` | her | What kind of link | none | 40 |
| `atlas.linkKindReads` | her | Read one way: {reading}. The other way: {inverse}. | `{reading}` `{inverse}` | 100 |
| `atlas.linkLede` | her | A link records that someone says so. It's never worked out from dates or order. | none | 158 |
| `atlas.linksFrom` | her | Links from {name} ({count}) | `{name}` `{count}` | 54 |
| `atlas.linksTo` | her | Links to {name} ({count}) | `{name}` `{count}` | 50 |
| `atlas.missingConcepts` | her | Concepts your notes use, not in your atlas yet: | none | 94 |
| `atlas.missingMark` | her | (not in your atlas) | none | 40 |
| `atlas.month` | her | Month: {which} | `{which}` | 40 |
| `atlas.nameHolder` | her | Say who says so. | none | 40 |
| `atlas.needEvidence` | her | Add evidence, or mark it as a draft with no evidence yet. | none | 114 |
| `atlas.needName` | her | Give it a name. | none | 40 |
| `atlas.needOneEnd` | her | Give at least one end; the other can stay open. | none | 94 |
| `atlas.newEntry` | her | New entry | none | 40 |
| `atlas.noDatings` | her | No datings yet. Add one under When on an entry or link. | none | 110 |
| `atlas.noDatingsHere` | her | No datings yet. | none | 40 |
| `atlas.noEvidence` | her | No evidence yet. | none | 40 |
| `atlas.noPassage` | her | No passage | none | 40 |
| `atlas.noWork` | her | None | none | 40 |
| `atlas.noneMatch` | her | No entries match. | none | 40 |
| `atlas.notAfter` | her | not after | none | 40 |
| `atlas.notBefore` | her | not before | none | 40 |
| `atlas.notComplete` | her | not complete yet | none | 40 |
| `atlas.notCompleteOther` | her | not complete yet: choose the other entry and which of its dates | none | 126 |
| `atlas.notPublished` | her | {product} doesn't publish the atlas yet. {helper} can turn it on. | `{product}` `{helper}` | 130 |
| `atlas.notesHere` | her | Notes in your notebook on this concept ({count}) | `{count}` | 96 |
| `atlas.nowPrivate` | her | It's private again. | none | 40 |
| `atlas.nowShown` | her | Readers can see it once your atlas is published. | none | 96 |
| `atlas.of` | her | of | none | 40 |
| `atlas.oneTime` | her | That happens at one time. Use a window instead of two dates. | none | 120 |
| `atlas.onlyAspect` | her | only {aspect} | `{aspect}` | 40 |
| `atlas.onlyCompeting` | her | only competing datings | none | 44 |
| `atlas.onlyCompetingBox` | her | Only competing datings | none | 44 |
| `atlas.onlyPrompted` | her | only datings to check | none | 42 |
| `atlas.onlyPromptedBox` | her | Only datings to check | none | 42 |
| `atlas.open` | her | open | none | 40 |
| `atlas.openStart` | her | No earliest date stated | none | 46 |
| `atlas.order` | her | Before, after or during | none | 46 |
| `atlas.otherAspect` | her | Which of its dates | none | 40 |
| `atlas.otherEntry` | her | The other entry | none | 40 |
| `atlas.outsideWindow` | her | (outside these years) | none | 42 |
| `atlas.passageGone` | her | The passage for evidence {n} isn't in your notebook any more. | `{n}` | 122 |
| `atlas.passageOtherSource` | her | That passage comes from another source. Choose one from this source. | none | 136 |
| `atlas.precision` | her | How exact: {which} | `{which}` | 40 |
| `atlas.precisionCentury` | her | Century | none | 40 |
| `atlas.precisionDay` | her | Day | none | 40 |
| `atlas.precisionDecade` | her | Decade | none | 40 |
| `atlas.precisionMonth` | her | Month | none | 40 |
| `atlas.precisionOpen` | her | Left open | none | 40 |
| `atlas.precisionYear` | her | Year | none | 40 |
| `atlas.readersCan` | her | Readers can see it | none | 40 |
| `atlas.readersSee` | her | Readers can see it | none | 40 |
| `atlas.readsAs` | her | Reads as: {date} | `{date}` | 40 |
| `atlas.rebuildFailed` | her | Saved, but your published atlas didn't update. Tell {helper}. | `{helper}` | 122 |
| `atlas.rebuilt` | her | Your published atlas was updated. | none | 66 |
| `atlas.relative` | her | Relative datings ({count}) | `{count}` | 52 |
| `atlas.removed` | her | Taken out of your atlas. | none | 48 |
| `atlas.removedNotes` | her | {count} notes now name a concept with no entry: {list}. | `{count}` `{list}` | 110 |
| `atlas.reversed` | her | The start is later than the end. Check the years and BCE or CE. | none | 126 |
| `atlas.sameDating` | her | That dating is already here. | none | 56 |
| `atlas.sameKindEnds` | her | This kind of link joins two entries of the same kind. | none | 106 |
| `atlas.sameName` | her | Each other name only once. | none | 52 |
| `atlas.save` | her | Save | none | 40 |
| `atlas.saved` | her | Saved to your atlas. | none | 40 |
| `atlas.saySoOn` | her | say so, on {count} pieces of evidence | `{count}` | 74 |
| `atlas.self` | her | A link needs two different entries. | none | 70 |
| `atlas.showNeedsEvidence` | her | Readers can't see a draft with no evidence. Add evidence first. | none | 126 |
| `atlas.showNoPassage` | her | What readers see can't point into your notebook. Take the passage out and keep the source and places. | none | 202 |
| `atlas.showing` | her | {shown} of {total} datings | `{shown}` `{total}` | 52 |
| `atlas.slotAt` | her | The date | none | 40 |
| `atlas.slotFrom` | her | Start | none | 40 |
| `atlas.slotNotAfter` | her | Not after | none | 40 |
| `atlas.slotNotBefore` | her | Not before | none | 40 |
| `atlas.slotTo` | her | End | none | 40 |
| `atlas.stillLinked` | her | Links still join this entry. Take them out first. | none | 98 |
| `atlas.strongNeedsEvidence` | her | A draft with no evidence can't be held strongly. Add evidence first. | none | 136 |
| `atlas.summary` | her | Summary | none | 40 |
| `atlas.summaryHelp` | her | Your own words. Quoted words belong in a passage. | none | 98 |
| `atlas.takeOut` | her | Take it out | none | 40 |
| `atlas.takeOutAlias` | her | Take out other name {n} | `{n}` | 46 |
| `atlas.takeOutDating` | her | Take out dating {n} | `{n}` | 40 |
| `atlas.takeOutDissent` | her | Take out disagreement {n} | `{n}` | 50 |
| `atlas.takeOutEvidence` | her | Take out evidence {n} | `{n}` | 42 |
| `atlas.takeOutLink` | her | Take out this link | none | 40 |
| `atlas.the` | her | the | none | 40 |
| `atlas.timeline` | her | Timeline | none | 40 |
| `atlas.timelineNote` | her | Order is for reading only. It never relates two datings. | none | 112 |
| `atlas.title` | her | Your atlas | none | 40 |
| `atlas.to` | her | to | none | 40 |
| `atlas.toCheck` | her | To check | none | 40 |
| `atlas.toCheckCount` | her | Datings to check ({count}) | `{count}` | 52 |
| `atlas.toYear` | her | to {year} | `{year}` | 40 |
| `atlas.tooManyDatings` | her | At most {max} datings here. | `{max}` | 54 |
| `atlas.tooManyDissents` | her | At most {max} people who disagree. | `{max}` | 68 |
| `atlas.tooManyNames` | her | That's more other names than an entry can have ({max}). | `{max}` | 110 |
| `atlas.tooManyPlaces` | her | At most {max} places for each source of evidence. | `{max}` | 98 |
| `atlas.tooMuchEvidence` | her | At most {max} pieces of evidence here. | `{max}` | 76 |
| `atlas.uncertainty` | her | What's uncertain | none | 40 |
| `atlas.unknown` | her | unknown | none | 40 |
| `atlas.unnamed` | her | someone not named | none | 40 |
| `atlas.unplaced` | her | Not placed in time ({count}) | `{count}` | 56 |
| `atlas.unsourced` | her | A draft with no evidence yet | none | 56 |
| `atlas.until` | her | until | none | 40 |
| `atlas.whatEnd` | her | an entry it joins | none | 40 |
| `atlas.whatItDates` | her | What it dates | none | 40 |
| `atlas.when` | her | When | none | 40 |
| `atlas.whenCount` | her | When ({count}) | `{count}` | 40 |
| `atlas.whenHelp` | her | Each dating says who dates what, on which evidence, as exactly as they state it. Competing datings stay side by side. | none | 234 |
| `atlas.whereIn` | her | Where in the source (evidence {n}) | `{n}` | 68 |
| `atlas.whichSource` | her | Which source | none | 40 |
| `atlas.who` | her | Who says so | none | 40 |
| `atlas.whoName` | her | Their name | none | 40 |
| `atlas.windowBad` | her | Use whole years with BCE or CE, so these years aren't used. | none | 118 |
| `atlas.windowFrom` | her | From year | none | 40 |
| `atlas.windowFromEra` | her | From: BCE or CE | none | 40 |
| `atlas.windowHelp` | her | Leave either end empty to keep it open. | none | 78 |
| `atlas.windowReversed` | her | The start is after the end, so these years aren't used. | none | 110 |
| `atlas.windowTo` | her | To year | none | 40 |
| `atlas.windowToEra` | her | To: BCE or CE | none | 40 |
| `atlas.work` | her | The work in your library | none | 48 |
| `atlas.year` | her | Year: {which} | `{which}` | 40 |
| `atlas.yearHelp` | her | Whole years, with BCE or CE. There is no year 0. | none | 96 |
| `atlas.you` | her | you | none | 40 |
| `bluesky.appPasswordHelp` | her | Bluesky lets you make a separate password just for {product}, so your own password stays private. In Bluesky: Settings, then Privacy and security, then App passwords. Paste that one here. | `{product}` | 240 |
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
| `card.diagram` | details | Diagram: {title} | `{title}` | 40 |
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
| `card.quotation` | her | Quotation | none | 40 |
| `card.quotationFrom` | her | From {label} | `{label}` | 40 |
| `card.quotationName` | her | Quotation from {source} | `{source}` | 46 |
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
| `checklist.listMoved` | her | Your recipe list has moved to a new spot on {product}, because your {noun} “{title}” uses its usual one. Links to it still work. | `{product}` `{noun}` `{title}` | 240 |
| `checklist.noList` | her | There's no list of all your recipes, because two pages are using its spot on {product}. | `{product}` | 174 |
| `cite.addSource` | her | Add a source | none | 40 |
| `cite.archived` | her | archived | none | 40 |
| `cite.badPlace` | her | Place {n} needs a kind and a value, like page 514. | `{n}` | 100 |
| `cite.change` | her | Change | none | 40 |
| `cite.changeTitle` | her | Change this citation | none | 40 |
| `cite.changed` | her | Citation changed. | none | 40 |
| `cite.checking` | her | Checking the citation… | none | 44 |
| `cite.chipName` | her | Citation: {label} | `{label}` | 40 |
| `cite.choosePassage` | her | Choose a passage | none | 40 |
| `cite.citeIt` | her | Cite it | none | 40 |
| `cite.citedHere` | her | Cited here: | none | 40 |
| `cite.copiedFromPassage` | her | The source and where it is were copied. The exact words and your notes stay private. | none | 168 |
| `cite.count` | her | {count} sources | `{count}` | 40 |
| `cite.countLine` | her | {citations} citations of {works} works. | `{citations}` `{works}` | 78 |
| `cite.countOneCitation` | her | 1 citation of 1 work. | none | 42 |
| `cite.countOneWork` | her | {citations} citations of 1 work. | `{citations}` | 64 |
| `cite.done` | her | Cited. | none | 40 |
| `cite.download` | her | Download the works this post cites | none | 68 |
| `cite.downloadBib` | her | BibTeX | none | 40 |
| `cite.downloadCsl` | her | CSL JSON | none | 40 |
| `cite.downloaded` | her | Saved {filename}: {count} works. Nothing was looked up online. | `{filename}` `{count}` | 124 |
| `cite.emptyLibrary` | her | Your library is empty. Add a source first. | none | 84 |
| `cite.find` | her | Find a source | none | 40 |
| `cite.fromPassage` | her | Start from a passage (optional) | none | 62 |
| `cite.keyLine` | details | Key: {key} | `{key}` | 40 |
| `cite.libraryChanged` | her | Your library changed. The list is up to date now; choose again. | none | 126 |
| `cite.locale` | her | Language of the notes | none | 42 |
| `cite.localeSite` | her | {product}'s language | `{product}` | 40 |
| `cite.malformed` | her | This citation can't be read. | none | 56 |
| `cite.malformedNow` | her | That citation can't be read. Choose the source again. | none | 106 |
| `cite.needSource` | her | Choose the source to cite. | none | 52 |
| `cite.noNotebook` | her | Your notebook can't be read, so passages aren't offered. You can still cite any source. | none | 174 |
| `cite.noPassages` | her | No passages yet | none | 40 |
| `cite.notInLibrary` | her | That source isn't in your library. Choose another. | none | 100 |
| `cite.notesOn` | her | Cited. Your sources will show as numbered notes at the end. Change that in About this post. | none | 182 |
| `cite.previewFirst` | her | Check the post first: press See how it looks, then download. | none | 120 |
| `cite.reads` | her | Reads as: {label} | `{label}` | 40 |
| `cite.readsNone` | her | Choose a source to see how it reads. | none | 72 |
| `cite.refusedCode` | her | A citation can't go inside code. Put your cursor in plain words first. | none | 140 |
| `cite.refusedKept` | her | A citation can't go inside a part kept as written. | none | 100 |
| `cite.refusedLink` | her | A citation can't go inside a link. Put your cursor after it. | none | 120 |
| `cite.showMe` | her | Show me | none | 40 |
| `cite.source` | her | Source | none | 40 |
| `cite.sourceHelp` | her | From your library. Only its key goes into your post. | none | 104 |
| `cite.sourceLine` | her | {kind}, {year} | `{kind}` `{year}` | 40 |
| `cite.sourcesGroup` | her | Sources in this post | none | 40 |
| `cite.style` | her | How sources show | none | 40 |
| `cite.styleHelp` | her | Readers see only each source's public description and your places, never your notes. | none | 168 |
| `cite.styleList` | her | A list of works at the end, with places in the text | none | 102 |
| `cite.styleNotes` | her | Numbered notes at the end | none | 50 |
| `cite.styleOff` | her | Not yet: citations stay as you typed them | none | 82 |
| `cite.takeOut` | her | Take it out | none | 40 |
| `cite.takenOut` | her | Citation taken out. | none | 40 |
| `cite.title` | her | A citation | none | 40 |
| `cite.tooMany` | her | This post has too many citations for one check. | none | 94 |
| `cite.tooManyPlaces` | her | A citation can have up to 8 places. | none | 70 |
| `cite.unknownKey` | her | Not in your library: {key} | `{key}` | 52 |
| `cite.waiting` | her | Waiting for a signal. What you chose is kept here. Press Cite it when you have one. | none | 166 |
| `cite.where` | her | Where in the source (optional) | none | 60 |
| `cite.whereHelp` | her | Like page 514, or canonical place 514a to 520a. | none | 94 |
| `cite.wordsHelp` | her | A citation shows in your words as [@ and its source's key. Change it with its button under the words. | none | 202 |
| `cite.writes` | details | What it writes: {markdown} | `{markdown}` | 52 |
| `claims.ambiguous` | her | The words are in your post twice. Select the one you mean. | none | 116 |
| `claims.approveHelp` | her | You agree to show this claim and what's doubtful in the post's Claims and evidence part. | none | 176 |
| `claims.badPlace` | her | Each place needs a kind and a value, like page 514. | none | 102 |
| `claims.change` | her | Change | none | 40 |
| `claims.changeLink` | her | Change | none | 40 |
| `claims.checked` | her | What you've checked | none | 40 |
| `claims.chooseRelation` | her | Choose how the source bears on the claim. A citation alone says none of these. | none | 156 |
| `claims.chooseSource` | her | Choose the source. | none | 40 |
| `claims.column` | her | {what} ({count}) | `{what}` `{count}` | 40 |
| `claims.context` | her | Gives context | none | 40 |
| `claims.contradicts` | her | Contradicts | none | 40 |
| `claims.counts` | her | {supports} supporting, {contradicts} contradicting, {context} giving context | `{supports}` `{contradicts}` `{context}` | 152 |
| `claims.doubtful` | her | What's doubtful: | none | 40 |
| `claims.doubtfulField` | her | What's doubtful | none | 40 |
| `claims.findFirst` | her | Find the words again before adding evidence, so evidence never lands on words you didn't choose. | none | 192 |
| `claims.follow` | her | Follow them | none | 40 |
| `claims.followed` | her | The claim now follows its words. | none | 64 |
| `claims.gaps` | her | Gaps and prompts ({count}) | `{count}` | 52 |
| `claims.inPlace` | her | In place. | none | 40 |
| `claims.lede` | her | Private to you. A claim is your statement in this post; evidence records how one source bears on it. Nothing here scores evidence or decides what's true, and a citation alone links nothing. | none | 240 |
| `claims.link` | her | Link evidence | none | 40 |
| `claims.linkApproveHelp` | her | You agree to show its source, places, how it bears, your reasoning, how firmly and what's uncertain beside the claim. | none | 234 |
| `claims.linkFor` | her | Link evidence to: {statement} | `{statement}` | 58 |
| `claims.linkSaved` | her | Evidence saved privately. | none | 50 |
| `claims.linkTitle` | her | Evidence for: | none | 40 |
| `claims.lost` | her | The words aren't in your post any more. Select them again. | none | 116 |
| `claims.make` | her | Make a claim from the selected words | none | 72 |
| `claims.moved` | her | The words moved. | none | 40 |
| `claims.noPassagePublic` | her | Evidence readers see cites the source and places, never a private passage. Take the passage out or keep it private. | none | 230 |
| `claims.none` | her | No claims in this post yet. | none | 54 |
| `claims.noneContext` | her | No evidence giving context recorded. | none | 72 |
| `claims.noneContradicts` | her | No contradicting evidence recorded. | none | 70 |
| `claims.noneSupports` | her | No supporting evidence recorded. | none | 64 |
| `claims.onePart` | her | Select words inside one paragraph, heading, list or quote. | none | 116 |
| `claims.passage` | her | Passage | none | 40 |
| `claims.passageHelp` | her | Optional. Stays private; it's pointed to, never copied. | none | 110 |
| `claims.passageOtherSource` | her | That passage comes from another source. | none | 78 |
| `claims.plainWords` | her | Select plain words: these have hidden characters in them. | none | 114 |
| `claims.relation` | her | How does this source bear on the claim? | none | 78 |
| `claims.relationHelp` | her | Your reading of the source. Nothing checks whether it's true. | none | 122 |
| `claims.removed` | her | Taken out. | none | 40 |
| `claims.reviewNone` | her | Not compared with the source yet | none | 64 |
| `claims.reviewPlace` | her | Checked the place in the source | none | 62 |
| `claims.reviewRead` | her | Read it, and I stand behind this | none | 64 |
| `claims.reviewSuggested` | her | Check a suggested link yourself before readers see it. | none | 108 |
| `claims.save` | her | Save | none | 40 |
| `claims.saveFirst` | her | Press Update first: claims are checked against your saved post. | none | 126 |
| `claims.saved` | her | Saved privately. | none | 40 |
| `claims.selectAgain` | her | Select again | none | 40 |
| `claims.selectFirst` | her | Select the words of the claim in your post first. | none | 98 |
| `claims.showBoth` | her | Readers can't see this claim's support without its contradicting evidence. Let them see both, or neither. | none | 210 |
| `claims.source` | her | Source | none | 40 |
| `claims.statement` | her | The claim, in your words | none | 48 |
| `claims.summary` | her | {detected} found, {potential} possible, {review} to review. | `{detected}` `{potential}` `{review}` | 118 |
| `claims.summaryNone` | her | No gaps or prompts for this post's claims from the checks that ran. | none | 134 |
| `claims.supports` | her | Supports | none | 40 |
| `claims.takeOut` | her | Take it out | none | 40 |
| `claims.takeOutLink` | her | Take it out | none | 40 |
| `claims.title` | her | Claims and evidence | none | 40 |
| `claims.tooMuch` | her | Select at most {max} letters for one claim. | `{max}` | 86 |
| `claims.twice` | her | Those words are in your post twice. Select the one you mean. | none | 120 |
| `claims.where` | her | Where in it | none | 40 |
| `claims.whole` | her | About the whole post. | none | 42 |
| `claims.why` | her | Why you read it this way | none | 48 |
| `claims.words` | her | About the words: “{text}” | `{text}` | 50 |
| `collection.badPlace` | her | Use a whole number of 0 or more, or leave it empty. | none | 102 |
| `collection.clearsAgreement` | her | Changing it means everyone agrees again. | none | 80 |
| `collection.lede` | her | Put it in a collection with other posts, at a place you choose. | none | 126 |
| `collection.made` | her | Made. It shows on {product} once something in it is published. | `{product}` | 200 |
| `collection.make` | her | Make a new collection | none | 42 |
| `collection.makeName` | her | Its name | none | 40 |
| `collection.makePremise` | her | What it's about, in one line | none | 56 |
| `collection.needName` | her | Type the new collection's name, or choose one. | none | 92 |
| `collection.new` | her | A new collection… | none | 40 |
| `collection.newName` | her | Name of the new collection | none | 52 |
| `collection.none` | her | Not in a collection | none | 40 |
| `collection.orderNoNumber` | her | no number | none | 40 |
| `collection.orderNumber` | her | number {n} | `{n}` | 40 |
| `collection.orderPart` | her | {n}. {title} ({place}) | `{n}` `{title}` `{place}` | 44 |
| `collection.orderThis` | her | {n}. This one (not on {product} yet, {place}) | `{n}` `{product}` `{place}` | 90 |
| `collection.place` | her | Its place in the collection | none | 54 |
| `collection.placeHelp` | her | A whole number, or leave it empty to go after the numbered ones, by date. | none | 200 |
| `collection.placementAt` | her | {name}, number {n} | `{name}` `{n}` | 40 |
| `collection.placementEnd` | her | {name}, after the numbered ones, by date | `{name}` | 80 |
| `collection.placementNone` | her | Not in a collection. | none | 40 |
| `collection.preview` | her | See the order | none | 40 |
| `collection.published` | her | It's on {product}; change its collection from the post. | `{product}` | 110 |
| `collection.readOnly` | her | Whoever runs it chooses the collection. | none | 78 |
| `collection.removed` | her | Taken out of the collection. | none | 56 |
| `collection.save` | her | Save the collection | none | 40 |
| `collection.saved` | her | Saved. Everyone agrees again to where it goes. | none | 92 |
| `collection.sheetTitle` | her | Collection for {title} | `{title}` | 44 |
| `collection.title` | her | Collection | none | 40 |
| `collection.untitledPart` | her | Untitled | none | 40 |
| `collection.which` | her | Which collection | none | 40 |
| `common.ask` | her | Ask {helper}. | `{helper}` | 40 |
| `common.canChange` | her | {helper} can change that. | `{helper}` | 50 |
| `common.canTurnOn` | her | {helper} can turn it on. | `{helper}` | 48 |
| `common.cantReach` | her | {product} can't be reached right now. Check your connection, then try again. | `{product}` | 152 |
| `common.catchesUp` | her | Your public site catches up when {helper} sends it out. | `{helper}` | 110 |
| `common.chose` | her | {helper} chose this. | `{helper}` | 40 |
| `common.detailsFor` | her | Details for {helper} | `{helper}` | 40 |
| `common.forHelper` | her | For {helper} | `{helper}` | 40 |
| `common.keepsHappening` | her | Try again, and if it keeps happening, tell {helper}. | `{helper}` | 104 |
| `common.letKnow` | her | Let {helper} know. | `{helper}` | 40 |
| `common.signedOut` | her | You were signed out. Your words are safe; sign in and {product} will finish what it was doing. | `{product}` | 188 |
| `common.stopWaiting` | her | Stop waiting | none | 40 |
| `common.tell` | her | Tell {helper}. | `{helper}` | 40 |
| `common.tryAgain` | her | Try again | none | 40 |
| `common.whatGoes` | her | What goes to {company} | `{company}` | 44 |
| `common.wordForWord` | her | Word for word | none | 40 |
| `compare.aSource` | her | Source | none | 40 |
| `compare.aVersion` | her | A version in your library | none | 50 |
| `compare.absent` | her | This version doesn't have this passage. | none | 78 |
| `compare.absentHere` | her | This version doesn't have it | none | 56 |
| `compare.add` | her | Add an alignment | none | 40 |
| `compare.addPlace` | her | Add a place | none | 40 |
| `compare.added` | her | Alignment added. It's private until you let readers see it. | none | 118 |
| `compare.allVersions` | her | All versions | none | 40 |
| `compare.anInterpretation` | her | An interpretation | none | 40 |
| `compare.anonymous` | her | Made by: nobody named | none | 42 |
| `compare.approveHelp` | her | You agree to show these aligned passages on {product}, quoting only words whose rights you cleared. | `{product}` | 198 |
| `compare.approvedNotPublished` | her | Approved, but {product} doesn't publish aligned passages yet. {helper} can turn it on. | `{product}` `{helper}` | 172 |
| `compare.archived` | her | Archived | none | 40 |
| `compare.backToList` | her | ‹ Your alignments | none | 40 |
| `compare.browser` | her | app | none | 40 |
| `compare.checkPlace` | her | Check this place: it may not match what your library says. | none | 116 |
| `compare.chooseInterpretation` | her | Choose the interpretation for place {n}. | `{n}` | 80 |
| `compare.chooseOption` | her | Choose one | none | 40 |
| `compare.chooseVersion` | her | Choose the version place {n} is in. | `{n}` | 70 |
| `compare.copied` | her | Copied {count} places. | `{count}` | 44 |
| `compare.copy` | her | Copy | none | 40 |
| `compare.copyThem` | her | Copy them | none | 40 |
| `compare.copyTitle` | her | Copy or download places | none | 46 |
| `compare.copyYourself` | her | Your {app} didn't allow copying. Select the text below and copy it. | `{app}` | 134 |
| `compare.corresponding` | her | You read these places as corresponding | none | 76 |
| `compare.divergent` | her | You read these places as corresponding but differing | none | 104 |
| `compare.download` | her | Download | none | 40 |
| `compare.downloaded` | her | Saved alignment-{id}.txt. | `{id}` | 50 |
| `compare.edit` | her | Change | none | 40 |
| `compare.editLede` | her | Aligning places records where you read them as corresponding, never that they mean the same thing. | none | 196 |
| `compare.editTitle` | her | Change {name} | `{name}` | 40 |
| `compare.emptyText` | her | Add your first alignment: the places in two or more versions you read as corresponding. | none | 174 |
| `compare.emptyTitle` | her | Nothing to compare yet | none | 44 |
| `compare.exportFooter` | her | Copied from your private research. Rights statements are your own; nothing here decides what copying is allowed. | none | 224 |
| `compare.exportName` | her | Alignment: | none | 40 |
| `compare.exportNoPlace` | her | not recorded | none | 40 |
| `compare.exportPlace` | her | Where: | none | 40 |
| `compare.exportWords` | her | The exact words, from {from}: | `{from}` | 58 |
| `compare.factHeldAt` | her | Held at | none | 40 |
| `compare.factInterprets` | her | Interprets | none | 40 |
| `compare.factIssued` | her | Issued | none | 40 |
| `compare.factLibrary` | her | In your library | none | 40 |
| `compare.factMadeFrom` | her | Made from | none | 40 |
| `compare.factOf` | her | A form of | none | 40 |
| `compare.factRevises` | her | Revises | none | 40 |
| `compare.factUncertain` | her | Uncertain | none | 40 |
| `compare.factVolumes` | her | Volumes | none | 40 |
| `compare.fromInterpretation` | her | the interpretation | none | 40 |
| `compare.fromPassage` | her | your notebook | none | 40 |
| `compare.gone` | her | That alignment isn't here any more. | none | 70 |
| `compare.howCorrespond` | her | How they correspond | none | 40 |
| `compare.includeNotes` | her | Include my notes on places | none | 52 |
| `compare.interpretation` | her | Interpretation | none | 40 |
| `compare.interpretationGone` | her | The interpretation for place {n} isn't in your library any more. | `{n}` | 128 |
| `compare.keyTaken` | her | Another alignment has that key. Choose another. | none | 94 |
| `compare.layout` | her | Layout | none | 40 |
| `compare.locatedOnly` | her | No words kept for this place; only where it is. | none | 94 |
| `compare.madeBy` | her | Made by: {names} | `{names}` | 40 |
| `compare.missingPassage` | her | The passage this place names is gone. | none | 74 |
| `compare.name` | her | Name | none | 40 |
| `compare.needTwo` | her | An alignment needs places in at least two versions, and at least one that has the passage. | none | 180 |
| `compare.newAlignment` | her | New alignment | none | 40 |
| `compare.normalized` | her | Your normalization, not the source's words | none | 84 |
| `compare.normalizedHidden` | her | You wrote a normalization. Turn on Show your normalizations to read it. | none | 142 |
| `compare.normalizedNote` | her | What you normalized (place {n}) | `{n}` | 62 |
| `compare.normalizedWording` | her | Your normalized words for place {n} (optional) | `{n}` | 92 |
| `compare.notAWork` | her | Choose an edition, translation or manuscript for place {n}: a work has no words of its own. | `{n}` | 182 |
| `compare.notInLibrary` | her | Not in your library | none | 40 |
| `compare.notNow` | her | Not now | none | 40 |
| `compare.notPublishedHelp` | her | {product} doesn't publish aligned passages yet. {helper} can turn it on. | `{product}` `{helper}` | 144 |
| `compare.notesHelp` | her | Your notes are private, so they're left out unless you include them. | none | 136 |
| `compare.notice` | her | An alignment records where you read these places as corresponding. It doesn't say they mean the same thing, and no version is treated as the right one. | none | 240 |
| `compare.oneAfter` | her | One after another | none | 40 |
| `compare.partial` | her | You read these places as corresponding in part | none | 92 |
| `compare.passage` | her | Passage from your notebook for place {n} | `{n}` | 80 |
| `compare.placeAbsent` | her | Readers see that this version doesn't have it. | none | 92 |
| `compare.placeHeldLength` | her | Readers see where it is, not the words: they're longer than {max} letters. | `{max}` | 148 |
| `compare.placeHeldRights` | her | Readers see where it is, not the words: the version's rights aren't cleared. | none | 152 |
| `compare.placeNote` | her | Your note: {note} | `{note}` | 40 |
| `compare.placeNoteField` | her | Your note on place {n} | `{n}` | 44 |
| `compare.placeShown` | her | Readers see these words, with the version's rights statement. | none | 122 |
| `compare.placeType` | her | Place {n} is in | `{n}` | 40 |
| `compare.placeUnquoted` | her | Readers see where it is; no words are kept for it. | none | 100 |
| `compare.places` | her | Versions and places | none | 40 |
| `compare.private` | her | Private: not published. | none | 46 |
| `compare.published` | her | Published at {address}. | `{address}` | 46 |
| `compare.reading` | her | Reading | none | 40 |
| `compare.reasoning` | her | Your reasoning | none | 40 |
| `compare.rebuildFailed` | her | Saved, but your published aligned passages didn't update. Tell {helper}. | `{helper}` | 144 |
| `compare.rebuilt` | her | Your published aligned passages were updated. | none | 90 |
| `compare.recordedBy` | her | Who reads them this way | none | 46 |
| `compare.recordedByWho` | her | recorded by {who} | `{who}` | 40 |
| `compare.removed` | her | Alignment taken out. | none | 40 |
| `compare.rendering` | her | Rendering | none | 40 |
| `compare.rights` | her | Rights: {label} | `{label}` | 40 |
| `compare.rightsText` | her | These are your own statements about rights; they don't say copying is allowed. Copying them is your decision. | none | 218 |
| `compare.rightsTitle` | her | Copy words whose rights aren't cleared? | none | 78 |
| `compare.rightsYours` | her | Rights statements are your own. | none | 62 |
| `compare.saved` | her | Alignment saved. | none | 40 |
| `compare.sayWhere` | her | Say where place {n} is, or choose a passage, or mark that this version doesn't have it. | `{n}` | 174 |
| `compare.selectAll` | her | Select all | none | 40 |
| `compare.selectFirst` | her | Select at least one place first. | none | 64 |
| `compare.selectPlace` | her | Select place {n} | `{n}` | 40 |
| `compare.selected` | her | {count} places selected. | `{count}` | 48 |
| `compare.showNormalized` | her | Show your normalizations | none | 48 |
| `compare.sideBySide` | her | Side by side | none | 40 |
| `compare.takeOut` | her | Take out this alignment | none | 46 |
| `compare.takeOutPlace` | her | Take out place {n} | `{n}` | 40 |
| `compare.theText` | her | The places, as text | none | 40 |
| `compare.title` | her | Compare versions | none | 40 |
| `compare.tooManyPlaces` | her | At most {max} places in one alignment. | `{max}` | 76 |
| `compare.uncertain` | her | Uncertain: | none | 40 |
| `compare.version` | her | Version for place {n} | `{n}` | 42 |
| `compare.versionFilter` | her | Version | none | 40 |
| `compare.versionsCount` | her | {count} versions | `{count}` | 40 |
| `compare.where` | her | Where it is (place {n}) | `{n}` | 46 |
| `compare.whichInterpretation` | her | Interpretation for place {n} | `{n}` | 56 |
| `compare.why` | her | Why: | none | 40 |
| `copy.commentsStay` | her | Comments stay on {product}. | `{product}` | 54 |
| `copy.diagramStays` | her | The diagram stays on {product}, with a link back to it. | `{product}` | 110 |
| `copy.evidenceStays` | her | The evidence notes stay on {product}. | `{product}` | 74 |
| `copy.helpsStay` | her | The reading helps stay on {product}. | `{product}` | 72 |
| `copy.notReady` | her | {product} can't make a copy for it right now. Try another, or tell {helper}. | `{product}` `{helper}` | 152 |
| `copy.onlyThere` | her | Something readers can use on {product} only works there. The copy links back to it. | `{product}` | 166 |
| `copy.stopsCopy` | her | Something in this post stops {product} from making the copy. | `{product}` | 120 |
| `copy.timelineStays` | her | The timeline stays on {product}, with a link back to it. | `{product}` | 112 |
| `curate.by` | her | By | none | 40 |
| `curate.changed` | her | Your choices changed somewhere else. Here they are now. | none | 110 |
| `curate.chooseComment` | her | Add my comment on this source | none | 58 |
| `curate.chooseComparison` | her | Choose these aligned passages | none | 58 |
| `curate.chooseDating` | her | Choose the dating “{date}” | `{date}` | 52 |
| `curate.chooseEntry` | her | Choose this entry | none | 40 |
| `curate.chooseExplanation` | her | Add my explanation of this entry | none | 64 |
| `curate.chooseLink` | her | Choose the link “{label}” | `{label}` | 50 |
| `curate.chooseSource` | her | Choose this source as a reference | none | 66 |
| `curate.chooseTitle` | her | Choose for readers | none | 40 |
| `curate.chosen` | her | Chosen for readers. | none | 40 |
| `curate.chosenTitle` | her | Chosen for readers ({count}) | `{count}` | 56 |
| `curate.find` | her | For readers | none | 40 |
| `curate.kindComment` | her | Your comment on a source | none | 48 |
| `curate.kindComparison` | her | Aligned passages | none | 40 |
| `curate.kindDating` | her | Dating | none | 40 |
| `curate.kindEntry` | her | Atlas entry | none | 40 |
| `curate.kindExplanation` | her | Your explanation of an entry | none | 56 |
| `curate.kindLink` | her | Link between entries | none | 40 |
| `curate.kindReference` | her | Reference | none | 40 |
| `curate.lede` | her | Choose research readers get beside this post. Choosing never makes anything public that isn't already. | none | 204 |
| `curate.moveDown` | her | Move down | none | 40 |
| `curate.moveDownLabel` | her | Move down: {name} | `{name}` | 40 |
| `curate.moveUp` | her | Move up | none | 40 |
| `curate.moveUpLabel` | her | Move up: {name} | `{name}` | 40 |
| `curate.moved` | her | Moved. | none | 40 |
| `curate.needBy` | her | Say who wrote it. | none | 40 |
| `curate.needText` | her | Write your comment. | none | 40 |
| `curate.noneChosen` | her | Nothing chosen yet. | none | 40 |
| `curate.notYet` | her | Not choosable yet: no published post, atlas or aligned passages show it. Choosing never approves it. | none | 200 |
| `curate.saveFirst` | her | Save your post first, then choose what readers get beside it. | none | 122 |
| `curate.seeWhat` | her | See what readers get | none | 40 |
| `curate.showAgain` | her | Show it again | none | 40 |
| `curate.shown` | her | Shown to readers | none | 40 |
| `curate.shownAgain` | her | Chosen again, as it is now. | none | 54 |
| `curate.stop` | her | Stop showing | none | 40 |
| `curate.stopped` | her | Readers won't get it now. | none | 50 |
| `curate.takeOut` | her | Take it out | none | 40 |
| `curate.takenOut` | her | Taken out of what readers get. | none | 60 |
| `curate.text` | her | Your words | none | 40 |
| `curate.title` | her | For readers of this post | none | 48 |
| `decorations.addedFirst` | her | Added first on your calendar, from today, so it shows over the season under it. Not saved yet. | none | 188 |
| `decorations.betweenOff` | her | The look {product} wears while the calendar is off. | `{product}` | 102 |
| `decorations.byItself` | her | {product} changes by itself on the days below. | `{product}` | 92 |
| `decorations.calendarOff` | her | {product} wears {theme} every day. The calendar is off. | `{product}` `{theme}` | 110 |
| `decorations.canvasComputer` | her | Computer | none | 40 |
| `decorations.canvasFailed` | her | The picture of your front page didn't open | none | 84 |
| `decorations.canvasFailedHelp` | her | Your switches still work. | none | 50 |
| `decorations.canvasNote` | her | Your front page with these up. It changes as you take things down or put them back. | none | 166 |
| `decorations.canvasPhone` | her | Phone | none | 40 |
| `decorations.canvasRetry` | her | Try again | none | 40 |
| `decorations.canvasShowOn` | her | Show it on | none | 40 |
| `decorations.canvasTitle` | her | Your front page in {look} | `{look}` | 50 |
| `decorations.canvasWait` | her | Getting it ready… | none | 40 |
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
| `design.noteDarkerMany` | her | In {scheme}, the {role} are a little darker so they're easy to read. | `{scheme}` `{role}` | 136 |
| `design.noteLighter` | her | In {scheme}, the {role} is a little lighter so it's easy to read. | `{scheme}` `{role}` | 130 |
| `design.noteLighterMany` | her | In {scheme}, the {role} are a little lighter so they're easy to read. | `{scheme}` `{role}` | 138 |
| `design.noteReplaced` | her | In {scheme}, the {role} couldn't be made easy to read, so it uses {replacement} instead. | `{scheme}` `{role}` `{replacement}` | 176 |
| `design.noteReplacedMany` | her | In {scheme}, the {role} couldn't be made easy to read, so they use {replacement} instead. | `{scheme}` `{role}` `{replacement}` | 178 |
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
| `design.undoExpired` | her | It's been more than 10 minutes, so “{name}” can't be undone. It stays. | `{name}` | 140 |
| `design.undoNoSignal` | her | There's no signal, so “{name}” is still saved. Try Undo again when you have one. | `{name}` | 160 |
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
| `diagram.cantDraw` | details | It can't be drawn: {why} | `{why}` | 240 |
| `diagram.captionHelp` | details | Shown under the diagram. | none | 48 |
| `diagram.describe` | details | What it shows | none | 40 |
| `diagram.describeHelp` | details | A sentence or two for people who can't see it. Feeds and copies carry it with the picture. | none | 200 |
| `diagram.draw` | details | Draw it | none | 40 |
| `diagram.example` | details | Start from an example | none | 42 |
| `diagram.exampleHelp` | details | Puts an example in the box below to change. | none | 86 |
| `diagram.exampleNone` | details | No example | none | 40 |
| `diagram.fixFirst` | details | Fill in what's marked first, then draw it. | none | 84 |
| `diagram.needDescribe` | details | Say what it shows, or write accDescr: in the diagram. | none | 106 |
| `diagram.needTitle` | details | Give it a title, or write accTitle: in the diagram. | none | 102 |
| `diagram.needsSignal` | details | Drawing it needs a signal. Your diagram is kept in the form. | none | 120 |
| `diagram.quotes` | details | Use one kind of quotation mark here, not both. | none | 92 |
| `diagram.replaceAsk` | details | Put the example in place of your diagram? | none | 82 |
| `diagram.replaceGo` | details | Use the example | none | 40 |
| `diagram.replaceKeep` | details | Keep mine | none | 40 |
| `diagram.replaceText` | details | What's in the box now is replaced by the example. | none | 98 |
| `diagram.source` | details | The diagram | none | 40 |
| `diagram.sourceHelp` | details | In Mermaid, like flowchart LR then A --> B. Link a box to a page here with click A "/about/". | none | 200 |
| `diagram.title` | details | Title | none | 40 |
| `diagram.titleHelp` | details | A few words that name it, read out to people who can't see it. | none | 124 |
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
| `form.photoLoading` | her | Looking for your photos | none | 46 |
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
| `found.back` | her | Read it over again | none | 40 |
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
| `found.inBoxWithin` | her | in {box} | `{box}` | 40 |
| `found.moreThanWords` | her | Your helper suggested something with more than words in it, so it's shown here for you to type yourself. | none | 208 |
| `found.near` | her | Near “{words}” | `{words}` | 40 |
| `found.nearWithin` | her | near “{words}” | `{words}` | 40 |
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
| `front.latestCountHint` | her | Leave empty to show the usual number for {product}. | `{product}` | 102 |
| `front.textAbout` | her | A few paragraphs about you or {product}. | `{product}` | 80 |
| `front.textBlank` | her | Write something about you or {product}. | `{product}` | 78 |
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
| `helper.groupPlace` | her | the place and the trip's numbers | none | 64 |
| `helper.groupRecipe` | her | recipe facts | none | 40 |
| `helper.groupSummary` | her | summary | none | 40 |
| `helper.groupTags` | her | tags | none | 40 |
| `helper.groupTrip` | her | what you did and the conditions | none | 62 |
| `helper.groupVideo` | her | video facts | none | 40 |
| `helper.groupWhen` | her | when it appears | none | 40 |
| `helper.keyRejected` | her | {company} didn't accept {product}'s key. Tell {helper}. | `{company}` `{product}` `{helper}` | 110 |
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
| `home.commentWaiting` | her | 1 comment is waiting for you | none | 56 |
| `home.commentsWaiting` | her | {n} comments are waiting for you | `{n}` | 64 |
| `home.commentsWaitingMore` | her | More than {n} comments are waiting for you | `{n}` | 84 |
| `home.filesVanish` | her | This server doesn't keep its files when it restarts. Ask {helper} to fix that. | `{helper}` | 156 |
| `home.notUpdated` | her | Your site couldn't be updated. Your work is saved. Let {helper} know; the details are under Your site. | `{helper}` | 204 |
| `home.readerWaiting` | her | 1 note from a reader is waiting for you | none | 78 |
| `home.readersWaiting` | her | {n} notes from readers are waiting for you | `{n}` | 84 |
| `home.readersWaitingMore` | her | More than {n} notes from readers are waiting for you | `{n}` | 104 |
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
| `install.addHomeScreen` | her | Add {product} to your Home Screen | `{product}` | 66 |
| `install.addedPhone` | her | Added. Open {product} from its icon from now on. | `{product}` | 96 |
| `install.addedWindow` | her | Added. {product} opens in its own window from now on. | `{product}` | 106 |
| `install.already` | her | You're already using {product} from its icon. | `{product}` | 90 |
| `install.asApp` | her | Install {product} as an app | `{product}` | 54 |
| `install.firefox` | her | Firefox can't add {product} as an app. It works the same in a tab: bookmark it instead. | `{product}` | 174 |
| `install.inApp` | her | This page is open inside another app. Open {product} in {app}: | `{product}` `{app}` | 124 |
| `install.openIcon` | her | Open {product} from its new icon. | `{product}` | 66 |
| `install.openInSafari` | her | Don't see Add to Home Screen? Open {product} in Safari: | `{product}` | 110 |
| `install.openSignIn` | her | Open {product} from its new icon and sign in again. | `{product}` | 102 |
| `install.ownIcon` | her | Then {product} opens from its own icon, like your other apps. | `{product}` | 122 |
| `install.ownWindow` | her | Then {product} opens in its own window, like your other apps. | `{product}` | 122 |
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
| `item.diagram` | details | A diagram | none | 40 |
| `item.diagramAbout` | details | A flowchart, sequence or other Mermaid diagram, drawn as a picture with its description. | none | 176 |
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
| `job.addHomeScreen` | her | Add {product} to your Home Screen so jobs waiting here are kept safe. | `{product}` | 138 |
| `job.cantKeep` | her | Jobs send straight away instead, so save one where there's a signal. In a normal Safari window {product} can keep them. | `{product}` | 238 |
| `job.deletedThere` | her | This job went to {product} before, and was deleted there since. | `{product}` | 126 |
| `job.goesAsYours` | her | It goes to {product} as yours. | `{product}` | 60 |
| `job.inApp` | her | This page is open inside another app, which may not keep your jobs. Open {product} in Safari. | `{product}` | 186 |
| `job.lede` | her | Take photos and say what you did. It's kept on this {noun} until there's a signal, then goes to {product} as a draft. | `{noun}` `{product}` | 234 |
| `job.ledgerVersion` | her | {product} was updated in a way this page doesn't understand yet. Reload, then try again. | `{product}` | 176 |
| `job.micDenied` | her | {product} isn't allowed to use the microphone on this {noun}. To change that: | `{product}` `{noun}` | 154 |
| `job.newerVersion` | her | This job was saved by a newer version of {product}'s pages. Reload to send it. If it still says this, tell {helper}. | `{product}` `{helper}` | 232 |
| `job.noAnswer` | her | {product} didn't answer. | `{product}` | 48 |
| `job.noAnswerLead` | her | {product} didn't answer when it last tried | `{product}` | 84 |
| `job.noNotes` | her | Write a few words about the job first. | none | 76 |
| `job.noWordsHeard` | her | No words were heard in it. Type a few instead. | none | 92 |
| `job.notSetUp` | her | {product} isn't set up for jobs | `{product}` | 62 |
| `job.noteStillHere` | her | Your voice note is still here. | none | 60 |
| `job.notesTooLong` | her | That's more words than it can take. Shorten them a little. | none | 116 |
| `job.otherWindow` | her | Another window updated {product}'s pages. Reload, then save again. This job stays here. | `{product}` | 174 |
| `job.ownHelper` | her | {product}'s helper | `{product}` | 40 |
| `job.roomFull` | her | The jobs waiting on this {noun} are using all the room {product} has here. Send them first. This one stays here. | `{noun}` `{product}` | 224 |
| `job.safariClear` | her | Safari may clear jobs kept here if {product} isn't opened for a week. Send it, or save its photos to this {noun}. | `{product}` `{noun}` | 226 |
| `job.saidNo` | her | {product} said no to this job. | `{product}` | 60 |
| `job.turnsLocal` | her | {product} turns it into words on its own computer. Nothing leaves it. | `{product}` | 138 |
| `job.waitingInSafari` | her | Saved a job in Safari instead? It's waiting there: open {product} in Safari to send it. | `{product}` | 174 |
| `job.writeUpGo` | her | Write it up | none | 40 |
| `job.writeUpLikeMe` | her | Make it sound like me | none | 42 |
| `job.writeUpNotNow` | her | Not now | none | 40 |
| `job.writeUpOff` | her | Writing it up isn't set up for {product}. | `{product}` | 82 |
| `job.writeUpTitle` | her | Write it up for me | none | 40 |
| `job.writeUpWorking` | her | Writing it up… | none | 40 |
| `jobphoto.agree` | her | Send this photo and description | none | 62 |
| `jobphoto.changed` | her | The photo or its description changed. Show what goes again. | none | 118 |
| `jobphoto.checking` | her | Checking the photo… | none | 40 |
| `jobphoto.describe` | her | Describe the photo | none | 40 |
| `jobphoto.describeHelp` | her | What's in it, for people who can't see it. It goes with the photo. | none | 132 |
| `jobphoto.first` | her | Describe the photo, look at what goes, and choose Send this photo first. | none | 144 |
| `jobphoto.ifNot` | her | If the photo can't go, nothing is posted. | none | 82 |
| `jobphoto.needWords` | her | Describe the photo first. | none | 50 |
| `jobphoto.show` | her | Show what goes | none | 40 |
| `jobphoto.title` | her | The photo that goes to {page} | `{page}` | 58 |
| `jobphoto.trouble` | her | The photo can't go as it is. Pick another after photo in Write. | none | 126 |
| `join.declined` | her | You said no thanks. They can invite you again. | none | 92 |
| `join.invitedYou` | her | {name} invited you to write about: | `{name}` | 68 |
| `join.joined` | her | You're in. Write your part when you're ready. | none | 90 |
| `join.noSignal` | her | Joining needs a signal. Open the link again when you have one. | none | 124 |
| `join.noThanks` | her | No thanks | none | 40 |
| `join.noThanksAsk` | her | Say no thanks to this invitation? | none | 66 |
| `join.noThanksBack` | her | Go back | none | 40 |
| `join.noThanksGo` | her | No thanks | none | 40 |
| `join.noThanksText` | her | The link stops working. Whoever sent it can invite you again. | none | 122 |
| `join.notWorking` | her | This link doesn't work any more. Ask the person who sent it for a new one. | none | 200 |
| `join.password` | her | Choose a password | none | 40 |
| `join.passwordAgain` | her | Type it again | none | 40 |
| `join.passwordHelp` | her | At least 12 letters, numbers or symbols. | none | 80 |
| `join.passwordShort` | her | At least 12 characters. | none | 46 |
| `join.passwordsDiffer` | her | The two passwords don't match. | none | 60 |
| `join.reopen` | her | Open the link you were sent again. | none | 68 |
| `join.sayYes` | her | Say yes | none | 40 |
| `join.signIn` | her | Sign in | none | 40 |
| `join.signInFirst` | her | Sign in as {name} to say yes. | `{name}` | 58 |
| `join.signInNameIs` | her | Your sign-in name: {name} | `{name}` | 50 |
| `join.signOut` | her | Sign out | none | 40 |
| `join.someoneInvited` | her | You're invited to write about: | none | 60 |
| `join.title` | her | Write together | none | 40 |
| `join.tooMany` | her | Too many tries. Wait a few minutes, then open the link again. | none | 122 |
| `join.wrongPerson` | her | This invitation is for {name}. Sign out, then open the link again. | `{name}` | 132 |
| `join.youRead` | her | You'll read what everyone writes, as {name}. | `{name}` | 88 |
| `join.youWrite` | her | You'll write a part, signed {name}. | `{name}` | 70 |
| `kinds.collectionsAbout` | her | A collection gathers posts on one page, like all your posts on one topic. Put a post in one from the post itself. | none | 226 |
| `kinds.collectionsEmpty` | her | A collection gathers posts on one page, like all your posts on one topic. | none | 146 |
| `kinds.pagesAbout` | her | Pages stay put, like About or Contact. Posts come and go by date. | none | 130 |
| `kinds.unknownAsStory` | her | {product} shows it as a story. | `{product}` | 60 |
| `layout.addRound` | her | Add a round | none | 40 |
| `layout.addTurn` | her | Add a turn | none | 40 |
| `layout.alternatingDialogue` | her | Back and forth | none | 40 |
| `layout.alternatingDialogueHelp` | her | Turns alternate like a conversation, each under its writer's name. | none | 132 |
| `layout.badPart` | her | Round {n}: a part is a number from 1 up. | `{n}` | 80 |
| `layout.choose` | her | Layout | none | 40 |
| `layout.clearsAgreement` | her | Saving a new layout means everyone agrees again. | none | 96 |
| `layout.emptyRound` | her | Round {n} has no turns. Add one or take the round out. | `{n}` | 108 |
| `layout.labelLong` | her | Round {n}: a label is a few words at most. | `{n}` | 84 |
| `layout.labelOneLine` | her | Round {n}: keep a label on one line. | `{n}` | 72 |
| `layout.lede` | her | How everyone's parts sit on the page, and in what order. Changing it means everyone agrees again. | none | 200 |
| `layout.moveDown` | her | Move down | none | 40 |
| `layout.moveTurnDown` | her | Move {name}, part {part} down | `{name}` `{part}` | 58 |
| `layout.moveTurnUp` | her | Move {name}, part {part} up | `{name}` `{part}` | 54 |
| `layout.moveUp` | her | Move up | none | 40 |
| `layout.noRounds` | her | Add a round. | none | 40 |
| `layout.pointCounterpoint` | her | Two sides | none | 40 |
| `layout.pointCounterpointHelp` | her | Two columns when two people write; with more, one column. Labels are yours; nothing says who agrees. | none | 200 |
| `layout.promptOneLine` | her | Round {n}: keep what it asks on one line. | `{n}` | 82 |
| `layout.readOnly` | her | Whoever runs it chooses the layout. | none | 70 |
| `layout.removeRound` | her | Take this round out | none | 40 |
| `layout.removeTurn` | her | Take this turn out | none | 40 |
| `layout.round` | her | Round {n} | `{n}` | 40 |
| `layout.roundPrompt` | her | What this round asks | none | 40 |
| `layout.roundPromptHelp` | her | Optional, one line. | none | 40 |
| `layout.roundtable` | her | Around a table | none | 40 |
| `layout.roundtableHelp` | her | Turns sit in a grid that fits any number of people, read in the same order. | none | 200 |
| `layout.save` | her | Save the layout | none | 40 |
| `layout.saved` | her | Layout saved. Everyone agrees again to the new layout. | none | 200 |
| `layout.sequential` | her | One after another | none | 40 |
| `layout.sequentialHelp` | her | Each part follows the one before, in reading order. | none | 102 |
| `layout.sheetTitle` | her | Layout of {title} | `{title}` | 40 |
| `layout.sideBySide` | her | Side by side | none | 40 |
| `layout.sideBySideHelp` | her | Parts sit in columns on a wide screen and one after another on a phone. | none | 200 |
| `layout.title` | her | Layout | none | 40 |
| `layout.turn` | her | {name}, part {part} | `{name}` `{part}` | 40 |
| `layout.turnLabel` | her | Label | none | 40 |
| `layout.turnLabelHelp` | her | Optional, a few words above the turn. | none | 74 |
| `layout.turnPart` | her | Which part of theirs | none | 40 |
| `layout.turnPerson` | her | Whose part | none | 40 |
| `layout.twice` | her | Round {n}: each part of each person's words can appear only once. | `{n}` | 200 |
| `look.designHeading` | her | Make a new look from your words | none | 62 |
| `look.designOpen` | her | Describe a new look | none | 40 |
| `look.designText` | her | Describe the colors and feeling you want. Your writing helper drafts a look you can see before you save it. | none | 214 |
| `look.notAccepted` | her | Your site's settings didn't accept these choices. Your choices are still here; try a different one, or tell {helper}. | `{helper}` | 234 |
| `moments.add` | her | Add a moment | none | 40 |
| `moments.badTime` | her | Write the time as seconds or h:mm:ss, like 75 or 1:02:03. | none | 114 |
| `moments.badWhere` | her | Write where it is without spaces around it, brackets or semicolons, in a few words. | none | 200 |
| `moments.button` | her | Moments | none | 40 |
| `moments.cantUse` | her | This moment no longer fits what started it. Change it or keep it private. | none | 146 |
| `moments.cantWrite` | her | Only people who write a part add moments. | none | 82 |
| `moments.change` | her | Change | none | 40 |
| `moments.changeLabel` | her | Change the moment at {where} | `{where}` | 56 |
| `moments.changedAfter` | her | Your moments changed after you shared this version, so those changes stay private until you share again. | none | 200 |
| `moments.endBefore` | her | The end has to come after the start. | none | 72 |
| `moments.fieldCreator` | her | who made it | none | 40 |
| `moments.fieldPublisher` | her | who published it | none | 40 |
| `moments.fieldTitle` | her | the name | none | 40 |
| `moments.fillDone` | her | Filled in from {site}: {fields}. Check them; they're yours to change. | `{site}` `{fields}` | 200 |
| `moments.fillFailed` | her | The details couldn't be found. Type them yourself; nothing is lost. | none | 134 |
| `moments.fillIn` | her | Fill in from the link | none | 42 |
| `moments.fillInHelp` | her | Asks the site the link is on for the title and who made it. Only empty boxes are filled. | none | 200 |
| `moments.fillNothing` | her | {site} had nothing to add. | `{site}` | 52 |
| `moments.fillPasteFirst` | her | Put the link in first. The details are optional. | none | 96 |
| `moments.fillStale` | her | The link changed while asking, so nothing was filled in. | none | 112 |
| `moments.fillUnsupported` | her | Details can only be found for some video and code sites. Type them yourself. | none | 200 |
| `moments.from` | her | From | none | 40 |
| `moments.kindCanonical` | her | A standard reference | none | 40 |
| `moments.kindCanonicalHint` | her | Like Republic 514a. | none | 40 |
| `moments.kindChapter` | her | A chapter | none | 40 |
| `moments.kindChapterHint` | her | A chapter number or name. | none | 50 |
| `moments.kindLine` | her | A line | none | 40 |
| `moments.kindLineHint` | her | A line number. | none | 40 |
| `moments.kindPage` | her | A page | none | 40 |
| `moments.kindPageHint` | her | A page number, like 12 or xiv. | none | 60 |
| `moments.kindSection` | her | A section | none | 40 |
| `moments.kindSectionHint` | her | A section number or name. | none | 50 |
| `moments.kindTime` | her | A time | none | 40 |
| `moments.kindTimeHint` | her | Seconds or h:mm:ss, like 75 or 1:02:03. | none | 78 |
| `moments.lede` | her | A moment is a place in what started it: a time in a video, a page of a book. Keep it private, or put it with your part for the others to read. | none | 240 |
| `moments.line` | her | {source}, {where}. {who} | `{source}` `{where}` `{who}` | 240 |
| `moments.needProvenance` | her | Say where the words came from. | none | 60 |
| `moments.needRights` | her | Say what rights apply to the words. Choose “Not checked yet” if nobody has checked. | none | 200 |
| `moments.needSomething` | her | Add the words said there, what you noticed, or both. | none | 104 |
| `moments.needSource` | her | Choose what it's in. | none | 40 |
| `moments.needWhere` | her | Say where it is. | none | 40 |
| `moments.none` | her | No moments yet. | none | 40 |
| `moments.notShared` | her | Your moments couldn't go with this version, so they stay private. Share again to send them. | none | 200 |
| `moments.observation` | her | What you noticed (optional) | none | 54 |
| `moments.openAt` | her | Open it at {at} | `{at}` | 40 |
| `moments.openSource` | her | Open it (find the place yourself) | none | 66 |
| `moments.private` | her | Only you can see it. | none | 40 |
| `moments.proposed` | her | Goes with your part. | none | 40 |
| `moments.provenance` | her | Where the words came from | none | 50 |
| `moments.provenanceCopied` | her | Copied from its published words or captions | none | 86 |
| `moments.provenanceSupplied` | her | From whoever said them or owns them | none | 70 |
| `moments.provenanceTranscribed` | her | I wrote them down from it | none | 50 |
| `moments.publish` | her | Put it with my part | none | 40 |
| `moments.publishHelp` | her | The others read it with your part, and everyone agrees to it. Otherwise only you see it. | none | 200 |
| `moments.quote` | her | The words said there (optional) | none | 62 |
| `moments.remove` | her | Take it out | none | 40 |
| `moments.removeLabel` | her | Take out the moment at {where} | `{where}` | 60 |
| `moments.removed` | her | Taken out. | none | 40 |
| `moments.rights` | her | Rights | none | 40 |
| `moments.rightsBrief` | her | A short quotation for comment or review | none | 78 |
| `moments.rightsNote` | her | A note about the rights (optional) | none | 68 |
| `moments.rightsOpen` | her | It's under an open licence | none | 52 |
| `moments.rightsOwn` | her | These are my own words | none | 44 |
| `moments.rightsPermission` | her | Whoever owns it said yes | none | 48 |
| `moments.rightsPublicDomain` | her | It's in the public domain | none | 50 |
| `moments.rightsUnknown` | her | Not checked yet (keeps it private) | none | 68 |
| `moments.save` | her | Save the moment | none | 40 |
| `moments.saved` | her | Saved. | none | 40 |
| `moments.savedProposed` | her | Saved. It goes with your part when you let the others read it, and everyone agrees to it. | none | 200 |
| `moments.sheetTitle` | her | Moments in what started it | none | 52 |
| `moments.source` | her | In what | none | 40 |
| `moments.speaker` | her | Who said it | none | 40 |
| `moments.statement` | her | What you choose here is your own statement; {product} doesn't check it. | `{product}` | 142 |
| `moments.theirs` | her | Moments the others shared | none | 50 |
| `moments.title` | her | Moments | none | 40 |
| `moments.to` | her | To (optional) | none | 40 |
| `moments.uncheckedPrivate` | her | Words whose rights aren't checked stay private. Choose the rights, or keep the moment to yourself. | none | 200 |
| `moments.unlisted` | her | Something no longer listed | none | 52 |
| `moments.whereKind` | her | Where in it | none | 40 |
| `moments.yours` | her | Your moments | none | 40 |
| `name.changeAsk` | her | Change how your name goes on it? | none | 64 |
| `name.changeGo` | her | Change it | none | 40 |
| `name.changeKeep` | her | Keep it as it is | none | 40 |
| `name.changeText` | her | Everyone who agreed will need to read it again and agree again. | none | 126 |
| `name.choose` | her | How your name goes on it | none | 48 |
| `name.lede` | her | Readers see this with your part. Changing it later means everyone reads it again and agrees again. | none | 200 |
| `name.needChoice` | her | Choose how your name goes on it. | none | 64 |
| `name.needName` | her | Write the name readers see. | none | 54 |
| `name.notYet` | her | You haven't said yet. | none | 42 |
| `name.now` | her | Readers will see: {said} | `{said}` | 48 |
| `name.off` | her | Leave my name off | none | 40 |
| `name.offHelp` | her | Your part is still in it, with no name. | none | 78 |
| `name.people` | her | My name as People has it | none | 48 |
| `name.peopleHelp` | her | With its link, as it is now. A later change in People doesn't change this. | none | 200 |
| `name.saidOff` | her | no name | none | 40 |
| `name.saidPeople` | her | your name as People has it | none | 52 |
| `name.saidTyped` | her | {name} | `{name}` | 40 |
| `name.save` | her | Use this | none | 40 |
| `name.saved` | her | Saved. Readers will see your name this way. | none | 86 |
| `name.savedAgain` | her | Saved. Everyone reads it again and agrees again. | none | 96 |
| `name.sheetTitle` | her | Your name on {title} | `{title}` | 40 |
| `name.title` | her | Your name on it | none | 40 |
| `name.tooLong` | her | Use a shorter name. | none | 40 |
| `name.typed` | her | A name I write here | none | 40 |
| `name.typedLabel` | her | The name readers see | none | 40 |
| `name.whereNaming` | her | hasn't said how their name goes on it | none | 74 |
| `notebook.aboutMissing` | her | About a passage that's gone | none | 54 |
| `notebook.aboutPassages` | her | About these passages | none | 40 |
| `notebook.aboutSources` | her | About these sources | none | 40 |
| `notebook.addPlace` | her | Add another place | none | 40 |
| `notebook.addToAtlas` | her | Add it to the atlas | none | 40 |
| `notebook.all` | her | Everything | none | 40 |
| `notebook.alsoConcept` | her | Notes on {concept} ({count}) | `{concept}` `{count}` | 56 |
| `notebook.alsoNone` | her | Nothing else yet. | none | 40 |
| `notebook.alsoPassage` | her | Also about this passage ({count}) | `{count}` | 66 |
| `notebook.alsoSource` | her | Other research on {source} ({count}) | `{source}` `{count}` | 72 |
| `notebook.ambiguousPlace` | her | Say which volume: that place is in more than one. | none | 98 |
| `notebook.answered` | her | Answered questions | none | 40 |
| `notebook.anyPlace` | her | Any | none | 40 |
| `notebook.anySource` | her | Any source | none | 40 |
| `notebook.archive` | her | Archive | none | 40 |
| `notebook.archived` | her | Archived. It stays in your notebook and in copies, out of the lists. | none | 136 |
| `notebook.archivedLine` | her | Archived: kept, but left out of lists and search unless you show archived ones. | none | 158 |
| `notebook.backToList` | her | ‹ Your notebook | none | 40 |
| `notebook.badConcept` | her | Use lowercase letters, numbers and dashes for each concept. | none | 118 |
| `notebook.badPassage` | her | One of those passages is gone. Take it off the list. | none | 104 |
| `notebook.badPlace` | her | Place {n} needs a kind and a value, like page 514. | `{n}` | 100 |
| `notebook.badSource` | her | Choose a source in your library. | none | 64 |
| `notebook.bringBlocked` | her | Some entries clash with ones you have. Nothing was brought in. | none | 124 |
| `notebook.bringCheck` | her | Check what it would do | none | 44 |
| `notebook.bringDo` | her | Bring in {count} | `{count}` | 40 |
| `notebook.bringFile` | her | A notebook copy | none | 40 |
| `notebook.bringLede` | her | Adds what your notebook doesn't have. It never changes or removes anything here. | none | 160 |
| `notebook.bringNotCopy` | her | That file isn't a notebook copy. | none | 64 |
| `notebook.bringNote` | her | Note {id} | `{id}` | 40 |
| `notebook.bringOpen` | her | Bring in a notebook copy… | none | 50 |
| `notebook.bringPassage` | her | Passage {id} | `{id}` | 40 |
| `notebook.bringSummary` | her | {add} to add, {same} already here, {conflicts} in conflict. | `{add}` `{same}` `{conflicts}` | 118 |
| `notebook.bringTitle` | her | Bring in a notebook copy | none | 48 |
| `notebook.broughtIn` | her | Brought in: {summary} | `{summary}` | 42 |
| `notebook.citeIt` | her | Cite it in your post | none | 40 |
| `notebook.clear` | her | Clear the filters | none | 40 |
| `notebook.concept` | her | Concept | none | 40 |
| `notebook.conceptEntry` | her | In your atlas: {label} | `{label}` | 44 |
| `notebook.conceptMissing` | her | isn't in your atlas yet. | none | 48 |
| `notebook.concepts` | her | Concepts | none | 40 |
| `notebook.conceptsHelp` | her | Lowercase words, like allegory or the-good. | none | 86 |
| `notebook.conceptsTitle` | her | Its concepts in your atlas | none | 52 |
| `notebook.conflict` | her | Your notebook changed somewhere else, so nothing was saved. Your changes are still here. | none | 176 |
| `notebook.copied` | her | Saved {filename}: {passages} passages and {notes} notes. | `{filename}` `{passages}` `{notes}` | 112 |
| `notebook.copyGo` | her | Save the copy | none | 40 |
| `notebook.copyOpen` | her | Save a copy of your notebook… | none | 58 |
| `notebook.copyStay` | her | Not now | none | 40 |
| `notebook.copyText` | her | The file holds every passage and note, archived ones too. Keep it somewhere private, never in {product}'s folders. | `{product}` | 228 |
| `notebook.copyTitle` | her | Save a copy of your notebook? | none | 58 |
| `notebook.dropTitle` | her | Leave out your changes to this entry? | none | 74 |
| `notebook.emptyText` | her | Keep the exact words you read, with where they are, and your own notes and questions beside them. | none | 194 |
| `notebook.emptyTitle` | her | Nothing kept yet | none | 40 |
| `notebook.filters` | her | Filters ({count}) | `{count}` | 40 |
| `notebook.follow` | her | A note about it (optional) | none | 52 |
| `notebook.followHelp` | her | Your own words. Leave it empty to keep the passage alone. | none | 114 |
| `notebook.from` | her | From | none | 40 |
| `notebook.fromHelp` | her | A source in your library. | none | 50 |
| `notebook.fromPostLede` | her | Saved to your notebook. Your post doesn't change. | none | 98 |
| `notebook.inNote` | her | your note | none | 40 |
| `notebook.inSource` | her | the source | none | 40 |
| `notebook.inWords` | her | the exact words | none | 40 |
| `notebook.isAnswered` | her | It's answered | none | 40 |
| `notebook.keep` | her | Keep it | none | 40 |
| `notebook.keepFromPost` | her | Keep these words as a passage… | none | 60 |
| `notebook.kept` | her | Kept in your notebook. | none | 44 |
| `notebook.kind` | her | Kind | none | 40 |
| `notebook.kindObservation` | her | Observation | none | 40 |
| `notebook.kindQuestion` | her | Question | none | 40 |
| `notebook.language` | her | Language (optional) | none | 40 |
| `notebook.listLabel` | her | What to list | none | 40 |
| `notebook.matchedIn` | her | Found in: {where} | `{where}` | 40 |
| `notebook.needSource` | her | Add a source first, then keep passages from it. | none | 94 |
| `notebook.neverMind` | her | Never mind | none | 40 |
| `notebook.newNote` | her | Write a note | none | 40 |
| `notebook.newPassage` | her | Keep a passage | none | 40 |
| `notebook.noNotes` | her | No notes yet. | none | 40 |
| `notebook.noPassages` | her | No passages kept yet. | none | 42 |
| `notebook.noResults` | her | Nothing matches. Clear a filter or try other words. | none | 102 |
| `notebook.notPrivate` | her | This entry came from somewhere else and can't be changed here. | none | 124 |
| `notebook.note` | her | Your note | none | 40 |
| `notebook.noteHeading` | her | Note | none | 40 |
| `notebook.noteHelp` | her | Your own words. Quoted words belong in a passage. | none | 98 |
| `notebook.notePartial` | her | The passage is kept, but the note isn't. Fix the note and save, or leave it out. | none | 160 |
| `notebook.notes` | her | Notes | none | 40 |
| `notebook.observation` | her | Observation | none | 40 |
| `notebook.open` | her | Open questions | none | 40 |
| `notebook.passageHeading` | her | Passage | none | 40 |
| `notebook.passages` | her | Passages | none | 40 |
| `notebook.placeKind` | her | Kind of place | none | 40 |
| `notebook.placeLimit` | her | A passage can have up to 8 places. | none | 68 |
| `notebook.privateLine` | her | Private. Readers never see this. | none | 64 |
| `notebook.questionAnswered` | her | Question · answered | none | 40 |
| `notebook.questionOpen` | her | Question · open | none | 40 |
| `notebook.questions` | her | Questions | none | 40 |
| `notebook.restore` | her | Restore | none | 40 |
| `notebook.restored` | her | Restored. | none | 40 |
| `notebook.results` | her | {count} found | `{count}` | 40 |
| `notebook.save` | her | Save changes | none | 40 |
| `notebook.saved` | her | Saved. | none | 40 |
| `notebook.search` | her | Search your notebook | none | 40 |
| `notebook.searchHelp` | her | Words you kept, your notes, a source or a key. | none | 92 |
| `notebook.showArchived` | her | Show archived | none | 40 |
| `notebook.showThem` | her | Show them | none | 40 |
| `notebook.source` | her | Source | none | 40 |
| `notebook.sourceFixed` | her | A passage stays with its source. Keep words from another source as a new passage. | none | 162 |
| `notebook.stillLinked` | her | {count} notes are about this passage. Take them out or unlink them first. | `{count}` | 146 |
| `notebook.takeOut` | her | Take it out | none | 40 |
| `notebook.takenOut` | her | Taken out of your notebook. | none | 54 |
| `notebook.title` | her | Your notebook | none | 40 |
| `notebook.where` | her | Where it is | none | 40 |
| `notebook.words` | her | The exact words | none | 40 |
| `notebook.wordsHelp` | her | Kept exactly as you type them, as someone else's words. | none | 110 |
| `notify.appSwitch` | her | News from your other apps | none | 50 |
| `notify.canTurnOn` | her | {helper} can turn them on. {product} works the same without them. | `{helper}` `{product}` | 130 |
| `notify.cantLoad` | her | {product} couldn't load your notifications. Try again in a minute. | `{product}` | 132 |
| `notify.cantReach` | her | Can't reach {product} right now. Check your connection, then try again. | `{product}` | 142 |
| `notify.commentsLink` | her | someone comments | none | 40 |
| `notify.didntSeeAndroid` | her | In Settings: Apps, then {product} (or Chrome), then Notifications. | `{product}` | 132 |
| `notify.didntSeeApple` | her | In the Settings app: Notifications, then {product}. Allow Notifications should be on, with Lock Screen and Banners turned on. | `{product}` | 240 |
| `notify.findAllow` | her | Find {product} and choose Allow. | `{product}` | 64 |
| `notify.findInList` | her | Find {product} in the list (it has the name under its icon) and tap it. | `{product}` | 142 |
| `notify.gone` | her | This {noun} stopped taking notifications, so {product} forgot it. Turn them on again. | `{noun}` `{product}` | 170 |
| `notify.holdIcon` | her | Touch and hold {product}'s icon. | `{product}` | 64 |
| `notify.homeScreenFirst` | her | On an {noun}, {product} can only send notifications once it's on your Home Screen. It takes four taps. | `{noun}` `{product}` | 204 |
| `notify.inApp` | her | This page is open inside another app, which can't show notifications. Open {product} in {app}: | `{product}` `{app}` | 188 |
| `notify.lede` | her | Your phone can tell you when {what}, even when {product} is closed. | `{what}` `{product}` | 134 |
| `notify.nameHelp` | her | So you can tell them apart, like Work phone. | none | 88 |
| `notify.nameMissing` | her | Give it a name, like Work phone. | none | 64 |
| `notify.notReady` | her | {product} couldn't get this {noun} ready. Reload the page, then try again. | `{product}` `{noun}` | 148 |
| `notify.notSecure` | her | Notifications only work at {product}'s secure address. | `{product}` | 108 |
| `notify.notSetUp` | her | Notifications aren't set up for {product} | `{product}` | 82 |
| `notify.nothingOn` | her | They tell you about comments and quote requests, and neither is turned on for {product}. | `{product}` | 176 |
| `notify.otherGone` | her | {name} stopped taking notifications, so {product} forgot it. | `{name}` `{product}` | 120 |
| `notify.readersLink` | her | a reader sends you something | none | 56 |
| `notify.removeAsk` | her | It won't get notifications from {product} any more. To get them there again, open {product} on it and turn them on. | `{product}` | 230 |
| `notify.removedElsewhere` | her | This {noun} was removed from the phones {product} tells, on another phone or computer. Turn them on again. | `{noun}` `{product}` | 212 |
| `notify.removedOff` | her | This {noun} was removed from the phones {product} tells, so it's off. | `{noun}` `{product}` | 138 |
| `notify.saidNo` | her | You said no when your {noun} asked, so it can't show notifications from {product}. To change that: | `{noun}` `{product}` | 196 |
| `notify.serviceDown` | her | {product} couldn't reach its notification service. Try again in a minute. | `{product}` | 146 |
| `notify.tooMany` | her | {product} can tell up to {limit} phones and computers. Remove one you don't use any more, below. | `{product}` `{limit}` | 192 |
| `notify.updateFirst` | her | This {noun} needs a newer iOS before {product} can send it notifications. In the Settings app: General, then Software Update. | `{noun}` `{product}` | 240 |
| `part.addIdea` | her | Add | none | 40 |
| `part.addIdeaLabel` | her | Add “{idea}” to your words | `{idea}` | 52 |
| `part.asWritten` | her | Show the words as written | none | 50 |
| `part.asWrittenLabel` | her | Your words as written | none | 42 |
| `part.breakLabel` | her | Part {n} | `{n}` | 40 |
| `part.bringMineBack` | her | Bring mine back | none | 40 |
| `part.cantShareNever` | her | Each part stays private here, so it can't be shared. Whoever runs it can change that. | none | 200 |
| `part.cantWrite` | her | You read this one; you don't write a part. {helper} or whoever runs it can change that. | `{helper}` | 200 |
| `part.changedSince` | her | Changed since you shared it · only you can read the changes. | none | 120 |
| `part.conflict` | her | You changed your part somewhere else too. | none | 82 |
| `part.conflictText` | her | Both are here. Nothing is lost until you choose. | none | 96 |
| `part.decideLater` | her | Decide later | none | 40 |
| `part.details` | details | Saved {n} times. Every save is kept as a version; when you share, the others read the version on screen. | `{n}` | 200 |
| `part.full` | her | This part can't be saved any more times. Let the others read it, or tell {helper}. | `{helper}` | 200 |
| `part.hideIdeas` | her | Hide ideas | none | 40 |
| `part.idea1` | her | What stood out to you, and why? | none | 62 |
| `part.idea2` | her | What did you agree or disagree with? | none | 72 |
| `part.idea3` | her | What did it remind you of from your own life? | none | 90 |
| `part.idea4` | her | What would you ask the others? | none | 60 |
| `part.ideaAdded` | her | Added to your words. | none | 40 |
| `part.ideas` | her | Ideas to start from | none | 40 |
| `part.keepMine` | her | Keep mine | none | 40 |
| `part.keptHere` | her | Kept on this computer. Press Save to keep it on {product}. | `{product}` | 116 |
| `part.keptNewer` | her | Your part has changes kept on this computer from {when}. | `{when}` | 112 |
| `part.leaveAsk` | her | Save your part before you go? | none | 58 |
| `part.leaveGo` | her | Go without saving | none | 40 |
| `part.leaveSave` | her | Save and go | none | 40 |
| `part.leaveText` | her | Your latest words aren't saved yet. They stay kept on this computer either way. | none | 200 |
| `part.moveDown` | her | Move down | none | 40 |
| `part.moveDownLabel` | her | Move the start of part {n} down | `{n}` | 62 |
| `part.moveUp` | her | Move up | none | 40 |
| `part.moveUpLabel` | her | Move the start of part {n} up | `{n}` | 58 |
| `part.moved` | her | Moved. | none | 40 |
| `part.nearlyFull` | her | You can save this part {n} more times. Let the others read it, or tell {helper}. | `{n}` `{helper}` | 200 |
| `part.needWords` | her | Write something first. | none | 44 |
| `part.newPart` | her | Start a new part | none | 40 |
| `part.newPartAdded` | her | A new part starts here. | none | 46 |
| `part.newPartHelp` | her | Splits your words so whoever runs it can place each part in the layout. Readers never see the break. | none | 200 |
| `part.newPartHere` | her | New part here | none | 40 |
| `part.notYet` | her | Not yet after all | none | 40 |
| `part.notYetDone` | her | Taken back. Nobody had read it. | none | 62 |
| `part.nothingYet` | her | Nothing written yet · only you will read it until you share it. | none | 200 |
| `part.onBlogNow` | her | On {product} now | `{product}` | 40 |
| `part.onScreen` | her | On this screen | none | 40 |
| `part.privateLede` | her | Each of you writes only your own part, so nobody's words are ever overwritten. | none | 200 |
| `part.readThem` | her | Read them | none | 40 |
| `part.reagreeWarn` | her | {names} agreed to your earlier words. They'll need to read and agree again. | `{names}` | 200 |
| `part.save` | her | Save | none | 40 |
| `part.saved` | her | Saved · only you can read it. | none | 58 |
| `part.saving` | her | Saving… | none | 40 |
| `part.share` | her | Let the others read it | none | 44 |
| `part.shareAsk` | her | Let the others read your part as it is now? | none | 86 |
| `part.shareAskText` | her | When everyone's ready, you'll all read each other's parts. Once someone has read it, it can't be taken back. Changes you make after this stay private until you share again. | none | 240 |
| `part.shareAskVoluntary` | her | Anyone else who's ready reads it now. Once someone has read it, it can't be taken back. Changes you make after this stay private until you share again. | none | 240 |
| `part.shareChanges` | her | Let them read your changes | none | 52 |
| `part.shareGo` | her | Let them read it | none | 40 |
| `part.shareNo` | her | Not yet | none | 40 |
| `part.sharedNow` | her | Shared. You can read everyone's parts now. | none | 84 |
| `part.sharedStatus` | her | Shared · the others read this version when everyone's ready. | none | 200 |
| `part.sharedWaiting` | her | Ready. You'll all read each other's parts when everyone's ready. | none | 128 |
| `part.showIdeas` | her | Show ideas | none | 40 |
| `part.takeOut` | her | Take out | none | 40 |
| `part.takeOutLabel` | her | Take out the start of part {n} | `{n}` | 60 |
| `part.title` | her | Your part | none | 40 |
| `part.tooLong` | her | Your part is too long to save in one go. Make it shorter or split it into two reflections. | none | 200 |
| `part.tookOut` | her | Parts joined back together. | none | 54 |
| `part.undo` | her | Undo | none | 40 |
| `part.useKept` | her | Use them | none | 40 |
| `part.useOther` | her | Use the other one | none | 40 |
| `part.useSaved` | her | Use what's saved | none | 40 |
| `part.waitingSignal` | her | Waiting for a signal · kept on this computer. | none | 90 |
| `part.words` | her | Your words | none | 40 |
| `part.wordsPart` | her | Your words, part {n} | `{n}` | 40 |
| `paste.kept` | her | Pasted. Headings, bold and links kept. Fonts and colours left out. | none | 132 |
| `paste.photoLeftMany` | her | {count} photos were left out because they have no description. Put them in with Put a photo in. | `{count}` | 190 |
| `paste.photoLeftOne` | her | 1 photo was left out because it has no description. Put it in with Put a photo in. | none | 164 |
| `paste.plainKeys` | her | Ctrl+Shift+V pastes plain words. | none | 64 |
| `paste.plainMac` | her | ⌘⇧V pastes plain words. | none | 46 |
| `paths.addEntries` | her | Atlas entries | none | 40 |
| `paths.addHeading` | her | Add a step | none | 40 |
| `paths.addNoMatch` | her | Nothing matches that. | none | 42 |
| `paths.addNone` | her | Nothing to add. Only published posts can be steps, and each can be on a path once. | none | 164 |
| `paths.addPosts` | her | Posts | none | 40 |
| `paths.addSearch` | her | Search your published posts | none | 54 |
| `paths.addStep` | her | Add a step | none | 40 |
| `paths.added` | her | Added {title}. Say why it follows, then save. | `{title}` | 90 |
| `paths.addedFirst` | her | Added {title} as the first step. | `{title}` | 64 |
| `paths.addressFixed` | her | Its address is {address}. It can't be changed. | `{address}` | 92 |
| `paths.addressHelp` | her | The last part of its web address. It can't be changed after the first save. | none | 150 |
| `paths.asWritten` | her | Show the path as written (for {helper}) | `{helper}` | 78 |
| `paths.back` | her | ‹ All reading paths | none | 40 |
| `paths.basis` | her | Which atlas link says so | none | 48 |
| `paths.basisHelp` | her | Only a link you've published between two entries can say one influenced the other. | none | 164 |
| `paths.basisNone` | her | No published link between these two | none | 70 |
| `paths.change` | her | Change | none | 40 |
| `paths.changedHeading` | her | Changed somewhere else | none | 44 |
| `paths.changedText` | her | This reading path was changed somewhere else while you had it open. Your changes are still here. Which do you want to keep? | none | 240 |
| `paths.chooseOne` | her | Choose one | none | 40 |
| `paths.crumbHome` | her | Home | none | 40 |
| `paths.delete` | her | Delete | none | 40 |
| `paths.deleteAsk` | her | Delete “{title}”? | `{title}` | 40 |
| `paths.deleteAskLive` | her | It's on your site now. Deleting takes it off. You can bring it back right after with Undo. | none | 180 |
| `paths.deleteAskText` | her | You can bring it back right after with Undo. | none | 88 |
| `paths.deleted` | her | Deleted “{title}”. | `{title}` | 40 |
| `paths.diagDetails` | details | Kind: {kind} | `{kind}` | 40 |
| `paths.diagDropped` | her | its reason can't be shown as written, so the whole path is held back | none | 136 |
| `paths.diagStep` | her | {title}: {why} | `{title}` `{why}` | 40 |
| `paths.diagUnavailable` | her | isn't published, so readers don't see it | none | 80 |
| `paths.diagWithheld` | her | fewer than two steps are published, so the path is held back | none | 120 |
| `paths.diffAdvanced` | her | For people who know the subject | none | 62 |
| `paths.diffIntermediate` | her | Some background helps | none | 42 |
| `paths.diffIntroductory` | her | Easy to start with | none | 40 |
| `paths.difficulty` | her | How hard | none | 40 |
| `paths.difficultyNone` | her | Not said | none | 40 |
| `paths.dismiss` | her | Dismiss | none | 40 |
| `paths.eChanged` | her | This path changed somewhere else since you opened it. Nothing was saved. | none | 144 |
| `paths.eGeneric` | her | That didn't work. Nothing was changed. | none | 76 |
| `paths.eMissing` | her | That reading path isn't there any more. | none | 78 |
| `paths.eSentence` | details | What the server said: | none | 42 |
| `paths.eStorage` | her | Your site couldn't keep it. Nothing was changed. | none | 96 |
| `paths.eTooLarge` | her | That's more than a reading path can hold. | none | 82 |
| `paths.emptyText` | her | Pick a few posts, put them in an order, and say why each one follows the one before. | none | 168 |
| `paths.emptyTitle` | her | No reading paths yet | none | 40 |
| `paths.fieldAddress` | her | Address | none | 40 |
| `paths.fieldSummary` | her | A line about this path | none | 44 |
| `paths.fieldTitle` | her | Title | none | 40 |
| `paths.findAdd` | her | Add a step to this reading path | none | 62 |
| `paths.findMake` | her | Make a reading path | none | 40 |
| `paths.findSave` | her | Save this reading path | none | 44 |
| `paths.findUndo` | her | Undo: {last} | `{last}` | 40 |
| `paths.goToStep` | her | Go to {title} | `{title}` | 40 |
| `paths.heldAskHeading` | her | Save without the reason for “{title}”? | `{title}` | 76 |
| `paths.heldAskNo` | her | Go back | none | 40 |
| `paths.heldAskText` | her | That step is first now, so it has nothing to follow, and the reason you wrote for it can't be kept in the saved path. Undo after saving brings it back. | none | 240 |
| `paths.heldAskYes` | her | Save without it | none | 40 |
| `paths.howItRelates` | her | How it relates to the step before | none | 66 |
| `paths.keepIt` | her | Keep it | none | 40 |
| `paths.keptReason` | her | The reason you wrote is kept. It comes back if this step moves down again. | none | 148 |
| `paths.lastDelete` | her | deleting {title} | `{title}` | 40 |
| `paths.lastSave` | her | the last save | none | 40 |
| `paths.leaveGo` | her | Leave without saving | none | 40 |
| `paths.leaveHeading` | her | Save this reading path? | none | 46 |
| `paths.leaveSave` | her | Save | none | 40 |
| `paths.leaveText` | her | You changed it and didn't save. | none | 62 |
| `paths.lede` | her | A reading path puts some of your posts in an order, with why each one comes next. | none | 162 |
| `paths.listed` | her | Show it in lists and search | none | 54 |
| `paths.listedHelp` | her | Off, it's still at its own address. | none | 70 |
| `paths.loadFailed` | her | Your reading paths didn't load. | none | 62 |
| `paths.make` | her | Make a reading path | none | 40 |
| `paths.makeDraft` | her | Make it a draft again | none | 42 |
| `paths.more` | her | More | none | 40 |
| `paths.move` | her | Move | none | 40 |
| `paths.moveDown` | her | Move down | none | 40 |
| `paths.moveFirst` | her | Move to the start | none | 40 |
| `paths.moveKeys` | her | On a step you can also press Alt, Shift and an arrow, or Home or End. | none | 138 |
| `paths.moveLast` | her | Move to the end | none | 40 |
| `paths.moveUp` | her | Move up | none | 40 |
| `paths.moved` | her | {title} is step {number} of {count} now. Not saved yet. | `{title}` `{number}` `{count}` | 110 |
| `paths.nav` | her | Reading paths | none | 40 |
| `paths.newHeading` | her | Make a reading path | none | 40 |
| `paths.noMoreSteps` | her | That's as many steps as a path holds. | none | 74 |
| `paths.notCollection` | her | A collection keeps posts that belong together. A reading path is an order to read them in, with why each comes next. A post can be on many paths. | none | 240 |
| `paths.nothingChanged` | her | Nothing's changed. | none | 40 |
| `paths.open` | her | Open {title} | `{title}` | 40 |
| `paths.optional` | her | A side step readers may skip | none | 56 |
| `paths.optionalHelp` | her | The first step can't be one: every reader starts there. | none | 110 |
| `paths.pAddress` | her | The address uses lowercase letters, numbers and single hyphens, up to 64 characters. | none | 168 |
| `paths.pAddressTaken` | her | A reading path already has that address. Choose another. | none | 112 |
| `paths.pBadBasis` | her | That isn't a published atlas link you can use here. | none | 102 |
| `paths.pBadValue` | her | Something here isn't right. Check it and try again. | none | 102 |
| `paths.pDuplicate` | her | Two steps have the same name inside the path. Take one out and add it again. | none | 152 |
| `paths.pFirstOptional` | her | The first step is where every reader starts, so it can't be a side step. | none | 144 |
| `paths.pFirstReason` | her | The first step has nothing to follow, so it has no reason. | none | 116 |
| `paths.pInfluenceAtlas` | her | “Was influenced by” joins two atlas entries. Choose another way for posts. | none | 148 |
| `paths.pInfluenceBasis` | her | Choose the published atlas link that says one influenced the other. | none | 134 |
| `paths.pNeedTwo` | her | A published path needs at least two steps readers can see. | none | 116 |
| `paths.pNeedsReason` | her | Say why this step follows, in your own words. | none | 90 |
| `paths.pNeedsRelation` | her | Choose how this step relates to the one before. | none | 94 |
| `paths.pNothingToFollow` | her | There's no earlier step for this one to follow. | none | 94 |
| `paths.pRepeat` | her | This is already a step. A path never goes back to one. | none | 108 |
| `paths.pSummaryLong` | her | That line is too long. | none | 44 |
| `paths.pTitleLong` | her | That title is too long. | none | 46 |
| `paths.pTitleRequired` | her | Give the path a title. | none | 44 |
| `paths.pTooLong` | her | That's too long. | none | 40 |
| `paths.pTooMany` | her | A path can't hold more steps than that. | none | 78 |
| `paths.pUnknownTarget` | her | That step points at something that isn't a published post or entry. | none | 134 |
| `paths.prerequisites` | her | What to know first | none | 40 |
| `paths.previewClose` | her | Back to your reading path | none | 50 |
| `paths.previewDraft` | her | This is a draft. It shows what readers would see if you published it now. | none | 146 |
| `paths.previewEmpty` | her | Add a step to see it here. | none | 52 |
| `paths.previewFailed` | her | That didn't load. Try again. | none | 56 |
| `paths.previewHard` | her | Level: {level} | `{level}` | 40 |
| `paths.previewHeading` | her | What readers will see | none | 42 |
| `paths.previewNeed` | her | Before you start: {text} | `{text}` | 48 |
| `paths.previewOnlyYou` | her | Only you see this page. Nothing is published by looking. | none | 112 |
| `paths.previewReasons` | her | Only you see this: why readers don't see some steps | none | 102 |
| `paths.previewRefresh` | her | Looking at your latest changes… | none | 62 |
| `paths.previewSide` | her | A side step you can skip | none | 48 |
| `paths.previewWithheld` | her | Readers wouldn't see this path yet. | none | 70 |
| `paths.problemsHeading` | her | Not saved yet | none | 40 |
| `paths.problemsMany` | her | {count} things need a look first. | `{count}` | 66 |
| `paths.problemsOne` | her | One thing needs a look first. | none | 58 |
| `paths.publish` | her | Publish | none | 40 |
| `paths.rationale` | her | Why it's on the path | none | 40 |
| `paths.relApplies` | her | Applies it | none | 40 |
| `paths.relBackground` | her | Gives background | none | 40 |
| `paths.relBuildsOn` | her | Builds on it | none | 40 |
| `paths.relContrastsWith` | her | Contrasts with it | none | 40 |
| `paths.relInfluenced` | her | Was influenced by it | none | 40 |
| `paths.relNext` | her | Comes next | none | 40 |
| `paths.relRespondsTo` | her | Responds to it | none | 40 |
| `paths.relatesTo` | her | Follows {title}. | `{title}` | 40 |
| `paths.rowCantRead` | her | Can't be read yet | none | 40 |
| `paths.rowDraft` | her | Draft | none | 40 |
| `paths.rowNotShown` | her | Readers can't see it yet: a step isn't published. | none | 98 |
| `paths.rowOneStep` | her | 1 step | none | 40 |
| `paths.rowPublished` | her | Published | none | 40 |
| `paths.rowSteps` | her | {count} steps | `{count}` | 40 |
| `paths.rowUnlisted` | her | Not in lists | none | 40 |
| `paths.saveDraft` | her | Save draft | none | 40 |
| `paths.savedDraft` | her | Saved as a draft. Readers don't see it. | none | 78 |
| `paths.savedHidden` | her | Saved, but readers can't see it yet: a step isn't published. | none | 120 |
| `paths.savedNow` | her | Saved. | none | 40 |
| `paths.savedPublished` | her | Published. Readers see it at {url}, in about a minute. | `{url}` | 108 |
| `paths.savedPublishedOff` | her | Saved as published, but your site isn't showing reading paths yet. | none | 132 |
| `paths.savedUpdated` | her | Updated. | none | 40 |
| `paths.seeReaders` | her | See what readers will see | none | 50 |
| `paths.sheetCancel` | her | Cancel | none | 40 |
| `paths.sheetHeading` | her | A step | none | 40 |
| `paths.sheetKeep` | her | Keep this step | none | 40 |
| `paths.showTheirs` | her | Show the other version | none | 44 |
| `paths.siteOffDetails` | details | The site's setting readingPaths.publish is off. | none | 94 |
| `paths.siteOffText` | her | You can write them now. They show on your site once {helper} turns them on. | `{helper}` | 150 |
| `paths.siteOffTitle` | her | Readers can't see reading paths yet | none | 70 |
| `paths.stateDraft` | her | A draft: readers won't see this step | none | 72 |
| `paths.stateMissing` | her | Not found: readers won't see this step | none | 76 |
| `paths.stateOther` | her | Not public: readers won't see this step | none | 78 |
| `paths.statePublished` | her | Published | none | 40 |
| `paths.stateScheduled` | her | Scheduled: not public yet, readers won't see this step | none | 108 |
| `paths.stateUnknown` | her | Not checked yet | none | 40 |
| `paths.stepBack` | her | {title} is back. | `{title}` | 40 |
| `paths.stepHeading` | her | Step {number}: {title} | `{number}` `{title}` | 44 |
| `paths.stepIdDetails` | details | Step id: {id} | `{id}` | 40 |
| `paths.stepNeedsLook` | her | Needs a look | none | 40 |
| `paths.stepOptional` | her | A side step | none | 40 |
| `paths.stepsEmpty` | her | No steps yet. Add the first post readers should start with. | none | 118 |
| `paths.stepsHeading` | her | Steps | none | 40 |
| `paths.stepsLede` | her | Readers go through these in order. Each one after the first says why it follows. | none | 160 |
| `paths.stepsLeft` | her | {count} of {limit} steps | `{count}` `{limit}` | 48 |
| `paths.takeOut` | her | Take it out | none | 40 |
| `paths.targetsTrouble` | her | The list of posts to pick from didn't load, so you can't add a step right now. | none | 156 |
| `paths.theirsShown` | her | Here's the other version. | none | 50 |
| `paths.title` | her | Your reading paths | none | 40 |
| `paths.tookOut` | her | Took out {title}. Not saved yet. | `{title}` | 64 |
| `paths.tryAgain` | her | Try again | none | 40 |
| `paths.undo` | her | Undo | none | 40 |
| `paths.undoFailed` | her | That couldn't be put back, because the path changed since. Open it again. | none | 146 |
| `paths.undoStep` | her | Undo | none | 40 |
| `paths.undone` | her | Put back as it was. | none | 40 |
| `paths.unreadable` | her | This path can't be read, so it can't be shown here. Nothing changed. | none | 136 |
| `paths.unreadableDetails` | details | The first problem the server found: | none | 70 |
| `paths.unreadableHeading` | her | This reading path can't be read | none | 62 |
| `paths.untitled` | her | A reading path | none | 40 |
| `paths.update` | her | Update | none | 40 |
| `paths.useMine` | her | Use my changes | none | 40 |
| `paths.useMineSure` | her | Use your changes? | none | 40 |
| `paths.useMineSureText` | her | This replaces the other changes with what you have here. | none | 112 |
| `paths.useMineYes` | her | Yes, use my changes | none | 40 |
| `paths.wasDrafted` | her | It's a draft again. Readers don't see it. | none | 82 |
| `paths.why` | her | Why it follows, in your words | none | 58 |
| `paths.whyHelp` | her | A sentence or two. Readers see it between the two steps. | none | 112 |
| `paths.writtenClose` | her | Close | none | 40 |
| `paths.writtenHeading` | details | The path as written | none | 40 |
| `paths.writtenHelp` | details | The file exactly as it is kept. Shown for {helper}; changes are made on the form. | `{helper}` | 162 |
| `people.alreadyIn` | her | {name} is already in this, or already invited. | `{name}` | 92 |
| `people.bindingGone` | details | binding no longer current | none | 50 |
| `people.blogName` | her | {product}'s name | `{product}` | 40 |
| `people.changeAsk` | her | Change what {name} does? | `{name}` | 48 |
| `people.changeGo` | her | Change it | none | 40 |
| `people.changeKeep` | her | Keep it as it is | none | 40 |
| `people.changeLabel` | her | Change what {name} does | `{name}` | 46 |
| `people.changed` | her | {name} now: {what}. | `{name}` `{what}` | 40 |
| `people.chooseName` | her | Choose their name. | none | 40 |
| `people.close` | her | Done | none | 40 |
| `people.coWriterOnly` | her | You can invite only people who already write together on {product}. | `{product}` | 134 |
| `people.coWriterRemove` | details | Remove {name}'s sign-in | `{name}` | 46 |
| `people.coWriterRemoveAsk` | details | Remove {name}'s sign-in? | `{name}` | 48 |
| `people.coWriterRemoveGo` | details | Remove it | none | 40 |
| `people.coWriterRemoveKeep` | details | Keep it | none | 40 |
| `people.coWriterRemoveText` | details | They can't sign in any more and leave every reflection they're in. Their names stay on what they wrote. | none | 200 |
| `people.coWriterRemoved` | details | Removed the sign-in {name}. | `{name}` | 54 |
| `people.coWriterRow` | details | {name}: in {count} | `{name}` `{count}` | 40 |
| `people.coWriterWaiting` | details | {name}: invited, hasn't chosen a password yet | `{name}` | 90 |
| `people.coWriters` | details | Sign-ins for people writing with you | none | 72 |
| `people.coWritersNone` | details | No one writing with you has a sign-in of their own yet. | none | 110 |
| `people.copied` | her | Copied. | none | 40 |
| `people.copyLink` | her | Copy the link | none | 40 |
| `people.copyYourself` | her | Select the link and copy it. | none | 56 |
| `people.daysBad` | details | From 1 to 30 days. | none | 40 |
| `people.daysHelp` | details | 1 to 30. Usually 7. | none | 40 |
| `people.daysLabel` | details | Days the link works | none | 40 |
| `people.details` | details | Days the link works: {days}. Sign-in names and what each person can do, as stored, are below. | `{days}` | 200 |
| `people.existingName` | her | Their sign-in name | none | 40 |
| `people.existingNameHelp` | her | The name they sign in with. | none | 54 |
| `people.hasSignIn` | her | They already sign in to {product} | `{product}` | 66 |
| `people.howSignIn` | her | How they sign in | none | 40 |
| `people.invitations` | her | Invitations | none | 40 |
| `people.inviteSomeone` | her | Invite someone | none | 40 |
| `people.inviteStateAccepted` | her | {name} said yes. | `{name}` | 40 |
| `people.inviteStateDeclined` | her | {name} said no thanks. | `{name}` | 44 |
| `people.inviteStateExpired` | her | {name}'s link ran out. Make a new one to invite them again. | `{name}` | 118 |
| `people.inviteStatePending` | her | Waiting for {name} to say yes, until {when}. | `{name}` `{when}` | 88 |
| `people.inviteStateRevoked` | her | Withdrawn. The link doesn't work any more. | none | 84 |
| `people.invited` | her | Invitation made. | none | 40 |
| `people.keepsWords` | her | What they wrote stays theirs. | none | 58 |
| `people.lede` | her | The people who write, cook or take photos for {product}. Choose them under Who wrote it on any post. | `{product}` | 200 |
| `people.linkMade` | her | Send this link to {name} yourself. It works once, until {when}. {product} doesn't email it. | `{name}` `{when}` `{product}` | 240 |
| `people.loseCharge` | her | {name} won't be in charge of it any more. | `{name}` | 82 |
| `people.loseRun` | her | {name} won't be able to invite people or choose the layout. | `{name}` | 200 |
| `people.loseWrite` | her | {name} won't write a part any more. | `{name}` | 70 |
| `people.makeLink` | her | Make the invitation link | none | 48 |
| `people.nameTaken` | her | Someone already signs in with that name. Add a letter or number. | none | 128 |
| `people.needSignInName` | her | Type the name they sign in with. | none | 64 |
| `people.newLink` | her | Make a new link | none | 40 |
| `people.newLinkLabel` | her | Make a new link for {name} | `{name}` | 52 |
| `people.newLinkMade` | her | New link made. The old one doesn't work any more. | none | 98 |
| `people.newSignIn` | her | They're new: make them a sign-in | none | 64 |
| `people.newSignInHelp` | her | They choose their own password from the link. | none | 90 |
| `people.noAnswer` | her | Not saved yet. {product} didn't answer. Try again in a moment. | `{product}` | 124 |
| `people.noInvitations` | her | No invitations yet. | none | 40 |
| `people.noName` | her | {product} doesn't have your name yet. | `{product}` | 74 |
| `people.onlyNow` | her | You won't see this link again. If it's lost, make a new one. | none | 120 |
| `people.ownerOnly` | her | Only someone in charge can do that. | none | 70 |
| `people.readOnlyHelp` | her | Whoever runs it can invite people and change what they do. | none | 116 |
| `people.roleEditor` | her | Edits | none | 40 |
| `people.roleHelp` | her | Helping run it means inviting people and choosing the layout. Only someone with a sign-in to everything on {product} can publish it. | `{product}` | 240 |
| `people.roleInCharge` | her | In charge | none | 40 |
| `people.roleOther` | her | Something else | none | 40 |
| `people.roleReads` | her | Only reads | none | 40 |
| `people.roleRuns` | her | Helps run it | none | 40 |
| `people.roleWrites` | her | Writes a part | none | 40 |
| `people.roleWritesRuns` | her | Writes a part and helps run it | none | 60 |
| `people.sendLink` | her | Send it… | none | 40 |
| `people.sheetTitle` | her | People in {title} | `{title}` | 40 |
| `people.signInGone` | her | {name}'s sign-in or name on {product} was removed, so they can't open this. Invite them again. | `{name}` `{product}` | 240 |
| `people.signInName` | her | Sign-in name | none | 40 |
| `people.signInNameBad` | her | Use lowercase letters, numbers, dots or dashes, up to 32. | none | 114 |
| `people.signInNameHelp` | her | Lowercase letters and numbers. They'll use it to sign in. | none | 114 |
| `people.someoneNew` | her | Add someone to People | none | 42 |
| `people.stopAccess` | her | Stop their access… | none | 40 |
| `people.stopAsk` | her | Stop {name}'s access to {title}? | `{name}` `{title}` | 64 |
| `people.stopGo` | her | Stop their access | none | 40 |
| `people.stopKeep` | her | Keep them | none | 40 |
| `people.stopText` | her | They won't be able to open it, and any link they have stops working. Their name stays on what they wrote. You can invite them again. | none | 240 |
| `people.stopTextNothing` | her | They won't be able to open it, and any link they have stops working. They haven't written or agreed to anything here. You can invite them again. | none | 240 |
| `people.stopped` | her | {name} can't open it any more. Invite them again to bring them back. | `{name}` | 200 |
| `people.theLink` | her | The invitation link | none | 40 |
| `people.theirName` | her | Their name | none | 40 |
| `people.theirNameHelp` | her | From People. Someone who isn't there yet can be added first. | none | 120 |
| `people.usualName` | her | {product}'s usual name. | `{product}` | 46 |
| `people.whatTheyDo` | her | What they do | none | 40 |
| `people.withdraw` | her | Withdraw | none | 40 |
| `people.withdrawAsk` | her | Withdraw {name}'s invitation? | `{name}` | 58 |
| `people.withdrawKeep` | her | Keep it | none | 40 |
| `people.withdrawLabel` | her | Withdraw {name}'s invitation | `{name}` | 56 |
| `people.withdrawText` | her | The link stops working. | none | 46 |
| `people.withdrawn` | her | Withdrawn. The link doesn't work any more. | none | 84 |
| `photo.altHelp` | her | For people who can't see it, like “A red front door with a wreath”. | none | 134 |
| `picture.blueskyNoWords` | her | Bluesky shows it with no description. If the picture changes before it goes, the link goes without it. | none | 200 |
| `picture.blueskySmaller` | her | Made smaller to fit Bluesky. This is exactly what goes. | none | 110 |
| `picture.described` | her | Described as: {description} | `{description}` | 240 |
| `picture.facebookCheck` | her | If Facebook doesn't say whether it went, look at your Page before trying again. | none | 158 |
| `picture.for` | her | To {account} | `{account}` | 40 |
| `picture.ifNot` | her | If the picture can't go | none | 46 |
| `picture.ifNotStop` | her | Don't share it | none | 40 |
| `picture.ifNotText` | her | Share the link without it | none | 50 |
| `picture.lede` | her | The post's cover can go with the link. See exactly what goes, then choose. | none | 148 |
| `picture.none` | her | Your post has no cover with a description to send. | none | 100 |
| `picture.notYet` | her | Pictures can't go yet. {helper} can turn them on. | `{helper}` | 98 |
| `picture.send` | her | Send this picture to {account} | `{account}` | 60 |
| `picture.show` | her | Show the picture | none | 40 |
| `picture.showLabel` | her | Show the picture that goes to {account} | `{account}` | 78 |
| `picture.title` | her | The picture that goes with it | none | 58 |
| `picture.tooBig` | her | The cover is too big to send. Choose a smaller one for the post. | none | 128 |
| `picture.trouble` | her | The picture didn't load. Try again, or share without it. | none | 112 |
| `picture.wordsGo` | her | The description goes with it, for people who can't see it. | none | 116 |
| `place.atRow` | her | Place {n} | `{n}` | 40 |
| `place.canonical` | her | canonical place | none | 40 |
| `place.chapter` | her | chapter | none | 40 |
| `place.choose` | her | Choose a kind | none | 40 |
| `place.folio` | her | folio | none | 40 |
| `place.kind` | her | Kind of place | none | 40 |
| `place.kindRow` | her | Kind of place {n} | `{n}` | 40 |
| `place.line` | her | line | none | 40 |
| `place.page` | her | page | none | 40 |
| `place.section` | her | section | none | 40 |
| `place.takeOut` | her | Take out place {n} | `{n}` | 40 |
| `place.through` | her | to | none | 40 |
| `place.timestamp` | her | time | none | 40 |
| `place.toRow` | her | Place {n} ends at | `{n}` | 40 |
| `public.at` | her | At | none | 40 |
| `public.cantBuild` | her | What readers see can't be worked out right now: {product} doesn't build as it stands. Tell {helper}. | `{product}` `{helper}` | 200 |
| `public.checkAgain` | her | Check again | none | 40 |
| `public.checked` | her | Checked again. | none | 40 |
| `public.checksFailed` | her | The research checks didn't run. What readers see is still listed above. | none | 142 |
| `public.counts` | her | {shown} shown. {held} stay private. | `{shown}` `{held}` | 70 |
| `public.fieldAddress` | her | Address | none | 40 |
| `public.fieldAliases` | her | Other names | none | 40 |
| `public.fieldAspect` | her | Which date | none | 40 |
| `public.fieldBy` | her | Who wrote it | none | 40 |
| `public.fieldCorrespondence` | her | How the places correspond | none | 50 |
| `public.fieldCsl` | her | Full reference details | none | 44 |
| `public.fieldDate` | her | The date, as they state it | none | 52 |
| `public.fieldDates` | her | What it dates | none | 40 |
| `public.fieldDisputed` | her | Who disputes it | none | 40 |
| `public.fieldDoubt` | her | What's uncertain | none | 40 |
| `public.fieldEvidence` | her | The evidence | none | 40 |
| `public.fieldFirm` | her | How firmly | none | 40 |
| `public.fieldFirstYear` | her | First year | none | 40 |
| `public.fieldFrom` | her | From | none | 40 |
| `public.fieldIdentifiers` | her | Identifiers | none | 40 |
| `public.fieldIssued` | her | Date issued | none | 40 |
| `public.fieldKey` | her | Key | none | 40 |
| `public.fieldKind` | her | Kind | none | 40 |
| `public.fieldLanguage` | her | Language | none | 40 |
| `public.fieldLastYear` | her | Last year | none | 40 |
| `public.fieldName` | her | Name | none | 40 |
| `public.fieldNote` | her | Their note | none | 40 |
| `public.fieldOtherWay` | her | Read the other way | none | 40 |
| `public.fieldPeople` | her | People | none | 40 |
| `public.fieldPlacement` | her | How it's placed in time | none | 46 |
| `public.fieldReasoning` | her | The reasoning | none | 40 |
| `public.fieldRecordedBy` | her | Who recorded it | none | 40 |
| `public.fieldShown` | her | shown | none | 40 |
| `public.fieldStanding` | her | Whether it's disputed | none | 42 |
| `public.fieldSummary` | her | Summary | none | 40 |
| `public.fieldTitle` | her | Title | none | 40 |
| `public.fieldTo` | her | To | none | 40 |
| `public.fieldVersions` | her | The versions compared | none | 42 |
| `public.fieldWhere` | her | Where in the source | none | 40 |
| `public.fieldWho` | her | Who says so | none | 40 |
| `public.fieldWording` | her | The compared words (only where each version's rights allow) | none | 118 |
| `public.fieldWords` | her | The words | none | 40 |
| `public.fieldWork` | her | The work it stands for | none | 44 |
| `public.fromPost` | her | What readers will see from this post | none | 72 |
| `public.fromPostFailed` | her | What readers will see from this post couldn't be worked out just now. Check again in a moment. | none | 188 |
| `public.held` | her | Stays private ({count}) | `{count}` | 46 |
| `public.lede` | her | Nothing in your research is public because it exists. Each part shows only what you let readers see; everything else stays private, and says why. | none | 240 |
| `public.never` | her | Never shown | none | 40 |
| `public.neverText` | her | Your notebook, your notes and anything you haven't let readers see are never published. | none | 174 |
| `public.nothingShown` | her | Nothing shown from here. | none | 48 |
| `public.shownBadge` | her | Readers see this | none | 40 |
| `public.storeAtlas` | her | Atlas entries | none | 40 |
| `public.storeBlocked` | her | This part couldn't be checked. Tell {helper}. | `{helper}` | 90 |
| `public.storeChosen` | her | Chosen for readers | none | 40 |
| `public.storeClaims` | her | Claims and evidence | none | 40 |
| `public.storeComparisons` | her | Aligned passages | none | 40 |
| `public.storeDatings` | her | Datings | none | 40 |
| `public.storeInterpretations` | her | Readings side by side | none | 42 |
| `public.storeLinks` | her | Links to research pages | none | 46 |
| `public.storeOff` | her | {product} doesn't publish this part. {helper} can turn it on. | `{product}` `{helper}` | 122 |
| `public.storePaths` | her | Reading paths | none | 40 |
| `public.storeSources` | her | Sources your posts cite | none | 46 |
| `public.tab` | her | What readers see | none | 40 |
| `public.title` | her | What readers see from your research | none | 70 |
| `public.whyAddress` | her | Its web address isn't one readers should be given. | none | 100 |
| `public.whyContradiction` | her | Evidence against it is still private. | none | 74 |
| `public.whyDisagrees` | her | What would be published doesn't agree with itself, so it's left out. Tell {helper}. | `{helper}` | 166 |
| `public.whyGone` | her | What it chose isn't there any more. | none | 70 |
| `public.whyHeld` | her | It stays private. | none | 40 |
| `public.whyIdentifier` | her | That kind of identifier is never shown. | none | 78 |
| `public.whyLength` | her | The words are longer than a short quotation. | none | 88 |
| `public.whyLoop` | her | What it needs leads back to it. | none | 62 |
| `public.whyNeedsGone` | her | Something it needs isn't there. | none | 62 |
| `public.whyNeedsHeld` | her | Something it needs is held back. | none | 64 |
| `public.whyNoPost` | her | No published post, atlas or aligned passages show it yet. | none | 114 |
| `public.whyNotPublished` | her | It isn't in what {product} publishes. | `{product}` | 74 |
| `public.whyNotShown` | her | You haven't let readers see it. | none | 62 |
| `public.whyPageNotUp` | her | The page it links to isn't on {product} yet. | `{product}` | 88 |
| `public.whyPassage` | her | It points into your notebook. | none | 58 |
| `public.whyPostNotUp` | her | Its post isn't on {product} yet. | `{product}` | 64 |
| `public.whyRights` | her | The words are held back under their rights statement. | none | 106 |
| `public.whySiteOff` | her | {product} doesn't publish this yet. | `{product}` | 70 |
| `public.whyStale` | her | It changed after you chose it. Choose it again to show it as it is now. | none | 142 |
| `public.whyTooBig` | her | It's over a size limit, so it's left out. Tell {helper}. | `{helper}` | 112 |
| `public.whyUnsourced` | her | It's a draft with no evidence yet. | none | 68 |
| `public.whyWithdrawn` | her | You stopped showing it. | none | 46 |
| `public.whyWordsMoved` | her | The words it's about have changed. | none | 68 |
| `quotation.changeHelp` | her | The quoted words stay exactly as you kept them. Change them in your notebook. | none | 154 |
| `quote.backUnderNew` | her | {name} is back under New. | `{name}` | 50 |
| `quote.cantOpen` | her | {product} can't open your quote requests | `{product}` | 80 |
| `quote.eraseAsk` | her | Erase {name}'s request? | `{name}` | 46 |
| `quote.handled` | her | {name}: handled. | `{name}` | 40 |
| `quote.hostChose` | her | {helper} chose this, so it can't be changed here. | `{helper}` | 98 |
| `quote.tooOld` | her | Your requests service needs updating before {product} can clean up. | `{product}` | 134 |
| `quote.undone` | her | Undone. {name}'s request is back. | `{name}` | 66 |
| `read.agree` | her | Agree to publish this | none | 42 |
| `read.agreeAsk` | her | Agree to publish exactly what you just read? | none | 88 |
| `read.agreeAskText` | her | If anyone changes their words, you'll be asked again. | none | 106 |
| `read.agreeGo` | her | Agree | none | 40 |
| `read.agreeLabel` | her | Agree to publish {title} | `{title}` | 48 |
| `read.agreeNo` | her | Not yet | none | 40 |
| `read.agreeStale` | her | Someone changed their part since you agreed. Read it again, then agree. | none | 200 |
| `read.agreeUndone` | her | Your agreement is taken back. | none | 58 |
| `read.agreed` | her | Agreed. | none | 40 |
| `read.allAgreed` | her | Everyone has agreed to exactly this. | none | 72 |
| `read.alreadyAgreed` | her | You agreed to exactly this. | none | 54 |
| `read.changedSinceRead` | her | It changed after you read it. Open See it as readers will again, then agree. | none | 200 |
| `read.empty` | her | Nothing written yet. | none | 40 |
| `read.incomplete` | her | Not everyone's part can be read yet. | none | 72 |
| `read.lede` | her | Each part is shown just as its writer wrote it. | none | 94 |
| `read.lineAgreed` | her | {name} agreed | `{name}` | 40 |
| `read.lineEarlier` | her | {name} agreed to an earlier version | `{name}` | 70 |
| `read.lineNotNeeded` | her | {name}: their agreement isn't needed | `{name}` | 72 |
| `read.linePrivate` | her | {name}'s part isn't shared with you yet | `{name}` | 78 |
| `read.lineWaiting` | her | {name} hasn't agreed yet | `{name}` | 48 |
| `read.missing` | her | Not ready: {names} still need to agree. | `{names}` | 78 |
| `read.nameFirst` | her | Say how your name goes on it first. Then you can read the whole thing as readers will. | none | 200 |
| `read.namesFirst` | her | Everyone needs to say how their name goes on it first. | none | 108 |
| `read.notAllShared` | her | You can agree once everyone's part can be read. | none | 94 |
| `read.notShared` | her | Kept private until {name} is ready. | `{name}` | 70 |
| `read.notSharedYou` | her | Only you can read this until everyone's ready. | none | 92 |
| `read.previewNote` | her | As readers will see it. Not published. | none | 76 |
| `read.previewTitle` | her | {title}, as readers will see it. Not published. | `{title}` | 94 |
| `read.readFirst` | her | Open See it as readers will first, then agree. | none | 92 |
| `read.seeAsReaders` | her | See it as readers will | none | 44 |
| `read.title` | her | Everyone's parts | none | 40 |
| `read.yourPart` | her | Your part | none | 40 |
| `readers.aboutAnswer` | her | About this answer | none | 40 |
| `readers.aboutChanged` | her | That part has changed since they read it. | none | 82 |
| `readers.aboutGone` | her | No part by that author is on the post now. | none | 84 |
| `readers.aboutIdea` | her | About this idea | none | 40 |
| `readers.aboutOnePart` | her | About one part. | none | 40 |
| `readers.aboutOpening` | her | About the opening. | none | 40 |
| `readers.aboutReflection` | her | About this reflection | none | 42 |
| `readers.aboutSection` | her | About {author}'s part. | `{author}` | 44 |
| `readers.aboutWhole` | her | About the whole post. | none | 42 |
| `readers.ackNo` | her | Not now | none | 40 |
| `readers.ackOpen` | her | Open the post | none | 40 |
| `readers.ackText` | her | They wrote about words that have changed since. Read your post as it is now before you show this. | none | 194 |
| `readers.ackTitle` | her | Your post has changed there | none | 54 |
| `readers.ackYes` | her | Show it anyway | none | 40 |
| `readers.alreadyLinked` | her | They're already linked. | none | 46 |
| `readers.anonymous` | her | They didn't give a name. | none | 48 |
| `readers.answerAbout` | her | {author} wrote this as the author of the part the reflection is about. | `{author}` | 140 |
| `readers.answerAsEmpty` | her | Write your answer first. | none | 48 |
| `readers.answerAsGone` | her | The reflection changed or was taken down, so your answer wasn't sent. Your words are still here. | none | 192 |
| `readers.answerAsHelp` | her | It goes on the post under the reflection, as your answer, once a coordinator says yes. You can't say yes to your own. | none | 240 |
| `readers.answerAsHelpChanged` | her | Your part has changed since the reader read it, and your answer says so. It goes on the post under the reflection once a coordinator says yes. You can't say yes to your own. | none | 240 |
| `readers.answerAsLabel` | her | Answer as {author} | `{author}` | 40 |
| `readers.answerAsSend` | her | Send it for a yes | none | 40 |
| `readers.answerBack` | her | Your answer is back as it was. | none | 60 |
| `readers.answerByAuthor` | her | Written by the author of that part of the post. | none | 94 |
| `readers.answerChanged` | her | Your answer was changed somewhere else. Here it is now. | none | 110 |
| `readers.answerEmpty` | her | Write your answer first, or use Remove your answer. | none | 102 |
| `readers.answerHeading` | her | An answer to a reflection, from {author} | `{author}` | 80 |
| `readers.answerHelp` | her | Shown under their note on the post. Nothing is sent to them. | none | 120 |
| `readers.answerLabel` | her | Your answer under it | none | 40 |
| `readers.answerLong` | her | That's longer than {max} letters. | `{max}` | 66 |
| `readers.answerMine` | her | This is your own answer. | none | 48 |
| `readers.answerRemove` | her | Remove your answer | none | 40 |
| `readers.answerRemoved` | her | Your answer is off the post. | none | 56 |
| `readers.answerSave` | her | Save your answer | none | 40 |
| `readers.answerSaved` | her | Your answer is saved. | none | 42 |
| `readers.answerSectionChanged` | her | That part has changed or come off the post since the reader read it. | none | 136 |
| `readers.answerSectionMoved` | her | That part is still on the post, in another place. | none | 98 |
| `readers.answerSectionStands` | her | That part is still on the post as the reader read it. | none | 106 |
| `readers.answerSent` | her | Sent. It waits for a coordinator. Nothing is shown or sent by email. | none | 136 |
| `readers.askedText` | her | You asked them to explain this. It can't be shown; only their answer can. | none | 146 |
| `readers.auditAnswers` | her | {n} author's answers must come off their posts. | `{n}` | 94 |
| `readers.auditDone` | her | Done. The post is updated. | none | 52 |
| `readers.auditEntry` | her | “{title}” | `{title}` | 40 |
| `readers.auditFailed` | her | {product} couldn't check what's on your posts just now. | `{product}` | 110 |
| `readers.auditMustGo` | her | {n} reflections must come off their posts: the reader took them back, or no longer agrees. | `{n}` | 180 |
| `readers.auditName` | her | {n} reflections still show a name the reader has since hidden. | `{n}` | 124 |
| `readers.auditTruncated` | her | Only the first ones were checked. | none | 66 |
| `readers.auditUnknown` | her | {product} can't check {n} reflections right now. Read each, and take off any that shouldn't be up. | `{product}` `{n}` | 196 |
| `readers.btnAsk` | her | Ask them to explain | none | 40 |
| `readers.btnClose` | her | Close it | none | 40 |
| `readers.btnDecideAgain` | her | Decide again | none | 40 |
| `readers.btnDontShow` | her | Don't show | none | 40 |
| `readers.btnErase` | her | Erase it for good | none | 40 |
| `readers.btnKeepComment` | her | Keep the comment | none | 40 |
| `readers.btnKeepLater` | her | Keep it for later | none | 40 |
| `readers.btnNotNow` | her | Not for now | none | 40 |
| `readers.btnPutBack` | her | Put it back in Waiting | none | 44 |
| `readers.btnShow` | her | Show it | none | 40 |
| `readers.btnTakeDown` | her | Take it down | none | 40 |
| `readers.bulkDone` | her | {done} not shown. | `{done}` | 40 |
| `readers.bulkGroup` | her | Decide many at once | none | 40 |
| `readers.bulkHide` | her | Don't show {n} | `{n}` | 40 |
| `readers.bulkHideText` | her | Only you will see them, under Not shown. You can undo this. Pick one reason for all of them. | none | 184 |
| `readers.bulkHideTitle` | her | Don't show {n}? | `{n}` | 40 |
| `readers.bulkLineChanged` | her | This changed somewhere else, so it wasn't decided. | none | 100 |
| `readers.bulkLineFailed` | her | This one didn't go through. | none | 54 |
| `readers.bulkNone` | her | None of them went through. They're still here, marked. | none | 108 |
| `readers.bulkNotNow` | her | Not now | none | 40 |
| `readers.bulkNotThis` | her | Decide this one by itself. | none | 52 |
| `readers.bulkPartial` | her | {done} done. {failed} didn't go through; they're still here, marked. | `{done}` `{failed}` | 136 |
| `readers.bulkShow` | her | Show {n} | `{n}` | 40 |
| `readers.bulkShowText` | her | Everyone will be able to read them. | none | 70 |
| `readers.bulkShowTitle` | her | Show {n} on your posts? | `{n}` | 46 |
| `readers.bulkShowYes` | her | Show them | none | 40 |
| `readers.bulkShown` | her | {done} shown. | `{done}` | 40 |
| `readers.bulkUndoNote` | her | Not shown: {n}. | `{n}` | 40 |
| `readers.bulkUndone` | her | {n} are back in Waiting. | `{n}` | 48 |
| `readers.cancel` | her | Cancel | none | 40 |
| `readers.cardComment` | her | Comment from {name}{on} | `{name}` `{on}` | 46 |
| `readers.cardFailed` | her | That didn't go through. Nothing changed. Try again. | none | 102 |
| `readers.cardNote` | her | {kind} from {name}{on} | `{kind}` `{name}` `{on}` | 44 |
| `readers.cardOn` | her |  on {title} | `{title}` | 40 |
| `readers.cardReport` | her | Report from {name}{on} | `{name}` `{on}` | 44 |
| `readers.cardServiceDown` | her | That didn't go through: your comments service isn't answering. Nothing changed. Try again in a few minutes. | none | 214 |
| `readers.changeAdd` | her | Add the note | none | 40 |
| `readers.changeAdded` | her | Added to your post's list of changes. | none | 74 |
| `readers.changeBadClaim` | details | A claim id uses only lowercase letters, numbers and hyphens. | none | 120 |
| `readers.changeButton` | her | Note what changed | none | 40 |
| `readers.changeClaim` | details | Claim id (optional) | none | 40 |
| `readers.changeDay` | her | Day | none | 40 |
| `readers.changeEmpty` | her | Say what changed first. | none | 46 |
| `readers.changeHelp` | her | This adds a public note to your post's list of changes. It doesn't change your post; change the post itself in Write. Don't name or quote the reader. | none | 240 |
| `readers.changeLong` | her | Keep it under {max} letters. | `{max}` | 56 |
| `readers.changeTitle` | her | Note what changed in your post | none | 60 |
| `readers.changeWhat` | her | What changed | none | 40 |
| `readers.changedHere` | her | This changed somewhere else just now. Here it is as it is now. Choose again. | none | 152 |
| `readers.checkAddress` | details | The comments service address is set and uses https | none | 100 |
| `readers.checkAnswers` | details | The comments service answers | none | 56 |
| `readers.checkBuilt` | details | The site was built and sent out since the last change | none | 106 |
| `readers.checkKey` | details | A key is saved for this address, or set in the environment | none | 116 |
| `readers.checkNo` | details | No | none | 40 |
| `readers.checkRow` | details | {state}: {what} | `{state}` `{what}` | 40 |
| `readers.checkTables` | details | The service's tables are in place | none | 66 |
| `readers.checkUnknown` | details | Can't tell | none | 40 |
| `readers.checkVars` | details | The service's variables are set: {names} | `{names}` | 80 |
| `readers.checkYes` | details | Yes | none | 40 |
| `readers.chooseWhy` | her | Choose why first. | none | 40 |
| `readers.connAddress` | details | Service address | none | 40 |
| `readers.connAddressHelp` | details | An https address with nothing after a ? or #. | none | 90 |
| `readers.connBadAddress` | details | Use an https address with nothing after a ? or #. | none | 98 |
| `readers.connBadKey` | details | That key is empty or too long. | none | 60 |
| `readers.connCount` | details | Count visits with the comments service | none | 76 |
| `readers.connInsecure` | details | The server refused the key because the request didn't reach it over https. It wasn't saved. List the proxy in admin.trustedProxies (it must send X-Forwarded-Proto: https), or set the key in the server's environment. | none | 260 |
| `readers.connKeyEnv` | details | Set by {name}; the environment key takes precedence. | `{name}` | 104 |
| `readers.connKeyEnvOrigin` | details | Set {name} to this address's exact origin before the environment key can be used. | `{name}` | 162 |
| `readers.connKeyNone` | details | No key is saved. | none | 40 |
| `readers.connKeyOther` | details | The saved key belongs to another address. Enter the key again to bind it to this one. | none | 170 |
| `readers.connKeyPlaceholder` | details | Leave empty to keep the saved key | none | 66 |
| `readers.connKeyRemove` | details | Remove the saved key | none | 40 |
| `readers.connKeyReplace` | details | Replace the key | none | 40 |
| `readers.connKeySaved` | details | A key is saved for this address and never shown. | none | 96 |
| `readers.connNeedAddress` | details | Save an address before the key. | none | 62 |
| `readers.connNeedSiteKey` | details | Turnstile needs its public site key. | none | 72 |
| `readers.connRemoveText` | details | An environment key, if any, keeps working. | none | 84 |
| `readers.connRemoveTitle` | details | Remove the saved key? | none | 42 |
| `readers.connRobot` | details | Robot check | none | 40 |
| `readers.connRobotNote` | details | Secrets stay in the server's environment; only the public site key is saved here. | none | 162 |
| `readers.connRobotOff` | details | Off | none | 40 |
| `readers.connRobotTurnstile` | details | Cloudflare Turnstile | none | 40 |
| `readers.connSave` | details | Save connection | none | 40 |
| `readers.connSaved` | details | Saved. | none | 40 |
| `readers.connScope` | details | How often | none | 40 |
| `readers.connScopeEvery` | details | Before every comment | none | 40 |
| `readers.connScopeSession` | details | Once per visit | none | 40 |
| `readers.connSiteKey` | details | Public site key | none | 40 |
| `readers.connUse` | details | Use the comments service | none | 48 |
| `readers.consentName` | her | They agree to it being shown with their name. | none | 90 |
| `readers.consentNoName` | her | They agree to it being shown without their name. | none | 96 |
| `readers.consentWithdrawn` | her | They no longer agree to it being shown. | none | 78 |
| `readers.copiedIt` | her | Copied. | none | 40 |
| `readers.copyContactLabel` | her | Copy how to reach them | none | 44 |
| `readers.copyIt` | her | Copy | none | 40 |
| `readers.copyLinkLabel` | her | Copy their link | none | 40 |
| `readers.crumb` | her | Readers | none | 40 |
| `readers.decideAddressed` | her | Or the note that already dealt with it | none | 76 |
| `readers.decideButton` | her | Record what you decided | none | 46 |
| `readers.decideChanged` | her | Someone recorded a decision on this just now. Read it, then record yours. | none | 146 |
| `readers.decideChooseWhy` | her | Choose why | none | 40 |
| `readers.decideConfirm` | her | I've read that part of my post as it is now | none | 86 |
| `readers.decideDay` | her | Day | none | 40 |
| `readers.decideEvidence` | her | The evidence you recorded | none | 50 |
| `readers.decideExtent` | her | How much of it? | none | 40 |
| `readers.decideGo` | her | Record it | none | 40 |
| `readers.decideHelp` | her | This records what you concluded about your post. It doesn't change your post or show or hide their note. | none | 240 |
| `readers.decideNeedAddressed` | her | Choose the note that dealt with it, or name the one that did. | none | 122 |
| `readers.decideNeedConfirm` | her | Read that part of your post as it is now, then tick the box. | none | 120 |
| `readers.decideNeedEvidence` | her | Choose the evidence you recorded. | none | 66 |
| `readers.decideNeedExtent` | her | Say whether you used all of it or part of it. | none | 90 |
| `readers.decideNeedNote` | her | Choose the note that says what changed. Add it first if it isn't listed. | none | 144 |
| `readers.decideNeedOutcome` | her | Choose what you decided. | none | 48 |
| `readers.decideNeedWhy` | her | Choose why not. | none | 40 |
| `readers.decideNeedWords` | her | Say why, in your own words. | none | 54 |
| `readers.decideNeedWordsPart` | her | Say which part you used, and why not the rest. | none | 92 |
| `readers.decideNoEvidence` | her | None is recorded for this post yet. | none | 70 |
| `readers.decideNoNote` | her | No note | none | 40 |
| `readers.decideNoUndo` | her | To change it later, record a new decision. | none | 84 |
| `readers.decideNote` | her | The note about what changed | none | 54 |
| `readers.decideOpenEvidence` | her | Open Claims and evidence | none | 48 |
| `readers.decideSummary` | her | You're recording: {outcome}. | `{outcome}` | 56 |
| `readers.decideTitle` | her | Record what you decided | none | 46 |
| `readers.decideWhat` | her | What did you decide? | none | 40 |
| `readers.decideWhyNot` | her | Why not? | none | 40 |
| `readers.decideWords` | her | In your own words | none | 40 |
| `readers.decideWordsHelp` | her | Shown with your decision once their note is on the post. Don't name or quote the reader. | none | 176 |
| `readers.decided` | her | Recorded. Your post and their note didn't change. | none | 98 |
| `readers.decidedBefore` | her | What you decided before ({n}) | `{n}` | 58 |
| `readers.decidedDay` | her |  You decided {day}. | `{day}` | 40 |
| `readers.decidedElsewhere` | her | This was already decided somewhere else. | none | 80 |
| `readers.decidedKept` | her | Kept for later.{day} | `{day}` | 40 |
| `readers.decidedNotShown` | her | Not shown{why}.{day} | `{why}` `{day}` | 40 |
| `readers.decidedOnPost` | her | It shows on their note on the post. | none | 70 |
| `readers.decidedReportKept` | her | You kept the comment.{day} | `{day}` | 52 |
| `readers.decidedReportUpheld` | her | You agreed and took it down.{day} | `{day}` | 66 |
| `readers.decidedShown` | her | Shown.{day} | `{day}` | 40 |
| `readers.decidedTakenDown` | her | Taken down{why}.{day} | `{why}` `{day}` | 42 |
| `readers.detailsChecklist` | details | Setup checklist | none | 40 |
| `readers.detailsConnection` | details | Connection | none | 40 |
| `readers.detailsState` | details | state {state}{kind}, protocol {protocol}, invalid {invalid}, next {next} | `{state}` `{kind}` `{protocol}` `{invalid}` `{next}` | 144 |
| `readers.didAsked` | her | Asked. They'll see your question when they check their note. Nothing was shown or sent by email. | none | 192 |
| `readers.didBack` | her | Back in Waiting. | none | 40 |
| `readers.didClosed` | her | Closed. | none | 40 |
| `readers.didDone` | her | Done. | none | 40 |
| `readers.didErased` | her | Erased. Its words and the name are gone for good. | none | 98 |
| `readers.didKept` | her | Kept for later. Nothing was shown or sent. | none | 84 |
| `readers.didKeptComment` | her | Kept. It stays where it is. | none | 54 |
| `readers.didNotNow` | her | Not for now. Nothing was shown or sent. | none | 78 |
| `readers.didNotShown` | her | Not shown. Nobody else sees it. | none | 62 |
| `readers.didShownComment` | her | Shown under {where}. Readers can see it now. | `{where}` | 88 |
| `readers.didShownNote` | her | Shown on {where}. | `{where}` | 40 |
| `readers.didTakenDown` | her | Taken down from {where}. Readers don't see it any more. | `{where}` | 110 |
| `readers.didUpheld` | her | Taken down from {where}. To bring it back, find it under Taken down. | `{where}` | 136 |
| `readers.didUpheldGone` | her | It was already out of sight, so only the report is closed. | none | 116 |
| `readers.emptyAskedText` | her | When you ask a reader to explain, their note waits here for the answer. | none | 142 |
| `readers.emptyAskedTitle` | her | Nobody's been asked | none | 40 |
| `readers.emptyNotShownComments` | her | Comments you choose not to show stay here, out of sight, in case you change your mind. | none | 172 |
| `readers.emptyNotShownText` | her | What you choose not to show stays here, out of sight, in case you change your mind. | none | 166 |
| `readers.emptyNotShownTitle` | her | Nothing here | none | 40 |
| `readers.emptyOff` | her | Comments are switched off, so nobody can leave a new one. | none | 114 |
| `readers.emptyShownComments` | her | Comments you show appear under your posts, and here. | none | 104 |
| `readers.emptyShownText` | her | What you show appears under your posts, and here. | none | 98 |
| `readers.emptyShownTitle` | her | No notes up yet | none | 40 |
| `readers.emptyShownTitleComments` | her | No comments up yet | none | 40 |
| `readers.emptyTakenBackText` | her | If a reader takes back what they sent, it shows here. | none | 106 |
| `readers.emptyTakenBackTitle` | her | Nothing taken back | none | 40 |
| `readers.emptyTakenDownComments` | her | If you take a comment down, it waits here in case you want it back. | none | 134 |
| `readers.emptyTakenDownText` | her | If you take something down, it waits here in case you want it back. | none | 134 |
| `readers.emptyTakenDownTitle` | her | Nothing taken down | none | 40 |
| `readers.emptyWaitingComments` | her | When someone leaves a comment, it waits here for you to say yes. | none | 128 |
| `readers.emptyWaitingText` | her | When a reader sends something, it waits here for you to say yes. | none | 128 |
| `readers.emptyWaitingTitle` | her | Nothing waiting | none | 40 |
| `readers.eraseKeep` | her | Keep it | none | 40 |
| `readers.eraseText` | her | Its words and the name on it are deleted. Only a private note that you decided stays. This can't be undone. | none | 214 |
| `readers.eraseTitle` | her | Erase {name}'s {kind} for good? | `{name}` `{kind}` | 62 |
| `readers.eraseYes` | her | Erase it | none | 40 |
| `readers.erased` | her | Its words and any name were erased. Only your private record of decisions is kept. | none | 164 |
| `readers.evidenceCitation` | her | A source you cite that they question: {label} | `{label}` | 90 |
| `readers.evidenceClaim` | her | The claim: {label} | `{label}` | 40 |
| `readers.evidenceCompare` | her | What your post shows for {label} | `{label}` | 64 |
| `readers.evidenceGone` | her | Something they named isn't on this post any more. | none | 98 |
| `readers.evidenceHeading` | her | What they point to | none | 40 |
| `readers.evidenceLink` | her | What they question about it: {label} | `{label}` | 72 |
| `readers.evidenceNote` | her | Their own statement. Nothing checked it. | none | 80 |
| `readers.evidenceOpenClaim` | her | Open the claim in Claims and evidence | none | 74 |
| `readers.evidenceSource` | her | A source they offer: {label} | `{label}` | 56 |
| `readers.featureAgreed` | her | The reader agreed to have this text featured. | none | 90 |
| `readers.featureAlsoShows` | her | This also puts it with the post's reflections. | none | 92 |
| `readers.featureAuditHidden` | her | {n} featured reflections are hidden, because their post isn't published now. | `{n}` | 152 |
| `readers.featureAuditMustGo` | her | {n} featured reflections must come off their posts. | `{n}` | 102 |
| `readers.featureAuditUnknown` | her | {product} can't check {n} featured reflections right now. Read each, and take off any that shouldn't be up. | `{product}` `{n}` | 214 |
| `readers.featureButton` | her | Feature it on the post | none | 44 |
| `readers.featureEarlier` | her | They agreed for an earlier text, not this one. Only they can agree again. | none | 146 |
| `readers.featureGo` | her | Feature it | none | 40 |
| `readers.featureNo` | her | They haven't agreed, so it can't be featured. | none | 90 |
| `readers.featureNote` | her | Your note | none | 40 |
| `readers.featureNoteHelp` | her | Say why it's worth reading, in your own words. It can't say how many people liked or agreed with it. | none | 240 |
| `readers.featureNoteSaved` | her | Your note is saved. | none | 40 |
| `readers.featureOff` | her | Take the feature off | none | 40 |
| `readers.featureSaveNote` | her | Save your note | none | 40 |
| `readers.featureSee` | her | See how it shows | none | 40 |
| `readers.featureStandHidden` | her | It's hidden for now, because the post it's on isn't published. | none | 124 |
| `readers.featureStandMustGo` | her | It must come off the post now. | none | 60 |
| `readers.featureStandUnknown` | her | {product} can't tell whether it may stay. Read it, and take it off if it shouldn't be up. | `{product}` | 178 |
| `readers.featureStands` | her | It's featured, and the reader still agrees. | none | 86 |
| `readers.featureTakenOff` | her | The feature is off the post. The reflection stays. | none | 100 |
| `readers.featureTitle` | her | Feature this reflection | none | 46 |
| `readers.featured` | her | Featured on “{title}”. | `{title}` | 44 |
| `readers.featuredAgain` | her | Featured again. | none | 40 |
| `readers.findEveryKind` | her | Show every kind | none | 40 |
| `readers.findGroup` | her | Readers | none | 40 |
| `readers.findKind` | her | Show only {kind} | `{kind}` | 40 |
| `readers.findSwitchOff` | her | Turn comments off | none | 40 |
| `readers.findSwitchOn` | her | Turn comments on | none | 40 |
| `readers.findUndo` | her | Undo the last decision | none | 44 |
| `readers.fixAnswerButton` | her | Put the answer on the post | none | 52 |
| `readers.fixAnswerPublish` | her | Shown here, but the answer isn't on the post yet. | none | 98 |
| `readers.fixDecision` | her | The post shows an older decision. | none | 66 |
| `readers.fixDecisionButton` | her | Update the post | none | 40 |
| `readers.fixDone` | her | The post is updated. | none | 40 |
| `readers.fixFailed` | her | The post wasn't changed. Try again. | none | 70 |
| `readers.fixName` | her | They hid their name after it went up. Put it back up without the name. | none | 140 |
| `readers.fixNameButton` | her | Put it back without the name | none | 56 |
| `readers.fixPublish` | her | Shown here, but not on the post yet. | none | 72 |
| `readers.fixPublishButton` | her | Put it on the post | none | 40 |
| `readers.fixUndone` | her | The post is back as it was. | none | 54 |
| `readers.fixUnknown` | her | {product} can't tell whether this may stay up. Read it, and take it off if it shouldn't be there. | `{product}` | 194 |
| `readers.fixUnpublish` | her | Not shown here, but still on the post. | none | 76 |
| `readers.fixUnpublishButton` | her | Take it off the post | none | 40 |
| `readers.fixWithdrawn` | her | The reader took this back, but it's still on the post. Take it off now. | none | 142 |
| `readers.gone` | her | This one isn't there any more. | none | 60 |
| `readers.hintArticle` | her | About the article | none | 40 |
| `readers.hintCreators` | her | Who made it | none | 40 |
| `readers.hintNumber` | her | {scheme} (not checked) | `{scheme}` | 44 |
| `readers.hintPublisher` | her | Publisher | none | 40 |
| `readers.hintSeries` | her | About the series | none | 40 |
| `readers.hintTitle` | her | Title | none | 40 |
| `readers.hintYear` | her | Year | none | 40 |
| `readers.home` | her | Home | none | 40 |
| `readers.ideaContact` | her | They said you can reach them at: {contact} | `{contact}` | 84 |
| `readers.ideaContactHelp` | her | Only you see it. It's cleared after a while. {product} never emails it. | `{product}` | 142 |
| `readers.ideaCopied` | her | Copied to your research notes. Nothing was shown, fetched or sent. | none | 132 |
| `readers.ideaHint` | her | {label} (their words): {value} | `{label}` `{value}` | 60 |
| `readers.ideaKind` | her | {type} | `{type}` | 40 |
| `readers.ideaLinkButton` | her | Link to what you made | none | 42 |
| `readers.ideaLinkChoose` | her | Choose what you made | none | 40 |
| `readers.ideaLinkFull` | her | It's linked as many times as it can be. | none | 78 |
| `readers.ideaLinkGo` | her | Record the link | none | 40 |
| `readers.ideaLinkNeedWhat` | her | Choose what you made. | none | 42 |
| `readers.ideaLinkNeedWhich` | her | Choose which one you made. | none | 52 |
| `readers.ideaLinkTitle` | her | Link to what you made | none | 42 |
| `readers.ideaLinkWhat` | her | What you made | none | 40 |
| `readers.ideaLinkWhich` | her | Which one | none | 40 |
| `readers.ideaLinkWhichHelp` | her | The last part of its address, like apple-pie, or the name of a source in your library. | none | 172 |
| `readers.ideaLinked` | her | Recorded. Nothing was made, shown or sent. | none | 84 |
| `readers.ideaLinkedTo` | her | Linked to {what} on {day}. | `{what}` `{day}` | 52 |
| `readers.ideaMissing` | her | Still to find: {list}. | `{list}` | 44 |
| `readers.ideaOutcome` | her | You marked it: {label}. | `{label}` | 46 |
| `readers.ideaSourceDetails` | her | Their details about the source (not checked) | none | 88 |
| `readers.ideaStands` | her | It stands as: {label}. | `{label}` | 44 |
| `readers.invalid` | her | Some of what readers sent couldn't be shown here. | none | 98 |
| `readers.itemDecided` | her | That one was already decided. It's under {view}. | `{view}` | 96 |
| `readers.itemGone` | her | The one you tapped isn't there any more. It may have been erased. | none | 130 |
| `readers.itemHere` | her | The one you tapped: | none | 40 |
| `readers.keysHeading` | details | Keys on What readers sent | none | 50 |
| `readers.keysHelp` | details | Keys on a focused card: J and K move, S shows it, N doesn't show it, T takes it down, X selects it (with Select on), U undoes. | none | 240 |
| `readers.keysText` | details | With a card focused: J next, K previous, S show it, N don't show, T take it down, U undo. | none | 178 |
| `readers.kind.abuseReport` | her | Report | none | 40 |
| `readers.kind.alternativeInterpretation` | her | Another reading | none | 40 |
| `readers.kind.authorResponse` | her | Author's answer | none | 40 |
| `readers.kind.comment` | her | Comment | none | 40 |
| `readers.kind.correctionSuggestion` | her | Suggested correction | none | 40 |
| `readers.kind.futureSuggestion` | her | Idea for later | none | 40 |
| `readers.kind.question` | her | Question | none | 40 |
| `readers.kind.sourceSuggestion` | her | Suggested source | none | 40 |
| `readers.kind.thirdPerspective` | her | Reflection | none | 40 |
| `readers.kinds.abuseReport` | her | Reports | none | 40 |
| `readers.kinds.all` | her | Everything | none | 40 |
| `readers.kinds.alternativeInterpretation` | her | Other readings | none | 40 |
| `readers.kinds.authorResponse` | her | Authors' answers | none | 40 |
| `readers.kinds.comment` | her | Comments | none | 40 |
| `readers.kinds.correctionSuggestion` | her | Suggested corrections | none | 42 |
| `readers.kinds.futureSuggestion` | her | Ideas for later | none | 40 |
| `readers.kinds.question` | her | Questions | none | 40 |
| `readers.kinds.sourceSuggestion` | her | Suggested sources | none | 40 |
| `readers.kinds.thirdPerspective` | her | Reflections | none | 40 |
| `readers.leave` | her | Leave | none | 40 |
| `readers.leaveAnswerText` | her | What you wrote under a note isn't saved yet. | none | 88 |
| `readers.leaveAsk` | her | Leave without saving your answer? | none | 66 |
| `readers.leaveGo` | her | Leave without saving | none | 40 |
| `readers.leaveHeading` | her | Leave without saving what you typed? | none | 72 |
| `readers.leaveStay` | her | Stay | none | 40 |
| `readers.leaveText` | her | It isn't kept anywhere. | none | 46 |
| `readers.ledeAsked` | her | You asked these readers to say more. Their answer comes back here. What they first wrote can't be shown. | none | 208 |
| `readers.ledeNotShown` | her | You chose not to show these. Only you can see them. | none | 102 |
| `readers.ledeShown` | her | These are on your posts for everyone to read. | none | 90 |
| `readers.ledeShownPrivate` | her | Ideas you kept and reports you agreed with are here too, and are never shown. | none | 154 |
| `readers.ledeTakenBack` | her | Readers took these back, and their words were deleted. Nothing here can be changed. | none | 166 |
| `readers.ledeTakenDown` | her | These were shown, then you took them down. Only you can see them. | none | 130 |
| `readers.ledeWaiting` | her | New ones wait here until you choose. Nobody else sees them yet. | none | 126 |
| `readers.linkButton` | her | Link to a later post | none | 40 |
| `readers.linkChoose` | her | Choose a post | none | 40 |
| `readers.linkExisting` | her | Already linked to: {list} | `{list}` | 50 |
| `readers.linkFromHidden` | her | The earlier post isn't published now, so the link is hidden until it is. | none | 144 |
| `readers.linkGo` | her | Link them | none | 40 |
| `readers.linkHelp` | her | A plain link on both pages. It doesn't say the reader caused it or that anyone agrees, and shows none of their words. | none | 240 |
| `readers.linkLine` | her | “{from}” to “{to}”, {relation}, {day}. | `{from}` `{to}` `{relation}` `{day}` | 76 |
| `readers.linkNeedPost` | her | Choose the later post first. | none | 56 |
| `readers.linkNotApproved` | her | Its note isn't shown here any more, so the link is hidden. Check for taken-back notes, or remove it. | none | 200 |
| `readers.linkNotPublished` | her | That post isn't published yet. | none | 60 |
| `readers.linkNote` | her | Your note | none | 40 |
| `readers.linkNoteHelp` | her | Up to {max} letters, in your own words. | `{max}` | 78 |
| `readers.linkRelation` | her | How it relates | none | 40 |
| `readers.linkRemove` | her | Remove the link | none | 40 |
| `readers.linkSee` | her | See how it shows | none | 40 |
| `readers.linkShown` | her | It's shown on both pages. | none | 50 |
| `readers.linkTitle` | her | Link to a later post | none | 40 |
| `readers.linkTo` | her | Later post | none | 40 |
| `readers.linkToHidden` | her | The later post isn't published now, so the link is hidden until it is. | none | 140 |
| `readers.linkUnknown` | her | {product} couldn't tell whether its note still stands. The link is shown. | `{product}` | 146 |
| `readers.linked` | her | Linked. | none | 40 |
| `readers.linksButton` | her | Links to later posts | none | 40 |
| `readers.linksFailed` | her | The links to later posts didn't load. Nothing changed. | none | 108 |
| `readers.linksNone` | her | No links yet. Link a shown reflection, question or idea from its card. | none | 140 |
| `readers.linksNotUpdated` | her | Its links to later posts couldn't be taken off. Check Links to later posts. | none | 150 |
| `readers.linksSweep` | her | Check for taken-back notes | none | 52 |
| `readers.linksTitle` | her | Links to later posts | none | 40 |
| `readers.listFailed` | her | What readers sent didn't load. | none | 60 |
| `readers.listReset` | her | That list couldn't be shown, so here's Waiting. | none | 94 |
| `readers.listServiceDown` | her | Your comments service isn't answering right now, so {product} can't show what readers sent. Try again in a few minutes. | `{product}` | 238 |
| `readers.madeDraft` | her | a draft | none | 40 |
| `readers.madeSeries` | her | a collection | none | 40 |
| `readers.madeSource` | her | a source in your library | none | 48 |
| `readers.madeWork` | her | a post | none | 40 |
| `readers.menuCopied` | her | Link copied. | none | 40 |
| `readers.menuCopyLink` | her | Copy its link | none | 40 |
| `readers.menuCopyNotes` | her | Copy to your research notes | none | 54 |
| `readers.menuMore` | her | More | none | 40 |
| `readers.menuMoreFor` | her |  for {label} | `{label}` | 40 |
| `readers.menuSee` | her | See it on your site | none | 40 |
| `readers.nameIfShown` | her | They agree to show the name {name} if you show it. | `{name}` | 100 |
| `readers.nameMatches` | her | Their name matches an author of this post. It's never shown with a reflection. | none | 156 |
| `readers.nameOnlyOwner` | her | They gave a name only the site's owner can see. | none | 94 |
| `readers.namePrivate` | her | Their name stays private. | none | 50 |
| `readers.nameShown` | her | Shown with their name. | none | 44 |
| `readers.nav` | her | Readers | none | 40 |
| `readers.noPrompt` | her | They didn't choose a question to answer. | none | 80 |
| `readers.noSignal` | her | {product} can't reach your site right now. Nothing changed. Try again when you have a signal. | `{product}` | 186 |
| `readers.notChecked` | her | Nothing checked this link. | none | 52 |
| `readers.notOffered` | her | That can't be done to this one any more. | none | 80 |
| `readers.notReadyText` | her | {product} is set up for comments but can't reach them. | `{product}` | 108 |
| `readers.notReadyTitle` | her | Comments aren't ready yet | none | 50 |
| `readers.notSetUpText` | her | When readers can leave comments, what they send waits here for you. | none | 134 |
| `readers.notSetUpTitle` | her | Comments aren't set up | none | 44 |
| `readers.notYours` | her | Only the site's owner can decide this one. | none | 84 |
| `readers.noteRefused` | her | A note can't say how many people liked or agreed with something. Say why it's worth reading. | none | 184 |
| `readers.offText` | her | Your posts don't show any, and nobody can leave new ones. | none | 114 |
| `readers.offTitle` | her | Comments are switched off | none | 50 |
| `readers.oldAskText` | her | Their words and names are deleted for good. Your private record of what you decided is kept longer. | none | 198 |
| `readers.oldAskTitle` | her | Clear out {n} old notes? | `{n}` | 48 |
| `readers.oldChanged` | her | Something changed since you checked. Here's what's due now. | none | 118 |
| `readers.oldCheck` | her | Check what's due | none | 40 |
| `readers.oldClear` | her | Clear them out | none | 40 |
| `readers.oldCommentsKept` | her | Comments are kept until you decide, because no time limit is set for them. | none | 148 |
| `readers.oldDone` | her | Cleared out: {closed} closed, {deleted} deleted. | `{closed}` `{deleted}` | 96 |
| `readers.oldExpire` | her | {n} {kind} waiting longer than {days} days will close without a decision. | `{n}` `{kind}` `{days}` | 146 |
| `readers.oldFailed` | her | That didn't go through. Nothing was cleared out. Try again. | none | 118 |
| `readers.oldKeep` | her | Keep them | none | 40 |
| `readers.oldMore` | her | More are due than one go clears; check again after. | none | 102 |
| `readers.oldNone` | her | Nothing is due. Nothing would change now. | none | 82 |
| `readers.oldNotHere` | her | Only the site's owner can clear out old notes. | none | 92 |
| `readers.oldPurge` | her | {n} {kind} you didn't show will have their words and names deleted. | `{n}` `{kind}` | 134 |
| `readers.oldRecords` | her | {n} private records of what you decided are older than {days} days. | `{n}` `{days}` | 134 |
| `readers.oldScrub` | her | {n} {kind} will have their contact details cleared. | `{n}` `{kind}` | 102 |
| `readers.oldSkipped` | her | {n} had changed, so they were left. | `{n}` | 70 |
| `readers.on` | her | on “{title}” | `{title}` | 40 |
| `readers.onPost` | her | On the post. | none | 40 |
| `readers.onPostAnswer` | her | On the post, under the reflection, as the author's answer. | none | 116 |
| `readers.onPostReflection` | her | On the post, as a reader's reflection. | none | 76 |
| `readers.onSite` | her | on your site | none | 40 |
| `readers.onlyYou` | her | Only you see this name. | none | 46 |
| `readers.openIt` | her | Open | none | 40 |
| `readers.openLinkLabel` | her | Open their link, in a new tab | none | 58 |
| `readers.openPost` | her | “{title}” on your site, opens in a new tab | `{title}` | 84 |
| `readers.passageChanged` | her | Your post has changed there since they wrote. | none | 90 |
| `readers.passageLabel` | her | The words they wrote about: | none | 54 |
| `readers.passageMoved` | her | Your post still says this, in another place. | none | 88 |
| `readers.postGone` | her | No post has this address now. It may have moved or been taken off {product}. | `{product}` | 152 |
| `readers.postNotUpdated` | her | It's decided, but the post wasn't updated. Use the button on its card. | none | 140 |
| `readers.previewNoQuote` | her | On the post it shows without a quote, because that part changed. | none | 128 |
| `readers.previewPlain` | her | On the post it shows without a quote, from {name}. | `{name}` | 100 |
| `readers.previewQuote` | her | On the post it shows quoting “{quote}”, from {name}. | `{quote}` `{name}` | 104 |
| `readers.prompt` | her | They answered: “{question}” | `{question}` | 54 |
| `readers.readAll` | her | Read all | none | 40 |
| `readers.reason.abusive` | her | It's unkind | none | 40 |
| `readers.reason.duplicate` | her | They said it twice | none | 40 |
| `readers.reason.noAction` | her | It's fine | none | 40 |
| `readers.reason.offTopic` | her | It's not about this post | none | 48 |
| `readers.reason.other` | her | Another reason | none | 40 |
| `readers.reason.personalData` | her | It shares something private | none | 54 |
| `readers.reason.reportDuplicate` | her | It was already reported | none | 46 |
| `readers.reason.reportSpam` | her | The report is spam | none | 40 |
| `readers.reason.rights` | her | It copies someone else's work | none | 58 |
| `readers.reason.spam` | her | It's spam | none | 40 |
| `readers.reflectionPreview` | her | If you show it, it's titled “{heading}”. | `{heading}` | 80 |
| `readers.relRevisits` | her | The later post comes back to it | none | 62 |
| `readers.relTakesUp` | her | The later post takes it up | none | 52 |
| `readers.relUsesSource` | her | The later post uses the source they suggested | none | 90 |
| `readers.reportAnonymous` | her | Reports don't say who sent them. | none | 64 |
| `readers.reportGone` | her | What they reported is gone, so this only closes the report. | none | 118 |
| `readers.reportHeading` | her | A report about {what}, from {name} | `{what}` `{name}` | 68 |
| `readers.reportNow` | her | Right now it's {state}. | `{state}` | 46 |
| `readers.reportWhy` | her | Why: {ground} | `{ground}` | 40 |
| `readers.reportWrote` | her | Written by {name}{on}: | `{name}` `{on}` | 44 |
| `readers.roleContributor` | her | You can read this as one of its authors. A coordinator decides. | none | 126 |
| `readers.roleCoordinator` | her | You look after this as a coordinator of a shared post. Only the site's owner sees private names or decides again. | none | 226 |
| `readers.seeShown` | her | See what's shown | none | 40 |
| `readers.seeWaiting` | her | See what's waiting | none | 40 |
| `readers.select` | her | Select | none | 40 |
| `readers.selectAll` | her | Select all {m} | `{m}` | 40 |
| `readers.selectOne` | her | Select {label} | `{label}` | 40 |
| `readers.selected` | her | {n} selected | `{n}` | 40 |
| `readers.setupCantTell` | her | Comments are on, but {product} can't tell right now whether they're working. | `{product}` | 152 |
| `readers.setupChecking` | her | Checking that comments are working… | none | 70 |
| `readers.setupCommentsHeading` | her | Comments | none | 40 |
| `readers.setupConflict` | her | Your comment settings changed somewhere else. Here they are now; switch again if you still want to. | none | 198 |
| `readers.setupElseHeading` | her | What else readers can send | none | 52 |
| `readers.setupIsOff` | her | Comments are off. | none | 40 |
| `readers.setupIsOn` | her | Comments are on. | none | 40 |
| `readers.setupKeepOn` | her | Keep comments on | none | 40 |
| `readers.setupLink` | her | How readers reach you | none | 42 |
| `readers.setupNotSaved` | her | Your comment setting wasn't saved. Try again. | none | 90 |
| `readers.setupNotSetUp` | her | Comments aren't set up for {product}. | `{product}` | 74 |
| `readers.setupNotWorking` | her | Comments are on, but {product} can't reach them. | `{product}` | 96 |
| `readers.setupOff` | her | Comments are off. | none | 40 |
| `readers.setupOffText` | her | The comments section leaves your posts, and nobody can leave a new one. Nothing is deleted; you can turn them back on any time. | none | 240 |
| `readers.setupOffTitle` | her | Turn comments off? | none | 40 |
| `readers.setupOldHeading` | her | Old notes | none | 40 |
| `readers.setupOldLast` | her | Last cleared out {day}. | `{day}` | 46 |
| `readers.setupOldNever` | her | Nothing has been cleared out yet. | none | 66 |
| `readers.setupOldText` | her | Words readers sent that you didn't show are deleted after a while. {product} does it only when you say. | `{product}` | 206 |
| `readers.setupPerPost` | her | Each post can turn its own comments off in About this post. | none | 118 |
| `readers.setupRobots` | her | Readers answer a quick check before their first comment of a visit. | none | 134 |
| `readers.setupRobotsEvery` | her | Readers answer a quick check before every comment. | none | 100 |
| `readers.setupRobotsHeading` | her | Keeping robots out | none | 40 |
| `readers.setupSwitch` | her | Let readers leave comments | none | 52 |
| `readers.setupSwitchHelp` | her | When it's off, the comments section leaves your posts and nobody can leave a new one. | none | 170 |
| `readers.setupSwitchTrouble` | her | {product} couldn't check whether comments are on. | `{product}` | 98 |
| `readers.setupTitle` | her | How can readers write to you? | none | 58 |
| `readers.setupTurnOff` | her | Turn them off | none | 40 |
| `readers.setupWorking` | her | Comments are on and working. | none | 56 |
| `readers.showLess` | her | Show less | none | 40 |
| `readers.showMore` | her | Show more | none | 40 |
| `readers.showing` | her | Showing {n}. | `{n}` | 40 |
| `readers.similar` | her | Maybe about the same thing: | none | 54 |
| `readers.similarLink` | her | {kind}, {when} | `{kind}` `{when}` | 40 |
| `readers.someone` | her | Someone | none | 40 |
| `readers.stay` | her | Stay | none | 40 |
| `readers.sweepDropped` | her | {n} links to notes readers took back were removed. | `{n}` | 100 |
| `readers.sweepNone` | her | Every link's note still stands. | none | 62 |
| `readers.tabSent` | her | What readers sent | none | 40 |
| `readers.tabSetup` | her | How readers reach you | none | 42 |
| `readers.tabVisitors` | her | Visitors | none | 40 |
| `readers.tabsLabel` | her | Readers | none | 40 |
| `readers.theirLink` | her | Their link | none | 40 |
| `readers.theirWording` | her | Their wording | none | 40 |
| `readers.title` | her | What have readers sent you? | none | 54 |
| `readers.tryAgain` | her | Try again | none | 40 |
| `readers.turnOn` | her | Turn comments on | none | 40 |
| `readers.undo` | her | Undo | none | 40 |
| `readers.undoChanged` | her | It changed again since, so it wasn't undone. It's under {where}. | `{where}` | 128 |
| `readers.undoKept` | her | Kept: {label}. | `{label}` | 40 |
| `readers.undoNotShown` | her | Not shown: {label}. | `{label}` | 40 |
| `readers.undoTakenDown` | her | Taken down: {label}. | `{label}` | 40 |
| `readers.unlinked` | her | The link is off both pages. | none | 54 |
| `readers.viewAsked` | her | Asked to explain | none | 40 |
| `readers.viewNotShown` | her | Not shown | none | 40 |
| `readers.viewShown` | her | Shown | none | 40 |
| `readers.viewTakenBack` | her | Taken back | none | 40 |
| `readers.viewTakenDown` | her | Taken down | none | 40 |
| `readers.viewWaiting` | her | Waiting | none | 40 |
| `readers.what.answer` | her | an author's answer | none | 40 |
| `readers.what.comment` | her | a comment | none | 40 |
| `readers.what.note` | her | a note | none | 40 |
| `readers.what.reflection` | her | a reflection | none | 40 |
| `readers.whatKind` | her | What kind | none | 40 |
| `readers.whichOnes` | her | Which ones | none | 40 |
| `readers.whyFor` | her |  (choose why) for {label} | `{label}` | 50 |
| `readers.whyText` | her | Choose the reason that fits best. | none | 66 |
| `readers.whyTitle` | her | Why? | none | 40 |
| `readers.withdrawButton` | her | Take my answer back | none | 40 |
| `readers.withdrawGo` | her | Take it back | none | 40 |
| `readers.withdrawKeep` | her | Keep it | none | 40 |
| `readers.withdrawText` | her | It comes off the post for good, and its words are deleted soon after. | none | 138 |
| `readers.withdrawTitle` | her | Take your answer back? | none | 44 |
| `readers.withdrawn` | her | Taken back. It isn't shown anywhere. | none | 72 |
| `readings.about` | her | About | none | 40 |
| `readings.aboutWhole` | her | the whole comparison | none | 40 |
| `readings.addExplanation` | her | Add an explanation | none | 40 |
| `readings.addReading` | her | Add a reading | none | 40 |
| `readings.addRelation` | her | Add a relation | none | 40 |
| `readings.addressFixed` | her | Its address is {address}. It can't be changed. | `{address}` | 92 |
| `readings.addressHelp` | her | The last part of its web address. It can't be changed after the first save. | none | 150 |
| `readings.ai` | her | An AI tool drafted these words | none | 60 |
| `readings.aiTool` | her | Which tool | none | 40 |
| `readings.approvalDropped` | her | Saved. You changed words you'd approved in “{who}”, so readers won't see them until you approve them again. | `{who}` | 214 |
| `readings.approvalTextChanged` | her | The words changed since you read them. Nothing was approved. Read them again. | none | 154 |
| `readings.approvalWithdrawn` | her | Withdrew the approval. | none | 44 |
| `readings.approveMeans` | her | Approving says you read these words, checked them against the evidence and take responsibility for them. Readers see them labelled as drafted with AI. | none | 240 |
| `readings.approveThese` | her | Approve these words | none | 40 |
| `readings.approveTitle` | her | Approve these words? | none | 40 |
| `readings.approvedOn` | her | You approved these words on {date}. | `{date}` | 70 |
| `readings.approvedStatus` | her | Approved the words of “{who}”. | `{who}` | 60 |
| `readings.asWritten` | her | Show the comparison as written (for {helper}) | `{helper}` | 90 |
| `readings.back` | her | ‹ All comparisons of readings | none | 58 |
| `readings.cancel` | her | Cancel | none | 40 |
| `readings.certainty` | her | How firmly it's theirs | none | 44 |
| `readings.certaintyAttributed` | her | Attributed | none | 40 |
| `readings.certaintyDisputed` | her | Disputed | none | 40 |
| `readings.certaintyNone` | her | Not said | none | 40 |
| `readings.certaintyStated` | her | Stated | none | 40 |
| `readings.certaintyUncertain` | her | Uncertain | none | 40 |
| `readings.change` | her | Change | none | 40 |
| `readings.changedHeading` | her | Changed somewhere else | none | 44 |
| `readings.changedText` | her | This comparison was changed somewhere else while you had it open. Your changes are still here. Which do you want to keep? | none | 240 |
| `readings.checkEvidence` | her | Evidence to check (saving still works): | none | 78 |
| `readings.crumbHome` | her | Home | none | 40 |
| `readings.crumbResearch` | her | Research | none | 40 |
| `readings.delete` | her | Delete | none | 40 |
| `readings.deleteAsk` | her | Delete “{title}”? | `{title}` | 40 |
| `readings.deleteAskLive` | her | It's on your site now. Deleting takes it off. You can bring it back right after with Undo. | none | 180 |
| `readings.deleteAskText` | her | You can bring it back right after with Undo. | none | 88 |
| `readings.deleted` | her | Deleted “{title}”. | `{title}` | 40 |
| `readings.describe` | her | Describe them | none | 40 |
| `readings.describeHelp` | her | Like an anonymous twelfth-century commentator. | none | 92 |
| `readings.dismiss` | her | Dismiss | none | 40 |
| `readings.done` | her | Done | none | 40 |
| `readings.eChanged` | her | This comparison changed somewhere else since you opened it. Nothing was saved. | none | 156 |
| `readings.eExists` | her | A comparison already has that address. Choose another. | none | 108 |
| `readings.eGeneric` | her | That didn't work. Nothing was changed. | none | 76 |
| `readings.eMissing` | her | That comparison isn't there any more. | none | 74 |
| `readings.eNoApproval` | her | There's no approval to withdraw. | none | 64 |
| `readings.eNotAi` | her | Only words an AI tool drafted need approval. Words you wrote don't. | none | 134 |
| `readings.eSentence` | details | What the server said: | none | 42 |
| `readings.eStorage` | her | Your site couldn't keep it. Nothing was changed. | none | 96 |
| `readings.eTooLarge` | her | That's more than a comparison can hold. | none | 78 |
| `readings.eitherWay` | her | Either way round means the same. | none | 64 |
| `readings.emptyText` | her | Start from two readings of the same subject. | none | 88 |
| `readings.emptyTitle` | her | No comparisons of readings yet | none | 60 |
| `readings.evidenceAdd` | her | Add evidence | none | 40 |
| `readings.evidenceCount` | her | {count} evidence | `{count}` | 40 |
| `readings.evidenceFromReading` | her | An explanation uses only evidence its reading already cites. | none | 120 |
| `readings.evidenceHeading` | her | Evidence | none | 40 |
| `readings.evidenceLinks` | her | Evidence links | none | 40 |
| `readings.evidenceMissing` | her | Not in your library | none | 40 |
| `readings.evidenceNone` | her | No evidence yet | none | 40 |
| `readings.evidenceNoneYet` | her | No evidence yet. You can still save: say so under What's uncertain. | none | 134 |
| `readings.evidencePick` | her | Evidence to add | none | 40 |
| `readings.evidencePrivate` | her | In your research, private: readers won't see it | none | 94 |
| `readings.evidencePublic` | her | Readers can see this | none | 40 |
| `readings.evidenceSources` | her | Sources | none | 40 |
| `readings.evidenceTakeOut` | her | Take out this evidence | none | 44 |
| `readings.evidenceUnchecked` | her | Not checked: your research couldn't be read | none | 86 |
| `readings.evidenceWhere` | her | Where in the source | none | 40 |
| `readings.explanationLede` | her | An explanation adds to your words for one audience. It never replaces them. | none | 150 |
| `readings.explanationLine` | her | For {level} · about {about} | `{level}` `{about}` | 54 |
| `readings.explanationText` | her | The explanation | none | 40 |
| `readings.explanationsEmpty` | her | No explanations yet. They're optional. | none | 76 |
| `readings.explanationsHeading` | her | Explanations by audience | none | 48 |
| `readings.factAuthors` | her | By {authors} | `{authors}` | 40 |
| `readings.factBefore` | her | Before reading: {text} | `{text}` | 44 |
| `readings.factModes` | her | For {modes} reading | `{modes}` | 40 |
| `readings.factTranslates` | her | Translates {other} | `{other}` | 40 |
| `readings.factsLine` | her | Saved with the file, not changed here: {facts} | `{facts}` | 92 |
| `readings.fieldAddress` | her | Address | none | 40 |
| `readings.fieldSubject` | her | What the readings are about | none | 54 |
| `readings.fieldTitle` | her | Title | none | 40 |
| `readings.fileDetails` | details | Item id: {id} | `{id}` | 40 |
| `readings.findAddExplanation` | her | Add an explanation to this comparison | none | 74 |
| `readings.findAddReading` | her | Add a reading to this comparison | none | 64 |
| `readings.findAddRelation` | her | Add a relation between readings | none | 62 |
| `readings.findList` | her | Readings side by side | none | 42 |
| `readings.findMake` | her | New comparison of readings | none | 52 |
| `readings.findSave` | her | Save this comparison | none | 40 |
| `readings.forLevel` | her | For | none | 40 |
| `readings.goBack` | her | Go back | none | 40 |
| `readings.goTo` | her | Go to {title} | `{title}` | 40 |
| `readings.keepIt` | her | Keep it | none | 40 |
| `readings.language` | her | Language, if not the blog's | none | 54 |
| `readings.languageHelp` | her | A language tag such as en or grc. | none | 66 |
| `readings.leaveGo` | her | Leave without saving | none | 40 |
| `readings.leaveHeading` | her | Save this comparison? | none | 42 |
| `readings.leaveSave` | her | Save | none | 40 |
| `readings.leaveText` | her | You changed it and didn't save. | none | 62 |
| `readings.lede` | her | Set readings of one subject side by side, say who holds each, and never rule between them. | none | 180 |
| `readings.leftAttribution` | her | its source isn't public, so the reading is left out | none | 102 |
| `readings.leftAwaiting` | her | not approved | none | 40 |
| `readings.leftDetails` | details | Reason: {reason} | `{reason}` | 40 |
| `readings.leftDraft` | her | the comparison is a draft | none | 50 |
| `readings.leftEvidence` | her | some evidence is private and was left out | none | 82 |
| `readings.leftOutHeading` | her | Only you see this: what readers don't see | none | 82 |
| `readings.leftOutLine` | her | {name}: {why} | `{name}` `{why}` | 40 |
| `readings.leftStale` | her | changed after you approved it | none | 58 |
| `readings.leftSubject` | her | explains a reading readers don't see | none | 72 |
| `readings.leftTooFew` | her | fewer than two readings can be shown | none | 72 |
| `readings.leftWithdrawn` | her | withdrawn | none | 40 |
| `readings.levelBeginner` | her | Beginners | none | 40 |
| `readings.levelScholarly` | her | Scholars | none | 40 |
| `readings.levelStudent` | her | Students | none | 40 |
| `readings.loadFailed` | her | Your comparisons of readings didn't load. | none | 82 |
| `readings.make` | her | New comparison of readings | none | 52 |
| `readings.makeDraft` | her | Make it a draft again | none | 42 |
| `readings.markedAi` | her | Marked as drafted with AI. It needs your approval before readers see it. | none | 144 |
| `readings.markedOwn` | her | Marked as your own words. | none | 50 |
| `readings.more` | her | More | none | 40 |
| `readings.move` | her | Move | none | 40 |
| `readings.moveDown` | her | Move down | none | 40 |
| `readings.moveUp` | her | Move up | none | 40 |
| `readings.moved` | her | {title} is number {number} of {count} now. Not saved yet. | `{title}` `{number}` `{count}` | 114 |
| `readings.name` | her | Name | none | 40 |
| `readings.needTwo` | her | Two readings are needed to relate them. | none | 78 |
| `readings.newHeading` | her | New comparison of readings | none | 52 |
| `readings.notCompare` | her | To read versions of one passage side by side, use Compare. | none | 116 |
| `readings.notNow` | her | Not now | none | 40 |
| `readings.nothingChanged` | her | Nothing's changed. | none | 40 |
| `readings.open` | her | Open {title} | `{title}` | 40 |
| `readings.pAddress` | her | The address uses lowercase letters, numbers and single hyphens, up to 64 characters. | none | 168 |
| `readings.pApproval` | her | Approvals are only given by reading the words and pressing Approve. Saving can't add one. | none | 178 |
| `readings.pBadValue` | her | Something here isn't right. Check it and try again. | none | 102 |
| `readings.pDuplicate` | her | Another item has the same name inside the comparison. Take one out and add it again. | none | 168 |
| `readings.pEvidence` | her | An explanation uses only evidence its reading already cites. | none | 120 |
| `readings.pExplanation` | her | Write the explanation. | none | 44 |
| `readings.pJudgement` | her | That field only takes a few set choices. | none | 80 |
| `readings.pSelf` | her | A reading can't be related to itself. | none | 74 |
| `readings.pStatement` | her | Write what this reading holds. | none | 60 |
| `readings.pSubject` | her | Say what the readings are about. | none | 64 |
| `readings.pTitle` | her | Give the comparison a title. | none | 56 |
| `readings.pTooLong` | her | That's too long. | none | 40 |
| `readings.pTooMany` | her | A comparison can't hold more than that. | none | 78 |
| `readings.pTool` | her | Name the AI tool that drafted these words. | none | 84 |
| `readings.pUnknown` | her | That points at something that isn't there. Choose again. | none | 112 |
| `readings.pWho` | her | Say who held this reading, or choose Someone unknown and describe them. | none | 142 |
| `readings.previewClose` | her | Back to your comparison | none | 46 |
| `readings.previewDraft` | her | This is a draft. It shows what readers would see if you published it now. | none | 146 |
| `readings.previewEmpty` | her | Add readings to see it here. | none | 56 |
| `readings.previewFailed` | her | That didn't load. Try again. | none | 56 |
| `readings.previewHeading` | her | What readers will see | none | 42 |
| `readings.previewOnlyYou` | her | Only you see this page. Nothing is published by looking. | none | 112 |
| `readings.previewRefresh` | her | Looking at your latest changes… | none | 62 |
| `readings.previewUncertain` | her | Uncertain: {text} | `{text}` | 40 |
| `readings.previewWithheld` | her | Readers can't see this comparison yet: it needs two readings that are your own words or approved. | none | 194 |
| `readings.problemsHeading` | her | Not saved yet | none | 40 |
| `readings.problemsMany` | her | {count} things need a look first. | `{count}` | 66 |
| `readings.problemsOne` | her | One thing needs a look first. | none | 58 |
| `readings.provenanceAi` | her | Drafted with AI ({tool}), approved by the author | `{tool}` | 96 |
| `readings.provenanceOwn` | her | Written by the author | none | 42 |
| `readings.publish` | her | Publish | none | 40 |
| `readings.published` | her | Published. Readers see it at {url}, in about a minute. | `{url}` | 108 |
| `readings.publishedHidden` | her | Saved, but readers can't see it yet: two readings must be your own words or approved. | none | 170 |
| `readings.publishedSiteOff` | her | Saved as published, but your site isn't showing comparisons of readings yet. | none | 152 |
| `readings.readApprove` | her | Read and approve | none | 40 |
| `readings.readingsEmpty` | her | No readings yet. Add the first one, then another. | none | 98 |
| `readings.readingsHeading` | her | Readings | none | 40 |
| `readings.relAgrees` | her | Agrees with | none | 40 |
| `readings.relBuilds` | her | Builds on | none | 40 |
| `readings.relBy` | her | Relates by | none | 40 |
| `readings.relDiffers` | her | Differs from | none | 40 |
| `readings.relHelp` | her | No relation says which reading is right. | none | 80 |
| `readings.relNote` | her | A note, if it helps | none | 40 |
| `readings.relResponds` | her | Responds to | none | 40 |
| `readings.relThat` | her | That reading | none | 40 |
| `readings.relThis` | her | This reading | none | 40 |
| `readings.relationLine` | her | {from} · {kind} · {to} | `{from}` `{kind}` `{to}` | 44 |
| `readings.relationsEmpty` | her | No relations yet. They're optional. | none | 70 |
| `readings.relationsHeading` | her | How the readings relate | none | 46 |
| `readings.researchTrouble` | her | Your research couldn't be read, so evidence can't be checked right now. You can still write. | none | 184 |
| `readings.rowCounts` | her | Readings: {readings} · Explanations: {explanations} | `{readings}` `{explanations}` | 102 |
| `readings.rowDraft` | her | Draft | none | 40 |
| `readings.rowNotShown` | her | Not shown yet: two readings must be your own words or approved | none | 124 |
| `readings.rowShown` | her | On {product} | `{product}` | 40 |
| `readings.rowUnreadable` | her | Can't be read yet | none | 40 |
| `readings.saveDraft` | her | Save draft | none | 40 |
| `readings.saveFirstText` | her | You approve the words as saved. | none | 62 |
| `readings.saveFirstTitle` | her | Save first? | none | 40 |
| `readings.saveNow` | her | Save now | none | 40 |
| `readings.saved` | her | Saved. | none | 40 |
| `readings.savedDraft` | her | Saved as a draft. Readers don't see it. | none | 78 |
| `readings.savesWith` | her | Saves with the comparison. | none | 52 |
| `readings.seeReaders` | her | See what readers will see | none | 50 |
| `readings.sheetExplanation` | her | An explanation | none | 40 |
| `readings.sheetReading` | her | Reading: {who} | `{who}` | 40 |
| `readings.sheetRelation` | her | A relation | none | 40 |
| `readings.showTheirs` | her | Show the other version | none | 44 |
| `readings.siteOff` | her | {product} doesn't show comparisons of readings yet. Tell {helper}. | `{product}` `{helper}` | 132 |
| `readings.siteOffDetails` | details | The site's setting interpretations.publish is off. | none | 100 |
| `readings.someone` | her | Someone unknown | none | 40 |
| `readings.sourceChoose` | her | Choose a source | none | 40 |
| `readings.sourceGone` | her | That source isn't in your library. | none | 68 |
| `readings.sourceLabel` | her | Source | none | 40 |
| `readings.standingApproved` | her | Drafted with AI, approved by you | none | 64 |
| `readings.standingAuthored` | her | Your own words | none | 40 |
| `readings.standingAwaiting` | her | Drafted with AI: not approved, readers don't see it | none | 102 |
| `readings.standingStale` | her | Changed after you approved it: readers don't see it until you approve it again | none | 156 |
| `readings.standingUnknown` | her | Not checked yet | none | 40 |
| `readings.statement` | her | What this reading holds | none | 46 |
| `readings.subjectHelp` | her | Neutral words: say the subject, not which reading is right. | none | 118 |
| `readings.takeOut` | her | Take it out | none | 40 |
| `readings.theirsShown` | her | Here's the other version. | none | 50 |
| `readings.title` | her | Readings side by side | none | 42 |
| `readings.tookOutExplanation` | her | Took out the explanation for {level}. Not saved yet. | `{level}` | 104 |
| `readings.tookOutReading` | her | Took out “{who}” and the relations that named it. Not saved yet. | `{who}` | 128 |
| `readings.tryAgain` | her | Try again | none | 40 |
| `readings.uncertain` | her | What's uncertain | none | 40 |
| `readings.uncertainHelp` | her | Honest uncertainty is welcome, with or without evidence. | none | 112 |
| `readings.undo` | her | Undo | none | 40 |
| `readings.undoFailed` | her | That couldn't be put back, because it changed since. Open it again. | none | 134 |
| `readings.undone` | her | Put back as it was. | none | 40 |
| `readings.unreadable` | her | This comparison's file can't be read, so it can't be edited here. | none | 130 |
| `readings.unreadableDetails` | details | The first problem the server found: | none | 70 |
| `readings.untitled` | her | A comparison of readings | none | 48 |
| `readings.update` | her | Update | none | 40 |
| `readings.updated` | her | Updated. | none | 40 |
| `readings.useMine` | her | Use my changes | none | 40 |
| `readings.useMineSure` | her | Use your changes? | none | 40 |
| `readings.useMineSureText` | her | This replaces the other changes with what you have here. | none | 112 |
| `readings.useMineYes` | her | Yes, use my changes | none | 40 |
| `readings.waiting` | her | {count} AI drafts waiting for you to approve | `{count}` | 88 |
| `readings.waitingOne` | her | 1 AI draft is waiting for you to approve | none | 80 |
| `readings.wasDrafted` | her | It's a draft again. Readers don't see it. | none | 82 |
| `readings.who` | her | Who holds it | none | 40 |
| `readings.whoAnonymous` | her | Someone unknown | none | 40 |
| `readings.whoNamed` | her | A person, school or tradition | none | 58 |
| `readings.whoSource` | her | A source in your library | none | 48 |
| `readings.withdraw` | her | Withdraw approval | none | 40 |
| `readings.withdrawPublishedText` | her | A published comparison can't hold AI words nobody approved, so the whole comparison goes back to draft. | none | 206 |
| `readings.withdrawPublishedTitle` | her | Withdraw and make it a draft again? | none | 70 |
| `readings.withdrawPublishedYes` | her | Withdraw and make it a draft | none | 56 |
| `readings.withdrawn` | her | Withdrawn: readers don't see it. | none | 64 |
| `readings.writtenClose` | her | Close | none | 40 |
| `readings.writtenHeading` | details | The comparison as written | none | 50 |
| `readings.writtenHelp` | details | The file exactly as it is kept. Shown for {helper}; changes are made on the form. | `{helper}` | 162 |
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
| `recording.another` | her | Choose a different recording | none | 56 |
| `recording.cardLength` | her | {length} long | `{length}` | 40 |
| `recording.cardNoLength` | her | Say how long it is | none | 40 |
| `recording.change` | her | Change | none | 40 |
| `recording.changeLabel` | her | Change the recording | none | 40 |
| `recording.choose` | her | Choose a recording | none | 40 |
| `recording.chooseHint` | her | From this phone or computer, up to {max} MB. | `{max}` | 88 |
| `recording.chosenFile` | her | Chosen: {name} ({size} MB). | `{name}` `{size}` | 240 |
| `recording.chosenNote` | her | Chosen: your voice note. | none | 48 |
| `recording.file` | details | The file | none | 40 |
| `recording.goesPublic` | her | Once it's on {product}, anyone with its address can listen, even before you publish the post. | `{product}` | 200 |
| `recording.heard` | her | Here are the words. Read them over, then put them in your post. | none | 126 |
| `recording.heardPart` | her | Here are the words for the first part only. Read them over and add the rest. | none | 152 |
| `recording.lede` | her | Readers can listen to it on the post. It needs the words said, written out, for people who can't hear it. | none | 200 |
| `recording.length` | her | How long it is | none | 40 |
| `recording.lengthBad` | her | Write it as minutes and seconds, like 12:30. | none | 88 |
| `recording.lengthHelp` | her | Minutes and seconds, like 12:30. | none | 64 |
| `recording.listen` | her | Listen to the recording | none | 46 |
| `recording.menu` | her | Put a recording with it | none | 46 |
| `recording.needsSignal` | her | Putting it on {product} needs a signal. Try again when you have one. | `{product}` | 136 |
| `recording.notSent` | her | It didn't go on {product}. Try again, or tell {helper}. | `{product}` `{helper}` | 110 |
| `recording.notSound` | her | That isn't a recording {product} can play. Choose another. | `{product}` | 116 |
| `recording.noteGone` | her | That voice note isn't on {product} any more. Choose another. | `{product}` | 120 |
| `recording.noteLabel` | her | Voice note {n} ({size} MB) | `{n}` `{size}` | 52 |
| `recording.noteNone` | her | Choose one | none | 40 |
| `recording.notesLoading` | her | Looking for your voice notes… | none | 58 |
| `recording.notesNone` | her | No voice notes yet | none | 40 |
| `recording.now` | her | The recording now | none | 40 |
| `recording.partBad` | details | Line {line}: write the time, then the name, like 1:05 Making the dough. | `{line}` | 142 |
| `recording.partLink` | details | Line {line}: a link is an address on your site, starting with /, or https://. | `{line}` | 154 |
| `recording.partOrder` | details | Line {line}: each part starts after the one before. | `{line}` | 102 |
| `recording.partPastEnd` | details | Line {line}: it starts after the recording ends. | `{line}` | 96 |
| `recording.parts` | details | Parts of the recording | none | 44 |
| `recording.partsHelp` | details | One a line: when it starts and its name, like 1:05 Making the dough. Add \| and an address to link it. | none | 200 |
| `recording.putOn` | her | Put it on {product} | `{product}` | 40 |
| `recording.putOnDone` | her | It's on {product}. It goes with the post when the post is saved. | `{product}` | 128 |
| `recording.takeOff` | her | Take the recording off this post | none | 64 |
| `recording.title` | her | A recording to listen to | none | 48 |
| `recording.tooBig` | her | That recording is too big. Choose one up to 64 MB. | none | 100 |
| `recording.tooManyParts` | details | At most 10 parts here; write more in the file. | none | 92 |
| `recording.tookOff` | her | The recording comes off this post when it's saved. It stays on {product}. | `{product}` | 146 |
| `recording.turnIntoWords` | her | Turn it into words | none | 40 |
| `recording.voiceNote` | her | Or a voice note already on {product} | `{product}` | 72 |
| `recording.words` | her | The words said | none | 40 |
| `recording.wordsHelp` | her | Type or paste them. They go at the end of your post, where you can change them. | none | 200 |
| `recording.wordsIn` | her | The words said are in your post, under Transcript. Change them there. | none | 138 |
| `recording.wordsNeeded` | her | Write the words said first. | none | 54 |
| `recording.wordsPut` | her | The words said are at the end of your post, under Transcript. | none | 122 |
| `recording.wordsPutIn` | her | Put them in my post | none | 40 |
| `recording.wordsTitle` | her | Turn the recording into words | none | 58 |
| `recording.wordsWhy` | her | Before it can be published, write out what's said, so people who can't hear it can read it. | none | 200 |
| `reminders.lede` | her | At the right time of year, {product} suggests something your customers are wondering about. You choose: write it, wait, or skip it. Nothing here goes on your site by itself. | `{product}` | 240 |
| `reminders.nothing` | her | Nothing to write about for the next month. {product} will tell you when something comes up. | `{product}` | 182 |
| `reminders.stopsSuggesting` | her | {product} stops suggesting it. A draft you started from it stays. | `{product}` | 130 |
| `reminders.suggestsFrom` | her | {product} suggests “{name}” from {window}. | `{product}` `{name}` `{window}` | 84 |
| `reminders.topicsHelp` | her | Turn one off, or move when {product} suggests it. | `{product}` | 98 |
| `reminders.turnOn` | her | Turn them on and {product} suggests what to write for your trade, at the right time of year. It never publishes anything. | `{product}` | 240 |
| `reminders.wontSuggest` | her | {product} won't suggest “{topic}” any more. | `{product}` `{topic}` | 86 |
| `research.addFirst` | her | Add your first source | none | 42 |
| `research.backToPost` | her | Back to your post | none | 40 |
| `research.checkField` | her | Check this against the help under it. | none | 74 |
| `research.conflict` | her | Your {what} changed somewhere else, so nothing was saved. Your changes are still here. | `{what}` | 172 |
| `research.detailsCounts` | details | {active} kept, {archived} archived. | `{active}` `{archived}` | 70 |
| `research.detailsFile` | details | {file} · revision {revision} | `{file}` `{revision}` | 56 |
| `research.detailsRepair` | details | Repair it by hand, then reload. Nothing was changed. | none | 104 |
| `research.failed` | her | That didn't work. | none | 40 |
| `research.fill` | her | Fill this in. | none | 40 |
| `research.findStart` | details | Start research (for {helper}) | `{helper}` | 58 |
| `research.home` | her | Home | none | 40 |
| `research.keepMine` | her | Keep mine, on the newer one | none | 54 |
| `research.kept` | her | You have an unsaved {what}: “{name}”. | `{what}` `{name}` | 74 |
| `research.keptGo` | her | Go back to it | none | 40 |
| `research.keptHere` | her | Kept on this phone until you save it or close {product}. | `{product}` | 112 |
| `research.keptMany` | her | You have {count} unsaved changes in your research. | `{count}` | 100 |
| `research.keptMine` | her | Your changes now rest on the newer copy. Save again to keep them. | none | 130 |
| `research.leaveGo` | her | Leave them out | none | 40 |
| `research.leaveItOut` | her | Leave it out | none | 40 |
| `research.leaveStay` | her | Stay in research | none | 40 |
| `research.leaveText` | her | Your changes are kept while you move between research screens. Leaving research leaves them out. | none | 192 |
| `research.leaveTitle` | her | Leave your research with unsaved changes? | none | 82 |
| `research.ledeEmpty` | her | These steps take you from a source to a cited post. Everything before the post stays private. | none | 186 |
| `research.more` | her | More | none | 40 |
| `research.nav` | her | Research | none | 40 |
| `research.noSignal` | her | {product} can't reach your research right now. Nothing changed. Try again when you have a signal. | `{product}` | 194 |
| `research.notChecked` | her | Nothing checked this link. | none | 52 |
| `research.open` | her | Open | none | 40 |
| `research.openAtlas` | her | Open the atlas | none | 40 |
| `research.openCompare` | her | Compare versions | none | 40 |
| `research.openIt` | her | Open it | none | 40 |
| `research.openNotebook` | her | Open your notebook | none | 40 |
| `research.openPublic` | her | See what readers see | none | 40 |
| `research.openSources` | her | Open Sources | none | 40 |
| `research.optional` | her | Optional. | none | 40 |
| `research.private` | her | Private | none | 40 |
| `research.privateLine` | her | Everything here is private. A post shows a source only when it cites it; atlas entries, links, claims and aligned passages only when you approve them. | none | 240 |
| `research.readersSee` | her | Readers see this | none | 40 |
| `research.saving` | her | Saving… | none | 40 |
| `research.serverDown` | her | {product} didn't save that, so nothing changed. Your changes are still here. | `{product}` | 152 |
| `research.startPost` | her | Start a research post | none | 42 |
| `research.stepCite` | her | Cite it in a post | none | 40 |
| `research.stepCiteNoPost` | her | No post open yet. | none | 40 |
| `research.stepCitePost` | her | Your post: “{title}” | `{title}` | 40 |
| `research.stepCiteText` | her | In Write, choose Cite to point to a source and the place in it. Readers see only what you cite; your passages and notes stay private. | none | 240 |
| `research.stepPassage` | her | Keep a passage | none | 40 |
| `research.stepPassageDone` | her | {passages} passages and {notes} notes. | `{passages}` `{notes}` | 76 |
| `research.stepPassageNone` | her | Not started: no passages kept yet. | none | 68 |
| `research.stepPassageText` | her | Copy the exact words with where they are in the source, and keep your own notes and questions beside them. | none | 212 |
| `research.stepPublic` | her | Check what readers will see | none | 54 |
| `research.stepPublicText` | her | See exactly what your published posts, atlas and aligned passages show, and why everything else stays private. | none | 220 |
| `research.stepRelate` | her | Relate and compare | none | 40 |
| `research.stepRelateDone` | her | {entries} atlas entries and {alignments} alignments. | `{entries}` `{alignments}` | 104 |
| `research.stepRelateNone` | her | Nothing related yet. | none | 40 |
| `research.stepRelateText` | her | Note who says what about the people, works and ideas you study, and read versions of a passage side by side. | none | 216 |
| `research.stepSource` | her | Add a source | none | 40 |
| `research.stepSourceDone` | her | {count} sources in your library. | `{count}` | 64 |
| `research.stepSourceNone` | her | Not started: your library is empty. | none | 70 |
| `research.stepSourceText` | her | Record the work you read, then the edition, translation or manuscript you quote from. Each gets a key your citations use. | none | 240 |
| `research.tabAtlas` | her | Atlas | none | 40 |
| `research.tabCompare` | her | Compare | none | 40 |
| `research.tabNotebook` | her | Notebook | none | 40 |
| `research.tabOverview` | her | Overview | none | 40 |
| `research.tabPublic` | her | What readers see | none | 40 |
| `research.tabReadings` | her | Readings side by side | none | 42 |
| `research.tabSources` | her | Sources | none | 40 |
| `research.tabsLabel` | her | Part of your research | none | 42 |
| `research.title` | her | From a source to a cited post | none | 58 |
| `research.titleEmpty` | her | Start your research | none | 40 |
| `research.tooLarge` | her | That's too much for one save. Split it up. | none | 84 |
| `research.tooLong` | her | That's longer than {max} letters. | `{max}` | 66 |
| `research.tryAgain` | her | Try again | none | 40 |
| `research.undo` | her | Undo | none | 40 |
| `research.undoChanged` | her | It changed again since, so it wasn't undone. | none | 88 |
| `research.undoTaken` | her | Something else uses that key now, so it wasn't put back. | none | 112 |
| `research.undone` | her | Undone. | none | 40 |
| `research.unreadable` | her | Your {what} can't be read, so nothing here changed. | `{what}` | 102 |
| `research.useNewer` | her | Use the newer copy | none | 40 |
| `research.whatAlignments` | her | alignments | none | 40 |
| `research.whatAtlas` | her | atlas | none | 40 |
| `research.whatChoices` | her | choices for readers | none | 40 |
| `research.whatClaims` | her | claims | none | 40 |
| `research.whatLibrary` | her | source library | none | 40 |
| `research.whatNote` | her | note | none | 40 |
| `research.whatNotebook` | her | notebook | none | 40 |
| `research.whatPassage` | her | passage | none | 40 |
| `research.whatSource` | her | source | none | 40 |
| `restore.bringBack` | her | Bring them back | none | 40 |
| `restore.broughtBack` | her | Brought back. They aren't saved yet: look them over, then Save. | none | 126 |
| `restore.details` | details | Kept as {key}, last changed {when}. | `{key}` `{when}` | 70 |
| `restore.keep` | her | Keep them | none | 40 |
| `restore.oldHeading` | her | Bring back changes you didn't save? | none | 70 |
| `restore.oldText` | her | They were kept on this {noun} before {product}'s screens changed. | `{noun}` `{product}` | 130 |
| `restore.throwAsk` | her | Throw away the changes you didn't save? | none | 78 |
| `restore.throwAway` | her | Throw them away | none | 40 |
| `restore.throwText` | her | What's saved stays as it is. The changes can't come back after this. | none | 136 |
| `restore.thrown` | her | Thrown away. What's saved is unchanged. | none | 78 |
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
| `rights.openLicense` | her | Under an open licence, you say | none | 60 |
| `rights.ownWork` | her | Your own work, you say | none | 44 |
| `rights.permission` | her | The rights holder agreed, you say | none | 66 |
| `rights.publicDomain` | her | In the public domain, you say | none | 58 |
| `rights.reserved` | her | Under copyright, you say | none | 48 |
| `rights.unknown` | her | Not checked yet | none | 40 |
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
| `rules.agreeRule` | her | Agree to this rule | none | 40 |
| `rules.agreedRule` | her | You agreed to the new rule. | none | 54 |
| `rules.allAuthors` | her | Everyone writing | none | 40 |
| `rules.allAuthorsHelp` | her | Everyone who writes a part agrees, whether or not they've written yet. | none | 200 |
| `rules.allParticipants` | her | Everyone taking part | none | 40 |
| `rules.allParticipantsHelp` | her | Everyone in it agrees, including people who only read. Someone who only reads agrees once they can read all of it. | none | 200 |
| `rules.askChange` | her | Change whose agreement counts? | none | 60 |
| `rules.askChangeText` | her | Everyone who agreed will need to agree again. Nothing is shared or published by the change. | none | 200 |
| `rules.askGo` | her | Change it | none | 40 |
| `rules.askKeep` | her | Keep it | none | 40 |
| `rules.authorsWithRoles` | her | Everyone who wrote, and whoever does a job you choose | none | 120 |
| `rules.authorsWithRolesHelp` | her | Everyone doing what you choose below agrees too. | none | 96 |
| `rules.cantMeet` | her | It can't be met as things stand: {names} can't agree any more. | `{names}` | 200 |
| `rules.cantMeetRole` | her | It can't be met as things stand: nobody in it does a job it names. | none | 200 |
| `rules.choosePeople` | her | Who else agrees | none | 40 |
| `rules.chooseRoles` | her | Which jobs agree | none | 40 |
| `rules.contributingAuthors` | her | Everyone who wrote | none | 40 |
| `rules.contributingAuthorsHelp` | her | Only people who wrote something, or are named on something you say together, agree. | none | 200 |
| `rules.details` | details | The rule as stored: {rule} | `{rule}` | 240 |
| `rules.fixNamed` | her | Whoever is in charge can take them off the rule, or bring them back. | none | 136 |
| `rules.fixRole` | her | Whoever runs it can change the rule, or give someone that job. | none | 124 |
| `rules.howMany` | her | How many agree, at least | none | 48 |
| `rules.left` | her | {name} (isn't in it any more) | `{name}` | 58 |
| `rules.namedAuthors` | her | Everyone who wrote, and people you choose | none | 82 |
| `rules.namedAuthorsHelp` | her | The people you choose below agree too, even if they later leave. | none | 200 |
| `rules.needCount` | her | Write how many need to agree, like 3. | none | 74 |
| `rules.needPeople` | her | Choose at least one person who agrees. | none | 76 |
| `rules.needRoles` | her | Choose at least one job whose people agree. | none | 86 |
| `rules.never` | details | Never: each part stays private | none | 60 |
| `rules.neverHelp` | details | Nothing can be published together while this is chosen. | none | 110 |
| `rules.ownParts` | her | Their own part | none | 40 |
| `rules.ownPartsHelp` | her | Each person agrees to their own part and how it's all put together. | none | 134 |
| `rules.ownerOnlyDrop` | her | Only whoever is in charge can stop someone from having to agree. Nothing changed. | none | 200 |
| `rules.participantQuorum` | her | Everyone who wrote, and enough of everyone | none | 120 |
| `rules.participantQuorumHelp` | her | Everyone who wrote agrees, and at least the number you choose of everyone taking part. It doesn't go down if someone leaves. | none | 200 |
| `rules.proposalIs` | her | Suggested: {rule} | `{rule}` | 240 |
| `rules.proposalOld` | her | It no longer fits, because people or jobs changed since. Whoever runs it can suggest it again. | none | 200 |
| `rules.proposalTitle` | her | A new rule was suggested | none | 48 |
| `rules.proposalWaiting` | her | Waiting for {names} to agree to it. | `{names}` | 70 |
| `rules.proposalYouAgreed` | her | You agreed to it. | none | 40 |
| `rules.published` | her | It's on {product}, so its rules stay as they were. | `{product}` | 100 |
| `rules.quorum` | her | Everyone who wrote, and enough of the writers | none | 120 |
| `rules.quorumHelp` | her | Everyone who wrote agrees, and at least the number you choose of the people writing. It doesn't go down if someone leaves. | none | 200 |
| `rules.readOnly` | her | Whoever runs it chooses the rules. | none | 68 |
| `rules.roleInCharge` | her | In charge | none | 40 |
| `rules.roleRuns` | her | Helps run it | none | 40 |
| `rules.roleWrites` | her | Writes a part | none | 40 |
| `rules.ruleChanged` | her | Everyone agreed, so the new rule is in place. Agreements given before need giving again. | none | 200 |
| `rules.save` | her | Save the rules | none | 40 |
| `rules.saved` | her | Rules saved. Agreements given before need giving again. | none | 110 |
| `rules.scope` | her | What each agreement covers | none | 52 |
| `rules.seeRule` | her | See the rule | none | 40 |
| `rules.sharingTitle` | her | When you read each other's parts | none | 64 |
| `rules.sheetTitle` | her | Rules for {title} | `{title}` | 40 |
| `rules.suggested` | her | Suggested. It changes once everyone taking part agrees to it. | none | 122 |
| `rules.takeBack` | her | Take back my agreement to it | none | 56 |
| `rules.title` | her | Rules | none | 40 |
| `rules.tookBack` | her | You took back your agreement to the new rule. | none | 90 |
| `rules.whole` | her | The whole thing | none | 40 |
| `rules.wholeHelp` | her | Each person agrees to everyone's parts, so any change asks everyone again. | none | 148 |
| `rules.wholeOnly` | her | Each person agrees to the whole thing, so any change asks everyone again. | none | 200 |
| `rules.whoseAgreement` | her | Whose agreement counts | none | 44 |
| `share.couldntRead` | her | {product} couldn't read that | `{product}` | 56 |
| `share.couldntTell` | her | {product} couldn't tell whether it posted. Look at the account it was going to. Is it there? | `{product}` | 184 |
| `share.jobNotFound` | her | {product} couldn't find this job. It may have been deleted or renamed. | `{product}` | 140 |
| `share.noReply` | her | {product} didn't hear back. Look under Sharing in a minute before posting again. | `{product}` | 160 |
| `share.previewMissing` | her | {product} couldn't show this just now. It will still share as you wrote it. | `{product}` | 150 |
| `share.ranOut` | her | {product} ran out of time and will try again. | `{product}` | 90 |
| `share.slowDown` | her | {name} asked {product} to slow down. | `{name}` `{product}` | 72 |
| `share.stoppedEarly` | her | {product} stopped before it heard back. | `{product}` | 78 |
| `share.stoppedTaking` | her | {name} stopped taking posts from {product}. Reconnect it, {same}. | `{name}` `{product}` `{same}` | 130 |
| `share.tellOrSkip` | her | Tell {helper}, or choose Don't share it. | `{helper}` | 80 |
| `share.unreadable` | her | {product} couldn't read what went to {label}, so it isn't here. | `{product}` `{label}` | 126 |
| `share.wentOutUnsure` | her | {product} couldn't tell whether it went out. Look at the account. | `{product}` | 130 |
| `social.accountsLede` | her | Where {product} can post for you. It posts only when you share a post. | `{product}` | 140 |
| `social.already` | her | {name} is already connected. Use Reconnect on it if it stopped working. | `{name}` | 142 |
| `social.canTurnOn` | her | {helper} can turn it on. Your site works the same without it. | `{helper}` | 122 |
| `social.cantPostHere` | her | {product} can't post here. | `{product}` | 52 |
| `social.connected` | her | Connected. {product} can post to {name} on {service} now. | `{product}` `{name}` `{service}` | 114 |
| `social.connectedFacebook` | her | Connected. {product} can post to {name} on {service} now. To add another Facebook Page, connect Facebook again. | `{product}` `{name}` `{service}` | 240 |
| `social.connectedIt` | her | Connected. {product} can post to it on {service} now. | `{product}` `{service}` | 106 |
| `social.connectionGone` | her | {product} couldn't find that connection. If your account isn't listed, connect it again. | `{product}` | 176 |
| `social.couldntOpen` | her | {product} couldn't open {name}. | `{product}` `{name}` | 62 |
| `social.disconnectAsk` | her | Disconnect {name}? | `{name}` | 40 |
| `social.disconnected` | her | Disconnected {name}. | `{name}` | 40 |
| `social.facebookNoPage` | her | Facebook didn't show any Page you can post to. You need to run the Page. If you do, ask {helper} to add you to its Facebook app. | `{helper}` | 240 |
| `social.finishing` | her | {product} is finishing up. This takes a few seconds. | `{product}` | 104 |
| `social.forgets` | her | {product} forgets how to post to it. You can connect it again later. | `{product}` | 136 |
| `social.gone` | her | {name} isn't connected any more. Connect it again. | `{name}` | 100 |
| `social.noPlaces` | her | {helper} needs to add Facebook or another place first. | `{helper}` | 108 |
| `social.orgsTruncated` | her | LinkedIn sent only some of your company pages. If yours isn't here, tell {helper}. | `{helper}` | 164 |
| `social.pagesTruncated` | her | Facebook sent only some of your Pages. If yours isn't here, tell {helper}. | `{helper}` | 148 |
| `social.reconnectTitle` | her | Reconnect {name} | `{name}` | 40 |
| `social.reconnected` | her | Reconnected. {name} works again. | `{name}` | 64 |
| `social.reconnectedIt` | her | Reconnected. It works again. | none | 56 |
| `social.roleUnverified` | her | Facebook didn't say what you can do on this Page, so {product} can't use it. | `{product}` | 152 |
| `social.saidYes` | her | {name} said yes. {product} is finishing up. | `{name}` `{product}` | 86 |
| `social.scopesMissing` | her | {name} didn't allow everything {product} needs to post. Try again and leave every box ticked. | `{name}` `{product}` | 186 |
| `social.sendsYouBack` | her | {product} sends you to {where}. Sign in there and say yes; you come back here to finish. | `{product}` `{where}` | 176 |
| `social.sendsYouTo` | her | {product} sends you to {name}. Sign in there and say yes; {name} sends you back here to {pick}. | `{product}` `{name}` `{pick}` | 190 |
| `social.signInAgain` | her | {service} will ask you to sign in. Use the {service} account you used the first time. If {service} shows someone else's name, tell {helper}. | `{service}` `{helper}` | 240 |
| `social.slowDown` | her | {name} asked {product} to slow down. Wait a few minutes, then try again. | `{name}` `{product}` | 144 |
| `sources.add` | her | Add a source | none | 40 |
| `sources.addId` | her | Add an identifier | none | 40 |
| `sources.addIt` | her | Add the source | none | 40 |
| `sources.addPerson` | her | Add a person | none | 40 |
| `sources.added` | her | Source added. | none | 40 |
| `sources.addedHelp` | her | To set it aside, archive it. | none | 56 |
| `sources.allArchived` | her | Every source is archived. Show archived ones to open one. | none | 114 |
| `sources.anonymousAndNamed` | her | It's marked as anonymous but names a person. {helper} can fix that in the library. | `{helper}` | 164 |
| `sources.archive` | her | Archive this source | none | 40 |
| `sources.archived` | her | Archived. Posts that cite it still show it. | none | 86 |
| `sources.archivedBadge` | her | Archived | none | 40 |
| `sources.backToList` | her | ‹ Your sources | none | 40 |
| `sources.badId` | her | That {kind} doesn't look right. Check it against the book or page. | `{kind}` | 132 |
| `sources.badKey` | her | Use lowercase letters, numbers and dashes. | none | 84 |
| `sources.badKind` | her | Choose one of these types. | none | 52 |
| `sources.badOf` | her | Choose a source it can belong to. | none | 66 |
| `sources.basedOn` | her | Translated from (optional) | none | 52 |
| `sources.basedOnHelp` | her | An edition, witness or translation it was made from. | none | 104 |
| `sources.choose` | her | Choose a source | none | 40 |
| `sources.citedIn` | her | Cited in {count} posts: | `{count}` | 46 |
| `sources.close` | her | Close | none | 40 |
| `sources.conflict` | her | Your library changed somewhere else, so nothing was saved. Your changes are still here. | none | 174 |
| `sources.copyKey` | her | Copy its key | none | 40 |
| `sources.count` | her | {shown} of {total} shown. | `{shown}` `{total}` | 50 |
| `sources.cycle` | her | That would make the source a form of itself. | none | 88 |
| `sources.dependents` | her | {count} other sources point at this one. They keep working while it's archived. | `{count}` | 158 |
| `sources.detailsRecord` | details | The record as stored | none | 40 |
| `sources.detailsRights` | details | Rights statements and interpretations are edited in the library file. | none | 138 |
| `sources.dropGo` | her | Leave them out | none | 40 |
| `sources.dropStay` | her | Keep editing | none | 40 |
| `sources.dropTitle` | her | Leave out your changes to this source? | none | 76 |
| `sources.emptyText` | her | Add a work first, then the editions, translations, manuscripts and places in them that you quote from. | none | 204 |
| `sources.emptyTitle` | her | Your library is empty | none | 42 |
| `sources.exportBib` | her | BibTeX | none | 40 |
| `sources.exportBibHelp` | her | For LaTeX. | none | 40 |
| `sources.exportCsl` | her | CSL JSON | none | 40 |
| `sources.exportCslHelp` | her | For Zotero and most reference managers. | none | 78 |
| `sources.exportDo` | her | Export | none | 40 |
| `sources.exportFormat` | her | Kind of file | none | 40 |
| `sources.exportHelp` | her | Includes archived sources. The file is saved where your downloads go. | none | 138 |
| `sources.exportLoss` | her | It can't carry: {list}. | `{list}` | 46 |
| `sources.exportOpen` | her | Export your library… | none | 40 |
| `sources.exportTitle` | her | Export your library | none | 40 |
| `sources.exported` | her | Saved {filename}: {count} sources. | `{filename}` `{count}` | 68 |
| `sources.find` | her | Find a source | none | 40 |
| `sources.findHelp` | her | Title, person, key or identifier. | none | 66 |
| `sources.goneElsewhere` | her | This source was taken out somewhere else. | none | 82 |
| `sources.idKind` | her | Kind of identifier {n} | `{n}` | 44 |
| `sources.idOther` | her | Other | none | 40 |
| `sources.idTakeOut` | her | Take out identifier {n} | `{n}` | 46 |
| `sources.idUrl` | her | Web address | none | 40 |
| `sources.idValue` | her | Identifier {n} | `{n}` | 40 |
| `sources.ids` | her | Identifiers (optional) | none | 44 |
| `sources.idsHelp` | her | A DOI, ISBN or web address. Nothing looks them up. | none | 100 |
| `sources.importAgain` | her | The text changed. Check it again. | none | 66 |
| `sources.importBlocked` | her | Fix the items that can't be imported in your reference manager, then try again. Nothing was imported. | none | 202 |
| `sources.importChanged` | her | Your library changed while you were checking. Check again. | none | 116 |
| `sources.importChanges` | her | Changes {field} | `{field}` | 40 |
| `sources.importCheck` | her | Check what it would do | none | 44 |
| `sources.importChecking` | her | Checking… | none | 40 |
| `sources.importConflicts` | her | {count} can't be imported | `{count}` | 50 |
| `sources.importDo` | her | Import {count} | `{count}` | 40 |
| `sources.importFile` | her | CSL JSON file | none | 40 |
| `sources.importFrom` | her | from {cslId} | `{cslId}` | 40 |
| `sources.importGroupBlocked` | her | Can't be imported | none | 40 |
| `sources.importGroupNew` | her | New | none | 40 |
| `sources.importGroupUpdated` | her | Updated | none | 40 |
| `sources.importItem` | her | Item {n} | `{n}` | 40 |
| `sources.importKeeps` | her | Keeps {fields} as you wrote them | `{fields}` | 64 |
| `sources.importLede` | her | From Zotero, Mendeley or another reference manager: export your items as CSL JSON, then choose the file here or paste it. Importing adds and updates sources, never removes any, and keeps details you already wrote. | none | 240 |
| `sources.importLoss` | her | Not kept: {field}: {reason} | `{field}` `{reason}` | 54 |
| `sources.importMore` | her | Show more | none | 40 |
| `sources.importNeed` | her | Choose a file or paste the items first. | none | 78 |
| `sources.importNew` | her | {count} new | `{count}` | 40 |
| `sources.importNotJson` | her | That file isn't CSL JSON. Export it again from your reference manager. | none | 140 |
| `sources.importNothing` | her | Everything is already in your library. | none | 76 |
| `sources.importOpen` | her | Import sources… | none | 40 |
| `sources.importPaste` | her | Or paste it | none | 40 |
| `sources.importProblem` | her | Can't be imported: {problem} | `{problem}` | 56 |
| `sources.importSame` | her | {count} already here | `{count}` | 40 |
| `sources.importSummary` | her | {parts}. | `{parts}` | 40 |
| `sources.importTitle` | her | Import sources | none | 40 |
| `sources.importTooBig` | her | That file is bigger than 3 MB. Export fewer items at a time. | none | 120 |
| `sources.importUpdated` | her | {count} updated | `{count}` | 40 |
| `sources.importWhyKind` | her | it's a different kind of source from the one with that name in your library. | none | 152 |
| `sources.importWhyMissing` | her | something it needs is missing. | none | 60 |
| `sources.importWhyName` | her | its name can't be used for a source. | none | 72 |
| `sources.importWhyTwice` | her | it's in the file twice, or has the same name as another source. | none | 126 |
| `sources.importWhyUnknownKind` | her | it's a kind of source your library doesn't know. | none | 96 |
| `sources.importWhyUnusable` | her | something in it can't be used. | none | 60 |
| `sources.importWhyWho` | her | who made it doesn't match the source with that name in your library. | none | 136 |
| `sources.imported` | her | Imported: {summary} | `{summary}` | 40 |
| `sources.issued` | her | Date (optional) | none | 40 |
| `sources.issuedHelp` | her | Kept as you write it, like 1992 or c. 375 BCE. | none | 92 |
| `sources.keepMine` | her | Keep mine, on the newer library | none | 62 |
| `sources.keptMine` | her | Your changes now sit on the newer library. Check them, then save. | none | 130 |
| `sources.key` | her | Key | none | 40 |
| `sources.keyCopied` | her | Key copied. | none | 40 |
| `sources.keyFixed` | her | Your citations use this key, so it stays. | none | 82 |
| `sources.keyHelp` | her | The short name your citations use, like plato-republic. Lowercase letters, numbers and dashes. It can't change later. | none | 234 |
| `sources.keyTaken` | her | Another source has that key. Choose another. | none | 88 |
| `sources.kindEdition` | her | Edition | none | 40 |
| `sources.kindEditionHelp` | her | A published form of a work or a translation. | none | 88 |
| `sources.kindEditions` | her | Editions | none | 40 |
| `sources.kindReference` | her | Reference | none | 40 |
| `sources.kindReferenceHelp` | her | A place in one of your sources. | none | 62 |
| `sources.kindReferences` | her | References | none | 40 |
| `sources.kindSource` | her | source | none | 40 |
| `sources.kindTranslation` | her | Translation | none | 40 |
| `sources.kindTranslationHelp` | her | A work in another language. | none | 54 |
| `sources.kindTranslations` | her | Translations | none | 40 |
| `sources.kindWitness` | her | Witness | none | 40 |
| `sources.kindWitnessHelp` | her | A manuscript, recording or other surviving copy. | none | 96 |
| `sources.kindWitnesses` | her | Witnesses | none | 40 |
| `sources.kindWork` | her | Work | none | 40 |
| `sources.kindWorkHelp` | her | A creation, apart from any copy of it. | none | 76 |
| `sources.kindWorks` | her | Works | none | 40 |
| `sources.language` | her | Language | none | 40 |
| `sources.languageHelp` | her | Like English or Ancient Greek. | none | 60 |
| `sources.leaveMine` | her | Leave my changes out | none | 40 |
| `sources.needTitle` | her | Give the source a title. | none | 48 |
| `sources.needVolume` | her | Name the volume: pages restart in each one. | none | 86 |
| `sources.neverMind` | her | Never mind | none | 40 |
| `sources.newHeading` | her | A new source | none | 40 |
| `sources.noMatch` | her | No sources match. Clear the search or choose another type. | none | 116 |
| `sources.none` | her | None | none | 40 |
| `sources.notCredit` | her | People who made a source can't be people credited on your posts. | none | 128 |
| `sources.of` | her | It's a form of | none | 40 |
| `sources.ofReference` | her | It points at | none | 40 |
| `sources.optional` | her | {label} (optional) | `{label}` | 40 |
| `sources.people` | her | People who made it (optional) | none | 58 |
| `sources.peopleHelp` | her | Who wrote, edited or translated it. They aren't the people credited on your posts. | none | 164 |
| `sources.personName` | her | Name of person {n} | `{n}` | 40 |
| `sources.personRole` | her | Role for person {n} | `{n}` | 40 |
| `sources.personTakeOut` | her | Take out person {n} | `{n}` | 40 |
| `sources.place` | her | Place | none | 40 |
| `sources.placeHelp` | her | Like 514a, 12r or 1:02:30. | none | 52 |
| `sources.rebuildFailed` | her | Saved, but published aligned passages didn't update. Tell {helper}. | `{helper}` | 134 |
| `sources.restore` | her | Restore | none | 40 |
| `sources.restored` | her | Restored. | none | 40 |
| `sources.rights` | her | Rights: {label} | `{label}` | 40 |
| `sources.rightsHelp` | her | Your own statement; it doesn't mean you may use the words. {helper} can change it. | `{helper}` | 164 |
| `sources.roleAuthor` | her | Author | none | 40 |
| `sources.roleCompiler` | her | Compiler | none | 40 |
| `sources.roleEditor` | her | Editor | none | 40 |
| `sources.roleNone` | her | No role | none | 40 |
| `sources.roleOther` | her | Other | none | 40 |
| `sources.roleScribe` | her | Scribe | none | 40 |
| `sources.roleTranslator` | her | Translator | none | 40 |
| `sources.save` | her | Save changes | none | 40 |
| `sources.saved` | her | Saved. | none | 40 |
| `sources.show` | her | Show | none | 40 |
| `sources.showActive` | her | Active | none | 40 |
| `sources.showArchived` | her | Archived | none | 40 |
| `sources.showBoth` | her | Active and archived | none | 40 |
| `sources.stillUsed` | her | Your notebook or atlas still points at this source, so it can't change that way. | none | 160 |
| `sources.title` | her | Your sources | none | 40 |
| `sources.titleField` | her | Title | none | 40 |
| `sources.type` | her | Type | none | 40 |
| `sources.typeAll` | her | All types | none | 40 |
| `sources.typeFilter` | her | Type | none | 40 |
| `sources.typeFixed` | her | A source keeps its type. Add another source for another type. | none | 122 |
| `sources.untitled` | her | Untitled {kind} ({key}) | `{kind}` `{key}` | 46 |
| `sources.useNewer` | her | Use the newer copy | none | 40 |
| `sources.usedIn` | her | Your notebook has {passages} passages and {notes} notes from it. | `{passages}` `{notes}` | 128 |
| `sources.volume` | her | Volume (optional) | none | 40 |
| `sources.volumeHelp` | her | Pages restart in each volume, so name it, like 2. | none | 98 |
| `sources.where` | her | Where in it | none | 40 |
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
| `talk.add` | her | Say something together | none | 44 |
| `talk.added` | her | Added. Everyone it speaks for agrees to it. | none | 86 |
| `talk.agree` | her | Agree to this | none | 40 |
| `talk.agreeLabel` | her | Agree to “{words}” | `{words}` | 40 |
| `talk.agreed` | her | Agreed. | none | 40 |
| `talk.cancel` | her | Cancel | none | 40 |
| `talk.cantWrite` | her | Only people who write a part say things together here. | none | 108 |
| `talk.clearsAgreement` | her | Anything added or changed here asks the people it speaks for to agree again. | none | 200 |
| `talk.edit` | her | Change the words | none | 40 |
| `talk.editSave` | her | Save the change | none | 40 |
| `talk.edited` | her | Changed. Everyone it speaks for agrees again. | none | 90 |
| `talk.empty` | her | Nothing said together yet. It's optional. | none | 82 |
| `talk.find` | her | What we say together: {title} | `{title}` | 58 |
| `talk.hideIdeas` | her | Hide the questions | none | 40 |
| `talk.itemLine` | her | {kind}, for {speaking}. Agreed by {agreed}. Waiting for {waiting}. | `{kind}` `{speaking}` `{agreed}` `{waiting}` | 240 |
| `talk.kindAgreement` | her | Agreement | none | 40 |
| `talk.kindApplication` | her | Something to try | none | 40 |
| `talk.kindDifference` | her | Difference | none | 40 |
| `talk.kindOther` | her | Something said | none | 40 |
| `talk.kindQuestion` | her | Question | none | 40 |
| `talk.kindUncertainty` | her | Not sure | none | 40 |
| `talk.lede` | her | After everyone's parts, what you say together: where you agree, where you differ, what you still wonder. Each one speaks for the people named on it, and each of them agrees to it. | none | 240 |
| `talk.moveDown` | her | Move down | none | 40 |
| `talk.moveUp` | her | Move up | none | 40 |
| `talk.moved` | her | Moved. | none | 40 |
| `talk.needWords` | her | Write what you say together. | none | 56 |
| `talk.noOne` | her | no one | none | 40 |
| `talk.noOneYet` | her | no one yet | none | 40 |
| `talk.promptAgreement` | her | Where did we land in the same place? | none | 72 |
| `talk.promptApplication` | her | What could a reader try or do with this? | none | 80 |
| `talk.promptDifference` | her | Where do we see it differently, and why? | none | 80 |
| `talk.promptQuestion` | her | What are we still wondering about? | none | 68 |
| `talk.promptUncertainty` | her | What are we not sure about? | none | 54 |
| `talk.save` | her | Add it | none | 40 |
| `talk.showIdeas` | her | Show the questions | none | 40 |
| `talk.speaksFor` | her | Who it speaks for, besides you | none | 60 |
| `talk.takeMyName` | her | Take my name off | none | 40 |
| `talk.title` | her | What we say together | none | 40 |
| `talk.tookMyName` | her | Your name is off it. | none | 40 |
| `talk.useIdea` | her | Use this question | none | 40 |
| `talk.what` | her | What kind | none | 40 |
| `talk.words` | her | The words | none | 40 |
| `talk.wordsHelp` | her | Any length. Plain words; it's shown as you write it. | none | 104 |
| `talk.youAgreed` | her | You agreed to this. | none | 40 |
| `thing.abstract` | her | Abstract | none | 40 |
| `thing.button` | her | Button | none | 40 |
| `thing.caution` | her | Caution | none | 40 |
| `thing.checklist` | her | Checklist | none | 40 |
| `thing.code` | details | Code | none | 40 |
| `thing.codepen` | details | A CodePen | none | 40 |
| `thing.compare` | her | Before and after photos | none | 46 |
| `thing.contact` | her | How to reach you | none | 40 |
| `thing.demo` | her | A lesson demo | none | 40 |
| `thing.diagram` | details | A diagram | none | 40 |
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
| `together.accessChanged` | her | Your access to this changed. | none | 56 |
| `together.addAnother` | her | Add another | none | 40 |
| `together.addMyName` | her | Your name isn't in People yet. | none | 60 |
| `together.addMyNameButton` | her | Add my name | none | 40 |
| `together.alreadyPublished` | her | It's already on {product}. Nothing changed. | `{product}` | 86 |
| `together.and` | her | and | none | 40 |
| `together.backTo` | her | ‹ {title} | `{title}` | 40 |
| `together.backToList` | her | Writing together | none | 40 |
| `together.badIsbn` | her | An ISBN has 10 or 13 digits. | none | 56 |
| `together.badLink` | her | A full web address, starting with https://. | none | 86 |
| `together.broughtBack` | her | It's back. | none | 40 |
| `together.cancel` | her | Cancel | none | 40 |
| `together.cantBuild` | her | {product} couldn't put it together as it stands. Nothing changed. | `{product}` | 200 |
| `together.cardName` | her | {title}: {badge}. {step} | `{title}` `{badge}` `{step}` | 48 |
| `together.changedElsewhere` | her | {what} was changed by someone else. Here it is now; choose again. | `{what}` | 200 |
| `together.copiedWords` | her | Your words are copied. | none | 44 |
| `together.copyMyWords` | her | Copy my words | none | 40 |
| `together.detailFile` | details | File | none | 40 |
| `together.detailId` | details | Id | none | 40 |
| `together.detailRoles` | details | Roles as stored | none | 40 |
| `together.detailSharing` | details | Sharing as stored | none | 40 |
| `together.detailState` | details | State | none | 40 |
| `together.detailsLine` | details | {id}: {state}; roles {roles}; sharing {policy}; {n} invitations waiting; {file} | `{id}` `{state}` `{roles}` `{policy}` `{n}` `{file}` | 240 |
| `together.doBringBack` | her | Bring it back | none | 40 |
| `together.doChange` | her | Change | none | 40 |
| `together.doInvite` | her | Invite someone | none | 40 |
| `together.doName` | her | Your name on it | none | 40 |
| `together.doOpen` | her | Open it | none | 40 |
| `together.doPublish` | her | Publish | none | 40 |
| `together.doRead` | her | Read everyone's parts | none | 42 |
| `together.doShare` | her | Let the others read it | none | 44 |
| `together.doUnschedule` | her | Don't publish it then | none | 42 |
| `together.doWrite` | her | Write your part | none | 40 |
| `together.empty` | her | Start from something you watched, read or heard, and invite people to answer the same question. | none | 200 |
| `together.emptyGuest` | her | You're not writing anything with others right now. If someone sends you a link, open it to join. | none | 200 |
| `together.emptyPublished` | her | Nothing written together is on {product} yet. | `{product}` | 90 |
| `together.emptyPutAway` | her | Nothing is put away. | none | 40 |
| `together.emptyTitle` | her | Nothing written together yet | none | 56 |
| `together.everyone` | her | Everyone | none | 40 |
| `together.failed` | her | That didn't work, and nothing changed. | none | 76 |
| `together.findDetails` | details | Details of writing together | none | 54 |
| `together.findInvite` | her | Invite someone to {title} | `{title}` | 50 |
| `together.findPart` | her | Your part: {title} | `{title}` | 40 |
| `together.findPeople` | her | People in {title} | `{title}` | 40 |
| `together.findRead` | her | Everyone's parts: {title} | `{title}` | 50 |
| `together.footer` | her | Nothing goes on {product} until everyone agrees. | `{product}` | 96 |
| `together.gone` | her | You're not part of this any more. | none | 66 |
| `together.home` | her | Home | none | 40 |
| `together.invitedCount` | her | {n} invitations waiting for an answer. | `{n}` | 76 |
| `together.invitedRow` | her | Waiting for {name} to say yes, until {when}. | `{name}` `{when}` | 88 |
| `together.isbn` | her | ISBN | none | 40 |
| `together.isbnHelp` | her | 10 or 13 digits; dashes are fine. | none | 66 |
| `together.kindArticle` | her | An article | none | 40 |
| `together.kindBook` | her | A book | none | 40 |
| `together.kindExampleArticle` | her | Like an essay in a magazine | none | 54 |
| `together.kindExampleBook` | her | Like a novel you all read | none | 50 |
| `together.kindExampleOther` | her | Like a conversation or a walk | none | 58 |
| `together.kindExamplePodcast` | her | Like one episode | none | 40 |
| `together.kindExampleVideo` | her | Like a talk you watched | none | 46 |
| `together.kindOther` | her | Something else | none | 40 |
| `together.kindPodcast` | her | A podcast | none | 40 |
| `together.kindVideo` | her | A video | none | 40 |
| `together.layoutOld` | her | The layout names a part someone took out. Whoever runs it needs to fix the layout. | none | 200 |
| `together.leaveAsk` | her | Leave without starting it? | none | 52 |
| `together.leaveGo` | her | Leave | none | 40 |
| `together.leaveStay` | her | Stay | none | 40 |
| `together.leaveText` | her | What you typed here isn't kept. | none | 62 |
| `together.lede` | her | Write with other people, each in your own words, about something you all watched, read or heard. Nothing goes on {product} until everyone agrees. | `{product}` | 240 |
| `together.listFailed` | her | Writing together didn't open. Check your connection and try again. | none | 132 |
| `together.madeBy` | her | Made by | none | 40 |
| `together.more` | her | More | none | 40 |
| `together.moreAbout` | her | More about it | none | 40 |
| `together.name` | her | A name for it | none | 40 |
| `together.nameHelp` | her | You need a question, a name, or both. | none | 74 |
| `together.nav` | her | Writing together | none | 40 |
| `together.needQuestion` | her | Write the question you each answer, or a name for it. | none | 106 |
| `together.needSource` | her | Say what started it. | none | 40 |
| `together.needSourceTitle` | her | Give it a name, like the title of the video. | none | 88 |
| `together.needYourName` | her | Choose your name. | none | 40 |
| `together.needsSignal` | her | That needs a signal. Nothing changed. | none | 74 |
| `together.newTitle` | her | Start writing together | none | 44 |
| `together.noSignalList` | her | Writing together needs a signal. Your part is kept on this computer if you were writing it. | none | 200 |
| `together.notAgreed` | her | {names} still need to agree. | `{names}` | 56 |
| `together.openSource` | her | Open it | none | 40 |
| `together.openSourceLabel` | her | Open {title} in a new tab | `{title}` | 50 |
| `together.ownerOnly` | her | Only someone in charge can do that. | none | 70 |
| `together.peopleButton` | her | People and invitations | none | 44 |
| `together.peopleList` | her | {names} | `{names}` | 40 |
| `together.personRow` | her | {name}: {where} | `{name}` `{where}` | 40 |
| `together.placeTaken` | her | Something else is already where this would go on {product}. Nothing changed. | `{product}` | 200 |
| `together.policyAllReady` | her | When everyone's ready | none | 42 |
| `together.policyAllReadyHelp` | her | Nobody reads anyone's part until everyone has said they're ready. | none | 130 |
| `together.policyVoluntary` | her | Each person, when they're ready | none | 62 |
| `together.policyVoluntaryHelp` | her | Anyone who's ready reads the others who are ready too. | none | 108 |
| `together.publishAsk` | her | Put “{title}” on {product} now? | `{title}` `{product}` | 62 |
| `together.publishAskText` | her | Everyone agreed to exactly this. It will be signed by {names}. | `{names}` | 240 |
| `together.publishGo` | her | Publish | none | 40 |
| `together.publishNo` | her | Not yet | none | 40 |
| `together.publishOnDay` | her | Publish on a day | none | 40 |
| `together.published` | her | It's on {product}. | `{product}` | 40 |
| `together.publisher` | her | Published by | none | 40 |
| `together.putAway` | her | Put away. Nothing was thrown away. | none | 68 |
| `together.putAwayItem` | her | Put it away | none | 40 |
| `together.question` | her | The question you each answer | none | 56 |
| `together.questionHelp` | her | One question everyone answers in their own words. | none | 98 |
| `together.reservedHeading` | her | Someone used a heading {product} keeps for itself. Ask them to change it. | `{product}` | 200 |
| `together.ruleChangeAsk` | her | Change when you read each other's parts? | none | 80 |
| `together.ruleChangeGo` | her | Change it | none | 40 |
| `together.ruleChangeKeep` | her | Keep it | none | 40 |
| `together.ruleChangeText` | her | Anyone who said they're ready will need to say so again. Nothing is shared by the change. | none | 200 |
| `together.ruleChanged` | her | Changed. Anyone who was ready needs to say so again. | none | 104 |
| `together.ruleNever` | her | Each part stays private | none | 46 |
| `together.scheduleDay` | her | Day | none | 40 |
| `together.scheduleGo` | her | Publish on this day | none | 40 |
| `together.scheduleNeedDay` | her | Choose a day in the future. | none | 54 |
| `together.scheduleTime` | her | Time | none | 40 |
| `together.scheduled` | her | It goes up on {when}. | `{when}` | 42 |
| `together.serverDown` | her | {product} didn't do that, so nothing changed. Your words are still here. | `{product}` | 200 |
| `together.signOut` | her | Sign out | none | 40 |
| `together.sourceLine` | her | {kind}: {title} | `{kind}` `{title}` | 40 |
| `together.sourceLink` | her | Link, if it has one | none | 40 |
| `together.sourceLinkHelp` | her | Leave it empty for a book or a conversation. | none | 88 |
| `together.sourceNumber` | her | Number {n} | `{n}` | 40 |
| `together.sourceTitle` | her | What it's called | none | 40 |
| `together.start` | her | Start | none | 40 |
| `together.startButton` | her | Start writing together | none | 44 |
| `together.startFromPosts` | her | Write something with others | none | 54 |
| `together.started` | her | Started. Only you can see it until you invite someone. | none | 108 |
| `together.stateOnOthers` | her | Waiting on others | none | 40 |
| `together.stateOnYou` | her | Waiting on you | none | 40 |
| `together.statePrivate` | her | Each part private | none | 40 |
| `together.statePublished` | her | On {product} | `{product}` | 40 |
| `together.statePutAway` | her | Put away | none | 40 |
| `together.stateReady` | her | Ready to publish | none | 40 |
| `together.stateScheduled` | her | Goes up {when} | `{when}` | 40 |
| `together.stateStarted` | her | Just started | none | 40 |
| `together.stateStuck` | her | Stuck | none | 40 |
| `together.stateWaitingHear` | her | Waiting to hear back | none | 40 |
| `together.stepEveryoneAgreed` | her | Everyone agreed. | none | 40 |
| `together.stepInvite` | her | Invite someone to write with you. | none | 66 |
| `together.stepName` | her | Say how your name goes on it. Then you can all read the whole thing and agree. | none | 200 |
| `together.stepPrivate` | her | Each part stays private, so it can't be published together. Whoever runs it can change that. | none | 200 |
| `together.stepPublished` | her | It's on {product}. | `{product}` | 40 |
| `together.stepRead` | her | Read everyone's parts and say if you agree. | none | 86 |
| `together.stepReadAgain` | her | Someone changed their part since you agreed. Read it again. | none | 118 |
| `together.stepReads` | her | You read this one. You'll see everyone's parts when they let you. | none | 130 |
| `together.stepReshare` | her | Someone shared a new version of their part. Let the others read yours again, and you'll all read the new one. | none | 240 |
| `together.stepScheduled` | her | It goes up on {when}. | `{when}` | 42 |
| `together.stepShare` | her | Let the others read it when you're ready. | none | 82 |
| `together.stepShareChanges` | her | You changed your part since you shared it. Let them read your changes when you're ready. | none | 200 |
| `together.stepWaitingAgree` | her | Waiting for {names} to agree. | `{names}` | 58 |
| `together.stepWaitingName` | her | Waiting for {names} to say how their name goes on it. | `{names}` | 106 |
| `together.stepWaitingOthersName` | her | Waiting for the others to say how their name goes on it. | none | 112 |
| `together.stepWaitingOthersReady` | her | Waiting for the others to be ready. | none | 70 |
| `together.stepWaitingReady` | her | Waiting for {names} to be ready. | `{names}` | 64 |
| `together.stepWaitingYes` | her | Waiting for {names} to say yes. Start your part meanwhile. | `{names}` | 116 |
| `together.stepWrite` | her | Write your part. | none | 40 |
| `together.stuck` | her | It can't be published as it stands: {names} can't agree any more. | `{names}` | 200 |
| `together.stuckRole` | her | It can't be published as it stands: nobody in it can give the agreement it needs. | none | 200 |
| `together.takeOffHelp` | her | To take it off, open it and choose Take it off my site. | none | 110 |
| `together.takeOutSource` | her | Take this one out | none | 40 |
| `together.title` | her | Writing together | none | 40 |
| `together.tooLongLine` | her | That's too long for one line. Make it shorter. | none | 92 |
| `together.tooMany` | her | Too many tries. Wait a few minutes, then try again. | none | 102 |
| `together.unsafeSomeone` | her | Someone's part has something {product} can't publish safely. Ask everyone to look at their part and agree again. | `{product}` | 200 |
| `together.unsafeWords` | her | {name}'s part has something {product} can't publish safely. Ask them to look at it and agree again. | `{name}` `{product}` | 200 |
| `together.unscheduled` | her | It won't go up on {when}. | `{when}` | 50 |
| `together.untitled` | her | Untitled | none | 40 |
| `together.viewNow` | her | Now | none | 40 |
| `together.viewPublished` | her | On {product} | `{product}` | 40 |
| `together.viewPutAway` | her | Put away | none | 40 |
| `together.viewsLabel` | her | Show | none | 40 |
| `together.waitingBadge` | her | {n} waiting on you | `{n}` | 40 |
| `together.waitingPublish` | her | Everyone agreed. Waiting for {name} to publish it. | `{name}` | 100 |
| `together.waitingPublishAnyone` | her | Everyone agreed. Waiting for whoever is in charge to publish it. | none | 128 |
| `together.whatKind` | her | What kind | none | 40 |
| `together.whatStarted` | her | What started it | none | 40 |
| `together.when` | her | When it came out | none | 40 |
| `together.whenRead` | her | When you read each other's parts | none | 64 |
| `together.whenReadShort` | her | When you read each other's parts | none | 64 |
| `together.whereAgreed` | her | agreed | none | 40 |
| `together.whereAgreedEarlier` | her | agreed to an earlier version | none | 56 |
| `together.whereLeft` | her | isn't in it any more | none | 40 |
| `together.whereNotReady` | her | not ready yet | none | 40 |
| `together.whereNotStarted` | her | hasn't started | none | 40 |
| `together.whereReads` | her | only reads | none | 40 |
| `together.whereReady` | her | ready | none | 40 |
| `together.whereWriting` | her | writing | none | 40 |
| `together.you` | her | You | none | 40 |
| `together.yourName` | her | Your name on it | none | 40 |
| `together.yourNameHelp` | her | How your part is signed when it's published. | none | 88 |
| `trip.areaAddress` | her | “{area}” looks like a street address. Use an area name instead, like a park or a mountain range. | `{area}` | 192 |
| `trip.areaField` | her | Just an area's name, not a street address or a house number. | none | 120 |
| `trip.exactRoute` | her | Readers can see exactly where you started and finished. Make sure it doesn't show a home, a campsite, or a place where rare plants or animals live. | none | 240 |
| `trip.noArea` | her | Add where you went, as an area that's safe to share, like a park or a mountain range. | none | 170 |
| `trip.noConditions` | her | Add the conditions: weather, trail, water, what you saw. | none | 112 |
| `trip.noDistance` | her | Add your route, or fill in the distance, so readers know how far you went. | none | 148 |
| `trip.showLess` | her | Show less of the route | none | 44 |
| `undo.askHelp` | her | There's a new {one} with that name now. Ask {helper} to help bring this one back. | `{one}` `{helper}` | 162 |
| `undo.mayFind` | her | “{title}” can't come back from here. {helper} may still find it. | `{title}` `{helper}` | 128 |
| `visitors.cameFrom` | her | Where they came from | none | 40 |
| `visitors.chartLabel` | her | Visits per {unit}, most in {period} with {n}. | `{unit}` `{period}` `{n}` | 90 |
| `visitors.chartLabelNone` | her | Visits per {unit}. | `{unit}` | 40 |
| `visitors.colOpened` | her | Pages opened | none | 40 |
| `visitors.colPeriod` | her | When | none | 40 |
| `visitors.colVisits` | her | Visits | none | 40 |
| `visitors.detailsAgents` | details | AI tools and bots: {n} requests{list} | `{n}` `{list}` | 74 |
| `visitors.detailsError` | details | error {status}: {message} | `{status}` `{message}` | 50 |
| `visitors.detailsHost` | details | from {host}  {views} | `{host}` `{views}` | 40 |
| `visitors.detailsPath` | details | {path}  views {views}  visits {visits}  all time {allTime} | `{path}` `{views}` `{visits}` `{allTime}` | 116 |
| `visitors.detailsRange` | details | from {from} to {to}, views {views}, visits {visits}, all time {allTime}, first day {first}, kept {kept}, series {series} | `{from}` `{to}` `{views}` `{visits}` `{allTime}` `{first}` `{kept}` `{series}` | 240 |
| `visitors.detailsSource` | details | source {source} | `{source}` | 40 |
| `visitors.emptyText` | her | When people read {product}, the numbers show up here a day or so later. | `{product}` | 142 |
| `visitors.emptyTitle` | her | No visits counted yet | none | 42 |
| `visitors.failed` | her | Your visitor numbers didn't load. | none | 66 |
| `visitors.findGroup` | her | Visitors | none | 40 |
| `visitors.findRange` | her | Visitors in the last {range} | `{range}` | 56 |
| `visitors.frontPage` | her | Your front page | none | 40 |
| `visitors.how1` | her | {product} counts without cookies and keeps nothing that could tell who a reader is. | `{product}` | 166 |
| `visitors.how2` | her | A person reading the same page twice in a day is one visit. Nothing links one day to the next, so {product} can't tell how many different people came. | `{product}` | 240 |
| `visitors.how3` | her | Readers who ask not to be counted aren't counted. | none | 98 |
| `visitors.how4` | her | Search engines and AI tools also read your pages. They're not in these numbers. | none | 158 |
| `visitors.how5` | her | This counts what reaches {product}'s own computer; if {product} is served from somewhere else, some visits may be missing. | `{product}` | 240 |
| `visitors.howHeading` | her | How these numbers are counted | none | 58 |
| `visitors.keptFor` | her | {product} keeps numbers for {n} days, so the start of this period isn't here. | `{product}` `{n}` | 154 |
| `visitors.noSignal` | her | {product} can't reach your site right now, so there are no numbers to show. Try again when you have a signal. | `{product}` | 218 |
| `visitors.notYet` | her | not counted yet | none | 40 |
| `visitors.off` | her | Visitor counting is switched off. | none | 66 |
| `visitors.opened` | her | Pages were opened {n} times. | `{n}` | 56 |
| `visitors.opened1` | her | A page was opened once. | none | 46 |
| `visitors.otherPages` | her | Other pages: {visits} | `{visits}` | 42 |
| `visitors.partMonth` | her | part of the month | none | 40 |
| `visitors.partWeek` | her | part of a week | none | 40 |
| `visitors.range30` | her | 30 days | none | 40 |
| `visitors.range7` | her | 7 days | none | 40 |
| `visitors.range90` | her | 90 days | none | 40 |
| `visitors.rangeLabel` | her | Over the last | none | 40 |
| `visitors.rangeYear` | her | a year | none | 40 |
| `visitors.readMost` | her | What they read most | none | 40 |
| `visitors.readNone` | her | No posts yet; the visits were to other pages. | none | 90 |
| `visitors.seeNumbers` | her | See the numbers | none | 40 |
| `visitors.serviceDown` | her | Your visitor numbers aren't answering right now. Try again in a few minutes. | none | 152 |
| `visitors.showMore` | her | Show more | none | 40 |
| `visitors.since` | her | Counting since {day}. | `{day}` | 42 |
| `visitors.tableCaption` | her | Visits and pages opened, by {unit} | `{unit}` | 68 |
| `visitors.title` | her | Who's been reading? | none | 40 |
| `visitors.tryAgain` | her | Try again | none | 40 |
| `visitors.unitDay` | her | day | none | 40 |
| `visitors.unitMonth` | her | month | none | 40 |
| `visitors.unitWeek` | her | week | none | 40 |
| `visitors.untitled` | her | Untitled | none | 40 |
| `visitors.visit1` | her | 1 visit | none | 40 |
| `visitors.visitMeans` | her | A visit is one person reading one page on one day. | none | 100 |
| `visitors.visits` | her | {n} visits | `{n}` | 40 |
| `visitors.visitsFor` | her | {n} visits | `{n}` | 40 |
| `visitors.weekOf` | her | the week of {day} | `{day}` | 40 |
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
| `voice.keptByNewer` | her | A newer version of {product} keeps its own writing on this phone, so this copy stays on this page only. Keep it open until it says Saved. | `{product}` | 240 |
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
| `voice.lockFailedNewer` | her | Your rough draft couldn't be saved just now. A newer version of {product} keeps its own writing on this phone, so keep this page open until you have a signal. | `{product}` | 240 |
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
| `yours.back` | her | ‹ Your research | none | 40 |
| `yours.cantPublish` | her | The next update can't publish this. Open it to see why. | none | 110 |
| `yours.checks` | her | Research checks: {count} to look at. | `{count}` | 72 |
| `yours.checksNone` | her | The research checks found nothing for this post. Checks can't see everything. | none | 154 |
| `yours.checksNot` | her | Research checks run on research posts and posts that cite. | none | 116 |
| `yours.checksOpen` | her | Before you publish | none | 40 |
| `yours.citeInterpreted` | her | Cite the source it interprets | none | 58 |
| `yours.citeOnly` | her | Cite it only | none | 40 |
| `yours.close` | her | Close your research | none | 40 |
| `yours.convert` | her | Turn into my own words… | none | 46 |
| `yours.convertGo` | her | Put it in | none | 40 |
| `yours.convertStay` | her | Not now | none | 40 |
| `yours.convertText` | her | It stops being private there: readers see it once you publish. | none | 124 |
| `yours.convertTitle` | her | Put this note in your post as your own words? | none | 90 |
| `yours.converted` | her | Your note is in your post as your own words. | none | 88 |
| `yours.count` | her | {count} found | `{count}` | 40 |
| `yours.interpretationNever` | her | An interpretation is never cited or put in a post. Readers see it only inside aligned passages you publish. | none | 214 |
| `yours.keepNew` | her | Keep a new passage | none | 40 |
| `yours.lede` | her | Only what you put in goes into this post. Quotations go in with their citation; your notes go in only if you turn one into your own words. | none | 240 |
| `yours.linkComparison` | her | Put in a link to these aligned passages | none | 78 |
| `yours.linkDating` | her | Put in “{date}” linked to the entry | `{date}` | 70 |
| `yours.linkEntry` | her | Put in a link to this entry | none | 54 |
| `yours.linked` | her | Link put in. | none | 40 |
| `yours.linkedNotes` | her | {count} of your notes are about it. They never go in with it. | `{count}` | 122 |
| `yours.loading` | her | Getting your research… | none | 44 |
| `yours.noCitation` | her | That didn't go in: no citation came back. Your post didn't change. | none | 132 |
| `yours.noNotes` | her | No notes match. | none | 40 |
| `yours.noPlace` | her | No place recorded. | none | 40 |
| `yours.none` | her | Nothing in your research matches. | none | 66 |
| `yours.notApproved` | her | Not published: you haven't let readers see this. Nothing private is linked. | none | 150 |
| `yours.notPublished` | her | Not published | none | 40 |
| `yours.noteLine` | her | Your own unpublished thinking. It never goes in unless you turn it into your own words. | none | 174 |
| `yours.open` | her | Your research… | none | 40 |
| `yours.openAtlas` | her | Open it in your atlas | none | 42 |
| `yours.openCompare` | her | Open it in Compare | none | 40 |
| `yours.openNotebook` | her | Open in your notebook | none | 42 |
| `yours.openSources` | her | Open in Sources | none | 40 |
| `yours.partFailed` | her | Your {what} can't be read, so it isn't offered here. Nothing changed. | `{what}` | 138 |
| `yours.passageFrom` | her | Passage from {source} | `{source}` | 42 |
| `yours.published` | her | Published | none | 40 |
| `yours.quoteHelp` | her | The words go in exactly as kept, as a quotation after the paragraph you're in, with its citation. The rights statement is yours; it doesn't mean you may quote them. | none | 240 |
| `yours.quoteIt` | her | Put the quotation in | none | 40 |
| `yours.quoted` | her | Quotation put in after “{words}”. | `{words}` | 66 |
| `yours.reading` | her | Reading of {source} | `{source}` | 40 |
| `yours.refresh` | her | Check again | none | 40 |
| `yours.refusedBlock` | her | That can't go inside code or a part kept as written. Put your cursor in plain words first. | none | 180 |
| `yours.rendering` | her | Rendering of {source} | `{source}` | 42 |
| `yours.rights` | her | Rights: {label} | `{label}` | 40 |
| `yours.rightsGo` | her | Quote them | none | 40 |
| `yours.rightsReserved` | her | are reserved | none | 40 |
| `yours.rightsStay` | her | Not now | none | 40 |
| `yours.rightsText` | her | Quoting them on {product} is your decision. | `{product}` | 86 |
| `yours.rightsTitle` | her | Quote words whose rights {state}? | `{state}` | 66 |
| `yours.rightsUnknown` | her | nobody has checked | none | 40 |
| `yours.rowName` | her | {type}: {title}, {visibility} | `{type}` `{title}` `{visibility}` | 58 |
| `yours.search` | her | Search your research | none | 40 |
| `yours.show` | her | Show | none | 40 |
| `yours.showAll` | her | Everything | none | 40 |
| `yours.showContext` | her | Atlas entries and aligned passages | none | 68 |
| `yours.showInterpretations` | her | Interpretations | none | 40 |
| `yours.showNotes` | her | My notes | none | 40 |
| `yours.showPassages` | her | Passages | none | 40 |
| `yours.showSources` | her | Sources | none | 40 |
| `yours.siteOff` | her | {product} doesn't publish the atlas yet, so a link would lead nowhere. {helper} can turn it on. | `{product}` `{helper}` | 190 |
| `yours.siteOffCompare` | her | {product} doesn't publish aligned passages yet, so a link would lead nowhere. {helper} can turn it on. | `{product}` `{helper}` | 204 |
| `yours.sourceHelp` | her | Only the key and the places you give go into your post. | none | 110 |
| `yours.sourceKey` | her | {kind}, key {key} | `{kind}` `{key}` | 40 |
| `yours.title` | her | Your research | none | 40 |
| `yours.typeAtlas` | her | Atlas entry | none | 40 |
| `yours.typeComparison` | her | Aligned passages | none | 40 |
| `yours.typeInterpretation` | her | Interpretation | none | 40 |
| `yours.typeNote` | her | Note | none | 40 |
| `yours.typePassage` | her | Passage | none | 40 |
| `yours.typeSource` | her | Source | none | 40 |
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
