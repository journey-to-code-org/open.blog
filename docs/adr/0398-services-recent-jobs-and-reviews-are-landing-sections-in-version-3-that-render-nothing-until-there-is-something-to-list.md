# ADR 0398: Services, recent jobs and reviews are landing sections in version 3 that render nothing until there is something to list

- Status: Accepted
- Date: 2026-11-11
- Parent story: [#490](https://github.com/journey-to-code-org/open.blog/issues/490)
- Task: [#527](https://github.com/journey-to-code-org/open.blog/issues/527)
- Parent epic: [#475](https://github.com/journey-to-code-org/open.blog/issues/475)
- Builds on: [ADR 0245](0245-the-landing-page-is-a-versioned-list-of-typed-data-sections-with-no-html-section-and-no-markup-from-content.md), [ADR 0306](0306-business-facts-render-as-one-engine-block-in-the-footer-and-a-landing-section-with-localbusiness-data-on-the-home-page.md), [ADR 0382](0382-the-quote-form-is-one-plain-accessible-form-in-a-fence-and-a-landing-section-that-renders-nothing-until-quote-requests-are-on.md), [ADR 0389](0389-a-saved-review-is-a-proof-file-with-its-source-linked-from-one-job-and-stated-as-review-data-only-from-what-it-says.md)

## Context

The trade starter (#527) promises a home page with a services grid, recent jobs and reviews. The Landing
builder had no section that lists services, jobs or reviews: `latest-posts` lists every post, and a job is a
post, but a trade home page needs the jobs alone and the services and reviews are not posts at all. A fresh
starter site has no jobs and no reviews yet, and it must still build cleanly and pass its checks.

## Decision

- **Three new section types**, each holding only a heading (and, for two of them, a count), because what they
  list already lives in its own collection:
  - `services`: every published service (`content/services/`, ADR 0311) as a card with its name linking to its
    page, its summary and its price band and timeline, then a link to `/services/`. Drafts are left out.
  - `recent-jobs`: the newest published jobs (posts with `profile: job`), at most `count` (1 to 12, default 3),
    as the theme's post list, then a link to `/jobs/`.
  - `reviews`: the newest saved reviews (ADR 0389), at most `count` (1 to 12, default 3), each the same review
    figure the reviews page shows, with its source link and provenance, then a link to `/reviews/`.
- **Nothing to list, nothing rendered.** Each section produces no markup, not even its heading, until the site
  has a published service, job or review. A new starter site therefore shows no empty headings, and the home
  page's single `<h1>` passes to the next section with a heading of its own, as recipes already do (ADR 0352).
- **No structured data on the home page.** `Review` and `AggregateRating` stay on `/reviews/` and the job pages
  (ADR 0389), so a review is never stated twice.
- **Landing version 3.** A page holding any of the three is written as version 3; one holding business facts or
  a quote form but none of these stays version 2, and every other page stays version 1, byte for byte. A
  release that reads only versions 1 and 2 refuses a version 3 file without rewriting it, the same one-way
  door as before. The version a type needs is now one function (`landing::version_for_type`) used by parsing,
  saving and history, so a fourth version is one line.
- **Admin.** The Landing builder lists them as Services, Recent jobs and Reviews, each saying in its hint that
  nothing is shown until the first one is published or saved.

## Consequences

`SECTION_TYPES` is 19. The services grid and reviews list are one column on a phone and side by side once
there is room, with each service's title link at least 44px tall. A site that never uses the new types builds
exactly as before.
