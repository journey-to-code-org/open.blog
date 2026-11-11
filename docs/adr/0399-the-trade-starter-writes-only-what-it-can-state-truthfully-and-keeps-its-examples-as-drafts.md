# ADR 0399: The trade starter writes only what it can state truthfully and keeps its examples as drafts

- Status: Accepted
- Date: 2026-11-11
- Parent story: [#490](https://github.com/journey-to-code-org/open.blog/issues/490)
- Task: [#527](https://github.com/journey-to-code-org/open.blog/issues/527)
- Parent epic: [#475](https://github.com/journey-to-code-org/open.blog/issues/475)
- Builds on: [ADR 0305](0305-business-facts-are-one-versioned-block-in-openblog-json-that-pages-the-footer-and-structured-data-all-read.md), [ADR 0311](0311-services-are-a-services-collection-of-markdown-files-with-versioned-front-matter-and-a-jobs-service-is-checked-against-it-only-when-the-site-has-one.md), [ADR 0382](0382-the-quote-form-is-one-plain-accessible-form-in-a-fence-and-a-landing-section-that-renders-nothing-until-quote-requests-are-on.md), [ADR 0389](0389-a-saved-review-is-a-proof-file-with-its-source-linked-from-one-job-and-stated-as-review-data-only-from-what-it-says.md), [ADR 0398](0398-services-recent-jobs-and-reviews-are-landing-sections-in-version-3-that-render-nothing-until-there-is-something-to-list.md)

## Context

`openblog init` writes a blog: a Hello world post with a Rust example, an About page and the default settings. A
tradesperson wants a business site they only have to fill in. Whatever the starter writes is published the first
time the owner deploys, and a business site that shows an invented phone number, invented hours, an invented
service or an invented review is worse than an empty one: it misleads customers and search engines, and
`LocalBusiness`, `Service` and `Review` data would state it as fact.

## Decision

- **`openblog init [dir] --starter trade [--trade <trade>]`.** `--starter` names a starter; `trade` is the only one.
  `--trade` is one of the bundled job trades (default `general-contractor`) and is checked before anything is
  written. `--trade` without `--starter trade` is refused. Without `--starter`, `init` writes exactly what it wrote
  before, byte for byte.
- **Settings.** The defaults, plus what the starter can state truthfully: `business` with `version`, the site
  title as `displayName` and the chosen `trade` (which picks the `LocalBusiness` type and the seasonal topics); the
  author as the business with `/about/` as its link; and a description that says what the site is for. No phone,
  email, hours, license, insurance or payment methods: the owner states those under Settings → Business facts.
  The written settings are read back through the same parser the build uses, so a starter cannot write settings
  the build would refuse.
- **Three example services, as drafts.** `repairs`, `new-installations` and `inspections`, named `Example: …`,
  with a summary, three included items, a price band and a body that says how to make it your own. A draft is never
  built, so nothing invented reaches the site; the owner edits one and turns `draft` off. They are complete,
  valid services, so turning `draft` off is the only edit needed for the build to accept one.
- **Empty collections.** `content/posts/` and `content/proof/` exist and are empty. There is no Hello world post on
  a trade site. The jobs archive needs no file: it appears with the first published job.
- **A phone-first landing page** (`content/landing.json`, version 3): a welcome banner with the business name and
  a sentence to replace, the business facts directly under it (the phone and hours, once stated), the services
  grid, the three newest jobs, the three newest reviews and the quote form. Each later section renders nothing
  until it has something to show (ADRs 0382 and 0398), so a fresh starter shows the banner and the business name,
  with no empty headings.
- **The quote form stays off.** Quote requests need the hosted function and a Supabase table (ADR 0381), which the
  starter cannot set up; the section is placed, and appears once the owner turns quote requests on.
- **Never overwrite.** As with `init`, a file that already exists is left alone.

## Consequences

A fresh trade starter passes `openblog check` with no warnings (content, accessibility and search checks) and
builds with one `<h1>`. The guided checklist in Admin (ADR 0401) takes the owner from here to a first job. The
starter's look is chosen in ADR 0400.
