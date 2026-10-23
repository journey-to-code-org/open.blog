//! Markdown rendering on top of pulldown-cmark, plus the derived data a blog
//! wants from a post body: headings for a table of contents, plain text for
//! excerpts and search, and an estimated reading time.

use pulldown_cmark::{
    BlockQuoteKind, CodeBlockKind, CowStr, Event, HeadingLevel, Options, Parser, Tag, TagEnd,
};

use crate::escape;
use crate::recipe::{self, Section};
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
    /// With [`RenderOptions::recipe`]: the text of each ingredient and step,
    /// and the id of the first recipe heading (for a "Jump to recipe" link).
    pub recipe_ingredients: Vec<String>,
    pub recipe_steps: Vec<String>,
    pub recipe_anchor: Option<String>,
}

#[derive(Clone, Copy, Debug)]
pub struct RenderOptions {
    /// Convert straight quotes and dashes to typographic ones.
    pub smart_punctuation: bool,
    /// Add `loading="lazy"` to images.
    pub lazy_images: bool,
    /// Wrap headings in anchor links so they can be shared.
    pub heading_anchors: bool,
    /// Turn a link that stands alone in its paragraph (to CodePen, for now)
    /// into an embedded frame. See [`crate::embed`].
    pub embeds: bool,
    /// Treat "Ingredients" and "Steps" sections as a recipe (see [`crate::recipe`]).
    pub recipe: bool,
}

impl Default for RenderOptions {
    fn default() -> Self {
        Self {
            smart_punctuation: false,
            lazy_images: true,
            heading_anchors: true,
            embeds: true,
            recipe: false,
        }
    }
}

/// Options written after a fence's language, in the style other site
/// generators use: ```` ```rust title="src/main.rs" {2,4-6} showLineNumbers=10 ````.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
struct FenceInfo {
    lang: String,
    title: Option<String>,
    /// `showLineNumbers` / `showLineNumbers=false`.
    line_numbers: Option<bool>,
    /// `showLineNumbers=10` starts counting at 10.
    line_start: Option<u32>,
    /// `{2,4-6}`: lines to highlight, validated to digits, commas and dashes.
    highlight: Option<String>,
}

fn parse_fence_info(info: &str) -> FenceInfo {
    let mut out = FenceInfo::default();
    let mut rest = info.trim();
    let mut first = true;
    while !rest.is_empty() {
        if let Some(body) = rest.strip_prefix('{') {
            let end = body.find('}').unwrap_or(body.len());
            let ranges: String = body[..end].chars().filter(|c| !c.is_whitespace()).collect();
            if !ranges.is_empty()
                && ranges
                    .chars()
                    .all(|c| c.is_ascii_digit() || c == ',' || c == '-')
            {
                out.highlight = Some(ranges);
            }
            rest = body.get(end + 1..).unwrap_or("").trim_start();
            first = false;
            continue;
        }
        if let Some(value) = rest.strip_prefix("title=") {
            let (title, after) = match value.chars().next() {
                Some(q @ ('"' | '\'')) => {
                    let inner = &value[1..];
                    let end = inner.find(q).unwrap_or(inner.len());
                    (&inner[..end], inner.get(end + 1..).unwrap_or(""))
                }
                _ => {
                    let end = value.find(char::is_whitespace).unwrap_or(value.len());
                    (&value[..end], &value[end..])
                }
            };
            if !title.trim().is_empty() {
                out.title = Some(title.trim().to_string());
            }
            rest = after.trim_start();
            first = false;
            continue;
        }
        let end = rest
            .find(|c: char| c.is_whitespace() || c == '{' || c == ',')
            .unwrap_or(rest.len());
        let word = &rest[..end];
        rest = rest[end..].trim_start_matches(',').trim_start();
        if let Some(flag) = word.strip_prefix("showLineNumbers") {
            match flag.strip_prefix('=').map(str::trim) {
                None | Some("true") => out.line_numbers = Some(true),
                Some("false") => out.line_numbers = Some(false),
                Some(n) => {
                    if let Ok(n) = n.parse::<u32>() {
                        out.line_numbers = Some(true);
                        out.line_start = Some(n);
                    }
                }
            }
        } else if first && !word.is_empty() {
            out.lang = word.to_string();
        }
        first = false;
    }
    out
}

fn callout_label(kind: BlockQuoteKind) -> (&'static str, &'static str) {
    match kind {
        BlockQuoteKind::Note => ("note", "Note"),
        BlockQuoteKind::Tip => ("tip", "Tip"),
        BlockQuoteKind::Important => ("important", "Important"),
        BlockQuoteKind::Warning => ("warning", "Warning"),
        BlockQuoteKind::Caution => ("caution", "Caution"),
    }
}

/// What [`transform_blocks`] found besides the new events.
#[derive(Default)]
struct BlockData {
    ingredients: Vec<String>,
    steps: Vec<String>,
    recipe_anchor: Option<String>,
}

/// How a line of raw block HTML changes the element depth: `+1` for an
/// opening tag left open, `-1` for a closing tag, `0` otherwise (void and
/// self-closing tags, elements closed on the same line, comments).
fn html_line_depth(line: &str) -> i32 {
    const VOID: &[&str] = &[
        "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source",
        "track", "wbr",
    ];
    let t = line.trim();
    if t.starts_with("</") {
        return -1;
    }
    let Some(rest) = t.strip_prefix('<') else {
        return 0;
    };
    let name: String = rest
        .chars()
        .take_while(|c| c.is_ascii_alphanumeric() || *c == '-')
        .collect::<String>()
        .to_ascii_lowercase();
    let tag_end = t.find('>').unwrap_or(t.len());
    if name.is_empty()
        || VOID.contains(&name.as_str())
        || t[..tag_end].ends_with('/')
        || t.to_ascii_lowercase().contains(&format!("</{name}"))
    {
        return 0;
    }
    1
}

/// Rewrite fenced code blocks (titles, line options), GitHub-style callouts,
/// and, for recipes, the Ingredients and Steps sections.
///
/// Recipe sections only ever open and close at the top level of the post:
/// a heading or list inside a quote, callout, list item, table or footnote
/// belongs to that container and is left alone.
fn transform_blocks(events: Vec<Event<'_>>, recipe: bool) -> (Vec<Event<'_>>, BlockData) {
    let mut out = Vec::with_capacity(events.len());
    let mut data = BlockData::default();
    let mut titled_code = false;
    // Open containers (quotes, callouts, list items, tables, footnotes).
    let mut depth = 0usize;
    // An open recipe section: what it holds and the heading level that opened it.
    let mut section: Option<(Section, u8)> = None;
    // The section's top-level list while it is open: `true` when ordered.
    let mut recipe_list: Option<bool> = None;
    let mut item: Option<String> = None;
    // Raw HTML elements opened (and not yet closed) since the section began.
    let mut html_depth = 0i32;
    // The section a deeper heading switched away from ("### Ingredients for the
    // glaze" inside "## Method"); it resumes when that sub-section ends.
    let mut outer: Option<(Section, u8)> = None;
    let close = |out: &mut Vec<Event<'_>>, section: &mut Option<(Section, u8)>| {
        if section.take().is_some() {
            out.push(Event::Html(CowStr::from("</section>\n")));
        }
    };

    for (i, event) in events.iter().enumerate() {
        // What this event becomes in the output.
        let rendered = match event {
            Event::Start(Tag::CodeBlock(CodeBlockKind::Fenced(info))) => {
                let fence = parse_fence_info(info);
                let mut html = String::new();
                if let Some(title) = &fence.title {
                    html.push_str(&format!(
                        "<figure class=\"ob-code-block\"><figcaption class=\"ob-code-title\">{}</figcaption>",
                        escape::text(title)
                    ));
                }
                titled_code = fence.title.is_some();
                html.push_str("<pre><code");
                if !fence.lang.is_empty() {
                    html.push_str(&format!(
                        " class=\"language-{}\"",
                        escape::attr(&fence.lang)
                    ));
                }
                if let Some(on) = fence.line_numbers {
                    html.push_str(&format!(" data-line-numbers=\"{on}\""));
                }
                if let Some(n) = fence.line_start {
                    html.push_str(&format!(" data-line-start=\"{n}\""));
                }
                if let Some(ranges) = &fence.highlight {
                    html.push_str(&format!(" data-highlight-lines=\"{ranges}\""));
                }
                html.push('>');
                Event::Html(CowStr::from(html))
            }
            Event::End(TagEnd::CodeBlock) if titled_code => {
                titled_code = false;
                Event::Html(CowStr::from("</code></pre></figure>\n"))
            }
            Event::Start(Tag::BlockQuote(Some(kind))) => {
                let (class, label) = callout_label(*kind);
                Event::Html(CowStr::from(format!(
                    "<aside class=\"ob-callout ob-callout-{class}\" role=\"note\"><p class=\"ob-callout-title\">{label}</p>\n"
                )))
            }
            Event::End(TagEnd::BlockQuote(Some(_))) => Event::Html(CowStr::from("</aside>\n")),
            other => other.clone(),
        };
        if !recipe {
            out.push(rendered);
            continue;
        }
        let opens = matches!(
            event,
            Event::Start(
                Tag::BlockQuote(_) | Tag::Item | Tag::FootnoteDefinition(_) | Tag::Table(_)
            )
        );
        let closes = matches!(
            event,
            Event::End(
                TagEnd::BlockQuote(_) | TagEnd::Item | TagEnd::FootnoteDefinition | TagEnd::Table
            )
        );
        // Block boundaries inside an item (paragraphs, sub-lists) separate words.
        if let Some(buf) = item.as_mut() {
            if matches!(
                event,
                Event::Start(Tag::Item | Tag::Paragraph | Tag::List(_))
                    | Event::End(TagEnd::Item | TagEnd::Paragraph | TagEnd::List(_))
            ) {
                buf.push(' ');
            }
        }

        match event {
            Event::Start(Tag::Heading { level, id, .. }) if depth == 0 => {
                let level = heading_level(*level);
                let title: String = events[i + 1..]
                    .iter()
                    .take_while(|e| !matches!(e, Event::End(TagEnd::Heading(_))))
                    .filter_map(|e| match e {
                        Event::Text(t) | Event::Code(t) => Some(t.as_ref()),
                        _ => None,
                    })
                    .collect();
                let mut kind = recipe::classify_heading(&title);
                if outer.is_some_and(|(_, outer_level)| level <= outer_level) {
                    outer = None;
                }
                if let Some((open_kind, open_level)) = section {
                    // A heading at the same or a higher level ends the section; so
                    // does a deeper "Method" inside "Ingredients" (or the reverse).
                    let switches = level > open_level && kind.is_some_and(|k| k != open_kind);
                    if switches && outer.is_none() {
                        outer = Some((open_kind, open_level));
                    }
                    if level <= open_level || switches {
                        close(&mut out, &mut section);
                    }
                }
                // After a switched-in sub-section ends, the outer kind carries on.
                let mut level_opened = level;
                if let (None, None, Some((outer_kind, outer_level))) = (section, kind, outer) {
                    if level > outer_level {
                        kind = Some(outer_kind);
                        level_opened = outer_level;
                        outer = None;
                    }
                }
                if let (None, Some(kind)) = (section, kind) {
                    out.push(Event::Html(CowStr::from(format!(
                        "<section class=\"ob-recipe-part ob-recipe-{}\">\n",
                        kind.class()
                    ))));
                    section = Some((kind, level_opened));
                    html_depth = 0;
                    if data.recipe_anchor.is_none() {
                        data.recipe_anchor = id.as_ref().map(|s| s.to_string());
                    }
                }
                out.push(rendered);
            }
            // Raw HTML arrives one line at a time. Elements opened inside the
            // section stay inside it; a closing tag for a wrapper opened before
            // the section (`</details>`) ends the section first.
            Event::Html(html) if depth == 0 && section.is_some() => {
                let delta = html_line_depth(html);
                if delta < 0 && html_depth == 0 {
                    close(&mut out, &mut section);
                } else {
                    html_depth = (html_depth + delta).max(0);
                }
                out.push(rendered);
            }
            Event::Start(Tag::List(start)) if depth == 0 && recipe_list.is_none() => {
                let Some((kind, _)) = section else {
                    out.push(rendered);
                    continue;
                };
                let kind = kind.class();
                recipe_list = Some(start.is_some());
                let html = match start {
                    Some(n) if *n != 1 => {
                        format!("<ol class=\"ob-recipe-list ob-{kind}\" start=\"{n}\">\n")
                    }
                    Some(_) => format!("<ol class=\"ob-recipe-list ob-{kind}\">\n"),
                    None => format!("<ul class=\"ob-recipe-list ob-{kind}\">\n"),
                };
                out.push(Event::Html(CowStr::from(html)));
            }
            Event::End(TagEnd::List(_)) if depth == 0 && recipe_list.is_some() => {
                let ordered = recipe_list.take().unwrap_or(false);
                out.push(Event::Html(CowStr::from(if ordered {
                    "</ol>\n"
                } else {
                    "</ul>\n"
                })));
            }
            Event::Start(Tag::Item) if depth == 0 && recipe_list.is_some() => {
                item = Some(String::new());
                out.push(rendered);
            }
            Event::End(TagEnd::Item) if depth == 1 && recipe_list.is_some() => {
                if let (Some(text), Some((kind, _))) = (item.take(), section) {
                    let text = collapse_whitespace(&text);
                    if !text.is_empty() {
                        match kind {
                            Section::Ingredients => data.ingredients.push(text),
                            Section::Steps => data.steps.push(text),
                        }
                    }
                }
                out.push(rendered);
            }
            Event::Text(t) | Event::Code(t) => {
                if let Some(buf) = item.as_mut() {
                    buf.push_str(t);
                }
                out.push(rendered);
            }
            Event::SoftBreak | Event::HardBreak => {
                if let Some(buf) = item.as_mut() {
                    buf.push(' ');
                }
                out.push(rendered);
            }
            _ => out.push(rendered),
        }
        if opens {
            depth += 1;
        } else if closes {
            depth = depth.saturating_sub(1);
        }
    }
    close(&mut out, &mut section);
    (out, data)
}

/// The URL a paragraph consists of, if it is nothing but one link (or the bare
/// URL as text, or Hashnode's `%[url]`).
fn standalone_url(inner: &[Event]) -> Option<String> {
    match inner {
        [Event::Start(Tag::Link { dest_url, .. }), middle @ .., Event::End(TagEnd::Link)]
            if middle
                .iter()
                .all(|e| matches!(e, Event::Text(_) | Event::Code(_))) =>
        {
            Some(dest_url.to_string())
        }
        _ if !inner.is_empty() && inner.iter().all(|e| matches!(e, Event::Text(_))) => {
            let joined: String = inner
                .iter()
                .map(|e| match e {
                    Event::Text(t) => t.as_ref(),
                    _ => "",
                })
                .collect();
            let joined = joined.trim();
            (joined.starts_with("http") || joined.starts_with("%[http")).then(|| joined.to_string())
        }
        _ => None,
    }
}

/// Replace standalone embeddable links with their embed HTML.
fn apply_embeds(events: Vec<Event<'_>>) -> Vec<Event<'_>> {
    let mut out = Vec::with_capacity(events.len());
    let mut i = 0;
    while i < events.len() {
        if matches!(events[i], Event::Start(Tag::Paragraph)) {
            if let Some(len) = events[i + 1..]
                .iter()
                .position(|e| matches!(e, Event::End(TagEnd::Paragraph)))
            {
                let inner = &events[i + 1..i + 1 + len];
                if let Some(embed) = standalone_url(inner).and_then(|u| crate::embed::detect(&u)) {
                    out.push(Event::Html(CowStr::from(crate::embed::html(&embed))));
                    i += len + 2;
                    continue;
                }
            }
        }
        out.push(events[i].clone());
        i += 1;
    }
    out
}

pub fn render(markdown: &str, options: RenderOptions) -> Rendered {
    let mut parser_options = Options::ENABLE_TABLES
        | Options::ENABLE_FOOTNOTES
        | Options::ENABLE_STRIKETHROUGH
        | Options::ENABLE_TASKLISTS
        | Options::ENABLE_HEADING_ATTRIBUTES
        | Options::ENABLE_GFM; // > [!NOTE] callouts
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
                    let lang = parse_fence_info(info).lang;
                    if !lang.is_empty() && !code_languages.contains(&lang) {
                        code_languages.push(lang);
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
                headings.push(Heading {
                    level: level_num,
                    id,
                    text: title.trim().to_string(),
                });
                text.push(' ');
            }
        }

        events.push(event);
    }

    let events = if options.embeds {
        apply_embeds(events)
    } else {
        events
    };
    let (events, blocks) = transform_blocks(events, options.recipe);
    let mut html = String::with_capacity(markdown.len() * 2);
    pulldown_cmark::html::push_html(&mut html, events.into_iter());
    if options.lazy_images {
        html = html.replace("<img src=", "<img loading=\"lazy\" decoding=\"async\" src=");
    }

    let text = collapse_whitespace(&text);
    let word_count = text.split_whitespace().count();
    Rendered {
        html,
        headings,
        text,
        word_count,
        code_languages,
        first_image,
        recipe_ingredients: blocks.ingredients,
        recipe_steps: blocks.steps,
        recipe_anchor: blocks.recipe_anchor,
    }
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
        let r = render(
            "# Title\n\n## Hello World\n\ntext\n\n## Hello World\n",
            RenderOptions::default(),
        );
        assert!(r.html.contains("<h2 id=\"hello-world\">"));
        assert!(r.html.contains("<h2 id=\"hello-world-2\">"));
        assert!(r.html.contains("ob-heading-anchor"));
        assert_eq!(r.headings.len(), 3);
        assert_eq!(r.headings[1].level, 2);
        assert_eq!(r.text, "Title Hello World text Hello World");
    }

    #[test]
    fn collects_code_languages_and_skips_code_text() {
        let r = render(
            "Intro\n\n```rust\nfn main() {}\n```\n\n```js\nlet x\n```\n",
            RenderOptions::default(),
        );
        assert_eq!(r.code_languages, vec!["rust", "js"]);
        assert_eq!(r.text, "Intro");
        assert!(r.html.contains("<pre><code class=\"language-rust\">"));
    }

    #[test]
    fn lazy_images_and_first_image() {
        let r = render("![alt](/a.png)\n\n![b](/b.png)", RenderOptions::default());
        assert_eq!(r.first_image.as_deref(), Some("/a.png"));
        assert!(r
            .html
            .contains("<img loading=\"lazy\" decoding=\"async\" src=\"/a.png\""));
    }

    #[test]
    fn standalone_codepen_links_become_embeds_but_inline_links_do_not() {
        let md = "Intro.\n\n[https://codepen.io/u/pen/abc](https://codepen.io/u/pen/abc)\n\nSee [this pen](https://codepen.io/u/pen/def) inline.\n\n<https://codepen.io/u/pen/ghi>\n\n%[https://codepen.io/u/pen/jkl]\n\n[docs](https://example.com)\n";
        let r = render(md, RenderOptions::default());
        assert!(r
            .html
            .contains("<iframe src=\"https://codepen.io/u/embed/abc?default-tab=result\""));
        assert!(
            r.html
                .contains("<iframe src=\"https://codepen.io/u/embed/ghi?default-tab=result\""),
            "autolink"
        );
        assert!(
            r.html
                .contains("<iframe src=\"https://codepen.io/u/embed/jkl?default-tab=result\""),
            "Hashnode syntax"
        );
        assert!(
            !r.html.contains("embed/def"),
            "a link inside a sentence stays a link"
        );
        assert!(r
            .html
            .contains("<a href=\"https://codepen.io/u/pen/def\">this pen</a>"));
        assert!(
            r.html.contains("<a href=\"https://example.com\">docs</a>"),
            "other standalone links stay links"
        );
        assert!(
            !r.html.contains("<p><figure"),
            "the embed replaces the paragraph"
        );
        let off = render(
            md,
            RenderOptions {
                embeds: false,
                ..Default::default()
            },
        );
        assert!(!off.html.contains("<iframe"));
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
        let r = render(
            "| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] done\n\nnote[^1]\n\n[^1]: foot\n",
            RenderOptions::default(),
        );
        assert!(r.html.contains("<table>"));
        assert!(r.html.contains("type=\"checkbox\""));
        assert!(r.html.contains("footnote"));
    }

    #[test]
    fn fence_options_title_line_numbers_and_highlights() {
        let info = parse_fence_info(r#"rust title="src/main.rs" {1,3-4} showLineNumbers=10"#);
        assert_eq!(info.lang, "rust");
        assert_eq!(info.title.as_deref(), Some("src/main.rs"));
        assert_eq!(info.highlight.as_deref(), Some("1,3-4"));
        assert_eq!((info.line_numbers, info.line_start), (Some(true), Some(10)));
        assert_eq!(parse_fence_info("js{2}").highlight.as_deref(), Some("2"));
        assert_eq!(
            parse_fence_info("js showLineNumbers=false").line_numbers,
            Some(false)
        );
        assert_eq!(
            parse_fence_info("js {x<y}").highlight,
            None,
            "only digits, commas and dashes"
        );
        assert_eq!(
            parse_fence_info("title=a.txt").lang,
            "",
            "no language before the title"
        );

        let r = render(
            "```rust title=\"a <b>.rs\" {2} showLineNumbers\nfn a() {}\nlet x = 1;\n```\n\n```\nplain\n```\n",
            RenderOptions::default(),
        );
        assert!(r.html.contains(
            "<figure class=\"ob-code-block\"><figcaption class=\"ob-code-title\">a &lt;b&gt;.rs</figcaption><pre><code class=\"language-rust\" data-line-numbers=\"true\" data-highlight-lines=\"2\">fn a() {}\nlet x = 1;\n</code></pre></figure>"
        ), "{}", r.html);
        assert!(r.html.contains("<pre><code>plain\n</code></pre>"));
        assert_eq!(r.code_languages, vec!["rust".to_string()]);
    }

    #[test]
    fn github_style_callouts() {
        let r = render(
            "> [!TIP]\n> Use **fresh** basil.\n\n> plain quote\n",
            RenderOptions::default(),
        );
        assert!(r.html.contains("<aside class=\"ob-callout ob-callout-tip\" role=\"note\"><p class=\"ob-callout-title\">Tip</p>"), "{}", r.html);
        assert!(r.html.contains("<strong>fresh</strong>"));
        assert!(r.html.contains("</aside>"));
        assert!(r.html.contains("<blockquote>\n<p>plain quote</p>"));
        assert!(!r.text.contains("[!TIP]"));
    }

    /// Every `<section>` opens and closes in the same container: count them per
    /// container by checking that no section boundary falls inside a quote,
    /// callout, list item or `<details>`.
    fn sections_balanced(html: &str) -> bool {
        let mut stack: Vec<&str> = Vec::new();
        let mut rest = html;
        while let Some(at) = rest.find('<') {
            rest = &rest[at..];
            let tag = |t: &str| rest.starts_with(t);
            for (open, close, name) in [
                ("<section", "</section>", "section"),
                ("<blockquote", "</blockquote>", "blockquote"),
                ("<aside", "</aside>", "aside"),
                ("<li", "</li>", "li"),
                ("<details", "</details>", "details"),
            ] {
                if tag(open) && !rest[open.len()..].starts_with(char::is_alphanumeric) {
                    stack.push(name);
                } else if tag(close) && stack.pop() != Some(name) {
                    return false;
                }
            }
            rest = &rest[1..];
        }
        stack.is_empty()
    }

    #[test]
    fn recipe_sections_respect_containers() {
        let opts = RenderOptions {
            recipe: true,
            ..RenderOptions::default()
        };
        let cases = [
            "## Ingredients\n\n- flour\n\n> ## Note\n> keep dry\n\nAfter quote.\n",
            "> [!TIP]\n> ## Ingredients\n> - flour\n\nStory paragraph after.\n",
            "## Ingredients\n\n- flour\n- ## Steps\n- mix\n",
            "<details>\n<summary>Recipe</summary>\n\n## Ingredients\n\n- a\n\n</details>\n\nMore story.\n",
            "## Steps\n\n1. Bake.[^1]\n\n[^1]:\n    - Ovens vary\n    - Check at 20 minutes\n",
        ];
        for md in cases {
            let r = render(md, opts);
            assert!(sections_balanced(&r.html), "{md}\n{}", r.html);
        }
        // A heading inside a quote neither closes nor opens a section.
        let r = render(cases[0], opts);
        assert!(
            r.html.contains("<blockquote>\n<h2 id=\"note\">"),
            "{}",
            r.html
        );
        // Lists in callouts and footnotes are not recipe lists.
        let r = render(
            "## Ingredients\n\n> [!TIP]\n> - Use fresh basil\n\n- 1 cup flour\n",
            opts,
        );
        assert_eq!(r.recipe_ingredients, vec!["1 cup flour"]);
        let r = render(cases[4], opts);
        assert_eq!(
            r.recipe_steps,
            vec!["Bake."],
            "the footnote list is not a step"
        );
        // A Method sub-heading inside Ingredients starts the steps.
        let r = render(
            "## Ingredients\n\n- 1 egg\n\n### Method\n\n1. Crack the egg.\n2. Fry 3 minutes.\n",
            opts,
        );
        assert_eq!(r.recipe_ingredients, vec!["1 egg"]);
        assert_eq!(r.recipe_steps, vec!["Crack the egg.", "Fry 3 minutes."]);
        assert!(r.html.contains("<ol class=\"ob-recipe-list ob-steps\">"));
        // A story heading that merely starts with "Step" is not a section.
        let r = render(
            "## Stephanie's story\n\n- Lyon\n\n## Ingredients\n\n- 1 egg\n",
            opts,
        );
        assert!(r.recipe_steps.is_empty());
        assert_eq!(r.recipe_anchor.as_deref(), Some("ingredients"));
    }

    #[test]
    fn recipe_sections_keep_html_and_footnotes_inside() {
        let opts = RenderOptions {
            recipe: true,
            ..RenderOptions::default()
        };
        let r = render(
            "## Ingredients\n\n<figure>\n  <img src=\"/x.jpg\" alt=\"mise en place\">\n</figure>\n\n- 1 cup flour\n- 2 eggs\n\n## Steps\n\n<video controls>\n<source src=\"/v.mp4\">\n</video>\n\n1. Mix.\n2. Bake 20 minutes.\n",
            opts,
        );
        assert_eq!(r.recipe_ingredients, vec!["1 cup flour", "2 eggs"]);
        assert_eq!(r.recipe_steps, vec!["Mix.", "Bake 20 minutes."]);
        assert!(!r.html.contains("</section>\n</figure>"), "{}", r.html);
        let r = render(
            "## Ingredients\n\n<div class=\"note\">\n\nSome tip\n\n</div>\n\n- a\n- b\n",
            opts,
        );
        assert_eq!(r.recipe_ingredients, vec!["a", "b"]);
        let r = render(
            "## Steps\n\n1. Bake.[^1]\n\n[^1]: Ovens vary.\n\n2. Cool.\n",
            opts,
        );
        assert!(
            r.recipe_steps.contains(&"Cool.".to_string()),
            "{:?}",
            r.recipe_steps
        );
        assert_eq!(html_line_depth("<details>"), 1);
        assert_eq!(html_line_depth("</details>"), -1);
        assert_eq!(html_line_depth("<img src=\"a\">"), 0);
        assert_eq!(html_line_depth("<p>closed</p>"), 0);
        assert_eq!(html_line_depth("<!-- note -->"), 0);
    }

    #[test]
    fn a_switched_sub_section_returns_to_its_parent() {
        let r = render(
            "## Method\n\n### Make the dough\n\n1. Mix.\n\n### Ingredients for the glaze\n\n- 1 cup sugar\n\n### Glaze the cake\n\n1. Pour the glaze.\n2. Chill 1 hour.\n\n## Notes\n\n- not a step\n",
            RenderOptions {
                recipe: true,
                ..RenderOptions::default()
            },
        );
        assert_eq!(r.recipe_ingredients, vec!["1 cup sugar"]);
        assert_eq!(
            r.recipe_steps,
            vec!["Mix.", "Pour the glaze.", "Chill 1 hour."]
        );
        assert!(sections_balanced(&r.html));
    }

    #[test]
    fn recipe_sections_are_wrapped_and_collected() {
        let md = "Intro story.\n\n## Ingredients\n\n### For the sauce\n\n- 2 cups *tomatoes*\n- 1 tsp salt\n\n### Pasta\n\n- 400 g spaghetti\n\n## Steps\n\n1. Boil water for\n   10 minutes.\n2. Toss.\n   - sub step\n\n## Notes\n\nKeeps 3 days.\n";
        let r = render(
            md,
            RenderOptions {
                recipe: true,
                ..RenderOptions::default()
            },
        );
        assert_eq!(
            r.recipe_ingredients,
            vec!["2 cups tomatoes", "1 tsp salt", "400 g spaghetti"]
        );
        assert_eq!(
            r.recipe_steps,
            vec!["Boil water for 10 minutes.", "Toss. sub step"]
        );
        assert_eq!(r.recipe_anchor.as_deref(), Some("ingredients"));
        assert!(r.html.contains(
            "<section class=\"ob-recipe-part ob-recipe-ingredients\">\n<h2 id=\"ingredients\">"
        ));
        assert_eq!(
            r.html
                .matches("<ul class=\"ob-recipe-list ob-ingredients\">")
                .count(),
            2
        );
        assert!(r.html.contains("<ol class=\"ob-recipe-list ob-steps\">"));
        assert!(
            r.html.contains("<ul>\n<li>sub step</li>"),
            "nested lists stay plain: {}",
            r.html
        );
        // Each section closes before the next h2, and Notes is outside both.
        let notes = r.html.find("id=\"notes\"").unwrap();
        assert_eq!(r.html[..notes].matches("</section>").count(), 2);
        assert_eq!(
            r.html.matches("<section").count(),
            r.html.matches("</section>").count()
        );

        let plain = render(md, RenderOptions::default());
        assert!(!plain.html.contains("ob-recipe"));
        assert!(plain.recipe_ingredients.is_empty());
    }
}
