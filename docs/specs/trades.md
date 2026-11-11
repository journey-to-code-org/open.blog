# Trades

Status: built across epics TRADE4 and TRADE5 (#474, #475) on top of TRADE1 to TRADE3, 2026-11-11. The usability
pass with real owners (#531) is still to run.

## Problem

A tradesperson's website has one job: turn a visit into a call. Most trade sites fail at the end of the visit:
there is no way to ask for a quote, no proof the work went well for someone else, and nothing new since the day
the site was made. Trades are found on maps and neighbourhood feeds, not in feed readers, and the owner has no
time to write. General blog engines offer none of this, and field-service products bury it under invoicing and
dispatch the owner already has elsewhere.

## Solution

Trade features are open.blog's own building blocks, never a parallel system:

1. **A job is a post** with `profile: job`, so feeds, archives, tags, search, export and the Assistant keep working.
2. **Facts and collections**: business facts once in `openblog.json`, services in `content/services/`, service
   areas as a list of towns, reviews in `content/proof/`. Each is versioned, optional, and absent means the
   site builds exactly as before.
3. **Customer data stays server-side**: quote requests go to the owner's Supabase project through an opt-in
   function; nothing personal reaches the static site, logs or exports unless the owner exports it.
4. **Every external action is previewed and consented**: sharing a job prepares the same projection for each
   place and posts only where the place allows it, falling back to a by-hand kit.
5. **A starter and a checklist** take a new owner from `openblog init --starter trade` to a first published job
   in about ten minutes, without the site ever showing something invented.

open.blog is not a field-service tool: no invoicing, estimating, dispatch, job scheduling or payment data.

## User stories

1. As an owner, I want to record a finished job from my phone on site, so that the work is written up while I
   remember it. (TRADE1)
2. As an owner, I want my name, phone, hours, license and insurance stated once and shown everywhere, so that
   customers and search engines get the same facts. (TRADE2)
3. As an owner, I want each service described once with what it includes and a price band, and pages per town I
   serve, so that a customer finds the work near them. (TRADE3)
4. As a visitor, I want to ask for a quote from any page with photos, without calling during work hours. (#485)
5. As an owner, I want to read, mark, export and erase quote requests without a CRM. (#486)
6. As an owner, I want real reviews kept with where they came from and shown beside the job they describe.
   (#487)
7. As an owner, I want one finished job sent to Google Business Profile, Facebook and Nextdoor with a preview and
   my consent. (#488)
8. As an owner, I want to be told what to write between jobs, without anything being published for me. (#489)
9. As a new owner, I want a credible site I only have to fill in, with a list of what to do next. (#490)

## Implementation decisions

- **Jobs, archives and capture (TRADE1)**: [ADR 0285](../adr/0285-jobs-are-posts-with-a-content-profile-and-open-blog-is-not-a-field-service-tool.md), [ADR 0286](../adr/0286-jobs-archives-are-derived-from-job-posts-and-page-like-the-home-page.md), [ADR 0287](../adr/0287-the-job-form-and-its-scaffold-are-written-once-in-core-and-produce-a-normal-post.md), [ADR 0291](../adr/0291-a-before-and-after-pair-is-a-compare-fence-the-engine-validates-with-two-figures-as-its-portable-form.md), [ADR 0292](../adr/0292-add-something-offers-before-and-after-from-a-schema-beside-the-pieces-checked-and-written-by-core.md), [ADR 0296](../adr/0296-a-capture-is-a-job-draft-started-from-a-phone-built-from-the-job-forms-own-keys.md), [ADR 0297](../adr/0297-a-capture-waits-in-a-bounded-versioned-queue-on-the-phone-and-is-sent-with-its-id-as-an-idempotency-key.md), [ADR 0303](../adr/0303-the-job-draft-task-returns-a-strict-plain-text-draft-that-can-never-fill-a-job-field-and-the-core-checks-it.md), [ADR 0304](../adr/0304-a-draft-is-applied-as-editable-unsaved-fields-in-capture-with-one-undo-and-the-authors-save-is-the-only-save.md).
- **Business facts, services and service areas (TRADE2, TRADE3)**: [ADR 0305](../adr/0305-business-facts-are-one-versioned-block-in-openblog-json-that-pages-the-footer-and-structured-data-all-read.md), [ADR 0306](../adr/0306-business-facts-render-as-one-engine-block-in-the-footer-and-a-landing-section-with-localbusiness-data-on-the-home-page.md), [ADR 0307](../adr/0307-the-business-facts-screen-edits-one-member-of-openblog-json-as-text-checked-against-a-revision-of-that-member-and-problems-are-said-beside-the-field.md), [ADR 0311](../adr/0311-services-are-a-services-collection-of-markdown-files-with-versioned-front-matter-and-a-jobs-service-is-checked-against-it-only-when-the-site-has-one.md), [ADR 0312](../adr/0312-service-pages-the-index-and-their-structured-data-are-rendered-from-the-collection-alone-deterministically-and-only-for-a-site-that-has-services.md), [ADR 0313](../adr/0313-services-are-edited-in-admin-through-the-document-routes-with-a-screen-of-their-own-scaffolded-as-drafts-from-the-command-line.md), [ADR 0314](../adr/0314-service-areas-are-a-versioned-list-of-towns-in-openblog-json-checked-for-duplicates-with-regions-formatted-from-a-bundled-list-and-absent-means-nothing-changes.md), [ADR 0315](../adr/0315-service-area-pages-are-rendered-from-the-area-list-the-services-and-the-jobs-towns-alone-with-an-honest-empty-state-and-no-address-beyond-a-town.md).
- **Quote requests (TRADE4.1, TRADE4.2)**: [ADR 0381](../adr/0381-quote-requests-are-stored-server-side-only-through-a-fenced-visitor-endpoint-that-is-off-by-default.md), [ADR 0382](../adr/0382-the-quote-form-is-one-plain-accessible-form-in-a-fence-and-a-landing-section-that-renders-nothing-until-quote-requests-are-on.md), [ADR 0383](../adr/0383-the-owner-is-told-by-one-opt-in-email-to-their-own-address-that-carries-no-contact-details-and-can-never-lose-a-request.md), [ADR 0384](../adr/0384-the-owner-manages-quote-requests-in-admin-with-no-crm-and-erases-them-only-after-a-preview-with-a-verified-result.md), [ADR 0387](../adr/0387-the-quote-form-runs-on-render-beside-the-server-the-owner-sets-retention-in-admin-and-an-erase-looks-before-it-gives-up.md), [ADR 0388](../adr/0388-a-quote-answer-that-cannot-be-confirmed-never-says-nothing-was-saved-and-a-photo-put-back-is-recorded-where-it-is.md).
- **Reviews as proof (TRADE4.3)**: [ADR 0389](../adr/0389-a-saved-review-is-a-proof-file-with-its-source-linked-from-one-job-and-stated-as-review-data-only-from-what-it-says.md), [ADR 0390](../adr/0390-a-saved-review-is-kept-in-the-render-workspace-stays-published-while-a-job-shows-it-and-a-copied-link-is-on-its-platform.md), [ADR 0391](../adr/0391-a-review-a-published-job-shows-cannot-be-deleted-and-a-copy-keeps-an-address-only-if-the-review-can.md), [ADR 0392](../adr/0392-a-copy-whose-pasted-link-is-too-long-keeps-the-address-it-led-to-or-is-refused-before-the-form-changes.md).
- **Sharing a job (TRADE5.1)**: [ADR 0393](../adr/0393-a-job-reaches-google-business-profile-from-the-cli-only-when-the-owner-turned-it-on-and-confirmed-its-digest.md), [ADR 0394](../adr/0394-nextdoor-is-a-by-hand-kit-because-its-publish-api-is-for-approved-partners.md), [ADR 0395](../adr/0395-a-job-projection-is-its-summary-service-town-link-and-first-after-photo-fitted-to-each-destination.md), [ADR 0396](../adr/0396-a-job-is-shared-from-admin-reaches-a-facebook-page-through-the-announcements-and-never-carries-a-located-photo.md), [ADR 0397](../adr/0397-a-job-already-at-a-place-is-never-sent-there-again-by-a-send-a-kit-or-a-reopened-screen.md).
- **Seasonal reminders (TRADE5.2)**: [ADR 0354](../adr/0354-seasonal-topics-are-bundled-per-trade-the-site-stores-only-its-changes-and-absent-means-off.md), [ADR 0355](../adr/0355-a-reminder-is-derived-from-the-date-and-a-private-record-and-opening-it-writes-one-unpublished-draft-that-nothing-can-publish.md), [ADR 0356](../adr/0356-the-reminders-screen-lists-what-to-write-now-moves-or-turns-off-a-bundled-topic-and-only-links-to-the-voice-flow.md).
- **Starter sites (TRADE5.3)**: [ADR 0398](../adr/0398-services-recent-jobs-and-reviews-are-landing-sections-in-version-3-that-render-nothing-until-there-is-something-to-list.md), [ADR 0399](../adr/0399-the-trade-starter-writes-only-what-it-can-state-truthfully-and-keeps-its-examples-as-drafts.md), [ADR 0400](../adr/0400-three-looks-for-trades-meet-aaa-contrast-and-choose-large-text-and-bold-headings.md), [ADR 0401](../adr/0401-the-ten-minute-checklist-is-worked-out-from-the-files-every-time-and-only-its-dismissal-is-stored.md).

Across all of them:

- **Opt-in and absent-means-unchanged.** Every new key, folder and section is optional; tests compare a site that
  never uses a feature byte for byte with one built before it existed.
- **Never invented.** Structured data (`LocalBusiness`, `Service`, `FAQPage`, `Review`, `AggregateRating`) is
  stated only from fields the owner wrote; the starter writes no phone, hours or review, and keeps its example
  services as drafts.
- **Towns, never addresses.** Places are a town and a region; digits and commas are refused, and a photo that may
  hold where it was taken is not shared.
- **Phone first.** Every Admin screen is designed at 400px with 44px controls; the home page puts the phone number
  directly under the banner as a large button.
- **Derived, not queued.** Archives, service-area pages, seasonal reminders and the checklist are worked out from
  the files each time, so nothing can fire, tick or publish while the owner is not looking.

## Testing decisions

- Core integration tests build sites in memory and check pages, structured data and absence (`job_archives`,
  `services_collection`, `service_pages`, `service_area_pages`, `business_render`, `proof_collection`,
  `quote_form`, `landing_trade_sections`).
- CLI tests scaffold real projects (`scaffold::tests`: the trade starter builds with no warnings and one `<h1>`,
  shows nothing invented, and its example services publish with one edit).
- Admin route tests cover session, CSRF, stale writes and read-only routes (`seasonal_routes`,
  `quote_routes`, `service_routes`, `trade_checklist_routes`: every step ticks and unticks with the files).
- Node tests cover Admin modules with a DOM shim (`admin-landing`, `admin-look`, `admin-trade-checklist`), and
  browser specs run the quote form and Admin screens at 400px with axe-core.
- Look tests hold every palette to AA and the three trade looks to AAA, in light and dark.
- Provider adapters (Google Business Profile, Facebook) are tested against scripted replies only; no live post has
  been made.

## Delivery slices

1. TRADE1: jobs as posts, archives, capture from a phone.
2. TRADE2 and TRADE3: business facts, services, service areas.
3. TRADE4: quote requests (#485, #486) and reviews as proof (#487).
4. TRADE5: sharing a job (#488), seasonal reminders (#489), starter sites (#490).
5. The scripted usability pass at 400px with timings (#531).

## Out of scope

- Invoicing, estimates, dispatch, scheduling of jobs, payment data, customer records beyond a quote request.
- A third-party captcha; posting to Nextdoor through its partner API; posting a photo to a Facebook Page.
- Generated or AI-written reviews, ratings or business facts.
