//! Theme components (ADR 0408): web components a theme offers for an owner to place on the landing
//! page, chosen from a menu and set up with a form.
//!
//! A theme declares each one in `theme.json` under `components`, keyed by its custom element name:
//!
//! ```json
//! "components": {
//!   "holiday-countdown": {
//!     "label": "Countdown sign",
//!     "description": "How many days until the holiday.",
//!     "script": "components/holiday-countdown.js",
//!     "props": [
//!       { "name": "holiday", "type": "choice", "label": "Which holiday",
//!         "choices": [ { "value": "thanksgiving", "label": "Thanksgiving" },
//!                      { "value": "christmas", "label": "Christmas" } ],
//!         "default": "thanksgiving" }
//!     ]
//!   }
//! }
//! ```
//!
//! A setting is `text` (one line, at most `maxLength` characters), `choice` (one of `choices`),
//! `number` (between `min` and `max`), `toggle` (on or off) or `date` (a calendar day, written
//! `YYYY-MM-DD`, which Admin offers as a date picker). The section that places a component
//! holds only its name and the values of these settings, so nothing an owner types is ever markup:
//! every value is checked against its declaration and written as an escaped attribute. The script
//! is a file of the theme itself, never an address elsewhere.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

/// The most settings one component may declare.
pub const MAX_PROPS: usize = 20;
/// The longest text setting, when a component does not say.
pub const DEFAULT_TEXT_LENGTH: usize = 200;
/// The longest text setting a component may allow.
pub const MAX_TEXT_LENGTH: usize = 2_000;

/// What `theme.json` says about one component.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct ComponentDecl {
    pub label: String,
    pub description: String,
    /// The module that defines the element, relative to the theme folder.
    pub script: String,
    /// One line said where scripts do not run (a reader without JavaScript, Admin's preview).
    pub fallback: String,
    /// The Zubra source, relative to the theme folder (ADR 0409). A build with the `zubra` feature
    /// renders it with the section's values, so the element has its content before it starts.
    pub source: String,
    pub props: Vec<PropDecl>,
}

/// One setting a component takes.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct PropDecl {
    /// The attribute it is written as.
    pub name: String,
    /// `text`, `choice`, `number` or `toggle`.
    #[serde(rename = "type")]
    pub kind: String,
    pub label: String,
    pub help: String,
    pub required: bool,
    pub default: Option<Value>,
    pub choices: Vec<Choice>,
    pub min: Option<f64>,
    pub max: Option<f64>,
    pub max_length: Option<usize>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct Choice {
    pub value: String,
    pub label: String,
}

/// A checked component, as a resolved theme carries it.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Component {
    pub tag: String,
    pub label: String,
    pub description: String,
    /// Relative to the theme folder until the theme makes it an absolute site URL.
    pub script: String,
    pub fallback: String,
    /// The `.zb` source; relative until the theme makes it an absolute site path. Empty when none.
    pub source: String,
    pub props: Vec<PropDecl>,
}

/// An attribute name a setting may use: lowercase letters, digits and single hyphens, starting with a
/// letter, never an event handler (`on…`) and never one the page itself relies on.
fn valid_attribute(name: &str) -> bool {
    let bytes = name.as_bytes();
    !name.is_empty()
        && name.len() <= 40
        && bytes[0].is_ascii_lowercase()
        && bytes
            .iter()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || *b == b'-')
        && !name.ends_with('-')
        && !name.contains("--")
        && !name.starts_with("on")
        && !matches!(
            name,
            "id" | "class" | "style" | "slot" | "is" | "part" | "hidden" | "src" | "href"
        )
}

/// A path inside the theme folder: relative, with no `..`, no empty part and no address.
fn valid_path(path: &str) -> bool {
    !path.is_empty()
        && !path.starts_with('/')
        && !path.contains("://")
        && !path.contains('\\')
        && !path
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
}

/// A script path inside the theme folder, ending in `.js` or `.mjs`.
fn valid_script(path: &str) -> bool {
    valid_path(path) && (path.ends_with(".js") || path.ends_with(".mjs"))
}

fn one_line(text: &str) -> bool {
    !text.chars().any(char::is_control)
}

impl Component {
    /// Check a declaration. The first problem is returned in words.
    pub fn check(tag: &str, decl: &ComponentDecl) -> Result<Component, String> {
        if !crate::theme::valid_custom_element_name(tag) {
            return Err(
                "the name must be a custom element name: lowercase, with a hyphen, like `my-sign`"
                    .into(),
            );
        }
        if decl.label.trim().is_empty() || !one_line(&decl.label) || decl.label.chars().count() > 60
        {
            return Err("give it a `label` of one line, at most 60 characters, that an owner will recognize".into());
        }
        if !one_line(&decl.description) || decl.description.chars().count() > 300 {
            return Err("the `description` is one line of at most 300 characters".into());
        }
        if !one_line(&decl.fallback) || decl.fallback.chars().count() > 200 {
            return Err("the `fallback` is one line of at most 200 characters".into());
        }
        if !decl.source.is_empty() && !(valid_path(&decl.source) && decl.source.ends_with(".zb")) {
            return Err(
                "`source` must be a .zb file inside the theme folder, like `components/my-sign.zb`"
                    .into(),
            );
        }
        if !valid_script(&decl.script) {
            return Err(
                "`script` must be a .js file inside the theme folder, like `components/my-sign.js`"
                    .into(),
            );
        }
        if decl.props.len() > MAX_PROPS {
            return Err(format!("declare at most {MAX_PROPS} settings"));
        }
        let mut seen = Vec::new();
        for prop in &decl.props {
            let name = prop.name.as_str();
            if !valid_attribute(name) {
                return Err(format!(
                    "the setting `{}` needs a plain attribute name (lowercase letters, digits and hyphens, not starting with `on`)",
                    printable(name)
                ));
            }
            if seen.contains(&name) {
                return Err(format!("the setting `{name}` is declared twice"));
            }
            seen.push(name);
            if prop.label.trim().is_empty()
                || !one_line(&prop.label)
                || prop.label.chars().count() > 60
            {
                return Err(format!(
                    "the setting `{name}` needs a `label` of one line, at most 60 characters"
                ));
            }
            if !one_line(&prop.help) || prop.help.chars().count() > 300 {
                return Err(format!(
                    "the setting `{name}`: `help` is one line of at most 300 characters"
                ));
            }
            match prop.kind.as_str() {
                "text" => {
                    if prop
                        .max_length
                        .is_some_and(|n| n == 0 || n > MAX_TEXT_LENGTH)
                    {
                        return Err(format!(
                            "the setting `{name}`: maxLength is from 1 to {MAX_TEXT_LENGTH}"
                        ));
                    }
                }
                "choice" => {
                    if prop.choices.is_empty() || prop.choices.len() > 50 {
                        return Err(format!("the setting `{name}` needs from 1 to 50 `choices`"));
                    }
                    for choice in &prop.choices {
                        if choice.value.is_empty()
                            || !one_line(&choice.value)
                            || choice.label.trim().is_empty()
                        {
                            return Err(format!(
                                "every choice of `{name}` needs a `value` and a `label`"
                            ));
                        }
                    }
                }
                "number" => {
                    if let (Some(min), Some(max)) = (prop.min, prop.max) {
                        if min > max {
                            return Err(format!("the setting `{name}`: min is more than max"));
                        }
                    }
                }
                "toggle" | "date" => {}
                other => {
                    return Err(format!(
                    "the setting `{name}` has the type `{}`; use text, choice, number, toggle or date",
                    printable(other)
                ))
                }
            }
            if let Some(default) = &prop.default {
                prop.value(default)
                    .map_err(|problem| format!("the default of `{name}` {problem}"))?;
            }
        }
        Ok(Component {
            tag: tag.to_string(),
            label: decl.label.trim().to_string(),
            description: decl.description.trim().to_string(),
            script: decl.script.clone(),
            fallback: decl.fallback.trim().to_string(),
            source: decl.source.clone(),
            props: decl.props.clone(),
        })
    }

    /// The attributes for the values a section gives, in declaration order: `(name, Some(value))`,
    /// or `(name, None)` for a toggle that is on. A setting left out takes its default; every
    /// problem is returned in words.
    pub fn attributes(
        &self,
        values: &Map<String, Value>,
    ) -> Result<Vec<(String, Option<String>)>, Vec<String>> {
        let mut problems = Vec::new();
        for key in values.keys() {
            if !self.props.iter().any(|prop| &prop.name == key) {
                problems.push(format!(
                    "{} has no setting called `{}`",
                    self.label,
                    printable(key)
                ));
            }
        }
        let mut out = Vec::new();
        for prop in &self.props {
            let given = values.get(&prop.name).filter(|v| !v.is_null());
            let Some(value) = given.or(prop.default.as_ref()) else {
                if prop.required {
                    problems.push(format!("{}: fill in {}", self.label, prop.label));
                }
                continue;
            };
            match prop.value(value) {
                Ok(Some(text)) => out.push((prop.name.clone(), Some(text))),
                Ok(None) => out.push((prop.name.clone(), None)),
                Err(_) if prop.kind == "toggle" => {}
                Err(problem) => problems.push(format!("{}: {} {problem}", self.label, prop.label)),
            }
        }
        if problems.is_empty() {
            Ok(out)
        } else {
            Err(problems)
        }
    }

    /// What Admin needs to list the component and build its form.
    pub fn to_json(&self) -> Value {
        json!({
            "tag": self.tag,
            "label": self.label,
            "description": self.description,
            "fallback": self.fallback,
            "props": self.props.iter().map(|prop| {
                let mut out = json!({ "name": prop.name, "type": prop.kind, "label": prop.label });
                if !prop.help.is_empty() { out["help"] = json!(prop.help); }
                if prop.required { out["required"] = json!(true); }
                if let Some(default) = &prop.default { out["default"] = default.clone(); }
                if !prop.choices.is_empty() { out["choices"] = json!(prop.choices); }
                if let Some(min) = prop.min { out["min"] = json!(min); }
                if let Some(max) = prop.max { out["max"] = json!(max); }
                if prop.kind == "text" { out["maxLength"] = json!(prop.max_length.unwrap_or(DEFAULT_TEXT_LENGTH)); }
                out
            }).collect::<Vec<_>>(),
        })
    }
}

impl PropDecl {
    /// The attribute value for `value`: `Some(text)`, `None` for a toggle that is on, or the problem.
    /// A toggle that is off is an `Err` the caller leaves out.
    fn value(&self, value: &Value) -> Result<Option<String>, String> {
        match (self.kind.as_str(), value) {
            ("text", Value::String(text)) => {
                let limit = self.max_length.unwrap_or(DEFAULT_TEXT_LENGTH);
                if !one_line(text) {
                    Err("must be on one line".into())
                } else if text.chars().count() > limit {
                    Err(format!("is longer than {limit} characters"))
                } else {
                    Ok(Some(text.clone()))
                }
            }
            ("choice", Value::String(text)) => {
                if self.choices.iter().any(|choice| &choice.value == text) {
                    Ok(Some(text.clone()))
                } else {
                    Err(format!(
                        "must be one of {}",
                        self.choices
                            .iter()
                            .map(|c| c.label.as_str())
                            .collect::<Vec<_>>()
                            .join(", ")
                    ))
                }
            }
            ("number", Value::Number(number)) => {
                let n = number
                    .as_f64()
                    .filter(|n| n.is_finite())
                    .ok_or("must be a number")?;
                if self.min.is_some_and(|min| n < min) || self.max.is_some_and(|max| n > max) {
                    Err(format!(
                        "must be from {} to {}",
                        self.min.map_or("any".into(), |v| v.to_string()),
                        self.max.map_or("any".into(), |v| v.to_string())
                    ))
                } else {
                    Ok(Some(number.to_string()))
                }
            }
            ("date", Value::String(text)) => {
                if is_calendar_day(text) {
                    Ok(Some(text.clone()))
                } else {
                    Err("must be a day, written like 2026-12-25".into())
                }
            }
            ("toggle", Value::Bool(true)) => Ok(None),
            ("toggle", Value::Bool(false)) => Err("is off".into()),
            ("text" | "choice", _) => Err("must be text".into()),
            ("date", _) => Err("must be a day, written like 2026-12-25".into()),
            ("number", _) => Err("must be a number".into()),
            ("toggle", _) => Err("must be on or off".into()),
            _ => Err("has a type this release does not know".into()),
        }
    }
}

/// `YYYY-MM-DD` naming a day that exists (2026-02-30 does not).
fn is_calendar_day(text: &str) -> bool {
    let b = text.as_bytes();
    if b.len() != 10 || b[4] != b'-' || b[7] != b'-' {
        return false;
    }
    let digits = |range: std::ops::Range<usize>| b[range].iter().all(u8::is_ascii_digit);
    if !(digits(0..4) && digits(5..7) && digits(8..10)) {
        return false;
    }
    crate::date::DateTime::parse(text).is_some_and(|day| day.ymd() == text)
}

fn printable(value: &str) -> String {
    value
        .chars()
        .take(40)
        .map(|c| {
            if c.is_alphanumeric() || matches!(c, '-' | '_') {
                c
            } else {
                '?'
            }
        })
        .collect()
}

/// The components every one of `themes` offers, by tag: what an owner may place on a page that has
/// to read the same in every theme the site can wear.
pub fn common(themes: &[crate::theme::Theme]) -> BTreeMap<&str, &Component> {
    let Some((first, rest)) = themes.split_first() else {
        return BTreeMap::new();
    };
    first
        .components
        .iter()
        .filter(|(tag, _)| rest.iter().all(|theme| theme.components.contains_key(*tag)))
        .map(|(tag, component)| (tag.as_str(), component))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn countdown() -> ComponentDecl {
        serde_json::from_value(json!({
            "label": "Countdown sign",
            "description": "Days until the holiday.",
            "script": "components/holiday-countdown.js",
            "props": [
                { "name": "holiday", "type": "choice", "label": "Which holiday", "default": "thanksgiving",
                  "choices": [ { "value": "thanksgiving", "label": "Thanksgiving" }, { "value": "christmas", "label": "Christmas" } ] },
                { "name": "note", "type": "text", "label": "A line under it", "maxLength": 40 },
                { "name": "size", "type": "number", "label": "Size", "min": 1, "max": 3 },
                { "name": "sparkle", "type": "toggle", "label": "Sparkle" }
            ]
        }))
        .unwrap()
    }

    fn values(v: Value) -> Map<String, Value> {
        v.as_object().unwrap().clone()
    }

    #[test]
    fn a_declared_component_is_checked_and_its_values_become_attributes() {
        let c = Component::check("holiday-countdown", &countdown()).unwrap();
        assert_eq!(
            c.attributes(&Map::new()).unwrap(),
            vec![("holiday".into(), Some("thanksgiving".into()))]
        );
        let attrs = c
            .attributes(&values(
                json!({ "holiday": "christmas", "note": "Ho ho", "size": 2, "sparkle": true }),
            ))
            .unwrap();
        assert_eq!(
            attrs,
            vec![
                ("holiday".into(), Some("christmas".into())),
                ("note".into(), Some("Ho ho".into())),
                ("size".into(), Some("2".into())),
                ("sparkle".into(), None),
            ]
        );
        assert_eq!(
            c.attributes(&values(json!({ "sparkle": false })))
                .unwrap()
                .len(),
            1,
            "a toggle that is off is left out"
        );
    }

    #[test]
    fn values_are_held_to_their_declaration() {
        let c = Component::check("holiday-countdown", &countdown()).unwrap();
        let problems = c
            .attributes(&values(
                json!({ "holiday": "easter", "note": "line\nbreak", "size": 9, "onclick": "x" }),
            ))
            .unwrap_err()
            .join("\n");
        assert!(
            problems.contains("no setting called `onclick`"),
            "{problems}"
        );
        assert!(
            problems.contains("must be one of Thanksgiving, Christmas"),
            "{problems}"
        );
        assert!(problems.contains("must be on one line"), "{problems}");
        assert!(problems.contains("must be from 1 to 3"), "{problems}");
    }

    #[test]
    fn a_date_setting_takes_a_real_day() {
        let mut decl = countdown();
        decl.props.push(
            serde_json::from_value(
                json!({ "name": "day", "type": "date", "label": "The day", "default": "2026-12-25" }),
            )
            .unwrap(),
        );
        let c = Component::check("holiday-countdown", &decl).unwrap();
        assert!(c
            .attributes(&Map::new())
            .unwrap()
            .contains(&("day".into(), Some("2026-12-25".into()))));
        assert!(c
            .attributes(&values(json!({ "day": "1986-06-14" })))
            .unwrap()
            .contains(&("day".into(), Some("1986-06-14".into()))));
        for bad in [
            "2026-02-30",
            "12-25",
            "2026-1-5",
            "2026-12-25T00:00:00Z",
            "soon",
        ] {
            let problems = c
                .attributes(&values(json!({ "day": bad })))
                .unwrap_err()
                .join("\n");
            assert!(
                problems.contains("written like 2026-12-25"),
                "{bad}: {problems}"
            );
        }
        assert_eq!(c.to_json()["props"][4]["type"], "date");
        decl.props[4].default = Some(json!("Christmas"));
        assert!(Component::check("holiday-countdown", &decl)
            .unwrap_err()
            .contains("default of `day`"));
    }

    #[test]
    fn a_declaration_that_could_inject_is_refused() {
        let mut bad = countdown();
        bad.script = "https://example.com/x.js".into();
        assert!(Component::check("holiday-countdown", &bad)
            .unwrap_err()
            .contains("inside the theme folder"));
        bad.script = "../../secret.js".into();
        assert!(Component::check("holiday-countdown", &bad).is_err());
        let mut handler = countdown();
        handler.props[0].name = "onload".into();
        assert!(Component::check("holiday-countdown", &handler)
            .unwrap_err()
            .contains("attribute name"));
        assert!(Component::check("Countdown", &countdown())
            .unwrap_err()
            .contains("custom element name"));
        let mut bad_default = countdown();
        bad_default.props[0].default = Some(json!("easter"));
        assert!(Component::check("holiday-countdown", &bad_default)
            .unwrap_err()
            .contains("default of `holiday`"));
    }

    #[test]
    fn admin_gets_the_form_it_needs() {
        let c = Component::check("holiday-countdown", &countdown()).unwrap();
        let described = c.to_json();
        assert_eq!(described["label"], "Countdown sign");
        assert_eq!(described["props"][0]["choices"][1]["value"], "christmas");
        assert_eq!(described["props"][1]["maxLength"], 40);
    }
}
