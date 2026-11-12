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
you publish or schedule it there. To let open.blog upload it for you instead, see
[Upload an approved release](#upload-an-approved-release).

The preview checks YouTube's own rules (as of 2026-10-29): a title of at most 100 characters and a
description of at most 5,000 bytes, neither containing `<` or `>`; tags of at most 500 characters
in all; and the chapter rules above. Anything that would be refused is listed with a code, and
the release is **Blocked** until you fix it; open.blog never shortens your words to fit. A post
that is not live yet is noted, so you keep the video private until it is.

### What blocks a release

Before anything can go to YouTube, the preview also checks the files and answers themselves
([ADR 0377](adr/0377-a-release-is-blocked-until-its-source-is-a-private-video-every-consent-answer-is-given-and-a-text-alternative-exists.md)):

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

open.blog reads each file's size and first bytes to validate it. For a release without blocking
problems, it also reads each caption file in full to bind its contents to the preview. It never
follows a symbolic link or reads outside your project. A JSON preview includes each caption's
byte count and BLAKE2b-512 digest, so the file can be identified without including its text.

## Upload an approved release

open.blog can upload a release for you, but only after you opt in twice: once for the channel, and
once for each release. Until then everything above works exactly as before and nothing is sent.

### Connect a channel (once per computer)

1. In the [Google Cloud console](https://console.cloud.google.com/), in a project of your own,
   enable the **YouTube Data API v3** and create an OAuth client of the **Desktop app** type.
2. Set its id (and secret, if it has one) in your shell, never in the project:
   `OPENBLOG_YOUTUBE_CLIENT_ID` and `OPENBLOG_YOUTUBE_CLIENT_SECRET`.
3. Run `openblog youtube connect`, open the address it prints in a browser signed in to the
   channel's Google account, and allow both permissions: uploading videos (`youtube.upload`) and
   viewing the channel (`youtube.readonly`, used only to look for an upload whose outcome was
   lost). open.blog stores nothing unless you allow both.

The refresh token is kept in `.openblog/private/youtube/credential`, encrypted for your Windows
account (or readable only by you elsewhere), and is never in your site, a log or an error.
`openblog youtube status` shows whether a channel is connected and sends nothing;
`openblog youtube disconnect` revokes the access at Google and deletes the file. If Google cannot be
reached, the file is deleted anyway and you are told to remove open.blog's access at
[myaccount.google.com/permissions](https://myaccount.google.com/permissions).

### Approve, then upload

```bash
openblog video zhalendor-episode-1                       # prints the approve command with the digest
openblog video zhalendor-episode-1 --approve <digest> --publish-at 2026-11-02T09:00:00Z
openblog video zhalendor-episode-1 --upload
```

- `--approve <digest>` approves exactly the release you previewed and the video file as it is now.
  The preview digest also covers the full contents of each caption file. It sends nothing. If you
  later change the release, a caption file, the post's address or the video file, the upload is
  refused until you preview and approve again. Older approvals for releases with captions must be
  reviewed and approved again.
- `--publish-at` is optional. With it, YouTube makes the video public at that time, which must name
  its zone, be in the future, and be no earlier than the article's date. Without it, the video
  stays private until you publish it in YouTube Studio. The upload itself is always private.
- `--upload` sends the video in pieces, so an interrupted upload resumes where it stopped the next
  time you run it, then sets the thumbnail. A draft post is not uploaded.
- open.blog does not upload caption files: add them in YouTube Studio after the upload.

When it is done, open.blog prints the video's address. Add it to the post as `videoUrl:` to embed
the video on your page.

### When something goes wrong

Every failure says what happened, with a code, and whether anything was sent:

- `quota-exceeded`: your Google project's daily YouTube quota is spent; it resets at midnight
  Pacific Time. Run `--upload` again then; it resumes.
- `upload-limit-reached`: your channel reached YouTube's own daily upload limit.
- `rate-limited` or `provider-unavailable`: try again later; the upload resumes.
- `grant-revoked`, `permission-missing` or `client-changed`: run `openblog youtube connect` again.
- `rejected` or `forbidden`: YouTube refused the release and no video was created. (A refusal that
  comes after the whole file was sent makes the release unknown instead, as below.)
- A thumbnail YouTube refuses (custom thumbnails need a verified channel) leaves the video uploaded;
  `--upload` retries only the thumbnail.

If the whole file was sent but YouTube's reply was lost, open.blog cannot know whether the video
exists, so the release becomes **unknown** and nothing more is sent. That holds even if you change
the release, approve it again or re-encode the file before the next `--upload`. Run
`openblog video <slug> --lookup`: it records the video if exactly one upload since the attempt has
your title and description, and says nothing was uploaded only if the channel has no upload at all
since then (and at least fifteen minutes have passed). Otherwise check YouTube Studio and record
what you find with `--settle uploaded:<video id>` or `--settle not-uploaded`.
`openblog video <slug> --status` shows the release's state and history. The record is kept on this
computer only, in `.openblog/private/youtube/`
(ADRs [0378](adr/0378-youtube-uploads-use-the-deployers-own-google-client-a-loopback-pkce-grant-and-a-refresh-token-protected-on-the-authors-machine.md),
[0379](adr/0379-an-approved-release-is-uploaded-private-through-a-recorded-resumable-session-and-youtube-not-open-blog-schedules-its-publication.md),
[0380](adr/0380-the-youtube-id-is-recorded-privately-and-an-upload-whose-reply-was-lost-is-unknown-until-a-lookup-or-a-person-settles-it.md)).

YouTube's rules were checked on 2026-10-29 against the
[resumable upload protocol](https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol),
[videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert),
[thumbnails.set](https://developers.google.com/youtube/v3/docs/thumbnails/set),
[the API errors](https://developers.google.com/youtube/v3/docs/errors),
[quota costs](https://developers.google.com/youtube/v3/determine_quota_cost) and
[OAuth for desktop apps](https://developers.google.com/identity/protocols/oauth2/native-app).
Only the videos.insert page was read again, on 2026-11-08: an upload still counts against its own
allowance of 100 a day, and uploads from a Google project that Google has not verified are not
locked to private. The other pages were not read again since 2026-10-29.
