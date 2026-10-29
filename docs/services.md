# Services

A service is one thing your business sells, described once: what it includes, a starting price band, a typical
timeline and the questions customers ask. It is a Markdown file in `content/services/`. A site that has no such
folder builds exactly as it did before ([ADR 0400](adr/0400-services-are-a-services-collection-of-markdown-files-with-versioned-front-matter-and-a-jobs-service-is-checked-against-it-only-when-the-site-has-one.md)).

open.blog is not a field-service tool. A price band is a label you choose to show; nothing here adds up,
estimates or quotes.

## A service file

```markdown
---
version: 1
id: hardwood-install
name: Hardwood floor installation
summary: Solid oak or maple floors, nailed down and finished on site.
includes:
  - Removing the old floor
  - Subfloor check and repairs
  - Two coats of finish
priceBand: 2k-10k
typicalTimeline: 2 to 4 days
faq:
  - question: Can you match my existing floor?
    answer: Usually. We bring samples so you can compare in your own light.
  - question: Do I have to move out?
    answer: No. We work one room at a time.
---
Anything you write here is the long description on the service's page, as ordinary Markdown.
```

| Field | Required | Rule |
| --- | --- | --- |
| `version` | no | `1`. Another number is refused; update open.blog if the file came from a newer one. |
| `id` | yes | Lowercase letters, digits and hyphens, up to 60 characters, not `page`. Jobs name the service by this id. |
| `name` | yes | Up to 120 characters on one line. |
| `summary` | yes | One sentence, up to 300 characters. |
| `includes` | no | Up to 30 short items, 160 characters each. |
| `priceBand` | no | The same set a job's `costBand` uses: `under-500`, `500-2k`, `2k-10k`, `10k-50k`, `over-50k` or `ask`. Never free text. |
| `typicalTimeline` | no | A short label up to 80 characters, such as `2 to 4 days`. |
| `faq` | no | Up to 20 entries, each with a `question` (200 characters) and an `answer` (1,000). Plain text. |

Every text value is plain text on one line. Keys you add that this version does not know are kept untouched.
Each problem is a sentence naming the field, and every problem in a file is listed at once.

## What the build makes

A site with at least one service gets:

- `/services/`: every service with its summary, price band and timeline, and its three newest jobs.
- `/services/<id>/`: one page per service with what is included, your body text, the price band and timeline,
  the questions and answers, and the five newest jobs done for it, with links to the archives
  (`/jobs/<trade>/<id>/`) that list them all.
- `Service` structured data on each page, and `FAQPage` data beside it **only when the service has questions**.
  The provider is your business facts when you have set them ([Configuration](configuration.md#business-facts)),
  otherwise the site title. Everything comes from the file, the same files always build to the same pages, and
  text is escaped so nothing in a question can break the page.
- The index and each page in `sitemap.xml` and `llms.txt`, and a **Services** link in the header navigation
  (unless your own `nav` already links to `/services/`). `services` can no longer be a page or post address.

The price band is shown in words (`$2,000 to $10,000`) with the note that it is a guide, not a quote. Change
one band, rebuild, and the page, the index and the structured data all change. A site with no services builds
exactly as it did before. See [ADR 0401](adr/0401-service-pages-the-index-and-their-structured-data-are-rendered-from-the-collection-alone-deterministically-and-only-for-a-site-that-has-services.md).

## Jobs and services

A job names its service in `job.service` ([Jobs](jobs.md)). Once your site has at least one service, that id has
to be one of them: a job that names another one stops the build with
``job.service: `hardwod-install` is not one of this site's services; known service ids are hardwood-install, tile``.
A draft job gets the same sentence as a warning. A site with no services does not check it at all, so existing
jobs keep working and you adopt services when you are ready. Two services cannot share an id.
