# ADR 0840: A video release is read from the video post's own front matter and body, and never inferred from an article

- Status: Accepted
- Date: 2026-10-29
- Parent epic: [#386](https://github.com/journey-to-code-org/open.blog/issues/386)
- Story: #399 (task DIST6.1.1)

## Context

Epic #386 asks open.blog to prepare and publish video as deliberate authored media, "never auto-convert articles to
generic slideshow spam", with the transcript, chapters, captions, thumbnail, descriptions, video address and
consent modelled. The video-production profile ([video production](../video-production.md)) already holds a YouTube
address (`videoUrl`), a duration, a thumbnail and an AI-assistance note, and the body already carries chapter lines
and a `## Transcript` section by convention; Admin's release kit composes a description from them in the browser.
None of that names the file to upload, a title or description written for YouTube, caption files, or the author's
own declarations that an upload needs.

## Decision

- **One model, `openblog_core::video_release::VideoRelease`, built only from a video post.** `from_post` returns
  `None` for any profile other than `video`; nothing is generated from an article's prose. It holds:
  - the **video reference**: `videoFile`, a project-relative master file to upload, and/or `videoUrl` with its
    YouTube id (both may be present: the file is then the master of the video already there);
  - the **title** (`videoTitle`, or the post title) and the **description** opening (`videoDescription`, or the post
    description), written by the author for the destination;
  - the **chapters**: the body's timestamp lines outside fenced code (`00:00 Title`, optionally a list item), the
    same lines Admin's release kit reads, with the timestamp, seconds and label as written;
  - the **transcript**: the Markdown under the body's `Transcript` heading up to the next heading of the same or a
    higher level, so it stays part of the post, its search and its feeds;
  - the **captions**: `captions`, a list of project-relative WebVTT (`.vtt`) or SubRip (`.srt`) files whose language
    is the name's last segment before the extension (`episode-1.pt-BR.vtt`);
  - the **thumbnail** (`thumbnail`, or the post `cover`), the duration, the AI-assistance note and the post tags;
  - the **consent**: `videoRights` (`owned` or `licensed`), `videoPeople` (`consented` or `none`), `madeForKids`
    and `syntheticMedia` (`yes` or `no`).
- **Declarations are closed and never guessed.** Each is `missing`, `invalid` (present but not one of its values)
  or a value. An unknown answer is kept to be reported, never read as yes or no.
- **Raw in the post, meaning in one place.** `VideoMetadata` gains `release`, the eight fields as authored; only
  `video_release` interprets them. They are offered in Admin's content-profile settings like the other video fields.
- **Nothing static reads it.** Pages, feeds, structured data and portable exports render exactly as before; a site
  that never sets these fields sees no change.

## Considered options

- **Sidecar files (a JSON or YAML release file per video).** Rejected: the Markdown is the source of truth and already
  carries the chapters and transcript; front matter keeps the release next to the words it describes.
- **Generate chapters or a description from the article.** Rejected by the epic: video is authored media.
- **Caption language as a separate field.** Rejected: a list of plain paths is all the flat front matter can hold,
  and a language in the file name travels with the file.

## Consequences

- A preview (ADR 0842) and validation (ADR 0843) read one model, and a later upload adapter reads the same one.
- A post that sets none of the release fields keeps every existing behaviour.
