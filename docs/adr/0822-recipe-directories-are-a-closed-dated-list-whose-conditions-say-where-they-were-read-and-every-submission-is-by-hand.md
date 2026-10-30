# ADR 0822: Recipe directories are a closed, dated list whose conditions say where they were read, and every submission is by hand

- Status: Accepted
- Date: 2026-10-29
- Parent epic: [#385](https://github.com/journey-to-code-org/open.blog/issues/385)
- Story: #398 (task DIST5.2.1)

## Context

Story #398 asks for recipe directory submission packages "without assuming API access", with provider requirements
verified before shipping, every external action opt-in and authorized, and clear unsupported states. The author
keeps the canonical post and chooses which directories receive it.

What was found on 2026-10-29:

- **Google Search** ([Recipe structured data](https://developers.google.com/search/docs/appearance/structured-data/recipe)):
  no submission form; Google reads the page. `name` and `image` are required; Google recommends several
  high-resolution images of at least 50,000 pixels (width times height) in 16x9, 4x3 and 1x1; the page must not be
  blocked by robots.txt, `noindex` or a login. The author tests with the
  [Rich Results Test](https://search.google.com/test/rich-results) and asks for a recrawl with URL Inspection.
- **Pinterest** ([Rich Pins](https://help.pinterest.com/en/business/article/rich-pins)): recipe Pins read the page's
  schema.org `Recipe` (or h-recipe) markup; there is no application step, syncing takes up to 24 hours, and a manual
  edit on Pinterest overwrites what was read. The author saves the Pin.
- **Foodgawker**: a curated gallery the author submits a photo, title, description and link to, from an account.
  Its own pages ([terms](https://foodgawker.com/terms), [about](https://foodgawker.com/about),
  [how to get accepted](https://foodgawker.com/blog/how-to-get-your-recipes-accepted)) refuse automated reads, so
  their text was seen only through a search index: the submitter owns the photo or has permission and grants web
  rights with attribution; editors review every submission; AI-generated images are declined. A square crop is
  reported only by food bloggers.
- **Yummly** closed its website and app in December 2024 ([Wikipedia](https://en.wikipedia.org/wiki/Yummly)).
- **Allrecipes**: its submission terms could not be read.
- None of them offers an API this project may call on the author's behalf.

## Decision

- **A closed list in `openblog_core::recipe_directory`**: `google-search`, `pinterest`, `foodgawker`, each with a
  label, how it receives a recipe (`reads-the-page` or `form-by-hand`), its sources and a `POLICY_VERSION`
  (`2026-10-29`). A new directory is a code change with its facts.
- **Capabilities in the provider contract's vocabulary** (`Capability`, `Support`, ADR 0325): link `manual`; text and
  image `manual` where the author pastes or uploads them (Pinterest, Foodgawker) and `unsupported` for Google, which
  reads the page; everything else `unsupported`. Nothing is ever `adapter`, and a test holds that.
- **Every condition says where it was read**: `official` (the directory's own documentation, on the policy date) or
  `unverified` (only seen through a search index or reported elsewhere). A directory with an unverified condition
  always carries the warning `conditions-unverified`, and the guide marks each such condition "not verified: check
  it there". A reported rule is never enforced as an error.
- **Unavailable is a named state**: `yummly` (`directory-closed`) and `allrecipes` (`terms-not-verified`) are refused
  with their fixed reason, and any other name is refused as unknown without repeating it. Nothing is read or
  written.
- **Destination checks, a closed list** (`FindingCode`), on top of the recipe check (ADR 0821):
  errors `recipe-has-errors`, `canonical-elsewhere` (the post's own `canonical` names another page) and `no-image`
  (every directory here shows the dish's photo); warnings `image-linked-not-included`, `image-size-unknown`,
  `image-below-recommended-size` (Google, under 50,000 pixels), `image-not-square` (Foodgawker, reported crop),
  `no-description` (a form the author fills) and `conditions-unverified`. Findings are fixed text and never contain
  the author's words. A directory with an error is `blocked`; otherwise `ready` for the author's own steps.
- **Every submission is the author's act, by hand.** open.blog sends nothing to a directory, opens no connection and
  reads no credential; the steps it lists are for the author to take, if they choose to.

## Considered options

- **Add the directories to the provider manifests (ADR 0325).** Not done in this story: the manifest's provider list
  is a contract shared with the hosted delivery worker and pinned by its fixture, and it gates adapters; a directory
  has no adapter and no login. The directory facts reuse the manifest's capability vocabulary and dated policy
  version, so a later story can fold them in when a directory gains an API.
- **Include Foodgawker only once its pages can be read.** Rejected: the author can still use a package; marking
  every condition unverified is honest and keeps the author in charge.
- **Treat Yummly and Allrecipes as unknown names.** Rejected: "closed" and "terms not verified" are useful answers.

## Consequences

- A directory's facts can be reviewed in one place, with sources, and go stale visibly by date.
- Nothing in a build, feed or existing export reads this module.
