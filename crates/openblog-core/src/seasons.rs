//! Seasons (ADR 0407): the site wears a different theme for part of each year, the way a house is
//! decorated for a holiday and then put back.
//!
//! Stored under `seasons` in `openblog.json`:
//! `{ "version": 1, "enabled": true, "windows": [ { "theme": "christmas", "start": "12-01", "end": "01-06" } ] }`.
//! While `enabled`, a build on a day inside a window uses that window's theme as the site theme; on
//! any other day the site keeps its own `theme`, which is the look between seasons. The first window
//! that holds the day wins. A window may cross the new year. A series, page or post that names its
//! own theme keeps it whatever the season, so a holiday's recipes stay dressed for their holiday.
//!
//! Absent means off: nothing is written back and every page builds exactly as before. Everything
//! here is pure, so the same config and day always give the same theme.

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::{json, Map, Value};

use crate::date::DateTime;
use crate::seasonal::MonthDay;

/// The only stored version this release reads or writes.
pub const SEASONS_VERSION: u64 = 1;
/// The most windows a site may list.
pub const MAX_WINDOWS: usize = 24;

/// One stretch of the year and the theme the site wears during it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Window {
    pub theme: String,
    pub start: MonthDay,
    pub end: MonthDay,
}

impl Window {
    /// Whether `day` falls inside the window, counting both ends. A window whose end comes before
    /// its start crosses the new year (`12-01` to `01-06`).
    pub fn holds(&self, day: MonthDay) -> bool {
        if self.start <= self.end {
            self.start <= day && day <= self.end
        } else {
            day >= self.start || day <= self.end
        }
    }
}

/// The site's seasons.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SeasonsConfig {
    pub enabled: bool,
    pub windows: Vec<Window>,
}

/// The month and day of a moment, in UTC (as scheduling reads dates).
pub fn month_day(at: DateTime) -> MonthDay {
    let civil = at.civil();
    MonthDay {
        month: civil.month,
        day: civil.day,
    }
}

fn kind(value: &Value) -> &'static str {
    match value {
        Value::Null => "nothing",
        Value::Bool(_) => "true or false",
        Value::Number(_) => "a number",
        Value::String(_) => "text",
        Value::Array(_) => "a list",
        Value::Object(_) => "an object",
    }
}

/// A theme name as a theme folder is named: lowercase letters, digits, `-` and `_`.
fn valid_theme_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && name
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_')
}

impl SeasonsConfig {
    /// True when nothing is stated, so the key is left out of the written file.
    pub fn is_default(&self) -> bool {
        !self.enabled && self.windows.is_empty()
    }

    /// The theme the site wears on `day`, or `None` when seasons are off or no window holds it
    /// (the site's own `theme` then applies).
    pub fn theme_on(&self, day: MonthDay) -> Option<&str> {
        if !self.enabled {
            return None;
        }
        self.windows
            .iter()
            .find(|window| window.holds(day))
            .map(|window| window.theme.as_str())
    }

    /// The start (UTC midnight) of the next day whose theme differs from today's, so a long-running
    /// server knows when to rebuild. `None` when seasons are off or nothing changes within a year.
    pub fn next_change(&self, now: DateTime) -> Option<DateTime> {
        if !self.enabled || self.windows.is_empty() {
            return None;
        }
        let today = now.unix().div_euclid(86_400);
        let wearing = self.theme_on(month_day(now));
        (1..=366).find_map(|ahead| {
            let midnight = DateTime::from_unix((today + ahead) * 86_400);
            (self.theme_on(month_day(midnight)) != wearing).then_some(midnight)
        })
    }

    /// Every theme the windows name, once each, in order.
    pub fn themes(&self) -> Vec<&str> {
        let mut names: Vec<&str> = Vec::new();
        for window in &self.windows {
            if !names.contains(&window.theme.as_str()) {
                names.push(&window.theme);
            }
        }
        names
    }

    /// Validate a stored or submitted `seasons` value. Every problem is reported, in words.
    pub fn from_value(value: &Value) -> Result<SeasonsConfig, Vec<String>> {
        let object = match value {
            Value::Null => return Ok(SeasonsConfig::default()),
            Value::Object(object) => object,
            other => {
                return Err(vec![format!(
                    "seasons must be an object, not {}",
                    kind(other)
                )])
            }
        };
        let mut errors = Vec::new();
        match object.get("version") {
            None => {}
            Some(Value::Number(n)) if n.as_u64() == Some(SEASONS_VERSION) => {}
            Some(Value::Number(n)) if n.as_u64().is_some_and(|v| v > SEASONS_VERSION) => {
                return Err(vec![
                    "seasons was saved by a newer version of open.blog; update before editing it"
                        .to_string(),
                ])
            }
            Some(_) => errors.push(format!("seasons: version must be {SEASONS_VERSION}")),
        }
        for key in object.keys() {
            if !matches!(key.as_str(), "version" | "enabled" | "windows") {
                errors.push(format!(
                    "seasons: `{key}` is not a setting this release knows; use `enabled` and `windows`"
                ));
            }
        }
        let enabled = match object.get("enabled") {
            None => false,
            Some(Value::Bool(on)) => *on,
            Some(other) => {
                errors.push(format!(
                    "seasons: enabled must be true or false, not {}",
                    kind(other)
                ));
                false
            }
        };
        let mut windows = Vec::new();
        match object.get("windows") {
            None => {}
            Some(Value::Array(list)) => {
                if list.len() > MAX_WINDOWS {
                    errors.push(format!("seasons: list at most {MAX_WINDOWS} windows"));
                }
                for (index, entry) in list.iter().enumerate() {
                    match parse_window(index + 1, entry) {
                        Ok(window) => windows.push(window),
                        Err(mut problems) => errors.append(&mut problems),
                    }
                }
            }
            Some(other) => errors.push(format!(
                "seasons: windows must be a list, not {}",
                kind(other)
            )),
        }
        if errors.is_empty() {
            Ok(SeasonsConfig { enabled, windows })
        } else {
            Err(errors)
        }
    }

    /// The stored form: only what is stated, in a fixed order.
    pub fn to_value(&self) -> Value {
        let mut object = Map::new();
        object.insert("version".into(), json!(SEASONS_VERSION));
        object.insert("enabled".into(), json!(self.enabled));
        object.insert(
            "windows".into(),
            Value::Array(
                self.windows
                    .iter()
                    .map(|w| json!({ "theme": w.theme, "start": w.start.text(), "end": w.end.text() }))
                    .collect(),
            ),
        );
        Value::Object(object)
    }
}

fn parse_window(at: usize, value: &Value) -> Result<Window, Vec<String>> {
    let Value::Object(object) = value else {
        return Err(vec![format!(
            "seasons window {at} must be an object, not {}",
            kind(value)
        )]);
    };
    let mut errors = Vec::new();
    for key in object.keys() {
        if !matches!(key.as_str(), "theme" | "start" | "end") {
            errors.push(format!(
                "seasons window {at}: `{key}` is not a field this release knows; use `theme`, `start` and `end`"
            ));
        }
    }
    let theme = match object.get("theme") {
        Some(Value::String(name)) if valid_theme_name(name.trim()) => name.trim().to_string(),
        Some(Value::String(name)) => {
            errors.push(format!(
                "seasons window {at}: `{name}` is not a theme name; use the name of a folder in themes/"
            ));
            String::new()
        }
        Some(other) => {
            errors.push(format!(
                "seasons window {at}: theme must be text, not {}",
                kind(other)
            ));
            String::new()
        }
        None => {
            errors.push(format!("seasons window {at}: name the theme it puts up"));
            String::new()
        }
    };
    let mut day = |field: &str| -> Option<MonthDay> {
        match object.get(field) {
            Some(Value::String(text)) => MonthDay::parse(text).or_else(|| {
                errors.push(format!(
                    "seasons window {at}: {field} `{text}` is not a day of the year; write it as MM-DD, like 12-01"
                ));
                None
            }),
            Some(other) => {
                errors.push(format!(
                    "seasons window {at}: {field} must be a day written MM-DD, not {}",
                    kind(other)
                ));
                None
            }
            None => {
                errors.push(format!("seasons window {at}: give the {field} day, written MM-DD"));
                None
            }
        }
    };
    let start = day("start");
    let end = day("end");
    match (start, end, errors.is_empty()) {
        (Some(start), Some(end), true) => Ok(Window { theme, start, end }),
        _ => Err(errors),
    }
}

impl Serialize for SeasonsConfig {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.to_value().serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for SeasonsConfig {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = Value::deserialize(deserializer)?;
        SeasonsConfig::from_value(&value)
            .map_err(|errors| serde::de::Error::custom(errors.join("; ")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(text: &str) -> Result<SeasonsConfig, Vec<String>> {
        SeasonsConfig::from_value(&serde_json::from_str(text).unwrap())
    }

    fn md(text: &str) -> MonthDay {
        MonthDay::parse(text).unwrap()
    }

    const HOUSE: &str = r#"{ "enabled": true, "windows": [
        { "theme": "thanksgiving", "start": "10-15", "end": "11-30" },
        { "theme": "christmas", "start": "12-01", "end": "01-06" } ] }"#;

    #[test]
    fn nothing_stated_is_off() {
        let off = parse("null").unwrap();
        assert!(off.is_default());
        assert_eq!(off.theme_on(md("12-25")), None);
    }

    #[test]
    fn the_window_holding_the_day_names_the_theme() {
        let seasons = parse(HOUSE).unwrap();
        assert_eq!(seasons.theme_on(md("10-15")), Some("thanksgiving"));
        assert_eq!(seasons.theme_on(md("11-30")), Some("thanksgiving"));
        assert_eq!(seasons.theme_on(md("12-01")), Some("christmas"));
        assert_eq!(
            seasons.theme_on(md("01-06")),
            Some("christmas"),
            "a window can cross the new year"
        );
        assert_eq!(
            seasons.theme_on(md("01-07")),
            None,
            "between seasons the site's own theme applies"
        );
        assert_eq!(seasons.theme_on(md("07-04")), None);
    }

    #[test]
    fn turned_off_keeps_the_windows_but_puts_nothing_up() {
        let seasons = parse(&HOUSE.replace("true", "false")).unwrap();
        assert!(
            !seasons.is_default(),
            "the calendar is kept for when it is turned back on"
        );
        assert_eq!(seasons.theme_on(md("12-25")), None);
    }

    #[test]
    fn the_first_window_wins_where_two_overlap() {
        let seasons = parse(
            r#"{ "enabled": true, "windows": [
                { "theme": "birthday", "start": "11-20", "end": "11-22" },
                { "theme": "thanksgiving", "start": "11-01", "end": "11-30" } ] }"#,
        )
        .unwrap();
        assert_eq!(seasons.theme_on(md("11-21")), Some("birthday"));
        assert_eq!(seasons.theme_on(md("11-23")), Some("thanksgiving"));
    }

    #[test]
    fn mistakes_are_named_in_plain_words() {
        let errors = parse(
            r#"{ "enabled": "yes", "windows": [ { "theme": "Xmas!", "start": "12-32" }, 4 ], "pin": "x" }"#,
        )
        .unwrap_err();
        let all = errors.join("\n");
        assert!(all.contains("enabled must be true or false"), "{all}");
        assert!(all.contains("`Xmas!` is not a theme name"), "{all}");
        assert!(all.contains("`12-32` is not a day of the year"), "{all}");
        assert!(all.contains("give the end day"), "{all}");
        assert!(all.contains("window 2 must be an object"), "{all}");
        assert!(all.contains("`pin` is not a setting"), "{all}");
        assert!(parse(r#"{ "version": 2 }"#).unwrap_err()[0].contains("newer version"));
    }

    #[test]
    fn the_stored_form_round_trips() {
        let seasons = parse(HOUSE).unwrap();
        let again = SeasonsConfig::from_value(&seasons.to_value()).unwrap();
        assert_eq!(seasons, again);
        assert_eq!(seasons.themes(), vec!["thanksgiving", "christmas"]);
    }

    #[test]
    fn the_next_change_is_the_midnight_the_decorations_change() {
        let seasons = parse(HOUSE).unwrap();
        let at = |text: &str| DateTime::parse(text).unwrap();
        assert_eq!(
            seasons.next_change(at("2026-11-12T15:00:00Z")),
            Some(at("2026-12-01T00:00:00Z"))
        );
        assert_eq!(
            seasons.next_change(at("2026-12-20T08:00:00Z")),
            Some(at("2027-01-07T00:00:00Z"))
        );
        assert_eq!(
            seasons.next_change(at("2027-03-01T00:00:00Z")),
            Some(at("2027-10-15T00:00:00Z"))
        );
        assert_eq!(
            parse("null")
                .unwrap()
                .next_change(at("2026-12-01T00:00:00Z")),
            None
        );
    }

    #[test]
    fn a_moment_is_read_as_its_utc_day() {
        let at = DateTime::parse("2026-12-25T23:30:00Z").unwrap();
        assert_eq!(month_day(at), md("12-25"));
    }
}
