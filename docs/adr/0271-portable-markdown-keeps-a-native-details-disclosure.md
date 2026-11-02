# ADR 0271: Portable Markdown keeps a native details disclosure

- Status: Accepted
- Date: 2026-10-28

## Context

The portable Markdown export (a post's `.md` copy and the body sent to DEV, Hashnode and Medium)
shows every raw HTML fragment as literal source, so no destination runs or lays out markup the
author wrote for open.blog. A post that folds a long file behind
`<details><summary><code>src/main.rs</code> · 56 lines</summary>` arrived on Hashnode as literal
`&lt;details&gt;` text around an unfolded block.

The export already writes the same disclosure itself: a Rust check's spoiler is
`<details><summary>...</summary>...</details>` in portable Markdown, because the destinations render
it and it degrades to visible content where they do not.

## Decision

- **An authored native disclosure stays markup.** A raw HTML fragment is kept as written when it has
  a `<details>` or `<summary>` tag and every tag in it is `details` (with nothing but a bare `open`),
  `summary`, or a plain `code`, `strong`, `em`, `b` or `i`, all without attributes, and it has no
  comment or other markup (`raw_html::portable_disclosure`).
- **Tags stay paired.** The export counts the `<details>` it has kept; a `</details>` is kept only
  when it closes one of them, so a disclosure whose opening tag had to be escaped (it had an `id`)
  never leaves a stray closing tag.
- **Everything else is unchanged.** Other raw HTML is still literal source, the portable export note
  counts only what was escaped, and the "raw HTML is literal" review notes name the exception.

## Consequences

- Collapsible file listings and notes arrive collapsible on every Markdown destination; where a
  destination ignores `<details>`, the reader sees the summary and the content.
- An author who wants a disclosure kept writes it without attributes.
