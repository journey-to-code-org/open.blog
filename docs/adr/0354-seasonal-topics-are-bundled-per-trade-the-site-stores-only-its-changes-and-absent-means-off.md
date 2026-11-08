# ADR 0354: Seasonal topics are bundled per trade, the site stores only its changes, and absent means off

- Status: Accepted
- Date: 2026-10-29
- Parent story: [#489](https://github.com/journey-to-code-org/open.blog/issues/489)
- Task: [#525](https://github.com/journey-to-code-org/open.blog/issues/525)
- Parent epic: [#475](https://github.com/journey-to-code-org/open.blog/issues/475)
- Builds on: [ADR 0285](0285-jobs-are-posts-with-a-content-profile-and-open-blog-is-not-a-field-service-tool.md), [ADR 0314](0314-service-areas-are-a-versioned-list-of-towns-in-openblog-json-checked-for-duplicates-with-regions-formatted-from-a-bundled-list-and-absent-means-nothing-changes.md)

## Context

A tradesperson's site goes quiet in a slow month. The cure is a prompt at the right time of year for the
trade ("get the furnace checked before the cold"). The prompts have to be good out of the box, editable, and
cheap to carry: stored data that later releases read must be conservative.

## Decision

- **A topic is a window, a topic and a prompt.** The window is two `MM-DD` days and may cross the new year
  (`11-01` to `02-28`). `02-29` is allowed and is February 28 in a year without one. The topic is at most 80
  characters and the prompt at most 600, both one line of plain text.
- **Bundled per trade, in the binary.** Each trade in the bundled list (ADR 0285) with its own set has two to
  three topics; a trade without one, including a site's `extraTrades`, gets four general ones (spring, summer,
  fall, winter). The trade is the one in the business facts; unset gives the general four.
- **The site stores only its changes.** `seasonalPrompts` is
  `{ "version": 1, "enabled": true, "topics": [ { "id", "disabled", "start", "end", "topic", "prompt" } ] }`.
  An entry whose id is a bundled topic changes only what it states: `disabled` turns it off, `start` and `end`
  move it, `topic` and `prompt` reword it. Any other id is the site's own topic and must state a start, an end,
  a topic and a prompt. Bundled wording can therefore improve in a later release without losing a site's choice.
- **Absent means off.** With no `seasonalPrompts`, or `enabled` false, nothing is listed and every build is byte
  for byte what it was. (Corrected by ADR 0386: an `enabled: false` member is written back when it holds topic
  changes, so turning reminders off keeps them; it is left out only when it holds none.) Turning it on is a deliberate act.
- **Strict and versioned.** Only version 1 is read or written; a newer version is refused with a message and the
  file is not touched. Unknown keys are errors, ids are lowercase slugs of at most 40 characters and unique,
  at most 60 entries, and every problem is returned in plain words.
- **One occurrence has one key.** A reminder is named `<id>@<YYYY-MM-DD>` where the date is the day its window
  opened, so the same topic is a new reminder every year and the same one however often the list is worked out.

## Consequences

- The Admin screen (ADR 0356) edits `disabled` and the window; rewording and the site's own topics are edited
  in `openblog.json`, where the format is documented in `docs/seasonal-reminders.md`.
- A change to a bundled topic of a different trade stays in the file and applies to nothing, so changing the
  business trade never loses a decision.
