# ADR 0269: A theme may frame every code block as it writes the page

- Status: Accepted
- Date: 2026-10-28

## Context

A fence with a title is written as `<figure class="ob-code-block">` with a
`<figcaption class="ob-code-title">`, and themes style that as a window. A plain fence is a bare
`<pre><code>`. A theme that wanted every block in a window had a script wrap each plain `<pre>` after
the page loaded, which is DOM work after paint and moves the page when a block is near the top.

Post Markdown is rendered once, when the site loads, before the page's theme is known, so the
Markdown renderer cannot decide per theme.

## Decision

- **A theme option, `codeWindows`.** When a page is written for a theme that sets it, each plain
  `<pre><code>` in the post (and in a series page's own content) is wrapped in the markup a titled
  block already has, captioned with what the block shows: Rust, Terminal (bash, sh, shell,
  shell-session, console), Diff, the fence language, or Code.
- **It is a pass over the rendered HTML** (`code_windows::frame`), not a change to Markdown output.
  It skips blocks already inside a titled figure or a runnable example (`ob-rust-playground`,
  `ob-code-runner`, `ob-web-sandbox`). A caption keeps only characters that belong in a language
  name, so a hand-written class never becomes markup.
- **Only themed pages change.** Feeds, syndication and portable copies are written from the
  unthemed Markdown and keep plain blocks.

## Consequences

- A theme gets code windows without a script, and they are there at first paint, styled like titled
  blocks with the same copy button, highlighting and line numbers.
- Nothing changes for a theme that does not set it.
