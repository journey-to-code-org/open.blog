# ADR 0846: The YouTube id is recorded privately, and an upload whose reply was lost is unknown until a lookup or a person settles it

- Status: Accepted
- Date: 2026-10-29
- Parent epic: [#386](https://github.com/journey-to-code-org/open.blog/issues/386)
- Story: #400 (task DIST6.2.3)

## Context

The social worker settles an outcome it cannot know by looking it up and then asking a person (ADR 0318), and
reports a post absent only when the provider holds nothing of the account in the attempt's window (story #358). A
YouTube upload has the same hazard at its last chunk: the video may exist although no reply named it. Uploading it
again would publish the release twice under the author's name.

## Decision

- **One private record per release** in `.openblog/private/youtube/releases`, protected like the credential
  (ADR 0844) because it holds the resumable session address. It keeps the state, the approved preview digest and file
  fingerprint, the publication time, the session and how many bytes arrived, whether the last chunk was sent, when
  the attempt started and last sent bytes, the video id and watch address once known, the thumbnail's state, the last
  failure code, and a history of at most 50 dated events with their codes. It never holds a token, the file's
  content or the author's words. `openblog video <slug> --status` prints it without the session address (`--json`
  for JSON) and sends nothing.
- **Five states.** `not-uploaded`, `uploading` (a session is open; `--upload` resumes it), `uploaded` (the id is
  recorded), `failed` (YouTube refused before creating anything) and `unknown`.
- **Unknown, precisely.** A release becomes `unknown` only when its last chunk was sent and then the session answers
  `404` or `410`, answers with success but names no readable video id, or refuses a status query (such as a `403`);
  or when the release, its approval or its file changed (`release-changed`) while an upload whose last chunk was sent
  is still open. While unknown, `--upload` refuses (`upload-unknown`) and sends nothing.
- **Whether the last chunk was sent is cleared only by evidence.** A `308` naming fewer bytes than the file, or a
  refusal that answers the chunk itself, clears it. A rate limit, a spent quota or a refused token on a status query
  keeps it with the session, so the next run asks the session again before sending anything.
- **Looked up, then settled by a person.** `--lookup` lists the channel's uploads playlist (one page of 50, with
  `youtube.readonly`) and reads only uploads added since five minutes before the attempt began:
  - exactly one carrying exactly the release's title and description is recorded as `uploaded` (`lookup-found`);
  - no upload at all in the window, with the whole window read, is `not-uploaded`, but only once fifteen minutes have
    passed since the last byte was sent, because a fresh upload may not be listed yet (`lookup-too-early`);
  - anything else, including an upload whose title the author edited in YouTube Studio, is `needs-person`, with the
    candidate ids. An unmatched upload is never read as absence.

  `--settle uploaded:<id>` or `--settle not-uploaded` records the person's decision, and only for an unknown release.
- **Retries.** A request that is safe to repeat (refreshing the token, opening a session, asking a session, setting
  a thumbnail, listing uploads) is retried up to five times with back-off on no reply or a `5xx`. A chunk is never
  repeated blindly (ADR 0845).
- **The id is shown, not written into the post.** After an upload open.blog prints the watch address and suggests
  `videoUrl:` for the post. It does not edit the author's Markdown.

## Considered options

- **Treat a lost final reply as a failure and let the author retry.** Rejected: that is how a video is published
  twice.
- **Match by title alone, or conclude absence when nothing matches.** Rejected for the reason story #358 found: the
  author may edit the metadata in YouTube Studio before open.blog looks.
- **Write the id into the post's front matter.** Rejected: it changes the author's source without their edit and
  would change the built site; the record and the printed address are enough.

## Consequences

- The record is local: on another computer `--status` shows nothing, and YouTube Studio is the reference.
- Every failure the author sees has a fixed code and says whether anything was sent and what to run next.
