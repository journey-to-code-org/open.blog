---
title: A post from the future
date: 2026-12-24T09:00:00Z
series: running-your-blog
seriesOrder: 5
tags:
  - guide
  - scheduling
description: This post was written weeks before it appeared. A future date in its front matter held it back until the morning of December 24th, 2026.
---

If you are reading this on the live site, it worked. This post was written in November 2026,
and its front matter says:

```yaml
date: 2026-12-24T09:00:00Z
```

Until that moment it was **scheduled**. It was not on the home page, in the archive, in the
feeds, in the sitemap, in search, on its tag pages, or in the
[Running your blog](/series/running-your-blog/) series. The previous part linked here, but that
link went to a missing page until today.

## How it went live

- **With `openblog serve`**, the server checks every few seconds and rebuilds the site by itself
  at the moment a post comes due.
- **On a static host**, any build after that time includes it. A scheduled job, such as a daily
  cron or GitHub Actions workflow that runs `openblog build`, is enough.
- **In the Admin**, choose **Scheduled**, then pick a date and time in your own time zone. It is
  stored as UTC.

Times can carry an offset, such as `2026-12-24T09:00:00-05:00` for 9am in New York.

## Previewing a scheduled post

```sh
openblog serve --drafts
```

`--drafts` includes drafts and scheduled posts, for your eyes only. The Admin lists them with a
"scheduled" badge.

Happy holidays, whenever you are reading this.
