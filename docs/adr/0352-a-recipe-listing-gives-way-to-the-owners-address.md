# ADR 0352: A recipe listing gives way to the owner's address

- Status: Accepted
- Date: 2026-11-07

## Context

A site with recipes needs somewhere to browse them: `/recipes/`, with a filter page per course and
cuisine (#557). Other generated collections take their address differently. `/services/` and
`/atlas/` are reserved once the site uses them, so a page already at that address stops the save and
the build with an error.

That is the wrong trade here. The owner this listing is for is not technical, and she may well have
written a page called Recipes before publishing a recipe. `generate_document` and `generate_home`
run the same reserved-address check as a full build, so reserving `/recipes/` would refuse the save
of her first recipe, with an error about a page she did nothing new to.

The home page layout also needs a latest-posts section that lists only recipes.

## Decision

- **The listing gives way, one exact address at a time.** The plan collects the files the owner's
  posts, pages and series write, aliases included. If `/recipes/` is taken the whole list moves to
  `/recipes/all/`; if that is taken too there is no whole list, and the filter pages stay. A taken
  filter address drops that filter and its link. `RESERVED` and `validate_output_paths` do not
  change, and every drop adds one plain sentence to the site's warnings. Admin shows those sentences
  unfolded on Overview and in Site preview, because they tell the owner what to change.
- **No `/recipes/course/` or `/recipes/cuisine/` page.** The links on each page do that job, so a
  post at `/recipes/course/` under `postPath: /recipes/{slug}/` shares the folder without a clash.
- **A later page is not checked.** An alias at `/recipes/page/2/` stops the build with the usual
  duplicate-file error. It is unlikely, and the message names the path.
- **Membership is `Site::is_published`,** so a draft or a scheduled post never opens a page, even in
  a load that holds it for a preview.
- **Filters are plain links.** No form, no custom element and no client-side list, because readers
  may have no JavaScript. The current filter has `aria-current` and a bold label: `page` on its first
  page, `true` on a later one, where the chip links elsewhere. Every group starts folded in a
  `<details>`, the reader's own too, with the current value in its summary. Even short groups left
  open put the first recipe past the first screen of a small phone, and a folded group costs a wide
  screen one tap.
- **Every list and filter is reachable by a link.** The navigation links to the list unless a link
  already goes to that address, written in full or not; a link to the owner's own page at `/recipes/`
  does not count. If a link is already labelled Recipes, the list's is labelled All recipes. A recipe
  card's course and cuisine link to their filter pages, which keeps the filters reachable when both
  list addresses are taken.
- **`show` is a closed field with no version bump.** `latest-posts` gains `show`, `all` or `recipes`,
  written only when it is `recipes`. An unknown value is refused when the page is read. Pages that do
  not use it keep their bytes and their version. A release from before the field keeps it as an
  unknown key and lists every post, which is a fair way for an older build to read it, so unlike the
  `business-facts` type it does not need a new version.
- **The value stays as written.** Admin stores the plain words she typed, the engine derives the
  address, and search-engine data keeps the text unchanged.

## Consequences

- A page she already has never stops working, and a published recipe adds no error.
- The list's address can move: changing her page's Slug moves it back to `/recipes/`, which can break
  links shared while it was at `/recipes/all/`. The warning says what to change. A new title does not
  move a page, so the warning does not say "rename".
- With her own navigation page at `/recipes/`, the header has two links, to her page and to the list.
  A reader needs the second to browse, and there is nowhere else on a default home page to put it.
- A file at `static/recipes/index.html` is overwritten by the generated page, because of the order in
  which a build writes. This is noted in the docs.
- Every site that publishes a recipe gains a Recipes navigation link and these pages on upgrade.
  `recipes.listing: false` is the way out; a section with `show: recipes` still lists recipes. Admin
  has no switch for it yet, but it reads the setting and stops promising browsing and asking for a
  course to that end.
- Admin's notes come from a load of the whole site, so they have their own route, asked for by
  Overview only and outside the content transaction. A save never waits for them, Overview draws
  without them and adds them if there are any, and a note can be briefly out of date.
- Admin has no field for a document's old addresses, so a note about an alias names the document and
  says to have someone change its file.
- `Dessert` and `Desserts` make two filters. Nothing merges them, and Admin's suggestions are the
  only help against it.
