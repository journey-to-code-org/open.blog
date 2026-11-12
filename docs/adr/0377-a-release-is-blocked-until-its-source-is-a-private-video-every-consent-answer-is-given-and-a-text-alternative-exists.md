# ADR 0377: A release is blocked until its source is a private video, every consent answer is given, and a text alternative exists

- Status: Accepted
- Date: 2026-10-29
- Parent epic: [#386](https://github.com/journey-to-code-org/open.blog/issues/386)
- Story: #399 (task DIST6.1.3)

## Context

A public video cannot be taken back the way a page can be edited: once uploaded and published, copies exist. Story
#399 asks to "validate media source, consent and accessibility fallback" before anything reaches YouTube. YouTube
itself requires every creator to set whether a video is made for kids ("Regardless of your location, we require you
to tell us whether or not your videos are made for kids", [YouTube Help](https://support.google.com/youtube/answer/9528076))
and lets a channel disclose realistic altered or synthetic content (`status.containsSyntheticMedia`,
[videos resource](https://developers.google.com/youtube/v3/docs/videos)). A video without captions or a transcript
cannot be followed without sound. A master file left in the static folder is published with the site.

## Decision

- **Core checks, the caller looks.** `video_release::release_problems` and the preview (ADR 0376) never touch the file
  system. They ask a caller-supplied probe about an `AssetRef` (project-relative, or static-relative for a
  site-relative thumbnail) and receive `AssetFacts`: missing, or a regular file's size and first bytes
  (`HEAD_BYTES`, 1 MiB). A path is asked about only after `project_path` accepted it: no root, drive, scheme,
  backslash, `.`, `..` or empty segment. The CLI's probe walks from the project root and treats any symlink on the
  way, or anything but a regular file, as missing, so nothing is read outside the project.
- **The media source** (blocking codes): `source-missing` (neither `videoFile` nor `videoUrl`),
  `source-url-unsupported` (a `videoUrl` that is not YouTube), `source-path-invalid`, `source-format-unsupported`
  (only formats YouTube lists whose signature open.blog recognises: mp4, m4v, mov, 3gp, webm, avi, wmv, flv, mpg,
  mpeg; [formats](https://support.google.com/youtube/troubleshooter/2888402)), `source-public` (inside the static or
  output folder, so it would be public before its release), `source-not-found`, `source-too-large` (over 256 GB,
  [videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert)) and `source-not-video` (the first
  bytes are not that container's signature, such as `ftyp`, EBML, `RIFF…AVI `). A video already on YouTube needs no
  file.
- **Consent** (blocking): `consent-{rights,people,audience,synthetic}-missing` or `-invalid` for `videoRights`,
  `videoPeople`, `madeForKids` and `syntheticMedia`. No answer is ever defaulted; the preview shows "Not declared"
  and the steps say to give the declared answer.
- **The accessibility fallback** (blocking): `accessibility-no-text-alternative` when there are neither captions nor
  a transcript. Each caption is checked: `caption-path-invalid`, `caption-format-unsupported` (WebVTT or SubRip),
  `caption-language-missing`, `caption-language-duplicate` (one track per language), `caption-not-found`,
  `caption-too-large` (over 100 MB, [captions.insert](https://developers.google.com/youtube/v3/docs/captions/insert))
  and `caption-unreadable` (not UTF-8, or not opening with `WEBVTT` or a SubRip cue number and timing line). The
  canonical page's existing fallback link to YouTube and the transcript in the post are unchanged.
- **The thumbnail**: blocking `thumbnail-path-invalid`, `thumbnail-format-unsupported` (JPEG or PNG only,
  [thumbnails.set](https://developers.google.com/youtube/v3/docs/thumbnails/set)), `thumbnail-not-found`,
  `thumbnail-too-large` (over 50 MB), `thumbnail-unreadable` and `thumbnail-too-narrow` (under 640 pixels,
  [custom thumbnails](https://support.google.com/youtube/answer/72431)); notes `thumbnail-missing` (YouTube offers
  frames), `thumbnail-remote` (an `https` address open.blog cannot check or copy) and `thumbnail-not-widescreen`
  (not 16:9 within one percent). The size is read from the PNG header or the JPEG frame header.
- **Messages are fixed text.** They name the field and the rule, never a path, a file's content or the author's
  words, so a preview or log cannot leak an unreleased file name beyond the author's own preview folder.

## Considered options

- **Warn instead of block on consent.** Rejected: YouTube requires the audience answer, and rights and consent are
  exactly the facts open.blog cannot know and must not assume for a one-way publication.
- **Default `madeForKids` to no.** Rejected for the same reason; a wrong answer has legal consequences for the
  creator (COPPA).
- **Probe the video's codec and duration.** Rejected: it needs a media library and reads the whole file; the
  container signature catches the common mistake (the wrong file) without a dependency.
- **Require captions, not only a transcript.** Rejected for now: YouTube synchronises a transcript without timing
  into captions, and the transcript is already part of the post; the preview tells the author to review it.

## Consequences

- A release reaches the guided workflow (and later the upload adapter, story #400) only with a private, real video
  file or an existing YouTube video, every answer given, and a text alternative.
- Existing video posts keep building exactly as before; only `openblog video` reports these problems.
