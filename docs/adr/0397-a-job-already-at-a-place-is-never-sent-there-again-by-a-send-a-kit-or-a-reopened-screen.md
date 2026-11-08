# ADR 0397: A job already at a place is never sent there again by a send, a kit or a reopened screen

- Status: Accepted
- Date: 2026-11-08
- Parent epic: [#475](https://github.com/journey-to-code-org/open.blog/issues/475)
- Story: #488 (tasks #522 to #524)
- Amends: [ADR 0393](0393-a-job-reaches-google-business-profile-from-the-cli-only-when-the-owner-turned-it-on-and-confirmed-its-digest.md), [ADR 0396](0396-a-job-is-shared-from-admin-reaches-a-facebook-page-through-the-announcements-and-never-carries-a-located-photo.md)

## Context

ADR 0396 added `posted-by-hand`, the owner's word in Admin that she posted a job herself. Its review found that the
rest of the record did not hear it:

- `openblog job-share <slug> --send google-business-profile --confirm <digest>` refused only `posted` and `unknown`,
  and the preview still offered the send command, so a job she had posted to Google by hand would be posted a second
  time once sending is on.
- `--kit` kept only `posted` and `unknown`, so writing a kit replaced every `posted-by-hand` mark with `kit-made`, and
  Admin then told her to post a job she had already posted.
- Admin's **Post to <Page>** stayed on offer when the job already had a Facebook announcement. Its idempotency key
  lived only in that screen, so reopening the screen sent a new key and scheduled a second Page post.

## Decision

- **A place holds the job when it is `posted`, `unknown` or `posted-by-hand`.** A send to Google refuses all three
  without a request, saying for `posted-by-hand` that she said she posted it by hand and sending would post it twice.
  The preview prints each place's record (`shared: ...`) and does not offer the send command for a place that holds
  the job. A kit never overwrites any of the three; it records `kit-made` only where nothing holds the job.
- A `posted-by-hand` mark has no undo from the command, like `posted`. A mark made by mistake costs only the
  automatic send; the by-hand steps still work.
- **Admin offers Post to <Page> only when the job has no Facebook announcement, or its newest one failed or was
  canceled**, and not when she marked Facebook as posted by hand. A scheduled, sending, retrying, published or
  needs-checking announcement is shown with its state and not offered again, whatever screen opened it.

## Consequences

- The owner's own word and open.blog's posts are held alike: nothing in open.blog posts a job twice to the same
  place, and nothing erases her marks.
- A failed or canceled Page announcement can be tried again from Admin with a new key, as the Announcements screen
  allows.
- Nothing here contacts Google, Facebook or Nextdoor; the tests use scripted transports and a fake server.
