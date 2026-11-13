# Visual cards

A **visual card** is what an image-first destination shows of one of your published posts: one of your own images,
a title, a description, the image's alternative text, a link back to the post on your site and, if you recorded it,
who made the image. `openblog card` builds and checks a card for each destination, and shows you exactly what it
would look like. It never generates an image or text, never uploads or sends anything, never fetches anything from
another site and reads no credential. Your Markdown and your site stay the original.

Destinations today:

| Format | What it is | Words on the card |
| --- | --- | --- |
| `pinterest-pin` | A Pinterest Pin, which [`openblog pinterest`](pinterest.md) can send to your board | Your `cardTitle` and `cardDescription`, else the post's |
| `facebook-link` | What Facebook shows when someone shares your post's link | The page's own title and description |
| `linkedin-link` | What LinkedIn shows when someone shares your post's link | The page's own title and description |

## Try it

```sh
openblog card lemon-tart                        # a short report per destination
openblog card lemon-tart --format pinterest-pin # one destination
openblog card lemon-tart --json                 # the whole card plan
openblog card lemon-tart --preview cards        # a folder with an accessible page to open
```

The post must be published (a draft or a post scheduled for later gets no card). `--preview` needs a new folder
inside the project and writes `index.html`, `cards.json`, one `NN-<format>.svg` layout preview per card, and a copy
of each chosen image. Open `index.html` in any browser, offline.

## Which image is used

Images are tried in this order, and the first one the destination accepts is used:

1. `cardImage` (with `cardImageAlt`, and optionally `cardImageCredit` and `cardImageCreditUrl`): set this to choose
   the card's image yourself.
2. Your cover (`cover`, with `coverAlt`, and optionally `coverCredit` and `coverCreditUrl`), or a diagram in the
   post named with `coverDiagram` ([Diagrams](diagrams.md#a-diagram-as-the-posts-image)).
3. For a `recipe` or `field-journal` post only: the photographs in the post, in order (up to eight). Their
   alternative text is the description you wrote in Markdown, `![like this](/img/step-2.jpg)`.

A link preview (`facebook-link`, `linkedin-link`) always uses exactly the image your page already declares for link
previews: your cover, else a video post's `thumbnail`, else the site's `ogImage`. Change those to change it.

Every image passed over is listed with the reason, so you can see which fallback was taken.

```yaml
cover: /img/tart.jpg
coverAlt: A lemon tart on a blue plate, one slice cut
coverCredit: Ana Ruiz
coverCreditUrl: https://photos.example.net/ana-ruiz
cardTitle: Lemon tart with a crisp, never soggy crust
cardDescription: A sharp lemon curd in a shortcrust you can make the day before.
```

In Admin, a post's settings have **Words for a Pinterest Pin** under the cover photo: **Pin title** and **Pin
description** are saved as `cardTitle` and `cardDescription`. Leave them empty to use the post's title and summary.
**Photo by**, under **Describe the picture**, is saved as `coverCredit`. Admin does not yet set `cardImage`,
`cardImageAlt`, `cardImageCredit` or a credit link; write those in the post's front matter.

Images must be files your site serves from its static folder, or `https://` addresses on another site. open.blog
reads the size and format of your own files from their headers; it never downloads an image from another site, so
such a card says **Check** and asks you to confirm its size and format yourself.

## What is checked

Each card is **Ready**, **Check** (something could not be verified) or **Blocked**, and every problem is listed
with a fixed code.

| | Pinterest Pin | Facebook link preview | LinkedIn link preview |
| --- | --- | --- | --- |
| Shape | 2:3; taller may be cut off in feeds | about 1.91:1, cropped to it | about 1.91:1, cropped to it |
| Recommended size | 1000 × 1500 | 1200 × 630 | 1200 × 627 |
| Smallest | (none stated) | 200 × 200; below 600 × 315 shown small | 1200 × 627 |
| File size | up to 20 MB | up to 8 MB | up to 5 MB |
| File types | JPEG, PNG | (none stated) | (none stated) |
| Title | up to 100 characters; about 40 show in feeds | the page's title | the page's title |
| Description | up to 800 characters, counting the image credit a Pin adds after it | the page's description | the page's description |
| Alternative text | required by open.blog; up to 500 characters | recommended | recommended |
| Link | your canonical `https://` address, up to 2048 characters | the page | the page |

These were checked on 2026-10-29 against
[Pinterest's Create Pin API](https://developers.pinterest.com/docs/api/v5/pins-create/) (and its
[OpenAPI description](https://github.com/pinterest/api-description/blob/main/v5/openapi.json)),
[Pinterest's product specs](https://help.pinterest.com/en/business/article/pinterest-product-specs),
[Meta's image guidance for shared links](https://developers.facebook.com/docs/sharing/webmasters/images/) and
[LinkedIn's shareable website guidance](https://www.linkedin.com/help/linkedin/answer/a521928). "None stated" means
the provider states no limit, so open.blog checks none.

Two more checks protect you and your readers:

- **Alternative text is never invented.** A Pin will not use an image you have not described; it moves on to the next
  image, and if none is described the card is blocked until you add `cardImageAlt` or `coverAlt`.
- **Where a photograph was taken.** If an image file carries a GPS location, in its Exif data or in an XMP packet
  (as Lightroom-style editors write it), the card asks you to check it. On a `field-journal` post whose
  `locationPrivacy` is anything but `exact`, such an image is never used: remove the location from the file first.
  The whole file is read, since WebP (and sometimes PNG) stores this after the picture. If part of a file could not
  be read (it is cut short or over 64 MiB), the card says so (`image-metadata-unread`) and treats it the same way.

Nothing is shortened or rewritten for you: a title that is too long is reported, and you shorten `cardTitle`.

Not yet done: putting the title over the image. A card's words travel as the destination's own text, beside the
image; the preview draws them beneath it.

## Turning it off

There is nothing to turn on. The card fields are read only by `openblog card`; your built site, feeds, exports and
cross-posting are exactly the same whether or not you use them.

## For developers

- Rust: `openblog_core::visual_card` (`image_candidates`, `build_card`, `plan`, `card_svg`, `preview_page`,
  `CardFormat::spec`) and `openblog_core::image_facts::read`.
- Decisions: ADRs
  [0368](adr/0368-a-visual-card-uses-one-of-the-authors-own-published-images-tried-in-a-fixed-order-with-its-recorded-credit.md),
  [0369](adr/0369-a-cards-words-are-the-posts-own-or-the-authors-card-fields-its-alt-text-is-the-authors-and-its-preview-is-deterministic.md)
  and
  [0370](adr/0370-each-card-destination-has-dated-verified-image-and-text-requirements-and-a-card-falls-back-image-by-image-without-generating-anything.md).
