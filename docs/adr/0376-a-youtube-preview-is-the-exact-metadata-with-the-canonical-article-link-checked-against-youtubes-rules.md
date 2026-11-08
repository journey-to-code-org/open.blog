# ADR 0376: A YouTube preview is the exact metadata, with the canonical article link, checked against YouTube's rules

- Status: Accepted
- Date: 2026-10-29
- Parent epic: [#386](https://github.com/journey-to-code-org/open.blog/issues/386)
- Story: #399 (task DIST6.1.2)

## Context

The epic asks for destination-specific previews, eligibility checks and safe failures before anything is sent, and
the story for a "YouTube-ready preview including thumbnail and canonical article URL". Admin's release kit already
composes a description in the browser from unsaved fields, but it has no canonical address, thumbnail or files, and
cannot say what an upload would carry. The distribution plan (ADR 0328) previews cross-posting targets, whose content
is a portable copy of the article; a video is not.

## Decision

- **One core function, `video_release::youtube_preview`.** From a release (ADR 0374) and the post's canonical
  address it builds a `VideoPreview`: the title, the composed description, the tags, the thumbnail, chapters, caption
  tracks, transcript, the audience and synthetic-content answers, and `privacy: "private"`, the visibility an upload
  starts at, so nothing is public until the author publishes or schedules it in YouTube.
- **The description is composed, never rewritten.** Paragraphs in a fixed order: the authored opening, `Read the
  article: <canonical address>`, `Chapters` with each line as written, and `AI assistance: <note>`. These are the
  release kit's sections with the article link added, so a viewer can always reach the canonical post. Nothing is
  shortened or stripped to fit: a problem is reported instead.
- **YouTube's own rules, verified 2026-10-29** ([videos resource](https://developers.google.com/youtube/v3/docs/videos),
  [chapters](https://support.google.com/youtube/answer/9884579)), each a fixed code:
  `title-missing`, `title-too-long` (over 100 characters), `title-angle-brackets` and `description-angle-brackets`
  (`<` and `>` are not accepted), `description-too-long` (over 5,000 bytes), `tags-too-long` (over 500 characters,
  counting commas and the quotation marks around a tag with a space), and the chapter rules the release kit already
  applies: `chapters-first-not-zero`, `chapters-too-few` (under three), `chapters-out-of-order`, `chapters-too-short`
  (under ten seconds, the last against the duration) and `chapters-duration-missing`. No chapters at all is fine.
- **Status from the manifest.** The request asks for `video`, `text`, `link` and, with a thumbnail, `image`. The
  YouTube manifest (ADR 0375) reports each as `capability-manual`, listed apart from the problems. The status is
  `blocked` with any problem, otherwise `manual` (the guided workflow), and `ready` only once an adapter does every
  capability. An article that is not live yet (a draft, scheduled for later, or not at a public `https` address) is
  a note, `article-not-public`, not a problem: a release is often prepared before the article goes out.
- **Guided steps.** The preview lists the YouTube Studio steps for this release in order: upload the file or open the
  existing video, paste the title and description, upload the thumbnail and each caption file (or the transcript
  without timing when there are no captions), set the audience and altered-content answers, and keep the video
  private until the article is live.
- **A digest binds what YouTube receives.** BLAKE2b (128 bits) over length-prefixed fields: the canonical address,
  the video reference, title, description, tags, privacy, the two answers, the thumbnail, the caption paths and the
  transcript, so story #400 can require an approval of exactly this preview.
- **`openblog video <slug>`.** Prints a summary; `--json` prints the preview; `--preview <new folder>` writes
  `title.txt`, `description.txt`, `tags.txt`, `transcript.txt` when there is one, a copy of a site-relative JPEG or
  PNG thumbnail named `thumbnail.<ext>` (never the author's file name), `preview.json` and a static `index.html`.
  The folder must be new and its path free of `..` and symlinks, as for `openblog syndicate --preview`. Drafts and
  scheduled posts can be previewed. Nothing is uploaded and no credential is read.
- **The page is static and accessible.** No script, form or external resource; `lang`, one `h1`, a "Preview, not
  sent" notice in words, the canonical address as a link, sections labelled by their headings, the status in words,
  every problem with its code, the copy in focusable, labelled, wrapping `pre` blocks (escaped text), the thumbnail
  as an image with alternative text, the chapters as a captioned table with row headers, and the steps as an ordered
  list. It reuses the distribution preview's colour tokens and dark scheme.

## Considered options

- **Add YouTube to the distribution plan.** Rejected: a plan's destinations are configured cross-posting targets whose
  content is a portable copy, and its approval file is bound to that; a video release has different fields.
- **Fold the preview into Admin's release kit.** Deferred: the kit edits unsaved text and has no files or canonical
  address. The CLI page is what an author, or a reviewer, can open.
- **Trim an over-long description automatically.** Rejected: the author's words are not rewritten; the preview says
  how far over it is.

## Consequences

- An author can prepare and check a release before the article is live, and copy exactly what the preview shows.
- Nothing in a build, feed or export reads a preview.
