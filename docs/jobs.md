# Jobs

A job is a post that records one piece of finished trade work: a floor, a driveway, a brake repair.
It is an ordinary post with `profile: job`, so feeds, tags, series, search and export treat it like any
other post ([ADR 0285](adr/0285-jobs-are-posts-with-a-content-profile-and-open-blog-is-not-a-field-service-tool.md)).
A site that never uses the profile builds exactly as it did before.

open.blog is not a field-service tool. There is no invoicing, estimating, dispatch, job scheduling or
payment data. A job may show a cost band as a public price signal; it is never a quote.

## Front matter

Use the usual post keys (`title`, `date`, `tags`, `description`, and so on) plus one `job` mapping:

```yaml
---
title: New oak floor in Maple Falls
date: 2026-10-21
tags: [flooring]
profile: job
job:
  trade: flooring
  service: hardwood-install
  place:
    town: Maple Falls
    region: WA
  started: 2026-10-14
  finished: 2026-10-16
  durationHours: 22.5
  costBand: 2k-10k
  materials:
    - Red oak 3/4 in
    - Matte finish
  media:
    before:
      - /images/floor-before.jpg
    after:
      - /images/floor-after.jpg
  review: rev_01
---
```

| Field | Required | Rule |
| --- | --- | --- |
| `trade` | yes | One of the trades below, or a trade the site adds. |
| `service` | yes | A short id: lowercase letters, digits and hyphens. When the site has [services](services.md), one of their ids. |
| `place.town`, `place.region` | yes | A plain name. Digits and commas are refused: towns only, never an address or postal code. |
| `started`, `finished` | yes | `YYYY-MM-DD`. `finished` is the same day as `started` or later. |
| `durationHours` | no | A number of hours greater than 0. |
| `materials` | no | Up to 50 short items. |
| `costBand` | no | `under-500`, `500-2k`, `2k-10k`, `10k-50k`, `over-50k` or `ask`. Never free text. |
| `media.before`, `media.after` | no | Up to 50 image references each: a site path or http(s) URL ending in `png`, `jpg`, `jpeg`, `gif`, `webp`, `avif` or `svg`. |
| `review` | no | The id of a saved [review](reviews.md) (letters, digits, `-`, `_`). Once the site has reviews it must be one of them, and each review describes one job. |

Keys you add that this version does not know are kept untouched, so a file written by a newer version
survives an older one. The `job` mapping is the only place front matter may nest.

## Writing a job

In Studio, **Write something new** on a trade site asks what you're writing; **A job** starts one with today as the
day it started and finished, your site's trade, and the four headings `Problem`, `What we found`, `What we did`
and `Result`. While the words are exactly those four headings, Write shows them as four boxes, one per heading,
and gives the body back byte for byte when you change nothing in a box; any other shape stays one box of ordinary
Markdown.

**About this job**, under the title, asks for the service (one of your [Services](services.md) by name, or
**Something else**), the town and state, the days it started and finished, the price shown (a range customers
see, never a quote) and the customer's review (one of those saved under [Reviews](reviews.md)). It asks for the
trade only when the site has more than one or none set. It writes the `job` mapping above with exactly the keys
the old Admin's Job form wrote; hours and materials you add by hand are kept. Each photo in a job gets **Before**,
**After** or **Neither**, written to `job.media.before` and `job.media.after` in the order the photos are in the
post; mark at least one After photo, since it's the one people see when you share the job.

**Publish** first checks the job the way the build will (`POST job/check`, including that the service is one of
your services and the review one of your reviews). If something is missing it doesn't publish: it lists what to
fix in plain words, each with **Go to it**. **Save draft** always works.

From the command line, `openblog new "New oak floor" --profile job` writes the same front matter and the same
four headings. Add `--trade`, `--service`, `--town` and `--region` to fill them in; each is checked the way the
build checks it, and an unknown trade is refused with the bundled trades and your own `extraTrades` listed. A job
made this way is always a draft (the dates start as today), so a half-written one never stops a build; it is
reported as `job not ready to publish` until you finish it and remove `draft`.

## Capturing a job from a phone

On site, open **New job** (in Studio's navigation on a trade site, on Home as **Add a job from the site**, and
when you touch and hold the installed app's icon). It is one column built for a phone: **Take a photo** opens the
camera, **Choose photos** opens the library, then **Record a voice note** and **What did you do?**. Your trade,
service and town are remembered on that phone (the last five towns are one tap away) and shown as one line with
**Change**. **Save this job** keeps the job on the phone and sends it to your blog as an unpublished draft as soon
as there's a signal: the job's keys, the four headings, your words under the first and the photos after them.

Photos are made smaller on the phone before they're kept: at most 2000 pixels on the long side, a JPEG at quality
0.82, redrawn so where the photo was taken doesn't come along (the server's own rule; it still checks again). A
photo the phone can't read is kept as it was. A job holds at most twelve photos (each within your upload limit)
and 8,000 characters of words.

**Nothing is lost.** What you're in the middle of is kept as you go (iPhones can reload the page when the camera
opens), and New job picks up where you left off. A saved job waits on the phone until it has been sent: it goes
when the signal comes back, whichever Studio screen is open, and Home says "2 jobs waiting on this phone" until
then. Each waiting job shows where it stands (waiting, sending, needs you, didn't send) with its one next step,
and **More** offers **Save the photos to this phone** and **Throw it away** (which asks first). Sending twice
never makes a second draft, because every job carries its own id; the server also says which photos it already
has, so a job interrupted half way sends only the rest. The phone keeps at most five waiting jobs, 60 MB each and
120 MB in all, says so when one doesn't fit, and never deletes a job by itself. A browser that can't keep
anything (some private windows) sends straight away instead. Opened once, New job opens again with no signal.

Jobs saved by the old Admin's Capture are on the same list (the browser's IndexedDB `openblog-capture`, version
1, store `captures`; its name, version and format are permanent) and are sent by Studio. The iPhone Home Screen
app and Safari keep separate lists. The old `#/capture` address opens New job.

**Record a voice note** starts only when you tap it (the phone then asks for the microphone), shows the time, and
stops with **Stop**, at three minutes or at 8 MB, whichever comes first; leaving the screen stops and keeps it.
The note is sent with the job and kept privately on your own server (in `.openblog/captures/`, never in your
site's files or the post), and plays in Write under **Your voice note from the site**. Nothing is transcribed and
nothing is sent to a provider unless you choose it: **Turn it into words** (on New job with a signal, or later in
Write) first says where the recording goes (only the recording), and the words come back under what you typed,
made plain, with **Undo**. Setting up a provider or a local engine is in
[the admin guide](admin.md#transcribing-a-voice-note).

**Write it up for me** (in Write's **More** on a job, and in Find) turns your words into a title, a one-line
summary and the four parts. It appears only when your site has an Assistant provider. It first says what goes and
where: your words in this job, its service and town, and your voice guide if you leave **Make it sound like me**
on; never your photos or voice note. What comes back fills the boxes for you to read and change, keeps your photos,
and **Undo** takes it all back; nothing is saved until you save. A job kept on a phone by the old Admin with a
draft from **Draft with AI** still sends with that draft.
See [ADR 0296](adr/0296-a-capture-is-a-job-draft-started-from-a-phone-built-from-the-job-forms-own-keys.md),
[ADR 0297](adr/0297-a-capture-waits-in-a-bounded-versioned-queue-on-the-phone-and-is-sent-with-its-id-as-an-idempotency-key.md),
[ADR 0298](adr/0298-a-voice-note-is-recorded-only-after-a-tap-is-bounded-in-time-and-size-and-stays-on-the-authors-server.md),
[ADR 0302](adr/0302-transcription-is-a-separate-confirmed-call-through-the-provider-boundary-that-sends-only-the-recording-and-returns-untrusted-text.md)
and [ADR 0304](adr/0304-a-draft-is-applied-as-editable-unsaved-fields-in-capture-with-one-undo-and-the-authors-save-is-the-only-save.md).

## Trades
Bundled: `general-contractor`, `excavation`, `flooring`, `mobile-mechanic`, `auto-body-paint`, `roofing`,
`plumbing`, `electrical`, `landscaping`, `painting`, `hvac`, `other`. Add your own in `openblog.json`:

```json
{ "extraTrades": ["fencing"] }
```

## Archives

Jobs are browsable the way customers look for them. When a site has jobs, the build adds:

- `/jobs/`: every job, newest first, with links to each trade.
- `/jobs/<trade>/`: one trade's jobs, with links to its services.
- `/jobs/<trade>/<service>/`: one service within a trade.

They page like the home page (`postsPerPage`; later pages are `/jobs/page/2/` and so on), appear in `sitemap.xml`, and are
built in a fixed order. A trade or service with no jobs gets no page, and a site with no jobs gets no `/jobs/` at all. Feeds
are unchanged: jobs are posts, so they are in them as posts. `page` cannot be a trade or service id. See
[ADR 0286](adr/0286-jobs-archives-are-derived-from-job-posts-and-page-like-the-home-page.md).

## Sharing a finished job

`openblog job-share <slug>` prepares a published job for Google Business Profile, a Facebook Page and Nextdoor,
and `--kit <new folder>` writes a page to post each by hand. See [Sharing a job](job-sharing.md).

## Checks

A published job with a problem stops the build with a sentence naming the field, for example
``job.costBand: `cheap` is not a cost band; use one of under-500, 500-2k, ...``. Every problem is listed
at once. A draft job is allowed to be unfinished: its problems are warnings, prefixed
`job not ready to publish`.
