# ADR 0369: A card's words are the post's own or the author's card fields, its alternative text is the author's, and its preview is deterministic

- Status: Accepted
- Date: 2026-10-29
- Parent epic: [#383](https://github.com/journey-to-code-org/open.blog/issues/383)
- Story: #393 (task DIST3.1.2)

## Context

A card needs a title, a description and alternative text for its image, and the author must see exactly what a
destination will show before anything is sent (story #394 sends Pins). The epic asks for accessible text without
mandatory AI generation, and the distribution preview (ADRs 0328 to 0330) already sets the pattern for dry-run
artifacts: a folder that must not exist, a JSON plan, and a static, script-free, accessible page.

## Decision

- **Words.** A Pin takes the card's own words: `cardTitle` and `cardDescription` when the author wrote them, else the
  post's title and description. A link preview (Facebook, LinkedIn) shows the page's own `og:title` and
  `og:description`, so its card always shows the post's words; a card field cannot change the site. Whitespace is
  collapsed to single spaces; nothing is shortened, reworded or generated. Each card records whether its words came
  from the card fields or the post.
- **Alternative text is the author's, never invented.** The card's alternative text is the chosen image's own:
  `cardImageAlt`, `coverAlt` (or its aliases), or a body image's Markdown description. A Pin without it passes over
  that image to the next candidate (`alt-missing`, blocking), so an undescribed image is never pinned; a link preview
  without it gets a notice, since the page's `og:image:alt` is what is missing.
- **One model, checked once.** `visual_card::plan` builds a `CardPlan` (version 1) of `VisualCard`s for the chosen
  formats, each with a status (`ready`, `check` when a fact could not be verified, `blocked`), every problem as a
  fixed code and sentence, the chosen image and every image passed over with why. Measuring an image is a callback,
  so the core reads no file and the CLI reads only the site's own static files.
- **A digest binds what the author sees.** A card's digest (BLAKE2b, 128 bits, length-prefixed fields) covers the
  format, title, description, alternative text, link, image address and credit; the plan digest covers the source,
  the canonical address and each card's format, digest and status. Story #394 binds a Pin approval to it.
- **Command and artifacts.** `openblog card <slug> [--format a,b] [--json] [--preview <new folder>]` runs only for a
  production-visible post and sends, uploads and fetches nothing. The text report lists each card; `--json` prints
  the plan; `--preview` writes `cards.json`, one `NN-<format>.svg` layout preview per card, a copy of each chosen
  image from the static folder (`NN-<format>-image.<ext>`; file names never come from the author's paths) and
  `index.html`. The folder must be new and inside the project, as for `syndicate --preview`.
- **The preview is deterministic and inert.** The SVG draws the image at the destination's recommended size,
  cropped to its shape from the centre, with the words beneath as the destination lays them out (a Pin: title, site,
  credit; a link preview: site, title, one line of description), wrapped greedily by characters and clamped with an
  ellipsis only in the drawing. It has `role="img"` and is named by a `title` and the alternative text in `desc`. An
  image on another site is never loaded; a placeholder says so. The page is static HTML with no script, no form and
  no external resource, reuses the distribution preview's tokens and dark scheme, and shows each card's status in
  words, its exact title, description, alternative text, link, image, facts and credit in a table with row headers,
  every problem with its code, and each image passed over. Every value is escaped.

## Considered options

- **Burn the title into the image.** Deferred: it needs a font rasteriser and an image encoder (new dependencies) and
  would put text in pixels that a screen reader cannot read. The words travel as the destination's own text fields.
- **Generate alternative text or descriptions.** Rejected by the epic, and an invented description is worse than an
  honest refusal.
- **Truncate a long title to fit.** Rejected: a destination limit is reported (ADR 0370) and the author shortens
  `cardTitle`; only the drawing clamps.

## Consequences

- An author can see, offline and before any provider exists, exactly what each destination would show.
- Nothing in a build, feed, export or the existing cross-posting reads a card or a card field.
