# Audio episodes

An audio episode is a post with audio sources and a transcript. Your files stay
on your site or author-owned HTTPS storage; open.blog adds no third-party player.
See [Writing content](content.md#audio-episodes) for a complete front-matter
example and supported formats.

1. In Studio, open a post and choose **Put a recording with it** (in Write's
   **More**, or Find). Choose a file of at most 64 MiB, or a voice note already
   on the blog. Studio says that anyone with its address can listen once it is
   there, even while the post is a draft, and copies it to public static files
   (`static/audio/uploads/`) only when you press **Put it on your blog**.
   Alternatively, place an audio file in `static/` or use author-owned HTTPS
   storage and write the metadata yourself.
2. **How long it is** is read from the recording when the page can tell, as
   minutes and seconds; change it if needed. Under the details, **Parts of the
   recording** takes chapter lines like `1:05 Making the dough`, optionally
   followed by `| /a/page/`; times must increase and stay before the end.
3. Under **The words said**, type or paste the transcript, or use **Turn it into
   words** where the blog can transcribe (it says what is sent where and waits
   for you first). **Put them in my post** adds them at the end of the post
   under a `## Transcript` heading, where you edit them like any other words.
   Alternatively, supply a UTF-8 `.txt` or `.vtt` file in public static files.
   **Take the recording off this post** removes the `audio:` block when the post
   is saved; the file stays on the blog.
4. The recording saves with the post (the sheet has no Save of its own).
   Save the draft, then publish when ready. Build, check and Publish refuse a
   published episode whose audio or transcript cannot be verified; drafts
   produce warnings. The native player has no autoplay, and chapter buttons
   seek without starting playback. A `?t=60` link seeks when a listener plays.

Studio's file limit is 64 MiB; transcription accepts up to 8 MiB. The shared
media limit is 512 MiB per source. Checks identify file headers, not complete
decodability or transcript accuracy. HTTPS storage must answer a bounded range
request without a redirect, and must resolve only to public network addresses.
The host can change after verification; retain control of the files and test
the deployed URLs.

To publish a podcast feed, opt in using [podcast settings](configuration.md#podcast-feed).
Then follow the [directory submission guide](podcast-directories.md); passing a
local build does not guarantee directory approval. The page URL is used as the
episode GUID, so keep it stable.

See the [audio specification](specs/audio.md) and
[media](adr/0421-audio-episodes-use-verified-author-owned-sources.md),
[transcript](adr/0422-a-transcript-is-required-to-publish-an-audio-episode.md), and
[feed](adr/0423-a-podcast-feed-is-an-opt-in-projection-of-public-episodes.md)
decisions for the contract and its limits.
