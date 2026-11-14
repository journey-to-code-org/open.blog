# Studio words: generic defaults and a words hook

By `studio-architect` with `studio-ux`, 2026-11-13. Sources: the owner's note of 2026-11-13 ("Grammi's
House is just a subscriber to open.blog, so the wording should mostly be specific to her blog...
expose a hook so that I could configure the wording on her blog, or for anyone else, via a
deployment config file"), `studio-ux`, `studio-architecture`, `retirement-plan.md` (§4 R0–R15),
`r1`–`r8/ux.md` ("the person who set up your site" 76×, "your blog" 128×), `docs/deploy.md`
(`OPENBLOG_*` settings, `OPENBLOG_GIT_SSH_KEY_PATH` naming), `crates/openblog-core/src/config.rs`
(`SiteConfig`, `Author`, `AdminConfig`), `crates/openblog-cli/src/site.rs:516` (`load_config`),
`crates/openblog-cli/src/admin.rs:4264` (`meta`), `web/studio/studio.js:62` (`meta` kept for no
signal), `parts/site-health.js:32` (Home's "For the person who set up your site"), and a grep of
`web/studio/{screens,parts}` (helper phrase 96× in 50 files, "your blog" 93×, "your site" 219×).

**The problem.** Studio is open.blog's product Admin. Grammi is one owner on it, and our specs used
her as the persona, so her name, her son's role, her family and her food leaked into shipped
defaults. A roofer (Dana, from R4/R8) or a developer gets "Love, Grammi" on every new card.

**The job.** Every shipped string reads right for any owner. A site (and a host serving many sites)
can change Studio's words without forking it, safely, and Mikey can see what changed.

**Decisions the owner should check** (⚑ where they appear):
1. ⚑ Precedence is **built-in < deployment file < site config**, per key.
2. ⚑ The env var is `OPENBLOG_STUDIO_WORDS_PATH` (the repo's `*_PATH` convention), not `OPENBLOG_STUDIO_WORDS`.
3. ⚑ Three named variables only: `{helper}`, `{product}`, `{owner}`. "Your site" (219×) is already generic and stays literal. Decorations' "your house" becomes `{product}`; Grammi gets "your house" back with per-id overrides.
4. ⚑ The default card sign-off is `{owner}` alone (no "Love,"); Grammi's config adds "Love,".
5. ⚑ A bad entry never stops Studio: it is dropped, the built-in words show, and the problem appears only in Mikey's details and in `openblog check`.
6. ⚑ No editor for words in Studio in this slice: the developer edits files. (A Studio screen would put setting names on her layer.)
7. ⚑ The banned-word list applies to overrides of her-layer ids: an override that says "deploy" or "sync" is dropped.

## 1. Generic defaults

Persona rule (goes into `studio-ux`, §6): Grammi is a persona for judging screens, never a default.
No shipped string names her, her family, her site, her son or her food; a recipe example appears
only on a recipe screen.

Every Grammi-specific default found (user-visible strings; code comments are fixed when touched):

| # | Where | Shipped | Generic default (id) |
|---|---|---|---|
| 1 | `parts/card-words.js:114` | sign-off `"Love, Grammi"` | `{owner}`, empty when no owner name (`cards.signOff`) |
| 2 | `parts/recipe-editor.js:27` | notes heading `"Grammi's notes"` | `Notes`, same as `recipe-body.js:413` (`recipe.notesHeading`). Written into her Markdown, so only new recipes change; existing posts keep their heading |
| 3 | `parts/bluesky-sheet.js:17` | placeholder `grammi.bsky.social` | `yourname.bsky.social` (`bluesky.namePlaceholder`) |
| 4 | `parts/social-rules.js:214` | "Type your Bluesky name, like grammi.bsky.social." | "...like yourname.bsky.social." (`bluesky.nameError`) |
| 5 | `parts/notification-rules.js:13` | "News from your family's other apps, like a card game" | "News from your other apps" (`notify.appSwitch`) |
| 6 | `parts/doc-kinds.js:14` | "like About or the Family Wall" | "like About or Contact" (`kinds.pagesAbout`) |
| 7 | `parts/doc-kinds.js:32,34`, `parts/write-page.js:37` | "like all your Thanksgiving recipes" | "like all your posts on one topic" (`kinds.collectionsAbout`, `kinds.collectionsEmpty`, `write.collectionHelp`) |
| 8 | `parts/season-words.js:31–37`, `screens/decorations.js:77,119,146–148` | "Your house wears / is decorated for..." | "{product} wears / is decorated for..." (`decorations.*`, 7 ids) |
| 9 | `parts/notification-cards.js:44,54`, `parts/notification-rules.js:251` | "like Kitchen iPad" | "like Work phone" (`notify.nameHelp`, `notify.nameMissing`) |
| 10 | `parts/picture-picker.js:85` | "like “Pie cooling on the windowsill”" | "like “A red front door with a wreath”" (`photo.altHelp`) |
| 11 | 96 strings in 50 files | "the person who set up your site" | `{helper}` (§2), default unchanged |
| 12 | 93 strings | "your blog" | `{product}`, default unchanged |

Kept as they are, with the reason: the Recipes front-page starter's "Welcome to my kitchen"
(`landing-rules.js:563`, a recipe screen); "24 cookies" in recipe help (`profile-words.js:42`);
Christmas, tree and family words in Gifts and Decorations (the features are about them; their ids
join the catalog when R-slices touch them, so a site can override). `web/admin/greetings.js:182`
also says "Love, Grammi": left, deleted in R15.

## 2. The words hook

### Where overrides live

- **Site:** `studio.words` in `openblog.json`, edited by the developer, versioned with the site.
- **Deployment:** a JSON file named by `OPENBLOG_STUDIO_WORDS_PATH` ⚑, for a host serving many
  sites (each site's server points at the same file). The path is read at start; the file is read
  on every `meta`, so editing it needs no restart.
- **Precedence** ⚑, per variable and per id: built-in default < deployment file < site config. The
  site is the more specific choice; the host's file is the house style for all its sites. A site
  that wants the built-in words back writes them out.

### Format

Both places have the same shape:

```json
{
  "vars": { "helper": "Mikey", "owner": "Grammi" },
  "text": { "cards.signOff": "Love, {owner}", "recipe.notesHeading": "{owner}'s notes" }
}
```

- **Ids** are stable, `area.name` (`^[a-z]+(\.[a-zA-Z0-9]+)+$`), never renamed; a removed id is
  reported as no longer used, never reused.
- **Variables** ⚑ (`vars`): `helper` (default "the person who set up your site"), `product`
  (default "your blog"), `owner` (default: the first word of `author.name`, else empty). An override
  may use the three variables plus the ones its built-in text uses (`{label}`, `{theme}`...); any
  other `{...}` is a problem. Variable values contain no `{` or `}`.
- **Capitals:** `say()` capitalises the first letter when the text starts with a variable
  ("Tell {helper}." / "{helper} can turn it on." → "Your son can turn it on.").
- **Empty owner:** an id whose text uses `{owner}` declares `bare` (its text with no name); `say()`
  uses it when `owner` is empty.
- **Not overridable:** sentences built from counts or lists ("3 recipes waiting", "By A, B and
  C") stay code; their fixed parts become ids only when split cleanly.

### Validation (server, per entry; a bad entry is dropped, the rest apply) ⚑

| Rule | Limit |
|---|---|
| Strings only, Unicode NFC, trimmed, not empty (an empty `bare` sign-off is the only empty text) | |
| Length | `vars`: 60 chars. `text`: the id's `max`, else max(40, 2 × default), capped at 240 |
| Plain text | no control characters, no bidi controls (U+202A–202E, U+2066–2069), no `<` `>`, no `://` or `www.` (no links) |
| Ids | known in the catalog (`web/studio/words.json`); unknown → "isn't a word id" with the nearest id |
| Variables | only the allowed ones (above) |
| Her words | her-layer ids and all `vars`: none of `studio-ux`'s banned words |
| File | ≤ 64 KiB, ≤ 500 entries; unreadable or not JSON → one problem, file ignored |

### How Studio gets them

`GET /admin/api/meta` adds:

```json
"studioWords": {
  "vars": { "helper": "Mikey", "product": "your blog", "owner": "Grammi" },
  "text": { "cards.signOff": "Love, {owner}" },
  "from": { "helper": "site", "owner": "site", "cards.signOff": "site" },
  "problems": [{ "where": "site", "key": "card.signoff", "words": "card.signoff isn't a word id. Did you mean cards.signOff?" }]
}
```

Only valid entries are in `vars`/`text`. `studio.js` passes `meta.studioWords` to
`configureWords()` before the shell starts; with no signal the kept `meta` carries them. Problems
are for Mikey only: never a toast, banner or badge on her layer.

### In code: a catalog and `say()`

- `parts/words.js` (pure): `say(id, vars?)`, `configureWords(studioWords)`, `catalog()`. Fills
  globals from the configured vars, per-call vars from the argument. Client re-checks each override
  (known id, length, no `<>`) and ignores what fails. An unknown id **throws** (a programming error
  the tests catch).
- Defaults live beside the words they replace, in pure `parts/*-words.js` files, each exporting
  `WORDS`: `{ "cards.signOff": { text: "{owner}", bare: "", layer: "her", max: 80 } }`.
  `layer` is `her` or `details`. Shared ids (`common.tell` "Tell {helper}.", `common.detailsFor`
  "Details for {helper}", `common.forHelper` "For {helper}") live in `parts/common-words.js`.
- `parts/plain-words.js` exports `HER_BANNED`, the one copy of `studio-ux`'s banned list; the
  per-test `BANNED` regexes import it as they're touched.
- `scripts/studio-words.mjs` imports every catalog and writes `web/studio/words.json`
  (id, text, layer, vars, max, banned list) and the id table in `docs/studio-words.md`. Run it with
  `scripts/studio-files.mjs`; tests fail when either is stale. The server validates against the
  embedded `words.json` (no copy of the catalog in Rust).
- Callers pass a literal id: `say("common.tell")`, never a built one, so the tests can find them.
- Text from `say()` is placed only with `textContent`, element properties or attributes that are
  not addresses (`label`, `placeholder`, `description`, `aria-label`); never `href`, `src`,
  `innerHTML` or a `style`.

### Migration, in steps (no big bang)

| Step | Ids | Done when |
|---|---|---|
| **W-a** (now, before R6) | engine, `{helper}` (all 96 strings, mostly via `common.tell` / `common.detailsFor` / `common.forHelper`), `{owner}`, the 10 leak fixes in §1 with their ids | no literal "person who set up your site" in `web/studio`; §1 rows 1–10 pass the persona test |
| **W-b** | `{product}` (93 strings), headings and sign-offs, Decorations lines | no literal "your blog" in `web/studio` |
| **R6–R15** | each slice writes its new strings as ids, and migrates the her-layer strings of each screen it touches | the slice's test lists its files as migrated |

### How Mikey sees what exists and what's in effect

- **What exists:** `docs/studio-words.md`, generated table (id, layer, default, variables, limit).
- **In effect:** Home → "For {helper}" details (`parts/site-health.js`) gains **Words**: "3 changed
  by this site, 1 by the server's file", each as `id: text (site)`, then each problem in words.
  Hidden when nothing is changed and nothing is wrong.
- `openblog check` prints the same problems and exits non-zero only for a site-config problem.

## 3. Examples

**Grammi's House** (`openblog.json`). She asked to see her son's name instead of "the person who set
up your site":

```json
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

She reads "Tell Mikey.", "Details for Mikey", "Mikey can turn it on.", and a new card starts
"Love, Grammi".

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

Dana reads "Tell Hillside Web Care.", "Your website can post for you."; if her site set `helper`
too, the site's value would win.

## 4. Tests

- **`tests/web/studio-words.test.mjs`** (pure): `say()` defaults; globals and per-call vars;
  first-letter capital; `bare` when owner is empty; overrides applied, bad ones ignored on the client;
  unknown id throws.
- **Catalog:** ids unique across files and match the pattern; every `say("…")` id exists and every
  id is used; no `say(` with a non-literal; every `{owner}` id has `bare`; her-layer defaults pass
  `HER_BANNED`; `words.json` and the docs table are fresh.
- **Generic defaults:** no string literal in `web/studio/{screens,parts}` (comments excluded) matches
  `Grammi|Mikey|grammishouse|Family Wall|Kitchen iPad|Thanksgiving recipes|windowsill`.
- **Migrated ids reachable:** after W-a no literal "person who set up your site", after W-b no
  literal "your blog" in `web/studio`; each migrated file is listed and checked.
- **Rust, `admin/studio_words.rs`:** each validation rule (length, NFC, controls, bidi, `<>`, link
  text, unknown id with suggestion, unknown variable, braces in a var, banned word on a her id but
  allowed on a details id, non-string, oversized and unreadable file); precedence built-in <
  deployment < site per key; problems never drop valid entries; `meta.studioWords` shape; no
  `studio.words` and no env → only defaults' vars; `deny_unknown_fields` on `studio` and
  `studio.words`; `openblog check` output.
- **Browser, `tests/browser/studio-words.spec.mjs`:** a site with Grammi's example: Home details say
  "For Mikey" and list the overrides; a new card starts "Love, Grammi"; the Bluesky sheet shows
  `yourname.bsky.social`; a bad id shows only inside details; a site with no config shows built-in
  words; axe clean.

## 5. Server gaps

- **W1** `SiteConfig.studio: StudioConfig { words: StudioWords { vars, text } }` (maps of
  string → JSON value so a wrong type is a problem, not a load failure; `deny_unknown_fields` on the
  two structs).
- **W2** `OPENBLOG_STUDIO_WORDS_PATH` read at start into `AppState`; file read per `meta`; documented
  in `docs/deploy.md`.
- **W3** Validation and merge (`admin/studio_words.rs`) against the embedded `web/studio/words.json`.
- **W4** `meta.studioWords` (`vars`, `text`, `from`, `problems`); `owner` from `author.name`.
- **W5** `openblog check` reports word problems.

## 6. Docs

- New `docs/studio-words.md`: what it's for, the two places, precedence, format, the three
  variables, limits and why, Grammi's and Dana's examples, where Mikey sees problems, and the
  generated id table between `<!-- words:start -->` / `<!-- words:end -->`.
- `docs/configuration.md`: a `studio.words` entry linking to it. `docs/deploy.md`: the env var.
  `CHANGELOG.md`: "Studio's words can be changed per site or per host; built-in words no longer
  name a particular owner."

## 7. How future slices write strings (proposed skill text)

**`studio-ux`, add under Words:**

> - Grammi is a persona for judging screens, never a default. No shipped string names her, her
>   family, her site or her food; recipe examples appear only on recipe screens.
> - Who helps her is `{helper}`, the product is `{product}`, her name is `{owner}`. Never write
>   "the person who set up your site", "your blog" or a name as a literal.
> - Every her-layer sentence is a word id with its default in the area's `parts/*-words.js`;
>   a site may change it, so it must read right on its own and with any `{helper}` (no pronouns
>   for the helper: "Tell {helper}.", not "Tell him").

**`studio-architecture`, add under Rules:**

> - **Words come from `say()`.** New her-layer and details strings are ids in a pure
>   `parts/*-words.js` `WORDS` catalog, read with `say("literal.id", vars)` from `parts/words.js`.
>   Run `node scripts/studio-words.mjs` after adding or changing an id (it writes
>   `web/studio/words.json` and `docs/studio-words.md`). Ids are never renamed or reused. A slice
>   migrates the strings of each screen it touches. Overrides come from `meta.studioWords`,
>   validated by the server; placed with `textContent` or non-address attributes only.
