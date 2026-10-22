//! Markdown rendering on top of pulldown-cmark, plus the derived data a blog
//! wants from a post body: headings for a table of contents, plain text for
//! excerpts and search, and an estimated reading time.

use pulldown_cmark::{CodeBlockKind, CowStr, Event, HeadingLevel, Options, Parser, Tag, TagEnd};

use crate::slug::slugify;

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct Heading {
    /// 1 through 6.
    pub level: u8,
    pub id: String,
    pub text: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Rendered {
    pub html: String,
    pub headings: Vec<Heading>,
    /// Body text with markup removed; code blocks are excluded.
    pub text: String,
    pub word_count: usize,
    /// Languages of fenced code blocks, in order of first appearance.
    pub code_languages: Vec<String>,
    /// First image URL in the body, if any. Used as a fallback cover.
    pub first_image: Option<String>,
}

#[derive(Clone, Copy, Debug)]
pub struct RenderOptions {
    /// Convert straight quotes and dashes to typographic ones.
    pub smart_punctuation: bool,
    /// Add `loading="lazy"` to images.
    pub lazy_images: bool,
    /// Wrap headings in anchor links so they can be shared.
    pub heading_anchors: bool,
}

impl Default for RenderOptions {
    fn default() -> Self {
        Self { smart_punctuation: false, lazy_images: true, heading_anchors: true }
    }
}

pub fn render(markdown: &str, options: RenderOptions) -> Rendered {
    let mut parser_options = Options::ENABLE_TABLES
        | Options::ENABLE_FOOTNOTES
        | Options::ENABLE_STRIKETHROUGH
        | Options::ENABLE_TASKLISTS
        | Options::ENABLE_HEADING_ATTRIBUTES;
    if options.smart_punctuation {
        parser_options |= Options::ENABLE_SMART_PUNCTUATION;
    }
    let parser = Parser::new_ext(markdown, parser_options);

    let mut events: Vec<Event> = Vec::new();
    let mut headings = Vec::new();
    let mut used_ids = std::collections::HashSet::new();
    let mut text = String::new();
    let mut code_languages: Vec<String> = Vec::new();
    let mut first_image = None;

    let mut in_code_block = false;
    let mut heading: Option<(HeadingLevel, usize, String)> = None;

    for event in parser {
        match &event {
            Event::Start(Tag::CodeBlock(kind)) => {
                in_code_block = true;
                if let CodeBlockKind::Fenced(info) = kind {
                    let lang = info.split([' ', ',']).next().unwrap_or("").trim();
                    if !lang.is_empty() && !code_languages.iter().any(|l| l == lang) {
                        code_languages.push(lang.to_string());
                    }
                }
            }
            Event::End(TagEnd::CodeBlock) => in_code_block = false,
            Event::Start(Tag::Image { dest_url, .. }) => {
                if first_image.is_none() {
                    first_image = Some(dest_url.to_string());
                }
            }
            Event::Start(Tag::Heading { level, .. }) => {
                heading = Some((*level, events.len(), String::new()));
            }
            Event::Text(t) | Event::Code(t) => {
                if let Some((_, _, buf)) = heading.as_mut() {
                    buf.push_str(t);
                }
                if !in_code_block {
                    text.push_str(t);
                }
            }
            Event::SoftBreak | Event::HardBreak => {
                if let Some((_, _, buf)) = heading.as_mut() {
                    buf.push(' ');
                }
                text.push(' ');
            }
            Event::End(TagEnd::Paragraph)
            | Event::End(TagEnd::Item)
            | Event::End(TagEnd::TableCell)
            | Event::End(TagEnd::BlockQuote(_)) => text.push(' '),
            _ => {}
        }

        if let Event::End(TagEnd::Heading(_)) = &event {
            if let Some((level, start_index, title)) = heading.take() {
                let mut id = slugify(&title);
                if id.is_empty() {
                    id = "section".to_string();
                }
                let base = id.clone();
                let mut n = 2;
                while !used_ids.insert(id.clone()) {
                    id = format!("{base}-{n}");
                    n += 1;
                }
                if let Event::Start(Tag::Heading { id: existing, .. }) = &mut events[start_index] {
                    if let Some(given) = existing.as_ref() {
                        id = given.to_string();
                    } else {
                        *existing = Some(CowStr::from(id.clone()));
                    }
                }
                let level_num = heading_level(level);
                if options.heading_anchors && level_num >= 2 {
                    let anchor = format!(
                        "<a class=\"ob-heading-anchor\" href=\"#{}\" aria-label=\"Link to this section\">#</a>",
                        crate::escape::attr(&id)
                    );
                    events.push(Event::Html(CowStr::from(anchor)));
                }
                headings.push(Heading { level: level_num, id, text: title.trim().to_string() });
                text.push(' ');
            }
        }

        events.push(event);
    }

    let mut html = String::with_capacity(markdown.len() * 2);
    pulldown_cmark::html::push_html(&mut html, events.into_iter());
    if options.lazy_images {
        html = html.replace("<img src=", "<img loading=\"lazy\" decoding=\"async\" src=");
    }

    let text = collapse_whitespace(&text);
    let word_count = text.split_whitespace().count();
    Rendered { html, headings, text, word_count, code_languages, first_image }
}

fn heading_level(level: HeadingLevel) -> u8 {
    match level {
        HeadingLevel::H1 => 1,
        HeadingLevel::H2 => 2,
        HeadingLevel::H3 => 3,
        HeadingLevel::H4 => 4,
        HeadingLevel::H5 => 5,
        HeadingLevel::H6 => 6,
    }
}

fn collapse_whitespace(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut last_space = true;
    for ch in input.chars() {
        if ch.is_whitespace() {
            if !last_space {
                out.push(' ');
            }
            last_space = true;
        } else {
            out.push(ch);
            last_space = false;
        }
    }
    out.trim_end().to_string()
}

/// Estimated reading time in whole minutes, never less than one.
pub fn reading_minutes(word_count: usize) -> u32 {
    ((word_count as f64 / 225.0).ceil() as u32).max(1)
}

/// The first `max_chars` of plain text, cut at a word boundary with an ellipsis.
pub fn excerpt(text: &str, max_chars: usize) -> String {
    if text.chars().count() <= max_chars {
        return text.to_string();
    }
    let mut cut = String::new();
    for word in text.split(' ') {
        if cut.chars().count() + word.chars().count() + 1 > max_chars {
            break;
        }
        if !cut.is_empty() {
            cut.push(' ');
        }
        cut.push_str(word);
    }
    let trimmed = cut.trim_end_matches(['.', ',', ';', ':', '-']);
    format!("{trimmed}…")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_headings_with_ids_and_anchors() {
        let r = render("# Title\n\n## Hello World\n\ntext\n\n## Hello World\n", RenderOptions::default());
        assert!(r.html.contains("<h2 id=\"hello-world\">"));
        assert!(r.html.contains("<h2 id=\"hello-world-2\">"));
        assert!(r.html.contains("ob-heading-anchor"));
        assert_eq!(r.headings.len(), 3);
        assert_eq!(r.headings[1].level, 2);
        assert_eq!(r.text, "Title Hello World text Hello World");
    }

    #[test]
    fn collects_code_languages_and_skips_code_text() {
        let r = render("Intro\n\n```rust\nfn main() {}\n```\n\n```js\nlet x\n```\n", RenderOptions::default());
        assert_eq!(r.code_languages, vec!["rust", "js"]);
        assert_eq!(r.text, "Intro");
        assert!(r.html.contains("<pre><code class=\"language-rust\">"));
    }

    #[test]
    fn lazy_images_and_first_image() {
        let r = render("![alt](/a.png)\n\n![b](/b.png)", RenderOptions::default());
        assert_eq!(r.first_image.as_deref(), Some("/a.png"));
        assert!(r.html.contains("<img loading=\"lazy\" decoding=\"async\" src=\"/a.png\""));
    }

    #[test]
    fn excerpt_and_reading_time() {
        assert_eq!(excerpt("one two three four", 9), "one two…");
        assert_eq!(excerpt("short", 100), "short");
        assert_eq!(reading_minutes(0), 1);
        assert_eq!(reading_minutes(226), 2);
    }

    #[test]
    fn tables_footnotes_tasks() {
        let r = render("| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] done\n\nnote[^1]\n\n[^1]: foot\n", RenderOptions::default());
        assert!(r.html.contains("<table>"));
        assert!(r.html.contains("type=\"checkbox\""));
        assert!(r.html.contains("footnote"));
    }
}
