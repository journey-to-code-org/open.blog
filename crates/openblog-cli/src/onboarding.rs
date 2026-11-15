//! Getting started (Studio R9b): whether a new owner is walked through it, and what each account
//! has done. The switch is the server's (`OPENBLOG_STUDIO_ONBOARDING`, then `studio.onboarding`
//! in `openblog.json`, then off); the record is one small private file per account.
//!
//! - `off`: never shows by itself.
//! - `on`: once per account, round `1`, until that account's record is done or skipped.
//! - `on:<round>`: as `on`, and again once for an account whose record finished another round.
//! - `rehearse`: shows every time, for every account, and keeps nothing personal: a separate
//!   practice record and practice stories under `.openblog/private/onboarding/practice/`, which
//!   are swept the next time the server starts in any other mode. The real record and the real
//!   voice library are never touched by a practice run.
//!
//! Nothing here holds or logs a story, a transcript or a key: a record names pieces by id only.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

use crate::private_file;
use openblog_core::DateTime;

/// The server's switch.
pub const ENVIRONMENT: &str = "OPENBLOG_STUDIO_ONBOARDING";
/// Where each account's record is kept.
pub const RECORDS_DIR: &str = ".openblog/private/onboarding";
/// Everything a practice run writes; swept at the next start in any mode but `rehearse`.
pub const PRACTICE_DIR: &str = ".openblog/private/onboarding/practice";
/// The practice run's records.
pub const PRACTICE_RECORDS_DIR: &str = ".openblog/private/onboarding/practice/records";
/// The practice run's own voice library: a project root of its own, so no practice story is ever
/// among the real pieces.
pub const PRACTICE_VOICE_ROOT: &str = ".openblog/private/onboarding/practice/voice";
/// The round a plain `on` belongs to.
pub const DEFAULT_ROUND: &str = "1";
pub const RECORD_VERSION: u32 = 1;
pub const MAX_RECORD_BYTES: usize = 16 * 1024;
/// A reminder comes at most this often, and this many times ever.
pub const NUDGE_GAP_DAYS: i64 = 7;
pub const NUDGE_MAX: usize = 3;
/// How many stories Getting started asks for.
pub const STORIES_ASKED: usize = 3;
const MAX_STORIES: usize = 24;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Kind {
    Off,
    On { round: String },
    Rehearse,
}

/// Where the mode in effect came from.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Source {
    Environment,
    Config,
    Nothing,
}

impl Source {
    pub fn as_str(self) -> &'static str {
        match self {
            Source::Environment => "environment",
            Source::Config => "config",
            Source::Nothing => "none",
        }
    }
}

/// The mode in effect, where it came from, and what was wrong with a value that was ignored.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Mode {
    pub kind: Kind,
    pub source: Source,
    /// The value as written, for the details line (never a secret: it is a switch).
    pub value: String,
    pub problems: Vec<String>,
}

impl Mode {
    /// `off`, `on` or `rehearse`, as Studio is told.
    pub fn name(&self) -> &'static str {
        match self.kind {
            Kind::Off => "off",
            Kind::On { .. } => "on",
            Kind::Rehearse => "rehearse",
        }
    }

    pub fn practice(&self) -> bool {
        self.kind == Kind::Rehearse
    }

    /// The round a record made now belongs to.
    pub fn round(&self) -> &str {
        match &self.kind {
            Kind::On { round } => round,
            _ => DEFAULT_ROUND,
        }
    }
}

fn valid_round(round: &str) -> bool {
    (1..=32).contains(&round.len())
        && round
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

/// A value of the server's switch: `off`, `on`, `on:<round>` or `rehearse`, exactly.
pub fn parse_environment(value: &str) -> Result<Kind, String> {
    match value {
        "off" => Ok(Kind::Off),
        "on" => Ok(Kind::On {
            round: DEFAULT_ROUND.into(),
        }),
        "rehearse" => Ok(Kind::Rehearse),
        other => match other.strip_prefix("on:") {
            Some(round) if valid_round(round) => Ok(Kind::On {
                round: round.into(),
            }),
            _ => Err(format!(
                "{ENVIRONMENT} is “{}”, which isn't off, on, on:<round> or rehearse, so Getting started is off.",
                shown(other)
            )),
        },
    }
}

/// A value kept short and on one line before it is repeated in a sentence.
fn shown(value: &str) -> String {
    value.chars().filter(|c| !c.is_control()).take(48).collect()
}

/// The mode from the server's switch (`environment`: the variable's value, `None` when unset)
/// and the site's `studio.onboarding`. The environment wins: this is an operator's switch for
/// one server. An empty variable counts as unset. A value that can't be used turns Getting
/// started off and is reported; it never falls through to the other place.
pub fn mode_from(environment: Option<&str>, config: Option<&serde_json::Value>) -> Mode {
    if let Some(value) = environment.map(str::trim).filter(|value| !value.is_empty()) {
        return match parse_environment(value) {
            Ok(kind) => Mode {
                kind,
                source: Source::Environment,
                value: value.to_string(),
                problems: Vec::new(),
            },
            Err(problem) => Mode {
                kind: Kind::Off,
                source: Source::Environment,
                value: shown(value),
                problems: vec![problem],
            },
        };
    }
    match config {
        None | Some(serde_json::Value::Null) => Mode {
            kind: Kind::Off,
            source: Source::Nothing,
            value: String::new(),
            problems: Vec::new(),
        },
        Some(serde_json::Value::String(value)) if value == "on" || value == "off" => Mode {
            kind: if value == "on" {
                Kind::On {
                    round: DEFAULT_ROUND.into(),
                }
            } else {
                Kind::Off
            },
            source: Source::Config,
            value: value.clone(),
            problems: Vec::new(),
        },
        Some(other) => {
            let text = other
                .as_str()
                .map_or_else(|| other.to_string(), str::to_string);
            Mode {
                kind: Kind::Off,
                source: Source::Config,
                value: shown(&text),
                problems: vec![format!(
                    "studio.onboarding in openblog.json is “{}”, which isn't off or on, so Getting started is off. (Rounds and rehearse are set with {ENVIRONMENT}.)",
                    shown(&text)
                )],
            }
        }
    }
}

/// The mode for a site, with the server's variable as given.
pub fn mode_for(environment: Option<&str>, config: &openblog_core::config::SiteConfig) -> Mode {
    mode_from(environment, config.studio.onboarding.as_ref())
}

/// The server's variable, read once at start.
pub fn environment_value() -> Option<String> {
    std::env::var(ENVIRONMENT).ok()
}

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Status {
    #[default]
    InProgress,
    Done,
    Skipped,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum StepState {
    /// Not reached yet.
    #[default]
    Pending,
    NotNeeded,
    Done,
    Skipped,
    NotReady,
}

impl StepState {
    pub fn as_str(self) -> &'static str {
        match self {
            StepState::Pending => "pending",
            StepState::NotNeeded => "not-needed",
            StepState::Done => "done",
            StepState::Skipped => "skipped",
            StepState::NotReady => "not-ready",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        Some(match value {
            "pending" => StepState::Pending,
            "not-needed" => StepState::NotNeeded,
            "done" => StepState::Done,
            "skipped" => StepState::Skipped,
            "not-ready" => StepState::NotReady,
            _ => return None,
        })
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Steps {
    pub helper: StepState,
    pub stories: StepState,
    pub voice: StepState,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct Nudge {
    /// The days (`YYYY-MM-DD`) the reminder was shown, one per day at most.
    pub shown: Vec<String>,
    pub stopped: bool,
}

/// One account's Getting started: `{ v, round, status, step, steps, stories, total, startedAt,
/// finishedAt, lastAutoOpen, nudge }`. Stories are piece ids, never text.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Record {
    pub v: u32,
    pub round: String,
    pub status: Status,
    /// `helper`, `stories`, `voice` or `done`.
    pub step: String,
    pub steps: Steps,
    pub stories: Vec<String>,
    /// How many steps this run shows (2 or 3), fixed when it starts.
    pub total: u8,
    pub started_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_auto_open: Option<String>,
    pub nudge: Nudge,
}

impl Default for Record {
    fn default() -> Self {
        Record {
            v: RECORD_VERSION,
            round: DEFAULT_ROUND.into(),
            status: Status::InProgress,
            step: "stories".into(),
            steps: Steps::default(),
            stories: Vec::new(),
            total: 2,
            started_at: String::new(),
            finished_at: None,
            last_auto_open: None,
            nudge: Nudge::default(),
        }
    }
}

pub const STEPS: [&str; 4] = ["helper", "stories", "voice", "done"];

impl Record {
    /// A record just begun, in `round`, at `now`.
    pub fn begin(round: &str, now: DateTime) -> Record {
        Record {
            round: round.to_string(),
            started_at: now.rfc3339(),
            ..Record::default()
        }
    }

    /// Whether the stories step was left without a story (what arms the reminder).
    pub fn stories_skipped(&self) -> bool {
        self.steps.stories == StepState::Skipped
            || (self.status == Status::Skipped && self.steps.stories != StepState::Done)
    }

    /// The record's revision: changes whenever the record does.
    pub fn etag(&self) -> String {
        let bytes = serde_json::to_vec(self).unwrap_or_default();
        let mut h: u64 = 0xcbf2_9ce4_8422_2325;
        for byte in bytes {
            h ^= u64::from(byte);
            h = h.wrapping_mul(0x0100_0000_01b3);
        }
        format!("{h:016x}")
    }
}

/// A piece id as the voice routes name it.
pub fn valid_piece_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 160
        && id
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

/// What is wrong with a record, or `None`. A record that doesn't pass is treated as unreadable.
fn record_problem(record: &Record) -> Option<&'static str> {
    if record.v != RECORD_VERSION {
        return Some("another version");
    }
    if !valid_round(&record.round) {
        return Some("round");
    }
    if !STEPS.contains(&record.step.as_str()) {
        return Some("step");
    }
    if record.stories.len() > MAX_STORIES || !record.stories.iter().all(|id| valid_piece_id(id)) {
        return Some("stories");
    }
    if !(1..=3).contains(&record.total) {
        return Some("total");
    }
    if record.nudge.shown.len() > 16 {
        return Some("nudge");
    }
    None
}

/// Where a user's record is: the real one, or the practice run's.
pub fn record_path(root: &Path, user: &str, practice: bool) -> Result<PathBuf, String> {
    let folder = if practice {
        PRACTICE_RECORDS_DIR
    } else {
        RECORDS_DIR
    };
    private_file::user_path(root, folder, user)
}

/// The user's record. `Ok(None)` when there is none ("never started"). A file that can't be
/// used is an error and is left exactly as it is.
pub fn read(root: &Path, user: &str, practice: bool) -> Result<Option<Record>, String> {
    let path = record_path(root, user, practice)?;
    let Some(bytes) = private_file::read(&path, MAX_RECORD_BYTES)? else {
        return Ok(None);
    };
    let record: Record = serde_json::from_slice(&bytes)
        .map_err(|_| "the Getting started record can't be read".to_string())?;
    match record_problem(&record) {
        None => Ok(Some(record)),
        Some(_) => Err("the Getting started record can't be read".into()),
    }
}

/// Write the user's record: 0600, in one step.
pub fn write(root: &Path, user: &str, practice: bool, record: &Record) -> Result<(), String> {
    if let Some(problem) = record_problem(record) {
        return Err(format!(
            "the Getting started record is not valid ({problem})"
        ));
    }
    let path = record_path(root, user, practice)?;
    let bytes = serde_json::to_vec_pretty(record).map_err(|error| error.to_string())?;
    private_file::write(&path, &bytes)
}

/// Remove the user's record; one that isn't there is fine.
pub fn remove(root: &Path, user: &str, practice: bool) -> Result<(), String> {
    private_file::remove(&record_path(root, user, practice)?)
}

// ---------------------------------------------------------------------------
// When it shows
// ---------------------------------------------------------------------------

/// Whether Getting started shows by itself for an account with this record: `on` while there is
/// no record, it is in progress, or it finished another round; `rehearse` always; `off` never.
pub fn due(mode: &Mode, record: Option<&Record>) -> bool {
    match &mode.kind {
        Kind::Off => false,
        Kind::Rehearse => true,
        Kind::On { round } => match record {
            None => true,
            Some(record) => record.status == Status::InProgress || &record.round != round,
        },
    }
}

/// The record a run works on: the one kept, unless it finished another round (a new run starts
/// then, which the first save writes).
pub fn current<'a>(mode: &Mode, record: Option<&'a Record>) -> Option<&'a Record> {
    match (&mode.kind, record) {
        (Kind::On { round }, Some(record))
            if &record.round != round && record.status != Status::InProgress =>
        {
            None
        }
        (_, record) => record,
    }
}

fn day_of(now: DateTime) -> String {
    now.rfc3339()[..10].to_string()
}

fn days_between(earlier: &str, now: DateTime) -> Option<i64> {
    let then = DateTime::parse(&format!("{earlier}T00:00:00Z"))?;
    let today = DateTime::parse(&format!("{}T00:00:00Z", day_of(now)))?;
    Some((today.unix() - then.unix()) / 86_400)
}

/// Whether the reminder in Write is due: the mode isn't off, this account left the stories
/// without telling one, has no pieces of its own, hasn't said "Don't ask again", has seen it
/// fewer than three times, and not within the last seven days.
pub fn nudge_due(mode: &Mode, record: Option<&Record>, own_pieces: usize, now: DateTime) -> bool {
    if mode.kind == Kind::Off || own_pieces > 0 {
        return false;
    }
    let Some(record) = record else {
        return false;
    };
    if !record.stories_skipped() || record.nudge.stopped || record.nudge.shown.len() >= NUDGE_MAX {
        return false;
    }
    match record.nudge.shown.last() {
        None => true,
        Some(last) => days_between(last, now).is_none_or(|days| days >= NUDGE_GAP_DAYS),
    }
}

/// Apply a reminder event to a record. `shown` counts once per day; `stop` and `unstop` set and
/// clear "Don't ask again"; `later` and `accepted` change nothing that is kept.
pub fn nudge_event(record: &mut Record, event: &str, now: DateTime) -> Result<(), ()> {
    match event {
        "shown" => {
            let today = day_of(now);
            if record.nudge.shown.last() != Some(&today) {
                record.nudge.shown.push(today);
            }
        }
        "stop" => record.nudge.stopped = true,
        "unstop" => record.nudge.stopped = false,
        "later" | "accepted" => {}
        _ => return Err(()),
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// The practice run
// ---------------------------------------------------------------------------

/// The practice run's own voice library root.
pub fn practice_voice_root(root: &Path) -> PathBuf {
    root.join(PRACTICE_VOICE_ROOT)
}

/// How many practice stories are kept (rough drafts in the practice library).
pub fn practice_stories(root: &Path) -> usize {
    let folder = practice_voice_root(root).join(".openblog/private/context/voice");
    fs::read_dir(folder).map_or(0, |entries| {
        entries
            .flatten()
            .filter(|entry| entry.file_name().to_string_lossy().ends_with("-rough.md"))
            .count()
    })
}

/// Delete everything a practice run kept. Only the practice folder, and only when it is a real
/// folder inside the private folder (a link is left alone). Returns how many stories went, or
/// `None` when there was nothing.
pub fn sweep_practice(root: &Path) -> Option<usize> {
    let folder = root.join(PRACTICE_DIR);
    let metadata = fs::symlink_metadata(&folder).ok()?;
    if !metadata.is_dir() {
        return None;
    }
    let stories = practice_stories(root);
    fs::remove_dir_all(&folder).ok()?;
    Some(stories)
}

/// What the server does about Getting started as it starts: one warning line for a value it
/// can't use, and, in any mode but `rehearse`, the practice run's files are swept.
pub fn at_start(root: &Path, mode: &Mode) {
    for problem in &mode.problems {
        eprintln!("warning: {problem}");
    }
    if mode.kind != Kind::Rehearse {
        if let Some(stories) = sweep_practice(root) {
            eprintln!(
                "onboarding: cleared practice ({stories} {})",
                if stories == 1 { "story" } else { "stories" }
            );
        }
    }
}

// ---------------------------------------------------------------------------
// Every account, for Home's details and the command line
// ---------------------------------------------------------------------------

/// One account's line: where it stands, never anything it wrote.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Account {
    pub user: String,
    pub record: Option<Record>,
    /// The record is there but can't be read.
    pub unreadable: bool,
}

/// Every account in `users`, with its real record.
pub fn accounts(root: &Path, users: &[String]) -> Vec<Account> {
    users
        .iter()
        .map(|user| match read(root, user, false) {
            Ok(record) => Account {
                user: user.clone(),
                record,
                unreadable: false,
            },
            Err(_) => Account {
                user: user.clone(),
                record: None,
                unreadable: true,
            },
        })
        .collect()
}

/// "grammi · in progress · stories 1 of 3 · helper's key skipped · started 2026-11-20".
pub fn account_line(account: &Account) -> String {
    if account.unreadable {
        return format!("{} · record can't be read", account.user);
    }
    let Some(record) = &account.record else {
        return format!("{} · not started", account.user);
    };
    let status = match record.status {
        Status::InProgress => "in progress",
        Status::Done => "done",
        Status::Skipped => "skipped",
    };
    let mut parts = vec![account.user.clone(), status.to_string()];
    parts.push(format!(
        "stories {} of {STORIES_ASKED}",
        record.stories.len().min(STORIES_ASKED)
    ));
    if record.steps.helper == StepState::Skipped {
        parts.push("helper's key skipped".into());
    }
    if record.steps.voice == StepState::Done {
        parts.push("voice guide made".into());
    }
    parts.push(format!("round {}", record.round));
    if let Some(day) = record.started_at.get(..10) {
        parts.push(format!("started {day}"));
    }
    parts.join(" · ")
}

/// The words for "{value}, set by {source}".
pub fn source_words(mode: &Mode) -> &'static str {
    match mode.source {
        Source::Environment => "the server's environment",
        Source::Config => "openblog.json",
        Source::Nothing => "nothing (off)",
    }
}

/// What a record's steps were, for one log line: no names of pieces, no text.
pub fn finished_words(record: &Record) -> String {
    format!(
        "helper {}, stories {}, voice {}",
        record.steps.helper.as_str(),
        record.stories.len(),
        record.steps.voice.as_str()
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn on(round: &str) -> Mode {
        mode_from(Some(&format!("on:{round}")), None)
    }

    fn temp(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ob-onboarding-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn at(text: &str) -> DateTime {
        DateTime::parse(text).unwrap()
    }

    #[test]
    fn the_switch_takes_exactly_four_shapes_and_anything_else_is_off_with_a_problem() {
        assert_eq!(parse_environment("off"), Ok(Kind::Off));
        assert_eq!(parse_environment("on"), Ok(Kind::On { round: "1".into() }));
        assert_eq!(
            parse_environment("on:abc-1"),
            Ok(Kind::On {
                round: "abc-1".into()
            })
        );
        assert_eq!(
            parse_environment("on:2026-11-20"),
            Ok(Kind::On {
                round: "2026-11-20".into()
            })
        );
        assert_eq!(parse_environment("rehearse"), Ok(Kind::Rehearse));
        let round_33 = format!("on:{}", "a".repeat(33));
        for bad in [
            "ON",
            "On",
            "on:",
            "on:x y",
            "on:X",
            "true",
            "1",
            "rehearse:1",
            "yes",
            round_33.as_str(),
        ] {
            let mode = mode_from(Some(bad), Some(&json!("on")));
            assert_eq!(mode.kind, Kind::Off, "{bad}");
            assert_eq!(mode.source, Source::Environment, "{bad}");
            assert_eq!(mode.problems.len(), 1, "{bad}");
            assert!(
                mode.problems[0].contains("isn't off, on, on:<round> or rehearse"),
                "{bad}"
            );
            assert_eq!(mode.name(), "off");
        }
        assert_eq!(
            parse_environment(&format!("on:{}", "a".repeat(32))).unwrap(),
            Kind::On {
                round: "a".repeat(32)
            }
        );
        // A value that is repeated in a sentence is kept short and on one line.
        let long = mode_from(Some(&format!("{}\n{}", "x".repeat(80), "secret")), None);
        assert!(!long.problems[0].contains('\n') && !long.problems[0].contains("secret"));
    }

    #[test]
    fn the_environment_beats_the_site_file_whatever_each_says() {
        let on_config = json!("on");
        let off_config = json!("off");
        // Unset, or set to nothing: the site file decides.
        for unset in [None, Some(""), Some("   ")] {
            let mode = mode_from(unset, Some(&on_config));
            assert_eq!((mode.name(), mode.source), ("on", Source::Config));
            assert_eq!(mode_from(unset, Some(&off_config)).name(), "off");
            let nothing = mode_from(unset, None);
            assert_eq!((nothing.name(), nothing.source), ("off", Source::Nothing));
        }
        // Set: it wins over on, over off, and over nothing.
        for (env, name) in [
            ("off", "off"),
            ("on", "on"),
            ("on:2", "on"),
            ("rehearse", "rehearse"),
        ] {
            for config in [Some(&on_config), Some(&off_config), None] {
                let mode = mode_from(Some(env), config);
                assert_eq!(
                    (mode.name(), mode.source),
                    (name, Source::Environment),
                    "{env} over {config:?}"
                );
                assert!(mode.problems.is_empty());
            }
        }
        assert_eq!(mode_from(Some("on:2"), Some(&on_config)).round(), "2");
        assert_eq!(mode_from(None, Some(&on_config)).round(), "1");
        assert_eq!(
            mode_from(Some(" on "), None).name(),
            "on",
            "space around it is not a value"
        );
        // A bad value in the environment never falls through to the site file.
        assert_eq!(mode_from(Some("ON"), Some(&on_config)).name(), "off");
    }

    #[test]
    fn the_site_file_takes_only_off_and_on() {
        for bad in [
            json!("rehearse"),
            json!("on:2"),
            json!("ON"),
            json!(true),
            json!(1),
            json!({}),
        ] {
            let mode = mode_from(None, Some(&bad));
            assert_eq!(mode.kind, Kind::Off, "{bad}");
            assert_eq!(mode.source, Source::Config);
            assert!(mode.problems[0].contains("isn't off or on"), "{bad}");
        }
        assert!(mode_from(None, Some(&json!("on"))).problems.is_empty());
        assert!(mode_from(None, Some(&json!(null))).problems.is_empty());
    }

    #[test]
    fn due_for_every_mode_and_every_record() {
        let now = at("2026-11-20T10:00:00Z");
        let none: Option<&Record> = None;
        let in_progress = Record::begin("1", now);
        let done = Record {
            status: Status::Done,
            ..Record::begin("1", now)
        };
        let skipped = Record {
            status: Status::Skipped,
            ..Record::begin("1", now)
        };
        let done_2 = Record {
            status: Status::Done,
            ..Record::begin("2", now)
        };
        let table: &[(&str, [bool; 5])] = &[
            // none, in progress (1), done (1), skipped (1), done (2)
            ("off", [false, false, false, false, false]),
            ("on", [true, true, false, false, true]),
            ("on:1", [true, true, false, false, true]),
            ("on:2", [true, true, true, true, false]),
            ("rehearse", [true, true, true, true, true]),
        ];
        for (value, expected) in table {
            let mode = mode_from(Some(value), None);
            let records = [
                none,
                Some(&in_progress),
                Some(&done),
                Some(&skipped),
                Some(&done_2),
            ];
            for (record, want) in records.iter().zip(expected) {
                assert_eq!(due(&mode, *record), *want, "{value} with {record:?}");
            }
        }
        // A record that finished another round starts afresh; one still in progress carries on.
        assert_eq!(current(&on("2"), Some(&done)), None);
        assert_eq!(current(&on("2"), Some(&in_progress)), Some(&in_progress));
        assert_eq!(current(&on("1"), Some(&done)), Some(&done));
    }

    #[test]
    fn the_reminder_comes_only_after_skipped_stories_seven_days_apart_three_times_and_stops() {
        let start = at("2026-11-01T10:00:00Z");
        let mode = mode_from(Some("on"), None);
        let mut record = Record::begin("1", start);
        assert!(
            !nudge_due(&mode, None, 0, start),
            "never started: nothing to remind of"
        );
        assert!(
            !nudge_due(&mode, Some(&record), 0, start),
            "stories not skipped"
        );
        record.steps.stories = StepState::Done;
        assert!(!nudge_due(&mode, Some(&record), 0, start), "stories told");
        record.steps.stories = StepState::Skipped;
        assert!(nudge_due(&mode, Some(&record), 0, start));
        assert!(
            !nudge_due(&mode, Some(&record), 1, start),
            "she has a piece of her own"
        );
        assert!(
            !nudge_due(&mode_from(Some("off"), None), Some(&record), 0, start),
            "mode off"
        );
        assert!(nudge_due(
            &mode_from(Some("rehearse"), None),
            Some(&record),
            0,
            start
        ));
        // Skip the rest with stories never done arms it too.
        let rest = Record {
            status: Status::Skipped,
            ..Record::begin("1", start)
        };
        assert!(nudge_due(&mode, Some(&rest), 0, start));

        nudge_event(&mut record, "shown", start).unwrap();
        nudge_event(&mut record, "shown", at("2026-11-01T22:00:00Z")).unwrap();
        assert_eq!(record.nudge.shown, ["2026-11-01"], "once a day is counted");
        assert!(
            !nudge_due(&mode, Some(&record), 0, at("2026-11-07T23:59:00Z")),
            "six days later"
        );
        assert!(
            nudge_due(&mode, Some(&record), 0, at("2026-11-08T00:01:00Z")),
            "seven days later"
        );
        nudge_event(&mut record, "shown", at("2026-11-08T09:00:00Z")).unwrap();
        nudge_event(&mut record, "later", at("2026-11-08T09:00:00Z")).unwrap();
        assert!(nudge_due(
            &mode,
            Some(&record),
            0,
            at("2026-11-15T09:00:00Z")
        ));
        nudge_event(&mut record, "shown", at("2026-11-15T09:00:00Z")).unwrap();
        assert!(
            !nudge_due(&mode, Some(&record), 0, at("2027-01-01T09:00:00Z")),
            "three times ever"
        );

        let mut stopped = Record::begin("1", start);
        stopped.steps.stories = StepState::Skipped;
        nudge_event(&mut stopped, "stop", start).unwrap();
        assert!(!nudge_due(
            &mode,
            Some(&stopped),
            0,
            at("2026-12-01T09:00:00Z")
        ));
        nudge_event(&mut stopped, "unstop", start).unwrap();
        assert!(nudge_due(
            &mode,
            Some(&stopped),
            0,
            at("2026-12-01T09:00:00Z")
        ));
        assert!(nudge_event(&mut stopped, "anything", start).is_err());
    }

    #[test]
    fn a_record_is_a_private_file_named_by_a_hash_and_an_unreadable_one_is_left_alone() {
        let root = temp("record");
        let now = at("2026-11-20T10:00:00Z");
        assert_eq!(read(&root, "grammi", false).unwrap(), None);
        let mut record = Record::begin("1", now);
        record.stories = vec!["2026-11-20-a-meal-you-love-rough".into()];
        write(&root, "grammi", false, &record).unwrap();
        assert_eq!(read(&root, "grammi", false).unwrap(), Some(record.clone()));
        assert_eq!(
            read(&root, "mikey", false).unwrap(),
            None,
            "one account's record is its own"
        );
        assert_eq!(
            read(&root, "grammi", true).unwrap(),
            None,
            "the practice record is another file"
        );
        let path = record_path(&root, "grammi", false).unwrap();
        let name = path.file_name().unwrap().to_string_lossy().into_owned();
        assert!(name.len() == 69 && !name.contains("grammi"), "{name}");
        assert!(path.starts_with(root.join(RECORDS_DIR)));
        assert!(record_path(&root, "grammi", true)
            .unwrap()
            .starts_with(root.join(PRACTICE_RECORDS_DIR)));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        // No temporary file is left behind.
        assert_eq!(fs::read_dir(path.parent().unwrap()).unwrap().count(), 1);
        let before = record.etag();
        record.step = "voice".into();
        assert_ne!(record.etag(), before);

        // A record from a later release, or a damaged one, is an error and stays as it is.
        fs::write(&path, br#"{"v":2,"round":"1"}"#).unwrap();
        assert!(read(&root, "grammi", false).is_err());
        assert_eq!(fs::read(&path).unwrap(), br#"{"v":2,"round":"1"}"#);
        fs::write(&path, b"{nope").unwrap();
        assert!(read(&root, "grammi", false).is_err());
        // A record can't name a path as a story.
        let mut bad = Record::begin("1", now);
        bad.stories = vec!["../../etc/passwd".into()];
        assert!(write(&root, "mikey", false, &bad).is_err());
        assert!(record_path(&root, "", false).is_err());
        remove(&root, "grammi", false).unwrap();
        remove(&root, "grammi", false).unwrap();
        assert_eq!(read(&root, "grammi", false).unwrap(), None);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn the_practice_run_is_swept_whole_and_the_real_records_stay() {
        let root = temp("sweep");
        let now = at("2026-11-20T10:00:00Z");
        write(&root, "grammi", false, &Record::begin("1", now)).unwrap();
        write(&root, "grammi", true, &Record::begin("1", now)).unwrap();
        let voice = practice_voice_root(&root).join(".openblog/private/context/voice");
        fs::create_dir_all(&voice).unwrap();
        for name in [
            "2026-11-20-a-rough.md",
            "2026-11-20-b-rough.md",
            "2026-11-20-a-polished.md",
        ] {
            fs::write(voice.join(name), "practice words").unwrap();
        }
        assert_eq!(practice_stories(&root), 2);
        // In rehearse nothing is swept.
        at_start(&root, &mode_from(Some("rehearse"), None));
        assert!(root.join(PRACTICE_DIR).is_dir());
        assert_eq!(sweep_practice(&root), Some(2));
        assert!(!root.join(PRACTICE_DIR).exists());
        assert!(
            read(&root, "grammi", false).unwrap().is_some(),
            "the real record is untouched"
        );
        assert_eq!(
            sweep_practice(&root),
            None,
            "nothing to sweep is nothing to say"
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn an_account_line_says_where_it_stands_and_never_what_was_written() {
        let now = at("2026-11-20T10:00:00Z");
        let mut record = Record::begin("1", now);
        record.steps.helper = StepState::Skipped;
        record.stories = vec!["2026-11-20-a-meal-you-love-rough".into()];
        let line = account_line(&Account {
            user: "grammi".into(),
            record: Some(record.clone()),
            unreadable: false,
        });
        assert_eq!(line, "grammi · in progress · stories 1 of 3 · helper's key skipped · round 1 · started 2026-11-20");
        assert!(!line.contains("meal"));
        assert_eq!(
            account_line(&Account {
                user: "dana".into(),
                record: None,
                unreadable: false
            }),
            "dana · not started"
        );
        assert_eq!(
            finished_words(&record),
            "helper skipped, stories 1, voice pending"
        );
    }
}
