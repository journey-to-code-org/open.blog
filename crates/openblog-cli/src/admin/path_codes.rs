//! Stable codes for reading-path refusals and problems (Studio R13, G98). The core's sentences stay as
//! they are for one more release; a screen picks its words from the `code` and `field` and shows the
//! server's sentence only in its details. Every problem the core or the store can make maps to a code,
//! and a message that maps to none is `bad-value`, never silence.

/// The `(code, field)` of a path problem from its message. `field` is where a form shows it: `title`,
/// `summary`, `steps`, `target`, `id`, `relationship`, `why`, `basis`, `optional`, `rationale`,
/// `prerequisites`, or `""` for the whole path.
pub fn path_problem(message: &str) -> (&'static str, &'static str) {
    let has = |part: &str| message.contains(part);
    let long =
        has("characters") && (has("at most") || has("longer") || has("too long") || has("over"));
    if has("`title` is required") {
        ("required", "title")
    } else if message.starts_with("`title`") {
        (if long { "too-long" } else { "bad-value" }, "title")
    } else if message.starts_with("`summary`") {
        (if long { "too-long" } else { "bad-value" }, "summary")
    } else if has("a path holds at most") {
        ("too-many", "steps")
    } else if has("a published path has at least two steps") {
        ("nothing-to-follow", "steps")
    } else if has("a path file is `") || has("lowercase slug of at most") && !has("`id`") {
        ("bad-address", "")
    } else if has("`id` is a lowercase slug") {
        ("bad-address", "id")
    } else if has("`id` is used by an earlier step") {
        ("duplicate-id", "id")
    } else if has("is not a post slug") || has("is not an atlas entry id") {
        ("unknown-reference", "target")
    } else if has("a path never returns to a step") {
        ("repeat-target", "target")
    } else if message.starts_with("`rationale`") {
        (if long { "too-long" } else { "bad-value" }, "rationale")
    } else if message.starts_with("`prerequisites`") {
        (if long { "too-long" } else { "bad-value" }, "prerequisites")
    } else if has("cannot be optional") {
        ("first-optional", "optional")
    } else if has("so it has no transition") {
        ("first-has-reason", "why")
    } else if has("add a transition") || has("choose how this step relates") {
        ("needs-relationship", "relationship")
    } else if has("`transition.why` is required") {
        ("needs-reason", "why")
    } else if message.starts_with("`transition.why`") {
        (if long { "too-long" } else { "bad-value" }, "why")
    } else if has("needs `basis`") {
        ("influence-needs-basis", "basis")
    } else if has("joins two atlas entries") {
        ("influence-needs-atlas", "relationship")
    } else if has("`transition.basis`") {
        ("bad-basis", "basis")
    } else if has("no required step before this one") {
        ("nothing-to-follow", "steps")
    } else {
        ("bad-value", "")
    }
}

/// The first backticked name of a message with its dots and brackets cut off: `\`evidence[2].link\`` is
/// `evidence`, the field a form shows the problem on.
fn leading_field(message: &str) -> &str {
    let Some(rest) = message.strip_prefix('`') else {
        return "";
    };
    let name = rest.split('`').next().unwrap_or("");
    name.split(['.', '[']).next().unwrap_or("")
}

/// The `(code, field)` of a comparison problem from its message (G98).
pub fn comparison_problem(message: &str) -> (&'static str, &str) {
    let has = |part: &str| message.contains(part);
    let field = leading_field(message);
    let long = has("characters") && !has("lowercase slug");
    if has("a comparison file is `") {
        ("bad-address", "")
    } else if has("`title` is required") {
        ("required", "title")
    } else if has("`id` is a lowercase slug") {
        ("bad-address", "id")
    } else if has("`id` is used by an earlier") {
        ("duplicate-id", "id")
    } else if has("names this interpretation itself")
        || has("names this explanation itself")
        || has("is not related to itself")
        || has("leads back to this interpretation")
    {
        ("self-relation", field)
    } else if has("is not a source id")
        || has("is not an evidence link id")
        || has("is not in the research library")
        || has("names no interpretation")
        || has("names no explanation")
        || has("name interpretations of this comparison")
    {
        ("unknown-reference", field)
    } else if has("an explanation adds no evidence of its own") {
        ("explanation-evidence", "evidence")
    } else if has("`approval") || has("add an `approval`") {
        ("approval-added", "approval")
    } else if has("judg") {
        ("judgement-field", field)
    } else if has("is over") && has("bytes") {
        ("too-large", "")
    } else if long || has("at most") || has("holds at most") {
        (
            if has("characters") {
                "too-long"
            } else {
                "too-many"
            },
            field,
        )
    } else if has("is required") {
        ("required", field)
    } else {
        ("bad-value", field)
    }
}

#[cfg(test)]
mod tests {
    use super::{comparison_problem, path_problem};

    #[test]
    fn the_messages_a_comparison_makes_each_have_their_code() {
        for (message, code, field) in [
            ("`title` is required", "required", "title"),
            ("`id` is a lowercase slug of at most 64 characters", "bad-address", "id"),
            ("`id` is used by an earlier item", "duplicate-id", "id"),
            ("`attribution.source` is not a source id", "unknown-reference", "attribution"),
            ("`translationOf` names this interpretation itself", "self-relation", "translationOf"),
            ("an interpretation is not related to itself", "self-relation", ""),
            ("`about` names no interpretation of this comparison", "unknown-reference", "about"),
            ("`evidence` cites something no interpretation it explains cites; an explanation adds no evidence of its own", "explanation-evidence", "evidence"),
            ("`approval.digest` is not this text's: it changed after it was approved, so approve it again", "approval-added", "approval"),
            ("an AI draft is published only after a person approves it: add an `approval`", "approval-added", "approval"),
            ("`evidence[2].link` is not an evidence link id", "unknown-reference", "evidence"),
            ("`statement` is over 4000 characters", "too-long", "statement"),
            ("a translation says its `language`", "bad-value", ""),
        ] {
            assert_eq!(comparison_problem(message), (code, field), "{message}");
        }
    }

    #[test]
    fn the_messages_the_core_makes_each_have_their_code() {
        for (message, code, field) in [
            ("`title` is required", "required", "title"),
            ("has 99 steps; a path holds at most 40", "too-many", "steps"),
            (
                "a published path has at least two steps",
                "nothing-to-follow",
                "steps",
            ),
            (
                "`id` is a lowercase slug of at most 64 characters",
                "bad-address",
                "id",
            ),
            ("`id` is used by an earlier step", "duplicate-id", "id"),
            ("`slug` is not a post slug", "unknown-reference", "target"),
            (
                "points at the same post as step `a`; a path never returns to a step",
                "repeat-target",
                "target",
            ),
            (
                "the first step is where every reader starts, so it cannot be optional",
                "first-optional",
                "optional",
            ),
            (
                "the first step has no earlier step to follow, so it has no transition",
                "first-has-reason",
                "why",
            ),
            (
                "a published path explains every step after the first: add a transition",
                "needs-relationship",
                "relationship",
            ),
            (
                "`transition.why` is required: say why this step follows",
                "needs-reason",
                "why",
            ),
            (
                "`transition.basis` is not an atlas relationship id",
                "bad-basis",
                "basis",
            ),
            (
                "`influenced` needs `basis`, a published atlas relationship that states it",
                "influence-needs-basis",
                "basis",
            ),
            (
                "`influenced` joins two atlas entries, because only the atlas states influence",
                "influence-needs-atlas",
                "relationship",
            ),
            (
                "`transition.basis` belongs to `influenced` only",
                "bad-basis",
                "basis",
            ),
            (
                "choose how this step relates to the step it follows and say why in your own words",
                "needs-relationship",
                "relationship",
            ),
            (
                "there is no required step before this one to follow",
                "nothing-to-follow",
                "steps",
            ),
            ("something nobody foresaw", "bad-value", ""),
        ] {
            assert_eq!(path_problem(message), (code, field), "{message}");
        }
    }
}
