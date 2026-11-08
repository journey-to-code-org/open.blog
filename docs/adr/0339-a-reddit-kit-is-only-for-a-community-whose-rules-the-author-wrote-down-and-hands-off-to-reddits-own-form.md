# ADR 0339: A Reddit kit is only for a community whose rules the author wrote down, and hands off to Reddit's own form

- Status: Accepted
- Date: 2026-10-29
- Parent epic: [#384](https://github.com/journey-to-code-org/open.blog/issues/384)
- Story: #395 (task DIST4.1.2)

## Context

The epic asks for a "Reddit per-community policy checklist, user edits, manual open-and-submit; no API assumption".
Reddit's site-wide rules (ADR 0337) defer to each community's own rules, which its moderators set and change, and
they treat posting one link to many communities, or contributing mainly links to one's own work, as spam. Reading a
community's rules automatically would need Reddit's Data API, which now needs Reddit's approval and its terms. Reddit
does not document a prefilled submit address; `https://www.reddit.com/r/<community>/submit?url=…&title=…` is the
form address people and share buttons have long used, and Reddit's post title limit is 300 characters. Both are
observed behaviour, not documented API, and were not verified against a Reddit document.

## Decision

- **`--to reddit:<community>`** (`r/` allowed; 3 to 21 letters, digits or underscores; matched without regard to
  case) prepares a Reddit kit in the same `openblog submit` run and page as Hacker News.
- **Opt-in, and only with the community's rules.** `community.reddit.enabled` is off by default. Each community the
  author submits to is written down under `community.reddit.communities.<name>`: `rules` (1 to 30 one-line rules
  the author copies from the community's sidebar or rules page), optional `reviewed` (the day they last read them)
  and optional `flair` (a reminder). A community that is not written down is *blocked* with
  `community-rules-missing`: no submit link, and a message saying open.blog does not read rules from Reddit. A
  malformed entry stops the command, never the build: only `openblog submit` checks it.
- **The checklist** is three Reddit-wide rules, each linked to Reddit's page (follow the community's own rules,
  including any limit on self-promotion; post where you take part; no vote requests and no posting one link to many
  communities), then every rule the author wrote down, marked as the author's note, then the flair reminder. The kit
  links the community's current rules page (`/r/<community>/about/rules`) so the author re-reads them there.
- **Advice, not blocks**: rules with no `reviewed` day (`rules-undated`) or read more than 180 days ago
  (`rules-stale`), and one kit preparing several Reddit communities at once (`several-communities`). A title over
  300 characters, an empty title or invisible characters block.
- **User edits**: `--title` sets this run's title for every destination of the kit; the submit form is Reddit's own,
  so the author can still change anything there before submitting.
- **The handoff** is a link to the community's submit form with `url` and `title` percent-encoded, shown only when
  nothing blocks. If Reddit ignores the parameters, the title and link are on the page to paste.

## Considered options

- **Read each community's rules through Reddit's API.** Rejected: the epic says no API assumption, access needs
  Reddit's approval and terms, and rules read by a tool are rules the author did not read.
- **Block until every checkbox is ticked.** Rejected for the static page: a script-free page cannot hold the link
  back, and a gate the author can bypass by copying the link adds friction without safety. The block that matters,
  "you have not written down this community's rules", is enforced.
- **Cap the number of communities at one.** Rejected: a post can fit two communities honestly; the advice says why
  several at once is risky, and the kit cap of six destinations bounds it.

## Consequences

- The author keeps a small, versioned record of the rules of each community they take part in, in their own
  `openblog.json`, and is reminded when it is old.
- If Reddit changes its submit address or title limit, the kit's handoff or check is wrong until a release updates it.
