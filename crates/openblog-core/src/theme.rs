//! The design system: a theme is a JSON file of design tokens that becomes a
//! stylesheet of CSS custom properties, plus optional extra stylesheets and
//! assets. Themes can extend one another, so a child theme only states what differs
//! from `base`. The same renderer output is restyled by swapping tokens.

use std::collections::{BTreeMap, HashMap};

use serde::{Deserialize, Serialize};

/// The on-disk shape of `themes/<name>/theme.json`.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct ThemeFile {
    /// Human-readable name shown in theme pickers.
    pub label: String,
    /// Parent theme whose values this theme overrides.
    pub extends: Option<String>,
    /// `"dark"` or `"light"`: the scheme used when the visitor has no preference.
    pub color_scheme: Option<String>,
    /// `colors.dark.accent`, `colors.light.accent`, ... Any key becomes `--ob-color-<kebab-key>`.
    pub colors: BTreeMap<String, BTreeMap<String, String>>,
    pub fonts: Fonts,
    /// Any other token: `maxWidth` becomes `--ob-max-width`.
    pub tokens: BTreeMap<String, String>,
    pub options: ThemeOptions,
    /// Extra stylesheets relative to the theme directory, linked after `base.css`.
    pub stylesheets: Vec<String>,
    /// ES module scripts relative to the theme directory, loaded after `openblog.js`.
    /// This is how a theme ships its own web components.
    pub scripts: Vec<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Fonts {
    pub body: Option<String>,
    pub heading: Option<String>,
    pub mono: Option<String>,
    /// `@font-face` declarations. `src` is relative to the theme directory.
    pub faces: Vec<FontFace>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct FontFace {
    pub family: String,
    pub src: String,
    pub format: Option<String>,
    pub weight: Option<String>,
    pub style: Option<String>,
    pub display: Option<String>,
    pub unicode_range: Option<String>,
}

/// Rendering behaviour a theme can switch on. Everything else is CSS.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct ThemeOptions {
    /// Decorate headings with `<h2>` / `</h2>` code labels, a code-themed look.
    pub heading_code_labels: Option<bool>,
    /// Template for navigation labels, e.g. `//{index}. <{label}/>`.
    pub nav_label: Option<String>,
    /// A custom element name (e.g. `demo-reveal`) to wrap page and section
    /// titles in, so a theme's own script can animate them. Empty disables it.
    pub heading_wrapper: Option<String>,
    /// `"rows"` (compact list) or `"cards"` (cover images).
    pub list_style: Option<String>,
    /// Show cover images on post pages.
    pub post_covers: Option<bool>,
    /// Colour code blocks with the built-in highlighter. Turn off when the
    /// theme ships its own through `scripts`.
    pub code_highlighting: Option<bool>,
    /// Number the lines of code blocks that have more than one line.
    pub code_line_numbers: Option<bool>,
}

/// A fully resolved theme with its inheritance chain flattened.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Theme {
    pub name: String,
    pub label: String,
    /// Theme names from the root ancestor to this theme.
    pub chain: Vec<String>,
    pub color_scheme: String,
    pub colors: BTreeMap<String, BTreeMap<String, String>>,
    pub font_body: String,
    pub font_heading: String,
    pub font_mono: String,
    /// Faces with `src` resolved to an absolute site URL.
    pub faces: Vec<FontFace>,
    pub tokens: BTreeMap<String, String>,
    pub heading_code_labels: bool,
    pub nav_label: Option<String>,
    /// Custom element that wraps titles, validated as a custom element name.
    pub heading_wrapper: Option<String>,
    pub list_style: String,
    pub post_covers: bool,
    pub code_highlighting: bool,
    pub code_line_numbers: bool,
    /// Absolute site URLs of extra stylesheets, in link order.
    pub stylesheets: Vec<String>,
    /// Absolute site URLs of theme scripts, in load order.
    pub scripts: Vec<String>,
}

/// A valid custom element name: lowercase ASCII, starts with a letter, and
/// contains a hyphen. Anything else would be an HTML injection vector.
pub fn valid_custom_element_name(name: &str) -> bool {
    name.len() <= 64
        && name.contains('-')
        && name.chars().next().is_some_and(|c| c.is_ascii_lowercase())
        && name.chars().all(|c| {
            c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '.' || c == '_'
        })
}

/// Every theme available to a build, keyed by directory name.
#[derive(Clone, Debug, Default)]
pub struct ThemeSet {
    files: HashMap<String, ThemeFile>,
    resolved: HashMap<String, Theme>,
}

impl ThemeSet {
    pub fn new() -> Self {
        let mut set = Self::default();
        set.insert("base", ThemeFile::builtin_base());
        set
    }

    /// Register a theme file. Registering `base` replaces the built-in default.
    pub fn insert(&mut self, name: &str, file: ThemeFile) {
        self.files.insert(name.to_string(), file);
        self.resolved.clear();
    }

    pub fn contains(&self, name: &str) -> bool {
        self.files.contains_key(name)
    }

    pub fn names(&self) -> Vec<String> {
        let mut names: Vec<String> = self.files.keys().cloned().collect();
        names.sort();
        names
    }

    pub fn resolve(&self, name: &str) -> Result<Theme, String> {
        if let Some(theme) = self.resolved.get(name) {
            return Ok(theme.clone());
        }
        let mut chain = Vec::new();
        let mut current = Some(name.to_string());
        while let Some(n) = current {
            if chain.contains(&n) {
                return Err(format!(
                    "theme `{n}` extends itself (chain: {})",
                    chain.join(" -> ")
                ));
            }
            let file = self.files.get(&n).ok_or_else(|| {
                if n == name {
                    format!(
                        "theme `{n}` not found (available: {})",
                        self.names().join(", ")
                    )
                } else {
                    format!("theme `{name}` extends unknown theme `{n}`")
                }
            })?;
            chain.push(n.clone());
            current = file.extends.clone();
        }
        chain.reverse();

        let mut theme = Theme {
            name: name.to_string(),
            chain: chain.clone(),
            color_scheme: "dark".into(),
            list_style: "rows".into(),
            post_covers: true,
            code_highlighting: true,
            code_line_numbers: true,
            ..Theme::default()
        };
        for n in &chain {
            let file = &self.files[n];
            let base_url = format!("/themes/{n}/");
            if !file.label.is_empty() {
                theme.label = file.label.clone();
            }
            if let Some(scheme) = &file.color_scheme {
                theme.color_scheme = scheme.clone();
            }
            for (scheme, colors) in &file.colors {
                let entry = theme.colors.entry(scheme.clone()).or_default();
                for (k, v) in colors {
                    entry.insert(k.clone(), v.clone());
                }
            }
            if let Some(f) = &file.fonts.body {
                theme.font_body = f.clone();
            }
            if let Some(f) = &file.fonts.heading {
                theme.font_heading = f.clone();
            }
            if let Some(f) = &file.fonts.mono {
                theme.font_mono = f.clone();
            }
            for face in &file.fonts.faces {
                let mut face = face.clone();
                face.src = absolutize(&base_url, &face.src);
                theme.faces.push(face);
            }
            for (k, v) in &file.tokens {
                theme.tokens.insert(k.clone(), v.clone());
            }
            if let Some(v) = file.options.heading_code_labels {
                theme.heading_code_labels = v;
            }
            if let Some(v) = &file.options.nav_label {
                theme.nav_label = if v.is_empty() { None } else { Some(v.clone()) };
            }
            if let Some(v) = &file.options.heading_wrapper {
                let v = v.trim();
                if v.is_empty() {
                    theme.heading_wrapper = None;
                } else if valid_custom_element_name(v) {
                    theme.heading_wrapper = Some(v.to_string());
                } else {
                    return Err(format!(
                        "theme `{n}`: headingWrapper `{v}` is not a valid custom element name (lowercase, with a hyphen, like `my-effect`)"
                    ));
                }
            }
            if let Some(v) = &file.options.list_style {
                theme.list_style = v.clone();
            }
            if let Some(v) = file.options.post_covers {
                theme.post_covers = v;
            }
            if let Some(v) = file.options.code_highlighting {
                theme.code_highlighting = v;
            }
            if let Some(v) = file.options.code_line_numbers {
                theme.code_line_numbers = v;
            }
            for sheet in &file.stylesheets {
                theme.stylesheets.push(absolutize(&base_url, sheet));
            }
            for script in &file.scripts {
                theme.scripts.push(absolutize(&base_url, script));
            }
        }
        if theme.label.is_empty() {
            theme.label = name.to_string();
        }
        if theme.font_heading.is_empty() {
            theme.font_heading = theme.font_body.clone();
        }
        Ok(theme)
    }

    /// Resolve and cache every registered theme, failing on the first error.
    pub fn resolve_all(&mut self) -> Result<(), String> {
        let names = self.names();
        for name in names {
            let theme = self.resolve(&name)?;
            self.resolved.insert(name, theme);
        }
        Ok(())
    }
}

fn absolutize(base_url: &str, rel: &str) -> String {
    if rel.starts_with('/')
        || rel.starts_with("http://")
        || rel.starts_with("https://")
        || rel.starts_with("data:")
    {
        rel.to_string()
    } else {
        format!("{base_url}{rel}")
    }
}

/// `surfaceRaised` -> `surface-raised`, `max_width` -> `max-width`.
pub fn kebab(key: &str) -> String {
    let mut out = String::with_capacity(key.len() + 4);
    for (i, ch) in key.chars().enumerate() {
        if ch.is_ascii_uppercase() {
            if i > 0 {
                out.push('-');
            }
            out.push(ch.to_ascii_lowercase());
        } else if ch == '_' || ch == ' ' {
            out.push('-');
        } else {
            out.push(ch);
        }
    }
    out
}

impl Theme {
    pub fn tokens_url(&self) -> String {
        format!("/themes/{}/tokens.css", self.name)
    }

    /// The generated `tokens.css` for this theme.
    pub fn tokens_css(&self) -> String {
        let mut css = String::new();
        css.push_str(
            "/* Generated by open.blog from theme.json. Edit the JSON, not this file. */\n",
        );
        for face in &self.faces {
            css.push_str("@font-face {\n");
            css.push_str(&format!(
                "  font-family: \"{}\";\n",
                face.family.replace('"', "")
            ));
            match &face.format {
                Some(fmt) => css.push_str(&format!(
                    "  src: url(\"{}\") format(\"{}\");\n",
                    face.src, fmt
                )),
                None => css.push_str(&format!("  src: url(\"{}\");\n", face.src)),
            }
            css.push_str(&format!(
                "  font-weight: {};\n",
                face.weight.as_deref().unwrap_or("400")
            ));
            css.push_str(&format!(
                "  font-style: {};\n",
                face.style.as_deref().unwrap_or("normal")
            ));
            css.push_str(&format!(
                "  font-display: {};\n",
                face.display.as_deref().unwrap_or("swap")
            ));
            if let Some(range) = &face.unicode_range {
                css.push_str(&format!("  unicode-range: {range};\n"));
            }
            css.push_str("}\n");
        }

        let default_scheme = if self.color_scheme == "light" {
            "light"
        } else {
            "dark"
        };
        let other_scheme = if default_scheme == "light" {
            "dark"
        } else {
            "light"
        };

        css.push_str(":root {\n");
        css.push_str(&format!("  color-scheme: {default_scheme};\n"));
        css.push_str(&format!("  --ob-font-body: {};\n", self.font_body));
        css.push_str(&format!("  --ob-font-heading: {};\n", self.font_heading));
        css.push_str(&format!("  --ob-font-mono: {};\n", self.font_mono));
        for (k, v) in &self.tokens {
            css.push_str(&format!("  --ob-{}: {};\n", kebab(k), v));
        }
        if let Some(colors) = self.colors.get(default_scheme) {
            push_colors(&mut css, colors, "  ");
        }
        css.push_str("}\n");

        if let Some(colors) = self.colors.get(other_scheme) {
            css.push_str(&format!(
                "@media (prefers-color-scheme: {other_scheme}) {{\n"
            ));
            css.push_str(&format!(
                "  :root:not([data-theme=\"{default_scheme}\"]) {{\n"
            ));
            css.push_str(&format!("    color-scheme: {other_scheme};\n"));
            push_colors(&mut css, colors, "    ");
            css.push_str("  }\n}\n");
            css.push_str(&format!(":root[data-theme=\"{other_scheme}\"] {{\n"));
            css.push_str(&format!("  color-scheme: {other_scheme};\n"));
            push_colors(&mut css, colors, "  ");
            css.push_str("}\n");
        }
        css
    }

    /// Theme metadata for the browser (`/themes/<name>/theme.json` is also
    /// copied verbatim, but this is the resolved view).
    pub fn manifest_json(&self) -> String {
        serde_json::json!({
            "name": self.name,
            "label": self.label,
            "chain": self.chain,
            "colorScheme": self.color_scheme,
            "colors": self.colors,
            "fonts": { "body": self.font_body, "heading": self.font_heading, "mono": self.font_mono },
            "tokens": self.tokens,
            "options": {
                "headingCodeLabels": self.heading_code_labels,
                "navLabel": self.nav_label,
                "headingWrapper": self.heading_wrapper,
                "listStyle": self.list_style,
                "postCovers": self.post_covers,
                "codeHighlighting": self.code_highlighting,
                "codeLineNumbers": self.code_line_numbers,
            },
            "stylesheets": self.stylesheets,
            "scripts": self.scripts,
        })
        .to_string()
    }
}

fn push_colors(css: &mut String, colors: &BTreeMap<String, String>, indent: &str) {
    for (k, v) in colors {
        css.push_str(&format!("{indent}--ob-color-{}: {};\n", kebab(k), v));
    }
}

impl ThemeFile {
    /// The neutral default theme. Every token the base stylesheet uses is defined here,
    /// so a custom theme only needs to override what it changes.
    pub fn builtin_base() -> Self {
        let json = include_str!("../../../themes/base/theme.json");
        serde_json::from_str(json).expect("themes/base/theme.json is valid")
    }

    pub fn from_json(json: &str) -> Result<Self, String> {
        serde_json::from_str(json).map_err(|e| format!("invalid theme.json: {e}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base_theme_resolves_and_emits_tokens() {
        let set = ThemeSet::new();
        let theme = set.resolve("base").unwrap();
        let css = theme.tokens_css();
        assert!(css.contains("--ob-color-accent:"));
        assert!(css.contains("--ob-font-body:"));
        assert!(css.contains("@media (prefers-color-scheme:"));
        assert_eq!(theme.chain, vec!["base"]);
    }

    #[test]
    fn child_overrides_and_inherits() {
        let mut set = ThemeSet::new();
        let child = ThemeFile::from_json(
            r##"{"extends":"base","label":"Kid","colors":{"dark":{"accent":"#e3de13"}},"stylesheets":["theme.css"],"scripts":["fx.js"],"options":{"headingCodeLabels":true,"headingWrapper":"kid-fx"},"fonts":{"faces":[{"family":"X","src":"fonts/x.woff2"}]}}"##,
        )
        .unwrap();
        set.insert("kid", child);
        let theme = set.resolve("kid").unwrap();
        assert_eq!(theme.chain, vec!["base", "kid"]);
        assert_eq!(theme.colors["dark"]["accent"], "#e3de13");
        assert!(theme.colors["dark"].contains_key("text"));
        assert!(theme.heading_code_labels);
        assert_eq!(theme.stylesheets, vec!["/themes/kid/theme.css"]);
        assert_eq!(theme.scripts, vec!["/themes/kid/fx.js"]);
        assert_eq!(theme.heading_wrapper.as_deref(), Some("kid-fx"));
        let grandchild =
            ThemeFile::from_json(r#"{"extends":"kid","options":{"headingWrapper":""}}"#).unwrap();
        set.insert("grandkid", grandchild);
        let theme = set.resolve("grandkid").unwrap();
        assert_eq!(
            theme.heading_wrapper, None,
            "an empty wrapper switches the parent's off"
        );
        assert_eq!(
            theme.scripts,
            vec!["/themes/kid/fx.js"],
            "parent scripts are inherited"
        );
        for bad in ["noHyphen", "Upper-Case", "<x-y>", "x-y onclick=", "-x"] {
            set.insert(
                "bad",
                ThemeFile::from_json(&format!(r#"{{"options":{{"headingWrapper":"{bad}"}}}}"#))
                    .unwrap(),
            );
            assert!(
                set.resolve("bad")
                    .unwrap_err()
                    .contains("not a valid custom element name"),
                "{bad}"
            );
        }
        assert_eq!(theme.faces[0].src, "/themes/kid/fonts/x.woff2");
        assert!(theme.tokens_css().contains("--ob-color-accent: #e3de13;"));
    }

    #[test]
    fn detects_cycles_and_missing_parents() {
        let mut set = ThemeSet::new();
        set.insert(
            "a",
            ThemeFile {
                extends: Some("b".into()),
                ..Default::default()
            },
        );
        set.insert(
            "b",
            ThemeFile {
                extends: Some("a".into()),
                ..Default::default()
            },
        );
        assert!(set.resolve("a").unwrap_err().contains("extends itself"));
        set.insert(
            "c",
            ThemeFile {
                extends: Some("nope".into()),
                ..Default::default()
            },
        );
        assert!(set.resolve("c").unwrap_err().contains("unknown theme"));
        assert_eq!(kebab("surfaceRaised"), "surface-raised");
    }
}
