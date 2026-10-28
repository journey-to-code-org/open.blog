//! Compile a validated [`LookSettings`] into an override block of allowlisted `--ob-*` tokens
//! (ADR 0360).
//!
//! Safety comes from construction, not escaping: property names come from fixed tables, every value is
//! either a table constant or formatted from typed data (a number, or a `#rrggbb` built from three
//! bytes). No string from the settings is ever copied into the output. The block is appended to a
//! theme's `tokens.css`, so it layers over whichever theme a page uses.

use blake2::{Blake2s256, Digest};

use crate::look::{
    FontStyle, HeadingWeight, LookSettings, PageWidth, Roundness, Spacing, TextSize, CONTROLS,
};
use crate::theme::Theme;

/// The generated override block and its content hash.
#[derive(Clone, Debug, PartialEq)]
pub struct CompiledLook {
    pub css: String,
    /// 16 hex characters of the BLAKE2s digest of `css`, used to bust caches.
    pub hash: String,
    /// One plain sentence per adjustment made so the look stays readable.
    pub notes: Vec<String>,
}

/// Every custom property the look is allowed to write. Anything else is a bug.
pub const ALLOWED_PROPERTIES: &[&str] = &[
    "--ob-font-body",
    "--ob-font-heading",
    "--ob-text-scale",
    "--ob-radius",
    "--ob-radius-sm",
    "--ob-space-4",
    "--ob-space-5",
    "--ob-space-6",
    "--ob-space-8",
    "--ob-max-width",
    "--ob-reading-width",
    "--ob-heading-weight",
    "--ob-color-accent",
    "--ob-color-accent-soft",
    "--ob-color-accent-border",
    "--ob-color-accent-contrast",
    "--ob-color-link",
    "--ob-color-glow",
    "--ob-color-page",
    "--ob-color-outer",
    "--ob-color-surface",
    "--ob-color-surface-raised",
    "--ob-color-text",
    "--ob-color-muted",
    "--ob-color-subtle",
    "--ob-color-border",
];

pub(crate) fn font_stack(style: FontStyle) -> &'static str {
    match style {
        FontStyle::ModernSans => {
            "system-ui, -apple-system, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial, sans-serif"
        }
        FontStyle::ClassicSerif => {
            "Georgia, \"Iowan Old Style\", \"Palatino Linotype\", \"Times New Roman\", serif"
        }
        FontStyle::FriendlyRounded => {
            "ui-rounded, \"SF Pro Rounded\", \"Hiragino Maru Gothic ProN\", Quicksand, Nunito, \"Varela Round\", system-ui, sans-serif"
        }
        FontStyle::TechieMono => {
            "ui-monospace, SFMono-Regular, Menlo, Consolas, \"Liberation Mono\", monospace"
        }
    }
}

fn text_scale(size: TextSize) -> &'static str {
    match size {
        TextSize::Small => "0.9375",
        TextSize::Medium => "1",
        TextSize::Large => "1.125",
        TextSize::ExtraLarge => "1.25",
    }
}

fn radius(roundness: Roundness) -> (&'static str, &'static str) {
    match roundness {
        Roundness::Square => ("0", "0"),
        Roundness::Soft => ("8px", "4px"),
        Roundness::Round => ("20px", "10px"),
    }
}

/// `--ob-space-4`, `-5`, `-6` and `-8`.
fn spacing(spacing: Spacing) -> [&'static str; 4] {
    match spacing {
        Spacing::Compact => ["0.75rem", "1.125rem", "1.25rem", "1.5rem"],
        Spacing::Comfortable => ["1rem", "1.5rem", "1.75rem", "2rem"],
        Spacing::Airy => ["1.25rem", "1.875rem", "2.25rem", "3rem"],
    }
}

fn page_width(width: PageWidth) -> (&'static str, &'static str) {
    match width {
        PageWidth::Narrow => ("56rem", "36rem"),
        PageWidth::Medium => ("70rem", "46rem"),
        PageWidth::Wide => ("84rem", "56rem"),
    }
}

fn heading_weight(weight: HeadingWeight) -> &'static str {
    match weight {
        HeadingWeight::Normal => "400",
        HeadingWeight::Bold => "700",
    }
}

/// The color custom properties a look may write, in output order.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum ColorToken {
    Page,
    Outer,
    Surface,
    SurfaceRaised,
    Text,
    Muted,
    Subtle,
    Border,
    Accent,
    AccentSoft,
    AccentBorder,
    AccentContrast,
    Link,
    Glow,
}

impl ColorToken {
    pub fn property(self) -> &'static str {
        match self {
            ColorToken::Page => "--ob-color-page",
            ColorToken::Outer => "--ob-color-outer",
            ColorToken::Surface => "--ob-color-surface",
            ColorToken::SurfaceRaised => "--ob-color-surface-raised",
            ColorToken::Text => "--ob-color-text",
            ColorToken::Muted => "--ob-color-muted",
            ColorToken::Subtle => "--ob-color-subtle",
            ColorToken::Border => "--ob-color-border",
            ColorToken::Accent => "--ob-color-accent",
            ColorToken::AccentSoft => "--ob-color-accent-soft",
            ColorToken::AccentBorder => "--ob-color-accent-border",
            ColorToken::AccentContrast => "--ob-color-accent-contrast",
            ColorToken::Link => "--ob-color-link",
            ColorToken::Glow => "--ob-color-glow",
        }
    }
}

/// The colors a look sets for one scheme, as `(token, "#rrggbb")` pairs.
fn scheme_colors(look: &LookSettings, _theme: &Theme, _scheme: &str) -> Vec<(ColorToken, String)> {
    let mut out = Vec::new();
    if let Some(accent) = &look.accent {
        let contrast = if relative_luminance(accent) > 0.179 {
            "#000000"
        } else {
            "#ffffff"
        };
        out.push((ColorToken::Accent, accent.clone()));
        out.push((ColorToken::AccentSoft, accent.clone()));
        out.push((ColorToken::AccentBorder, accent.clone()));
        out.push((ColorToken::AccentContrast, contrast.to_string()));
        out.push((ColorToken::Link, accent.clone()));
    }
    out
}

fn relative_luminance(hex: &str) -> f64 {
    let channel = |range: std::ops::Range<usize>| {
        let v = f64::from(u8::from_str_radix(&hex[range], 16).unwrap_or(0)) / 255.0;
        if v <= 0.03928 {
            v / 12.92
        } else {
            ((v + 0.055) / 1.055).powf(2.4)
        }
    };
    0.2126 * channel(1..3) + 0.7152 * channel(3..5) + 0.0722 * channel(5..7)
}

/// Whether the theme honors a control. Replaced by the theme's `customizable` list in #346.
fn honors(_theme: &Theme, control: &str) -> bool {
    CONTROLS.contains(&control)
}

fn push_decls(css: &mut String, indent: &str, decls: &[(&'static str, String)]) {
    for (property, value) in decls {
        css.push_str(&format!("{indent}{property}: {value};\n"));
    }
}

fn push_colors(css: &mut String, indent: &str, colors: &[(ColorToken, String)]) {
    for (token, value) in colors {
        css.push_str(&format!("{indent}{}: {value};\n", token.property()));
    }
}

/// Compile the override block for one resolved theme. `None` when the look changes nothing for this
/// theme, so the theme's stylesheet is untouched.
pub fn compile(look: &LookSettings, theme: &Theme) -> Option<CompiledLook> {
    let mut plain: Vec<(&'static str, String)> = Vec::new();
    if honors(theme, "fontStyle") {
        if let Some(style) = look.font_style {
            plain.push(("--ob-font-body", font_stack(style).to_string()));
            plain.push(("--ob-font-heading", font_stack(style).to_string()));
        }
    }
    if honors(theme, "textSize") {
        if let Some(size) = look.text_size {
            plain.push(("--ob-text-scale", text_scale(size).to_string()));
        }
    }
    if honors(theme, "roundness") {
        if let Some(round) = look.roundness {
            let (radius, small) = radius(round);
            plain.push(("--ob-radius", radius.to_string()));
            plain.push(("--ob-radius-sm", small.to_string()));
        }
    }
    if honors(theme, "spacing") {
        if let Some(space) = look.spacing {
            let values = spacing(space);
            for (property, value) in [
                "--ob-space-4",
                "--ob-space-5",
                "--ob-space-6",
                "--ob-space-8",
            ]
            .into_iter()
            .zip(values)
            {
                plain.push((property, value.to_string()));
            }
        }
    }
    if honors(theme, "pageWidth") {
        if let Some(width) = look.page_width {
            let (max, reading) = page_width(width);
            plain.push(("--ob-max-width", max.to_string()));
            plain.push(("--ob-reading-width", reading.to_string()));
        }
    }
    if honors(theme, "headingWeight") {
        if let Some(weight) = look.heading_weight {
            plain.push(("--ob-heading-weight", heading_weight(weight).to_string()));
        }
    }

    let default_scheme = if theme.color_scheme == "light" {
        "light"
    } else {
        "dark"
    };
    let other_scheme = if default_scheme == "light" {
        "dark"
    } else {
        "light"
    };
    let scheme = |name: &str| -> Vec<(ColorToken, String)> {
        if theme.colors.contains_key(name) {
            scheme_colors(look, theme, name)
        } else {
            Vec::new()
        }
    };
    let default_colors = scheme(default_scheme);
    let other_colors = scheme(other_scheme);
    let light_colors = scheme("light");

    if plain.is_empty()
        && default_colors.is_empty()
        && other_colors.is_empty()
        && light_colors.is_empty()
    {
        return None;
    }

    let mut css = String::from(
        "/* Look: generated by open.blog from the owner's appearance settings. Do not edit. */\n",
    );
    if !plain.is_empty() || !default_colors.is_empty() {
        css.push_str(":root {\n");
        push_decls(&mut css, "  ", &plain);
        push_colors(&mut css, "  ", &default_colors);
        css.push_str("}\n");
    }
    if !other_colors.is_empty() {
        css.push_str(&format!(
            "@media (prefers-color-scheme: {other_scheme}) {{\n  :root:not([data-theme=\"{default_scheme}\"]) {{\n"
        ));
        push_colors(&mut css, "    ", &other_colors);
        css.push_str("  }\n}\n");
        css.push_str(&format!(":root[data-theme=\"{other_scheme}\"] {{\n"));
        push_colors(&mut css, "  ", &other_colors);
        css.push_str("}\n");
    }
    if !light_colors.is_empty() {
        css.push_str("@media print {\n  :root,\n  :root[data-theme] {\n");
        push_colors(&mut css, "    ", &light_colors);
        css.push_str("  }\n}\n");
    }
    let digest = Blake2s256::digest(css.as_bytes());
    let hash: String = digest.iter().take(8).map(|b| format!("{b:02x}")).collect();
    Some(CompiledLook {
        css,
        hash,
        notes: Vec::new(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::theme::ThemeSet;
    use serde_json::{json, Value};

    fn base() -> Theme {
        ThemeSet::new().resolve("base").unwrap()
    }

    fn look(value: Value) -> LookSettings {
        LookSettings::from_value(&value).unwrap()
    }

    /// Every declaration in a compiled block, as `(property, value)`.
    fn declarations(css: &str) -> Vec<(String, String)> {
        css.lines()
            .filter_map(|line| line.trim().strip_suffix(';'))
            .filter_map(|line| line.split_once(": "))
            .map(|(p, v)| (p.to_string(), v.to_string()))
            .collect()
    }

    const HEADER: &str =
        "/* Look: generated by open.blog from the owner's appearance settings. Do not edit. */";

    /// The whole block is made of the header, fixed selectors, and allowlisted declarations whose
    /// values come from fixed tables or are a formatted number or color.
    fn assert_confined(css: &str) {
        for line in css.lines() {
            let t = line.trim();
            if t.is_empty() || t == "}" || t == HEADER {
                continue;
            }
            if t.ends_with('{') || t == ":root," {
                let fixed = [
                    ":root {",
                    "@media print {",
                    ":root,",
                    ":root[data-theme] {",
                    "@media (prefers-color-scheme: light) {",
                    "@media (prefers-color-scheme: dark) {",
                    ":root[data-theme=\"light\"] {",
                    ":root[data-theme=\"dark\"] {",
                    ":root:not([data-theme=\"light\"]) {",
                    ":root:not([data-theme=\"dark\"]) {",
                ];
                assert!(fixed.contains(&t), "unexpected selector {t:?}");
                continue;
            }
            let decl = t
                .strip_suffix(';')
                .unwrap_or_else(|| panic!("bad line {t:?}"));
            let (property, value) = decl.split_once(": ").unwrap();
            assert!(
                ALLOWED_PROPERTIES.contains(&property),
                "property {property}"
            );
            let hex = value.len() == 7
                && value.starts_with('#')
                && value[1..].bytes().all(|b| b.is_ascii_hexdigit());
            let number = value.bytes().all(|b| b.is_ascii_digit() || b == b'.');
            let length = ["rem", "px"].iter().any(|u| {
                value
                    .strip_suffix(u)
                    .is_some_and(|n| n.bytes().all(|b| b.is_ascii_digit() || b == b'.'))
            });
            let stack = FontStyle::ALL.iter().any(|s| font_stack(*s) == value);
            assert!(
                hex || number || length || stack,
                "value {value:?} for {property} is not from a fixed table"
            );
        }
    }

    #[test]
    fn no_look_adds_nothing() {
        assert!(compile(&LookSettings::default(), &base()).is_none());
        assert!(compile(&look(json!({"futureKnob": 1})), &base()).is_none());
        let plain = base();
        let with = plain.clone().with_look(&LookSettings::default());
        assert_eq!(with.tokens_css(), plain.tokens_css());
        assert_eq!(with.tokens_url(), plain.tokens_url());
    }

    #[test]
    fn plain_controls_compile_to_fixed_values() {
        let compiled = compile(
            &look(json!({
                "fontStyle": "classic-serif", "textSize": "large", "roundness": "round",
                "spacing": "airy", "pageWidth": "wide", "headingWeight": "normal"
            })),
            &base(),
        )
        .unwrap();
        let got = declarations(&compiled.css);
        let get = |p: &str| got.iter().find(|(k, _)| k == p).map(|(_, v)| v.as_str());
        assert_eq!(get("--ob-text-scale"), Some("1.125"));
        assert_eq!(get("--ob-radius"), Some("20px"));
        assert_eq!(get("--ob-space-8"), Some("3rem"));
        assert_eq!(get("--ob-max-width"), Some("84rem"));
        assert_eq!(get("--ob-reading-width"), Some("56rem"));
        assert_eq!(get("--ob-heading-weight"), Some("400"));
        assert!(get("--ob-font-body").unwrap().starts_with("Georgia"));
        assert_confined(&compiled.css);
        // Plain controls leave colors alone.
        assert!(!compiled.css.contains("--ob-color"));
    }

    #[test]
    fn golden_accent_block() {
        let chosen = look(json!({"accent": "#B5451B", "textSize": "small"}));
        let compiled = compile(&chosen, &base()).unwrap();
        assert!(compiled.css.starts_with(HEADER));
        assert!(compiled
            .css
            .contains(":root {\n  --ob-text-scale: 0.9375;\n"));
        assert!(compiled.css.contains("--ob-color-accent: "));
        assert!(compiled.css.contains(":root[data-theme=\"dark\"] {\n"));
        assert!(compiled.css.contains("@media print {\n"));
        assert_confined(&compiled.css);
        // Deterministic, and the hash follows the content.
        let again = compile(
            &look(json!({"accent": "#b5451b", "textSize": "small"})),
            &base(),
        );
        assert_eq!(Some(&compiled), again.as_ref());
        assert_eq!(compiled.hash.len(), 16);
        let other = compile(
            &look(json!({"accent": "#b5451c", "textSize": "small"})),
            &base(),
        )
        .unwrap();
        assert_ne!(compiled.hash, other.hash);
    }

    #[test]
    fn the_look_follows_the_theme_tokens_and_busts_the_cache() {
        let plain = base();
        let styled = plain
            .clone()
            .with_look(&look(json!({"roundness": "square"})));
        assert!(styled.tokens_css().starts_with(&plain.tokens_css()));
        assert!(styled.tokens_css().len() > plain.tokens_css().len());
        assert!(styled
            .tokens_url()
            .starts_with("/themes/base/tokens.css?v="));
        assert_ne!(styled.tokens_url(), plain.tokens_url());
    }

    /// A small deterministic generator, so the fuzz test needs no dependency and never flakes.
    struct Rng(u64);
    impl Rng {
        fn next(&mut self) -> u64 {
            self.0 ^= self.0 << 13;
            self.0 ^= self.0 >> 7;
            self.0 ^= self.0 << 17;
            self.0
        }
        fn pick<'a, T>(&mut self, items: &'a [T]) -> &'a T {
            &items[(self.next() % items.len() as u64) as usize]
        }
    }

    #[test]
    fn arbitrary_settings_never_produce_output_outside_the_allowlist() {
        let hostile = [
            "#fff;}*{display:none}",
            "</style><script>alert(1)</script>",
            "url(https://evil.test/x)",
            "expression(alert(1))",
            "x; background: red; y",
            "\\0000",
            "#12345",
            "calm",
            "round",
            "extra-large",
            "#ABCDEF",
            "#0a0",
        ];
        let keys = [
            "accent",
            "palette",
            "fontStyle",
            "textSize",
            "roundness",
            "spacing",
            "pageWidth",
            "headingWeight",
            "version",
            "mystery",
            "--ob-radius",
            "}{",
        ];
        let mut rng = Rng(0x9E37_79B9_7F4A_7C15);
        let theme = base();
        let mut compiled_any = 0;
        for _ in 0..3000 {
            let mut object = serde_json::Map::new();
            for _ in 0..(rng.next() % 7) {
                let key = *rng.pick(&keys);
                let valid: &[&str] = match key {
                    "accent" => &["#ABCDEF", "#0a0", "#102030", "#fafafa"],
                    "palette" => &["calm", "night", "theme"],
                    "fontStyle" => &["classic-serif", "techie-mono", "theme"],
                    "textSize" => &["small", "extra-large"],
                    "roundness" => &["square", "round"],
                    "spacing" => &["compact", "airy"],
                    "pageWidth" => &["narrow", "wide"],
                    "headingWeight" => &["normal", "bold"],
                    _ => &["x"],
                };
                let value = match rng.next() % 6 {
                    0 => json!(rng.next() % 5),
                    1 => json!(null),
                    2 => json!([rng.pick(&hostile)]),
                    3 => json!(rng.pick(&hostile)),
                    _ => json!(rng.pick(valid)),
                };
                object.insert(key.to_string(), value);
            }
            let Ok(settings) = LookSettings::from_value(&Value::Object(object)) else {
                continue;
            };
            if let Some(compiled) = compile(&settings, &theme) {
                compiled_any += 1;
                assert_confined(&compiled.css);
                assert!(!compiled.css.contains("evil") && !compiled.css.contains("script"));
            }
        }
        assert!(compiled_any > 20, "the generator should reach the compiler");
    }
}
