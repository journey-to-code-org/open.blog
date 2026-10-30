# ADR 0820: A recipe is exported as the same schema.org Recipe node its page carries, and `adaptedFrom` is the only new field

- Status: Accepted
- Date: 2026-10-29
- Parent epic: [#385](https://github.com/journey-to-code-org/open.blog/issues/385)
- Story: #397 (task DIST5.1.1)

## Context

Recipe posts (`profile: recipe`) already carry a schema.org `Recipe` node in the page's JSON-LD graph, built in the
renderer from the front matter (servings, `makes`, `prep`, `cook`, `total`, `cuisine`, `course`, `calories`) and the
lists under the ingredients and steps headings. The epic asks for an interoperable export that keeps the Markdown and
the canonical page as the source of truth, invents no facts, and lets the author choose where the recipe goes.

Provider facts, checked on 2026-10-29:

- [schema.org Recipe](https://schema.org/Recipe): `recipeIngredient` (Text), `recipeInstructions` (an ordered list of
  steps, `HowToStep`), `recipeYield` (Text or QuantitativeValue), `prepTime`, `cookTime`, `totalTime` (ISO 8601
  Duration), `recipeCuisine`, `recipeCategory`, `nutrition` (NutritionInformation), and from CreativeWork
  `isBasedOn` (CreativeWork, Product or URL): "a resource from which this work is derived or from which it is a
  modification or adaptation".
- [Google Search, Recipe structured data](https://developers.google.com/search/docs/appearance/structured-data/recipe):
  `name` and `image` are required for a recipe result; `recipeIngredient` holds one ingredient per entry with only
  the text needed to make it; instructions are best given as `HowToStep` with `text`, without "Step 1" labels; times
  are ISO 8601, `prepTime` is used together with `cookTime` (or `totalTime` alone); `nutrition.calories` needs
  `recipeYield`.
- [Mealie](https://mealie.io/documentation/getting-started/features/), a common self-hosted recipe manager, imports a
  recipe from a page URL with its scraper or from pasted "structured HTML or JSON". Recipe managers that import a URL
  read the page's schema.org data, so the page itself is the importer-friendly link. No importer offers an API this
  project may call on the author's behalf, and none is called.

## Decision

- **One mapping.** `openblog_core::recipe_schema::recipe_node` builds the `Recipe` node from the site settings, the
  published post and its parsed recipe. The renderer's JSON-LD graph uses it unchanged (the generated example site
  is byte-for-byte identical before and after the move), and `recipe_document` adds `"@context":
  "https://schema.org"` for a standalone file. Field by field: title to `name`, description, publication date,
  canonical address to `url` and `mainEntityOfPage`, tags to `keywords`, the site author to `author`, `cover` to
  `image`, ingredient lines to `recipeIngredient` (plain text, in order), steps to `HowToStep` with `position` and
  `text`, times that are one length to ISO 8601, `servings` (a plain number gets "servings") and `makes` to
  `recipeYield`, `cuisine`, `course` to `recipeCategory`, `calories` to `nutrition.calories`.
- **Nothing is guessed.** A time written as text ("overnight", "10-15 min") is left out; servings that are not a
  number and every ingredient line travel as the author wrote them. Amounts are not parsed into structured values
  and units are not converted, because the ingredient line is the author's text and a conversion would be a new fact.
- **`adaptedFrom` is the only new front matter field** (also `adapted_from`, `basedOn`). When it is an absolute
  `http` or `https` address it becomes `isBasedOn` on both the page and the export; anything else is left out of
  both and reported by the check (ADR 0821). A recipe without it has exactly the data it had.
- **The export is a local file.** `openblog export <slug> --format recipe-json-ld [--out <path> --write]` follows
  the other portable exports: published posts only, a dry run by default, `--json` for a versioned plan, never
  overwriting a file, and the publication boundary scan (ADR 0125). It sends nothing and reads no credential, so it
  needs no provider manifest (ADR 0325); a destination that receives a recipe is a separate, opt-in step (story
  #398).

## Considered options

- **A recipe file written by every build.** Rejected: it would change every recipe site's output; the page already
  carries the same data for importers, and the export is for an author who asks.
- **Structured ingredients (`PropertyValue` with amount and unit).** Rejected for now: no major consumer requires
  it, the reader's scaler works on text, and splitting the author's line risks inventing a unit or an amount.
- **h-recipe or microdata markup.** Not added: the page's JSON-LD is what search engines and the scrapers of recipe
  managers read; a second vocabulary would change every recipe page for little gain.

## Consequences

- An importer reading the page and one reading the export see the same node; a test pins that, and that the
  visible lists say what the data says.
- A change to the mapping changes both, on purpose.
