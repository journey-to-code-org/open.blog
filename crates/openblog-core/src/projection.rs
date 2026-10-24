//! Destination-neutral projections derived from the canonical parsed post.
//!
//! Consumers request HTML, Markdown, or text from this module instead of
//! reparsing source files or inspecting open.blog custom elements. Projection
//! is deterministic, offline, and never mutates canonical content.

use html5ever::serialize::{SerializeOpts, TraversalScope};
use html5ever::tendril::TendrilSink;
use html5ever::{local_name, ns, QualName};
use markup5ever_rcdom::{Handle, NodeData, RcDom, SerializableHandle};
use pulldown_cmark::{Event, Options as MarkdownOptions, Parser, Tag, TagEnd};

use crate::config::SiteConfig;
use crate::contributor::CreditRole;
use crate::model::Post;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProjectionFormat {
    Html,
    Markdown,
    Text,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProjectionRepresentation {
    pub format: ProjectionFormat,
    pub media_type: &'static str,
    pub body: String,
    /// Intentional semantic loss introduced by this representation.
    pub semantic_losses: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProjectionAuthor {
    pub id: String,
    pub name: String,
    pub url: Option<String>,
    pub roles: Vec<CreditRole>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProjectionReference {
    pub label: String,
    pub url: String,
    pub source_line: usize,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProjectionProvenance {
    pub source_path: String,
    pub original_url: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PortableProjection {
    pub title: String,
    pub description: String,
    /// The URL of this publication's own copy of the work.
    pub publication_url: String,
    /// The preferred canonical work URL, which may identify an original copy or DOI.
    pub canonical_url: String,
    pub base_url: String,
    pub authors: Vec<ProjectionAuthor>,
    pub references: Vec<ProjectionReference>,
    pub provenance: ProjectionProvenance,
    html: ProjectionRepresentation,
    markdown: ProjectionRepresentation,
    text: ProjectionRepresentation,
}

impl PortableProjection {
    pub fn representation(&self, format: ProjectionFormat) -> &ProjectionRepresentation {
        match format {
            ProjectionFormat::Html => &self.html,
            ProjectionFormat::Markdown => &self.markdown,
            ProjectionFormat::Text => &self.text,
        }
    }
}

/// Build every portable view from the post that was already parsed by the
/// canonical site loader. No filesystem, network, clock, or remote state is
/// consulted here.
pub fn project_post(post: &Post, config: &SiteConfig) -> Result<PortableProjection, String> {
    let base_url = validated_base_url(&config.url)
        .map_err(|error| format!("{}: portable projection: {error}", post.source))?;
    let publication_url = absolute_site_url(&base_url, &post.url);
    let canonical_url = post
        .research
        .as_ref()
        .and_then(|metadata| metadata.doi_url.as_deref())
        .or(post.canonical.as_deref())
        .and_then(|url| safe_link(&base_url, url))
        .unwrap_or_else(|| publication_url.clone());
    let authors = post
        .credits
        .iter()
        .map(|credit| ProjectionAuthor {
            id: credit.contributor_id.clone(),
            name: credit.contributor.name.clone(),
            url: non_empty(&credit.contributor.url).and_then(|url| safe_link(&base_url, url)),
            roles: credit.roles.clone(),
        })
        .collect();
    let references = post
        .research
        .iter()
        .flat_map(|metadata| &metadata.references)
        .filter_map(|reference| {
            safe_link(&base_url, &reference.url).map(|url| ProjectionReference {
                label: reference.label.clone(),
                url,
                source_line: reference.line,
            })
        })
        .collect();

    Ok(PortableProjection {
        title: post.title.clone(),
        description: post.description.clone(),
        publication_url,
        canonical_url,
        base_url: base_url.clone(),
        authors,
        references,
        provenance: ProjectionProvenance {
            source_path: post.source.clone(),
            original_url: post
                .source_url
                .as_deref()
                .and_then(|url| safe_link(&base_url, url)),
        },
        html: ProjectionRepresentation {
            format: ProjectionFormat::Html,
            media_type: "text/html; charset=utf-8",
            body: absolutize_html(&post.html, &base_url),
            semantic_losses: Vec::new(),
        },
        markdown: ProjectionRepresentation {
            format: ProjectionFormat::Markdown,
            media_type: "text/markdown; charset=utf-8",
            body: absolutize_markdown(&post.markdown, &base_url),
            semantic_losses: Vec::new(),
        },
        text: ProjectionRepresentation {
            format: ProjectionFormat::Text,
            media_type: "text/plain; charset=utf-8",
            body: post.text.clone(),
            semantic_losses: vec!["formatting, media, links, and interactive behavior".into()],
        },
    })
}

fn validated_base_url(value: &str) -> Result<String, String> {
    let base = value.trim_end_matches('/');
    let uri = base
        .parse::<http::Uri>()
        .map_err(|_| "site URL must be a complete HTTP(S) URL")?;
    if !matches!(uri.scheme_str(), Some("http" | "https"))
        || uri.authority().is_none()
        || uri
            .authority()
            .is_some_and(|authority| authority.as_str().contains('@'))
        || uri.query().is_some()
    {
        return Err("site URL must be a complete HTTP(S) URL".into());
    }
    Ok(base.to_string())
}

fn non_empty(value: &str) -> Option<&str> {
    (!value.trim().is_empty()).then_some(value.trim())
}

fn safe_link(base: &str, value: &str) -> Option<String> {
    if value.starts_with('/') && !value.starts_with("//") {
        return Some(absolute_site_url(base, value));
    }
    let uri = value.parse::<http::Uri>().ok()?;
    (matches!(uri.scheme_str(), Some("http" | "https"))
        && uri.authority().is_some()
        && !uri
            .authority()
            .is_some_and(|authority| authority.as_str().contains('@')))
    .then(|| value.to_string())
}

fn absolute_site_url(base: &str, path: &str) -> String {
    format!("{}{}", base.trim_end_matches('/'), path)
}

fn absolutize_html(html: &str, base: &str) -> String {
    let dom = html5ever::parse_fragment(
        RcDom::default(),
        Default::default(),
        QualName::new(None, ns!(html), local_name!("div")),
        Vec::new(),
        false,
    )
    .one(html);
    rewrite_element_urls(&dom.document, base);
    let Some(fragment_root) = find_element(&dom.document, "html") else {
        return html.to_string();
    };
    let mut output = Vec::with_capacity(html.len());
    let serializable = SerializableHandle::from(fragment_root);
    let options = SerializeOpts {
        traversal_scope: TraversalScope::ChildrenOnly(None),
        ..Default::default()
    };
    if html5ever::serialize(&mut output, &serializable, options).is_err() {
        return html.to_string();
    }
    String::from_utf8(output).unwrap_or_else(|_| html.to_string())
}

fn rewrite_element_urls(node: &Handle, base: &str) {
    if let NodeData::Element { attrs, .. } = &node.data {
        for attr in attrs.borrow_mut().iter_mut() {
            let name = attr.name.local.as_ref();
            let value = attr.value.as_ref();
            if matches!(name, "href" | "src") && value.starts_with('/') && !value.starts_with("//")
            {
                attr.value = format!("{base}{value}").into();
            }
        }
    }
    for child in node.children.borrow().iter() {
        rewrite_element_urls(child, base);
    }
}

fn find_element(node: &Handle, wanted: &str) -> Option<Handle> {
    if let NodeData::Element { name, .. } = &node.data {
        if name.local.as_ref().eq_ignore_ascii_case(wanted) {
            return Some(node.clone());
        }
    }
    node.children
        .borrow()
        .iter()
        .find_map(|child| find_element(child, wanted))
}

fn absolutize_markdown(markdown: &str, base: &str) -> String {
    let mut spans = Vec::new();
    let mut code_block = false;
    let mut raw_inline_element = None;
    let mut parser = Parser::new_ext(markdown, MarkdownOptions::all()).into_offset_iter();
    let events: Vec<_> = parser.by_ref().collect();
    spans.extend(
        parser
            .reference_definitions()
            .iter()
            .map(|(_, definition)| {
                (
                    definition.span.clone(),
                    MarkdownSpanKind::ReferenceDefinition,
                )
            }),
    );
    for (event, range) in events {
        let kind = match event {
            Event::Start(Tag::CodeBlock(_)) => {
                code_block = true;
                Some(MarkdownSpanKind::Protected)
            }
            Event::End(TagEnd::CodeBlock) => {
                code_block = false;
                Some(MarkdownSpanKind::Protected)
            }
            _ if code_block => Some(MarkdownSpanKind::Protected),
            Event::Code(_) => Some(MarkdownSpanKind::Protected),
            Event::Html(_) => Some(MarkdownSpanKind::BlockHtml),
            Event::InlineHtml(html) => {
                let lower = html.trim_start().to_ascii_lowercase();
                let kind = if raw_inline_element.is_some() {
                    MarkdownSpanKind::Protected
                } else {
                    MarkdownSpanKind::InlineHtml
                };
                if raw_inline_element.is_some_and(|name| lower.starts_with(&format!("</{name}"))) {
                    raw_inline_element = None;
                } else if lower.starts_with("<script") {
                    raw_inline_element = Some("script");
                } else if lower.starts_with("<style") {
                    raw_inline_element = Some("style");
                }
                Some(kind)
            }
            _ if raw_inline_element.is_some() => Some(MarkdownSpanKind::Protected),
            _ => None,
        };
        if let Some(kind) = kind {
            spans.push((range, kind));
        }
    }
    spans.sort_by_key(|(range, _)| range.start);
    let mut out = String::with_capacity(markdown.len());
    let mut cursor = 0;
    for (range, kind) in spans {
        if range.start < cursor {
            continue;
        }
        out.push_str(&rewrite_plain_markdown(
            &markdown[cursor..range.start],
            base,
        ));
        let source = &markdown[range.clone()];
        match kind {
            MarkdownSpanKind::Protected => out.push_str(source),
            MarkdownSpanKind::InlineHtml => out.push_str(&rewrite_html_attributes(source, base)),
            MarkdownSpanKind::BlockHtml => out.push_str(&absolutize_html(source, base)),
            MarkdownSpanKind::ReferenceDefinition => {
                out.push_str(&rewrite_reference_definition(source, base));
            }
        }
        cursor = range.end;
    }
    out.push_str(&rewrite_plain_markdown(&markdown[cursor..], base));
    out
}

#[derive(Clone, Copy)]
enum MarkdownSpanKind {
    Protected,
    InlineHtml,
    BlockHtml,
    ReferenceDefinition,
}

fn rewrite_reference_definition(definition: &str, base: &str) -> String {
    let bytes = definition.as_bytes();
    let Some(closing_bracket) = bytes
        .iter()
        .enumerate()
        .find(|(index, byte)| **byte == b']' && !is_escaped(bytes, *index))
        .map(|(index, _)| index)
    else {
        return definition.to_string();
    };
    let mut cursor = closing_bracket + 1;
    if bytes.get(cursor) != Some(&b':') {
        return definition.to_string();
    }
    cursor += 1;
    while bytes.get(cursor).is_some_and(u8::is_ascii_whitespace) {
        cursor += 1;
    }
    if bytes.get(cursor) == Some(&b'<') {
        cursor += 1;
    }
    if bytes.get(cursor) != Some(&b'/') || bytes.get(cursor + 1) == Some(&b'/') {
        return definition.to_string();
    }
    format!("{}{base}{}", &definition[..cursor], &definition[cursor..])
}

fn rewrite_plain_markdown(markdown: &str, base: &str) -> String {
    markdown
        .split_inclusive('\n')
        .map(|line| rewrite_markdown_line(line, base))
        .collect()
}

fn rewrite_markdown_line(line: &str, base: &str) -> String {
    let bytes = line.as_bytes();
    let mut out = String::with_capacity(line.len());
    let mut index = 0;
    let mut code_ticks = None;
    while index < bytes.len() {
        if bytes[index] == b'`' {
            let count = bytes[index..]
                .iter()
                .take_while(|byte| **byte == b'`')
                .count();
            if code_ticks.is_none() {
                code_ticks = Some(count);
            } else if code_ticks == Some(count) {
                code_ticks = None;
            }
            out.push_str(&line[index..index + count]);
            index += count;
            continue;
        }
        if code_ticks.is_none() && bytes[index] == b']' && !is_escaped(bytes, index) {
            let mut cursor = index + 1;
            let destination_marker = bytes.get(cursor) == Some(&b'(')
                || (bytes.get(cursor) == Some(&b':') && is_reference_definition(bytes, index));
            if destination_marker {
                cursor += 1;
                while bytes.get(cursor).is_some_and(u8::is_ascii_whitespace) {
                    cursor += 1;
                }
                if bytes.get(cursor) == Some(&b'<') {
                    cursor += 1;
                }
                if bytes.get(cursor) == Some(&b'/') && bytes.get(cursor + 1) != Some(&b'/') {
                    out.push_str(&line[index..cursor]);
                    out.push_str(base);
                    index = cursor;
                    continue;
                }
            }
        }
        let length = line[index..]
            .chars()
            .next()
            .map(char::len_utf8)
            .unwrap_or(1);
        out.push_str(&line[index..index + length]);
        index += length;
    }
    out
}

fn rewrite_html_attributes(html: &str, base: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut index = 0;
    while index < html.len() {
        if let Some(value_start) = root_html_attribute(html, index) {
            out.push_str(&html[index..value_start]);
            out.push_str(base);
            index = value_start;
            continue;
        }
        let length = html[index..]
            .chars()
            .next()
            .map(char::len_utf8)
            .unwrap_or(1);
        out.push_str(&html[index..index + length]);
        index += length;
    }
    out
}

fn root_html_attribute(input: &str, index: usize) -> Option<usize> {
    let bytes = input.as_bytes();
    let remaining = &input[index..];
    let name = if remaining
        .get(..4)
        .is_some_and(|value| value.eq_ignore_ascii_case("href"))
    {
        "href"
    } else if remaining
        .get(..3)
        .is_some_and(|value| value.eq_ignore_ascii_case("src"))
    {
        "src"
    } else {
        return None;
    };
    if index > 0 && !bytes[index - 1].is_ascii_whitespace() && bytes[index - 1] != b'<' {
        return None;
    }
    let mut cursor = index + name.len();
    while bytes.get(cursor).is_some_and(u8::is_ascii_whitespace) {
        cursor += 1;
    }
    if bytes.get(cursor) != Some(&b'=') {
        return None;
    }
    cursor += 1;
    while bytes.get(cursor).is_some_and(u8::is_ascii_whitespace) {
        cursor += 1;
    }
    if matches!(bytes.get(cursor), Some(b'\'' | b'"')) {
        cursor += 1;
    }
    (bytes.get(cursor) == Some(&b'/') && bytes.get(cursor + 1) != Some(&b'/')).then_some(cursor)
}

fn is_escaped(bytes: &[u8], index: usize) -> bool {
    bytes[..index]
        .iter()
        .rev()
        .take_while(|byte| **byte == b'\\')
        .count()
        % 2
        == 1
}

fn is_reference_definition(line: &[u8], closing_bracket: usize) -> bool {
    let indentation = line.iter().take_while(|byte| **byte == b' ').count();
    indentation <= 3
        && line.get(indentation) == Some(&b'[')
        && line.get(indentation + 1) != Some(&b'^')
        && closing_bracket > indentation + 1
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{LoadOptions, SourceFile, Sources};
    use crate::Site;

    fn projection(source: &str) -> PortableProjection {
        let config = SiteConfig::from_json(
            r#"{"title":"Portable","url":"https://blog.example/base","postPath":"/posts/{slug}/","author":{"name":"Legacy","url":"/about/"},"contributors":{"ada":{"name":"Ada","url":"https://ada.example"}}}"#,
        )
        .unwrap();
        let site = Site::load(
            config,
            Sources {
                posts: vec![SourceFile {
                    path: "posts/portable.md".into(),
                    contents: source.into(),
                }],
                ..Sources::default()
            },
            LoadOptions::default(),
        )
        .unwrap();
        project_post(&site.posts[0], &site.config).unwrap()
    }

    #[test]
    fn projection_is_deterministic_and_owns_identity_and_representations() {
        let source = "---\ntitle: Héllo\ndate: 2026-10-24\nsourceUrl: https://origin.example/work\n---\n\nSee [home](/about/) and ![alt](/img/a.png).";
        let first = projection(source);
        let second = projection(source);
        assert_eq!(first, second);
        assert_eq!(
            first.canonical_url,
            "https://blog.example/base/posts/portable/"
        );
        assert_eq!(first.provenance.source_path, "posts/portable.md");
        assert_eq!(
            first.provenance.original_url.as_deref(),
            Some("https://origin.example/work")
        );
        assert!(first
            .representation(ProjectionFormat::Html)
            .body
            .contains("href=\"https://blog.example/base/about/\""));
        assert!(first
            .representation(ProjectionFormat::Markdown)
            .body
            .contains("]("));
        assert!(first
            .representation(ProjectionFormat::Markdown)
            .body
            .contains("https://blog.example/base/about/"));
        assert!(first
            .representation(ProjectionFormat::Text)
            .body
            .contains("See home"));
    }

    #[test]
    fn projection_does_not_rewrite_links_inside_code_or_scripts() {
        let projected = projection("---\ntitle: Safe\ndate: 2026-10-24\n---\n\n`[x](/inline)`\n\n```html\n<a href=\"/code\">x</a>\n```\n\n<script>const x = 'href=\"/private\"';</script>\n\n[real](/real)");
        let markdown = &projected.representation(ProjectionFormat::Markdown).body;
        assert!(markdown.contains("`[x](/inline)`"));
        assert!(markdown.contains("href=\"/code\""));
        assert!(markdown.contains("href=\"/private\""));
        assert!(markdown.contains("](https://blog.example/base/real)"));
    }

    #[test]
    fn projection_rewrites_reference_images_and_raw_attributes_without_touching_decoys() {
        let projected = projection(
            r#"---
title: Links
date: 2026-10-24
---

[inline](/one)
![angle](</images/pic.png> "Picture")

[reference]: /reference "Reference"
[multiline-reference]:
/multiline-reference "Multiline reference"

<a href = '/raw'>raw</a><img SRC="/raw.png">
<!-- href="/comment" --><script>const value = 'src="/script"';</script>
ordinary href="/prose"
[cdn](//cdn.example/file)
`[code](/unchanged)`
[^note]: /plain-footnote-text

    [indented](/unchanged)
"#,
        );
        let markdown = &projected.representation(ProjectionFormat::Markdown).body;
        for expected in [
            "[inline](https://blog.example/base/one)",
            "![angle](<https://blog.example/base/images/pic.png>",
            "[reference]: https://blog.example/base/reference",
            "[multiline-reference]:\nhttps://blog.example/base/multiline-reference",
            "href = 'https://blog.example/base/raw'",
            "SRC=\"https://blog.example/base/raw.png\"",
        ] {
            assert!(
                markdown.contains(expected),
                "missing {expected}: {markdown}"
            );
        }
        for unchanged in [
            "[cdn](//cdn.example/file)",
            "`[code](/unchanged)`",
            "[^note]: /plain-footnote-text",
            "    [indented](/unchanged)",
            "<!-- href=\"/comment\" -->",
            "src=\"/script\"",
            "ordinary href=\"/prose\"",
        ] {
            assert!(
                markdown.contains(unchanged),
                "changed protected content {unchanged}: {markdown}"
            );
        }
    }

    #[test]
    fn safe_links_reject_credentials_protocol_relative_and_executable_schemes() {
        let base = "https://blog.example/base";
        assert_eq!(safe_link(base, "/about"), Some(format!("{base}/about")));
        assert_eq!(
            safe_link(base, "https://source.example/work"),
            Some("https://source.example/work".into())
        );
        for unsafe_link in [
            "//tracker.example/work",
            "https://user:secret@source.example/work",
            "javascript:alert(1)",
            "data:text/html,hello",
        ] {
            assert_eq!(safe_link(base, unsafe_link), None);
        }
    }
}
