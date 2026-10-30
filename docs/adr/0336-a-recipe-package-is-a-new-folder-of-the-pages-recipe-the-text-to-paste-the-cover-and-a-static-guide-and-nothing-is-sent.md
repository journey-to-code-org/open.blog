# ADR 0336: A recipe package is a new folder of the page's recipe, the text to paste, the cover and a static guide, and nothing is sent

- Status: Accepted
- Date: 2026-10-29
- Parent epic: [#385](https://github.com/journey-to-code-org/open.blog/issues/385)
- Story: #398 (tasks DIST5.2.2 and DIST5.2.3)

## Context

With every submission made by hand (ADR 0335), what helps the author is a guided export: the images, ingredients,
description and canonical address ready to paste or upload, and the steps for each chosen directory. It must not
invent or alter a fact, must keep the canonical post and its author credited, and must say clearly when something
cannot be done.

## Decision

- **`openblog export <slug> --format recipe-package [--directory a,b] [--out <new folder>] [--write | --json]`.**
  Like the other portable exports: published posts only, a dry run by default, `--json` for a versioned plan,
  `--write` needs `--out`. `--directory` is accepted only with this format. An unknown or unavailable directory, a
  post that is not a recipe, a recipe check error or a blocked directory refuses the write and leaves nothing
  behind. The folder must not exist; nothing is ever overwritten.
- **No directory chosen is a state, not an error** (as ADR 0330): the package holds the recipe files and a guide
  saying the recipe stays on the author's site, with `noDirectory: true` in the plan.
- **The files**, all built from the published post:
  - `recipe.json`: exactly the schema.org `Recipe` the page carries, with its context (ADR 0333).
  - `title.txt`, `description.txt`, `ingredients.txt` (one line each, as written), `steps.txt` (numbered),
    `link.txt` (the canonical address).
  - `credit.txt`: "<title>" by <site author>, first published at <canonical address>, and "Adapted from <address>"
    when `adaptedFrom` is a web address; without a site author the name is left out, not guessed.
  - `image.<ext>`: the cover, byte for byte, only when it is a `jpg`, `jpeg`, `png`, `gif`, `webp` or `avif` file
    of at most 20 MB inside the site's static folder, reached by plain path segments, not a symlink, and not in
    private project state (`.openblog`, comparison files). Anything else is linked by its address and never read or
    fetched; its size is read from the header for the checks, never decoded.
  - `package.json`: version `1`, `sent: false`, `offline: true`, `ready`, the recipe problems, each directory's
    plan (status, findings, capabilities, conditions, steps, sources, policy version) and each file's name, purpose
    and size.
  - `index.html`: a static guide with no script, form or external resource, using the distribution preview's
    tokens and dark scheme (ADR 0330): `lang`, one `h1`, a "Prepared, not sent" notice in words, each directory as
    a section labelled by its heading with its status, findings, conditions (each marked as read in its
    documentation or not verified) and numbered steps, and every text file in a focusable, labelled, wrapping
    `pre` of escaped text.
- **The publication boundary scan** (ADR 0125) runs over every text file, and the private-store sentinel test covers
  every file of a package and its guide.

## Considered options

- **Download a remote cover into the package.** Rejected: an export makes no network request.
- **Resize or crop the cover for a directory.** Rejected: it would alter the author's photo; the checks say what the
  directory recommends instead.
- **One combined text file.** Rejected: directories' forms have separate fields, and one file per field pastes
  without editing.

## Consequences

- An author can prepare for any chosen directory from the terminal, review the guide in a browser, and submit by
  hand, with the credit and canonical link alongside.
- Static builds, feeds, `recipe-json-ld` and the other exports are unchanged; the package exists only when asked for.
