# ADR 0389: A saved review is a proof file with its source, linked from one job, and stated as review data only from what it says

- Status: Accepted (amended by [ADR 0390](0390-a-saved-review-is-kept-in-the-render-workspace-stays-published-while-a-job-shows-it-and-a-copied-link-is-on-its-platform.md))
- Date: 2026-11-08
- Parent epic: [#474](https://github.com/journey-to-code-org/open.blog/issues/474)
- Story and tasks: #487, #519, #520, #521
- Builds on: [ADR 0285](0285-jobs-are-posts-with-a-content-profile-and-open-blog-is-not-a-field-service-tool.md),
  [ADR 0311](0311-services-are-a-services-collection-of-markdown-files-with-versioned-front-matter-and-a-jobs-service-is-checked-against-it-only-when-the-site-has-one.md),
  [ADR 0313](0313-services-are-edited-in-admin-through-the-document-routes-with-a-screen-of-their-own-scaffolded-as-drafts-from-the-command-line.md),
  [ADR 0306](0306-business-facts-render-as-one-engine-block-in-the-footer-and-a-landing-section-with-localbusiness-data-on-the-home-page.md)

## Context

A trade site needs proof: a real customer's review, beside the job it describes, with a way for a reader to check it.
Since #476 a job could name a review in `job.review`, but nothing held reviews, so the id linked nothing. Reviews
already live on Google, Facebook and similar sites; the owner wants to bring one in without retyping it and without
anyone being able to say it was made up. Search engines read `Review` and `AggregateRating` data, and inventing or
padding either is both dishonest and against their rules.

## Decision

1. **A `proof/` collection of Markdown files.** A review is `content/proof/<id>.md`: flat front matter (`version: 1`,
   `id`, `author`, `date`, `platform`, `sourceUrl`, optional `rating`, `provenance`, `retrievedAt`, `draft`), then the
   review's words as plain text. A file there that declares neither `version` nor `id` is not a review and is left out,
   as before. Unknown keys are kept. A site without the folder builds exactly as before.
2. **Checked as the build checks everything.** The id uses the rule `job.review` always had (letters, digits, `-`,
   `_`, up to 64). `platform` is a closed list (`google`, `facebook`, `nextdoor`, `yelp`, `houzz`, `angi`, `other`), and
   a named platform's `sourceUrl` must be on that platform's own site (`other` takes any public http(s) link). A
   `rating` is a whole number from 1 to 5 or absent; nothing else is accepted. `provenance` is `entered` (the default:
   typed in) or `snapshot` (copied from the link), and only a snapshot has, and must have, `retrievedAt`; a review
   cannot be dated after the day it was copied. The words are required, at most 5,000 characters, and are always shown
   as escaped text, never rendered as Markdown or HTML. A draft review is not published and its problems are warnings.
3. **The job holds the link.** A job names its review in `job.review`; the review names no job, so the two cannot
   disagree. Once a site has any saved review, a published job naming one it does not have stops the build, and so
   does a second job naming the same review (a review describes one job). A site with no reviews only gets a warning
   for a `job.review` line, because the line used to link nothing.
4. **Where it shows.** The job's page shows its review after the job's own text ("What the customer said"), with the
   stars only when there are some, the reviewer's name, the day, a `nofollow` link to the review where it was left,
   and how it came in ("Typed in from the original review" or "Copied from the review's link on ..."). Each jobs archive
   adds one line to a job that has a review. `/reviews/` lists every review, newest first, each with a link to its job;
   it, a "Reviews" navigation link and its sitemap entry exist only while the site has a review, and `reviews` is a
   reserved first segment only then.
5. **Structured data only from the files.** A job page with a review adds a `Review` node to its graph: author, date,
   words, link, the platform as `publisher` (not for `other`), `itemReviewed` the business (the `LocalBusiness` node by
   its id when business facts are set, else the site by name), and `reviewRating` only when the file has a rating. The
   reviews page states the business with every review, and an `AggregateRating` only when at least
   `reviews.aggregateMinimum` reviews (default 3, from 1 to 1000, in `openblog.json`) have stars; it averages only
   those, rounded to one decimal, and says how many. Unrated reviews are never counted or given stars.
6. **Portable.** A review is already public, so it is portable by default: a job's portable Markdown and HTML, as `openblog export`
   and the site's RSS and JSON feeds build them, carry its review as the same section the page shows.
   Cross-posting builds its copy without the site, so a cross-posted job does not carry its review yet. The files themselves are
   ordinary Markdown in the content folder.
7. **Admin brings one in two ways, both explicit.** The Reviews screen (`#/reviews`) edits the collection through the
   document routes, like Services. **Copy the page** sends the link to the Assistant's URL snapshot route
   (`assistant/context/url/retrieve`) unchanged, with `confirmed: true`, so the limits and refusals are that route's own
   (public addresses only, every redirect rechecked, at most 4 redirects, 512 KiB, 64 KiB of text, 12 seconds, text
   types only). The answer fills the link, the platform the link is on and the copy's time, and the words only when the
   page held no more than a review can; the name, day and stars are read off the shown page by the owner. The link of a
   copied review cannot be edited, and nothing is fetched again: saving and editing never contact the link, and the
   copy's time is written once. **Typing it in** needs the same fields by hand. The job form gains **Customer review**,
   a list of the saved reviews.

## Consequences

- An owner can only show a review she can link to. A review told in person has no place yet; that is deliberate,
  because a reader could not check it.
- Pages behind a sign-in or built by script (often Google and Facebook) may give little useful text to a snapshot;
  then the screen says so in plain words and typing it in is the way. No person has yet tried a real Google or Facebook
  review link; the automated tests use a scripted snapshot.
- Search engines may still not show stars for reviews a business shows of itself; the data is valid and honest either way.
- The snapshot route, like the Assistant's, trusts the signed-in owner's browser for the copy's time it sends back.
- On Render nothing new runs: reviews are files, built into static pages like posts. Copying a page needs the Admin
  server to reach the internet, which it can there and on a local machine.
- Deleting a review a job still names stops the next build until the job chooses another (when it was the site's
  last review, the build only warns), and Admin says so before it deletes.
