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
    /// Each change in a sentence.
    pub notes: Vec<String>,
    /// Each change as data, in the order of `notes`: `{ scheme, role, change, from, to, with?,
    /// words }`. `role` is `text`, `muted`, `accent` or `surface`; `change` is `darker`, `lighter`
    /// or `replaced`; `with` names what a replaced colour uses (`black`, `white`, `text`, `page`).
    pub changes: Vec<Value>,
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
        let mut changes = Vec::new();
        let light = readable_scheme(&self.light, "light", &mut changes);
        let dark = readable_scheme(&self.dark, "dark", &mut changes);
        let notes = changes
            .iter()
            .filter_map(|change| change["words"].as_str().map(str::to_string))
            .collect();
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
            changes,
        }
    }
}

const BLACK: Rgb = Rgb(0, 0, 0);
const WHITE: Rgb = Rgb(255, 255, 255);

/// What a role is called in a sentence.
fn role_words(role: &str) -> &'static str {
    match role {
        "text" => "writing",
        "muted" => "quieter writing (dates and notes)",
        "accent" => "main colour (links and buttons)",
        _ => "boxes",
    }
}

/// One change, as data and as a sentence.
fn change(scheme: &str, role: &str, from: Rgb, to: Rgb, shift: Shift) -> Option<Value> {
    let way = match shift {
        Shift::Darker => "darker",
        Shift::Lighter => "lighter",
        Shift::Unchanged => return None,
    };
    Some(json!({
        "scheme": scheme, "role": role, "change": way, "from": from.hex(), "to": to.hex(),
        "words": format!(
            "In {scheme} mode, the {} was made a little {way} so it is easy to read.",
            role_words(role)
        ),
    }))
}

/// A colour that could not be made readable and what it uses instead.
fn replaced(scheme: &str, role: &str, from: Rgb, to: Rgb, with: &str) -> Value {
    let instead = match with {
        "text" => "the writing colour",
        "page" => "the page colour",
        other => other,
    };
    json!({
        "scheme": scheme, "role": role, "change": "replaced", "from": from.hex(), "to": to.hex(),
        "with": with,
        "words": format!(
            "In {scheme} mode, the {} could not be made easy to read, so it uses {instead} instead.",
            role_words(role)
        ),
    })
}

/// Every colour a scheme needs, from the six given, with text made readable. Whatever the six
/// are (an owner may pick any of them by hand), the result holds: writing at 7:1 where it can be
/// and never under 4.5:1 on the page and on boxes, quiet writing and links at 4.5:1, the text on
/// a button at 4.5:1. A colour that cannot get there is replaced, and each change is recorded.
fn readable_scheme(given: &Palette, scheme: &str, changes: &mut Vec<Value>) -> Map<String, Value> {
    let page = given.page;
    // Boxes so unlike the page that nothing reads on both (black on a white page, say) take the
    // page's colour: no writing colour could be easy to read on the two at once.
    let reads_on_both = |surface: Rgb| {
        [BLACK, WHITE]
            .iter()
            .any(|ink| contrast(*ink, page) >= TEXT && contrast(*ink, surface) >= TEXT)
    };
    let surface = if reads_on_both(given.surface) {
        given.surface
    } else {
        changes.push(replaced(scheme, "surface", given.surface, page, "page"));
        page
    };
    let backgrounds = [page, surface];
    let lowest = |color: Rgb| contrast(color, page).min(contrast(color, surface));
    // Body text at 7:1 where it can be; never under 4.5:1. Where 7:1 is out of reach, the ink that
    // reads best (black or white) beats a colour that only just clears the floor.
    let (best_ink, best_shift) = if lowest(BLACK) >= lowest(WHITE) {
        (BLACK, Shift::Darker)
    } else {
        (WHITE, Shift::Lighter)
    };
    let text = match readable_on(given.text, &backgrounds, HIGH).or_else(|| {
        if lowest(best_ink) >= TEXT && lowest(best_ink) > lowest(given.text) {
            Some((best_ink, best_shift))
        } else {
            readable_on(given.text, &backgrounds, TEXT)
        }
    }) {
        Some((color, shift)) => {
            changes.extend(change(scheme, "text", given.text, color, shift));
            color
        }
        None => {
            // Black or white, whichever reads better on both: one of them always reaches 4.5:1 here.
            let (ink, name) = if lowest(BLACK) >= lowest(WHITE) {
                (BLACK, "black")
            } else {
                (WHITE, "white")
            };
            changes.push(replaced(scheme, "text", given.text, ink, name));
            ink
        }
    };
    let muted = match readable_on(given.muted, &backgrounds, TEXT) {
        Some((color, shift)) => {
            changes.extend(change(scheme, "muted", given.muted, color, shift));
            color
        }
        None => {
            changes.push(replaced(scheme, "muted", given.muted, text, "text"));
            text
        }
    };
    // Borders mark the edges of cards and fields: at least 1.5:1 so they are seen, and lines that
    // separate controls at 3:1 come from the accent's border below.
    let border = if contrast(given.border, page) >= 1.5 {
        given.border
    } else {
        readable_on(given.border, &[page], 1.5).map_or(given.border, |(color, _)| color)
    };
    // The raised surface carries writing too: it is used only when the writing stays readable on it.
    let raised = Some(surface.mix(page, 0.5).mix(border, 0.25))
        .filter(|raised| contrast(text, *raised) >= TEXT)
        .unwrap_or(surface);
    let ground = Ground {
        page,
        surface,
        surface_raised: Some(raised),
        text,
        ink: text,
    };
    let accent = match derive_accent(given.accent, &ground, TEXT) {
        Some(set) => {
            changes.extend(change(
                scheme,
                "accent",
                given.accent,
                set.accent,
                set.shift,
            ));
            set
        }
        None => {
            changes.push(replaced(scheme, "accent", given.accent, text, "text"));
            // The writing colour reads on every one of these grounds, so this cannot fail; the
            // plain set is there so a surprising colour is never a crash.
            derive_accent(text, &ground, TEXT).unwrap_or(crate::look_contrast::AccentSet {
                accent: text,
                accent_border: text,
                accent_contrast: page,
                glow: page,
                shift: Shift::Unchanged,
            })
        }
    };
    let outer = page.mix(text, 0.04);
    let mut out = Map::new();
    for (key, color) in [
        ("page", page),
        ("outer", outer),
        ("surface", surface),
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

    /// A page where 7:1 can't be reached (all mid-grey): the writing takes whichever of black and
    /// white reads best, not a grey that only just clears 4.5:1.
    #[test]
    fn writing_on_a_grey_page_takes_the_more_readable_ink_when_seven_to_one_is_out_of_reach() {
        let mut draft = christmas();
        for key in COLOR_KEYS {
            draft["light"][key] = json!("#808080");
        }
        let made = ThemeDraft::from_json(&draft).unwrap().to_theme("base");
        let page = color(&made.theme, "light", "page");
        let text = color(&made.theme, "light", "text");
        assert!(
            contrast(text, page) >= contrast(BLACK, page) - 0.01,
            "{:?} is {:.2}:1",
            text,
            contrast(text, page)
        );
        let said = made
            .changes
            .iter()
            .find(|c| c["scheme"] == "light" && c["role"] == "text")
            .expect("the change is said");
        assert_eq!(said["change"], "darker");
    }

    /// The promise made to an owner who picks colours by hand: whatever the six are, the theme
    /// that is made reads. Pairs are shared with Studio's client check (`contrastRatio`).
    #[test]
    fn any_colours_an_owner_picks_come_out_readable_in_both_schemes() {
        let picks = [
            "#ffffff", "#000000", "#777777", "#fbf8f2", "#ff0000", "#00ff00", "#0000ff", "#ffff00",
            "#f5f5dc", "#123456", "#808080", "#c0c0c0", "#1a1a1a", "#fefefe",
        ];
        let mut seed = 7u32;
        let mut next = || {
            seed = seed.wrapping_mul(1_103_515_245).wrapping_add(12_345);
            picks[(seed >> 16) as usize % picks.len()]
        };
        for round in 0..400 {
            let mut draft = christmas();
            for scheme in ["light", "dark"] {
                for key in COLOR_KEYS {
                    draft[scheme][key] = json!(next());
                }
            }
            let made = ThemeDraft::from_json(&draft).unwrap().to_theme("base");
            for scheme in ["light", "dark"] {
                let c = |key: &str| color(&made.theme, scheme, key);
                for ground in [c("page"), c("surface"), c("surfaceRaised")] {
                    assert!(
                        contrast(c("text"), ground) >= TEXT - 0.01,
                        "{round} {scheme} text {draft}"
                    );
                }
                for ground in [c("page"), c("surface")] {
                    assert!(
                        contrast(c("muted"), ground) >= TEXT - 0.01,
                        "{round} {scheme} muted {draft}"
                    );
                    assert!(
                        contrast(c("accent"), ground) >= TEXT - 0.01,
                        "{round} {scheme} accent {draft}"
                    );
                }
                assert!(
                    contrast(c("accentContrast"), c("accent")) >= TEXT - 0.01,
                    "{round} {scheme} button text {draft}"
                );
            }
            assert_eq!(made.notes.len(), made.changes.len());
        }
    }

    #[test]
    fn a_colour_that_cannot_be_made_readable_is_replaced_and_said() {
        // White writing on a cream page with white boxes; the page colour equal to the writing.
        let mut same = christmas();
        same["light"]["page"] = json!("#777777");
        same["light"]["surface"] = json!("#777777");
        same["light"]["text"] = json!("#777777");
        same["light"]["muted"] = json!("#777777");
        same["light"]["accent"] = json!("#777777");
        let made = ThemeDraft::from_json(&same).unwrap().to_theme("base");
        let kinds: Vec<(String, String)> = made
            .changes
            .iter()
            .filter(|c| c["scheme"] == "light")
            .map(|c| {
                (
                    c["role"].as_str().unwrap().into(),
                    c["change"].as_str().unwrap().into(),
                )
            })
            .collect();
        assert!(kinds
            .iter()
            .all(|(_, change)| ["darker", "lighter", "replaced"].contains(&change.as_str())));
        assert!(kinds.iter().any(|(role, _)| role == "text"), "{kinds:?}");
        let page = color(&made.theme, "light", "page");
        assert!(contrast(color(&made.theme, "light", "text"), page) >= TEXT - 0.01);

        // Boxes nothing can read on together with the page take the page's colour, and it is said.
        let mut split = christmas();
        split["light"]["page"] = json!("#ffffff");
        split["light"]["surface"] = json!("#7a7a7a");
        let made = ThemeDraft::from_json(&split).unwrap().to_theme("base");
        let note = made.changes.iter().find(|c| c["role"] == "surface");
        if let Some(note) = note {
            assert_eq!(
                (note["change"].as_str(), note["with"].as_str()),
                (Some("replaced"), Some("page"))
            );
            assert!(note["words"]
                .as_str()
                .unwrap()
                .contains("uses the page colour instead"));
        }
        for change in &made.changes {
            assert!(change["from"].as_str().unwrap().starts_with('#'));
            assert!(change["to"].as_str().unwrap().starts_with('#'));
        }
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
