# ADR 0921: A reminder is derived from the date and a private record, and opening it writes one unpublished draft that nothing can publish

- Status: Accepted
- Date: 2026-10-29
- Parent story: [#489](https://github.com/journey-to-code-org/open.blog/issues/489)
- Task: [#526](https://github.com/journey-to-code-org/open.blog/issues/526)
- Parent epic: [#475](https://github.com/journey-to-code-org/open.blog/issues/475)
- Builds on: [ADR 0920](0920-seasonal-topics-are-bundled-per-trade-the-site-stores-only-its-changes-and-absent-means-off.md), [ADR 0308](0308-an-announcement-links-a-public-canonical-post-at-a-utc-instant-and-only-a-scheduled-one-can-change.md), [ADR 0229](0229-ai-drafts-are-labelled-by-origin-and-publish-only-with-a-persons-approval-of-the-exact-text.md)

## Context

The story asks for the social queue (SP4) to fire the reminders. That queue is the hosted store of
announcements: each row links an already-public canonical post to a provider at a UTC instant and is claimed
by a worker that delivers it (ADRs 0308, 0316, 0317). A reminder is none of those things. It has no post, no
provider and no one to deliver to except the owner, and carrying it there would need a new hosted row kind, a
hosted schema change that is hard to take back, for a feature that must work on a site with no hosted service.

## Decision

- **Reminders are derived, not queued.** The list is a pure function of the saved settings, the trade and
  today's date (`openblog_core::seasonal::reminders`), plus a small private record. Nothing is scheduled, so
  nothing can fire late, twice or while nobody is looking, and a site with no hosted service has them.
  Status is `due` (the window is open), `upcoming` (it opens within 30 days), `snoozed` or `opened`.
- **The record is private and small.** `.openblog/private/seasonal.json` (version 1, at most 64 KiB, newest 400
  entries) maps a reminder key to the day it is snoozed until, and to the path of the draft it opened. It holds
  no prose, is never built, exported or published, and an unreadable or newer file reads as empty: the worst
  outcome is a reminder shown again.
- **The only action is one unpublished draft.** Opening a reminder writes `content/posts/<today>-<topic>.md`
  with `draft: true`, the topic as its title and the prompt as its first paragraph. A second open of the same
  occurrence returns the same draft and writes nothing; a taken file name gets a year suffix. The owner writes,
  reviews and publishes through the ordinary editor, exactly as for any draft.
- **No path leads out.** The reminder modules (core rules, store and routes) name no publish, syndication,
  announcement, social, rebuild or network call; a test reads their source and fails if one appears, and route
  tests check that an opened draft is absent from the home page, feed and sitemap.
- **Snooze is bounded.** One to 90 days (the screen offers a week). A snoozed reminder returns on its day if its
  window is still open. Opening a snoozed reminder clears the snooze; an opened reminder cannot be snoozed.
- **Disable is per topic and saved in the settings** (ADR 0920), so it is visible in `openblog.json`, in
  version control and to a second Admin user.
- **The first draft in the owner's voice is offered, not started.** When a voice guide or voice samples exist
  the screen says the Assistant can use them from the editor, through the explicit context choice and
  disclosure the Assistant already has (ADRs 0229, 0278). No Assistant or provider call is made by a reminder.

## Consequences

- Reminders appear when the owner opens Admin. A push or email nudge, and a hosted wake from the SP4 worker,
  are not part of this decision; they would be a new announcement kind with its own consent and are deferred.
- Because nothing is stored on a schedule, there is nothing to migrate or roll back: turning reminders off
  removes the setting, and the private record can be deleted at any time.

## Acceptance criteria change

Stories #489 and #526 say the social queue (SP4) fires the reminders. This decision changes that criterion:
reminders are derived from the date when Admin loads and are not queued, so `netlify/lib/social-delivery.mjs`
and the `socialAdapters` seam are untouched. The cost is real: an owner who does not open Admin during a
window gets no nudge. That gap is accepted for now and tracked as a follow-up, "Queue-driven nudge for seasonal
reminders" (an owner-consented push or email kind on the SP4 worker, with its own hosted schema decision). The
queue-driven acceptance box on #489 and #526 is therefore closed as changed, not as met.
