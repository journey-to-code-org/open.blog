---
title: Writing in Studio
subtitle: A browser editor for your blog that still saves plain Markdown files.
date: 2026-04-27
updated: 2026-11-17
coverAlt: "Studio's Home screen, with Write something new at the top and the posts in progress below."
series: writers-toolkit
seriesOrder: 7
aliases:
  - /posts/writing-in-the-admin-editor/
tags:
  - guide
  - studio
description: A tour of writing in Studio, covering the writing screen, Add something, photos, About this post, the checks before you publish, and drafts, scheduled and published posts.
---

Everything in this series can be written without learning any Markdown. Studio is the
sign-in protected editor served by your own blog. It reads and writes the same files you would
edit by hand, so you can switch between Studio and a text editor whenever you like.

## Turning it on

```sh
openblog user add you      # choose a password of at least 12 characters
openblog serve --admin     # then open http://localhost:8080/admin
```

To run it on the public internet, read [Studio: running your blog](https://journey-to-code-org.github.io/open.blog/docs/admin/) first. It
covers HTTPS, secure cookies and running behind a proxy.

## Where you start

Home asks "What would you like to do?" and offers **Write something new**. Under it are the
drafts to keep going with, the posts coming up, and what was published last. **Posts** lists
everything, with a box to find a post by name.

> [!TIP]
> Press `Ctrl+K` to find anything: open a post, go to a screen, or start something new.

![Studio's Home screen: Write something new at the top, then a draft, a scheduled post and the newest published posts.](/images/studio/home.jpg)

## The writing screen

A post is a **Title** and its **Words**. Leave an empty line between paragraphs, and start
each line of a list with a dash. Photos, tips and tables show in your words as cards, each
with its own buttons, so an ordinary edit never scrambles them.

Beside the words are the things a post needs:

- **When it appears**: a date and a time. Leave it empty to use the day you publish.
- **Tags**, and the **Collection** the post belongs with.
- **Cover photo**: a new one, or one already on your site.

![Studio's writing screen open on a recipe, with Serves, Time to get ready and Time to cook above the recipe's words.](/images/studio/write-recipe.jpg)

## Add something

**Add something** puts in any of the [ready-made pieces](/posts/buttons-maps-hours-and-faqs/):
a photo, a tip or a note, a checklist, a table, a video, a link, a heading, opening hours,
how to reach you, [before and after photos](/posts/before-and-after-photos/), a quote,
questions and answers, [a question for readers](/posts/knowledge-checks/), a button, links to
your other pages and a map. Typing `/` on an empty line opens the same list.

## Photos

**Put a photo in** adds one where you are writing. Uploads are saved under
`static/images/uploads/<year>/`, so they live in your site's folder like everything else.

## About this post

**About this post** holds the rest, as a form:

- **What kind of post**: a story, a recipe, a job, or writing with sources. The screen shows
  the fields that kind needs, such as servings and times for a recipe.
- **A line under the title**, and whether **Comments** are open.
- **Summary**: one or two sentences for search results. Left empty, the blog uses the first
  lines of the post.
- **How your post looks when it's shared**, and **Who wrote it**.

Fields you added to the file by hand that the form does not know about are kept.

## Checking before you publish

- **See how it looks** builds the page from what you have written, before anything is saved to
  the site.
- **Before you publish** checks the post and lists what it finds, with how to fix each. It
  says so itself: checks catch some things, not everything.

## Draft, scheduled or published

Every post is one of three things:

- **Draft**: never public. **Save draft** keeps it.
- **Scheduled**: a date and time still to come. The server publishes it by itself at that moment.
- **Published**: the date is now or in the past.

**Publish** puts the post on your site. On a post that is already published the button is
**Update**. **More** has the rest: copy the post for another blog, put a recording with it,
or delete it.

## The optional writing helper

Connect an AI provider and Studio can help with a draft. It is off until you set it up, it
says what it will send before it sends anything, and nothing it suggests changes your words
until you choose it. The provider's key stays on the server.

That is the end of the toolkit. [The tour of Studio](/studio/) shows the other screens. For
posts readers can *run*, continue with [Teaching with code](/series/teaching-with-code/).
