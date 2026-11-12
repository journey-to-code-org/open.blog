# ADR 0391: A review a published job shows cannot be deleted, and a copy keeps an address only if the review can

- Status: Accepted
- Date: 2026-11-08
- Parent epic: [#474](https://github.com/journey-to-code-org/open.blog/issues/474)
- Story and tasks: #487, #519, #520, #521
- Amends: [ADR 0390](0390-a-saved-review-is-kept-in-the-render-workspace-stays-published-while-a-job-shows-it-and-a-copied-link-is-on-its-platform.md)

## Context

A review of ADR 0390's work found two gaps:

- **Deleting a review skipped the check a save has.** ADR 0390 stops a review a published job shows from being made a
  draft or given a new id. The delete route had no such check: Admin's **Yes, delete it** moved the review to the trash,
  the rebuild failed on the job's `job.review`, and the screen went back to the list without reading the rebuild's
  result, so the owner was not told. When it was the site's only review, the build only warns (ADR 0389), so the delete
  passed and the job quietly stopped showing it. The confirm box already said "a job that shows it must choose another
  first", but nothing made that so.
- **A copy could take an address the review cannot keep.** ADR 0390 has a copy from a short link keep the address it
  led to. That address was not checked against the link rules (500 characters, a plain http or https link with no
  sign-in). The link box is read-only after a copy, so an over-long address left the owner on an error they could not
  fix.

## Decision

1. **A review a published job shows cannot be deleted.** Before a `proof/` file is moved to the trash, Admin reads the
   review's id and looks through the posts for a job (the `job` profile) that is not a draft and names that id in
   `job.review`. If there is one, nothing moves and the route answers 422 with "The job posts/x.md shows this review, so
   it cannot be deleted yet. Open that job, choose another review or none in its Customer review box, and save it
   first." This holds whether or not it is the site's only review. A draft job may keep naming it, as the build only
   warns about a draft; a scheduled job that is not a draft counts as published, since it will be.
2. **The Reviews screen says what a delete did.** A refused delete says "The review was not deleted." with the server's
   reason, and stays on the review. A delete whose rebuild failed for another reason says the review is in the trash but
   the site could not be rebuilt yet, with the build's error, and clears the form instead of leaving for the list.
3. **A copy keeps the address it led to only when a review could keep it as its link**: at most 500 characters, http
   or https, no spaces, no user name or password. Otherwise the pasted link is kept and the platform is read from it
   (usually **Somewhere else**), so the review can still be saved.

## Consequences

- To delete a review a job shows, the owner first changes that job. The message names the job's file so they can find
  it.
- The check reads the posts' front matter, not a full build, so a delete is still quick; a post that cannot be parsed
  is not counted.
- A review copied from a short link whose landing address is too long keeps the short link and is filed under
  **Somewhere else**; the owner can add it again by typing it in on the right platform if they want it there.
