//! Seasonal prompts for a trade site (ADR 0354 to 0356): bundled topics per trade, the site's own
//! changes to them, and the reminders worked out from a date.
//!
//! A topic is a date window ("09-15" to "11-15", which may cross the new year), a short topic and a
//! prompt for a draft. The site stores only its changes, under `seasonalPrompts` in `openblog.json`:
//! `{ "version": 1, "enabled": true, "topics": [ { "id", "disabled", "start", "end", "topic", "prompt" } ] }`.
//! An entry whose id is a bundled topic changes or disables it; any other id adds a topic and needs all
//! of start, end, topic and prompt. Absent means off, nothing is written back and no page changes.
//!
//! Everything here is pure: the same config, trade, date and state always give the same reminders. A
//! reminder only ever names a draft to open; nothing in this module can publish.

use std::collections::BTreeMap;

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::{json, Map, Value};

use crate::date::{Civil, DateTime};

/// The only stored version this release reads or writes.
pub const SEASONAL_VERSION: u64 = 1;
pub const MAX_ENTRIES: usize = 60;
pub const MAX_ID: usize = 40;
pub const MAX_TOPIC: usize = 80;
pub const MAX_PROMPT: usize = 600;
/// How many days ahead a reminder is listed before its window opens.
pub const HORIZON_DAYS: i64 = 30;
/// The longest a reminder may be snoozed in one go, in days.
pub const MAX_SNOOZE_DAYS: i64 = 90;

/// A month and day. February 29 is allowed and is February 28 in a year without one.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct MonthDay {
    pub month: u32,
    pub day: u32,
}

impl MonthDay {
    pub fn parse(text: &str) -> Option<MonthDay> {
        let (month, day) = text.trim().split_once('-')?;
        if month.len() != 2 || day.len() != 2 {
            return None;
        }
        let month: u32 = month.parse().ok()?;
        let day: u32 = day.parse().ok()?;
        // 2000 is a leap year, so 02-29 is accepted here.
        DateTime::from_civil(civil(2000, month, day))?;
        Some(MonthDay { month, day })
    }

    pub fn text(self) -> String {
        format!("{:02}-{:02}", self.month, self.day)
    }

    /// The day number of this month and day in `year`.
    fn in_year(self, year: i64) -> i64 {
        let at = DateTime::from_civil(civil(year, self.month, self.day))
            .or_else(|| DateTime::from_civil(civil(year, self.month, self.day - 1)))
            .map_or(0, DateTime::unix);
        at.div_euclid(86_400)
    }
}

fn civil(year: i64, month: u32, day: u32) -> Civil {
    Civil {
        year,
        month,
        day,
        hour: 0,
        minute: 0,
        second: 0,
    }
}

fn ymd_of(days: i64) -> String {
    DateTime::from_unix(days * 86_400).ymd()
}

/// A day as `YYYY-MM-DD`, read back to a day number.
pub fn parse_day(text: &str) -> Option<i64> {
    let at = DateTime::parse(text.trim())?;
    Some(at.unix().div_euclid(86_400))
}

// ---------------------------------------------------------------------------
// Topics

/// One seasonal topic, bundled or the site's own, after the site's changes.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Topic {
    pub id: String,
    pub topic: String,
    pub prompt: String,
    pub start: MonthDay,
    pub end: MonthDay,
    pub disabled: bool,
    /// True when the topic is the site's own rather than a bundled one.
    pub custom: bool,
}

/// (id, start, end, topic, prompt)
type Bundled = (
    &'static str,
    &'static str,
    &'static str,
    &'static str,
    &'static str,
);

const GENERAL: &[Bundled] = &[
    ("spring-prep", "03-01", "04-30", "Spring checkup", "What should a homeowner check or fix this spring, and what is the most common problem you see when the weather turns?"),
    ("summer-heat", "06-01", "07-31", "Summer planning", "Which jobs are best done in summer, and what should someone book early before the busy season fills up?"),
    ("fall-ready", "09-01", "10-31", "Getting ready for fall", "What do you tell customers to do before the cold weather, and what happens when they put it off?"),
    ("winter-slow", "12-01", "01-31", "A winter job worth showing", "Pick a recent job and tell the story: the problem, what you found, what you did and how it turned out."),
];

const HVAC: &[Bundled] = &[
    ("furnace-tuneup", "09-01", "10-31", "Furnace tune-up before the cold", "Why a furnace should be checked before the first cold snap, what you look at, and the warning signs you hear about too late."),
    ("ac-tuneup", "04-01", "05-31", "Air conditioning check before summer", "What to do before the first hot week: filters, the outdoor unit, and what a service visit covers."),
    ("filter-change", "01-01", "01-31", "Change your filter", "How often to change a filter, how to tell which size, and what a clogged one costs in power and repairs."),
];

const PLUMBING: &[Bundled] = &[
    ("freeze-protection", "10-15", "12-15", "Keep pipes from freezing", "What to do before a hard freeze: outdoor taps, exposed pipes, a vacation shutoff, and what to do if one bursts."),
    ("water-heater", "09-01", "10-31", "Water heater check", "How long a water heater lasts, the signs it is failing, and what an annual flush does."),
    ("spring-leaks", "03-15", "05-15", "Spring leak check", "Where leaks hide after winter and how a homeowner can spot them early."),
];

const ELECTRICAL: &[Bundled] = &[
    ("holiday-lights", "11-01", "12-15", "Holiday lighting safely", "How many strings can share a circuit, outdoor outlets and why a tripping breaker is a message."),
    ("storm-prep", "05-01", "06-30", "Before storm season", "Surge protection, a generator hookup and what to check before the power goes out."),
    ("panel-check", "01-15", "03-15", "Is your panel keeping up?", "Signs an electrical panel is overloaded and what an upgrade involves."),
];

const ROOFING: &[Bundled] = &[
    (
        "spring-roof-check",
        "03-15",
        "05-15",
        "Roof check after winter",
        "What to look for on a roof after winter, and when a patch is enough.",
    ),
    (
        "pre-winter-roof",
        "09-01",
        "10-31",
        "Get the roof ready before winter",
        "Gutters, flashing and loose shingles to deal with before the first snow.",
    ),
    (
        "storm-damage",
        "05-15",
        "08-31",
        "After a storm",
        "How to tell whether a storm damaged a roof, what to photograph and who to call first.",
    ),
];

const LANDSCAPING: &[Bundled] = &[
    (
        "spring-cleanup",
        "03-01",
        "04-30",
        "Spring cleanup",
        "What a good spring cleanup includes and what to do before the lawn starts growing.",
    ),
    (
        "fall-cleanup",
        "10-01",
        "11-30",
        "Fall cleanup and leaves",
        "Leaves, last mowing, and which beds and trees to cut back now.",
    ),
    (
        "irrigation",
        "04-15",
        "05-31",
        "Start the sprinklers",
        "How to start an irrigation system for the year and what a winter freeze can have broken.",
    ),
];

const PAINTING: &[Bundled] = &[
    ("exterior-season", "04-15", "06-15", "The exterior painting window", "When the weather is right to paint outside, what prep matters most and how long a good job lasts."),
    ("interior-winter", "11-01", "02-28", "Paint inside while it is cold", "Why winter is a good time to repaint rooms and how to pick a color you will still like."),
];

const FLOORING: &[Bundled] = &[
    ("humidity", "11-01", "02-28", "Wood floors and dry winter air", "Why boards gap in winter, what humidity to keep and what is normal."),
    ("refinish", "04-01", "06-30", "Refinish or replace?", "How to tell whether floors can be refinished, what it costs in time and what a sample job looked like."),
];

const EXCAVATION: &[Bundled] = &[
    ("drainage", "03-01", "05-31", "Drainage after the thaw", "Where water goes after the thaw, what a bad grade does to a foundation and how you fix it."),
    ("pre-freeze-dig", "09-01", "11-15", "Dig before the ground freezes", "Which work has to be done before the ground freezes and how to book it."),
];

const MOBILE_MECHANIC: &[Bundled] = &[
    (
        "winter-car",
        "10-15",
        "12-15",
        "Get the car ready for winter",
        "Battery, tires, fluids and wipers: what you check on a cold-weather visit.",
    ),
    (
        "road-trip",
        "05-01",
        "06-30",
        "Before the summer road trip",
        "A short checklist to do before a long drive, and what you can do at the driveway.",
    ),
];

const AUTO_BODY: &[Bundled] = &[
    (
        "hail-season",
        "05-01",
        "08-31",
        "After a hailstorm",
        "How to document hail damage for a claim and what paintless repair can and cannot fix.",
    ),
    (
        "winter-salt",
        "11-01",
        "03-31",
        "Salt, rust and your paint",
        "What road salt does to a body and how to slow it down.",
    ),
];

fn bundled_for(trade: &str) -> &'static [Bundled] {
    match trade {
        "hvac" => HVAC,
        "plumbing" => PLUMBING,
        "electrical" => ELECTRICAL,
        "roofing" => ROOFING,
        "landscaping" => LANDSCAPING,
        "painting" => PAINTING,
        "flooring" => FLOORING,
        "excavation" => EXCAVATION,
        "mobile-mechanic" => MOBILE_MECHANIC,
        "auto-body-paint" => AUTO_BODY,
        _ => GENERAL,
    }
}

/// The bundled topics for a trade, in the order written. A trade without its own set (including a
/// site's extra trades) gets the general four.
pub fn bundled(trade: &str) -> Vec<Topic> {
    bundled_for(trade)
        .iter()
        .filter_map(|(id, start, end, topic, prompt)| {
            Some(Topic {
                id: (*id).to_string(),
                topic: (*topic).to_string(),
                prompt: (*prompt).to_string(),
                start: MonthDay::parse(start)?,
                end: MonthDay::parse(end)?,
                disabled: false,
                custom: false,
            })
        })
        .collect()
}

// ---------------------------------------------------------------------------
// The site's changes

/// One entry of `seasonalPrompts.topics`.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Entry {
    pub id: String,
    pub disabled: bool,
    pub start: Option<MonthDay>,
    pub end: Option<MonthDay>,
    pub topic: Option<String>,
    pub prompt: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct SeasonalConfig {
    pub enabled: bool,
    pub topics: Vec<Entry>,
}

const ENTRY_KEYS: [&str; 6] = ["id", "disabled", "start", "end", "topic", "prompt"];

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

/// Plain one-line text of at most `max` characters, or the reason it is not.
fn plain_text(value: &Value, at: &str, field: &str, max: usize) -> Result<String, String> {
    let Value::String(text) = value else {
        return Err(format!("{at}: {field} must be text, not {}", kind(value)));
    };
    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.is_empty() {
        return Err(format!("{at}: {field} cannot be empty"));
    }
    if text.chars().count() > max {
        return Err(format!("{at}: {field} can be at most {max} characters"));
    }
    if text.chars().any(char::is_control) {
        return Err(format!("{at}: {field} cannot hold control characters"));
    }
    Ok(text)
}

impl SeasonalConfig {
    /// True when nothing is stated: nothing is written back and nothing is reminded.
    pub fn is_default(&self) -> bool {
        !self.enabled && self.topics.is_empty()
    }

    /// Validate a stored or submitted `seasonalPrompts` value. Every problem is reported.
    pub fn from_value(value: &Value) -> Result<SeasonalConfig, Vec<String>> {
        let object = match value {
            Value::Null => return Ok(SeasonalConfig::default()),
            Value::Object(object) => object,
            other => {
                return Err(vec![format!(
                    "seasonalPrompts must be an object, not {}",
                    kind(other)
                )])
            }
        };
        let mut errors = Vec::new();
        match object.get("version") {
            None | Some(Value::Null) => {}
            Some(Value::Number(n)) if n.as_u64() == Some(SEASONAL_VERSION) => {}
            Some(Value::Number(n)) if n.as_u64().is_some_and(|v| v > SEASONAL_VERSION) => {
                return Err(vec![
                    "seasonalPrompts was saved by a newer version of open.blog; update before editing it"
                        .into(),
                ])
            }
            Some(_) => errors.push(format!("seasonalPrompts: version must be {SEASONAL_VERSION}")),
        }
        for key in object.keys() {
            if !["version", "enabled", "topics"].contains(&key.as_str()) {
                errors.push(format!(
                    "seasonalPrompts: `{key}` is not a setting this release knows; use `enabled` and `topics`"
                ));
            }
        }
        let enabled = match object.get("enabled") {
            None | Some(Value::Null) => false,
            Some(Value::Bool(flag)) => *flag,
            Some(other) => {
                errors.push(format!(
                    "seasonalPrompts: enabled must be true or false, not {}",
                    kind(other)
                ));
                false
            }
        };
        let mut topics = Vec::new();
        match object.get("topics") {
            None | Some(Value::Null) => {}
            Some(Value::Array(items)) => {
                if items.len() > MAX_ENTRIES {
                    errors.push(format!(
                        "seasonalPrompts: list at most {MAX_ENTRIES} topics"
                    ));
                }
                for (index, item) in items.iter().take(MAX_ENTRIES).enumerate() {
                    match parse_entry(index + 1, item) {
                        Ok(entry) => {
                            if topics.iter().any(|seen: &Entry| seen.id == entry.id) {
                                errors.push(format!(
                                    "seasonalPrompts topic {}: `{}` is listed twice; list each topic once",
                                    index + 1,
                                    entry.id
                                ));
                            } else {
                                topics.push(entry);
                            }
                        }
                        Err(mut found) => errors.append(&mut found),
                    }
                }
            }
            Some(other) => errors.push(format!(
                "seasonalPrompts: topics must be a list, not {}",
                kind(other)
            )),
        }
        if errors.is_empty() {
            Ok(SeasonalConfig { enabled, topics })
        } else {
            Err(errors)
        }
    }

    /// The stored form, always the versioned object.
    pub fn to_value(&self) -> Value {
        let topics: Vec<Value> = self
            .topics
            .iter()
            .map(|entry| {
                let mut object = Map::new();
                object.insert("id".into(), entry.id.clone().into());
                if entry.disabled {
                    object.insert("disabled".into(), true.into());
                }
                if let Some(start) = entry.start {
                    object.insert("start".into(), start.text().into());
                }
                if let Some(end) = entry.end {
                    object.insert("end".into(), end.text().into());
                }
                if let Some(topic) = &entry.topic {
                    object.insert("topic".into(), topic.clone().into());
                }
                if let Some(prompt) = &entry.prompt {
                    object.insert("prompt".into(), prompt.clone().into());
                }
                Value::Object(object)
            })
            .collect();
        json!({ "version": SEASONAL_VERSION, "enabled": self.enabled, "topics": topics })
    }

    /// The topics that apply to a trade: the bundled ones with the site's changes, then the site's
    /// own, ordered by when their window opens in the year.
    pub fn resolve(&self, trade: &str) -> Vec<Topic> {
        let mut all = bundled(trade);
        for entry in &self.topics {
            if let Some(topic) = all.iter_mut().find(|topic| topic.id == entry.id) {
                topic.disabled = entry.disabled;
                if let Some(start) = entry.start {
                    topic.start = start;
                }
                if let Some(end) = entry.end {
                    topic.end = end;
                }
                if let Some(text) = &entry.topic {
                    topic.topic = text.clone();
                }
                if let Some(text) = &entry.prompt {
                    topic.prompt = text.clone();
                }
            } else if let (Some(start), Some(end), Some(topic), Some(prompt)) =
                (entry.start, entry.end, &entry.topic, &entry.prompt)
            {
                all.push(Topic {
                    id: entry.id.clone(),
                    topic: topic.clone(),
                    prompt: prompt.clone(),
                    start,
                    end,
                    disabled: entry.disabled,
                    custom: true,
                });
            }
            // A change to a bundled topic of another trade is kept in the file and applies to nothing.
        }
        all.sort_by(|a, b| (a.start, &a.id).cmp(&(b.start, &b.id)));
        all
    }
}

fn parse_entry(at: usize, value: &Value) -> Result<Entry, Vec<String>> {
    let label = format!("seasonalPrompts topic {at}");
    let Value::Object(object) = value else {
        return Err(vec![format!(
            "{label}: write each topic as an object with an id, not {}",
            kind(value)
        )]);
    };
    let mut errors = Vec::new();
    for key in object.keys() {
        if !ENTRY_KEYS.contains(&key.as_str()) {
            errors.push(format!(
                "{label}: `{key}` is not a setting this release knows; use `id`, `disabled`, `start`, `end`, `topic` and `prompt`"
            ));
        }
    }
    let mut entry = Entry::default();
    match object.get("id") {
        Some(Value::String(id)) if crate::job::is_slug(id) && id.len() <= MAX_ID => {
            entry.id = id.clone();
        }
        _ => errors.push(format!(
            "{label}: id must be lowercase letters, digits and hyphens, at most {MAX_ID} characters"
        )),
    }
    match object.get("disabled") {
        None | Some(Value::Null) => {}
        Some(Value::Bool(flag)) => entry.disabled = *flag,
        Some(other) => errors.push(format!(
            "{label}: disabled must be true or false, not {}",
            kind(other)
        )),
    }
    for (key, slot) in [("start", &mut entry.start), ("end", &mut entry.end)] {
        match object.get(key) {
            None | Some(Value::Null) => {}
            Some(Value::String(text)) => match MonthDay::parse(text) {
                Some(day) => *slot = Some(day),
                None => errors.push(format!(
                    "{label}: {key} must be a month and day written MM-DD, like 09-15"
                )),
            },
            Some(other) => errors.push(format!(
                "{label}: {key} must be text like 09-15, not {}",
                kind(other)
            )),
        }
    }
    for (key, max, slot) in [
        ("topic", MAX_TOPIC, &mut entry.topic),
        ("prompt", MAX_PROMPT, &mut entry.prompt),
    ] {
        match object.get(key) {
            None | Some(Value::Null) => {}
            Some(text) => match plain_text(text, &label, key, max) {
                Ok(text) => *slot = Some(text),
                Err(message) => errors.push(message),
            },
        }
    }
    // A topic the release does not bundle is the site's own and must be whole. Whether an id is
    // bundled depends on the trade, so this is the loosest rule that is always true: a change that
    // states every field is complete either way, and one that states fewer is a change.
    if errors.is_empty() {
        Ok(entry)
    } else {
        Err(errors)
    }
}

/// Every id the release bundles, for any trade.
fn bundled_ids() -> Vec<String> {
    crate::job::TRADES
        .iter()
        .flat_map(|trade| bundled(trade).into_iter().map(|topic| topic.id))
        .collect()
}

/// A topic that is not bundled and does not state everything. It is the site's own, so it has to be
/// whole; a change to a bundled topic may state only what it changes.
pub fn incomplete(config: &SeasonalConfig) -> Vec<String> {
    let known = bundled_ids();
    config
        .topics
        .iter()
        .filter(|entry| !known.contains(&entry.id))
        .filter(|entry| {
            entry.start.is_none()
                || entry.end.is_none()
                || entry.topic.is_none()
                || entry.prompt.is_none()
        })
        .map(|entry| {
            format!(
                "seasonalPrompts: `{}` is not a bundled topic, so it needs a start, an end, a topic and a prompt",
                entry.id
            )
        })
        .collect()
}

impl Serialize for SeasonalConfig {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.to_value().serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for SeasonalConfig {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = Value::deserialize(deserializer)?;
        SeasonalConfig::from_value(&value)
            .map_err(|errors| serde::de::Error::custom(errors.join("; ")))
    }
}

// ---------------------------------------------------------------------------
// Reminders

/// What the site remembers about reminders it has shown. Private; never published.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ReminderState {
    /// Reminder key to the day (`YYYY-MM-DD`) it is snoozed until.
    pub snoozed: BTreeMap<String, String>,
    /// Reminder key to the path of the draft it opened.
    pub opened: BTreeMap<String, String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Status {
    /// The window is open and nothing has been done.
    Due,
    /// The window opens within the horizon.
    Upcoming,
    /// Hidden until the given day.
    Snoozed(String),
    /// A draft was opened for it, at this path.
    Opened(String),
}

impl Status {
    pub fn id(&self) -> &'static str {
        match self {
            Status::Due => "due",
            Status::Upcoming => "upcoming",
            Status::Snoozed(_) => "snoozed",
            Status::Opened(_) => "opened",
        }
    }
}

/// One occurrence of one topic. The key names the topic and the day its window opened, so it is
/// different every year and the same however many times the list is worked out.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Reminder {
    pub key: String,
    pub id: String,
    pub topic: String,
    pub prompt: String,
    /// `YYYY-MM-DD`
    pub opens: String,
    /// `YYYY-MM-DD`
    pub closes: String,
    pub status: Status,
}

/// The reminder key for a topic whose window opens on `opens` (`YYYY-MM-DD`).
pub fn key_for(id: &str, opens: &str) -> String {
    format!("{id}@{opens}")
}

/// Whether a key has the shape `key_for` makes.
pub fn valid_key(key: &str) -> bool {
    match key.split_once('@') {
        Some((id, opens)) => {
            crate::job::is_slug(id)
                && id.len() <= MAX_ID
                && parse_day(opens).is_some()
                && opens.len() == 10
        }
        None => false,
    }
}

/// The reminders for `today` (a day number): every enabled topic whose window is open, or opens
/// within [`HORIZON_DAYS`]. A topic with a draft already opened this time is shown as opened; one
/// snoozed past today stays snoozed. Sorted by when the window opens, then by id.
pub fn reminders(topics: &[Topic], today: i64, state: &ReminderState) -> Vec<Reminder> {
    let year = DateTime::from_unix(today * 86_400).year();
    let mut found = Vec::new();
    for topic in topics.iter().filter(|topic| !topic.disabled) {
        // A window that ends before it starts crosses the new year, so look a year either side.
        for first in [year - 1, year, year + 1] {
            let opens = topic.start.in_year(first);
            let last = if topic.end < topic.start {
                first + 1
            } else {
                first
            };
            let closes = topic.end.in_year(last);
            let listed = (opens <= today && today <= closes)
                || (opens > today && opens - today <= HORIZON_DAYS);
            if !listed {
                continue;
            }
            let opens_text = ymd_of(opens);
            let key = key_for(&topic.id, &opens_text);
            let status = if let Some(path) = state.opened.get(&key) {
                Status::Opened(path.clone())
            } else if let Some(until) = state
                .snoozed
                .get(&key)
                .filter(|until| parse_day(until).is_some_and(|day| day > today))
            {
                Status::Snoozed(until.clone())
            } else if opens <= today {
                Status::Due
            } else {
                Status::Upcoming
            };
            found.push((
                opens,
                Reminder {
                    key,
                    id: topic.id.clone(),
                    topic: topic.topic.clone(),
                    prompt: topic.prompt.clone(),
                    opens: opens_text,
                    closes: ymd_of(closes),
                    status,
                },
            ));
        }
    }
    found.sort_by(|a, b| (a.0, &a.1.id).cmp(&(b.0, &b.1.id)));
    found.into_iter().map(|(_, reminder)| reminder).collect()
}

/// The day a snooze of `days` from `today` ends, or the reason it is refused.
pub fn snooze_until(today: i64, days: i64) -> Result<String, String> {
    if !(1..=MAX_SNOOZE_DAYS).contains(&days) {
        return Err(format!("snooze for between 1 and {MAX_SNOOZE_DAYS} days"));
    }
    Ok(ymd_of(today + days))
}

/// The title and body of the draft a reminder opens. The prompt is the first paragraph, so the
/// owner sees what they were asked, and the draft says nothing else.
pub fn draft_title_and_body(reminder: &Reminder) -> (String, String) {
    (reminder.topic.clone(), format!("{}\n\n", reminder.prompt))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(json: &str) -> Result<SeasonalConfig, Vec<String>> {
        SeasonalConfig::from_value(&serde_json::from_str(json).unwrap())
    }

    fn day(text: &str) -> i64 {
        parse_day(text).unwrap()
    }

    #[test]
    fn nothing_stated_is_off_and_writes_nothing_back() {
        assert!(parse("null").unwrap().is_default());
        assert!(parse(r#"{"version":1}"#).unwrap().is_default());
        assert!(!parse(r#"{"enabled":true}"#).unwrap().is_default());
    }

    #[test]
    fn every_trade_has_bundled_topics_with_real_dates() {
        for trade in crate::job::TRADES {
            let topics = bundled(trade);
            assert!(topics.len() >= 2, "{trade} has too few topics");
            let mut ids: Vec<_> = topics.iter().map(|t| t.id.clone()).collect();
            ids.sort();
            ids.dedup();
            assert_eq!(ids.len(), topics.len(), "{trade} repeats an id");
            for topic in topics {
                assert!(topic.prompt.chars().count() <= MAX_PROMPT);
                assert!(topic.topic.chars().count() <= MAX_TOPIC);
            }
        }
        // Every table row parses: a typo would silently drop a topic.
        for table in [
            GENERAL,
            HVAC,
            PLUMBING,
            ELECTRICAL,
            ROOFING,
            LANDSCAPING,
            PAINTING,
            FLOORING,
            EXCAVATION,
            MOBILE_MECHANIC,
            AUTO_BODY,
        ] {
            for row in table {
                assert!(
                    MonthDay::parse(row.1).is_some() && MonthDay::parse(row.2).is_some(),
                    "{}",
                    row.0
                );
            }
        }
    }

    #[test]
    fn an_override_moves_or_disables_a_bundled_topic() {
        let config = parse(
            r#"{"enabled":true,"topics":[
                {"id":"furnace-tuneup","start":"08-15","end":"09-30"},
                {"id":"ac-tuneup","disabled":true}]}"#,
        )
        .unwrap();
        let topics = config.resolve("hvac");
        let furnace = topics.iter().find(|t| t.id == "furnace-tuneup").unwrap();
        assert_eq!(furnace.start.text(), "08-15");
        assert_eq!(furnace.topic, "Furnace tune-up before the cold");
        assert!(
            topics
                .iter()
                .find(|t| t.id == "ac-tuneup")
                .unwrap()
                .disabled
        );
        assert!(
            reminders(&topics, day("2026-05-01"), &ReminderState::default())
                .iter()
                .all(|r| r.id != "ac-tuneup")
        );
    }

    #[test]
    fn a_site_topic_needs_every_field_and_is_added() {
        let config = parse(
            r#"{"enabled":true,"topics":[{"id":"gutter-day","start":"10-01","end":"10-31","topic":"Gutters","prompt":"Why clean them?"}]}"#,
        )
        .unwrap();
        assert!(incomplete(&config).is_empty());
        let topics = config.resolve("roofing");
        assert!(topics.iter().any(|t| t.id == "gutter-day" && t.custom));
        let partial =
            parse(r#"{"enabled":true,"topics":[{"id":"gutter-day","start":"10-01"}]}"#).unwrap();
        assert_eq!(incomplete(&partial).len(), 1);
    }

    #[test]
    fn mistakes_are_named_in_plain_words() {
        let errors = parse(
            r#"{"enabled":"yes","extra":1,"topics":[{"id":"Bad Id","start":"13-40","prompt":""},{"id":"a"},{"id":"a"},7]}"#,
        )
        .unwrap_err()
        .join("\n");
        for needle in [
            "enabled must be true or false",
            "`extra` is not a setting",
            "id must be lowercase",
            "start must be a month and day",
            "prompt cannot be empty",
            "`a` is listed twice",
            "write each topic as an object",
        ] {
            assert!(errors.contains(needle), "missing {needle:?} in {errors}");
        }
        assert!(parse(r#"{"version":2}"#).unwrap_err()[0].contains("newer version"));
    }

    #[test]
    fn the_stored_form_round_trips_and_keeps_only_what_was_stated() {
        let config =
            parse(r#"{"enabled":true,"topics":[{"id":"ac-tuneup","disabled":true}]}"#).unwrap();
        let value = config.to_value();
        assert_eq!(
            value["topics"][0],
            json!({"id":"ac-tuneup","disabled":true})
        );
        assert_eq!(SeasonalConfig::from_value(&value).unwrap(), config);
    }

    #[test]
    fn reminders_are_due_in_the_window_and_upcoming_before_it() {
        let topics = SeasonalConfig::default().resolve("hvac");
        let state = ReminderState::default();
        let due = reminders(&topics, day("2026-09-10"), &state);
        let furnace = due.iter().find(|r| r.id == "furnace-tuneup").unwrap();
        assert_eq!(furnace.status, Status::Due);
        assert_eq!(furnace.key, "furnace-tuneup@2026-09-01");
        assert_eq!(furnace.closes, "2026-10-31");
        let soon = reminders(&topics, day("2026-08-15"), &state);
        assert_eq!(
            soon.iter()
                .find(|r| r.id == "furnace-tuneup")
                .unwrap()
                .status,
            Status::Upcoming
        );
        // Outside both the window and the horizon.
        assert!(reminders(&topics, day("2026-07-01"), &state)
            .iter()
            .all(|r| r.id != "furnace-tuneup"));
    }

    #[test]
    fn a_window_across_the_new_year_is_one_occurrence() {
        let topics = SeasonalConfig::default().resolve("painting");
        let state = ReminderState::default();
        for today in ["2026-12-20", "2027-01-15"] {
            let list = reminders(&topics, day(today), &state);
            let winter: Vec<_> = list.iter().filter(|r| r.id == "interior-winter").collect();
            assert_eq!(winter.len(), 1, "{today}");
            assert_eq!(winter[0].key, "interior-winter@2026-11-01");
            assert_eq!(winter[0].closes, "2027-02-28");
            assert_eq!(winter[0].status, Status::Due);
        }
    }

    #[test]
    fn an_opened_reminder_is_not_asked_again_but_next_year_is_new() {
        let topics = SeasonalConfig::default().resolve("hvac");
        let mut state = ReminderState::default();
        state.opened.insert(
            "furnace-tuneup@2026-09-01".into(),
            "content/posts/x.md".into(),
        );
        let list = reminders(&topics, day("2026-09-10"), &state);
        assert_eq!(
            list.iter()
                .find(|r| r.id == "furnace-tuneup")
                .unwrap()
                .status,
            Status::Opened("content/posts/x.md".into())
        );
        let next = reminders(&topics, day("2027-09-10"), &state);
        assert_eq!(
            next.iter()
                .find(|r| r.id == "furnace-tuneup")
                .unwrap()
                .status,
            Status::Due
        );
    }

    #[test]
    fn a_snooze_hides_until_its_day_then_the_reminder_returns() {
        let topics = SeasonalConfig::default().resolve("hvac");
        let mut state = ReminderState::default();
        state
            .snoozed
            .insert("furnace-tuneup@2026-09-01".into(), "2026-09-17".into());
        let status = |today: &str| {
            reminders(&topics, day(today), &state)
                .into_iter()
                .find(|r| r.id == "furnace-tuneup")
                .unwrap()
                .status
        };
        assert_eq!(status("2026-09-10"), Status::Snoozed("2026-09-17".into()));
        assert_eq!(status("2026-09-17"), Status::Due);
    }

    #[test]
    fn snooze_length_and_keys_are_bounded() {
        assert_eq!(snooze_until(day("2026-09-10"), 7).unwrap(), "2026-09-17");
        assert!(snooze_until(day("2026-09-10"), 0).is_err());
        assert!(snooze_until(day("2026-09-10"), 91).is_err());
        assert!(valid_key("furnace-tuneup@2026-09-01"));
        for bad in [
            "",
            "furnace",
            "Furnace@2026-09-01",
            "a@2026-13-01",
            "a@2026-9-1",
            "../x@2026-09-01",
        ] {
            assert!(!valid_key(bad), "{bad}");
        }
    }

    #[test]
    fn leap_day_windows_work_in_every_year() {
        let config = parse(r#"{"enabled":true,"topics":[{"id":"leap","start":"02-29","end":"03-05","topic":"Leap","prompt":"p"}]}"#).unwrap();
        let topics = config.resolve("other");
        let list = reminders(&topics, day("2027-03-01"), &ReminderState::default());
        let leap = list.iter().find(|r| r.id == "leap").unwrap();
        assert_eq!(leap.opens, "2027-02-28");
    }
}
