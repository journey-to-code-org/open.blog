//! The `text-compare` fence: side-by-side textual comparisons of opposing views.
//!
//! ````text
//! ```text-compare title="Two Perspectives on Tradition"
//! perspective-a-label: Conservative View
//! perspective-b-label: Progressive View
//!
//! ### Core Principle
//! perspective-a: Tradition serves as our anchor in turbulent times.
//! perspective-b: Tradition gains its vitality through thoughtful application to contemporary life.
//! ```
//! ````
//!
//! The info string may carry `title="..."`, and a `title:` line in the body works too. Each `###`
//! heading starts a point with one `perspective-a` and one `perspective-b` line. Labels default to
//! "Perspective A" and "Perspective B" and apply to every point. The page gets one `ob-text-compare`
//! element per point, under the title.

use crate::escape::text;
use crate::portability::markdown_text;

/// The capability a `text-compare` fence reports.
pub const CAPABILITY_ID: &str = "textual-comparison";
/// The fence's info string.
pub const FENCE: &str = "text-compare";
/// The custom element that presents one point of the comparison on a page.
pub const ELEMENT: &str = "ob-text-compare";

const MAX_TITLE_CHARS: usize = 100;
const MAX_LABEL_CHARS: usize = 50;
const MAX_LINE_CHARS: usize = 2000;

/// One side of a point in the comparison.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Perspective {
    pub label: String,
    pub content: String,
}

/// One point of the comparison: both perspectives on it, under the fence's title.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TextComparison {
    pub title: String,
    pub heading: Option<String>,
    pub perspective_a: Perspective,
    pub perspective_b: Perspective,
}

impl Default for Perspective {
    fn default() -> Self {
        Self {
            label: "Perspective A".to_string(),
            content: String::new(),
        }
    }
}

/// A point while it is being read: its heading and the lines of each perspective.
#[derive(Default)]
struct Draft {
    heading: Option<String>,
    a: String,
    b: String,
}

impl Draft {
    fn has_lines(&self) -> bool {
        !self.a.is_empty() || !self.b.is_empty()
    }
}

/// Whether an info string opens a `text-compare` fence, with or without a `title="..."`.
pub fn is_fence(info: &str) -> bool {
    info.split_whitespace().next() == Some(FENCE)
}

/// Read and check a fence body. `fence_title` is the `title="..."` from the info string.
/// Every problem is a plain sentence the author can act on.
pub fn parse(source: &str, fence_title: Option<&str>) -> Result<Vec<TextComparison>, Vec<String>> {
    let mut problems = Vec::new();
    let mut title = fence_title.map(|value| value.trim().to_string());
    let mut label_a: Option<String> = None;
    let mut label_b: Option<String> = None;
    let mut points = vec![Draft::default()];

    for line in source.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if line.starts_with('#') {
            let Some(heading) = line
                .strip_prefix("### ")
                .map(str::trim)
                .filter(|value| !value.is_empty())
            else {
                problems.push(
                    "point heading must be written as `### Heading` with a nonempty heading"
                        .to_string(),
                );
                continue;
            };
            let heading = heading.to_string();
            let fresh = points
                .last()
                .is_some_and(|point| point.heading.is_none() && !point.has_lines());
            if !fresh {
                points.push(Draft::default());
            }
            if let Some(point) = points.last_mut() {
                point.heading = Some(heading);
            }
            continue;
        }

        let Some((key, value)) = line.split_once(':') else {
            problems.push(format!(
                "`{line}` is not a heading or a `key: value` line; write lines such as `perspective-a: Your content here`"
            ));
            continue;
        };
        let (key, value) = (key.trim().to_ascii_lowercase(), value.trim());

        match key.as_str() {
            "title" => {
                if title.is_some() {
                    problems.push(
                        "title appears more than once; give it in the fence line or as a title line, not both"
                            .to_string(),
                    );
                } else {
                    title = Some(value.to_string());
                }
            }
            "perspective-a-label" | "perspective-b-label" => {
                let slot = if key == "perspective-a-label" {
                    &mut label_a
                } else {
                    &mut label_b
                };
                let length = value.chars().count();
                if slot.is_some() {
                    problems.push(format!("{key} appears more than once; give each label once"));
                } else if length > MAX_LABEL_CHARS {
                    problems.push(format!(
                        "{key} is too long ({length} characters); maximum is {MAX_LABEL_CHARS}"
                    ));
                } else if slot.is_none() && !value.is_empty() {
                    *slot = Some(value.to_string());
                }
            }
            "perspective-a" | "perspective-b" => {
                if let Some(point) = points.last_mut() {
                    let side = if key == "perspective-a" {
                        &mut point.a
                    } else {
                        &mut point.b
                    };
                    side.push_str(value);
                    side.push('\n');
                }
            }
            _ => problems.push(format!(
                "`{key}` is not a field of textual comparison; use title, perspective-a-label, perspective-b-label, perspective-a, or perspective-b"
            )),
        }
    }

    let title = title.unwrap_or_default();
    if title.is_empty() {
        problems.push(
            "title is required for textual comparisons; add title=\"...\" to the fence line or a title: line"
                .to_string(),
        );
    } else if title.chars().count() > MAX_TITLE_CHARS {
        problems.push(format!(
            "title is too long ({} characters); maximum is {MAX_TITLE_CHARS}",
            title.chars().count()
        ));
    }

    let has_content = points
        .iter()
        .any(|point| point.heading.is_some() || point.has_lines());
    if !has_content {
        problems.push("perspective-a content is required".to_string());
        problems.push("perspective-b content is required".to_string());
    }

    let mut comparisons = Vec::new();
    for point in points {
        if point.heading.is_none() && !point.has_lines() {
            continue;
        }
        let name = point.heading.clone().unwrap_or_else(|| title.clone());
        let (a, b) = (point.a.trim(), point.b.trim());
        for (side, content) in [("perspective-a", a), ("perspective-b", b)] {
            if content.is_empty() {
                problems.push(format!("{side} content is required for \"{name}\""));
            } else if content.chars().count() > MAX_LINE_CHARS {
                problems.push(format!(
                    "{side} content for \"{name}\" is too long ({} characters); maximum is {MAX_LINE_CHARS}",
                    content.chars().count()
                ));
            }
        }
        comparisons.push(TextComparison {
            title: title.clone(),
            heading: point.heading.clone(),
            perspective_a: Perspective {
                label: label_a
                    .clone()
                    .unwrap_or_else(|| "Perspective A".to_string()),
                content: a.to_string(),
            },
            perspective_b: Perspective {
                label: label_b
                    .clone()
                    .unwrap_or_else(|| "Perspective B".to_string()),
                content: b.to_string(),
            },
        });
    }

    if !problems.is_empty() {
        return Err(problems);
    }
    Ok(comparisons)
}

/// Read a fence using metadata parsed from its info string, including duplicate titles.
pub(crate) fn parse_fence(
    source: &str,
    fence_title: Option<&str>,
    title_count: usize,
) -> Result<Vec<TextComparison>, Vec<String>> {
    let duplicate = "title appears more than once in the fence line; give it once".to_string();
    match parse(source, fence_title) {
        Ok(_) if title_count > 1 => Err(vec![duplicate]),
        Err(mut problems) if title_count > 1 => {
            problems.insert(0, duplicate);
            Err(problems)
        }
        result => result,
    }
}

/// The page for a whole fence: its title, then one element per point.
pub fn page_html(title: &str, points: &[TextComparison]) -> String {
    let mut html = format!(
        "<section class=\"ob-text-comparison-group\"><h2>{}</h2>",
        text(title)
    );
    for point in points {
        if let Some(heading) = &point.heading {
            html.push_str(&format!("<h3>{}</h3>", text(heading)));
        }
        html.push_str(&format!(
            r#"<{element} class="ob-text-comparison">
  <div><div class="ob-compare-label">{label_a}</div><div>{content_a}</div></div>
  <div><div class="ob-compare-label">{label_b}</div><div>{content_b}</div></div>
</{element}>"#,
            element = ELEMENT,
            label_a = text(&point.perspective_a.label),
            content_a = text(&point.perspective_a.content),
            label_b = text(&point.perspective_b.label),
            content_b = text(&point.perspective_b.content)
        ));
    }
    html.push_str("</section>\n");
    html
}

/// The Markdown portable copy: the same words as the page, in plain Markdown with no element.
pub fn portable_markdown(title: &str, points: &[TextComparison]) -> String {
    let mut markdown = format!("## {}\n\n", markdown_text(title));
    for point in points {
        if let Some(heading) = &point.heading {
            markdown.push_str(&format!("### {}\n\n", markdown_text(heading)));
        }
        for side in [&point.perspective_a, &point.perspective_b] {
            markdown.push_str(&format!(
                "**{}:** {}\n\n",
                markdown_text(&side.label),
                markdown_text(&side.content)
            ));
        }
    }
    markdown
}

/// The portable copy: the same words as the page, as plain static HTML with no script or element.
pub fn portable_html(title: &str, points: &[TextComparison]) -> String {
    let mut html = format!(
        "<section class=\"ob-text-comparison-group\"><h2>{}</h2>",
        text(title)
    );
    for point in points {
        if let Some(heading) = &point.heading {
            html.push_str(&format!("<h3>{}</h3>", text(heading)));
        }
        for side in [&point.perspective_a, &point.perspective_b] {
            html.push_str(&format!(
                "<div class=\"ob-text-comparison-side\"><p><strong>{}</strong></p><p>{}</p></div>",
                text(&side.label),
                text(&side.content)
            ));
        }
    }
    html.push_str("</section>\n");
    html
}

/// Words a portable copy must keep: the title, headings, labels and both perspectives as written.
pub fn visible_text(title: &str, points: &[TextComparison]) -> Vec<String> {
    let mut words = vec![title.to_string()];
    for point in points {
        if let Some(heading) = &point.heading {
            words.push(heading.clone());
        }
        for side in [&point.perspective_a, &point.perspective_b] {
            words.push(side.label.clone());
            words.push(side.content.clone());
        }
    }
    words
}
