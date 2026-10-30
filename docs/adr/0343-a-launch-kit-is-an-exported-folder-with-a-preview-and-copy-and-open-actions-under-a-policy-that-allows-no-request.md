# ADR 0343: A launch kit is an exported folder with a preview and copy and open actions, under a policy that allows no request

- Status: Accepted
- Date: 2026-10-29
- Parent epic: [#384](https://github.com/journey-to-code-org/open.blog/issues/384)
- Story: #396 (task DIST4.2.2)

## Context

Task DIST4.2.2 asks for an "exportable launch kit with preview and copy/open actions". The Hacker News and Reddit kit
page (ADR 0338) is script-free and deferred copy buttons to this story. Copying needs script; the kit must still work
without it, and a page opened from disk must not become a way to send anything anywhere.

## Decision

- **`openblog submit <slug> --to product-hunt`** prints the launch kit; with `--kit <new folder>` it writes
  `index.html`, `kit.json` and an `images/` folder holding a copy of each image the plan names that was found inside
  the project and is PNG, JPEG or GIF by its bytes, renamed `thumbnail.<ext>` and `gallery-NN.<ext>`. Nothing else
  from the project is copied. Product Hunt goes alone: mixing it with other destinations, or passing `--title`, is
  refused, because a launch's text comes from its plan.
- **Images are read only inside the project.** A path in the plan must be project-relative without `..`; the CLI
  resolves it (following links) and treats one whose real location is outside the project as `image-outside-project`,
  never reading it. The core never reads files (ADR 0342).
- **The page** keeps ADR 0330's shape (`lang`, one `h1`, a "Prepared, not launched" notice, labelled sections, visible
  focus, no sideways scroll at phone width, `referrer` `no-referrer`) and adds `robots` `noindex`. In order: the
  canonical post and product address, the status with blocking reasons before advice, a **preview** (an
  approximation, said so: thumbnail, name, tagline, tags, gallery, description, co-makers, each image with its
  `alt`), **text to copy** (each field in a labelled, read-only `textarea` with its character count tied by
  `aria-describedby`), **images to upload** (a link to open each one with its size and pixel dimensions), the rules
  checklist, and **open** actions (Product Hunt's new launch form only when nothing blocks, the demo video, the
  launch guide), then how to record the launch.
- **Copy actions are progressive.** Each field has a `Copy …` button rendered `hidden`; one inline script reveals the
  buttons and copies a field with the Clipboard API, falling back to selecting the text, and announces the result in
  a `role="status"` region. Without script the buttons stay hidden and each `textarea` can be selected and copied by
  hand.
- **The page's policy allows no request.** A `Content-Security-Policy` meta sets `default-src 'none'` (so no fetch,
  form, frame or font), images from the kit only (`'self' file:`), inline style, `base-uri` and `form-action`
  `'none'`, and `script-src` to the SHA-256 of that one constant script. Every value from the plan is escaped text;
  a test in the CLI holds the hash to the script.
- **`kit.json`** is the kit's data (`kitVersion` 1, every field, notice, rule and image, the policy version) with an
  `about` line saying nothing was submitted.

## Considered options

- **No script, like the submission kit.** Rejected: the story asks for copy actions; a hidden-until-script button
  keeps the page whole without it.
- **`script-src 'unsafe-inline'`.** Rejected: a hash allows only the script open.blog wrote, even if escaping ever
  failed.
- **Embed images as `data:` URIs.** Rejected: the maker needs the files to upload, and the page would grow by the
  images' size again.

## Consequences

- The folder is a portable, self-contained handoff a maker can open offline, archive or share with a co-maker.
- Changing the script means changing its hash; the CLI test fails until both move together.
