# ADR 0334: A recipe export is checked against a closed list of problems, and an error stops it

- Status: Accepted
- Date: 2026-10-29
- Parent epic: [#385](https://github.com/journey-to-code-org/open.blog/issues/385)
- Story: #397 (task DIST5.1.2)

## Context

The epic asks for validated structured data: unit portability, attribution and ingredient integrity, with no
invented facts. Once a recipe leaves the site, a typo in an amount ("1/0 cup"), a range written backwards or a
missing canonical address travels with it and cannot be corrected by the author at the destination. The reader's
scaler (`web/components/ob-quantity.js`) already defines which amounts a line may start with.

## Decision

- **`openblog_core::recipe_check::check` reports a closed list of codes**, each with fixed text, a severity and the
  1-based ingredient or step, or the front matter field, it concerns. Problems never contain the author's words, so
  they are safe to print and to put in the `--json` plan.
- **Errors stop the export** (nothing is written and the command fails): no ingredients, no steps, an empty
  ingredient or step, an ingredient amount that cannot be read (`unreadable-quantity`: `1/0`, `1//2`, `1/2/3`),
  a zero amount, a range that runs backwards (`3-2`), a zero time, a total shorter than prep plus cook, and a site
  without an absolute `http(s)` `url` (`no-canonical-address`: the export could not point at the canonical post).
- **Warnings are listed and the export goes ahead**: a duplicated ingredient line, a step starting with its own
  number ("Step 1:"), a time written as text (left out), only one of prep and cook with no total, servings that are
  not a number, calories with nothing to be per, an `adaptedFrom` that is not an address (left out), no site author,
  no cover image.
- **Amounts are read with the scaler's forms** (`2`, `1.5`, `1,5`, `1/2`, `1 1/2`, `1-1/2`, `½`, `1½`, and ranges
  with `-`, `–`, `—` or `to`); a line that does not start with a number ("Salt, to taste") has no amount and is
  fine. The check reads; it never rewrites a line or converts a unit.
- **The build is unchanged.** `openblog check` and the build keep their existing recipe warnings; the new check runs
  for the export only, so no existing site gains output or warnings.

## Considered options

- **Run the check in every build.** Deferred: it would add warnings to sites that never export; it can join
  `openblog check` later with the same codes.
- **Make every problem an error.** Rejected: a missing photo or author is a gap for some consumers, not a wrong
  fact, and the author may still want the file.

## Consequences

- An exported recipe has readable, positive amounts, ordered ranges, consistent times and a canonical address.
- The codes are a contract for later destination checks (story #398) and for Admin, which can show the same text.
