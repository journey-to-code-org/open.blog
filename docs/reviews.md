# Reviews

A review is a customer's own words about your work, saved with where they left it, so anyone can check it. You
show it beside the job it describes and on a Reviews page. Each one is a Markdown file in `content/proof/`. A site
with no such folder builds exactly as before
([ADR 0389](adr/0389-a-saved-review-is-a-proof-file-with-its-source-linked-from-one-job-and-stated-as-review-data-only-from-what-it-says.md)).

Only save a review a customer really wrote, and only where you can link to it.

## Adding a review in Admin

Open **Reviews** (`#/reviews`, under the Content tabs and in the command palette) and tap **Add a review**. There are
two ways to bring one in:

- **Copy it from its link.** Paste the review's link under **Link to copy from** and tap **Copy the page**. The page is
  fetched once, at that moment, and never again. The link, where it was left and the time it was copied are filled
  in for you; the page's text is shown under **What the page said** so you can read off the reviewer's name, the
  day and the stars, and copy the review's own words into **The review**. When a short or shared link (such as a `share.google` one)
  led to a page on Google, Facebook or another named site, the review keeps the address it led to, so its link is on
  the site it names. A copied review's link cannot be changed; to use another link, add a new review. Pages that need a sign-in, and pages built by script (Google and Facebook
  pages often are), may give little or no useful text; then type the review in.
- **Type it in.** Fill in the reviewer's name, the day it was written, where it was left, its link, its stars (or
  **No stars**) and its words.

A new review's id is made from the reviewer's name and the day. If you already have a review with that id, nothing is
saved and the screen asks you to change the id, for example by adding `-2` to the end.

Copying uses the Assistant's own URL snapshot route, with the same limits and refusals: public web addresses only
(never a local or private network address, and every redirect is checked again), at most 4 redirects, 512 KB of
page, 64 KB of text and 12 seconds, and only HTML, Markdown or plain text. When a page is refused, the screen says why
in plain words. Nothing is ever fetched when you save or edit a review.

To show a review beside its job, open the job in Write and choose it in **Customer review** (under **About this job**).
Each review describes one job. The screen is one column, designed at 400px, with 44px controls, and it saves through the same
document routes as posts and services.

## A review file

```markdown
---
version: 1
id: dana-r-2026-10-20
author: Dana R.
date: 2026-10-20
platform: google
sourceUrl: https://g.page/r/your-business/review
rating: 5
provenance: snapshot
retrievedAt: 2026-11-08T15:04:05Z
---
On time, careful with our things, and the floor looks great.

Would hire again.
```

| Field | Required | Rule |
| --- | --- | --- |
| `version` | no | `1`. Another number is refused. |
| `id` | yes | Letters, digits, `-` and `_`, up to 64 characters. A job names the review by it in `job.review`. |
| `author` | yes | The name the reviewer shows, up to 80 characters on one line. It is shown on your site. |
| `date` | yes | The day the review was written, `YYYY-MM-DD`. |
| `platform` | yes | `google`, `facebook`, `nextdoor`, `yelp`, `houzz`, `angi` or `other`. |
| `sourceUrl` | yes | The review's link, `https://`. For a named platform it must be on that platform's own site (for Google, `google.<country>`, `g.page` or `goo.gl`). Use `other` for any other site. |
| `rating` | no | A whole number of stars from 1 to 5. Leave it out when the review has no stars; nothing else is accepted. |
| `provenance` | no | `entered` (typed in, the default) or `snapshot` (copied from its link). |
| `retrievedAt` | with `snapshot` | When it was copied, such as `2026-11-08T15:04:05Z`. Only a copied review has it, and its `date` cannot be later. |
| `draft` | no | `true` keeps the review off the site. |

The words below the front matter are the review, up to 5,000 characters. They are shown exactly as written, as
plain text: Markdown and HTML in them are shown, not run. Keys you add that this version does not know are kept.
Every problem in a file is listed at once, each naming its field.

## Linking a job

```yaml
job:
  # ...
  review: dana-r-2026-10-20
```

Once your site has a saved review, a published job whose `job.review` names one it does not have stops the build,
with the known ids listed; so does a second job naming the same review. A site that has no reviews yet only gets a
warning for a `job.review` line. Delete a review only after its job has chosen another.

Admin checks this the way the build does, which leaves drafts out. While a published job shows a review, the review
cannot be kept as a draft or given another id: Admin names the job and asks you to choose another review for it first.
A published job cannot be saved naming a review that is a draft.

## Where reviews show

- **The job's page**: "What the customer said", after the job's own text: the words, the stars when there are some,
  the reviewer's name and day, a link "read it on Google" (or the platform it is on), and either "Typed in from the
  original review" or "Copied from the review's link on ...".
- **The jobs lists** (`/jobs/` and each trade and service): one line under a job that has a review.
- **`/reviews/`**: every review, newest first, each with a link to its job. The page, a **Reviews** link in the
  navigation and its sitemap entry exist only while the site has a review, and `reviews` cannot then be a page's or
  post's first path segment.
- **Exports and feeds**: a job's `openblog export` copy and its entry in `rss.xml` and `feed.json` carry the same
  section. Cross-posting does not carry it yet.

The look comes from `web/base.css` in every bundled theme; see [theme components](theme-components.md#styling-reviews).

## Structured data

Nothing is stated that the files do not say.

- A job page with a review adds a `Review` to its data: the author, the day, the words, the link, the platform as
  `publisher` (not for `other`), and the business as `itemReviewed` (your `LocalBusiness` when [business
  facts](configuration.md#business-facts) are set, else your site's name). `reviewRating` is there only when the file has
  a `rating`.
- `/reviews/` states the business with all its reviews, and an `AggregateRating` only when at least
  `reviews.aggregateMinimum` reviews have stars. It averages only those, rounded to one decimal, and gives their
  count; reviews without stars are never counted.

```json
{ "reviews": { "aggregateMinimum": 3 } }
```

`aggregateMinimum` is a whole number from 1 to 1000; the default is 3. Search engines decide for themselves whether to
show stars, and may not for reviews a business shows on its own site.

## On Render

Reviews need nothing new where the site runs: they are files, built into ordinary pages. When the Render service
keeps your unpublished work in its [Supabase workspace](deploy.md#durable-editorial-workspace-on-ephemeral-hosts), a
review saved in Admin is kept there like a post, so a restart before you publish does not lose it. Copying a page from a
link needs the Admin server to reach the internet, which it can on Render and on your own computer.
