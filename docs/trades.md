# A site for a trade business

open.blog can run the website of a tradesperson or small crew: a roofer, a plumber, a flooring installer, a
mobile mechanic. The site says who you are and how to reach you, what you do, the jobs you finished, what
customers said, and lets a visitor ask for a quote. Each of those is an ordinary open.blog feature you can also
use on its own; this guide puts them in the order a new owner needs them.

open.blog is not a field-service tool. There is no invoicing, estimating, dispatch, job scheduling or payment
data, and none is planned ([ADR 0285](adr/0285-jobs-are-posts-with-a-content-profile-and-open-blog-is-not-a-field-service-tool.md)).
Keep using the tools you have for those, and link to them if you like.

## Start in ten minutes

```sh
openblog init my-site --starter trade --trade roofing --title "Ridge Line Roofing"
cd my-site
openblog serve --admin
```

`--trade` is one of `general-contractor` (the default), `excavation`, `flooring`, `mobile-mechanic`,
`auto-body-paint`, `roofing`, `plumbing`, `electrical`, `landscaping`, `painting`, `hvac` or `other`. It picks the
kind of business search engines are told you are, and the seasonal reminders for your trade. You can change it
later under Business facts, or add your own trade to `extraTrades` in `openblog.json`.

The starter writes only what it can state truthfully
([ADR 0399](adr/0399-the-trade-starter-writes-only-what-it-can-state-truthfully-and-keeps-its-examples-as-drafts.md)):

- **Business facts** with your business name and trade. No phone number, hours or license are made up: you add
  them.
- **Three example services** (`Repairs`, `New installations`, `Inspections`) in `content/services/`, kept as
  **drafts**, so none of them is on your site until you make it your own.
- **Empty jobs and reviews.** Your jobs page appears with your first job, your reviews page with your first
  review. There is no "Hello, world" post.
- **A home page** built for a phone: your name and one sentence, your phone number and hours right under it, then
  what you do, your newest jobs, what customers say, and the quote form. Each part stays hidden until it has
  something to show, so a brand-new site never shows an empty heading.
- **The Workshop look**: black on white with a rust accent, large text and bold headings. Two other looks are made
  for trades, High-vis and Blueprint; pick one under **Customize look** (see [below](#looks-for-trades)).

A fresh starter passes `openblog check` with no warnings and builds as it is.

## The checklist on Admin's home

On a trade site Admin's home opens with **Your site in ten minutes**, five steps that tick themselves once your
site really has each one ([ADR 0401](adr/0401-the-ten-minute-checklist-is-worked-out-from-the-files-every-time-and-only-its-dismissal-is-stored.md)):

1. **Add your phone number or email** under [Business facts](configuration.md#business-facts). Admin takes the
   number the way you would type it.
2. **Publish your first service.** Open **Services**, edit an example (its name, summary and what it includes)
   and turn off **Keep this as a draft**. See [Services](services.md).
3. **Publish your first job.** **Capture** takes photos on site and saves an unpublished job; finish it in Write
   and publish it. See [Jobs](jobs.md).
4. **Save your first review.** Open **Reviews** and copy a real review from its link, or type it in. See
   [Reviews](reviews.md).
5. **Share a job where customers look.** Open a published job and choose **Share this job** for Google Business
   Profile, a Facebook Page and Nextdoor. See [Sharing a job](job-sharing.md).

A step is ticked from what your site holds, not from what you clicked: unpublish your only service and its step
opens again. **Hide** puts the checklist away for good for your Admin account; it also goes away by itself once
all five are done.

## Taking quote requests

The home page already has a place for the quote form, but it shows nothing until quote requests are turned on,
because they need a small hosted function and a private table in your Supabase project to receive what visitors
send. Follow [Quote requests](quote-requests.md) to set it up; the form then appears on your home page with your
services and service areas as choices.

## Towns you serve

List the towns you work in under `serviceAreas` in `openblog.json` ([Service areas](service-areas.md)). Each gets
a page with your jobs there, and the quote form offers them as choices. Towns only: never a street address.

## Between jobs

Turn on [seasonal reminders](seasonal-reminders.md) under **Reminders** to be told, at the right time of year,
what is worth writing about for your trade. A reminder only starts a draft for you; it never publishes or sends
anything.

## Looks for trades

Three of the curated looks under **Customize look** start with "For a trade"
([ADR 0400](adr/0400-three-looks-for-trades-meet-aaa-contrast-and-choose-large-text-and-bold-headings.md)):

- **Workshop**: black on white with a deep rust accent.
- **High-vis**: safety yellow on charcoal at night, dark olive on cream by day.
- **Blueprint**: deep drafting blue on white, pale blueprint blue at night.

They meet the strictest contrast level (AAA) in light and dark, and choosing one also makes text large and
headings bold, unless you already chose a size or weight. On the home page your phone number is a large solid
button in any look.

## The home page sections

Under **Landing** you can move, hide or rename every part of the home page. The three made for trades are:

| Section | Shows | Until then |
| --- | --- | --- |
| **Services** | a card for each published service, linking to its page | nothing |
| **Recent jobs** | your newest published jobs (3, or up to 12) | nothing |
| **Reviews** | your newest reviews with their links (3, or up to 12) | nothing |

They are described for hand editing in [Content](content.md#landing-page-sections)
([ADR 0398](adr/0398-services-recent-jobs-and-reviews-are-landing-sections-in-version-3-that-render-nothing-until-there-is-something-to-list.md)).
A home page that holds one of them is saved as landing version 3; an older open.blog refuses that file rather than
changing it.

## What is private and what is public

| Kept private | Published |
| --- | --- |
| Quote requests (your Supabase project only) | Business facts you stated |
| The record of where each job was shared (`.openblog/job-shares.json`) | Published services, jobs and reviews |
| Seasonal reminder choices (`.openblog/private/seasonal.json`) | Your service areas |
| Draft services, jobs and reviews | The home page sections that have something to show |
