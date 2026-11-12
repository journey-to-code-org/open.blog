# ADR 0341: Product Hunt is a community destination whose launch the maker enters and submits by hand

- Status: Accepted
- Date: 2026-10-29
- Parent epic: [#384](https://github.com/journey-to-code-org/open.blog/issues/384)
- Story: #396 (task DIST4.2.1)

## Context

Story #396 asks for Product Hunt launch kits "while retaining ownership of the canonical post", with approval and
submission kept manual. Product Hunt is not a place to post a link like Hacker News: a *launch* is a product page with
a name, tagline, description, thumbnail, gallery, optional YouTube demo, launch tags, makers, a first comment and a
launch day. ADR 0337 made community destinations a closed family of the provider contract whose manifests say "the
author submits by hand".

What Product Hunt says, checked on 2026-10-29:

- The [launch guide](https://www.producthunt.com/launch): makers post their own product, company accounts are not
  allowed, "you cannot ask people directly to upvote your product", launches are free, and a product may launch again
  for each significant new iteration. Posting starts from the signed-in site ("Submit", then "New product").
- [Preparing for launch](https://www.producthunt.com/launch/preparing-for-launch): tagline at most 60 characters,
  description at most 500, no shortened or tracking links, up to 3 launch tags, a required square thumbnail (240 by
  240 recommended), at least 2 gallery images before the gallery shows (1270 by 760 recommended), every image under
  3 MB, a YouTube video only (full address, not private), up to 3 shoutouts, and scheduling up to one month ahead.
- The [help article on posting](https://help.producthunt.com/en/articles/479557-how-to-post-a-product) gives the
  description limit as 260 characters and says days run in Pacific time, launches going live at 12:01 a.m.
- The [API v2 documentation](https://api.producthunt.com/v2/docs): applications are read-only by default, write
  access is granted case by case (its example is marking goals), and the API "must not be used for commercial
  purposes". Nothing in it creates a launch.
- `https://www.producthunt.com/posts/new` redirects to Product Hunt's sign-in with `origin=/posts/new` (checked with
  one `HEAD` request), so it is the form a signed-in maker lands on. Whether it reads any prefilled field was not
  verified, so the kit never passes one.

## Decision

- **`product-hunt` joins the community family.** `ProviderId::ProductHunt`; label "Product Hunt". Its manifest says
  `link`, `text`, `image`, `video`, `draft` and `schedule` are **manual** (the maker types or uploads each in Product
  Hunt's form, and Product Hunt itself keeps the draft and the launch day) and `article` is unsupported; login `none`,
  publishing `manual`, canonical `linked`, no constraints. ADR 0337's rule already refuses a community manifest with
  an adapter capability, a login or non-manual publishing, so no new rule is needed; the shared fixture gains a
  refused "would upload images" case and a request case.
- **The hosted function knows the name only.** `social-capabilities.mjs` lists it as community so the fixture stays
  one list; the delivery worker still admits only the social family.
- **The kit's limits are not capabilities.** Tagline, description, image and tag limits belong to the launch kit
  (ADR 0342), not `constraints`, because open.blog sends none of them.

## Considered options

- **Use the API.** Rejected: it has no launch creation, write access is discretionary, and its terms forbid commercial
  use, which open.blog cannot judge for every author.
- **Keep Product Hunt outside the contract.** Rejected for the reason in ADR 0337: one list says what open.blog does
  at each provider.
- **Declare everything but the link unsupported, like HN.** Rejected: the manifest would then say the launch has no
  images, which is false; "manual" is the truthful word for something only the maker does.

## Consequences

- The provider list grows to ten; no existing manifest changed, so no policy version moved.
- A later release that wants to create launches through an API has to change the family rule and the manifest, which
  the contract treats as a breaking, voiding change (ADR 0327).
