# ADR 0390: A saved review is kept in the Render workspace, stays published while a job shows it, and a copied link is on its platform

- Status: Accepted
- Date: 2026-11-08
- Parent epic: [#474](https://github.com/journey-to-code-org/open.blog/issues/474)
- Story and tasks: #487, #519, #520, #521
- Amends: [ADR 0389](0389-a-saved-review-is-a-proof-file-with-its-source-linked-from-one-job-and-stated-as-review-data-only-from-what-it-says.md)

## Context

A review of ADR 0389's work found four gaps:

- **Reviews were lost on Render.** With the Supabase workspace turned on, the overlay keeps only an allow-list of
  paths. `content/proof/` was not on it, so a review saved in Admin lived only on the host's disk and was gone after a
  restart that came before a publish, while the job that named it was kept. ADR 0389 said reviews need nothing new on
  Render, which was not true there.
- **A review could be made a draft while a published job showed it.** Admin checks a save with drafts included and
  reports only problems that name the edited file. The build leaves drafts out, so the job's `job.review` then named
  nothing and the build stopped, but the error named the job, not the review, and Admin let the save through. Giving a
  linked review a new id (possible through the document route) slipped through the same way, and so did saving a
  published job that names a draft review.
- **A shared link could not pass its own check.** After a copy, the platform was read from where the link's redirects
  ended (`www.google.com`) but the link kept was the one pasted (`share.google/...`). The link box is read-only after a
  copy, so the form said "That link is not on Google" and the owner's only way on was to pick the wrong platform.
- **A taken id was told as "changed in another window".** A new review's id comes from the name and the day. When it
  was taken, the create route's 409 was shown as the edit-conflict message, which asks for a reload that does nothing.

## Decision

1. **The workspace keeps `content/proof/*.md`**, like posts, pages, series and services: it is scanned, saved to the
   private store and restored at startup. Nothing else under `content/proof/` is kept. The stored text format is
   unchanged; this only adds paths to the existing allow-list.
2. **Admin also checks a save as the build sees it.** After the drafts-included check passes, a save of a review or a
   post loads the site again without drafts and keeps only `job.review` problems this save causes: the edited job's own,
   or a published job naming the review's id on disk or its new id. For a review the problem is said as "the job
   posts/x.md shows this review (`id`), so it has to stay published under that id; choose another review for that job
   first". When the review was the site's only one, the build only warns (ADR 0389), and Admin lets that save through.
3. **A copied link is on the platform it names.** The platform is read from the pasted link. Only when that link is on
   no named platform and the address it led to is on one, the form takes that platform and keeps the address it led to
   as the review's link. That address has passed the snapshot route's own public-address checks. A pasted link already
   on a named platform is kept as pasted.
4. **A taken id on a new review is said as that.** A 409 from creating a review says "You already have a review called
   `id`. Change the id, for example by adding -2 to the end, then save again", and marks the id field. A 409 while
   editing keeps the reload message.

## Consequences

- On Render with the workspace on, a saved review survives a restart before publish. Without the workspace (the
  default), a review saved in Admin lives on the host's disk until it is published to Git, as posts do.
- A save of a review or a post now loads the site twice; pages, series and services load once as before.
- Unrelated broken files still do not block a save: only `job.review` problems tied to this save are reported.
- A review copied from a short link records the long address on the platform, not the short one the owner pasted.
