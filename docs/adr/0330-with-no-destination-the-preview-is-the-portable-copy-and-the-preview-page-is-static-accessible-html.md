# ADR 0330: With no destination the preview is the portable copy, and the preview page is static, accessible HTML

- Status: Accepted
- Date: 2026-10-29
- Parent epic: [#381](https://github.com/journey-to-code-org/open.blog/issues/381)
- Story: #390 (task DIST1.2.3)

## Context

Distribution must never be required: a self-hosted static site has no provider, no credential and no hosted service,
and it must keep working and produce the same output. The epic also asks for an accessible preview and an explicit,
graceful disabled state.

## Decision

- **No destination is a state, not an error, for a preview.** When no syndication target is configured or enabled,
  `--preview` writes a plan with no destinations and a `fallback` (`reason: "no-destination"`) holding the post's
  portable Markdown, saved as `portable.md`, and a page that says the post stays on the author's site and how to
  import the copy by hand or configure a destination. There is nothing to approve. An unknown `--target` name is
  still an error, and the ordinary dry run keeps its existing message.
- **Nothing static depends on it.** The build, feeds, exports and the existing syndication dry run, JSON plan and
  write read no plan or approval; `requireApproval` is off by default; no hosted service is involved.
- **The preview page is a static document.** `index.html` has no script, no external resource and no form; it opens
  from disk in any browser. It has `lang`, one `h1`, a "Preview, not sent" notice that does not rely on colour, the
  canonical address as a link, a captioned summary table with row and column headers linking to each destination's
  section, a section per destination labelled by its heading with its status and action in words, every reason as a
  list item with its code, the manual step for a manual destination, and the exact copy in a focusable, labelled,
  wrapping `pre` (escaped text, never rendered HTML, so nothing in a post runs in the preview). Colours come from
  tokens with a dark scheme, focus is visible, and nothing scrolls sideways at phone width. The page ends with the
  exact approve command, or says why the plan cannot be approved.

## Considered options

- **An Admin page for the plan.** Deferred: Admin has no target configuration or credentials to plan with, and the
  CLI is where cross-posting runs. The static page serves both terminal and browser users and is what a reviewer
  can be sent.
- **Render each copy as HTML in the page.** Rejected: rendering destination HTML would run the post's markup inside
  the preview; the escaped source is what is sent.

## Consequences

- A site with no destination gets a useful portable copy instead of an error from the preview.
- The page is checked by unit tests for structure and escaping and by a browser test for keyboard focus, landmarks
  and phone-width overflow.
