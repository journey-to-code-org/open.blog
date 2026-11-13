# ADR 0413: Facebook photo jobs use the inspected and approved bytes

- Status: Accepted
- Parent epic: #623
- Amends: [ADR 0396](0396-a-job-is-shared-from-admin-reaches-a-facebook-page-through-the-announcements-and-never-carries-a-located-photo.md)

## Context

A Page photo can include an after photo and its description, but a job photo must not carry a customer's location.
A public image can also change after an author sees it, and a lost Page photo response may mean it was posted.

## Decision

The job projection binds the SHA-256 of the same complete local bytes inspected for location metadata. Admin
requires an author-written description, previews those exact bytes, and binds the photo and description to a new
approval. Scheduling checks the job and approval again. The worker fetches the public image and only sends it if
its bytes still match; a failed photo stops the job post. A photo with location metadata or unread metadata is
withheld as before.

Facebook cover announcements can instead explicitly permit a link-only fallback. A photo write whose result is
uncertain is never followed by a second post or automatically reconciled by caption alone.

The Facebook Page photo API's `caption` and `alt_text_custom` fields were checked on 2026-11-12 against
[Page photos](https://developers.facebook.com/docs/graph-api/reference/page/photos/). Tests use scripted providers;
they do not exercise a live Facebook Page.

## Consequences

Facebook photo delivery needs the optional social media schema and a public JPEG or PNG of at most 1,000,000 bytes.
Photo-bearing job previews must be approved again after a file changes. An uncertain photo write requires a person
to check the Page before trying again.
