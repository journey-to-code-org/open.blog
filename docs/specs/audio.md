# Audio episodes and podcasts

Status: implemented for epic #604.

## Contract

An `audio` mapping is version 1. `durationSeconds` is a positive integer;
`sources` is a nonempty ordered list of `url`, `type`, and `sizeBytes`.
Source URLs are site-relative public static paths or HTTPS URLs without
credentials or fragments. Size is 1 through 512 MiB and must match the file.
Optional `episodeNumber` and `seasonNumber` are positive integers. Chapters
have a nonempty title, an increasing nonnegative `timeSeconds` strictly below
duration, and an optional safe link. Unknown and malformed fields are refused.

The host supplies bounded evidence: static files must resolve inside the static
tree and outside private state; remote URLs use the public-only DNS resolver,
HTTPS, no proxy or redirects, a ten-second timeout, identity encoding and a
consistent byte range. File signatures are checked, not full decoding. A
remote resource may change after the check.

The transcript is a nonempty Markdown Transcript section or a readable UTF-8
site-relative `.txt` or `.vtt` file of at most 4 MiB; VTT requires a timed cue
with text. Build, check and Git/Admin Publish share the gate. Drafts warn;
published invalid episodes fail. A host without file evidence fails closed.
Neither transcription nor transcript quality is automated by the gate.

The player is native `<audio controls preload="none">`; no autoplay. Chapter
buttons are disabled until the component loads and seek without playing. The
optional `t` query applies once when playback starts, after metadata is ready.
The transcript remains readable without JavaScript.

The version 1 `podcast` configuration is absent by default. When set, the
generator writes `/podcast.xml` with public episodes, the first source as the
RSS enclosure, Apple metadata, and Podcasting 2.0 transcript and chapter
references. Drafts and scheduled episodes are excluded even in previews.
Chapter JSON is generated only for episodes with chapters. Image availability,
dimensions, directory category vocabulary, media decoding, and directory
approval are not asserted by the generator. See
[directory submission](../podcast-directories.md).

Admin explicitly copies a selected upload or private voice note to public
static files, up to 64 MiB, and uses the same publication gate. Optional
transcription uses the existing capture boundary and requires confirmation;
recordings submitted for transcription are limited to 8 MiB.
