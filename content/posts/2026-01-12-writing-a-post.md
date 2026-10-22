---
title: Writing a post
date: 2026-01-12
series: getting-started
seriesOrder: 1
tags:
  - guide
  - markdown
description: What goes in a post file, which Markdown features work, and how images and code blocks are handled.
---

A post is a Markdown file in `content/posts/`. The file name can start with a date
(`2026-01-12-writing-a-post.md`); the rest becomes the slug, so this post lives at
`/posts/writing-a-post/`. Add `slug:` to the front matter to choose a different one.

## Front matter

```yaml
---
title: Writing a post
date: 2026-01-12           # or a full time: 2026-01-12T09:30:00Z
tags: [guide, markdown]    # inline lists work too
description: Optional. Used in feeds and search results.
cover: /images/cover.png   # optional; the first image in the body is the fallback
draft: false
---
```

Dates without a time are midnight UTC. A post dated in the future is *scheduled* and stays
hidden until that moment (part three has the details).

## Markdown that works

CommonMark plus the GitHub extensions: tables, task lists, footnotes, and strikethrough.
Headings get ids and anchor links, so `#markdown-that-works` links here.

| Feature | Syntax |
| --- | --- |
| Task list | `- [x] done` |
| Footnote | `text[^1]` |
| Strikethrough | `~~old~~` |

- [x] Write the post
- [ ] Publish it

Code blocks keep their language for styling and the copy button:

```rust
fn main() {
    println!("Hello from a code block");
}
```

## Images

Put files in `static/`; they are copied to the site root. `static/images/photo.png` is
`/images/photo.png`:

```markdown
![A short description](/images/photo.png)
```

The admin editor uploads and inserts images for you, including by drag and drop or paste.

Next: [Tags and series](/posts/tags-and-series/).

[^1]: Footnotes render at the end of the post.
