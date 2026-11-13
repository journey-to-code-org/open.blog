//! Diagram colours follow the look (ADR 0417).
//!
//! The renderer paints with fixed colours. This pass rewrites every colour it chose into a CSS
//! variable with that colour as the fallback, `fill:var(--ob-diagram-line, #666666)`, so one built
//! SVG takes the look's colours on a page in light and dark (the variables are defined beside
//! `.ob-diagram` in `web/base.css`, from the look's own tokens), while the same file opened on its
//! own, in a feed or an export, still shows the renderer's colours.
//!
//! Each colour is given a role by what it looks like: a near-grey colour is text when dark, a fill
//! when light and a line in between; a light tint is a highlight; any other colour is one of six
//! accents by its hue. Colours the author wrote in `style`, `classDef` or `linkStyle` lines are kept
//! exactly, and [`authored_colour_findings`] checks that they stay readable.
//!
//! Presentation attributes cannot hold `var()`, so a colour attribute (`fill="#eaeaea"`) moves into
//! the element's `style`. The result is parsed and checked again by the SVG boundary afterwards.

use crate::look_contrast::{contrast, Rgb};

/// The colour properties rewritten in CSS text and style attributes.
const PROPERTIES: [&str; 9] = [
    "fill",
    "stroke",
    "color",
    "stop-color",
    "flood-color",
    "background-color",
    "background",
    "border-color",
    "border",
];

/// The presentation attributes moved into `style` when their colour is rewritten.
const ATTRIBUTES: [&str; 5] = ["fill", "stroke", "color", "stop-color", "flood-color"];

/// The variables a diagram can use, for tests and the stylesheet's contract.
pub const VARIABLES: [&str; 10] = [
    "--ob-diagram-text",
    "--ob-diagram-fill",
    "--ob-diagram-line",
    "--ob-diagram-highlight",
    "--ob-diagram-accent-1",
    "--ob-diagram-accent-2",
    "--ob-diagram-accent-3",
    "--ob-diagram-accent-4",
    "--ob-diagram-accent-5",
    "--ob-diagram-accent-6",
];

/// A colour value as written, with its parsed red, green, blue and alpha.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Colour {
    r: f64,
    g: f64,
    b: f64,
    a: f64,
}

impl Colour {
    fn rgb(self) -> Rgb {
        let channel = |v: f64| v.round().clamp(0.0, 255.0) as u8;
        Rgb(channel(self.r), channel(self.g), channel(self.b))
    }

    fn hex(self) -> String {
        self.rgb().hex()
    }

    /// Hue in degrees, saturation and lightness (0..1), as HSL.
    fn hsl(self) -> (f64, f64, f64) {
        let (r, g, b) = (self.r / 255.0, self.g / 255.0, self.b / 255.0);
        let max = r.max(g).max(b);
        let min = r.min(g).min(b);
        let l = (max + min) / 2.0;
        if (max - min).abs() < f64::EPSILON {
            return (0.0, 0.0, l);
        }
        let d = max - min;
        let s = if l > 0.5 {
            d / (2.0 - max - min)
        } else {
            d / (max + min)
        };
        let h = if (max - r).abs() < f64::EPSILON {
            (g - b) / d + if g < b { 6.0 } else { 0.0 }
        } else if (max - g).abs() < f64::EPSILON {
            (b - r) / d + 2.0
        } else {
            (r - g) / d + 4.0
        };
        (h * 60.0, s, l)
    }
}

/// Parse a CSS colour: `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()`, `rgba()`, `hsl()`,
/// `hsla()` and the few named colours renderers use. Anything else is `None` and left alone.
fn parse(value: &str) -> Option<Colour> {
    let value = value.trim();
    let lower = value.to_ascii_lowercase();
    if let Some(hex) = lower.strip_prefix('#') {
        let digits: Vec<u8> = hex
            .chars()
            .map(|c| c.to_digit(16).map(|d| d as u8))
            .collect::<Option<_>>()?;
        let (r, g, b, a) = match digits.len() {
            3 => (digits[0] * 17, digits[1] * 17, digits[2] * 17, 255),
            4 => (
                digits[0] * 17,
                digits[1] * 17,
                digits[2] * 17,
                digits[3] * 17,
            ),
            6 => (
                digits[0] * 16 + digits[1],
                digits[2] * 16 + digits[3],
                digits[4] * 16 + digits[5],
                255,
            ),
            8 => (
                digits[0] * 16 + digits[1],
                digits[2] * 16 + digits[3],
                digits[4] * 16 + digits[5],
                digits[6] * 16 + digits[7],
            ),
            _ => return None,
        };
        return Some(Colour {
            r: r.into(),
            g: g.into(),
            b: b.into(),
            a: f64::from(a) / 255.0,
        });
    }
    let named = |r: f64, g: f64, b: f64| Some(Colour { r, g, b, a: 1.0 });
    match lower.as_str() {
        "white" => return named(255.0, 255.0, 255.0),
        "black" => return named(0.0, 0.0, 0.0),
        "red" => return named(255.0, 0.0, 0.0),
        "green" => return named(0.0, 128.0, 0.0),
        "blue" => return named(0.0, 0.0, 255.0),
        "grey" | "gray" => return named(128.0, 128.0, 128.0),
        "lightgrey" | "lightgray" => return named(211.0, 211.0, 211.0),
        "darkgrey" | "darkgray" => return named(169.0, 169.0, 169.0),
        _ => {}
    }
    let (function, rest) = lower.split_once('(')?;
    let inner = rest.strip_suffix(')')?;
    let parts: Vec<&str> = inner
        .split(|c: char| c == ',' || c == '/' || c.is_whitespace())
        .filter(|part| !part.is_empty())
        .collect();
    let number = |text: &str| -> Option<f64> {
        let text = text.trim();
        if let Some(percent) = text.strip_suffix('%') {
            percent.parse::<f64>().ok().map(|p| p / 100.0)
        } else {
            text.parse::<f64>().ok()
        }
    };
    let alpha = |index: usize| -> Option<f64> {
        match parts.get(index) {
            None => Some(1.0),
            Some(text) => number(text).map(|a| a.clamp(0.0, 1.0)),
        }
    };
    match function {
        "rgb" | "rgba" if parts.len() >= 3 => {
            let channel = |text: &str| -> Option<f64> {
                if text.ends_with('%') {
                    number(text).map(|p| p * 255.0)
                } else {
                    number(text)
                }
            };
            Some(Colour {
                r: channel(parts[0])?,
                g: channel(parts[1])?,
                b: channel(parts[2])?,
                a: alpha(3)?,
            })
        }
        "hsl" | "hsla" if parts.len() >= 3 => {
            let h = parts[0].trim_end_matches("deg").parse::<f64>().ok()?;
            let s = number(parts[1])?.clamp(0.0, 1.0);
            let l = number(parts[2])?.clamp(0.0, 1.0);
            let (r, g, b) = hsl_to_rgb(h.rem_euclid(360.0), s, l);
            Some(Colour {
                r,
                g,
                b,
                a: alpha(3)?,
            })
        }
        _ => None,
    }
}

fn hsl_to_rgb(h: f64, s: f64, l: f64) -> (f64, f64, f64) {
    let c = (1.0 - (2.0 * l - 1.0).abs()) * s;
    let x = c * (1.0 - ((h / 60.0) % 2.0 - 1.0).abs());
    let m = l - c / 2.0;
    let (r, g, b) = match h {
        h if h < 60.0 => (c, x, 0.0),
        h if h < 120.0 => (x, c, 0.0),
        h if h < 180.0 => (0.0, c, x),
        h if h < 240.0 => (0.0, x, c),
        h if h < 300.0 => (x, 0.0, c),
        _ => (c, 0.0, x),
    };
    ((r + m) * 255.0, (g + m) * 255.0, (b + m) * 255.0)
}

/// The variable a renderer colour plays in the look. A line (`stroke`, `border`) is never given a
/// fill's role: a light line becomes the line colour, or an accent when it has a hue.
fn role(colour: Colour, line: bool) -> &'static str {
    let (hue, saturation, lightness) = colour.hsl();
    let luminance = colour.rgb().luminance();
    // Very dark colours read as ink, whatever their tint.
    if luminance <= 0.03 {
        return "--ob-diagram-text";
    }
    if saturation < 0.2 || lightness > 0.97 {
        if line && luminance > 0.05 {
            "--ob-diagram-line"
        } else if luminance >= 0.5 {
            "--ob-diagram-fill"
        } else if luminance <= 0.05 {
            "--ob-diagram-text"
        } else {
            "--ob-diagram-line"
        }
    } else if luminance >= 0.6 && !line {
        "--ob-diagram-highlight"
    } else {
        match hue {
            h if !(30.0..330.0).contains(&h) => "--ob-diagram-accent-1",
            h if h < 75.0 => "--ob-diagram-accent-2",
            h if h < 165.0 => "--ob-diagram-accent-3",
            h if h < 200.0 => "--ob-diagram-accent-4",
            h if h < 255.0 => "--ob-diagram-accent-5",
            _ => "--ob-diagram-accent-6",
        }
    }
}

/// The colours the author wrote in `style`, `classDef` and `linkStyle` lines, which are kept as
/// written.
pub fn authored_colours(source: &str) -> Vec<String> {
    let mut found = Vec::new();
    for line in source.lines() {
        let line = line.trim_start();
        let keyword = line.split_whitespace().next().unwrap_or("");
        if !matches!(keyword, "style" | "classDef" | "linkStyle") {
            continue;
        }
        for declaration in line.split([',', ' ', ';']) {
            if let Some((_, value)) = declaration.split_once(':') {
                if let Some(colour) = parse(value) {
                    found.push(colour.hex());
                }
            }
        }
    }
    found.sort();
    found.dedup();
    found
}

/// The rewrite of one colour value, or `None` to keep it.
fn themed(value: &str, property: &str, authored: &[String]) -> Option<String> {
    let colour = parse(value)?;
    if colour.a == 0.0 || authored.contains(&colour.hex()) {
        return None;
    }
    let line = matches!(property, "stroke" | "border" | "border-color");
    let variable = role(colour, line);
    let fallback = if colour.a < 1.0 {
        value.trim().to_string()
    } else {
        colour.hex()
    };
    let rewritten = format!("var({variable}, {fallback})");
    if colour.a < 1.0 {
        // Keep the transparency: mix the role's colour with nothing.
        Some(format!(
            "color-mix(in srgb, {rewritten} {}%, transparent)",
            (colour.a * 100.0).round()
        ))
    } else {
        Some(rewritten)
    }
}

/// Rewrite the colour properties in a run of CSS declarations or a stylesheet.
fn rewrite_css(css: &str, authored: &[String]) -> String {
    let mut out = String::with_capacity(css.len());
    let mut rest = css;
    while !rest.is_empty() {
        // Find the next property name that starts a declaration.
        let mut best: Option<(usize, &str)> = None;
        for property in PROPERTIES {
            let mut from = 0;
            while let Some(at) = rest[from..].find(property) {
                let at = from + at;
                let before = rest[..at].chars().next_back();
                let after = rest[at + property.len()..].trim_start();
                let boundary = before.is_none_or(|c| matches!(c, ';' | '{' | ' ' | '\n' | '\t'));
                if boundary && after.starts_with(':') {
                    if best.is_none_or(|(b, p)| at < b || (at == b && property.len() > p.len())) {
                        best = Some((at, property));
                    }
                    break;
                }
                from = at + property.len();
            }
        }
        let Some((at, property)) = best else {
            out.push_str(rest);
            break;
        };
        let colon = at + rest[at..].find(':').unwrap_or(0);
        out.push_str(&rest[..=colon]);
        let value_start = colon + 1;
        let value_end = rest[value_start..]
            .find([';', '}', '!'])
            .map_or(rest.len(), |end| value_start + end);
        let value = &rest[value_start..value_end];
        // A single colour, or a shorthand (`1px solid #666`): rewrite each colour inside it.
        let replaced = themed(value, property, authored).unwrap_or_else(|| {
            top_level_words(value)
                .into_iter()
                .map(|part| themed(part, property, authored).unwrap_or_else(|| part.to_string()))
                .collect::<Vec<_>>()
                .join(" ")
        });
        out.push_str(&replaced);
        rest = &rest[value_end..];
    }
    out
}

/// The space-separated words of a CSS value, keeping `rgb(1, 2, 3)` and the like whole.
fn top_level_words(value: &str) -> Vec<&str> {
    let mut words = Vec::new();
    let mut depth = 0usize;
    let mut start = None;
    for (at, c) in value.char_indices() {
        match c {
            '(' => depth += 1,
            ')' => depth = depth.saturating_sub(1),
            c if c.is_whitespace() && depth == 0 => {
                if let Some(from) = start.take() {
                    words.push(&value[from..at]);
                }
                continue;
            }
            _ => {}
        }
        if start.is_none() {
            start = Some(at);
        }
    }
    if let Some(from) = start {
        words.push(&value[from..]);
    }
    words
}

/// Rewrite one start tag: its `style`, and colour attributes moved into `style`.
fn rewrite_tag(tag: &str, authored: &[String]) -> String {
    // tag is `<name attr="v" ...>` or `.../>`
    let (body, close) = if let Some(body) = tag.strip_suffix("/>") {
        (body, "/>")
    } else {
        (tag.strip_suffix('>').unwrap_or(tag), ">")
    };
    let name_end = body.find(|c: char| c.is_whitespace()).unwrap_or(body.len());
    let mut out = String::from(&body[..name_end]);
    let mut rest = &body[name_end..];
    let mut style: Option<String> = None;
    let mut moved = String::new();
    loop {
        let trimmed = rest.trim_start();
        if trimmed.is_empty() {
            break;
        }
        let Some(eq) = trimmed.find('=') else {
            out.push(' ');
            out.push_str(trimmed);
            break;
        };
        let name = trimmed[..eq].trim();
        let after = trimmed[eq + 1..].trim_start();
        let Some(quote) = after.chars().next().filter(|c| *c == '"' || *c == '\'') else {
            out.push(' ');
            out.push_str(trimmed);
            break;
        };
        let Some(end) = after[1..].find(quote) else {
            out.push(' ');
            out.push_str(trimmed);
            break;
        };
        let value = &after[1..1 + end];
        rest = &after[end + 2..];
        if name == "style" {
            style = Some(rewrite_css(value, authored));
            continue;
        }
        if ATTRIBUTES.contains(&name) {
            if let Some(new) = themed(value, name, authored) {
                moved.push_str(&format!("{name}:{new};"));
                continue;
            }
        }
        out.push_str(&format!(" {name}={quote}{value}{quote}"));
    }
    if style.is_some() || !moved.is_empty() {
        // Attributes come before the inline style so the style wins, as it did.
        let mut combined = moved;
        if let Some(style) = style {
            combined.push_str(&style);
        }
        out.push_str(&format!(" style=\"{}\"", combined.replace('"', "&quot;")));
    }
    out.push_str(close);
    out
}

/// Rewrite the renderer's colours in a diagram SVG to the look's variables (see the module
/// documentation). `source` is the Mermaid text, whose own colours are kept.
pub fn apply(svg: &str, source: &str) -> String {
    let authored = authored_colours(source);
    let mut out = String::with_capacity(svg.len() + svg.len() / 4);
    let mut rest = svg;
    while let Some(at) = rest.find('<') {
        out.push_str(&rest[..at]);
        rest = &rest[at..];
        let is_tag = rest[1..]
            .chars()
            .next()
            .is_some_and(|c| c.is_ascii_alphabetic());
        if !is_tag {
            // Closing tags, comments, CDATA and declarations are copied as they are.
            let end = rest.find('>').map_or(rest.len(), |end| end + 1);
            out.push_str(&rest[..end]);
            rest = &rest[end..];
            continue;
        }
        let mut quote = None;
        let mut end = rest.len();
        for (offset, c) in rest.char_indices().skip(1) {
            match (quote, c) {
                (None, '"' | '\'') => quote = Some(c),
                (Some(q), c) if c == q => quote = None,
                (None, '>') => {
                    end = offset + 1;
                    break;
                }
                _ => {}
            }
        }
        let tag = &rest[..end];
        out.push_str(&rewrite_tag(tag, &authored));
        rest = &rest[end..];
        if tag.starts_with("<style") && !tag.ends_with("/>") {
            let close = rest.find("</style>").unwrap_or(rest.len());
            out.push_str(&rewrite_css(&rest[..close], &authored));
            rest = &rest[close..];
        }
    }
    out.push_str(rest);
    // The renderer's font follows the look's body font, keeping its own as the fallback.
    out.replace("font-family:", "font-family:var(--ob-font-body),")
}

/// Colours the author wrote that may be unreadable: a fill with no text colour of its own
/// (the text follows the look, so it changes between light and dark), or a fill and text colour
/// below WCAG AA's 4.5:1.
pub fn authored_colour_findings(source: &str) -> Vec<String> {
    let mut findings = Vec::new();
    for (index, line) in source.lines().enumerate() {
        let trimmed = line.trim_start();
        let keyword = trimmed.split_whitespace().next().unwrap_or("");
        if !matches!(keyword, "style" | "classDef") {
            continue;
        }
        let mut fill = None;
        let mut text = None;
        for declaration in trimmed.split([',', ' ', ';']) {
            if let Some((name, value)) = declaration.split_once(':') {
                match name.trim() {
                    "fill" => fill = parse(value),
                    "color" => text = parse(value),
                    _ => {}
                }
            }
        }
        let Some(fill) = fill else { continue };
        match text {
            None => findings.push(format!(
                "diagram line {}: a style sets a fill without a text colour; add `color:` so its text stays readable in light and dark",
                index + 1
            )),
            Some(text) => {
                let ratio = contrast(fill.rgb(), text.rgb());
                if ratio < 4.5 {
                    findings.push(format!(
                        "diagram line {}: text {} on {} has a contrast of {ratio:.1}:1; it needs at least 4.5:1",
                        index + 1,
                        text.hex(),
                        fill.hex()
                    ));
                }
            }
        }
    }
    findings
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn colours_parse_in_every_form_renderers_write() {
        assert_eq!(parse("#fff").unwrap().hex(), "#ffffff");
        assert_eq!(parse("#28253D").unwrap().hex(), "#28253d");
        assert_eq!(parse("rgb(146.5, 0, 255)").unwrap().hex(), "#9300ff");
        assert_eq!(parse("hsl(-120, 0%, 80%)").unwrap().hex(), "#cccccc");
        assert_eq!(parse("hsl(60, 100%, 50%)").unwrap().hex(), "#ffff00");
        assert_eq!(parse("rgba(0,0,0,0.5)").unwrap().a, 0.5);
        assert_eq!(parse("lightgrey").unwrap().hex(), "#d3d3d3");
        assert!(parse("none").is_none());
        assert!(parse("url(#m)").is_none());
        assert!(parse("currentColor").is_none());
    }

    #[test]
    fn roles_follow_what_a_colour_looks_like() {
        let r = |v: &str| role(parse(v).unwrap(), false);
        assert_eq!(r("#000000"), "--ob-diagram-text");
        assert_eq!(r("#28253D"), "--ob-diagram-text");
        assert_eq!(r("#ffffff"), "--ob-diagram-fill");
        assert_eq!(r("#eaeaea"), "--ob-diagram-fill");
        assert_eq!(r("#666"), "--ob-diagram-line");
        assert_eq!(r("#FFF7ED"), "--ob-diagram-highlight");
        assert_eq!(r("#fff5ad"), "--ob-diagram-highlight");
        assert_eq!(r("#F87171"), "--ob-diagram-accent-1");
        assert_eq!(r("#FACC15"), "--ob-diagram-highlight");
        assert_eq!(r("#4ADE80"), "--ob-diagram-accent-3");
        assert_eq!(r("#08427B"), "--ob-diagram-accent-5");
        assert_eq!(r("#9370DB"), "--ob-diagram-accent-6");
        let line = |v: &str| role(parse(v).unwrap(), true);
        assert_eq!(line("#ffffff"), "--ob-diagram-line");
        assert_eq!(line("#000000"), "--ob-diagram-text");
        assert_eq!(line("#fff5ad"), "--ob-diagram-accent-2");
    }

    #[test]
    fn attributes_move_into_style_and_css_is_rewritten() {
        let svg = r##"<svg xmlns="http://www.w3.org/2000/svg"><style>#a{font-family:"x",sans-serif;fill:#28253D;stroke:none}</style><rect fill="#eaeaea" stroke="#666" style="opacity:0.5" width="1"/><text fill="currentColor">A &gt; B</text></svg>"##;
        let out = apply(svg, "flowchart LR\nA --> B");
        assert!(
            out.contains("fill:var(--ob-diagram-text, #28253d);stroke:none"),
            "{out}"
        );
        assert!(
            out.contains("font-family:var(--ob-font-body),\"x\",sans-serif"),
            "{out}"
        );
        assert!(out.contains(r##"<rect width="1" style="fill:var(--ob-diagram-fill, #eaeaea);stroke:var(--ob-diagram-line, #666666);opacity:0.5"/>"##), "{out}");
        assert!(
            out.contains(r#"<text fill="currentColor">A &gt; B</text>"#),
            "{out}"
        );
        roxmltree::Document::parse(&out).expect("still XML");
    }

    #[test]
    fn authored_colours_are_kept_and_checked() {
        let source = "flowchart LR\n  A --> B\n  style A fill:#f9f,stroke:#333,color:#000\n  classDef warn fill:#ffcc00\n  style B fill:#222222,color:#333333\n";
        assert_eq!(
            authored_colours(source),
            ["#000000", "#222222", "#333333", "#ff99ff", "#ffcc00"]
        );
        let svg = r##"<svg xmlns="http://www.w3.org/2000/svg"><rect fill="#ff99ff"/><rect fill="#eeeeee"/></svg>"##;
        let out = apply(svg, source);
        assert!(out.contains(r##"<rect fill="#ff99ff"/>"##), "{out}");
        assert!(out.contains("var(--ob-diagram-fill, #eeeeee)"));
        let findings = authored_colour_findings(source);
        assert_eq!(findings.len(), 2, "{findings:?}");
        assert!(findings[0].contains("line 4") && findings[0].contains("without a text colour"));
        assert!(findings[1].contains("line 5") && findings[1].contains("4.5:1"));
    }

    #[test]
    fn functional_colours_with_spaces_and_shorthands_are_rewritten() {
        let out = rewrite_css(
            ".c{stroke:hsl(240, 100%, 46%);fill:rgb(253, 244, 255);border:1px solid hsl(0, 0%, 0%)}",
            &[],
        );
        assert!(
            out.contains("stroke:var(--ob-diagram-accent-5, #0000eb)"),
            "{out}"
        );
        assert!(
            out.contains("fill:var(--ob-diagram-fill, #fdf4ff)"),
            "{out}"
        );
        assert!(
            out.contains("border:1px solid var(--ob-diagram-text, #000000)"),
            "{out}"
        );
    }

    #[test]
    fn transparency_is_kept() {
        let out = apply(
            r##"<svg xmlns="http://www.w3.org/2000/svg"><rect fill="rgba(0, 0, 0, 0.25)"/></svg>"##,
            "",
        );
        assert!(
            out.contains(
                "color-mix(in srgb, var(--ob-diagram-text, rgba(0, 0, 0, 0.25)) 25%, transparent)"
            ),
            "{out}"
        );
    }
}
