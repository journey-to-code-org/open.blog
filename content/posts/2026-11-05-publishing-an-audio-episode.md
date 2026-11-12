---
title: Publishing an audio episode
subtitle: A post with a recording, a transcript and chapters, and an optional podcast feed.
date: 2026-11-05
series: running-your-blog
seriesOrder: 6
tags:
  - guide
  - audio
  - podcast
description: Turn a post into an audio episode with a native player, chapters and a required transcript, and publish an opt-in podcast feed that directories can read.
audio:
  version: 1
  durationSeconds: 6
  episodeNumber: 1
  seasonNumber: 1
  sources:
    - url: /audio/demo-chime.mp3
      type: audio/mpeg
      sizeBytes: 45392
  chapters:
    - timeSeconds: 0
      title: First note
    - timeSeconds: 1
      title: Second note
    - timeSeconds: 2
      title: Last note
---

Any post can be an audio episode. The recording plays in the browser's own player above this
text, with no third-party embed, no autoplay and nothing that follows your listeners around. To
keep this example small, its "episode" is a six-second, three-note chime; yours would be your
own recording.

## What makes a post an episode

An `audio` block in the post's front matter. This one is:

```yaml
audio:
  version: 1
  durationSeconds: 6
  episodeNumber: 1
  seasonNumber: 1
  sources:
    - url: /audio/demo-chime.mp3
      type: audio/mpeg
      sizeBytes: 45392
  chapters:
    - timeSeconds: 0
      title: First note
    - timeSeconds: 1
      title: Second note
    - timeSeconds: 2
      title: Last note
```

The file lives in the site's `static/audio/` folder, so it is published with the site. It can
also live on HTTPS storage you control. Before publishing, open.blog checks that the file is
really audio of the type you said, and that its size matches; a published episode whose audio
cannot be checked does not build.

**Chapters** become buttons under the player that jump to that moment without starting playback.
A link with `?t=60` on the end opens the episode ready to play from one minute in.

## A transcript is required

Every published episode needs a transcript, so people who cannot listen, or would rather read,
get the whole episode, and so search engines can find it. Write it as a `## Transcript` section
at the end of the post, like the one below, or point `audio.transcript` at a `.txt` or `.vtt`
file. A draft without one only warns; publishing refuses it.

## Doing it in the editor

In Admin, open a post and expand **Audio episode**. Choose a file of up to 64 MiB, or pick a
voice note you saved earlier, and select **Copy audio to the site**. Enter the duration and any
chapter lines (`seconds | title | optional link`), then type the transcript or ask for one to be
transcribed: Admin says where the recording will be sent and waits for you to confirm. Review
the text before you publish it.

## A podcast feed, if you want one

Add a `podcast` block to `openblog.json` and every build also writes `/podcast.xml`, with each
published episode in it. This example site has one: [/podcast.xml](/podcast.xml). Submitting it
to Apple Podcasts, Spotify or Podcast Index is a step you take yourself, once the site is live;
[Submit a podcast feed](https://github.com/journey-to-code-org/open.blog/blob/main/docs/podcast-directories.md)
walks through each, and [Audio episodes](https://github.com/journey-to-code-org/open.blog/blob/main/docs/audio.md)
has the limits and hosting details.

## Transcript

[A soft chime plays three rising notes, each held for about a second, the last one longer. Then
silence.]
