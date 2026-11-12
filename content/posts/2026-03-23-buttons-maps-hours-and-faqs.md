---
title: Buttons, maps, opening hours and FAQs
subtitle: Ready-made pieces you can drop into any post, with no HTML.
date: 2026-03-23
series: writers-toolkit
seriesOrder: 2
tags:
  - guide
  - pieces
description: Add a button, a captioned image, a privacy-friendly video or map, opening hours, contact details, social links and a FAQ to any post, written as simple fields.
---

Some things are hard to write in Markdown: a button that looks like a button, a map, a neat
table of opening hours. open.blog has ready-made **pieces** for these. Each one is a short block
of `field: value` lines. The build checks it, renders it accessibly, and turns it into a plain
link wherever it cannot run, such as feed readers and copies on other sites.

> [!TIP]
> You do not have to write these by hand. In the Admin editor, choose **Add something** in the
> Write toolbar, pick a piece, fill in the form and choose **Insert**. The form uses the build's
> own rules, so it tells you about a problem before anything is added.

The examples below are for an invented corner bakery.

## Button

```piece button
label: See this week's bread list
href: /series/from-the-kitchen/
style: primary
```

````markdown
```piece button
label: See this week's bread list
href: /series/from-the-kitchen/
style: primary
```
````

`style` is `primary` (filled) or `secondary` (outlined). `href` can be a page on this site, an
`https://` address, `mailto:` or `tel:`. Anything else is refused with a message, so a piece can
never carry a `javascript:` link.

## Image with a caption

```piece image
src: /images/open-blog-og.png
alt: The open.blog social card, with the name, the tagline "Markdown in. A fast, themeable blog out." and a sample post file on a dark background
caption: A caption sits under the picture. The description is for people who cannot see it.
```

````markdown
```piece image
src: /images/open-blog-og.png
alt: The open.blog social card, with the name, the tagline "Markdown in. A fast, themeable blog out." and a sample post file on a dark background
caption: A caption sits under the picture.
```
````

The `alt` description is required. A picture without one stops the build, because a reader using
a screen reader would otherwise get nothing.

## Video

```piece video
provider: youtube
video: jNQXAC9IVRw
title: Me at the zoo, the first video uploaded to YouTube
```

````markdown
```piece video
provider: youtube
video: jNQXAC9IVRw
title: Me at the zoo, the first video uploaded to YouTube
```
````

`video` takes the video's code or its full address. YouTube plays from `youtube-nocookie.com`
and Vimeo with do-not-track on. The frame loads only when the reader scrolls to it, and a plain
link sits beside it.

## Map

```piece map
provider: openstreetmap
label: Meet us at the Royal Observatory, Greenwich
lat: 51.4769
lon: -0.0005
```

````markdown
```piece map
provider: openstreetmap
label: Meet us at the Royal Observatory, Greenwich
lat: 51.4769
lon: -0.0005
```
````

To find the numbers, right-click a spot on [openstreetmap.org](https://www.openstreetmap.org/)
and choose **Show address**. The latitude and longitude are at the top of the panel.

## Opening hours

```piece hours
note: Closed on public holidays.
days: Tuesday to Friday
hours: 7am to 3pm
days: Saturday
hours: 8am to 1pm
days: Sunday and Monday
hours: Closed
```

````markdown
```piece hours
note: Closed on public holidays.
days: Tuesday to Friday
hours: 7am to 3pm
days: Saturday
hours: 8am to 1pm
```
````

A list piece repeats its first field to start each row: every `days` line starts a new row, and
the `hours` line after it fills that row in.

## Contact details

```piece contact
email: hello@example.com
phone: +1 555 0100
address: 12 Mill Street, Maple Falls
```

````markdown
```piece contact
email: hello@example.com
phone: +1 555 0100
address: 12 Mill Street, Maple Falls
```
````

The email and phone become tap-to-email and tap-to-call links on phones.

## Social links

```piece social
label: Mastodon
href: https://mastodon.social/@example
label: Instagram
href: https://www.instagram.com/example/
```

````markdown
```piece social
label: Mastodon
href: https://mastodon.social/@example
label: Instagram
href: https://www.instagram.com/example/
```
````

Social links must be `https://` addresses.

## Questions and answers

```piece faq
question: Do you bake gluten-free bread?
answer: On Saturdays. Order by Thursday so we can bake it **first**, before anything else.
question: Can I order a cake?
answer: Yes. Give us three days' notice, and see the [kitchen series](/series/from-the-kitchen/) for ideas.
```

````markdown
```piece faq
question: Do you bake gluten-free bread?
answer: On Saturdays. Order by Thursday so we can bake it **first**.
question: Can I order a cake?
answer: Yes. Give us three days' notice.
```
````

Answers are Markdown, so bold text and links work. A value can continue on the next line if that
line is indented by two spaces.

## When a piece is wrong

A piece that does not pass its checks shows an error message in its place, and `openblog check`
and `openblog build` report it with the file name. Your post is never published with a broken
piece that you did not notice.

The same pieces are available as sections on the home page. See
[Making it look like yours](/posts/making-it-look-like-yours/).

Next: [Before and after photos](/posts/before-and-after-photos/).
