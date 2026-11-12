---
title: Before and after photos
subtitle: A drag-to-compare slider that still works as two captioned pictures everywhere else.
date: 2026-03-30
series: writers-toolkit
seriesOrder: 3
tags:
  - guide
  - pieces
  - images
description: Pair two photos in a compare block and readers drag a handle to see the change. Feeds and copies on other sites get two labelled, described pictures instead.
cover: /images/demo/floor-after.svg
coverAlt: An oak floor sanded and sealed to a warm honey colour.
---

A renovation, a restored photo, a garden through the seasons, a website redesign: some stories
are best told as *before* and *after*. A `compare` block puts two pictures in one frame, and
readers drag the handle to reveal one over the other.

```compare
before: /images/demo/floor-before.svg
before-alt: A worn grey oak floor with dark water stains and a crack near the doorway
before-caption: Day one. Eighty years of wear, two water stains and a split board.
after: /images/demo/floor-after.svg
after-alt: The same oak floor sanded and sealed, a warm honey colour with an even matte sheen
after-caption: Day three. Sanded, stained board replaced, two coats of matte finish.
after-label: Finished
```

Try it with a mouse, a finger, or the keyboard: focus the slider and use the arrow keys.

## How it is written

````markdown
```compare
before: /images/demo/floor-before.svg
before-alt: A worn grey oak floor with dark water stains and a crack near the doorway
before-caption: Day one. Eighty years of wear, two water stains and a split board.
after: /images/demo/floor-after.svg
after-alt: The same oak floor sanded and sealed, a warm honey colour with an even matte sheen
after-caption: Day three. Sanded, stained board replaced, two coats of matte finish.
after-label: Finished
```
````

| Field | Needed | What it does |
| --- | --- | --- |
| `before`, `after` | yes | The picture: a file on this site or an `https://` address |
| `before-alt`, `after-alt` | yes | A description for people who cannot see the picture |
| `before-caption`, `after-caption` | no | Text under each picture |
| `before-label`, `after-label` | no | The tag on each side. Defaults to "Before" and "After" |

Put your photos in `static/images/`. A file at `static/images/kitchen-before.jpg` is written as
`/images/kitchen-before.jpg`. Take both photos from the same spot and at the same zoom, so the
slider lines them up.

## The easy way: the Admin

In the Admin editor, choose **Add something**, then **Before and after**. For each side you can
type an address or **choose a file** from your computer or phone. A chosen file is uploaded like
any other image and its address is filled in for you. **Insert** checks the pair and tells you
what is missing, for example that the after picture needs a description.

## Where the slider cannot run

Readers without JavaScript, readers who have asked their device to reduce motion, feed readers,
and copies of the post on other platforms all get two captioned pictures, each with its label.
Nothing is lost. A missing picture or description, or a field the block does not know, stops the
build with a plain message instead of publishing a broken comparison.

Want to see it in a real job write-up? [Bringing back a 1920s oak floor](/posts/bringing-back-a-1920s-oak-floor/)
uses this exact pair.

Next: [Code blocks that explain themselves](/posts/code-blocks-that-explain-themselves/).
