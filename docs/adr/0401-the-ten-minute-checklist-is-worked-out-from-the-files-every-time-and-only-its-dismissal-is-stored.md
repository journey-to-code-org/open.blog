# ADR 0401: The ten-minute checklist is worked out from the files every time, and only its dismissal is stored

- Status: Accepted
- Date: 2026-11-11
- Parent story: [#490](https://github.com/journey-to-code-org/open.blog/issues/490)
- Task: [#529](https://github.com/journey-to-code-org/open.blog/issues/529)
- Parent epic: [#475](https://github.com/journey-to-code-org/open.blog/issues/475)
- Builds on: [ADR 0277](0277-the-voice-invitation-is-shown-once-on-the-admin-home-and-a-dismissal-is-an-admin-preference.md), [ADR 0399](0399-the-trade-starter-writes-only-what-it-can-state-truthfully-and-keeps-its-examples-as-drafts.md), [ADR 0393](0393-a-job-reaches-google-business-profile-from-the-cli-only-when-the-owner-turned-it-on-and-confirmed-its-digest.md)

## Context

A new owner who ran `openblog init --starter trade` needs to know what to do next. The story asks for a dismissible
guided checklist (business facts, first service, first job, first review, connect a destination) whose items deep-link
and "reflect actual state, not clicks". A checklist that ticks when a link is followed lies the moment the owner backs
out, and one stored as progress drifts from the site when a service is unpublished or a review deleted.

## Decision

- **One read-only route, `GET /admin/api/trade-checklist`**, behind the session. It reads `openblog.json`, the
  content sources and the private job share record each time it is asked, and answers `applies` (a trade is named
  in the business facts), the five steps in order, each `{ id, done, href }`, and the count done. It writes nothing.
- **What makes each step done**, judged from files only:
  - `business`: a phone number or an email in the business facts (the starter states only the name and trade).
  - `service`: a service file that is not a draft.
  - `job`: a post with `profile: job` that is not a draft.
  - `review`: a review file that is not a draft.
  - `destination`: sending to Google Business Profile is turned on, or a job is recorded as posted somewhere, by
    open.blog or marked **I posted it** by hand. Nextdoor and most Facebook posting are by hand (ADRs 0394, 0396),
    so a recorded post is the only real evidence a place is in use; a kit made is not.
  A step unticks when its file goes away. Content that does not parse does not count yet.
- **Deep links into Admin**: Business facts, Services, Capture (to start a job on site), Reviews, and the newest
  published job in Write, where **Share this job** is. Before there is a job, the sharing step says to publish one
  first and offers no link.
- **The card** (`web/admin/trade-checklist.js`) appears at the top of Admin's home after the page has drawn, only on
  a trade site, only while a step is open and only until dismissed. It keeps only known step ids, real booleans and
  `#/` links from the answer. Each step says its state in words ("Done" or "To do") besides the decorative mark,
  and every action is at least 44px tall at 400px. Following a link changes nothing on the card.
- **Only the dismissal is stored**, per user, as `tradeChecklistDismissed` in the workspace preferences, written
  only when true, exactly like the voice invitation (ADR 0277). A dismissal that cannot be saved keeps the card
  and says so.

## Consequences

The checklist costs one read of the site's sources per visit to the home screen, the same as the recipe notes. It
is not shown on a blog without a trade, and it disappears by itself once all five steps are done.
