# ADR 0780: A visual card uses one of the author's own published images, tried in a fixed order, with its recorded credit

- Status: Accepted
- Date: 2026-10-29
- Parent epic: [#383](https://github.com/journey-to-code-org/open.blog/issues/383)
- Story: #393 (task DIST3.1.1)

## Context

Epic #383 asks for destination-ready visual cards (a Pinterest Pin first, story #394) built from imagery the author
already has, with source attribution, and with no mandatory AI generation. A post already publishes images: its
cover (`cover`, with the aliases `image`, `coverImage`, `hero`, and `coverAlt`), the photographs in its body, and
the link preview image its page declares (`og:image`: the cover, else a video post's `thumbnail`, else the
site's `ogImage`). Recipe and field-journal (travel) posts are where the body's photographs matter most. Nothing records
who made an image.

## Decision

- **Candidates, in a fixed order, each once.** `openblog_core::visual_card::image_candidates` offers the explicit
  `cardImage` (with `cardImageAlt`, `cardImageCredit`, `cardImageCreditUrl`), then the authored cover (with
  `coverAlt`, `coverCredit`, `coverCreditUrl`), then, for the `recipe` and `field-journal` profiles only, the images
  in the post's portable Markdown in order, at most eight. An article never offers a body image: an inline diagram
  is rarely a card. A second mention of one address is dropped. Later checks (ADR 0782) choose the first candidate
  a destination accepts, so the order is the author's control: set `cardImage` to override.
- **Only what leaves the site.** Body images come from the portable Markdown, the same text copies and feeds use, so
  an image in a private or held-back part of a post never becomes a card. The CLI builds a card only for a
  production-visible post.
- **Addresses resolve the way the site serves them.** A front matter image follows the build's own rule for
  `og:image` (a path is relative to the site's address); a body image resolves against the page, as a browser does.
  An address inside the site's own origin and base path becomes a decoded path in the static folder, refused if it
  names a folder or has an empty, `.` or `..` segment after decoding; dot segments are normalised first, so one that
  climbs out of the site is just another address and is never read as a file. An image on another site must be
  `https`. `data:` and scheme-relative addresses are refused, because a destination needs an image at an address.
- **Attribution is recorded, never invented.** A credit is one line of at most 200 characters and an optional
  `https` link; the card shows "Image: <credit>" and carries the link. A body image has no credit field, so its
  credit is empty; every card still links back to the canonical post, which is the source of the work. The link
  preview candidate (`page_image_candidate`) is exactly the build's `og:image` and carries the cover's credit only
  when it is the cover. The renderer and `openblog card` choose the post's own share image through one helper,
  `Post::page_image` (the cover, else the video thumbnail), so the two cannot drift.
- **Fixed problems.** Each refusal is a fixed code (`image-address-unusable`, `image-not-https`, `credit-too-long`,
  `credit-url-invalid`) with a sentence that never repeats the address, the credit or any other author text.

## Considered options

- **Pick the largest or best-looking image automatically.** Rejected: it needs every image's pixels and a taste
  judgement; a fixed order with an explicit override is deterministic and explainable.
- **Generate a card image.** Rejected by the epic: no mandatory generative dependency.
- **A nested `card:` block in front matter.** Rejected: the front matter parser nests only `job` (ADR 0285), and flat
  keys sit beside `cover` and `coverAlt`, which authors already know.

## Consequences

- No new key changes a build: the static site, feeds, exports and cross-posting read none of them.
- A recipe or travel post with a weak cover can still get a card from its own photographs.
