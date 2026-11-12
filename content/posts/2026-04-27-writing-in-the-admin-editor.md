---
title: Writing in the Admin editor
subtitle: A word processor for your blog that still saves plain Markdown files.
date: 2026-04-27
series: writers-toolkit
seriesOrder: 7
tags:
  - guide
  - admin
description: A tour of the browser editor, covering Visual mode, Add something, image uploads, previews, readiness and accessibility checks, the optional AI Assistant, and scheduling.
---

Everything in this series can be written without learning any Markdown. The Admin editor is a
login-protected writing studio served by your own blog. It reads and writes the same files
you would edit by hand, so you can switch between the editor and a text editor whenever you like.

## Turning it on

```sh
openblog user add you      # choose a password of at least 12 characters
openblog serve --admin     # then open http://localhost:8080/admin
```

To run it on the public internet, read the
[Admin guide](https://github.com/journey-to-code-org/open.blog/blob/main/docs/admin.md#running-it-for-real)
first. It covers HTTPS, secure cookies and running behind a proxy.

## A calm start

New accounts start in the **Simple** workspace, with just **Write**, **Site preview** and
**Settings** on show. When you want more, open **Personalize** in the header and choose:

- **Guided**, which adds accessibility review, research checks and the Assistant;
- **Advanced**, which shows every tool; or
- **Custom**, which lets you pick tools one by one and put them in your own order.

These choices belong to your login only. They never change a post or the published site.

> [!TIP]
> Press `Ctrl+K` (`Command+K` on a Mac) to search every command: open a post, create one, switch
> views or save. `Alt+1` to `Alt+9` jump straight to Write, Site preview, Settings and the other views.

## Visual or Markdown

**Visual** mode works like a word processor: headings, bold, italic, links, lists, quotes,
images and code. **Markdown** mode shows the file exactly as it is saved. Switch at any time.

Some things, such as callouts, tables, quizzes and pieces, appear in Visual mode as *protected
blocks*, so an ordinary edit can never scramble their syntax. Most have an **Edit** button that
opens a small form: a callout's kind and text, a table's rows and columns, a piece's details.

## Add something

**Add something** in the Write toolbar inserts any of the
[ready-made pieces](/posts/buttons-maps-hours-and-faqs/) (button, image with caption, video, map,
opening hours, contact details, social links, questions and answers, call-out) and
[before-and-after pairs](/posts/before-and-after-photos/). Fill in the form, choose **Insert**,
and `Ctrl+Z` takes it back out.

## Pictures

Insert an image with the toolbar button, drag one in, or paste it. Uploads are saved under
`static/images/uploads/<year>/`, so they live in your site's folder like everything else.

## Settings: the front matter as a form

**Settings** turns the front matter into labelled fields: title, description, tags, series, cover
image, and the **Content profile** that turns a post into a recipe, a job, a field journal, a
video page or a research article. Fields you added by hand that the form does not know about are
kept.

## Checking before you publish

- **Site preview** builds the page from your unsaved draft at desktop, tablet or phone width.
- **Search & answer readiness** is a checklist of what search engines look for: a clear
  description, descriptive headings, alt text on images. It is guidance, not a made-up score.
- **Accessibility** lists problems with their exact location and how to fix them, such as an
  image without a description or a skipped heading level.
- **Social** shows the card that appears when someone shares the post.

## The optional Assistant

Connect an AI provider (Anthropic, OpenAI, Gemini, Mistral and others) and the **Assistant**
(`Alt+0`) can review a draft, propose exact edits you accept or undo, draft knowledge checks and
runnable examples, and offer autocomplete. The provider key stays on the server and is never sent
to your browser. Nothing is saved or published without you.

**Voice samples** help it sound like you. Write a three-minute answer to a prompt with
`openblog voice` or the **Voice** view. Samples stay private, are never published, and can be
given to the Assistant as examples of how you write.

## Draft, scheduled or published

Every post is one of three things:

- **Draft**: never public.
- **Scheduled**: a future date and time. The server publishes it by itself at that moment.
- **Published**: the date is now or in the past.

When you are happy, **Publish** in the header commits your changes with Git and pushes them, so
your hosting rebuilds the site. Drafts stay on your machine. Deleting a post moves it to
`.openblog/trash/`, so nothing is ever destroyed by accident.

That is the end of the toolkit. For posts readers can *run*, continue with
[Teaching with code](/series/teaching-with-code/).
