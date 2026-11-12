# ADR 0396: A job is shared from Admin, reaches a Facebook Page through the announcements, and never carries a located photo

- Status: Accepted
- Date: 2026-11-08
- Parent epic: [#475](https://github.com/journey-to-code-org/open.blog/issues/475)
- Story: #488 (tasks #522 to #524)
- Amends: [ADR 0395](0395-a-job-projection-is-its-summary-service-town-link-and-first-after-photo-fitted-to-each-destination.md)

## Context

The first cut of story #488 shared a job only from the command line (`openblog job-share`). Its review found three
gaps against the story:

- The story asks for delivery status per destination in Admin, as the announcements show it (SP6). The intended
  owner works from Admin on a phone and had no screen for it.
- The story asks for Facebook Pages to be reused from SP5. A job never reached the Facebook Page adapter of the
  hosted announcements (ADR 0320): every job went to Facebook by hand.
- The kit copied the very photo the preview had blocked for perhaps holding where it was taken, and offered it to
  save under each destination.

## Decision

- **Admin has a Share this job screen**, `#/share/<path>`, linked as **Share this job** under the Job form in Write.
  `GET /admin/api/job-share?path=` returns, for Google Business Profile, a Facebook Page and Nextdoor, the projection
  of ADR 0395 (words, link, photo, problems, digest) and the place's record from `.openblog/job-shares.json`, with
  `changedSince` when a posted job has changed since. A draft, a scheduled job, a post that is not a job and a
  missing file are refused with a plain reason (422). Each place shows where it stands in words: not shared yet,
  kit made, posted, may have been posted, not posted, or posted by hand; a Facebook Page shows its announcement's
  delivery state with the same words as the Announcements screen (ADR 0323).
- **Posted by hand is the owner's word.** `POST /admin/api/job-share/by-hand` with the path, the place and the digest
  records `posted-by-hand`. It is refused when the digest no longer matches (the job changed since the screen was
  opened), when the place has something to fix, and when open.blog posted it or may have (`posted` or `unknown`
  stays). The record gains this one status; older records read as before. The record is now kept in the hosted
  workspace like the seasonal record, so a Render restart does not lose it.
- **A Facebook Page goes through the announcements.** A job's Facebook route is the adapter whenever the Facebook
  manifest does every requested capability through the adapter. The Page adapter sends words and a link but no
  photo (ADR 0326 marks images by hand), so a job without an after photo routes to the adapter and a job with one
  stays by hand. When social publishing is set up and a Facebook Page is connected, the screen's **Post to
  <Page>** schedules an announcement of the job's page five minutes ahead with the projection's words as its
  caption and one idempotency key per job and words, through the existing announcement route; the hosted function
  checks and sends it exactly as any announcement. Otherwise the screen says how to connect a Page and offers the
  by-hand steps. `openblog job-share --send facebook` is refused with where to do it, since the command does not
  hold the hosted function's key.
- **Google is not sent from Admin.** Sending to Google stays the confirmed command of ADR 0393, which needs Google's
  approval nobody has yet. Admin shows Google's preview and record and the by-hand steps, and says why.
- **A photo that may hold where it was taken is held back everywhere.** The projection keeps the blocking
  `photo-location` problem and no longer carries the photo, so neither a send, the kit's `images/` folder, the kit
  page nor Admin offers it. The kit page and Admin say the photo is left out until it is replaced.

## Consequences

- The owner can see, on a phone, what each place would get and where each stands, mark a by-hand post as done and,
  with a connected Page, post a photo-less job to Facebook through the announcement queue she already knows.
- A job with an after photo still goes to Facebook by hand, because the Page adapter does not attach photos. Adding
  a photo to the Page adapter is a change to the hosted function and its manifest, left for later.
- Nothing here contacts Google or Nextdoor. The Facebook path only creates an announcement through the route Admin
  already had; tests use a fake server and scripted transports.
