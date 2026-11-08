# ADR 0385: A portable recipe keeps its amounts and units as written, and a mix of measuring systems is a warning

- Status: Accepted
- Date: 2026-11-08
- Parent epic: [#385](https://github.com/journey-to-code-org/open.blog/issues/385)
- Stories: #397 (task DIST5.1.2), #398
- Amends: [ADR 0334](0334-a-recipe-export-is-checked-against-a-closed-list-of-problems-and-an-error-stops-it.md)

## Context

Epic #385 asks for "unit portability" in a recipe that leaves the site. ADR 0333 settled that ingredient lines
travel as written, and ADR 0334 that the check reads and never rewrites. Neither said what portability means or
checked units at all. A check found the following problems:

- A recipe whose lines are partly metric and partly US ("500 g flour", "1 cup milk") travels unchanged, so a
  cook who uses one system has to convert the rest, and nothing tells the author.
- ADR 0334 says amounts are read "with the scaler's forms", but the check had its own reader. It refused
  `500-1,000 g` as a backwards range, missed `1,000-500 g`, and passed `1.2.3 cups` and `½½ cup`, which the
  reader's scaler (`findQuantity` in `web/components/ob-quantity.js`) reads as nothing and as `½`.
- The `Recipe` node, the exported `recipe.json` and `credit.txt` named the site author even when the post's
  credit file names someone else, while the `BlogPosting` on the same page named the credited author.
- A post whose `canonical` names another page got a ready recipe export, Hacker News and Reddit kits and a
  Product Hunt launch kit. Each one carried this site's address as the original. Only the recipe package
  refused it.

## Decision

- **Portability means the amount and the unit travel exactly as written.** open.blog never converts a unit,
  never rounds an amount and never adds a second measure. A recipe app, a directory and a reader all get the
  author's own words.
- **A mix of measuring systems is a warning, `mixed-unit-systems`.** It is reported on the first ingredient
  whose amount is in the other system, and the export goes ahead with nothing changed. It is reported once per
  recipe. A line's system comes from the unit right after its leading amount:
  - **Metric** is exactly what the scaler counts as metric (its `METRIC` words: `g`, `kg`, `ml`, `l`, `grams`,
    `litres` and so on).
  - **US or imperial** means cups, ounces, pounds, pints, quarts, gallons and `fl`.
  - Teaspoons and tablespoons count as neither, because cooks use them everywhere.
  - A line that gives both systems, such as `12 oz / 340 g` or `1 cup (240 ml)`, counts as neither, because any
    cook can follow it.
- **No unknown-unit check.** `2 glorps` cannot be told apart from `2 eggs` without a word list, and a word
  list would warn about ordinary ingredients.
- **The check reads amounts with the scaler's own grammar.** `recipe_check` now copies `findQuantity`'s
  `LEADING` pattern and `parseAmount`, including the order in which the pattern tries each form, digit grouping
  (`1,000`) and all fifteen fraction signs. A line the scaler reads no amount from, but which starts with a
  number, is `unreadable-quantity`. A second fraction sign right after the amount (`½½`) is also
  `unreadable-quantity`, because the scaler would read only the first one. The cases in
  `tests/fixtures/recipe-quantities.json` run through both readers: `tests/web/quantity.test.mjs` checks the
  scaler and `crates/openblog-core/tests/recipe_quantities.rs` checks the check.
- **Every recipe output credits the post's credited authors.** The `Recipe` node, `recipe.json` and
  `credit.txt` name the authors in the post's credit file, in credit order and as the `BlogPosting` names them.
  A post without a credit file still credits the site author. `no-author` now means that neither exists.
- **Another canonical page blocks every path that hands out the address.** `Post::canonical_elsewhere` is the
  one check. The recipe package, which had it first, now calls it too.
  - The recipe export reports `canonical-elsewhere` as an error, so it writes nothing.
  - The Hacker News, Reddit and Product Hunt kits carry a blocking `canonical-elsewhere` notice and no submit
    link.
- **Text in a recipe section outside its list is a warning, `unlisted-text`.** This covers a loose paragraph
  under "Ingredients", for example. The page shows that text, but the recipe data cannot carry it.
  A photo's description (its alt text) is not counted: it describes the picture, not the recipe.
- **Private records and packages stay out of the published folders.** `community.stateFile`,
  `syndication.stateFile`, `syndication.approvalFile` and `syndication.pinterest.stateFile` are refused when
  they lie inside the static, themes, web or output folder, because the next build would publish them. So is a
  recipe package's `--out`, whether written relative to the project or as a full path. Each folder is read the
  way the build reads it, so one configured outside the project (`"static": "../shared-static"`) or by a full
  path counts too. The private `.openblog` folder is never published.

## Considered options

- **Convert units, or add the other system's measure.** Rejected, as in ADR 0333: a conversion is an invented
  fact. A cup of flour has no single weight.
- **Make a mix of systems an error.** Rejected: many good recipes mix systems, and the author may still want
  the file. The warning says what a reader will meet.
- **Keep the check's own amount reader and add the missing forms.** Rejected: two readers that are meant to be
  the same will drift apart again. Shared cases that run through both catch a difference the day it appears.

## Consequences

- An exported recipe's amounts are the ones a reader of the page can scale. A recipe with `500-1,000 g` can now
  be exported.
- Admin's preview shows the three new codes (`canonical-elsewhere`, `mixed-unit-systems` and `unlisted-text`)
  in plain words, like the others.
- A site that had put a state file in a published folder now gets an error naming the setting, and nothing is
  written.
