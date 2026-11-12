//! Mermaid source discovery and authoring validation.
//!
//! This module does not render or sanitize SVG. Its output must not be used as
//! evidence that a diagram is safe to publish.

use pulldown_cmark::{CodeBlockKind, Event, Parser, Tag, TagEnd};

const MAX_SOURCE_BYTES: usize = 16 * 1024;
const MAX_OPTION_BYTES: usize = 1024;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Options {
    pub title: Option<String>,
    pub description: Option<String>,
    pub caption: Option<String>,
    pub source: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Diagram {
    pub line: usize,
    pub column: usize,
    pub source: String,
    pub options: Options,
    pub title: String,
    pub description: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Finding {
    pub line: usize,
    pub column: usize,
    pub message: String,
}

/// Read Mermaid fences in source order. Findings refer to the opening fence.
pub fn discover(markdown: &str) -> Vec<Result<Diagram, Finding>> {
    let mut result = Vec::new();
    let mut open: Option<(usize, usize, String, String, bool)> = None;
    let mut starts = vec![0];
    starts.extend(markdown.match_indices('\n').map(|(offset, _)| offset + 1));
    for (event, range) in
        Parser::new_ext(markdown, crate::markdown::parser_options(false)).into_offset_iter()
    {
        match event {
            Event::Start(Tag::CodeBlock(CodeBlockKind::Fenced(info)))
                if info.split_whitespace().next() == Some("mermaid") =>
            {
                let line = starts.partition_point(|start| *start <= range.start);
                let column = markdown[starts[line - 1]..range.start].chars().count() + 1;
                open = Some((line, column, info.to_string(), String::new(), false));
            }
            Event::Text(text) => {
                if let Some((_, _, _, source, oversized)) = &mut open {
                    if text.len() > MAX_SOURCE_BYTES.saturating_sub(source.len()) {
                        *oversized = true;
                    } else if !*oversized {
                        source.push_str(&text);
                    }
                }
            }
            Event::End(TagEnd::CodeBlock) => {
                if let Some((line, column, info, source, oversized)) = open.take() {
                    result.push(if oversized {
                        Err(Finding {
                            line,
                            column,
                            message: format!("diagram source exceeds {MAX_SOURCE_BYTES} bytes"),
                        })
                    } else {
                        validate(line, column, &info, source)
                    });
                }
            }
            _ => {}
        }
    }
    result
}

fn validate(line: usize, column: usize, info: &str, source: String) -> Result<Diagram, Finding> {
    let fail = |message: String| Finding {
        line,
        column,
        message,
    };
    let options = parse_options(info).map_err(fail)?;
    let title = alternative(&source, "accTitle")
        .map_err(fail)?
        .or_else(|| options.title.clone())
        .ok_or_else(|| fail("diagram needs an accTitle or fence title".into()))?;
    let description = alternative(&source, "accDescr")
        .map_err(fail)?
        .or_else(|| options.description.clone())
        .ok_or_else(|| fail("diagram needs an accDescr or fence description".into()))?;
    Ok(Diagram {
        line,
        column,
        source,
        options,
        title,
        description,
    })
}

fn parse_options(info: &str) -> Result<Options, String> {
    let mut rest = info
        .trim()
        .strip_prefix("mermaid")
        .ok_or("expected a mermaid fence")?;
    let mut options = Options::default();
    while !rest.trim_start().is_empty() {
        rest = rest.trim_start();
        let end = rest
            .find(|c: char| c == '=' || c.is_whitespace())
            .unwrap_or(rest.len());
        let key = &rest[..end];
        rest = &rest[end..];
        if !rest.starts_with('=') || key.is_empty() {
            return Err(format!("diagram option `{key}` needs a value"));
        }
        rest = &rest[1..];
        let (value, after) = match rest.chars().next() {
            Some(quote @ ('"' | '\'')) => {
                let inner = &rest[quote.len_utf8()..];
                let end = inner
                    .find(quote)
                    .ok_or_else(|| format!("diagram option `{key}` has an unclosed quote"))?;
                (&inner[..end], &inner[end + quote.len_utf8()..])
            }
            _ => {
                let end = rest.find(char::is_whitespace).unwrap_or(rest.len());
                (&rest[..end], &rest[end..])
            }
        };
        if !after.is_empty() && !after.starts_with(char::is_whitespace) {
            return Err(format!(
                "diagram option `{key}` needs whitespace after its value"
            ));
        }
        rest = after;
        if value.trim().is_empty() || value.len() > MAX_OPTION_BYTES {
            return Err(format!(
                "diagram option `{key}` must be nonempty and at most {MAX_OPTION_BYTES} bytes"
            ));
        }
        let field = match key {
            "title" => &mut options.title,
            "description" => &mut options.description,
            "caption" => &mut options.caption,
            "source" if crate::contributor::safe_profile_url(value) => &mut options.source,
            "source" => {
                return Err(
                    "diagram option `source` must be a safe site path or HTTP(S) URL".into(),
                )
            }
            _ => return Err(format!("unknown diagram option `{key}`")),
        };
        if field.is_some() {
            return Err(format!("diagram option `{key}` is repeated"));
        }
        *field = Some(value.trim().to_owned());
    }
    Ok(options)
}

fn alternative(source: &str, key: &str) -> Result<Option<String>, String> {
    let mut lines = source.lines();
    let mut found = None;
    while let Some(line) = lines.next() {
        let Some(rest) = line.trim().strip_prefix(key) else {
            continue;
        };
        let rest = rest.trim_start();
        let value = if let Some(value) = rest.strip_prefix(':') {
            value.trim().to_owned()
        } else if let Some(value) = rest.strip_prefix('{') {
            let mut value = value.to_owned();
            while !value.contains('}') {
                let next = lines
                    .next()
                    .ok_or_else(|| format!("diagram `{key}` has no closing brace"))?;
                value.push('\n');
                value.push_str(next);
            }
            let end = value.find('}').expect("closing brace was checked");
            if !value[end + 1..].trim().is_empty() {
                return Err(format!("diagram `{key}` has text after its closing brace"));
            }
            value[..end].trim().to_owned()
        } else {
            continue;
        };
        if found.is_some() {
            return Err(format!("diagram `{key}` is repeated"));
        }
        if value.is_empty() || value.len() > MAX_OPTION_BYTES {
            return Err(format!(
                "diagram `{key}` must be nonempty and at most {MAX_OPTION_BYTES} bytes"
            ));
        }
        found = Some(value);
    }
    Ok(found)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_options_alternatives_and_locations() {
        let markdown = "Intro\n\n> ```mermaid title=\"fallback\" description='fallback text' caption=\"Figure one\" source=/diagrams/request.mmd\n> flowchart LR\n> accTitle: Request flow\n> accDescr {\n> A client calls\n> the API.\n> }\n> A --> B\n> ```\n";
        let diagrams = discover(markdown);
        let diagram = diagrams[0].as_ref().unwrap();
        assert_eq!((diagram.line, diagram.column), (3, 3));
        assert_eq!(diagram.title, "Request flow");
        assert_eq!(diagram.description, "A client calls\nthe API.");
        assert_eq!(diagram.options.caption.as_deref(), Some("Figure one"));
        assert_eq!(
            diagram.options.source.as_deref(),
            Some("/diagrams/request.mmd")
        );
    }

    #[test]
    fn falls_back_to_fence_alternatives_and_ignores_other_fences() {
        let markdown = "```rust\nmermaid\n```\n\n```mermaid title=Example description=\"Flow description\"\nflowchart LR\nA --> B\n```\n";
        let diagrams = discover(markdown);
        assert_eq!(diagrams.len(), 1);
        let diagram = diagrams[0].as_ref().unwrap();
        assert_eq!(diagram.title, "Example");
        assert_eq!(diagram.description, "Flow description");
    }

    #[test]
    fn rejects_bad_options_missing_alternatives_and_oversized_source() {
        for info in [
            "mermaid title=x title=y",
            "mermaid unknown=x",
            "mermaid source=javascript:alert(1)",
            "mermaid title=\"missing",
            "mermaid title=\"x\"description=y",
        ] {
            assert!(parse_options(info).is_err(), "{info}");
        }
        let missing = discover("```mermaid\nflowchart LR\nA --> B\n```");
        assert!(missing[0]
            .as_ref()
            .unwrap_err()
            .message
            .contains("accTitle"));
        let large = format!("```mermaid\n{}\n```", "A".repeat(MAX_SOURCE_BYTES + 1));
        assert!(discover(&large)[0]
            .as_ref()
            .unwrap_err()
            .message
            .contains("exceeds"));
        let at_limit = format!(
            "```mermaid title=Example description=Example\n{}\n```",
            "A".repeat(MAX_SOURCE_BYTES - 1)
        );
        assert!(discover(&at_limit)[0].is_ok());
    }

    #[test]
    fn rejects_ambiguous_or_unclosed_alternatives() {
        assert!(alternative("accTitle: One\naccTitle: Two", "accTitle").is_err());
        assert!(alternative("accDescr { unfinished", "accDescr").is_err());
        assert_eq!(
            alternative("accTitleExtra: not a title", "accTitle"),
            Ok(None)
        );
    }

    #[test]
    fn reads_alternatives_from_each_supported_fixture() {
        let fixtures = [
            include_str!("../../../tests/fixtures/diagrams/flowchart.mmd"),
            include_str!("../../../tests/fixtures/diagrams/sequence.mmd"),
            include_str!("../../../tests/fixtures/diagrams/gitgraph.mmd"),
            include_str!("../../../tests/fixtures/diagrams/state.mmd"),
            include_str!("../../../tests/fixtures/diagrams/er.mmd"),
            include_str!("../../../tests/fixtures/diagrams/class.mmd"),
            include_str!("../../../tests/fixtures/diagrams/c4.mmd"),
        ];
        for fixture in fixtures {
            let markdown = format!("```mermaid\n{fixture}\n```\n");
            let diagrams = discover(&markdown);
            assert_eq!(diagrams.len(), 1);
            let diagram = diagrams[0].as_ref().unwrap();
            assert!(!diagram.title.is_empty());
            assert!(!diagram.description.is_empty());
        }
    }

    #[test]
    fn keeps_separate_fences_and_source_links() {
        let markdown = "```mermaid title=One description=First source=https://example.test/a\nA\n```\n\n```mermaid title=Two description=Second source=/a\nB\n```\n";
        let diagrams = discover(markdown);
        assert_eq!(diagrams.len(), 2);
        assert_eq!(diagrams[0].as_ref().unwrap().title, "One");
        assert_eq!(
            diagrams[0].as_ref().unwrap().options.source.as_deref(),
            Some("https://example.test/a")
        );
        assert_eq!(diagrams[1].as_ref().unwrap().line, 5);
        assert_eq!(diagrams[1].as_ref().unwrap().title, "Two");
    }
}
