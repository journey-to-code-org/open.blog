//! Validation of authored decision records, independent of diagram rendering.

use pulldown_cmark::{Event, HeadingLevel, Parser, Tag, TagEnd};

use crate::frontmatter::{FrontMatter, Value};

pub const STARTER: &str = "## Context

### Before

## Options considered

## Decision

## Consequences

### After

";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    Proposed,
    Accepted,
    Superseded,
}

impl Status {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Proposed => "proposed",
            Self::Accepted => "accepted",
            Self::Superseded => "superseded",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Decision {
    pub status: Status,
    /// An authored site-relative URL, to be resolved against published content.
    pub superseded_by: Option<String>,
}

const SECTIONS: [&str; 4] = ["Context", "Options considered", "Decision", "Consequences"];

/// Check the record's own metadata and sections; site-wide successor resolution is separate.
pub fn parse(front_matter: &FrontMatter, body: &str) -> Result<Decision, Vec<String>> {
    let mut problems = Vec::new();
    let status = match front_matter.fields.get("decisionStatus") {
        Some(Value::Scalar(status)) => match status.trim() {
            "proposed" => Some(Status::Proposed),
            "accepted" => Some(Status::Accepted),
            "superseded" => Some(Status::Superseded),
            _ => None,
        },
        _ => None,
    };
    if status.is_none() {
        problems.push("decisionStatus must be proposed, accepted or superseded".to_string());
    }
    let successor = match front_matter.fields.get("supersededBy") {
        None => None,
        Some(Value::Scalar(value)) if value.trim().is_empty() => None,
        Some(Value::Scalar(value))
            if value.starts_with('/')
                && !value.starts_with("//")
                && !value.contains(['\\', '?', '#'])
                && crate::contributor::safe_profile_url(value) =>
        {
            Some(value.clone())
        }
        Some(_) => {
            problems.push("supersededBy must be a site-relative content path".to_string());
            None
        }
    };
    if status == Some(Status::Superseded) && successor.is_none() {
        problems.push("a superseded decision needs supersededBy".to_string());
    }
    if status.is_some_and(|status| status != Status::Superseded) && successor.is_some() {
        problems.push("supersededBy is only allowed on a superseded decision".to_string());
    }
    let mut found = [false; 4];
    let mut nonempty = [false; 4];
    let mut current = None;
    let mut heading: Option<(HeadingLevel, String, bool)> = None;
    let mut container_depth = 0usize;
    let mut code = false;
    for event in Parser::new_ext(body, crate::markdown::parser_options(false)) {
        match event {
            Event::Start(Tag::Heading { level, .. }) => {
                heading = Some((level, String::new(), container_depth == 0));
            }
            Event::End(TagEnd::Heading(_)) if heading.is_some() => {
                let (level, text, top_level) = heading.take().expect("heading is open");
                if top_level && level == HeadingLevel::H2 {
                    current = SECTIONS.iter().position(|name| text.trim() == *name);
                    if let Some(index) = current {
                        if found[index] {
                            problems.push(format!(
                                "decision has more than one `## {}`",
                                SECTIONS[index]
                            ));
                        }
                        found[index] = true;
                    }
                } else if top_level && level == HeadingLevel::H1 {
                    current = None;
                }
            }
            Event::Start(Tag::CodeBlock(_)) => code = true,
            Event::End(TagEnd::CodeBlock) => code = false,
            Event::Start(Tag::BlockQuote(_) | Tag::Item | Tag::FootnoteDefinition(_)) => {
                container_depth += 1;
            }
            Event::End(TagEnd::BlockQuote(_) | TagEnd::Item | TagEnd::FootnoteDefinition) => {
                container_depth = container_depth.saturating_sub(1);
            }
            Event::Text(text) | Event::Code(text) => {
                if let Some((_, name, _)) = heading.as_mut() {
                    name.push_str(&text);
                } else if !code && !text.trim().is_empty() {
                    if let Some(index) = current {
                        nonempty[index] = true;
                    }
                }
            }
            _ => {}
        }
    }
    for (index, section) in SECTIONS.iter().enumerate() {
        if !found[index] {
            problems.push(format!("decision needs a `## {section}` section"));
        } else if !nonempty[index] {
            problems.push(format!("decision's `## {section}` section needs text"));
        }
    }
    match (status, problems.is_empty()) {
        (Some(status), true) => Ok(Decision {
            status,
            superseded_by: successor,
        }),
        _ => Err(problems),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::frontmatter;
    const COMPLETE: &str = "## Context\n\nA problem.\n\n## Options considered\n\nTwo choices.\n\n## Decision\n\nThe first.\n\n## Consequences\n\nA trade-off.\n";

    fn document(fields: &str, body: &str) -> frontmatter::Document {
        frontmatter::parse(&format!("---\n{fields}\n---\n{body}")).unwrap()
    }

    #[test]
    fn accepts_complete_record_and_supersession() {
        let doc = document(
            "decisionStatus: superseded\nsupersededBy: /posts/new/",
            COMPLETE,
        );
        assert_eq!(
            parse(&doc.front_matter, &doc.body),
            Ok(Decision {
                status: Status::Superseded,
                superseded_by: Some("/posts/new/".into())
            })
        );
    }

    #[test]
    fn reports_bad_status_successor_and_sections() {
        let doc = document(
            "decisionStatus: superseded\nsupersededBy: //example.test",
            "## Context\n\n> ## Decision\n\n```\n## Options considered\n```\n",
        );
        let errors = parse(&doc.front_matter, &doc.body).unwrap_err();
        assert!(errors.iter().any(|error| error.contains("site-relative")));
        assert!(errors
            .iter()
            .any(|error| error.contains("needs supersededBy")));
        for section in SECTIONS {
            assert!(
                errors.iter().any(|error| error.contains(section)),
                "{section}"
            );
        }
    }

    #[test]
    fn rejects_duplicate_sections_and_inappropriate_successors() {
        let doc = document(
            "decisionStatus: accepted\nsupersededBy: /posts/new/",
            &format!("{COMPLETE}\n## Context\nAnother context."),
        );
        let errors = parse(&doc.front_matter, &doc.body).unwrap_err();
        assert!(errors.iter().any(|error| error.contains("only allowed")));
        assert!(errors.iter().any(|error| error.contains("more than one")));
    }
}
