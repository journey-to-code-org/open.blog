---
title: Knowledge checks
subtitle: Quick multiple-choice questions with instant, private feedback.
date: 2026-04-13
series: writers-toolkit
seriesOrder: 5
tags:
  - guide
  - teaching
description: Add a multiple-choice question to any post. Readers get instant feedback, their answers never leave their browser, and the Admin can draft questions for you.
---

A question in the middle of a lesson tells readers whether they really followed it, and it
helps them remember. A knowledge check is a short multiple-choice question. Readers get
feedback as soon as they choose, and they can try again.

Try these three, written about the earlier parts of this series:

```quiz
Which line turns a quote into a yellow warning callout?
- [ ] `> WARNING:`
- [x] `> [!WARNING]`
- [ ] `!!! warning`
> The marker goes alone on the first line of the quote, in square brackets with an exclamation mark.
```

```quiz
In a `compare` block, which fields are required for each side?
- [ ] The picture and its caption
- [ ] The picture and its label
- [x] The picture and its description
> Descriptions (`before-alt`, `after-alt`) are required so readers who cannot see the pictures still get the story.
```

```quiz
What does `{3-4}` after a code fence's language do?
- [ ] Shows only lines 3 and 4
- [x] Highlights lines 3 and 4
- [ ] Numbers the block from line 3
> `showLineNumbers=3` would number from 3. Braces highlight lines, counted from the top of the block.
```

## How to write one

````markdown
```quiz
Which line turns a quote into a yellow warning callout?
- [ ] `> WARNING:`
- [x] `> [!WARNING]`
- [ ] `!!! warning`
> The marker goes alone on the first line of the quote.
```
````

- The first line is the question.
- Give two to four choices as a task list, with exactly one checked `[x]`.
- An optional last line starting with `>` explains the answer. It is shown after the reader
  chooses.
- Questions, choices and explanations can use *emphasis*, ~~strikethrough~~ and `code`. Links,
  images, HTML and multiple lines are not allowed, which keeps questions short and safe in feeds.

If a question breaks a rule, for example two checked answers, `openblog check` reports it
instead of publishing it.

## Privacy

A reader's answers are remembered only in their own browser, so the question shows what they
chose when they come back. Answers are never sent to the blog, its analytics or anyone else.
In feed readers and copies on other sites, the question appears with the answer marked, because
those places cannot run it.

## Letting the Admin write them

In the Admin editor, choose **Add knowledge check** to fill in a form instead of writing the
block. You can add up to three questions at once.

If an AI provider is set up for the Admin's Assistant, select some of your text (or put the
cursor in a section), open the same form, and choose **Generate draft**. The questions it drafts
stay editable, and nothing is added to your post until you choose **Insert**.

Next: [Moving a post without breaking links](/posts/moving-a-post-without-breaking-links/).
