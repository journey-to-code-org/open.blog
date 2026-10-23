# Writing content

Everything on the site comes from Markdown files under `content/`:

```
content/posts/     one file per post
content/series/    one file per series (optional)
content/pages/     one file per page, such as About (optional)
```

Files anywhere in `content/posts/` are posts, including in subfolders. A `README.md`, and
any file or folder whose name starts with `_` (such as `content/posts/_notes.md` or
`content/posts/_ideas/`), are ignored, so you can keep notes beside your posts.

## Posts

A post is Markdown with a front matter block between `---` lines:

```markdown
---
title: Writing a post
date: 2026-01-12
tags: [guide, markdown]
description: What goes in a post file and which Markdown features work.
---

The body starts here.
```

Only `date` is required (a draft may omit it), plus a `title` unless the body starts with
a `#` heading, which is then used. Everything else is optional:

| Field | Meaning |
| --- | --- |
| `title` | The headline. If missing, the first `#` heading in the body is used. |
| `date` | `YYYY-MM-DD` (midnight UTC) or a full time such as `2026-01-12T09:30:00Z` or `2026-01-12T09:30:00-05:00`. A future date **schedules** the post. |
| `updated` | When the post was last revised. Shown on the page and used in feeds. |
| `slug` | The address part. Defaults to the file name without a leading `YYYY-MM-DD-`. |
| `tags` | A list (`[a, b]` or one per line with `- `). Matched case-insensitively. |
| `series` | The slug of a series this post belongs to. |
| `seriesOrder` | Position within the series. Without it, parts are ordered by date. |
| `description` | A sentence or two for feeds, search results, and social cards. Defaults to an excerpt. |
| `cover` | Image shown at the top and used as the social card. Defaults to the first image in the body. |
| `coverAlt` | Alternative text for the cover. |
| `draft` | `true` keeps the post out of every build and feed. |
| `theme` | A theme name, to render this post differently from the rest. |
| `canonical` | If the post was first published elsewhere, that address. Search engines then credit the original. |
| `sourceUrl` | Shown as "Originally published at" under the post. The Hashnode importer fills this in. |
| `aliases` | Old addresses that should redirect here, such as `[/old-slug/]`. Also accepted as `redirectFrom`. |
| `highlight` | `false` turns off code colouring for this post; `true` turns it on. Overrides the site and theme. |
| `lineNumbers` | `false` or `true`: line numbers on this post's code blocks. Overrides the site and theme. |
| `recipe` | `true` makes the post a recipe. See [Recipes](#recipes) for its own fields. |

Unknown fields are kept and ignored, so you can store your own notes in the front matter.

### File names and addresses

A file named `2026-01-12-writing-a-post.md` gets the slug `writing-a-post` and, with the
default settings, the address `/posts/writing-a-post/`. The `postPath` setting changes the
pattern; `"/{slug}/"` puts posts at the site root, which matches most blog platforms.

### Markdown

CommonMark plus the GitHub extensions: tables, task lists, footnotes, and strikethrough.
Raw HTML is passed through, so an `<iframe>` for a video or a `<details>` block works.
Headings get ids and a hover anchor so sections can be linked. A table of contents appears
automatically on posts with three or more section headings (configurable).

Callouts are quotes whose first line names a kind, as on GitHub:

```markdown
> [!TIP]
> Toast the spices first for a deeper flavour.
```

The kinds are `NOTE`, `TIP`, `IMPORTANT`, `WARNING`, and `CAUTION` (any case); each gets
its own colour and is titled with its kind. Put the marker alone on the first line: any
other text after it, or another kind, leaves an ordinary quote that shows the marker.

### Knowledge checks

Put a short multiple-choice question in a `quiz` fence. Readers receive feedback as soon
as they choose an answer; their attempt is remembered only in that browser and is never
sent to the blog or its analytics.

````markdown
```quiz
What does `draft: true` do?
- [ ] Publishes the post privately
- [x] Excludes the post from public builds
- [ ] Schedules it for tomorrow
> Drafts remain available in the admin preview.
```
````

A question needs two to four choices and exactly one checked (`[x]`) answer. The final
`>` explanation is optional. Prompts, choices, and explanations support emphasis,
strikethrough, and inline code, but not links, images, raw HTML, or multiple lines.
`openblog check` reports an invalid knowledge check instead of publishing it.

In the admin editor, choose **Add knowledge check** to fill in a small form instead of
writing the fence. You can add up to three questions at once. If the site owner configured
generation, select some article text (or put the cursor in a section), open the same form,
and choose **Generate draft**. Generated questions remain editable and are not added to
the post until you choose **Insert**.

### Code blocks

Fenced code blocks are coloured in the browser, numbered when they have two or more
lines, and get a Copy button. A block without a language has its language guessed. Plain
output is best marked `text`, which is neither coloured nor numbered.

After the language you can add options, in the style other site generators use:

````markdown
```rust title="src/main.rs" {2,4-6} showLineNumbers=10
fn main() {}
```
````

| Option | Effect |
| --- | --- |
| `title="..."` | A caption bar above the block, for a file name or a label. |
| `{2,4-6}` | Highlight those lines, counted from 1 at the top of the block (even with `showLineNumbers=10`). |
| `showLineNumbers` | Number this block even when numbering is off, or when it has one line. |
| `showLineNumbers=10` | Number this block starting at 10. |
| `showLineNumbers=false` | No numbers on this block. |

Colours can be turned off for a post (`highlight: false`) or the whole blog, but not for
one block; mark a block `text` to leave it plain. Copying a block, with the button or by
selecting it, never includes the line numbers.
For the whole blog, see `code` in [Configuration](configuration.md#code-blocks).

### Images

Put files in `static/`; they are copied to the site root unchanged. `static/images/a.png`
is `/images/a.png`:

```markdown
![A short description](/images/a.png)
```

In the admin editor, images can be inserted with a button, dragged in, or pasted; they are
saved under `static/images/uploads/<year>/`.

### Drafts

`draft: true` hides a post everywhere. Preview drafts locally with
`openblog serve --drafts`, or in the admin editor, where drafts have their own badge.

### Scheduling

A post whose `date` is in the future is held back from the site, the feeds, the sitemap,
search, and tag and series pages. The first build after that time includes it. When
`openblog serve` is running, it rebuilds by itself at the right moment; on a static host, a
scheduled build (a cron job or workflow) does the same. See [Deploying](deploy.md).

To preview a scheduled post before its time, run `openblog serve --drafts` or
`openblog build --drafts`; the flag includes drafts and scheduled posts. The admin editor
lists them with a "scheduled" badge.

## Recipes

open.blog is not only for code. Add `recipe: true` to a post's front matter, put the
ingredients in a list under an `## Ingredients` heading and the steps in a list under a
`## Steps` heading, and readers get:

- a summary card with the times and servings, and a "Jump to recipe" link,
- buttons that scale the amount at the start of each ingredient to more or fewer servings,
- checkboxes to tick off ingredients and steps as they cook (remembered on their device),
- timers: a duration in a step, such as "simmer for 10 minutes", starts a countdown when tapped,
- a cook mode that keeps the screen awake, and a "Print recipe" button that prints just the recipe,
- schema.org recipe data for search engines.

`openblog new "Lemon garlic pasta" --recipe` creates a post with `recipe: true`,
`servings: 4`, `prep: 15 min`, `cook: 25 min`, a tip callout, and a placeholder
Ingredients list and Steps list, ready to fill in. A finished recipe looks like this:

```markdown
---
title: Lemon garlic pasta
date: 2026-02-02
recipe: true
servings: 4
prep: 10 min
cook: 15 min
cuisine: Italian
course: Dinner
cover: /images/lemon-pasta.jpg
---

A few words about the dish.

## Ingredients

- 400 g spaghetti
- 1 1/2 lemons, zested and juiced
- Salt, to taste

## Steps

1. Cook the spaghetti for 9 minutes.
2. Toss with the lemon and serve.
```

| Field | Meaning |
| --- | --- |
| `recipe` | `true` (or `type: recipe`) makes the post a recipe. |
| `servings` | How many it serves. A number (`4`) can be scaled; a range (`4-6`) scales from its first number. Also `serves`. Scaling needs a number here. |
| `makes` | What it makes: `12 cookies`, `1 loaf`. Shown on the card only; to let readers scale a batch, also give `servings` (`servings: 24` and `makes: 24 cookies`). Also `yield`. |
| `prep`, `cook`, `total` | One length of time: `15 min`, `1 hr 30 min`, `1.5 hours`, `1 1/2 hours`, `1h30m`, `1:30` (1 hour 30 minutes), or `PT1H30M`. Anything else, such as `overnight` or `10-15 min`, is shown on the card as written and left out of the search-engine data. `total` defaults to prep plus cook when both are given. Also `prepTime`, `cookTime`, `totalTime`. |
| `cuisine`, `course` | Shown on the card and given to search engines. `category` also works for `course`. |
| `calories` | Free text, per serving, such as `520 kcal`. |

**Sections.** The labels must be headings (`## Ingredients`), not bold text, and each
ingredient and step must be a list item (`- ` or `1. `); `openblog check` warns about a
recipe with no ingredients or no steps. An ingredients section starts at a heading that
begins with "Ingredients", "What you need", "You will need", or "You'll need" (also
Ingrédients, Ingredientes, Ingredienti, Ingrediënten, Zutaten). A steps section starts at
"Steps", "Method", "Instructions", "Directions", "Preparation", or "How to make" (also
Étapes, Préparation, Instrucciones, Preparación, Pasos, Elaboración, Procedimiento,
Procedimento, Preparazione, Zubereitung, Anleitung, Bereiding). Sub-headings inside a
section, such as `### For the sauce`, are fine. A section ends at the next heading with
the same number of `#` or fewer, or at a heading that starts the other kind of section.
Paragraphs inside a section are shown but get no checkbox or timer. Everything else in
the post, such as the story before the recipe or notes after it, is ordinary Markdown.

**Amounts.** Scaling changes the number at the start of each ingredient: `2`, `1.5`,
`1,5`, `1,000`, `1/2`, `1 1/2`, `1-1/2`, `½`, and ranges like `2-3`. A second measure
right after the unit is scaled too (`12 oz / 340 g`, `1 cup (240 ml)`). Fractions stay
fractions, rounded to the nearest eighth, sixth, quarter or third (`¾ cup`); decimals and
metric amounts stay decimals, and grams and millilitres are whole numbers from 10 up.
Lines that do not start with a number, such as "Salt, to taste", are left alone, and so
are amounts written in the steps, so put quantities in the ingredient list. The chosen
number of servings is remembered on the reader's device.

**Timers** recognise hours, minutes, and seconds, written out or as hr, hrs, min, mins,
sec, secs: `10 minutes`, `1 1/2 hours`, `1 hr 30 mins`, `2 minutes 30 seconds`, and
`20-25 minutes`, which starts at 20. Single letters (`1h`, `10m`) and other languages'
words are not recognised. A timer runs while the page is open; when it finishes, the
button says "Done" and the device beeps and vibrates if it can. Turn on Cook mode so the
screen does not go to sleep meanwhile.

**Search engines** show a recipe result only for recipes with a photo, so set `cover` or
put an image in the post.

Each extra can be switched off for the whole blog under `recipes` in
[Configuration](configuration.md#recipes).

## Series

A series groups posts in reading order and gets its own page. Create
`content/series/<slug>.md`:

```markdown
---
name: Getting started
description: Three short parts that cover the basics.
theme: paper          # optional: every post in the series uses this theme
cover: /images/getting-started.png
order: 1              # position on the /series/ page (lower first)
---

Optional Markdown shown at the top of the series page.
```

Posts join with `series: getting-started`. Each post then shows "Part 2 of 3" with
previous and next links and a list of all parts. If you reference a series that has no
file, one is created from the slug and the build prints a warning.

## Pages

Pages live in `content/pages/` and have no date, tags, or series:

```markdown
---
title: About
nav: true             # add to the header navigation
description: About this blog.
theme: paper          # optional
---

Text.
```

A page named `about.md` is served at `/about/`. The slugs `series`, `tags`, `archive`,
`search`, `page`, `themes`, `assets`, and `api` are reserved by the engine.

## What the engine generates

| Address | Content |
| --- | --- |
| `/` and `/page/2/` ... | The post list, newest first, with a series overview |
| `/posts/<slug>/` | A post (pattern set by `postPath`) |
| `/series/` and `/series/<slug>/` | Series overview and each series that has at least one published post (a series whose parts are all drafts or scheduled has no page yet) |
| `/tags/` and `/tags/<slug>/` | Tags and the posts in each |
| `/archive/` | Every post by year |
| `/search/` | Client-side search |
| `/<page>/` | Pages |
| `/rss.xml`, `/feed.json` | Feeds |
| `/sitemap.xml`, `/robots.txt` | For search engines |
| `/api/blog.json` | The four newest posts as JSON, for other sites |
| `/404.html` | The not-found page most hosts serve automatically |

## Checking your work

```sh
openblog check     # lists every problem with the file name and the reason
openblog build     # the same checks, then writes dist/
```

Typical problems: a missing `date`, a date in an unrecognised format, two posts with the
same slug, a theme that does not exist, or an alias that collides with a real page.
