# Submit a podcast feed

open.blog produces an opt-in feed; it does not submit your show or manage
directory accounts. Configure the feed as described in
[Configuration](configuration.md#podcast-feed), publish at least one audio
episode, and deploy the site before submitting its public HTTPS
`podcast.xml` URL.

Before submission:

- Check the feed and its episode, artwork, and transcript URLs from outside
  your network. The hosting server must support HTTP HEAD and byte-range
  requests for the artwork and audio.
- Choose artwork and an audio format accepted by your chosen directories.
  open.blog validates the episode file's signature, not its complete
  decodability, and does not check artwork dimensions or availability.
- Keep episode URLs stable: the feed uses the episode page URL as its GUID.
- Verify the exact category spelling with the directory. A successful build
  does not guarantee directory approval.
- If an ownership check requires an email address in the feed, set
  `podcast.email` to an address you are comfortable publishing.

## Apple Podcasts

In [Apple Podcasts Connect](https://podcastsconnect.apple.com/), choose Add,
New Show, then Add a show with an RSS feed. Enter the feed URL, review the
show details, rights, contact information and availability, and publish the
show for validation and review. See Apple's
[submission instructions](https://podcasters.apple.com/support/897-submit-a-show)
and [feed requirements](https://podcasters.apple.com/support/823-podcast-requirements).
Apple accepts MP3 and M4A audio for RSS episodes; other audio types supported
by open.blog are not necessarily accepted by Apple.

## Spotify

Sign in to [Spotify for Creators](https://creators.spotify.com/pod/login),
choose Add a new show and Find an existing show, and provide the feed URL.
Spotify's [account guide](https://support.spotify.com/us/creators/article/adding-a-new-show-to-your-spotify-for-creators-account/)
describes the submission path. Its
[ownership guide](https://support.spotify.com/us/creators/article/claiming-your-podcast-on-spotify-for-creators/)
explains that a verification code is sent to the email address in the feed.
Check Spotify's current instructions and eligibility requirements before
submitting.

## Podcast Index

Use the [Podcast Index add page](https://podcastindex.org/add) to submit the
public feed URL. Check its current instructions before submitting.

Apple and Spotify documentation was checked on 2026-11-12. Submission and
approval remain outside open.blog, and directory requirements can change.
