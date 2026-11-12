# Audio episodes

An audio episode is a post with audio sources and a transcript. Your files stay
on your site or author-owned HTTPS storage; open.blog adds no third-party player.
See [Writing content](content.md#audio-episodes) for a complete front-matter
example and supported formats.

1. In Admin, open a post and expand **Audio episode**. Choose a file of at most
   64 MiB or find a previously saved voice note. Select **Copy audio to the
   site**: this explicitly copies it to public static files, even for a draft.
   Alternatively, place an audio file in `static/` or use author-owned HTTPS
   storage and write the metadata yourself.
2. Enter the duration in whole seconds. Add optional chapter lines in the form
   `seconds | title | optional link`; times must increase and stay before the
   end of the episode. Apply the details.
3. Type a transcript or use the optional transcription control. Before sending
   a recording it describes the destination and waits for confirmation.
   Review the result, add it to the draft, and edit it in the writing editor.
   Alternatively, supply a UTF-8 `.txt` or `.vtt` file in public static files.
4. Save the draft, then publish when ready. Build, check and Publish refuse a
   published episode whose audio or transcript cannot be verified; drafts
   produce warnings. The native player has no autoplay, and chapter buttons
   seek without starting playback. A `?t=60` link seeks when a listener plays.

The Admin file limit is 64 MiB; transcription accepts up to 8 MiB. The shared
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
[media](adr/0408-audio-episodes-use-verified-author-owned-sources.md),
[transcript](adr/0409-a-transcript-is-required-to-publish-an-audio-episode.md), and
[feed](adr/0410-a-podcast-feed-is-an-opt-in-projection-of-public-episodes.md)
decisions for the contract and its limits.
