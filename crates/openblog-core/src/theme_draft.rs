//! A theme drafted from words (ADR 0410): what an Assistant may propose when an owner describes the
//! look she wants, and how it becomes a theme the site can wear.
//!
//! The proposal is small on purpose: a name, six colours for light and six for dark, a font for the
//! text and one for headings from a fixed list of safe stacks, a corner style and a text size. It is
//! never CSS, never a script and never a font file, so nothing in it can reach a page except as a
//! checked token. Everything else a theme needs (raised surfaces, borders, the accent's tints, the
//! text drawn on the accent) is derived here, and every colour that carries text is moved, the
//! least it takes, until it is easy to read: body text at 7:1, the rest at 4.5:1. Each adjustment is
//! said in words.
//!
//! The result is an ordinary `theme.json` that extends the site's own theme, so it keeps the
//! site's structure, stylesheets, decorations and components and changes only how they look.

use serde_json::{json, Map, Value};

use crate::look::{normalize_hex, FontStyle, Roundness, TextSize};
use crate::look_contrast::{contrast, derive_accent, readable_on, Ground, Rgb, Shift, HIGH, TEXT};

/// The longest name an owner sees in theme lists.
pub const MAX_LABEL_CHARS: usize = 40;
/// The longest one-sentence summary of the idea.
pub const MAX_SUMMARY_CHARS: usize = 300;
/// The longest description an owner may give.
pub const MAX_DESCRIPTION_CHARS: usize = 1_000;
/// The colours a draft gives for each scheme.
pub const COLOR_KEYS: [&str; 6] = ["page", "surface", "text", "muted", "border", "accent"];
/// Font choices: `theme` keeps the font of the theme it extends.
pub const FONT_CHOICES: [&str; 5] = [
    "theme",
    "classic-serif",
    "modern-sans",
    "friendly-rounded",
    "techie-mono",
];
pub const ROUNDNESS_CHOICES: [&str; 4] = ["theme", "square", "soft", "round"];
pub const TEXT_SIZE_CHOICES: [&str; 4] = ["theme", "medium", "large", "extra-large"];

/// One scheme's colours as given.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Palette {
    pub page: Rgb,
    pub surface: Rgb,
    pub text: Rgb,
    pub muted: Rgb,
    pub border: Rgb,
    pub accent: Rgb,
}

/// A checked draft, before it is made readable.
#[derive(Clone, Debug, PartialEq)]
pub struct ThemeDraft {
    pub label: String,
    pub summary: String,
    pub color_scheme: String,
    pub light: Palette,
    pub dark: Palette,
    pub font: String,
    pub heading_font: String,
    pub roundness: String,
    pub text_size: String,
}

/// A draft made into a theme: the `theme.json` to write and what was changed to make it readable.
#[derive(Clone, Debug, PartialEq)]
pub struct DraftedTheme {
    pub theme: Value,
    pub notes: Vec<String>,
}

fn one_line(text: &str) -> bool {
    !text.chars().any(char::is_control)
}

fn text_field(
    object: &Map<String, Value>,
    key: &str,
    max: usize,
    required: bool,
) -> Result<String, String> {
    match object.get(key) {
        Some(Value::String(text)) => {
            let text = text.trim();
            if required && text.is_empty() {
                Err(format!("`{key}` is empty"))
            } else if !one_line(text) || text.chars().count() > max {
                Err(format!(
                    "`{key}` must be one line of at most {max} characters"
                ))
            } else {
                Ok(text.to_string())
            }
        }
        None if !required => Ok(String::new()),
        _ => Err(format!("`{key}` must be text")),
    }
}

fn choice(object: &Map<String, Value>, key: &str, choices: &[&str]) -> Result<String, String> {
    match object.get(key) {
        None | Some(Value::Null) => Ok("theme".into()),
        Some(Value::String(value)) if choices.contains(&value.as_str()) => Ok(value.clone()),
        _ => Err(format!("`{key}` must be one of {}", choices.join(", "))),
    }
}

fn palette(object: &Map<String, Value>, scheme: &str) -> Result<Palette, String> {
    let Some(Value::Object(colors)) = object.get(scheme) else {
        return Err(format!("`{scheme}` must hold the six colours"));
    };
    if let Some(extra) = colors
        .keys()
        .find(|key| !COLOR_KEYS.contains(&key.as_str()))
    {
        return Err(format!(
            "`{scheme}` has `{extra}`, which is not one of {}",
            COLOR_KEYS.join(", ")
        ));
    }
    let get = |key: &str| -> Result<Rgb, String> {
        colors
            .get(key)
            .and_then(Value::as_str)
            .and_then(normalize_hex)
            .and_then(|hex| Rgb::parse(&hex))
            .ok_or_else(|| format!("`{scheme}.{key}` must be a colour written like #a51d2d"))
    };
    Ok(Palette {
        page: get("page")?,
        surface: get("surface")?,
        text: get("text")?,
        muted: get("muted")?,
        border: get("border")?,
        accent: get("accent")?,
    })
}

impl ThemeDraft {
    /// Check a proposal. Unknown fields are refused, so nothing can ride along.
    pub fn from_json(value: &Value) -> Result<ThemeDraft, String> {
        let Value::Object(object) = value else {
            return Err("the draft is not an object".into());
        };
        const KEYS: [&str; 9] = [
            "label",
            "summary",
            "colorScheme",
            "light",
            "dark",
            "font",
            "headingFont",
            "roundness",
            "textSize",
        ];
        if let Some(extra) = object.keys().find(|key| !KEYS.contains(&key.as_str())) {
            return Err(format!(
                "it has `{extra}`, which a theme draft does not take"
            ));
        }
        let color_scheme = match object.get("colorScheme").and_then(Value::as_str) {
            Some(scheme @ ("light" | "dark")) => scheme.to_string(),
            None => "light".into(),
            Some(_) => return Err("`colorScheme` must be light or dark".into()),
        };
        Ok(ThemeDraft {
            label: text_field(object, "label", MAX_LABEL_CHARS, true)?,
            summary: text_field(object, "summary", MAX_SUMMARY_CHARS, false)?,
            color_scheme,
            light: palette(object, "light")?,
            dark: palette(object, "dark")?,
            font: choice(object, "font", &FONT_CHOICES)?,
            heading_font: choice(object, "headingFont", &FONT_CHOICES)?,
            roundness: choice(object, "roundness", &ROUNDNESS_CHOICES)?,
            text_size: choice(object, "textSize", &TEXT_SIZE_CHOICES)?,
        })
    }

    /// The draft as it travels back to the editor, for showing and resending.
    pub fn to_json(&self) -> Value {
        let colors = |p: &Palette| {
            json!({
                "page": p.page.hex(), "surface": p.surface.hex(), "text": p.text.hex(),
                "muted": p.muted.hex(), "border": p.border.hex(), "accent": p.accent.hex(),
            })
        };
        json!({
            "label": self.label,
            "summary": self.summary,
            "colorScheme": self.color_scheme,
            "light": colors(&self.light),
            "dark": colors(&self.dark),
            "font": self.font,
            "headingFont": self.heading_font,
            "roundness": self.roundness,
            "textSize": self.text_size,
        })
    }

    /// The theme this draft makes, extending `extends`, with every text colour made readable.
    pub fn to_theme(&self, extends: &str) -> DraftedTheme {
        let mut notes = Vec::new();
        let light = readable_scheme(&self.light, "light", &mut notes);
        let dark = readable_scheme(&self.dark, "dark", &mut notes);
        let mut theme = Map::new();
        theme.insert("label".into(), json!(self.label));
        theme.insert("extends".into(), json!(extends));
        theme.insert("colorScheme".into(), json!(self.color_scheme));
        theme.insert("colors".into(), json!({ "light": light, "dark": dark }));
        let stack = |id: &str| FontStyle::parse(id).map(crate::look_css::font_stack);
        let mut fonts = Map::new();
        if let Some(body) = stack(&self.font) {
            fonts.insert("body".into(), json!(body));
        }
        if let Some(heading) = stack(&self.heading_font) {
            fonts.insert("heading".into(), json!(heading));
        }
        if !fonts.is_empty() {
            theme.insert("fonts".into(), Value::Object(fonts));
        }
        let mut tokens = Map::new();
        if let Some(roundness) = Roundness::parse(&self.roundness) {
            let (radius, small) = match roundness {
                Roundness::Square => ("0", "0"),
                Roundness::Soft => ("8px", "4px"),
                Roundness::Round => ("20px", "10px"),
            };
            tokens.insert("radius".into(), json!(radius));
            tokens.insert("radiusSm".into(), json!(small));
        }
        if let Some(size) = TextSize::parse(&self.text_size) {
            let body = match size {
                TextSize::Small => "1rem",
                TextSize::Medium => "1.0625rem",
                TextSize::Large => "1.1875rem",
                TextSize::ExtraLarge => "1.3125rem",
            };
            tokens.insert("bodySize".into(), json!(body));
        }
        if !tokens.is_empty() {
            theme.insert("tokens".into(), Value::Object(tokens));
        }
        DraftedTheme {
            theme: Value::Object(theme),
            notes,
        }
    }
}

/// Every colour a scheme needs, from the six given, with text made readable.
fn readable_scheme(given: &Palette, scheme: &str, notes: &mut Vec<String>) -> Map<String, Value> {
    let backgrounds = [given.page, given.surface];
    let mut say = |what: &str, shift: Shift| {
        let way = match shift {
            Shift::Darker => "darker",
            Shift::Lighter => "lighter",
            Shift::Unchanged => return,
        };
        notes.push(format!(
            "In {scheme} mode, the {what} was made a little {way} so it is easy to read."
        ));
    };
    // Body text at 7:1 where it can be; never under 4.5:1.
    let text = match readable_on(given.text, &backgrounds, HIGH)
        .or_else(|| readable_on(given.text, &backgrounds, TEXT))
    {
        Some((color, shift)) => {
            say("writing", shift);
            color
        }
        None => crate::look_contrast::text_on(given.page, given.text),
    };
    let muted = match readable_on(given.muted, &backgrounds, TEXT) {
        Some((color, shift)) => {
            say("quieter writing (dates and notes)", shift);
            color
        }
        None => text,
    };
    // Borders mark the edges of cards and fields: at least 1.5:1 so they are seen, and lines that
    // separate controls at 3:1 come from the accent's border below.
    let border = if contrast(given.border, given.page) >= 1.5 {
        given.border
    } else {
        readable_on(given.border, &[given.page], 1.5).map_or(given.border, |(color, _)| color)
    };
    let raised = given.surface.mix(given.page, 0.5).mix(border, 0.25);
    let ground = Ground {
        page: given.page,
        surface: given.surface,
        surface_raised: Some(raised),
        text,
        ink: text,
    };
    let accent = match derive_accent(given.accent, &ground, TEXT) {
        Some(set) => {
            say("main colour (links and buttons)", set.shift);
            set
        }
        None => derive_accent(text, &ground, TEXT).expect("text is readable on this ground"),
    };
    let outer = given.page.mix(text, 0.04);
    let mut out = Map::new();
    for (key, color) in [
        ("page", given.page),
        ("outer", outer),
        ("surface", given.surface),
        ("surfaceRaised", raised),
        ("text", text),
        ("muted", muted),
        ("subtle", muted),
        ("border", border),
        ("accent", accent.accent),
        ("accentSoft", accent.accent),
        ("accentBorder", accent.accent_border),
        ("accentContrast", accent.accent_contrast),
        ("link", accent.accent),
        ("glow", accent.glow),
        ("codeBg", raised),
        ("codeText", text),
        ("ink", text),
    ] {
        out.insert(key.into(), json!(color.hex()));
    }
    out
}

/// A folder name for a new theme from its label: lowercase letters, digits and hyphens, at most 40,
/// and not one of `taken`.
pub fn theme_slug(label: &str, taken: &[String]) -> String {
    let mut slug = String::new();
    for c in label.to_lowercase().chars() {
        if c.is_ascii_alphanumeric() {
            slug.push(c);
        } else if !slug.ends_with('-') && !slug.is_empty() {
            slug.push('-');
        }
    }
    let mut slug: String = slug.trim_end_matches('-').chars().take(36).collect();
    slug = slug.trim_end_matches('-').to_string();
    if slug.is_empty() {
        slug = "my-theme".into();
    }
    if !taken.contains(&slug) {
        return slug;
    }
    (2..)
        .map(|n| format!("{slug}-{n}"))
        .find(|candidate| !taken.contains(candidate))
        .expect("an unused name")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::look_contrast::contrast;

    fn christmas() -> Value {
        json!({
            "label": "Christmas Kitchen",
            "summary": "Cranberry and pine on warm snow.",
            "colorScheme": "light",
            "light": { "page": "#fbf8f2", "surface": "#ffffff", "text": "#1d2a22", "muted": "#6b7a70", "border": "#dfe5dc", "accent": "#c4283c" },
            "dark": { "page": "#0e1c19", "surface": "#142720", "text": "#f4efe4", "muted": "#9aa89e", "border": "#2c4a3d", "accent": "#e8c060" },
            "font": "classic-serif",
            "headingFont": "theme",
            "roundness": "soft",
            "textSize": "large"
        })
    }

    fn color(theme: &Value, scheme: &str, key: &str) -> Rgb {
        Rgb::parse(theme["colors"][scheme][key].as_str().unwrap()).unwrap()
    }

    #[test]
    fn a_draft_becomes_a_theme_that_extends_the_site_theme() {
        let draft = ThemeDraft::from_json(&christmas()).unwrap();
        let made = draft.to_theme("grammis");
        let theme = &made.theme;
        assert_eq!(theme["extends"], "grammis");
        assert_eq!(theme["label"], "Christmas Kitchen");
        assert!(theme["fonts"]["body"].as_str().unwrap().contains("Georgia"));
        assert!(
            theme["fonts"].get("heading").is_none(),
            "theme keeps the parent's heading font"
        );
        assert_eq!(theme["tokens"]["radius"], "8px");
        assert_eq!(theme["tokens"]["bodySize"], "1.1875rem");
        for key in [
            "outer",
            "surfaceRaised",
            "accentBorder",
            "accentContrast",
            "glow",
            "link",
            "ink",
        ] {
            assert!(theme["colors"]["light"][key].is_string(), "{key}");
            assert!(theme["colors"]["dark"][key].is_string(), "{key}");
        }
        // It is a theme file the engine reads.
        crate::theme::ThemeFile::from_json(&theme.to_string()).unwrap();
    }

    #[test]
    fn hard_to_read_colours_are_moved_and_the_change_is_said() {
        let mut faint = christmas();
        faint["light"]["text"] = json!("#b0b0b0");
        faint["light"]["accent"] = json!("#ffd0d0");
        let made = ThemeDraft::from_json(&faint).unwrap().to_theme("base");
        for scheme in ["light", "dark"] {
            let page = color(&made.theme, scheme, "page");
            assert!(
                contrast(color(&made.theme, scheme, "text"), page) >= HIGH - 0.01,
                "{scheme} text"
            );
            assert!(
                contrast(color(&made.theme, scheme, "muted"), page) >= TEXT - 0.01,
                "{scheme} muted"
            );
            assert!(
                contrast(color(&made.theme, scheme, "accent"), page) >= TEXT - 0.01,
                "{scheme} accent"
            );
            let on_accent = contrast(
                color(&made.theme, scheme, "accentContrast"),
                color(&made.theme, scheme, "accent"),
            );
            assert!(on_accent >= TEXT - 0.01, "{scheme} button text");
        }
        let notes = made.notes.join(" ");
        assert!(
            notes.contains("In light mode, the writing was made a little darker"),
            "{notes}"
        );
        assert!(notes.contains("main colour"), "{notes}");
    }

    #[test]
    fn nothing_but_the_draft_fields_is_accepted() {
        let mut css = christmas();
        css["stylesheets"] = json!(["evil.css"]);
        assert!(ThemeDraft::from_json(&css)
            .unwrap_err()
            .contains("`stylesheets`"));
        let mut extra_color = christmas();
        extra_color["light"]["background-image"] = json!("url(x)");
        assert!(ThemeDraft::from_json(&extra_color)
            .unwrap_err()
            .contains("background-image"));
        let mut injected = christmas();
        injected["light"]["accent"] = json!("red;}body{display:none");
        assert!(ThemeDraft::from_json(&injected)
            .unwrap_err()
            .contains("colour written like"));
        let mut font = christmas();
        font["font"] = json!("\"Comic Sans\", url(x)");
        assert!(ThemeDraft::from_json(&font)
            .unwrap_err()
            .contains("`font` must be one of"));
        let mut label = christmas();
        label["label"] = json!("two\nlines");
        assert!(ThemeDraft::from_json(&label).is_err());
    }

    #[test]
    fn the_draft_round_trips_for_the_editor() {
        let draft = ThemeDraft::from_json(&christmas()).unwrap();
        assert_eq!(ThemeDraft::from_json(&draft.to_json()).unwrap(), draft);
    }

    #[test]
    fn a_new_theme_gets_a_folder_name_of_its_own() {
        let taken = vec!["christmas".to_string(), "christmas-kitchen".to_string()];
        assert_eq!(
            theme_slug("Christmas Kitchen!", &taken),
            "christmas-kitchen-2"
        );
        assert_eq!(
            theme_slug("Easter at Grammi's", &taken),
            "easter-at-grammi-s"
        );
        assert_eq!(theme_slug("✨✨", &taken), "my-theme");
    }
}
