# ADR 0356: The Reminders screen lists what to write now, moves or turns off a bundled topic, and only links to the voice flow

- Status: Accepted
- Date: 2026-10-29
- Parent story: [#489](https://github.com/journey-to-code-org/open.blog/issues/489)
- Tasks: [#525](https://github.com/journey-to-code-org/open.blog/issues/525), [#526](https://github.com/journey-to-code-org/open.blog/issues/526)
- Parent epic: [#475](https://github.com/journey-to-code-org/open.blog/issues/475)
- Builds on: [ADR 0354](0354-seasonal-topics-are-bundled-per-trade-the-site-stores-only-its-changes-and-absent-means-off.md), [ADR 0355](0355-a-reminder-is-derived-from-the-date-and-a-private-record-and-opening-it-writes-one-unpublished-draft-that-nothing-can-publish.md), [ADR 0307](0307-the-business-facts-screen-edits-one-member-of-openblog-json-as-text-checked-against-a-revision-of-that-member-and-problems-are-said-beside-the-field.md)

## Context

The owner needs one place to see what is due, act on it from a phone, and change the schedule without editing
a file. It must follow the Admin rules: deny by default, CSRF, a revision check, plain words.

## Decision

- **One screen, `#/reminders`, one column.** It lists reminders (due, upcoming, snoozed, opened) with "Start a
  draft", "Snooze a week" and "Turn this topic off", then every topic for the trade with its dates and a way to
  move or turn it off. Reminders off shows what turning them on does and one button. Controls are 44 px high
  and labelled; no state is only a colour.
- **Four routes, all behind the session.** `GET` and `PUT /admin/api/seasonal` (the PUT carries the revision of
  the stored `seasonalPrompts` block and changes only that member, in place, like the business facts),
  `POST /admin/api/seasonal/snooze` and `POST /admin/api/seasonal/open`. A reminder is acted on only if it is
  listed today for the saved settings, so a stale or invented key is a 404 and a malformed one a 422. Reminders
  change nothing a reader sees, so a save does not rebuild the site.
- **Edits are the stored changes.** The screen sends the stored `topics` entries it was given, with one entry
  added or changed, never the resolved list, so bundled wording is never copied into the site's file.
- **In a Simple workspace, Reminders joins the main navigation once the site is a trade site.** That is when
  the business facts name a trade or reminders are on (`siteUses.reminders` from `/admin/api/meta`), like
  Services and Business facts. Otherwise it waits under **More pages** in Advanced tools, so a site that is not
  a trade, such as a recipe blog, does not see a page that has nothing for it.
- **The voice offer is a sentence and a link.** After a draft opens, the screen links to the editor and, if the
  server reports a voice guide or samples, says the Assistant can use them from there. Starting that is the
  editor's own explicit flow.

## Consequences

- Adding or rewording a site's own topic is done in `openblog.json` for now; an editor for it can use the same
  `PUT` unchanged.
- Admin home does not yet badge a due reminder; the Reminders tab and the command palette are the entry points.
