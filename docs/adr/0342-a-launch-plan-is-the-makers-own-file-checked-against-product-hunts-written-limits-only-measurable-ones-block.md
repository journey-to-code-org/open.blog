# ADR 0342: A launch plan is the maker's own file, checked against Product Hunt's written limits, and only measurable ones block

- Status: Accepted
- Date: 2026-10-29
- Parent epic: [#384](https://github.com/journey-to-code-org/open.blog/issues/384)
- Story: #396 (task DIST4.2.1)

## Context

Task DIST4.2.1 asks to "model product tagline, screenshots, short pitch, demo and launch metadata". A launch is about
a product, not a post, so the post's front matter does not hold it; and the Markdown and the canonical site must stay
the source of truth and unchanged. Product Hunt's written limits are in ADR 0341. Two of its pages disagree on the
description (500 characters in the launch guide, 260 in the help article).

## Decision

- **The launch plan** is `launches/<slug>.json` (folder `community.productHunt.launchDir`, project-relative, default
  `launches`), written by the maker. It is outside `content/`, so no build, feed or export reads it. Fields, all
  optional to parse: `launchVersion` (1), `name`, `tagline`, `description` (the short pitch), `productUrl` (defaults
  to the post's canonical address), `thumbnail` and `gallery` (each `{ "file", "alt" }`, project-relative paths),
  `demo` (a YouTube address), `tags`, `makers` (Product Hunt usernames), `firstComment` and `launchDay`
  (`YYYY-MM-DD`, Pacific time). An unknown field, a wrong type, another `launchVersion` or a file over 64 KB refuses
  the plan whole.
- **Opt-in.** `community.productHunt.enabled` is off by default; the `community` object is still omitted from the
  written configuration while it has its defaults.
- **What blocks** (the kit then has no link to Product Hunt's form): a missing name, tagline or description; a
  tagline over 60 or a description over 500 characters; invisible or control characters; a product address that is
  not plain `https`, is a known shortener or carries a tracking parameter (`utm_*`, `fbclid`, `gclid`, `mc_cid`,
  `mc_eid`, `ref`); no thumbnail; fewer than 2 gallery images (or more than 12, open.blog's bound); an image path
  outside the project, missing, not PNG, JPEG or GIF *by its bytes*, or of 3 MB or more; a demo that is not a full
  YouTube watch address (`youtu.be` included); more than 3 launch tags; an invalid maker name; a launch day that is
  not a date, has passed in Pacific time, or is more than 31 days ahead; and a launch the maker already confirmed,
  unless `--again` (ADR 0344).
- **What is advice**, because Product Hunt leaves it to judgement or its pages disagree: a description over 260
  characters, a tagline ending in a full stop or equal to the post's title, a non-square thumbnail, gallery images
  not of the 1270 by 760 shape, an image without `alt`, no tags, no launch day, no first comment, a first comment
  that mentions votes, and a first comment that does not link the post.
- **The canonical post stays the original.** The kit always carries the post's canonical address next to the
  product's, and advises linking it from the first comment; it never rewrites the product address to a tracked or
  shortened one.
- **Pure core.** `openblog_core::launch_kit::prepare` reads nothing: the CLI probes each image (size and first bytes,
  refusing a path that resolves outside the project) and hands the facts in. Image format and pixel size are read
  from the PNG, GIF or JPEG header by a small reader, without a new dependency.

## Considered options

- **Front matter on the post.** Rejected: the launch describes a product, it would put unpublished launch copy in the
  post's source that renderers and exports must then learn to skip, and one post may announce several products.
- **Entries in `openblog.json`.** Rejected: launch copy is content, changes per launch and does not belong in site
  configuration.
- **Block on every recommendation.** Rejected for the reason in ADR 0338: a tool that blocks on judgement teaches
  people to work around it.

## Consequences

- A launch plan is a small, portable JSON file next to the site's content that a maker can keep in git or not.
- If Product Hunt changes a limit, the kit is wrong until a release updates it; the fields stay copyable either way,
  and the kit says which limit it checked.
