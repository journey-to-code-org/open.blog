# Video productions and release kits

Use the Video production content profile for a creator-owned companion to a YouTube video.
The Markdown remains the durable source for transcripts, production notes, links, and any
world-building or workflow material that does not fit comfortably in a platform description.

## Create a video post

Select **Video production** under **Settings → Content profile**, or write the fields directly:

```yaml
---
title: Zhalendor — Episode 1
date: 2026-10-23
profile: video
productionStatus: editing
seasonNumber: 1
episodeNumber: 1
productionCredits: Writing and direction by the Lantern Gate team; animation and edit by the episode crew
videoUrl: https://www.youtube.com/watch?v=dQw4w9WgXcQ
duration: 12 min 34 sec
thumbnail: /images/zhalendor-episode-1.jpg
aiDisclosure: AI-assisted animation with human writing, direction, and editing.
series: zhalendor
---
```

`productionStatus` follows the workflow shown in Admin's Release kit: `idea`, `scripting`,
`storyboarding`, `generating`, `editing`, `scheduled`, and `released`. Season and episode numbers
and concise production credits appear in a visible production summary. They remain ordinary,
portable front matter rather than service-specific project records.

The example site includes a [complete fictional Zhalendor episode](../content/posts/2026-10-24-zhalendor-gate-of-embers.md)
with chapters, a production checklist, shot notes, transcript, credits, and disclosure.

`videoUrl` accepts `youtube.com/watch`, `youtu.be`, and `youtube.com/shorts` addresses. The
published page rebuilds the address into a `youtube-nocookie.com` player rather than copying
arbitrary iframe input. It retains a visible fallback link to YouTube. If the same URL also
appears as a standalone link in the Markdown, open.blog renders only one player.

`duration` accepts a readable duration (`12 min 34 sec`), a clock duration (`12:34` or
`1:02:03`), or ISO 8601 (`PT12M34S`). `thumbnail` may be site-relative or absolute; the
ordinary post `cover` is used as its fallback. Builds warn when a video URL or discovery
image is missing or when the YouTube URL shape is unsupported.

The generated page emits schema.org `VideoObject` JSON-LD with its name, description,
upload date, thumbnail, embed URL, duration, contributors, series, and the authored
AI-assistance credit when those values are available. OpenBlog does not infer whether a
platform disclosure is legally or contractually required; the creator remains responsible
for the final YouTube settings and wording.

## Chapters and transcripts

Write chapters as ordinary timestamp lines anywhere outside fenced or inline code:

```markdown
## Chapters

00:00 The gate opens
00:14 A warning in the dark
01:02 Into the ruin

## Transcript

Opening narration…
```

Open **Release kit** in Admin Studio (`Alt+4`). The kit checks that the first chapter begins
at `00:00`, at least three chapters exist, timestamps are chronological, and each chapter is
at least ten seconds long. It then combines the post description, validated timestamp lines,
and optional AI-assistance disclosure into a YouTube-ready description. Review the result and
use **Copy release description**; OpenBlog never changes the YouTube video itself.

Transcript text remains part of the normal Markdown body, so it participates in site search,
feeds, accessibility review, and the site's text exports without requiring a proprietary
sidecar format.

## Prepare a YouTube release

A video post can also carry what a YouTube upload needs. These fields are optional, nothing in
your site, feeds or exports reads them, and open.blog never makes a video from an article: the
release is only ever the video you made and the words you wrote for it.

```yaml
videoFile: media/zhalendor-episode-1.mp4      # the master file, outside the static folder
videoTitle: Zhalendor, Episode 1: The Gate of Embers
videoDescription: Seven travelers reach a sealed mountain gate as an old ward fails.
captions: media/zhalendor-episode-1.en.vtt, media/zhalendor-episode-1.es.vtt
videoRights: owned            # owned or licensed
videoPeople: none             # consented or none
madeForKids: no               # yes or no
syntheticMedia: no            # yes or no
```

- `videoFile` is the file to upload, as a path inside your project (or set `videoUrl` for a video
  already on YouTube; both may be set). `videoTitle` and `videoDescription` default to the post's
  title and description.
- Chapters are the timestamp lines in the body, and the transcript is the `## Transcript` section,
  exactly as above.
- `captions` lists WebVTT (`.vtt`) or SubRip (`.srt`) files named for their language
  (`name.en.vtt`, `name.pt-BR.srt`).
- The four answers are yours to give: whether you hold the rights, whether everyone identifiable
  agreed to appear, whether the video is made for kids (YouTube asks every creator), and whether it
  contains realistic altered or synthetic content (YouTube asks you to disclose it).

Run `openblog video <slug>` to check the release, or `openblog video <slug> --preview <new folder>`
to write it out: `title.txt`, `description.txt`, `tags.txt`, `transcript.txt`, a copy of the
thumbnail, `preview.json`, and an `index.html` you can open in any browser. The description is your
opening, then `Read the article:` with the post's canonical address, then the chapters and the
AI-assistance note, so viewers can always reach your site. Nothing is uploaded and no account is
needed: the page lists the steps to follow in YouTube Studio, and the video starts private until
you publish or schedule it there.

The preview checks YouTube's own rules (as of 2026-10-29): a title of at most 100 characters and a
description of at most 5,000 bytes, neither containing `<` or `>`; tags of at most 500 characters
in all; and the chapter rules above. Anything that would be refused is listed with a code, and
the release is **Blocked** until you fix it; open.blog never shortens your words to fit. A post
that is not live yet is noted, so you keep the video private until it is.

### What blocks a release

Before anything can go to YouTube, the preview also checks the files and answers themselves
([ADR 0843](adr/0843-a-release-is-blocked-until-its-source-is-a-private-video-every-consent-answer-is-given-and-a-text-alternative-exists.md)):

- **The video.** `videoFile` must be a path inside your project, kept out of the static and
  output folders (anything there is published with your site, before its release), in a format
  YouTube accepts (mp4, m4v, mov, 3gp, webm, avi, wmv, flv, mpg or mpeg), and actually start like
  one. A video already on YouTube (`videoUrl`) needs no file.
- **Your answers.** All four must be given; a missing or misspelt answer blocks the release and
  is never filled in for you.
- **A text alternative.** The video needs caption files or a Transcript section. Each caption file
  must exist, be WebVTT or SubRip text, name its language, and be the only one for that language.
- **The thumbnail.** A JPEG or PNG in your static folder, at least 640 pixels wide and at most
  50 MB. A thumbnail that is not 16:9, an `https` thumbnail open.blog cannot check, or no thumbnail
  at all is noted rather than blocked.

open.blog reads only each file's size and first bytes, never follows a symbolic link, and never
reads outside your project.
