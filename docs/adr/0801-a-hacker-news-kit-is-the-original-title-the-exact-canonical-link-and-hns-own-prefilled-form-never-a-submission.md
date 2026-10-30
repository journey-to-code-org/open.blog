# ADR 0801: A Hacker News kit is the original title, the exact canonical link and HN's own prefilled form, never a submission

- Status: Accepted
- Date: 2026-10-29
- Parent epic: [#384](https://github.com/journey-to-code-org/open.blog/issues/384)
- Story: #395 (task DIST4.1.1)

## Context

The epic says "never auto-submit to HN; avoid spam/repeat-submission; provide link, title and rules reminder". HN has
no submit API (ADR 0800) and asks, in its [guidelines](https://news.ycombinator.com/newsguidelines.html) and
[FAQ](https://news.ycombinator.com/newsfaq.html), for the original title without emphasis, gratuitous numbers or the
site's name; no soliciting of votes; no delete-and-repost; and promotion only part of the time. HN's
[bookmarklet](https://news.ycombinator.com/bookmarklet.html) opens `submitlink?u=<address>&t=<title>`, the submit
form filled in, which the person still has to submit while signed in. HN's form takes titles of at most 80
characters; that limit is widely reported and enforced by the form but is not written in the guidelines, so it was
not verified from an HN document.

## Decision

- **`openblog submit <slug> --to hacker-news`** prepares a kit for one production-visible post, using the same
  post loading and canonical checks as cross-posting (a draft, a scheduled post or a site without a real `https`
  address is refused). Without `--kit` it prints the kit; with `--kit <new folder>` it writes `kit.json` and a
  static `index.html` into a folder that must not exist yet. It sends nothing and reads no credential.
- **Opt-in.** `community.hackerNews.enabled` in `openblog.json` is off by default; while it is off the command says
  how to turn it on and stops before reading any post. The `community` object is omitted from the written
  configuration while it has its defaults, and nothing in the build, the feeds or `openblog syndicate` reads it.
- **Title and link.** The title is the post's own, with whitespace collapsed; `--title` replaces it for this run.
  The link is exactly the canonical address, never shortened or tagged. An empty title, a title over 80 characters
  or one with invisible or control characters *blocks*: the kit then has no submit link. The guidelines' other
  points are *advice* that never blocks, because only the author can judge them: an edited title, capitals or
  exclamation points, a leading count such as "10 ways", the site's name in the title.
- **The rules reminder** is a checklist of five paraphrased rules, each linked to the HN page it comes from. The
  boxes are for the author; they are not saved, sent or required.
- **The handoff** is a link to `https://news.ycombinator.com/submitlink` with `u` and `t` percent-encoded, shown only
  when nothing blocks. HN may still ask the author to sign in, and only the author's own click submits.
- **The contract fails closed.** The kit checks the destination against its manifest; unless the manifest says the
  link is submitted by hand, the destination is blocked with `manifest-not-guided`.
- **The page** follows ADR 0330: no script, no external resource, `lang`, one `h1`, a "Prepared, not submitted"
  notice, a section per destination labelled by its heading, the title and link in focusable, labelled `pre`
  blocks (escaped text), the checklist as a `fieldset` with a `legend` and a labelled checkbox per rule, visible
  focus, no sideways scroll at phone width, and `referrer` set to `no-referrer`.

## Considered options

- **Submit through a signed-in browser session or a scraped form.** Rejected: HN offers no API for it, its
  guidelines are about people choosing what to submit, and the epic forbids it.
- **Block on every guideline.** Rejected: whether a number is gratuitous or a title misleading is a judgement; a
  tool that blocks on it would push authors to work around the tool rather than read the rule.
- **Copy buttons and a gated submit link with script.** Deferred to the launch-kit story (#396), which asks for copy
  actions; the static page keeps the DIST1 preview's guarantees.

## Consequences

- An author gets the exact title and link, the rules and HN's own form in one place, and nothing leaves their
  machine unless they click and submit.
- If HN changes the form's limit or the `submitlink` address, the kit's title check or handoff link is wrong until a
  release updates it; the title and link remain copyable either way.
