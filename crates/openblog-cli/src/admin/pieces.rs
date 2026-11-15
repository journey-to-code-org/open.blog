//! `POST /admin/api/pieces` (ADR 0253; Studio R6 G44–G45): check one thing a form wants to put in
//! a post and return the Markdown that holds it, or what is wrong with it.
//!
//! The engine is the only place a piece, a before and after pair, a question for readers or a code
//! block is checked, so a form can never write one the build refuses. Each problem carries a short
//! `code`, the `field` it is about and, for repeated rows, the `item` (from 0), so a screen can say
//! it in its own words beside the right box. The engine's sentence stays as `message`; the old
//! Admin keeps reading `problems` as sentences until it is retired (R15).

use openblog_core::piece::{self, Piece};
use serde_json::{json, Value as Json};

/// The kind for a question for readers (a `quiz` fence).
pub(super) const QUIZ: &str = "quiz";
/// The kind for a code block (a fenced code block with options).
pub(super) const CODE: &str = "code";
const MAX_TITLE_CHARS: usize = 120;
const MAX_LANGUAGE_CHARS: usize = 32;

/// One thing wrong with what a form sent.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct Problem {
    pub field: Option<String>,
    pub item: Option<usize>,
    pub code: &'static str,
    pub max: Option<usize>,
    pub message: String,
}

impl Problem {
    fn new(field: Option<&str>, code: &'static str, message: impl Into<String>) -> Self {
        Self {
            field: field.map(str::to_string),
            item: None,
            code,
            max: None,
            message: message.into(),
        }
    }

    fn json(&self) -> Json {
        let mut out = json!({ "code": self.code, "message": self.message });
        if let Some(field) = &self.field {
            out["field"] = json!(field);
        }
        if let Some(item) = self.item {
            out["item"] = json!(item);
        }
        if let Some(max) = self.max {
            out["max"] = json!(max);
        }
        out
    }
}

/// The 422 answer: the sentences as before, and the coded problems as `issues`.
pub(super) fn refusal(problems: &[Problem]) -> Json {
    json!({
        "error": "Check the highlighted details",
        "code": problems.first().map_or("invalid", |p| p.code),
        "problems": problems.iter().map(|p| p.message.clone()).collect::<Vec<_>>(),
        "issues": problems.iter().map(Problem::json).collect::<Vec<_>>(),
    })
}

/// The Markdown for `kind` with `values`, or every problem found.
pub(super) fn build(kind: &str, values: &[(String, String)]) -> Result<String, Vec<Problem>> {
    match kind {
        openblog_core::compare::FENCE => openblog_core::compare::from_values(values)
            .map(|pair| pair.to_markdown())
            .map_err(|found| classify_all(None, &found)),
        QUIZ => quiz(values),
        CODE => code(values),
        _ => built_piece(kind, values),
    }
}

fn built_piece(kind: &str, values: &[(String, String)]) -> Result<String, Vec<Problem>> {
    let Some(schema) = piece::schema(kind) else {
        return Err(vec![Problem::new(
            None,
            "unknown-kind",
            "That is not something this release can add",
        )]);
    };
    let found = match Piece::from_values(kind, values) {
        Ok(piece) => return Ok(piece.to_markdown()),
        Err(found) => found,
    };
    let list: Vec<&str> = schema
        .list
        .as_ref()
        .map_or_else(Vec::new, |l| l.fields.iter().map(|f| f.name).collect());
    let first = list.first().copied();
    let in_list = |p: &Problem| p.field.as_deref().is_some_and(|f| list.contains(&f));
    let whole = classify_all(first, &found);
    if list.is_empty() {
        return Err(whole);
    }
    // Rows: check each on its own, so a problem names the row it is in.
    let top: Vec<(String, String)> = values
        .iter()
        .filter(|(name, _)| !list.contains(&name.as_str()))
        .cloned()
        .collect();
    let mut rows: Vec<Vec<(String, String)>> = Vec::new();
    for (name, value) in values.iter().filter(|(n, _)| list.contains(&n.as_str())) {
        if Some(name.as_str()) == first || rows.is_empty() {
            rows.push(Vec::new());
        }
        if let Some(row) = rows.last_mut() {
            row.push((name.clone(), value.clone()));
        }
    }
    let mut out: Vec<Problem> = whole
        .iter()
        .filter(|p| !in_list(p) || matches!(p.code, "too-many") || rows.is_empty())
        .cloned()
        .collect();
    for (index, row) in rows.iter().enumerate() {
        let mut one = top.clone();
        one.extend(row.iter().cloned());
        if let Err(found) = Piece::from_values(kind, &one) {
            for mut problem in classify_all(first, &found).into_iter().filter(in_list) {
                problem.item = Some(index);
                out.push(problem);
            }
        }
    }
    // A row problem the per-row check can't see (one given twice) stays, without its row.
    for problem in whole.into_iter().filter(in_list) {
        if !out
            .iter()
            .any(|p| p.field == problem.field && p.code == problem.code)
        {
            out.push(problem);
        }
    }
    let mut seen = Vec::new();
    out.retain(|p| {
        let key = (p.field.clone(), p.item, p.code, p.message.clone());
        let fresh = !seen.contains(&key);
        seen.push(key);
        fresh
    });
    Err(out)
}

fn classify_all(first_list_field: Option<&str>, found: &[String]) -> Vec<Problem> {
    found
        .iter()
        .map(|message| classify(first_list_field, message))
        .collect()
}

/// A field name, only when it is a plain name (never echo what was sent).
fn plain_name(name: &str) -> Option<&str> {
    let plain = (1..=40).contains(&name.len())
        && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-');
    plain.then_some(name)
}

/// A field name the engine put in backticks at the start of a sentence, and the rest of it.
fn quoted_name(message: &str) -> Option<(&str, &str)> {
    let rest = message.strip_prefix('`')?;
    let (name, after) = rest.split_once('`')?;
    Some((plain_name(name)?, after))
}

/// The field a landing check names in words ("button label"), as the form's field name.
fn field_named(words: &str) -> Option<&'static str> {
    Some(match words {
        "button label" | "label" | "link label" => "label",
        "button address" | "link address" => "href",
        "image address" => "src",
        "the image description (alt text)" => "alt",
        "caption" => "caption",
        "video title" | "title" => "title",
        "days" => "days",
        "hours" => "hours",
        "note" => "note",
        "email" => "email",
        "phone" => "phone",
        "address" => "address",
        "question" => "question",
        "an answer" => "answer",
        "the text" => "body",
        _ => return None,
    })
}

fn number_after(message: &str, marker: &str) -> Option<usize> {
    let at = message.find(marker)? + marker.len();
    let digits: String = message[at..]
        .chars()
        .take_while(char::is_ascii_digit)
        .collect();
    digits.parse().ok()
}

/// The engine's sentence as a coded problem. Every sentence the piece, pair and landing checks
/// can say has a code here (a test walks them); anything new falls back to `invalid`.
fn classify(first_list_field: Option<&str>, message: &str) -> Problem {
    let coded = |field: Option<&str>, code: &'static str| Problem::new(field, code, message);
    if let Some((name, after)) = quoted_name(message) {
        let field = Some(name);
        let mut problem = if after.starts_with(" is not a field") {
            coded(field, "unknown-field")
        } else if after.starts_with(" is not a piece") {
            coded(None, "unknown-kind")
        } else if after.starts_with(": HTML tags") {
            coded(field, "html")
        } else if after.starts_with(" is given more than once")
            || after.starts_with(" is given twice")
            || after.starts_with(" is written twice")
        {
            coded(field, "repeated")
        } else if after.starts_with(" must be one of") {
            coded(field, "bad-choice")
        } else if after.starts_with(" is required") {
            coded(field, "required")
        } else if after.starts_with(" must be a number") {
            coded(field, "out-of-range")
        } else if after.starts_with(" must be on one line") || after.starts_with(" has a control") {
            coded(field, "one-line")
        } else if after.starts_with(" is longer than") {
            coded(field, "too-long")
        } else {
            coded(field, "invalid")
        };
        if problem.code == "too-long" {
            problem.max = number_after(message, " is longer than ");
        }
        return problem;
    }
    for side in ["before", "after"] {
        if message.starts_with(&format!("the {side} picture is missing")) {
            return coded(Some(side), "required");
        }
        if message.starts_with(&format!("the {side} picture's address")) {
            return coded(Some(side), "bad-address");
        }
        if message.starts_with(&format!("the {side} picture needs a description")) {
            return coded(Some(&format!("{side}-alt")), "required");
        }
    }
    let exact: &[(&str, &str, &'static str)] = &[
        ("the video id is not", "video", "bad-video"),
        ("lat must be", "lat", "out-of-range"),
        ("lon must be", "lon", "out-of-range"),
        (
            "add an email, a phone number or an address",
            "email",
            "required",
        ),
        ("email is not an email address", "email", "bad-email"),
        ("phone holds only", "phone", "bad-phone"),
        ("every question needs an answer", "answer", "required"),
        ("the call-out needs some text", "body", "required"),
    ];
    for (start, field, code) in exact {
        if message.starts_with(start) {
            return coded(Some(field), code);
        }
    }
    if message.starts_with("add at least one ") {
        return coded(first_list_field, "required");
    }
    if message.starts_with("has ") && message.contains("; the most is ") {
        let mut problem = coded(first_list_field, "too-many");
        problem.max = number_after(message, "; the most is ");
        return problem;
    }
    if let Some((words, _)) = message.split_once(" is required") {
        if let Some(field) = field_named(words) {
            return coded(Some(field), "required");
        }
    }
    if let Some((words, _)) = message.split_once(" characters; the most is ") {
        if let Some(field) = words.rsplit_once(" is ").and_then(|(w, _)| field_named(w)) {
            let mut problem = coded(Some(field), "too-long");
            problem.max = number_after(message, " characters; the most is ");
            return problem;
        }
    }
    if let Some((words, _)) = message.split_once(" must be one line of plain text") {
        if let Some(field) = field_named(words) {
            return coded(Some(field), "one-line");
        }
    }
    if let Some((words, _)) = message.split_once(" contains a character that cannot be saved") {
        if let Some(field) = field_named(words) {
            return coded(Some(field), "one-line");
        }
    }
    if let Some((words, _)) = message.split_once(": ") {
        if let Some(field) = field_named(words) {
            return coded(Some(field), "bad-address");
        }
    }
    coded(None, "invalid")
}

/// Shared checks for the forms the engine has no schema for: known names, one line each, no
/// three backticks in a row (they would end the fence).
fn plain_values(
    values: &[(String, String)],
    known: &[&str],
    multiline: &[&str],
    problems: &mut Vec<Problem>,
) {
    for (name, value) in values {
        if !known.contains(&name.as_str()) {
            let field = plain_name(name);
            problems.push(Problem::new(
                field,
                "unknown-field",
                format!(
                    "`{}` is not a field of this form",
                    field.unwrap_or("that field")
                ),
            ));
        } else if value.contains("```") {
            problems.push(Problem::new(
                Some(name),
                "backticks",
                format!("`{name}` can't hold three backticks in a row"),
            ));
        } else if !multiline.contains(&name.as_str()) && value.contains(['\n', '\r']) {
            problems.push(Problem::new(
                Some(name),
                "one-line",
                format!("`{name}` must be on one line"),
            ));
        }
    }
    for name in known.iter().filter(|n| **n != "answer") {
        if values.iter().filter(|(n, _)| n == name).count() > 1 {
            problems.push(Problem::new(
                Some(name),
                "repeated",
                format!("`{name}` is given more than once"),
            ));
        }
    }
}

fn value<'v>(values: &'v [(String, String)], name: &str) -> &'v str {
    values
        .iter()
        .find(|(n, _)| n == name)
        .map_or("", |(_, v)| v.trim())
}

/// A question for readers: `question`, two to four `answer`s, `right` (which answer, from 1) and an
/// optional `explanation`. Written as the `quiz` fence the build reads, then read back by the build.
fn quiz(values: &[(String, String)]) -> Result<String, Vec<Problem>> {
    let mut problems = Vec::new();
    plain_values(
        values,
        &["question", "answer", "right", "explanation"],
        &[],
        &mut problems,
    );
    let question = value(values, "question");
    if question.is_empty() {
        problems.push(Problem::new(
            Some("question"),
            "required",
            "`question` is required",
        ));
    }
    let answers: Vec<&str> = values
        .iter()
        .filter(|(n, _)| n == "answer")
        .map(|(_, v)| v.trim())
        .collect();
    for (index, answer) in answers.iter().enumerate() {
        if answer.is_empty() {
            let mut problem = Problem::new(Some("answer"), "required", "`answer` is required");
            problem.item = Some(index);
            problems.push(problem);
        }
    }
    if answers.len() < 2 {
        problems.push(Problem::new(
            Some("answer"),
            "required",
            "a question for readers needs at least two answers",
        ));
    } else if answers.len() > 4 {
        let mut problem = Problem::new(
            Some("answer"),
            "too-many",
            "a question for readers has at most four answers",
        );
        problem.max = Some(4);
        problems.push(problem);
    }
    let right = value(values, "right")
        .parse::<usize>()
        .ok()
        .filter(|n| (1..=answers.len()).contains(n));
    if right.is_none() {
        problems.push(Problem::new(
            Some("right"),
            "bad-choice",
            "`right` must be the number of one of the answers",
        ));
    }
    if !problems.is_empty() {
        return Err(problems);
    }
    let right = right.unwrap_or(1);
    let mut lines = vec!["```quiz".to_string(), question.to_string()];
    for (index, answer) in answers.iter().enumerate() {
        let mark = if index + 1 == right { "x" } else { " " };
        lines.push(format!("- [{mark}] {answer}"));
    }
    let explanation = value(values, "explanation");
    if !explanation.is_empty() {
        lines.push(format!("> {explanation}"));
    }
    lines.push("```".into());
    let markdown = lines.join("\n") + "\n";
    let body = &markdown["```quiz\n".len()..markdown.len() - "```\n".len()];
    match openblog_core::markdown::quiz_problem(body) {
        None => Ok(markdown),
        Some(message) => {
            let code = if message.contains("supports only") {
                "links"
            } else {
                "invalid"
            };
            Err(vec![Problem::new(None, code, message)])
        }
    }
}

/// A code block: `body`, and the options `language`, `title`, `highlight` (like `2,4-6`),
/// `lineNumbers` (`on`, `off`, a starting number, or empty for the site's default) and `runnable`
/// (`true`). The fence is one backtick longer than any run of backticks inside.
fn code(values: &[(String, String)]) -> Result<String, Vec<Problem>> {
    let mut problems = Vec::new();
    let known = [
        "language",
        "title",
        "highlight",
        "lineNumbers",
        "runnable",
        "body",
    ];
    for (name, value) in values {
        if !known.contains(&name.as_str()) {
            let field = plain_name(name);
            problems.push(Problem::new(
                field,
                "unknown-field",
                "That is not a field of a code block",
            ));
        } else if name != "body" && value.contains(['\n', '\r']) {
            problems.push(Problem::new(
                Some(name),
                "one-line",
                format!("`{name}` must be on one line"),
            ));
        }
    }
    for name in known {
        if values.iter().filter(|(n, _)| n == name).count() > 1 {
            problems.push(Problem::new(
                Some(name),
                "repeated",
                format!("`{name}` is given more than once"),
            ));
        }
    }
    let language = value(values, "language").to_ascii_lowercase();
    if !language.is_empty()
        && openblog_core::config::normalize_code_runner_language(&language).is_none()
    {
        let mut problem = Problem::new(
            Some("language"),
            "bad-choice",
            "a language is one word of letters and digits, like rust",
        );
        problem.max = Some(MAX_LANGUAGE_CHARS);
        problems.push(problem);
    }
    let title = value(values, "title");
    if title.contains(['"', '\'']) {
        problems.push(Problem::new(
            Some("title"),
            "bad-choice",
            "a code block's title can't hold quotation marks",
        ));
    }
    if title.chars().count() > MAX_TITLE_CHARS {
        let mut problem = Problem::new(Some("title"), "too-long", "the title is too long");
        problem.max = Some(MAX_TITLE_CHARS);
        problems.push(problem);
    }
    let highlight: String = value(values, "highlight")
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect();
    let ranges = highlight.split(',').all(|range| {
        let mut ends = range.splitn(2, '-');
        let good = |part: Option<&str>| {
            part.is_some_and(|p| {
                !p.is_empty() && p.len() <= 6 && p.bytes().all(|b| b.is_ascii_digit())
            })
        };
        good(ends.next()) && ends.next().is_none_or(|end| good(Some(end)))
    });
    if !highlight.is_empty() && !ranges {
        problems.push(Problem::new(
            Some("highlight"),
            "bad-lines",
            "highlighted lines look like 2,4-6",
        ));
    }
    let line_numbers = match value(values, "lineNumbers") {
        "" | "auto" => Some(String::new()),
        "on" => Some(" showLineNumbers".into()),
        "off" => Some(" showLineNumbers=false".into()),
        n => n
            .parse::<u32>()
            .ok()
            .map(|n| format!(" showLineNumbers={n}")),
    };
    if line_numbers.is_none() {
        problems.push(Problem::new(
            Some("lineNumbers"),
            "bad-choice",
            "line numbers are on, off, a starting number, or left to the site",
        ));
    }
    let runnable = match value(values, "runnable") {
        "" | "false" => false,
        "true" => true,
        _ => {
            problems.push(Problem::new(
                Some("runnable"),
                "bad-choice",
                "`runnable` is true or false",
            ));
            false
        }
    };
    let body = values
        .iter()
        .find(|(n, _)| n == "body")
        .map_or("", |(_, v)| v.as_str())
        .trim_end_matches(['\n', '\r']);
    if body.trim().is_empty() {
        problems.push(Problem::new(Some("body"), "required", "`body` is required"));
    }
    if !problems.is_empty() {
        return Err(problems);
    }
    let mut info =
        if language.is_empty() && (runnable || !title.is_empty() || !highlight.is_empty()) {
            "text".to_string()
        } else {
            language.clone()
        };
    if runnable {
        info.push_str(" runnable");
    }
    if !title.is_empty() {
        info.push_str(&format!(" title=\"{title}\""));
    }
    if !highlight.is_empty() {
        info.push_str(&format!(" {{{highlight}}}"));
    }
    info.push_str(line_numbers.as_deref().unwrap_or(""));
    let info = info.trim_start().to_string();
    let mut longest = 2;
    let mut run = 0;
    for c in body.chars() {
        run = if c == '`' { run + 1 } else { 0 };
        longest = longest.max(run);
    }
    let fence = "`".repeat(longest + 1);
    // Read back the way the build reads it: what the form asked for is what the build sees.
    let read = openblog_core::markdown::code_fence_summary(&info);
    let wanted_title = (!title.is_empty()).then(|| title.to_string());
    let wanted_highlight = (!highlight.is_empty()).then(|| highlight.clone());
    if read.title != wanted_title || read.highlight != wanted_highlight || read.runnable != runnable
    {
        return Err(vec![Problem::new(
            None,
            "invalid",
            "the build would read these options differently",
        )]);
    }
    Ok(format!("{fence}{info}\n{body}\n{fence}\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pairs(list: &[(&str, &str)]) -> Vec<(String, String)> {
        list.iter()
            .map(|(n, v)| ((*n).to_string(), (*v).to_string()))
            .collect()
    }

    #[test]
    fn every_sentence_the_engine_says_has_a_code() {
        let cases: &[(&str, &[(&str, &str)])] = &[
            ("button", &[("label", ""), ("href", "javascript:x")]),
            ("button", &[("label", &"x".repeat(200)), ("href", "/a/")]),
            ("button", &[("label", "a\u{7}b"), ("href", "http://a.b")]),
            (
                "button",
                &[("label", "Go"), ("href", "/a/"), ("style", "loud")],
            ),
            (
                "button",
                &[("label", "Go"), ("label", "Again"), ("href", "/")],
            ),
            ("image", &[("src", ""), ("alt", "")]),
            (
                "video",
                &[("provider", "youtube"), ("video", "nope"), ("title", "")],
            ),
            ("video", &[("video", "dQw4w9WgXcQ"), ("title", "x")]),
            (
                "map",
                &[
                    ("provider", "openstreetmap"),
                    ("label", "x"),
                    ("lat", "95"),
                    ("lon", "east"),
                ],
            ),
            ("hours", &[]),
            (
                "hours",
                &[
                    ("days", ""),
                    ("hours", "9-5"),
                    ("days", "Sat"),
                    ("days", "Sun"),
                ],
            ),
            ("contact", &[]),
            ("contact", &[("email", "nope"), ("phone", "call me")]),
            ("social", &[("label", "Facebook"), ("href", "/local/")]),
            ("faq", &[("question", "Why?"), ("answer", " ")]),
            (
                "callout",
                &[("tone", "info"), ("body", ""), ("title", "<b>")],
            ),
            ("button", &[("colour", "red")]),
            (
                "compare",
                &[
                    ("before", ""),
                    ("after", "javascript:x"),
                    ("after-alt", "x\ny"),
                ],
            ),
            ("compare", &[("middle", "x")]),
        ];
        for (kind, values) in cases {
            let problems = build(kind, &pairs(values)).unwrap_err();
            assert!(!problems.is_empty(), "{kind}");
            for problem in &problems {
                assert_ne!(problem.code, "invalid", "{kind}: {}", problem.message);
            }
        }
    }

    #[test]
    fn a_problem_names_its_field_its_row_and_its_limit() {
        let problems = build(
            "faq",
            &pairs(&[
                ("question", "Can I freeze it?"),
                ("answer", "Yes."),
                ("question", ""),
                ("answer", "No."),
            ]),
        )
        .unwrap_err();
        assert_eq!(problems.len(), 1, "{problems:?}");
        assert_eq!(problems[0].field.as_deref(), Some("question"));
        assert_eq!(problems[0].item, Some(1));
        assert_eq!(problems[0].code, "required");
        let long = build(
            "callout",
            &pairs(&[
                ("tone", "success"),
                ("title", &"x".repeat(81)),
                ("body", "Hi"),
            ]),
        )
        .unwrap_err();
        assert_eq!(long[0].field.as_deref(), Some("title"));
        assert_eq!(long[0].code, "too-long");
        assert_eq!(long[0].max, Some(60));
        let video = build(
            "video",
            &pairs(&[
                ("provider", "youtube"),
                ("video", "https://example.com/x"),
                ("title", "Pie"),
            ]),
        )
        .unwrap_err();
        assert_eq!(
            (video[0].field.as_deref(), video[0].code),
            (Some("video"), "bad-video")
        );
    }

    #[test]
    fn a_question_for_readers_is_written_the_way_the_build_reads_it() {
        let markdown = build(
            QUIZ,
            &pairs(&[
                ("question", "What goes in first?"),
                ("answer", "Butter"),
                ("answer", "Flour"),
                ("right", "2"),
                ("explanation", "Flour, then *butter*."),
            ]),
        )
        .unwrap();
        assert_eq!(
            markdown,
            "```quiz\nWhat goes in first?\n- [ ] Butter\n- [x] Flour\n> Flour, then *butter*.\n```\n"
        );
        let codes = |values: &[(&str, &str)]| {
            build(QUIZ, &pairs(values))
                .unwrap_err()
                .iter()
                .map(|p| (p.field.clone().unwrap_or_default(), p.code))
                .collect::<Vec<_>>()
        };
        assert_eq!(
            codes(&[
                ("question", ""),
                ("answer", "a"),
                ("answer", ""),
                ("right", "3")
            ]),
            vec![
                ("question".to_string(), "required"),
                ("answer".to_string(), "required"),
                ("right".to_string(), "bad-choice")
            ]
        );
        assert_eq!(
            codes(&[
                ("question", "Q ``` x"),
                ("answer", "a"),
                ("answer", "b"),
                ("right", "1")
            ]),
            vec![("question".to_string(), "backticks")]
        );
        assert_eq!(
            codes(&[
                ("question", "See [this](https://a.b)"),
                ("answer", "a"),
                ("answer", "b"),
                ("right", "1")
            ]),
            vec![(String::new(), "links")]
        );
    }

    #[test]
    fn a_code_block_is_written_with_its_options_and_a_long_enough_fence() {
        let markdown = build(
            CODE,
            &pairs(&[
                ("language", "Rust"),
                ("title", "src/main.rs"),
                ("highlight", "2, 4-6"),
                ("lineNumbers", "10"),
                ("body", "fn main() {\n    // ```\n}\n"),
            ]),
        )
        .unwrap();
        assert_eq!(
            markdown,
            "````rust title=\"src/main.rs\" {2,4-6} showLineNumbers=10\nfn main() {\n    // ```\n}\n````\n"
        );
        assert_eq!(
            build(CODE, &pairs(&[("body", "plain")])).unwrap(),
            "```\nplain\n```\n"
        );
        assert_eq!(
            build(
                CODE,
                &pairs(&[("runnable", "true"), ("lineNumbers", "off"), ("body", "x")])
            )
            .unwrap(),
            "```text runnable showLineNumbers=false\nx\n```\n"
        );
        let refused = build(
            CODE,
            &pairs(&[
                ("highlight", "2,x"),
                ("title", "a\"b"),
                ("lineNumbers", "lots"),
                ("body", " "),
            ]),
        )
        .unwrap_err();
        let codes: Vec<_> = refused.iter().map(|p| p.code).collect();
        assert_eq!(
            codes,
            vec!["bad-choice", "bad-lines", "bad-choice", "required"]
        );
    }
}
