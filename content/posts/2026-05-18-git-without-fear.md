---
title: Git without fear
subtitle: An in-browser Git you can break on purpose, and a guided terminal that checks each command.
date: 2026-05-18
series: teaching-with-code
seriesOrder: 4
tags:
  - tutorial
  - git
  - teaching
description: Two lesson demos for teaching Git. A sandbox where readers branch, merge and cause conflicts safely, and a practice terminal that sets one goal at a time.
---

Git is easier to understand by doing than by reading, but practising on a real project is scary.
These two demos give readers a pretend repository in their browser. Nothing is installed, nothing
is sent anywhere, and nothing they do can break anything real.

## The sandbox: break Git on purpose

Type commands, or use the buttons. Try `git branch idea`, `git switch idea`, make a commit, switch
back to `main`, commit there too, and then `git merge idea`.

```demo git-sandbox title="Break Git on purpose"
Branch, commit on both sides, then merge: Git creates a **merge commit with two parents**.
If both sides changed the same line of the same file, Git stops with a **conflict** and asks you
to choose. The sandbox draws the commit graph as you go, so you can see each branch as a pointer
to a commit.
```

## The practice terminal: one goal at a time

The practice terminal sets one goal at a time and checks the command the reader types. A wrong
command gets a hint. A right one shows what Git would print, and why. This lesson is a first
workflow, from `git init` to the first commit:

```demo git-practice lesson="first-workflow" title="Your first Git workflow"
Turn a folder into a repository with `git init`, check what changed with `git status`, stage a
file with `git add`, and save it with `git commit -m "First commit"`. Each step shows the output
Git would print and explains what just happened.
```

And this one is for the day something goes wrong:

```demo git-practice lesson="undo-and-rescue" title="Undo and rescue"
Throw away uncommitted edits with `git restore`, undo a commit you have not shared, and find
"lost" work again with `git reflog`. Git rarely deletes anything you committed.
```

## How they are written

````markdown
```demo git-sandbox title="Break Git on purpose"
Branch, commit on both sides, then merge: Git creates a **merge commit with two parents**.
```

```demo git-practice lesson="first-workflow" title="Your first Git workflow"
Turn a folder into a repository with `git init`...
```
````

Name the kind after `demo`. The text inside is the **fallback**: what readers see when the demo
cannot run, which means readers without JavaScript, feed readers, and copies of your post on
other platforms. There it appears under the title with a link to the live version. Write it as a
short worked example rather than "a demo goes here", because for some readers it *is* the lesson.

The fallback is Markdown, but it cannot hold raw HTML or images, and links must be full
`https://` addresses. `openblog check` reports a body that breaks these rules, or a kind it does
not know.

## Practice lessons available

`git-practice` takes a `lesson="…"` id. The lessons include `first-time-setup`,
`first-workflow`, `log-and-branches`, `branch-and-merge`, `remote-roundtrip`, `stash`,
`amend-and-cherry-pick`, `undo-and-rescue`, `interactive-rebase`, `bisect`, `worktree`,
`partial-staging`, `hooks`, `remove-a-secret` and more. They are all defined in
`web/components/ob-practice-model.js`.

Next: [A tour of the lesson demos](/posts/a-tour-of-the-lesson-demos/).
