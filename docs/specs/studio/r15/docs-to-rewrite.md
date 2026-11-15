# R15: docs that send a reader to the old Admin for a Studio job

By `studio-housekeeping`, 2026-11-14. Scope: every sentence in `docs/` (excluding `docs/specs/` and `docs/adr/`) that tells a reader to use a screen in the old Admin for one of the seven jobs Studio already does: Sharing, accounts, notifications, New job, About this post, Add something, Before you publish. Each row names the Studio screen that replaces it, from the slice that built it (r1–r7). Nothing here is rewritten yet.

Line numbers are for the commit this list was made on (`chore/studio-housekeeping`, based on `feat/studio-retire` at `2a2eda1d`).

Two kinds of row:

- **Directive**: the sentence tells the reader to open, choose, tap, press or sign in to an old Admin screen.
- **Pointer**: the sentence names an old Admin screen as where the thing lives, or describes a legacy record as having come from the old Admin. These need a rewrite only if the doc should stop mentioning the old Admin at all.

## Sharing (r1, r2)

Studio screen: **Sharing** (`#/sharing`), with **Share this job** (`#/sharing/job/<path>`), **Where it went** (`#/sharing?view=posts`), **Your accounts** (`#/sharing/accounts`) and the Announcements sheets.

| File | Line | Sentence (shortened) | Kind | Studio screen |
| --- | --- | --- | --- | --- |
| `docs/README.md` | 65 | "from Admin's Share this job or the command" | Pointer | Sharing › Share this job |
| `docs/README.md` | 71 | "or Admin's **Where it went**" | Pointer | Sharing, second view (`#/sharing?view=posts`) |
| `docs/distribution-reporting.md` | 14 | "In Admin: **Where it went** (in the Simple workspace, under **More pages**)." | Directive | Sharing, second view |
| `docs/provider-capabilities.md` | 159 | "`openblog outcomes` and Admin's **Where it went** read every destination's private record" | Pointer | Sharing, second view |
| `docs/admin.md` | 1200–1204 | Section "Where it went" (describes the old screen; no Studio mention) | Pointer | Sharing, second view |
| `docs/job-sharing.md` | 7 | "In Admin, open a published job in Write and choose **Share this job**" | Directive | Sharing › Share this job (its own screen under Sharing) |
| `docs/job-sharing.md` | 10 | Heading "## In Admin" over the Share this job section (lines 10–23) | Directive | Sharing › Share this job |
| `docs/job-sharing.md` | 23 | "Google is not sent from Admin. … post it by hand from here." | Directive | Sharing › Share this job |
| `docs/job-sharing.md` | 89 | "you pressed **I posted it** in Admin" | Pointer | Sharing › Share this job (**I posted it**) |
| `docs/job-sharing.md` | 100 | "from Admin's **Share this job**" | Pointer | Sharing › Share this job |
| `docs/trades.md` | 55 | Step 5: "choose **Share this job**" (in the checklist under Admin's home) | Directive | Sharing › Share this job |
| `docs/social-publishing.md` | 17 | "You sign in to Admin as usual." | Pointer | Sharing (Studio's own sign-in) |
| `docs/social-publishing.md` | 318 | "Admin shows an **Announcements** tab" | Directive | Sharing › Announcements |
| `docs/social-publishing.md` | 321 | "See [Admin](admin.md#announce-a-post-on-social-media-optional) for how it is used." | Directive | Sharing › Announcements (link target) |
| `docs/admin.md` | 1348–1381 | Section "Announce a post on social media (optional)": the Announcements tab, Schedule, Edit, Cancel, Try again, Check the result | Directive | Sharing › Announcements |
| `docs/admin.md` | 1350 | "Admin shows an **Announcements** tab" | Directive | Sharing › Announcements |
| `docs/admin.md` | 1375 | "then choose **Check the result**" | Directive | Sharing › Announcements (Needs checking) |
| `docs/social-publishing.md` | 550 | "choose **Check the result** in Admin" | Directive | Sharing › Announcements (Check the result) |
| `docs/social-publishing.md` | 575 | Scheduling row: "Schedule an announcement in the **Announcements** tab." | Directive | Sharing › Announcements |
| `docs/social-publishing.md` | 578 | Operations row: "Admin shows **Delivery health**" | Directive | Sharing › Delivery health |
| `docs/social-publishing.md` | 714 | "or cancel them in Admin" | Directive | Sharing › Announcements (Cancel) |
| `docs/social-publishing.md` | 716 | "use **Check the result** in Admin" | Directive | Sharing › Announcements (Check the result) |
| `docs/social-publishing.md` | 717 | "Read its History in Admin." | Directive | Sharing › Announcements (History) |
| `docs/social-publishing.md` | 720 | "Admin's Social screen shows the same health under **Delivery health**" | Pointer | Sharing › Delivery health |
| `docs/social-publishing.md` | 751 | "and settle each in Admin" | Directive | Sharing › Announcements (Needs checking) |
| `docs/distribution-reporting.md` | 71 | "Admin reads them from your hosted queue" | Pointer | Sharing (describes the Sharing data source) |

## Accounts (r2)

Studio screen: **Sharing › Your accounts** (`#/sharing/accounts`, reached by **Manage your accounts**).

| File | Line | Sentence (shortened) | Kind | Studio screen |
| --- | --- | --- | --- | --- |
| `docs/social-publishing.md` | 128 | "Studio's **Connect** (or **Reconnect**) goes to Admin." | Pointer | Sharing › Your accounts |
| `docs/social-publishing.md` | 148 | "Admin asks for your handle (such as `name.bsky.social`) and an **app password**" | Directive | Sharing › Your accounts (connect Bluesky) |
| `docs/social-publishing.md` | 241 | "the old Admin's `#/social` opens it too" | Pointer | Sharing › Your accounts (`#/sharing/accounts`) |
| `docs/social-publishing.md` | 715 | "Reconnect it in Admin, then **Try again**" | Directive | Sharing › Your accounts (Reconnect) |
| `docs/social-publishing.md` | 734 | "disconnect the account in Admin, then in the SQL editor" | Directive | Sharing › Your accounts (Disconnect) |

## Notifications and the installed app (r3)

Studio screen: **Notifications** (`#/notifications`, from your name at the top right) and the installed app, which opens Studio.

| File | Line | Sentence (shortened) | Kind | Studio screen |
| --- | --- | --- | --- | --- |
| `docs/README.md` | 77 | "Notifications: Admin installed on your phone, buzzing when a comment…" | Pointer | Notifications and the installed app |

`docs/notifications.md` itself already points to Studio. Its line 53 ("or the old Admin's pages") describes what the worker never caches, so it is not listed.

## New job (r4)

Studio screen: **New job** (`#/new-job`), and **About this job** in Write for finishing a job.

| File | Line | Sentence (shortened) | Kind | Studio screen |
| --- | --- | --- | --- | --- |
| `docs/trades.md` | 51 | Step 3: "**Capture** takes photos on site and saves an unpublished job" | Directive | New job (`#/new-job`) |
| `docs/jobs.md` | 70 | "the old Admin's Job form wrote" | Pointer | About this job (`#/write/<path>`) |
| `docs/jobs.md` | 108 | "Jobs saved by the old Admin's Capture are on the same list" | Pointer | New job (`#/new-job`) |
| `docs/jobs.md` | 125 | "A job kept on a phone by the old Admin" | Pointer | New job (`#/new-job`) |

## About this post (r5)

Studio screen: Write › **About this post** (`?sheet=about`), which holds the Pinterest pin words (shown with Pins), the content profile and credits.

| File | Line | Sentence (shortened) | Kind | Studio screen |
| --- | --- | --- | --- | --- |
| `docs/visual-cards.md` | 54 | "In Admin, a post's settings have **Words for a Pinterest Pin** under the cover photo" | Directive | About this post (Pin title / description) |
| `docs/content.md` | 83 | "Select a profile in the admin's **Settings** view or write it directly" | Directive | About this post (What kind of post / content profile) |
| `docs/research-profile.md` | 9 | "Choose **Research** under **Settings → Content profile** in the admin" | Directive | About this post (content profile) |

`docs/visual-cards.md` line 56 ("Admin does not yet set `cardImage`…") is a statement of a limit, not a direction, so it is not listed.

## Add something (r6)

Studio screen: Write › **Add something** (`?add=1`), beside **Put a photo in**.

| File | Line | Sentence (shortened) | Kind | Studio screen |
| --- | --- | --- | --- | --- |
| `docs/content.md` | 625 | "In the admin editor, images can be inserted with a button, dragged in, or pasted" | Directive | Add something › Put a photo in |

## Before you publish (r7)

Studio screen: Write › **Before you publish** (the checklist), with its Field review and Release kit sections.

| File | Line | Sentence (shortened) | Kind | Studio screen |
| --- | --- | --- | --- | --- |
| `docs/field-journal.md` | 50 | "In the old Admin, open **Field Review** (`Alt+5`), choose the privacy mode" | Directive | Before you publish › Field review |
| `docs/content.md` | 106 | "an Admin release kit for validating chapters and composing reusable YouTube copy" | Pointer | Before you publish › Release kit |
| `docs/README.md` | 151 | "one readiness report that Admin, `openblog check`, builds" | Pointer | Before you publish (research checks) |
| `docs/getting-started.md` | 59 | "Use Admin for draft editing, scheduling, preview, and publishing workflows." | Directive (general) | Write (Before you publish; About this post for scheduling) |

## Noticed but not listed

These mention an old Admin screen but fall outside the seven jobs, or are not directions to a reader, so they are left for their own slices:

- Overview and its trade checklist (`docs/trades.md` 42–59, `docs/admin.md` 1208–1214): Admin's home is not one of the seven.
- Business facts, Services, Greeting cards, Quote requests, Seasons, Landing page, Customize look, Design a theme, Reminders, Analytics, Moderation, comparisons and reading paths: other slices.
- Writing helper and **Generate draft** (`docs/content.md` 368 and 610; `docs/admin.md` 128–130, 220, 1445): R8.
- Voice samples (`docs/admin.md` 404–409 and related): R9.
- Operator setup steps that say "restart Admin" or "hide it in Admin" (`docs/social-publishing.md` 573, 594, 627–628, 671–675): configuration, not a Studio job.
- Reviews (`docs/reviews.md` 10, 86–87, 128–129): the review form is not in r1–r7. Studio's R4 mentions reviews only inside About this job, so the Reviews page needs a decision before it is rewritten.
- `docs/publishing.md` 25 and 106, `docs/cross-posting.md` 135, `docs/pinterest.md` 170: Publish button, redirects, dry runs, and a not-yet-built item.
- `docs/admin.md` 568–569 and 1313–1314 (Markdown mode, photo picker on iPhone): describe the old modes and picker; not a direction to a Studio job.
- `docs/admin.md` 1283–1289 (phone walkthrough): Landing page and Customize look.

## How this was found

Every line of `docs/` (not `specs/` or `adr/`) containing "Admin", plus the phrases "old Admin" and "in Admin", was read and sorted by the seven jobs above. Descriptive sentences that only name the product ("Admin's preview", "the admin editor") were left out unless they point to a screen for one of the jobs. A later search may still turn up a sentence that was missed.

## Not changed

No doc has been edited. The rewrite is a separate step.
