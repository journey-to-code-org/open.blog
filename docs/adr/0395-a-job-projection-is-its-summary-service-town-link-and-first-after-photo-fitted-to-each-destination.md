# ADR 0395: A job projection is its summary, service, town, link and first after-photo, fitted to each destination

- Status: Accepted
- Date: 2026-11-08
- Parent epic: [#475](https://github.com/journey-to-code-org/open.blog/issues/475)
- Story: #488 (task #524, TRADE5.1.3)

## Context

Task #524 asks for a deterministic projection of a job for each destination: the first after-photo, a one-line
summary, the service and town and the link to the job's page, with each destination's length and image rules
applied in the preview.

## Decision

- `openblog_core::job_destination::project` is pure: it reads no file, clock or network. The caller measures the
  photo.
- The summary is the first non-empty line of the job's `description`, else its title, with runs of white space made
  one space. The service is the site's service name for `job.service`, else the id as words (`hardwood-install`
  reads "Hardwood install"). The place line is "{service} in {town}, {region}." The link is the job's own page.
- Words per destination: Google Business Profile gets the summary and place line (the link is its Learn more
  button), at most 1,500 characters. A Facebook Page gets summary, place line and link, at most 3,000 characters,
  the caption limit announcements already keep. Nextdoor gets the same, at most 3,500 characters after URL encoding
  (ADR 0394). When the whole does not fit, only the summary is shortened, at a word, ending in "…", and the preview
  says so.
- The photo is the first `media.after` entry. A missing or unreadable file blocks every destination, and so does a
  photo that may hold where it was taken, because a job photo's location can be a customer's home. Google also needs
  JPEG or PNG, 10 KB to 5 MB, at least 250 by 250 pixels (ADR 0393), and a photo on this site, since Google fetches
  it by address. A job with no after-photo is shared without one, with a note.
- A page that is not at a public `https` address blocks every destination.
- The digest covers the destination, its policy version, the words, the link and the photo's address, type, size
  and pixel dimensions. Identical input always gives an identical projection, kit page and `kit.json`. Any change to
  what would be sent changes the digest, and `--send` refuses a digest that no longer matches.
- Facebook stays by hand for a job: its manifest has images by hand (ADR 0326), so a job routes to the kit. The
  Facebook Page adapter of the hosted social announcements still sends a caption and link where that service is
  set up; job projections do not feed it yet.

## Consequences

- Every destination shows the same job the same way, and the preview is exactly what is sent or pasted.
- What happened at each destination is kept in `.openblog/job-shares.json` and shown by `--status`. Admin does not
  show it yet.
