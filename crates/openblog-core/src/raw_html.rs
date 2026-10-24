//! The portable projection's boundary for authored raw HTML.
//!
//! Raw HTML blocks and inline tags are tokenized and written out again from a
//! fixed allowlist, so no authored markup reaches a destination byte for byte.
//! Active or destination-hostile markup is removed, unwrapped, or replaced with
//! a link to the canonical article, and each kind of loss is reported on a
//! `raw-html` capability. URLs resolve like Markdown links; one that cannot be
//! made safe fails the projection. This is the projection's policy, not a
//! general-purpose HTML sanitizer.

use std::collections::HashSet;

use pulldown_cmark::{CowStr, Event, Tag, TagEnd};

use crate::capability::{CapabilityDescriptor, CapabilityDiagnosticCode};
use crate::escape;
use crate::portability::{PortableProjection, MAX_PORTABLE_NESTING_DEPTH};

/// Attributes any kept element may carry.
const GLOBAL_ATTRIBUTES: &[&str] = &[
    "id",
    "class",
    "title",
    "lang",
    "dir",
    "aria-label",
    "aria-labelledby",
    "aria-describedby",
];

/// Attributes whose value is a URL, resolved like a Markdown link.
const URL_ATTRIBUTES: &[&str] = &["href", "src", "cite"];

/// How many element or attribute names one diagnostic lists before "and N more".
const NAMES_PER_DIAGNOSTIC: usize = 6;

/// What the projection does with one authored element.
enum Policy {
    /// Written out again with the global and these element attributes.
    Keep {
        attributes: &'static [&'static str],
        void: bool,
    },
    /// Removed with everything inside it.
    Drop { raw_text: bool, void: bool },
    /// Removed with its content; a labeled link to the canonical article takes its place.
    Replace {
        label: &'static str,
        raw_text: bool,
        void: bool,
    },
    /// The tags are removed and the content is kept.
    Unwrap,
}

fn policy(name: &str) -> Policy {
    let keep = |attributes| Policy::Keep {
        attributes,
        void: false,
    };
    match name {
        "a" => keep(&["href", "hreflang", "rel"]),
        "img" => Policy::Keep {
            attributes: &["src", "alt", "width", "height"],
            void: true,
        },
        "br" | "hr" | "wbr" => Policy::Keep {
            attributes: &[],
            void: true,
        },
        "blockquote" | "q" => keep(&["cite"]),
        "del" | "ins" => keep(&["cite", "datetime"]),
        "time" => keep(&["datetime"]),
        "data" => keep(&["value"]),
        "ol" => keep(&["start", "reversed", "type"]),
        "li" => keep(&["value"]),
        "td" => keep(&["colspan", "rowspan", "headers"]),
        "th" => keep(&["colspan", "rowspan", "headers", "scope", "abbr"]),
        "colgroup" => keep(&["span"]),
        "col" => Policy::Keep {
            attributes: &["span"],
            void: true,
        },
        "details" => keep(&["open"]),
        "abbr" | "address" | "article" | "aside" | "b" | "bdi" | "bdo" | "caption" | "cite"
        | "code" | "dd" | "dfn" | "div" | "dl" | "dt" | "em" | "figcaption" | "figure" | "h1"
        | "h2" | "h3" | "h4" | "h5" | "h6" | "i" | "kbd" | "mark" | "p" | "pre" | "rp" | "rt"
        | "ruby" | "s" | "samp" | "section" | "small" | "span" | "strong" | "sub" | "summary"
        | "sup" | "table" | "tbody" | "tfoot" | "thead" | "tr" | "u" | "ul" | "var" => keep(&[]),
        "script" | "style" | "title" | "textarea" | "xmp" | "noembed" | "noframes" | "noscript"
        | "plaintext" => Policy::Drop {
            raw_text: true,
            void: false,
        },
        "template" | "head" | "button" | "select" | "datalist" => Policy::Drop {
            raw_text: false,
            void: false,
        },
        "base" | "meta" | "link" | "input" | "source" | "track" | "area" | "param" | "keygen" => {
            Policy::Drop {
                raw_text: false,
                void: true,
            }
        }
        "iframe" => Policy::Replace {
            label: "Embedded frame",
            raw_text: true,
            void: false,
        },
        "frameset" | "portal" => Policy::Replace {
            label: "Embedded frame",
            raw_text: false,
            void: false,
        },
        "frame" => Policy::Replace {
            label: "Embedded frame",
            raw_text: false,
            void: true,
        },
        "object" | "applet" => Policy::Replace {
            label: "Embedded object",
            raw_text: false,
            void: false,
        },
        "embed" => Policy::Replace {
            label: "Embedded object",
            raw_text: false,
            void: true,
        },
        "video" | "audio" | "canvas" | "svg" | "math" => Policy::Replace {
            label: match name {
                "video" => "Video",
                "audio" => "Audio",
                "canvas" => "Interactive graphic",
                "svg" => "Illustration",
                _ => "Math",
            },
            raw_text: false,
            void: false,
        },
        // Forms, page landmarks, presentational, custom, and unknown elements.
        _ => Policy::Unwrap,
    }
}

/// One piece of an authored HTML fragment.
enum Token<'s> {
    Text(&'s str),
    /// Comments, doctypes, processing instructions, and CDATA: never output.
    Ignored,
    Start {
        name: String,
        attributes: Vec<(String, String)>,
        self_closing: bool,
    },
    End {
        name: String,
    },
}

fn is_space(byte: u8) -> bool {
    matches!(byte, b' ' | b'\t' | b'\n' | b'\x0c' | b'\r')
}

/// The token at `at` and where the next one starts. Anything that is not
/// complete markup is text, so a stray `<` is escaped rather than guessed at.
fn next_token(source: &str, at: usize) -> (Token<'_>, usize) {
    let rest = &source[at..];
    if !rest.starts_with('<') {
        let end = rest.find('<').map_or(source.len(), |index| at + index);
        return (Token::Text(&source[at..end]), end);
    }
    if let Some(body) = rest.strip_prefix("<!--") {
        // An unterminated comment hides the rest of the fragment, as in a browser.
        let length = if body.starts_with('>') {
            1
        } else if body.starts_with("->") {
            2
        } else {
            [
                body.find("-->").map(|index| index + 3),
                body.find("--!>").map(|index| index + 4),
            ]
            .into_iter()
            .flatten()
            .min()
            .unwrap_or(body.len())
        };
        return (Token::Ignored, at + 4 + length);
    }
    if rest.starts_with("<!") || rest.starts_with("<?") {
        let end = rest.find('>').map_or(source.len(), |index| at + index + 1);
        return (Token::Ignored, end);
    }
    let (closing, name_at) = match rest.strip_prefix("</") {
        Some(_) => (true, 2),
        None => (false, 1),
    };
    if !rest[name_at..].starts_with(|c: char| c.is_ascii_alphabetic()) {
        return (Token::Text(&rest[..1]), at + 1);
    }
    match parse_tag(rest, name_at) {
        Some((name, _, _, length)) if closing => (Token::End { name }, at + length),
        Some((name, attributes, self_closing, length)) => (
            Token::Start {
                name,
                attributes,
                self_closing,
            },
            at + length,
        ),
        None => (Token::Text(&rest[..1]), at + 1),
    }
}

type ParsedTag = (String, Vec<(String, String)>, bool, usize);

/// A tag's lowercase name, decoded attributes (the first of a repeated name
/// wins), whether it ends in `/>`, and its length; `None` when it never ends.
fn parse_tag(rest: &str, name_at: usize) -> Option<ParsedTag> {
    let bytes = rest.as_bytes();
    let length = bytes.len();
    let mut i = name_at;
    while i < length && !is_space(bytes[i]) && !matches!(bytes[i], b'/' | b'>') {
        i += 1;
    }
    let name = rest[name_at..i].to_ascii_lowercase();
    let mut attributes: Vec<(String, String)> = Vec::new();
    let mut self_closing = false;
    loop {
        while i < length && (is_space(bytes[i]) || bytes[i] == b'/') {
            self_closing = bytes[i] == b'/';
            i += 1;
        }
        if i >= length {
            return None;
        }
        if bytes[i] == b'>' {
            return Some((name, attributes, self_closing, i + 1));
        }
        self_closing = false;
        let start = i;
        i += 1;
        while i < length && !is_space(bytes[i]) && !matches!(bytes[i], b'/' | b'>' | b'=') {
            i += 1;
        }
        let attribute = rest[start..i].to_ascii_lowercase();
        while i < length && is_space(bytes[i]) {
            i += 1;
        }
        let mut value = String::new();
        if i < length && bytes[i] == b'=' {
            i += 1;
            while i < length && is_space(bytes[i]) {
                i += 1;
            }
            match bytes.get(i)? {
                quote @ (b'"' | b'\'') => {
                    let end = i + 1 + rest[i + 1..].find(*quote as char)?;
                    value = decode(&rest[i + 1..end]);
                    i = end + 1;
                }
                _ => {
                    let start = i;
                    while i < length && !is_space(bytes[i]) && bytes[i] != b'>' {
                        i += 1;
                    }
                    value = decode(&rest[start..i]);
                }
            }
        }
        if !attributes.iter().any(|(name, _)| *name == attribute) {
            attributes.push((attribute, value));
        }
    }
}

/// Named character references decoded in attribute values. An unknown name
/// stays literal; values are escaped again on output, so a destination reads
/// exactly the value that was validated.
const NAMED_REFERENCES: &[(&str, char)] = &[
    ("amp", '&'),
    ("lt", '<'),
    ("gt", '>'),
    ("quot", '"'),
    ("apos", '\''),
    ("nbsp", '\u{a0}'),
    ("Tab", '\t'),
    ("NewLine", '\n'),
    ("colon", ':'),
    ("sol", '/'),
    ("bsol", '\\'),
    ("lpar", '('),
    ("rpar", ')'),
    ("period", '.'),
    ("comma", ','),
    ("semi", ';'),
    ("num", '#'),
    ("excl", '!'),
    ("quest", '?'),
    ("equals", '='),
    ("plus", '+'),
    ("percnt", '%'),
    ("commat", '@'),
    ("lowbar", '_'),
    ("grave", '`'),
    ("copy", '©'),
    ("reg", '®'),
    ("trade", '™'),
    ("hellip", '…'),
    ("ndash", '–'),
    ("mdash", '—'),
    ("lsquo", '‘'),
    ("rsquo", '’'),
    ("ldquo", '“'),
    ("rdquo", '”'),
    ("laquo", '«'),
    ("raquo", '»'),
    ("middot", '·'),
    ("deg", '°'),
    ("times", '×'),
];

fn decode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut rest = value;
    while let Some(at) = rest.find('&') {
        out.push_str(&rest[..at]);
        rest = &rest[at..];
        match reference(rest) {
            Some((character, length)) => {
                out.push(character);
                rest = &rest[length..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

/// The character a reference at the start of `input` (which begins with `&`)
/// stands for, and its length.
fn reference(input: &str) -> Option<(char, usize)> {
    if let Some(numeric) = input.strip_prefix("&#") {
        let (digits, radix, prefix) = match numeric.strip_prefix(['x', 'X']) {
            Some(hex) => (hex, 16, 3),
            None => (numeric, 10, 2),
        };
        let count = digits
            .bytes()
            .take_while(|byte| (*byte as char).is_digit(radix))
            .count();
        if count == 0 {
            return None;
        }
        let code = digits[..count].chars().fold(0u32, |code, digit| {
            code.saturating_mul(radix)
                .saturating_add(digit.to_digit(radix).unwrap_or(0))
        });
        let character = char::from_u32(code)
            .filter(|character| *character != '\0')
            .unwrap_or('\u{fffd}');
        let semicolon = usize::from(digits[count..].starts_with(';'));
        return Some((character, prefix + count + semicolon));
    }
    let name_length = input[1..]
        .bytes()
        .take_while(u8::is_ascii_alphanumeric)
        .count();
    let name = &input[1..1 + name_length];
    if !input[1 + name_length..].starts_with(';') {
        return None;
    }
    NAMED_REFERENCES
        .iter()
        .find(|(known, _)| *known == name)
        .map(|(_, character)| (*character, name_length + 2))
}

/// Text between tags: character references are kept as written, and a `<` or
/// `>` that is not part of markup is escaped.
fn push_text(out: &mut String, text: &str) {
    for character in text.chars() {
        match character {
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            _ => out.push(character),
        }
    }
}

/// A name as a diagnostic lists it; anything unusual is not echoed.
fn listed(name: &str) -> &str {
    if !name.is_empty()
        && name.len() <= 32
        && name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b':'))
    {
        name
    } else {
        "unrecognized"
    }
}

/// Content removed from the portable copy, grouped for the `raw-html` report.
#[derive(Default)]
struct Losses {
    dropped: Vec<String>,
    removed: Vec<String>,
    unwrapped: Vec<String>,
    replaced: Vec<String>,
    attributes: Vec<String>,
    ids: usize,
}

fn note(group: &mut Vec<String>, name: String) {
    if !group.contains(&name) {
        group.push(name);
    }
}

fn names(group: &[String], tags: bool) -> String {
    let mut listed: Vec<String> = group
        .iter()
        .take(NAMES_PER_DIAGNOSTIC)
        .map(|name| {
            if tags {
                format!("<{name}>")
            } else {
                name.clone()
            }
        })
        .collect();
    if group.len() > NAMES_PER_DIAGNOSTIC {
        listed.push(format!("and {} more", group.len() - NAMES_PER_DIAGNOSTIC));
    }
    listed.join(", ")
}

impl Losses {
    fn report(&self) -> Option<CapabilityDescriptor> {
        let mut messages = Vec::new();
        for (group, prefix) in [
            (&self.dropped, "Removed with their content"),
            (&self.removed, "Removed"),
            (&self.unwrapped, "Kept the content but removed the tags"),
            (
                &self.replaced,
                "Replaced with a link to the original article",
            ),
        ] {
            if !group.is_empty() {
                messages.push(format!("{prefix}: {}.", names(group, true)));
            }
        }
        if !self.attributes.is_empty() {
            messages.push(format!(
                "Removed attributes: {}.",
                names(&self.attributes, false)
            ));
        }
        if self.ids > 0 {
            messages.push(format!(
                "Removed {} duplicate, reserved, or invalid id{}.",
                self.ids,
                if self.ids == 1 { "" } else { "s" }
            ));
        }
        if messages.is_empty() {
            return None;
        }
        let mut descriptor = CapabilityDescriptor::describe("raw-html", None);
        for message in messages {
            descriptor.add_diagnostic(CapabilityDiagnosticCode::RemovedMarkup, &message);
        }
        Some(descriptor)
    }
}

/// A removed element whose content is still being skipped.
struct Skip {
    name: String,
    raw_text: bool,
    nested: usize,
    /// The Markdown depth it opened at; inline text there is skipped too, until
    /// that container ends.
    depth: usize,
}

struct RawHtml<'p, 'a> {
    projection: &'p PortableProjection<'a>,
    /// Ids the projection writes itself (headings and footnotes).
    reserved: HashSet<String>,
    ids: HashSet<String>,
    /// Kept elements still open, with the Markdown depth that opened them.
    open: Vec<(String, usize)>,
    skip: Option<Skip>,
    /// Open Markdown containers.
    depth: usize,
    losses: Losses,
}

/// Apply the raw HTML policy to parsed events whose links are already
/// resolved and whose headings already have ids. Returns the events and, when
/// anything authored was removed, the `raw-html` capability that reports it.
pub(crate) fn sanitize<'e>(
    events: Vec<Event<'e>>,
    projection: &PortableProjection<'_>,
) -> Result<(Vec<Event<'e>>, Option<CapabilityDescriptor>), String> {
    let reserved = events
        .iter()
        .filter_map(|event| match event {
            Event::Start(Tag::Heading { id: Some(id), .. }) => Some(id.to_string()),
            Event::Start(Tag::FootnoteDefinition(name)) => Some(name.to_string()),
            _ => None,
        })
        .collect();
    let mut state = RawHtml {
        projection,
        reserved,
        ids: HashSet::new(),
        open: Vec::new(),
        skip: None,
        depth: 0,
        losses: Losses::default(),
    };
    let mut out = Vec::with_capacity(events.len());
    // Raw block HTML arrives a line at a time; each block is handled whole.
    let mut block: Option<String> = None;
    for event in events {
        match event {
            Event::Start(Tag::HtmlBlock) => {
                block = Some(String::new());
                out.push(Event::Start(Tag::HtmlBlock));
            }
            Event::Html(html) if block.is_some() => {
                if let Some(block) = block.as_mut() {
                    block.push_str(&html);
                }
            }
            Event::End(TagEnd::HtmlBlock) => {
                let source = block.take().unwrap_or_default();
                out.push(Event::Html(CowStr::from(state.fragment(&source)?)));
                out.push(Event::End(TagEnd::HtmlBlock));
            }
            Event::Html(html) | Event::InlineHtml(html) => {
                out.push(Event::InlineHtml(CowStr::from(state.fragment(&html)?)));
            }
            Event::Start(mut tag) => {
                state.depth += 1;
                state.check_depth()?;
                // `{key=value}` heading attributes are authored markup too.
                if let Tag::Heading { attrs, .. } = &mut tag {
                    for (attribute, _) in attrs.drain(..) {
                        state.remove_attribute(&attribute.to_ascii_lowercase());
                    }
                }
                out.push(Event::Start(tag));
            }
            Event::End(tag) => {
                let closes = state.close_from(state.depth);
                if !closes.is_empty() {
                    out.push(Event::InlineHtml(CowStr::from(closes)));
                }
                if state
                    .skip
                    .as_ref()
                    .is_some_and(|skip| skip.depth >= state.depth)
                {
                    state.skip = None;
                }
                state.depth = state.depth.saturating_sub(1);
                out.push(Event::End(tag));
            }
            Event::Text(_) | Event::Code(_) | Event::SoftBreak | Event::HardBreak
                if state
                    .skip
                    .as_ref()
                    .is_some_and(|skip| skip.depth == state.depth) => {}
            other => out.push(other),
        }
    }
    let closes = state.close_from(0);
    if !closes.is_empty() {
        out.push(Event::Html(CowStr::from(closes)));
    }
    Ok((out, state.losses.report()))
}

impl RawHtml<'_, '_> {
    fn check_depth(&self) -> Result<(), String> {
        if self.depth + self.open.len() > MAX_PORTABLE_NESTING_DEPTH {
            return Err(format!(
                "{}: portable HTML would nest more than {MAX_PORTABLE_NESTING_DEPTH} elements deep; simplify the nesting (nothing was truncated)",
                self.projection.source_path()
            ));
        }
        Ok(())
    }

    /// Close the kept elements opened at `depth` or deeper.
    fn close_from(&mut self, depth: usize) -> String {
        let mut html = String::new();
        while self.open.last().is_some_and(|(_, open)| *open >= depth) {
            if let Some((name, _)) = self.open.pop() {
                html.push_str(&format!("</{name}>"));
            }
        }
        html
    }

    fn remove_attribute(&mut self, attribute: &str) {
        let name = if attribute.starts_with("on") {
            "event handlers".to_string()
        } else if attribute.starts_with("data-") {
            "data-*".to_string()
        } else {
            listed(attribute).to_string()
        };
        note(&mut self.losses.attributes, name);
    }

    fn fragment(&mut self, source: &str) -> Result<String, String> {
        let mut html = String::new();
        let mut at = 0;
        while at < source.len() {
            if self.skip.is_some() {
                at = self.skip_content(source, at);
                continue;
            }
            let (token, next) = next_token(source, at);
            at = next;
            match token {
                Token::Text(text) => push_text(&mut html, text),
                Token::Ignored => {}
                Token::Start {
                    name,
                    attributes,
                    self_closing,
                } => self.start(&mut html, name, attributes, self_closing)?,
                Token::End { name } => self.end(&mut html, &name),
            }
        }
        Ok(html)
    }

    /// Skip a removed element's content from `at`, returning where output resumes.
    fn skip_content(&mut self, source: &str, mut at: usize) -> usize {
        let Some(skip) = self.skip.as_mut() else {
            return at;
        };
        if skip.raw_text {
            // Nothing inside is markup until the matching end tag, in any case.
            while let Some(found) = source[at..].find("</") {
                let start = at + found;
                let name_end = start + 2 + skip.name.len();
                if source
                    .get(start + 2..name_end)
                    .is_some_and(|name| name.eq_ignore_ascii_case(&skip.name))
                    && source
                        .as_bytes()
                        .get(name_end)
                        .is_none_or(|byte| is_space(*byte) || matches!(byte, b'/' | b'>'))
                {
                    self.skip = None;
                    let (_, next) = next_token(source, start);
                    return next;
                }
                at = start + 2;
            }
            return source.len();
        }
        while at < source.len() {
            let (token, next) = next_token(source, at);
            at = next;
            match token {
                Token::Start {
                    name, self_closing, ..
                } if name == skip.name && !self_closing => skip.nested += 1,
                Token::End { name } if name == skip.name => {
                    if skip.nested == 0 {
                        self.skip = None;
                        return at;
                    }
                    skip.nested -= 1;
                }
                _ => {}
            }
        }
        at
    }

    fn start(
        &mut self,
        html: &mut String,
        name: String,
        attributes: Vec<(String, String)>,
        self_closing: bool,
    ) -> Result<(), String> {
        let (raw_text, void) = match policy(&name) {
            Policy::Keep {
                attributes: allowed,
                void,
            } => return self.keep(html, name, attributes, allowed, void),
            Policy::Unwrap => {
                note(&mut self.losses.unwrapped, listed(&name).to_string());
                return Ok(());
            }
            Policy::Drop { raw_text, void } => {
                let group = if void {
                    &mut self.losses.removed
                } else {
                    &mut self.losses.dropped
                };
                note(group, listed(&name).to_string());
                (raw_text, void)
            }
            Policy::Replace {
                label,
                raw_text,
                void,
            } => {
                note(&mut self.losses.replaced, listed(&name).to_string());
                let title = attributes
                    .iter()
                    .find(|(attribute, value)| {
                        matches!(attribute.as_str(), "title" | "aria-label")
                            && !value.trim().is_empty()
                    })
                    .map(|(_, value)| format!(" ({})", escape::text(value.trim())))
                    .unwrap_or_default();
                html.push_str(&format!(
                    "<span class=\"ob-portable-note\"><strong>{label}</strong>{title}: see it on <a href=\"{}\">the original article</a>.</span>",
                    escape::attr(self.projection.canonical_url())
                ));
                (raw_text, void)
            }
        };
        // `<svg/>` closes itself; `<script/>` still opens raw text in a browser.
        if !void && (raw_text || !self_closing) {
            self.skip = Some(Skip {
                name,
                raw_text,
                nested: 0,
                depth: self.depth,
            });
        }
        Ok(())
    }

    fn keep(
        &mut self,
        html: &mut String,
        name: String,
        attributes: Vec<(String, String)>,
        allowed: &[&str],
        void: bool,
    ) -> Result<(), String> {
        if !void {
            self.open.push((name.clone(), self.depth));
            if let Err(error) = self.check_depth() {
                self.open.pop();
                return Err(error);
            }
        }
        html.push('<');
        html.push_str(&name);
        let has_id = attributes.iter().any(|(attribute, _)| attribute == "id");
        for (attribute, value) in attributes {
            // A legacy `<a name>` anchor keeps working as an id.
            let attribute = if name == "a" && attribute == "name" && !has_id {
                "id".to_string()
            } else {
                attribute
            };
            if attribute.starts_with("on")
                || !(GLOBAL_ATTRIBUTES.contains(&attribute.as_str())
                    || allowed.contains(&attribute.as_str()))
            {
                self.remove_attribute(&attribute);
                continue;
            }
            let value = if URL_ATTRIBUTES.contains(&attribute.as_str()) {
                self.projection
                    .resolve_link(&value)
                    .map_err(|error| format!("{error} (raw HTML <{name} {attribute}>)"))?
            } else if attribute == "id" {
                let unique = !value.is_empty()
                    && !value.bytes().any(is_space)
                    && !value.starts_with("ob-")
                    && !self.reserved.contains(&value)
                    && self.ids.insert(value.clone());
                if !unique {
                    self.losses.ids += 1;
                    continue;
                }
                value
            } else {
                value
            };
            if value.is_empty() && matches!(attribute.as_str(), "open" | "reversed") {
                html.push_str(&format!(" {attribute}"));
            } else {
                html.push_str(&format!(" {attribute}=\"{}\"", escape::attr(&value)));
            }
        }
        html.push('>');
        Ok(())
    }

    /// A kept element's end tag closes it (and anything opened inside it) when
    /// it was opened in the same Markdown container; other end tags are dropped.
    fn end(&mut self, html: &mut String, name: &str) {
        if !matches!(policy(name), Policy::Keep { void: false, .. }) {
            return;
        }
        let Some(position) = self
            .open
            .iter()
            .rposition(|(open, depth)| open == name && *depth == self.depth)
        else {
            return;
        };
        for (open, _) in self.open.drain(position..).rev() {
            html.push_str(&format!("</{open}>"));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn attribute_values_decode_references_before_they_are_checked() {
        assert_eq!(decode("java&#x73;cript&colon;x"), "javascript:x");
        assert_eq!(decode("&#106&#97;"), "ja");
        assert_eq!(decode("a&b=c&amp;d&unknown;"), "a&b=c&d&unknown;");
        assert_eq!(
            decode("&#0;&#x110000;&#99999999999;"),
            "\u{fffd}\u{fffd}\u{fffd}"
        );
        assert_eq!(decode("&Tab;&NewLine;"), "\t\n");
        assert_eq!(decode("&#;&#x;&"), "&#;&#x;&");
    }

    #[test]
    fn malformed_tags_are_text_and_never_panic() {
        for source in [
            "<",
            "<a",
            "<a href=\"x",
            "<a href='x>",
            "<a href=",
            "</",
            "</a",
            "<é>",
            "<a é=\"ü\">",
            "<!--",
            "<!",
            "<?",
            "<a\u{0}b>",
        ] {
            let mut at = 0;
            while at < source.len() {
                let (_, next) = next_token(source, at);
                assert!(next > at, "{source:?}");
                at = next;
            }
        }
        let (token, _) = next_token("<a href=\"x", 0);
        assert!(matches!(token, Token::Text("<")));
        let (token, next) = next_token("<A HREF=x Title='T' href=y/>", 0);
        let Token::Start {
            name,
            attributes,
            self_closing,
        } = token
        else {
            panic!("start tag");
        };
        assert_eq!(name, "a");
        assert_eq!(
            attributes,
            [
                ("href".to_string(), "x".to_string()),
                ("title".to_string(), "T".to_string())
            ]
        );
        assert!(!self_closing, "an unquoted value keeps its slash");
        assert_eq!(next, 28);
    }
}
