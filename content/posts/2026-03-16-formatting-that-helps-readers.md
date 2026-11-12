---
title: Formatting that helps readers
subtitle: Callouts, footnotes, tables, task lists, collapsible sections and an automatic table of contents.
date: 2026-03-16
series: writers-toolkit
seriesOrder: 1
tags:
  - guide
  - markdown
description: The Markdown features that make long posts easy to scan, from coloured callouts and footnotes to tables and a table of contents that builds itself.
---

Readers skim before they read. A good post gives them signposts: a warning they cannot miss, a
table they can scan, a side note that stays out of the way. Everything here is plain Markdown,
and the source sits under each example so you can copy it.

Notice the **table of contents** on this page. You did not have to write it. Any post with three
or more section headings gets one, and every heading gets an anchor link: hover over a heading
and click the `#` to copy a link straight to that section.

## Callouts

A callout is a quote whose first line names its kind. There are five, each with its own colour:

> [!NOTE]
> Useful background the reader might otherwise miss.

> [!TIP]
> A shortcut or a better way of doing something.

> [!IMPORTANT]
> Something the reader needs to know to succeed.

> [!WARNING]
> Something that could cause a problem if ignored.

> [!CAUTION]
> Something that could cause real harm or lose work.

```markdown
> [!TIP]
> A shortcut or a better way of doing something.
```

Put the marker alone on the first line. If anything else is on that line, you get an ordinary
quote that shows the marker. In the Admin's Visual mode, a callout has an **Edit** button that
opens a small form for its kind and text.

## Footnotes

Footnotes keep asides and sources out of the main sentence.[^aside] Write a marker where the note
belongs and the note itself anywhere in the file. open.blog numbers them and collects them at
the end of the post, with links back.[^source]

```markdown
Footnotes keep asides out of the main sentence.[^aside]

[^aside]: This is the aside. It appears at the bottom of the post.
```

## Tables

| Feature | You write | Readers get |
| --- | --- | --- |
| Callout | `> [!NOTE]` | A coloured, titled box |
| Footnote | `text[^1]` | A numbered note at the end |
| Task list | `- [x] done` | A checklist |
| Strikethrough | `~~old~~` | ~~old~~ |

```markdown
| Feature | You write |
| --- | --- |
| Callout | `> [!NOTE]` |
```

Colons in the divider row align a column: `| :--- |` left, `| :---: |` centre, `| ---: |` right.
The Admin can also edit a table as rows and columns, without any pipes.

## Task lists

- [x] Draft the post
- [x] Add a description
- [ ] Choose a cover image
- [ ] Publish

```markdown
- [x] Draft the post
- [ ] Choose a cover image
```

## Collapsible sections

Raw HTML passes through, so a `<details>` block makes a section readers can open on demand.
It is handy for long answers, spoilers or optional detail.

<details>
<summary>Why does open.blog allow raw HTML?</summary>

Because your posts are yours. If Markdown cannot express something, HTML can. Portable copies
for other platforms are stricter: they keep simple HTML like this, but remove scripts and turn
embedded frames into links.

</details>

```html
<details>
<summary>Why does open.blog allow raw HTML?</summary>

Markdown works inside, as long as there is a blank line after the summary.

</details>
```

## Subtitles and descriptions

This post has a subtitle under its title. It comes from one front matter line, and it is separate
from the `description`, which goes to search results, feeds and social cards:

```yaml
subtitle: Callouts, footnotes, tables, task lists, collapsible sections and an automatic table of contents.
description: The Markdown features that make long posts easy to scan...
```

## Tuning the table of contents

The table of contents appears at three headings and includes headings down to `###`. Change
both in `openblog.json`:

```json
"markdown": {
  "headingAnchors": true,
  "tocDepth": 3,
  "tocMinHeadings": 3
}
```

Next: [Buttons, maps, opening hours and FAQs](/posts/buttons-maps-hours-and-faqs/).

[^aside]: This is the aside. Notice it did not interrupt the sentence above.
[^source]: Footnotes are part of the GitHub extensions to CommonMark, along with tables, task
    lists and strikethrough.
