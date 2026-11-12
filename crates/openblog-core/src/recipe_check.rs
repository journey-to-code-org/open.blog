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
    /// The post's own `canonical` names another page, so the export would point at a copy.
    CanonicalElsewhere,
    /// Some amounts are metric and others US or imperial, so a cook must convert some of them
    /// (ADR 0385). Nothing is rewritten.
    MixedUnitSystems,
    /// A recipe section holds text outside its list (a loose paragraph); the page shows it, the
    /// export leaves it out.
    UnlistedText,
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
            | Self::CanonicalElsewhere
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
            Self::CanonicalElsewhere => "canonical-elsewhere",
            Self::MixedUnitSystems => "mixed-unit-systems",
            Self::UnlistedText => "unlisted-text",
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
            Self::NoAuthor => "the post credits no author and the site names none in openblog.json, so the export credits nobody",
            Self::UnreadableAdaptedFrom => "`adaptedFrom` is not an http(s) web address, so the export leaves the source out",
            Self::TimeNotExported => "a time is written as text, not one length of time, so the export leaves it out",
            Self::ZeroTime => "a time is zero; give the time or remove the field",
            Self::TotalShorterThanParts => "`total` is shorter than `prep` and `cook` together",
            Self::IncompleteTimes => "only one of `prep` and `cook` is a length of time and there is no `total`, so readers see part of the time",
            Self::ServingsNotNumeric => "`servings` does not start with a number, so the export gives it as text and importers cannot scale it",
            Self::CaloriesWithoutYield => "`calories` is given without `servings` or `makes`, so nothing says what it is per",
            Self::NoImage => "the post has no `cover` image; many recipe apps and search results need one",
            Self::CanonicalElsewhere => "the post names another page as its original (`canonical`), so the export would point recipe apps at this copy; share that page instead, or remove the setting",
            Self::MixedUnitSystems => "some amounts are in grams or litres and others in cups, ounces or pounds, so cooks who use one system must convert the rest; open.blog changes nothing, so consider giving both",
            Self::UnlistedText => "a recipe section has text outside its list; the page shows it but the export leaves it out, so put it in the list or under another heading",
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

/// The single-character fractions the reader's scaler reads (`UNICODE_FRACTIONS` in
/// `web/components/ob-quantity.js`).
const SCALER_FRACTIONS: [(char, f64); 15] = [
    ('½', 1.0 / 2.0),
    ('⅓', 1.0 / 3.0),
    ('⅔', 2.0 / 3.0),
    ('¼', 1.0 / 4.0),
    ('¾', 3.0 / 4.0),
    ('⅕', 1.0 / 5.0),
    ('⅖', 2.0 / 5.0),
    ('⅗', 3.0 / 5.0),
    ('⅘', 4.0 / 5.0),
    ('⅙', 1.0 / 6.0),
    ('⅚', 5.0 / 6.0),
    ('⅛', 1.0 / 8.0),
    ('⅜', 3.0 / 8.0),
    ('⅝', 5.0 / 8.0),
    ('⅞', 7.0 / 8.0),
];

fn fraction_value(c: char) -> Option<f64> {
    SCALER_FRACTIONS
        .iter()
        .find(|(f, _)| *f == c)
        .map(|(_, v)| *v)
}

fn is_fraction(c: char) -> bool {
    fraction_value(c).is_some()
}

fn digits_len(t: &str) -> usize {
    t.bytes().take_while(u8::is_ascii_digit).count()
}

fn space_len(t: &str) -> usize {
    t.chars()
        .take_while(|c| c.is_whitespace())
        .map(char::len_utf8)
        .sum()
}

/// The byte length of the character at the start of `t` when `accept` takes it.
fn char_len(t: &str, accept: impl Fn(char) -> bool) -> Option<usize> {
    t.chars().next().filter(|&c| accept(c)).map(char::len_utf8)
}

fn is_slash(c: char) -> bool {
    c == '/' || c == '⁄'
}

/// The lengths the scaler's `AMOUNT` pattern can match at the start of `t`, in the order its
/// regular expression tries them: `1-1/2`, `1 1/2`, `1½` or `1 ½`, `1/2`, `½`, `1,000`,
/// `1.5` or `1,5`, `12`. A shorter run of digits is never listed: it leaves a digit next, which
/// nothing after an amount accepts.
fn amount_lengths(t: &str) -> Vec<usize> {
    let mut out = Vec::new();
    let d = digits_len(t);
    // `\d+ SLASH \d+` from `at`: where it ends, when it is there.
    let fraction_from = |at: usize| -> Option<usize> {
        let n = digits_len(&t[at..]);
        if n == 0 {
            return None;
        }
        let slash = char_len(&t[at + n..], is_slash)?;
        let m = digits_len(&t[at + n + slash..]);
        (m > 0).then_some(at + n + slash + m)
    };
    if d > 0 {
        if t[d..].starts_with('-') {
            out.extend(fraction_from(d + 1));
        }
        let space = space_len(&t[d..]);
        if space > 0 {
            out.extend(fraction_from(d + space));
        }
        if let Some(w) = char_len(&t[d..], char::is_whitespace) {
            if let Some(f) = char_len(&t[d + w..], is_fraction) {
                out.push(d + w + f);
            }
        }
        if let Some(f) = char_len(&t[d..], is_fraction) {
            out.push(d + f);
        }
        if let Some(slash) = char_len(&t[d..], is_slash) {
            let m = digits_len(&t[d + slash..]);
            if m > 0 {
                out.push(d + slash + m);
            }
        }
    }
    if let Some(f) = char_len(t, is_fraction) {
        out.push(f);
    }
    if d > 0 {
        // Digit grouping, `1,000`: up to three digits, then groups of exactly three, and no
        // digit or comma after.
        if d <= 3 {
            let mut end = d;
            while t[end..].starts_with(',') && digits_len(&t[end + 1..]) >= 3 {
                end += 4;
            }
            if end > d && !t[end..].starts_with(|c: char| c.is_ascii_digit() || c == ',') {
                out.push(end);
            }
        }
        if t[d..].starts_with(['.', ',']) {
            let m = digits_len(&t[d + 1..]);
            if m > 0 {
                out.push(d + 1 + m);
            }
        }
        out.push(d);
    }
    out
}

/// The scaler's range separator at the start of `t` (`-`, `–`, `—` or `to`, with any spaces).
fn separator_len(t: &str) -> Option<usize> {
    let before = space_len(t);
    let sep = ["-", "–", "—", "to"]
        .iter()
        .find(|sep| t[before..].starts_with(**sep))?
        .len();
    Some(before + sep + space_len(&t[before + sep..]))
}

/// What may not follow an amount: another digit, a slash, a point or a comma.
fn ends_cleanly(rest: &str) -> bool {
    !rest.starts_with(|c: char| c.is_ascii_digit() || is_slash(c) || c == '.' || c == ',')
}

fn all_digits(t: &str) -> bool {
    !t.is_empty() && digits_len(t) == t.len()
}

/// The value of one amount as written, or NaN: the scaler's `parseAmount`.
fn parse_amount(raw: &str) -> f64 {
    let s = raw.trim().replace('⁄', "/");
    let num = |t: &str| t.parse::<f64>().unwrap_or(f64::NAN);
    let ratio = |n: &str, den: &str| {
        let den = num(den);
        if den == 0.0 {
            f64::NAN
        } else {
            num(n) / den
        }
    };
    let d = digits_len(&s);
    let (whole, after) = s.split_at(d);
    if d > 0 {
        // `1-1/2` and `1 1/2`.
        let joined = after.trim_start_matches(|c: char| c == '-' || c.is_whitespace());
        if joined.len() < after.len() {
            if let Some((n, den)) = joined.split_once('/') {
                if all_digits(n) && all_digits(den) {
                    return num(whole) + ratio(n, den);
                }
            }
        }
        // `1½` and `1 ½`.
        let mut tail = after.chars();
        let fraction = match (tail.next(), tail.next(), tail.next()) {
            (Some(f), None, None) => fraction_value(f),
            (Some(w), Some(f), None) if w.is_whitespace() => fraction_value(f),
            _ => None,
        };
        if let Some(f) = fraction {
            return num(whole) + f;
        }
        // `1/2`.
        if let Some(den) = after.strip_prefix('/') {
            if all_digits(den) {
                return ratio(whole, den);
            }
        }
    }
    // `½`.
    let mut chars = s.chars();
    if let (Some(f), None) = (chars.next(), chars.next()) {
        if let Some(v) = fraction_value(f) {
            return v;
        }
    }
    // `1,000`.
    if (1..=3).contains(&d)
        && after.starts_with(',')
        && after
            .split(',')
            .skip(1)
            .all(|group| group.len() == 3 && all_digits(group))
    {
        return num(&s.replace(',', ""));
    }
    num(&s.replacen(',', ".", 1))
}

/// The amount (or range) at the start of an ingredient line as the scaler's `LEADING` pattern
/// reads it: the text of each end and the byte offset just past the quantity, or `None` when
/// the pattern does not match.
fn scaler_match(line: &str) -> Option<(Vec<&str>, usize)> {
    let lead = space_len(line);
    let t = &line[lead..];
    for first in amount_lengths(t) {
        if let Some(sep) = separator_len(&t[first..]) {
            let from = first + sep;
            for second in amount_lengths(&t[from..]) {
                let end = from + second;
                if ends_cleanly(&t[end..]) {
                    return Some((vec![&t[..first], &t[from..end]], lead + end));
                }
            }
        }
        if ends_cleanly(&t[first..]) {
            return Some((vec![&t[..first]], lead + first));
        }
    }
    None
}

/// The values the reader's scaler reads at the start of `line`, as `findQuantity(line).values`
/// in `web/components/ob-quantity.js` gives them, or `None` where it reads no amount. The
/// shared cases in `tests/fixtures/recipe-quantities.json` run through both.
pub fn scaler_amounts(line: &str) -> Option<Vec<f64>> {
    let (ends, _) = scaler_match(line)?;
    let values: Vec<f64> = ends.into_iter().map(parse_amount).collect();
    values
        .iter()
        .all(|v| v.is_finite() && *v > 0.0)
        .then_some(values)
}

/// The unit after the line's leading amount: the letters right after it, as the scaler reads
/// them.
fn leading_unit(line: &str) -> Option<&str> {
    let (_, end) = scaler_match(line)?;
    let rest = line[end..].trim_start();
    let len: usize = rest
        .chars()
        .take_while(|c| c.is_ascii_alphabetic() || *c == 'µ')
        .map(char::len_utf8)
        .sum();
    (len > 0).then(|| &rest[..len])
}

/// The scaler's `METRIC` words: the units it keeps as whole grams and millilitres.
const METRIC_UNITS: &[&str] = &[
    "g",
    "kg",
    "mg",
    "gr",
    "gram",
    "grams",
    "kilo",
    "kilos",
    "kilogram",
    "kilograms",
    "ml",
    "l",
    "dl",
    "cl",
    "litre",
    "litres",
    "liter",
    "liters",
    "millilitre",
    "millilitres",
    "milliliter",
    "milliliters",
];

/// US and imperial measures that a cook who weighs in grams would have to convert (ADR 0385).
/// Spoons are left out: teaspoons and tablespoons are used everywhere.
const US_UNITS: &[&str] = &[
    "cup", "cups", "oz", "ounce", "ounces", "lb", "lbs", "pound", "pounds", "pint", "pints", "pt",
    "quart", "quarts", "qt", "gallon", "gallons", "gal", "fl",
];

/// The measuring system an ingredient line's amount is written in.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UnitSystem {
    Metric,
    Us,
}

/// Whether the scaler reads the unit after the line's leading amount as metric, as
/// `findQuantity(line).metric` does: the unit's ASCII letters, which is where the `METRIC`
/// pattern's word boundary falls.
pub fn scaler_metric(line: &str) -> bool {
    leading_unit(line).is_some_and(|unit| {
        let ascii: String = unit.chars().take_while(char::is_ascii_alphabetic).collect();
        METRIC_UNITS.contains(&ascii.to_ascii_lowercase().as_str())
    })
}

/// The one system a line's amount is written in, or `None` when its unit is neither (`2 eggs`,
/// `1 tsp salt`) or the line gives both (`12 oz / 340 g`), which every reader can follow.
pub fn unit_system(line: &str) -> Option<UnitSystem> {
    let unit = leading_unit(line)?.to_ascii_lowercase();
    let system = if scaler_metric(line) {
        UnitSystem::Metric
    } else if US_UNITS.contains(&unit.as_str()) {
        UnitSystem::Us
    } else {
        return None;
    };
    let other = match system {
        UnitSystem::Metric => US_UNITS,
        UnitSystem::Us => METRIC_UNITS,
    };
    let gives_both = line
        .split(|c: char| !c.is_ascii_alphabetic())
        .any(|word| other.contains(&word.to_ascii_lowercase().as_str()));
    (!gives_both).then_some(system)
}

fn starts_numeric(s: &str) -> bool {
    s.trim_start()
        .chars()
        .next()
        .is_some_and(|c| c.is_ascii_digit() || is_fraction(c))
}

/// The amount at the start of an ingredient line, read exactly as the reader's scaler reads it
/// ([`scaler_amounts`], ADR 0334), and what the scaler would get wrong: a number it cannot read,
/// a zero, an amount it reads only part of (`½½`), or a range that runs backwards.
pub fn quantity(line: &str) -> Quantity {
    if !starts_numeric(line) {
        return Quantity::None;
    }
    let Some((ends, end)) = scaler_match(line) else {
        return Quantity::Problem(Code::UnreadableQuantity);
    };
    let values: Vec<f64> = ends.into_iter().map(parse_amount).collect();
    if values.iter().any(|v| !v.is_finite()) {
        return Quantity::Problem(Code::UnreadableQuantity);
    }
    if values.iter().any(|v| *v <= 0.0) {
        return Quantity::Problem(Code::ZeroQuantity);
    }
    // The scaler stops before a second fraction sign: `½½` would scale as `½`.
    if line[end..].starts_with(is_fraction) {
        return Quantity::Problem(Code::UnreadableQuantity);
    }
    if values.len() == 2 && values[1] < values[0] {
        return Quantity::Problem(Code::DescendingRange);
    }
    Quantity::Amount(values)
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
    let mut first_system = None;
    let mut mixed = false;
    for (i, line) in recipe.ingredients.iter().enumerate() {
        let line = line.trim();
        if line.is_empty() {
            problems.push(Problem::ingredient(Code::EmptyIngredient, i));
            continue;
        }
        if let Quantity::Problem(code) = quantity(line) {
            problems.push(Problem::ingredient(code, i));
        }
        if let Some(system) = unit_system(line) {
            match first_system {
                None => first_system = Some(system),
                Some(first) if first != system && !mixed => {
                    mixed = true;
                    problems.push(Problem::ingredient(Code::MixedUnitSystems, i));
                }
                Some(_) => {}
            }
        }
        let key = line.to_lowercase();
        if seen.contains(&key) {
            problems.push(Problem::ingredient(Code::DuplicateIngredient, i));
        } else {
            seen.push(key);
        }
    }
    if recipe.unlisted_text > 0 {
        problems.push(Problem::new(Code::UnlistedText));
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
    if post.canonical_elsewhere(config) {
        problems.push(Problem::field(Code::CanonicalElsewhere, "canonical"));
    }
    if crate::render::post_author_names(config, post).is_empty() {
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
            Code::CanonicalElsewhere,
            Code::MixedUnitSystems,
            Code::UnlistedText,
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
