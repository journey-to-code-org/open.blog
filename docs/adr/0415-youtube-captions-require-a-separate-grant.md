# ADR 0415: YouTube captions require a separate grant

- Status: Accepted
- Parent epic: #623
- Amends: [ADR 0378](0378-youtube-uploads-use-the-deployers-own-google-client-a-loopback-pkce-grant-and-a-refresh-token-protected-on-the-authors-machine.md)

## Context

YouTube's [captions.insert](https://developers.google.com/youtube/v3/docs/captions/insert) requires a broader
caption-management grant and costs 400 quota units per call (checked 2026-11-12). The existing video-upload grant
does not authorize it, and losing a response does not prove that YouTube rejected a caption.

## Decision

Keep the ordinary channel connection's permissions unchanged. An author may separately connect with
`youtube.force-ssl` and approve a release whose digest includes each caption file's complete contents and language.
After the video is uploaded, send the approved files and record each outcome independently. A definite refusal can
be retried; an ambiguous result or conflict needs manual review instead of an automatic retry. Without the extra
grant, captions remain a manual step in YouTube Studio.

The generic provider manifest has no caption capability. Its YouTube policy version changes to reflect this
conditional behavior, and the preview note code becomes `captions-conditional` rather than `captions-by-hand`.

## Consequences

The author controls the broader permission and can see caption failures without losing the uploaded video.
YouTube may still process the caption after accepting it, so the author must verify it in Studio. Previously
approved releases must be reviewed again under the new policy before an upload.
