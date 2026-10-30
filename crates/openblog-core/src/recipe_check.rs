//! The checks a recipe export must pass (epic #385, story #397, ADR 0334).
//!
//! [`check`] reads a published recipe and reports every problem in a closed list of codes: the
//! ingredient amounts the reader's scaling reads, empty or duplicated lines, the times, the yield
//! and the attribution the export carries. An error stops the export; a warning is listed and the
//! export goes ahead. Problems are fixed text plus the position of the line or the name of the
//! field they concern, never the author's words.
//!
//! Pure: no environment, no network.

use serde::Serialize;

use crate::config::SiteConfig;
use crate::model::Post;
use crate::recipe::Recipe;
use crate::recipe_schema::web_address;

/// Whether a problem stops the export.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Severity {
    Error,
    Warning,
}

/// Every problem the recipe check reports. The list is closed; each has fixed text.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Code {
    /// No ingredient list was found under an ingredients heading.
    NoIngredients,
    /// No step list was found under a steps heading.
    NoSteps,
    /// An ingredient line holds no text.
    EmptyIngredient,
    /// A step holds no text.
    EmptyStep,
    /// An ingredient starts with a number that cannot be read as an amount ("1//2 cup", "1/0").
    UnreadableQuantity,
    /// An ingredient amount is zero ("0 eggs").
    ZeroQuantity,
    /// An amount range runs backwards ("3-2 cloves").
    DescendingRange,
    /// The same ingredient line appears twice.
    DuplicateIngredient,
    /// A step starts with its own number ("Step 1:"); the position already carries it.
    NumberedStep,
    /// The site has no absolute web address, so the export cannot point at the canonical post.
    NoCanonicalAddress,
    /// The site names no author, so the export credits nobody.
    NoAuthor,
    /// `adaptedFrom` is set but is not an http(s) address; it is left out.
    UnreadableAdaptedFrom,
    /// A time is written as text ("overnight", "10-15 min"); it is left out of the data.
    TimeNotExported,
    /// A time is zero.
    ZeroTime,
    /// The total time is shorter than prep and cook together.
    TotalShorterThanParts,
    /// Only one of prep and cook is a length of time, and there is no total.
    IncompleteTimes,
    /// `servings` does not start with a number, so the export gives it as text only.
    ServingsNotNumeric,
    /// Calories are given without servings or a yield to say what they are per.
    CaloriesWithoutYield,
    /// The post has no cover image; many recipe readers and search results require one.
    NoImage,
}

impl Code {
    pub fn severity(self) -> Severity {
        match self {
            Self::NoIngredients
            | Self::NoSteps
            | Self::EmptyIngredient
            | Self::EmptyStep
            | Self::UnreadableQuantity
            | Self::ZeroQuantity
            | Self::DescendingRange
            | Self::NoCanonicalAddress
            | Self::ZeroTime
            | Self::TotalShorterThanParts => Severity::Error,
            _ => Severity::Warning,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::NoIngredients => "no-ingredients",
            Self::NoSteps => "no-steps",
            Self::EmptyIngredient => "empty-ingredient",
            Self::EmptyStep => "empty-step",
            Self::UnreadableQuantity => "unreadable-quantity",
            Self::ZeroQuantity => "zero-quantity",
            Self::DescendingRange => "descending-range",
            Self::DuplicateIngredient => "duplicate-ingredient",
            Self::NumberedStep => "numbered-step",
            Self::NoCanonicalAddress => "no-canonical-address",
            Self::NoAuthor => "no-author",
            Self::UnreadableAdaptedFrom => "unreadable-adapted-from",
            Self::TimeNotExported => "time-not-exported",
            Self::ZeroTime => "zero-time",
            Self::TotalShorterThanParts => "total-shorter-than-parts",
            Self::IncompleteTimes => "incomplete-times",
            Self::ServingsNotNumeric => "servings-not-numeric",
            Self::CaloriesWithoutYield => "calories-without-yield",
            Self::NoImage => "no-image",
        }
    }

    pub fn message(self) -> &'static str {
        match self {
            Self::NoIngredients => "the recipe has no ingredients; put them in a list under an `## Ingredients` heading",
            Self::NoSteps => "the recipe has no steps; put them in a list under a `## Steps` heading",
            Self::EmptyIngredient => "an ingredient line is empty; remove it or write the ingredient",
            Self::EmptyStep => "a step is empty; remove it or write the step",
            Self::UnreadableQuantity => "an ingredient starts with an amount that cannot be read; write it as 2, 1.5, 1/2, 1 1/2 or ½",
            Self::ZeroQuantity => "an ingredient amount is zero; give the amount or leave the number out",
            Self::DescendingRange => "an ingredient range runs backwards; write the smaller amount first",
            Self::DuplicateIngredient => "the same ingredient line appears more than once; importers will list it twice",
            Self::NumberedStep => "a step starts with its own number; the export numbers steps already, so the label is repeated",
            Self::NoCanonicalAddress => "the site has no absolute http(s) `url` in openblog.json, so the export cannot link the canonical post",
            Self::NoAuthor => "the site names no author in openblog.json, so the export credits nobody",
            Self::UnreadableAdaptedFrom => "`adaptedFrom` is not an http(s) web address, so the export leaves the source out",
            Self::TimeNotExported => "a time is written as text, not one length of time, so the export leaves it out",
            Self::ZeroTime => "a time is zero; give the time or remove the field",
            Self::TotalShorterThanParts => "`total` is shorter than `prep` and `cook` together",
            Self::IncompleteTimes => "only one of `prep` and `cook` is a length of time and there is no `total`, so readers see part of the time",
            Self::ServingsNotNumeric => "`servings` does not start with a number, so the export gives it as text and importers cannot scale it",
            Self::CaloriesWithoutYield => "`calories` is given without `servings` or `makes`, so nothing says what it is per",
            Self::NoImage => "the post has no `cover` image; many recipe apps and search results need one",
        }
    }
}

/// One problem: its code, and the 1-based position of the ingredient or step it concerns, or the
/// front matter field it concerns.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Problem {
    pub code: Code,
    pub severity: Severity,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ingredient: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub step: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub field: Option<&'static str>,
    pub message: &'static str,
}

impl Problem {
    fn new(code: Code) -> Self {
        Self {
            code,
            severity: code.severity(),
            ingredient: None,
            step: None,
            field: None,
            message: code.message(),
        }
    }

    fn ingredient(code: Code, index: usize) -> Self {
        Self {
            ingredient: Some(index + 1),
            ..Self::new(code)
        }
    }

    fn step(code: Code, index: usize) -> Self {
        Self {
            step: Some(index + 1),
            ..Self::new(code)
        }
    }

    fn field(code: Code, field: &'static str) -> Self {
        Self {
            field: Some(field),
            ..Self::new(code)
        }
    }

    /// One line for a terminal: `error [unreadable-quantity] ingredient 3: ...`.
    pub fn line(&self) -> String {
        let place = match (self.ingredient, self.step, self.field) {
            (Some(i), _, _) => format!(" ingredient {i}:"),
            (_, Some(s), _) => format!(" step {s}:"),
            (_, _, Some(f)) => format!(" `{f}`:"),
            _ => String::new(),
        };
        let severity = match self.severity {
            Severity::Error => "error",
            Severity::Warning => "warning",
        };
        format!(
            "{severity} [{}]{place} {}",
            self.code.as_str(),
            self.message
        )
    }
}

/// True when any problem stops the export.
pub fn has_errors(problems: &[Problem]) -> bool {
    problems.iter().any(|p| p.severity == Severity::Error)
}

/// What an ingredient line's leading amount says.
#[derive(Clone, Debug, PartialEq)]
pub enum Quantity {
    /// The line does not start with a number ("Salt, to taste").
    None,
    /// One amount, or a range's two ends.
    Amount(Vec<f64>),
    /// The line starts with a number that is not a readable, positive amount.
    Problem(Code),
}

/// The amount at the start of an ingredient line, read with the same forms the reader's scaling
/// accepts (`2`, `1.5`, `1,5`, `1/2`, `1 1/2`, `1-1/2`, `½`, `1½`, and ranges `2-3`, `2 to 3`).
pub fn quantity(line: &str) -> Quantity {
    let s = line.trim_start();
    let starts_numeric = s
        .chars()
        .next()
        .is_some_and(|c| c.is_ascii_digit() || crate::recipe::is_unicode_fraction(c));
    if !starts_numeric {
        return Quantity::None;
    }
    let Some((first, rest)) = amount(s) else {
        return Quantity::Problem(Code::UnreadableQuantity);
    };
    if rest.starts_with(['/', '⁄']) {
        return Quantity::Problem(Code::UnreadableQuantity);
    }
    if first <= 0.0 {
        return Quantity::Problem(Code::ZeroQuantity);
    }
    let trimmed = rest.trim_start();
    let after_separator = ["-", "–", "—", "to "]
        .iter()
        .find_map(|sep| trimmed.strip_prefix(sep))
        .map(str::trim_start)
        .filter(|after| {
            after
                .chars()
                .next()
                .is_some_and(|c| c.is_ascii_digit() || crate::recipe::is_unicode_fraction(c))
        });
    let Some(after) = after_separator else {
        return Quantity::Amount(vec![first]);
    };
    let Some((second, rest)) = amount(after) else {
        return Quantity::Problem(Code::UnreadableQuantity);
    };
    if rest.starts_with(['/', '⁄']) {
        return Quantity::Problem(Code::UnreadableQuantity);
    }
    if second <= 0.0 {
        return Quantity::Problem(Code::ZeroQuantity);
    }
    if second < first {
        return Quantity::Problem(Code::DescendingRange);
    }
    Quantity::Amount(vec![first, second])
}

/// One amount at the start of `s`, including the US mixed form `1-1/2`.
fn amount(s: &str) -> Option<(f64, &str)> {
    let digits = |t: &str| t.find(|c: char| !c.is_ascii_digit()).unwrap_or(t.len());
    // "1-1/2": a whole number, a hyphen, then a proper fraction.
    let whole = digits(s);
    if whole > 0 {
        if let Some(after) = s[whole..].strip_prefix('-') {
            let num = digits(after);
            if num > 0 {
                if let Some(den_part) = after[num..].strip_prefix(['/', '⁄']) {
                    let den = digits(den_part);
                    if den > 0 {
                        let w: f64 = s[..whole].parse().ok()?;
                        let n: f64 = after[..num].parse().ok()?;
                        let d: f64 = den_part[..den].parse().ok()?;
                        if d == 0.0 {
                            return None;
                        }
                        if n < d {
                            return Some((w + n / d, &den_part[den..]));
                        }
                    }
                }
            }
        }
    }
    crate::recipe::leading_number(s)
}

/// Every problem with exporting `post`'s recipe, in a stable order: the lists, each ingredient and
/// step in order, then the times, the yield, and the attribution.
pub fn check(config: &SiteConfig, post: &Post, recipe: &Recipe) -> Vec<Problem> {
    let mut problems = Vec::new();
    if recipe.ingredients.is_empty() {
        problems.push(Problem::new(Code::NoIngredients));
    }
    if recipe.steps.is_empty() {
        problems.push(Problem::new(Code::NoSteps));
    }
    let mut seen: Vec<String> = Vec::new();
    for (i, line) in recipe.ingredients.iter().enumerate() {
        let line = line.trim();
        if line.is_empty() {
            problems.push(Problem::ingredient(Code::EmptyIngredient, i));
            continue;
        }
        if let Quantity::Problem(code) = quantity(line) {
            problems.push(Problem::ingredient(code, i));
        }
        let key = line.to_lowercase();
        if seen.contains(&key) {
            problems.push(Problem::ingredient(Code::DuplicateIngredient, i));
        } else {
            seen.push(key);
        }
    }
    for (i, step) in recipe.steps.iter().enumerate() {
        let step = step.trim();
        if step.is_empty() {
            problems.push(Problem::step(Code::EmptyStep, i));
        } else if numbered_step(step) {
            problems.push(Problem::step(Code::NumberedStep, i));
        }
    }
    for (field, minutes, written) in [
        ("prep", recipe.prep, &recipe.prep_text),
        ("cook", recipe.cook, &recipe.cook_text),
        ("total", recipe.total, &recipe.total_text),
    ] {
        if written.is_some() {
            problems.push(Problem::field(Code::TimeNotExported, field));
        } else if minutes == Some(0) {
            problems.push(Problem::field(Code::ZeroTime, field));
        }
    }
    if let (Some(p), Some(c), Some(t)) = (recipe.prep, recipe.cook, recipe.total) {
        if p.checked_add(c).is_some_and(|parts| t < parts) {
            problems.push(Problem::field(Code::TotalShorterThanParts, "total"));
        }
    }
    let given =
        |minutes: Option<u32>, written: &Option<String>| minutes.is_some() || written.is_some();
    if !given(recipe.total, &recipe.total_text)
        && given(recipe.prep, &recipe.prep_text) != given(recipe.cook, &recipe.cook_text)
    {
        problems.push(Problem::field(Code::IncompleteTimes, "total"));
    }
    if recipe.servings_text.is_some() && recipe.servings.is_none() {
        problems.push(Problem::field(Code::ServingsNotNumeric, "servings"));
    }
    if recipe.calories.is_some() && recipe.servings_text.is_none() && recipe.yield_text.is_none() {
        problems.push(Problem::field(Code::CaloriesWithoutYield, "calories"));
    }
    if recipe
        .adapted_from
        .as_deref()
        .is_some_and(|v| web_address(v).is_none())
    {
        problems.push(Problem::field(Code::UnreadableAdaptedFrom, "adaptedFrom"));
    }
    if web_address(&config.url).is_none() {
        problems.push(Problem::new(Code::NoCanonicalAddress));
    }
    if config.author.name.trim().is_empty() {
        problems.push(Problem::new(Code::NoAuthor));
    }
    if post.cover.is_none() {
        problems.push(Problem::new(Code::NoImage));
    }
    problems
}

/// "Step 1", "Step 2:", "1." or "2)" at the start of a step's text.
fn numbered_step(step: &str) -> bool {
    let lower = step.to_lowercase();
    let rest = lower
        .strip_prefix("step")
        .map(str::trim_start)
        .unwrap_or(&lower);
    let digits = rest
        .find(|c: char| !c.is_ascii_digit())
        .unwrap_or(rest.len());
    if digits == 0 {
        return false;
    }
    let after = &rest[digits..];
    if lower.starts_with("step") {
        after.is_empty() || after.starts_with([':', '.', ')', ' ', '-', '–'])
    } else {
        after.starts_with(['.', ')']) && !after[1..].starts_with(|c: char| c.is_ascii_digit())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn amounts(line: &str) -> Vec<f64> {
        match quantity(line) {
            Quantity::Amount(v) => v,
            other => panic!("{line}: {other:?}"),
        }
    }

    #[test]
    fn reads_the_amounts_the_scaler_reads() {
        assert_eq!(amounts("2 eggs"), vec![2.0]);
        assert_eq!(amounts("1.5 cups milk"), vec![1.5]);
        assert_eq!(amounts("1,5 l water"), vec![1.5]);
        assert_eq!(amounts("1/2 cup sugar"), vec![0.5]);
        assert_eq!(amounts("1 1/2 lemons"), vec![1.5]);
        assert_eq!(amounts("1-1/2 cups flour"), vec![1.5]);
        assert_eq!(amounts("½ lemon"), vec![0.5]);
        assert_eq!(amounts("1½ tsp salt"), vec![1.5]);
        assert_eq!(amounts("400g spaghetti"), vec![400.0]);
        assert_eq!(amounts("2-3 cloves garlic"), vec![2.0, 3.0]);
        assert_eq!(amounts("2 – 3 cloves garlic"), vec![2.0, 3.0]);
        assert_eq!(amounts("2 to 3 cloves garlic"), vec![2.0, 3.0]);
        assert_eq!(amounts("10-inch tortillas"), vec![10.0]);
        assert_eq!(amounts("1 can (400 g) tomatoes"), vec![1.0]);
        assert_eq!(quantity("Salt, to taste"), Quantity::None);
        assert_eq!(quantity("A pinch of salt"), Quantity::None);
    }

    #[test]
    fn names_amounts_that_cannot_be_right() {
        assert_eq!(
            quantity("1/0 cup sugar"),
            Quantity::Problem(Code::UnreadableQuantity)
        );
        assert_eq!(
            quantity("1//2 cup sugar"),
            Quantity::Problem(Code::UnreadableQuantity)
        );
        assert_eq!(
            quantity("1/2/3 cup sugar"),
            Quantity::Problem(Code::UnreadableQuantity)
        );
        assert_eq!(quantity("0 eggs"), Quantity::Problem(Code::ZeroQuantity));
        assert_eq!(
            quantity("3-2 cloves garlic"),
            Quantity::Problem(Code::DescendingRange)
        );
        assert_eq!(quantity("2-0 cups"), Quantity::Problem(Code::ZeroQuantity));
    }

    #[test]
    fn numbered_steps_are_noticed_but_numbers_in_text_are_not() {
        assert!(numbered_step("Step 1: Boil"));
        assert!(numbered_step("step 2"));
        assert!(numbered_step("1. Boil"));
        assert!(numbered_step("3) Drain"));
        assert!(!numbered_step("2 eggs go in"));
        assert!(!numbered_step("1.5 hours in the oven"));
        assert!(!numbered_step("Stephanie's trick"));
        assert!(!numbered_step("Boil for 10 minutes."));
    }

    #[test]
    fn every_code_has_a_distinct_name() {
        let codes = [
            Code::NoIngredients,
            Code::NoSteps,
            Code::EmptyIngredient,
            Code::EmptyStep,
            Code::UnreadableQuantity,
            Code::ZeroQuantity,
            Code::DescendingRange,
            Code::DuplicateIngredient,
            Code::NumberedStep,
            Code::NoCanonicalAddress,
            Code::NoAuthor,
            Code::UnreadableAdaptedFrom,
            Code::TimeNotExported,
            Code::ZeroTime,
            Code::TotalShorterThanParts,
            Code::IncompleteTimes,
            Code::ServingsNotNumeric,
            Code::CaloriesWithoutYield,
            Code::NoImage,
        ];
        let mut names: Vec<&str> = codes.iter().map(|c| c.as_str()).collect();
        for code in codes {
            assert_eq!(
                serde_json::to_value(code).unwrap(),
                json!(code.as_str()),
                "serde name matches as_str"
            );
        }
        names.sort();
        names.dedup();
        assert_eq!(names.len(), codes.len());
    }
}
