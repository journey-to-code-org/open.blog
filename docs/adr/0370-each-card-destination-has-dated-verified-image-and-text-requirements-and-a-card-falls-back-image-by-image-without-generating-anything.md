# ADR 0370: Each card destination has dated, verified image and text requirements, and a card falls back image by image without generating anything

- Status: Accepted
- Date: 2026-10-29
- Parent epic: [#383](https://github.com/journey-to-code-org/open.blog/issues/383)
- Story: #393 (task DIST3.1.3)

## Context

Destinations differ in the image shape, size, file size and file types they take, and in the length of the words
beside the image. A card that ignores them is cut off, shown small or refused. The epic requires that provider
requirements are verified before shipping, that platform constraints are honoured, and that nothing depends on
generative AI. The provider manifests (ADR 0325) describe capabilities, not image facts, and not every image
destination here is a manifest provider (a link preview is the page's own metadata, read by Facebook or LinkedIn).

## Decision

- **A closed list of card formats, each with a dated spec.** `CardFormat::spec` holds, as of `CARD_POLICY_VERSION`
  `2026-10-29`, only what each provider's own documentation states, with the sources listed in code and in
  [Visual cards](../visual-cards.md); `None` means none was stated and nothing is checked:
  - `pinterest-pin`: the Pinterest API v5 `PinCreate` schema
    ([reference](https://developers.pinterest.com/docs/api/v5/pins-create/),
    [OpenAPI 5.28.0](https://github.com/pinterest/api-description/blob/main/v5/openapi.json)): `title` 100,
    `description` 800, `alt_text` 500, `link` 2048 characters; a base64 image's `content_type` is `image/jpeg` or
    `image/png`. Pinterest's [product specs](https://help.pinterest.com/en/business/article/pinterest-product-specs):
    2:3, 1000 × 1500 recommended, PNG or JPEG, up to 20 MB, about the first 40 title characters in feeds.
  - `facebook-link`: Meta's [image guidance](https://developers.facebook.com/docs/sharing/webmasters/images/): at
    least 200 × 200, 600 × 315 for a large image, 1200 × 630 recommended, about 1.91:1, up to 8 MB.
  - `linkedin-link`: LinkedIn Help [a521928](https://www.linkedin.com/help/linkedin/answer/a521928): at least
    1200 × 627, 1.91:1, up to 5 MB.
  File sizes are read as decimal megabytes, the stricter reading.
- **Facts come from the file's header, never from a download.** `image_facts::read` reads JPEG, PNG, GIF and WebP
  headers without decoding pixels or adding a dependency: the format, the displayed size (a JPEG whose Exif
  orientation turns it a quarter has its sides swapped), the file size and whether a GPS record is present, in Exif data or in an XMP packet (`GPSLatitude` or
  `GPSLongitude`, in a JPEG APP1 segment, a PNG `iTXt` chunk, a WebP `XMP ` chunk or anywhere in a GIF). Metadata
  may follow the image data (WebP always puts EXIF and XMP after it, and PNG may), so the CLI reads the whole of a
  regular file inside the static folder, up to 64 MiB (`INSPECT_BYTES`, above every destination's limit), never
  through a symbolic link and never a private file. When part of the file where metadata may sit was not read (a
  file cut short or over that size, a metadata chunk running past the data, or a WebP whose VP8X header promises an
  EXIF or XMP chunk the walk did not reach), the facts say `metadataUnread` rather than "no location". An image on another site is never fetched; its card is `check` (`image-unmeasured`).
- **Checks and their weight.** Blocking: a file type the destination does not take (`image-type-unsupported`), a
  file over its size (`image-too-large`), below its stated minimum (`image-too-small`), a file the site does not
  serve (`image-not-found`) or that cannot be read (`image-unreadable`), text over a limit (`title-too-long`,
  `description-too-long`, `alt-too-long`, `link-too-long`) and a canonical address that is not public `https`
  (`link-not-public`). Notices: shown small (`image-shown-small`), narrower than recommended
  (`below-recommended-size`, by width, since the shape is its own notice), a shape more than 3% from the
  destination's (`shape-differs`) and a title feeds shorten (`title-shortened-in-feeds`). Text is never truncated or
  rewritten to fit.
- **A photograph's location stays private on a private travel post.** An image with a GPS record is `check`
  (`image-location-metadata`); on a `field-journal` post whose `locationPrivacy` is not `exact` it is blocking, so a
  photograph cannot undo the route privacy the author chose. An image whose metadata could not all be read
  (`image-metadata-unread`) is held to the same rule, since an unread location is not an absent one.
- **Fallbacks, image by image.** A candidate (ADR 0368) with any blocking problem is passed over and recorded with
  its reasons, and the next is tried. A Pin with no usable image is blocked (`image-missing` or
  `no-eligible-image`); a link preview with no declared image is a text-only preview (`no-preview-image`, a notice),
  and one whose declared image would not show is blocked (`page-image-unusable`), naming the cover or `ogImage` as
  the fix. Nothing is cropped, resized, re-encoded or generated: the author's own file is what a destination gets,
  and the preview only draws the crop the destination will make.
- **Re-verification.** Changing a spec means re-reading its sources and raising `CARD_POLICY_VERSION`; each card
  records the policy version it was checked under.

## Considered options

- **Add image limits to the provider manifest.** Rejected for now: a link preview is not a manifest provider, and
  Pinterest gets a manifest with its adapter in story #394, which can reference these specs.
- **Resize or crop to fit.** Rejected: it needs an image codec dependency and would send something other than the
  author's file; the author is told what to change instead.
- **Fetch remote images to measure them.** Rejected: a dry run never makes a request, and fetching an arbitrary
  address from the author's machine is a needless risk.

## Consequences

- A card fits its destination for every fact the provider states, and says plainly what it could not verify.
- No build, feed, export or cross-posting output changes.
