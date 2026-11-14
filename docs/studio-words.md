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
| `bluesky.nameError` | her | Type your Bluesky name, like yourname.bsky.social. | none | 100 |
| `bluesky.namePlaceholder` | her | yourname.bsky.social | none | 60 |
| `cards.notSetUp` | her | {helper} needs to finish setting them up. Your site works the same without them. | `{helper}` | 160 |
| `cards.signOff` | her | {owner} (with no name: "") | `{owner}` | 80 |
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
| `home.filesVanish` | her | This server doesn't keep its files when it restarts. Ask {helper} to fix that. | `{helper}` | 156 |
| `home.notUpdated` | her | Your site couldn't be updated. Your work is saved. Let {helper} know; the details are under Your site. | `{helper}` | 204 |
| `install.signInFirst` | her | You'll sign in once more from the new icon, so have your password handy. If you don't know it, ask {helper} first. | `{helper}` | 228 |
| `job.newerVersion` | her | This job was saved by a newer version of your blog's pages. Reload to send it. If it still says this, tell {helper}. | `{helper}` | 232 |
| `kinds.collectionsAbout` | her | A collection gathers posts on one page, like all your posts on one topic. Put a post in one from the post itself. | none | 226 |
| `kinds.collectionsEmpty` | her | A collection gathers posts on one page, like all your posts on one topic. | none | 146 |
| `kinds.pagesAbout` | her | Pages stay put, like About or Contact. Posts come and go by date. | none | 130 |
| `look.notAccepted` | her | Your site's settings didn't accept these choices. Your choices are still here; try a different one, or tell {helper}. | `{helper}` | 234 |
| `notify.appSwitch` | her | News from your other apps | none | 50 |
| `notify.canTurnOn` | her | {helper} can turn them on. Your blog works the same without them. | `{helper}` | 130 |
| `notify.nameHelp` | her | So you can tell them apart, like Work phone. | none | 88 |
| `notify.nameMissing` | her | Give it a name, like Work phone. | none | 64 |
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
| `undo.askHelp` | her | There's a new {one} with that name now. Ask {helper} to help bring this one back. | `{one}` `{helper}` | 162 |
| `undo.mayFind` | her | “{title}” can't come back from here. {helper} may still find it. | `{title}` `{helper}` | 128 |
| `write.collectionHelp` | her | Put it with others, like all your posts on one topic. | none | 106 |
<!-- words:end -->
