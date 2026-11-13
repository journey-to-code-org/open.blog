---
title: Diagrams from plain text
subtitle: Write a few lines of Mermaid and get a diagram that follows your colours, reads aloud and travels.
date: 2026-11-13
series: writers-toolkit
seriesOrder: 8
tags:
  - guide
  - code
description: Draw flowcharts, sequence diagrams and more from a few lines of Mermaid, described for screen readers, coloured by your look and sent everywhere else as an image.
coverDiagram: 1
---

A diagram that lives in your post as text is easy to change: no drawing app, no exported image to
replace, and the change shows up in a diff. open.blog draws it when the site is built, so readers
get a picture with no JavaScript, in your look's colours, light or dark.

## Your first diagram

Put [Mermaid](https://mermaid.js.org/) source in a fence that starts with `mermaid`, and give it a
title and a description:

````markdown
```mermaid title="From draft to readers" description="A post is written as a draft, published, built into the site, and then read on the site, in feeds and on other sites."
flowchart LR
  Draft --> Published --> Built
  Built --> Site & Feeds & Elsewhere
```
````

This is what it draws. Each box links to the post that explains that step; the links are also
listed under the diagram.

```mermaid title="From draft to readers" description="A post is written as a draft, published, built into the site, and then read on the site, in feeds and on other sites." caption="The life of a post, each step linked to the post about it"
flowchart LR
  Draft[Write a draft] --> Published[Publish]
  Published --> Built[Build the site]
  Built --> Site[Your site]
  Built --> Feeds[Feeds]
  Built --> Elsewhere[Other sites]
  click Draft "/posts/writing-a-post/"
  click Published "/posts/publishing-and-scheduling/"
  click Feeds "/posts/feeds-and-your-posts-on-other-sites/"
  click Elsewhere "/posts/automated-cross-posting/"
```

Open **Show diagram source** under it to see the Mermaid; readers can copy it too.

## The title and description are not optional

A screen reader cannot see the boxes, so it reads the title and the description instead. A post
whose diagram has neither is not published; a draft shows a warning that says what to add. Write
the description as you would tell someone the diagram on the phone: what leads to what, not the
shapes.

## More than flowcharts

Sequence diagrams show who talks to whom, in order:

```mermaid title="Publishing from Admin" description="You press Publish; Admin checks the post, builds the site and pushes it to git, and the host deploys it."
sequenceDiagram
  actor You
  participant Admin
  participant Git
  participant Host
  You->>Admin: Publish
  Admin->>Admin: Check and build
  Admin->>Git: Push
  Git->>Host: Deploy
  Host-->>You: Live
```

State diagrams, class and entity-relationship diagrams, git graphs and C4 diagrams work the same
way. In Admin, **Add diagram** in the editor starts from an example and shows a live preview.

## Colours that follow your look

The renderer's colours are swapped for your look's, so the diagrams above change with dark mode
and print in black and white. If you colour a node yourself, also set its text colour, so the
pair stays readable:

```mermaid title="One highlighted step" description="Three steps in a row; the middle one, Build, is highlighted in dark blue with white text."
flowchart LR
  Write --> Build --> Read
  style Build fill:#1e3a8a,color:#ffffff
```

## Everywhere else

Feeds and other sites cannot run Mermaid, so they get a PNG of each diagram with its title and
description as the image's text, and the source after it. This post's link preview is its first
diagram: `coverDiagram: 1` in the front matter made it the cover.

The [Diagrams guide](https://github.com/journey-to-code-org/open.blog/blob/main/docs/diagrams.md)
has every option and limit.
