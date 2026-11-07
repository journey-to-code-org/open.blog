//! The private record of seasonal reminders and the one thing a reminder can do (ADR 0355).
//!
//! `.openblog/private/seasonal.json` holds which reminders were snoozed and which opened a draft. It
//! is versioned, bounded and private: it is never built, exported or published. A reminder opens an
//! unpublished draft with its prompt; this module has no other way to write a post, so nothing here
//! can publish.

use std::fs;
use std::path::Path;

use openblog_core::frontmatter::{self, Value};
use openblog_core::seasonal::{self, Reminder, ReminderState};
use openblog_core::slug::slugify;
use serde_json::{json, Value as Json};

use crate::assistant_storage::contained_target;
use crate::{fsutil, site};

pub const STATE_PATH: &str = ".openblog/private/seasonal.json";
const VERSION: u64 = 1;
const MAX_FILE_BYTES: u64 = 64 * 1024;
/// Entries kept in each map. Older ones are dropped first so the file cannot grow without bound.
const MAX_KEPT: usize = 400;

/// Read the state. A missing, oversized, unreadable or newer file is an empty state, never an error:
/// the worst outcome is a reminder shown again.
pub fn read_state(root: &Path) -> ReminderState {
    let Ok(path) = contained_target(root, Path::new(STATE_PATH)) else {
        return ReminderState::default();
    };
    let Ok(meta) = fs::metadata(&path) else {
        return ReminderState::default();
    };
    if meta.len() > MAX_FILE_BYTES {
        return ReminderState::default();
    }
    let Ok(text) = fs::read_to_string(&path) else {
        return ReminderState::default();
    };
    let Ok(Json::Object(object)) = serde_json::from_str::<Json>(&text) else {
        return ReminderState::default();
    };
    if object.get("version").and_then(Json::as_u64) != Some(VERSION) {
        return ReminderState::default();
    }
    let map = |name: &str| -> std::collections::BTreeMap<String, String> {
        object
            .get(name)
            .and_then(Json::as_object)
            .map(|items| {
                items
                    .iter()
                    .filter(|(key, _)| seasonal::valid_key(key))
                    .filter_map(|(key, value)| Some((key.clone(), value.as_str()?.to_string())))
                    .collect()
            })
            .unwrap_or_default()
    };
    ReminderState {
        snoozed: map("snoozed"),
        opened: map("opened"),
    }
}

fn trim(map: &mut std::collections::BTreeMap<String, String>) {
    // Keys end in the day the window opened, so the smallest sort oldest within a topic; drop by key
    // date to keep the newest.
    while map.len() > MAX_KEPT {
        let oldest = map
            .keys()
            .min_by_key(|key| key.rsplit('@').next().unwrap_or("").to_string())
            .cloned();
        match oldest {
            Some(key) => map.remove(&key),
            None => break,
        };
    }
}

/// The state as the Reminders screen should see it: a reminder whose draft is gone (deleted, moved
/// to the trash or renamed) no longer counts as opened, so the screen offers to start it again
/// instead of linking to a missing file.
pub fn live_state(root: &Path) -> ReminderState {
    let mut state = read_state(root);
    state.opened.retain(|_, path| {
        contained_target(root, Path::new(path.as_str())).is_ok_and(|target| target.is_file())
    });
    state
}

/// The path the editor and the document API take for a draft stored at `relative` (a path from
/// the project root such as `content/posts/x.md`): the same path without the content folder. A
/// content folder written with a trailing slash (`content/`) still matches, as does a record made
/// before drafts were stored without the doubled slash.
pub fn document_path(content: &str, relative: &str) -> Option<String> {
    relative
        .strip_prefix(content.trim_end_matches('/'))
        .filter(|rest| rest.starts_with('/'))
        .map(|rest| rest.trim_start_matches('/'))
        .filter(|rest| rest.starts_with("posts/"))
        .map(str::to_string)
}

pub fn write_state(root: &Path, state: &ReminderState) -> Result<(), String> {
    let path = contained_target(root, Path::new(STATE_PATH))?;
    let mut state = state.clone();
    trim(&mut state.snoozed);
    trim(&mut state.opened);
    let text = serde_json::to_string_pretty(&json!({
        "version": VERSION,
        "snoozed": state.snoozed,
        "opened": state.opened,
    }))
    .map_err(|error| error.to_string())?;
    fsutil::write_file(&path, format!("{text}\n").as_bytes())
}

/// Snooze one reminder until `until` (`YYYY-MM-DD`).
pub fn snooze(root: &Path, key: &str, until: &str) -> Result<(), String> {
    let mut state = read_state(root);
    state.snoozed.insert(key.to_string(), until.to_string());
    write_state(root, &state)
}

/// Open the draft for a reminder and remember it. If this occurrence already opened a draft that
/// still exists, that draft is returned and nothing is written, so a double tap makes one draft.
/// The draft is always unpublished (`draft: true`), dated today, and holds the prompt as its first
/// paragraph. Returns the draft's path relative to the project and whether it was just made.
pub fn open_draft(root: &Path, reminder: &Reminder, today: &str) -> Result<(String, bool), String> {
    let mut state = read_state(root);
    if let Some(existing) = state.opened.get(&reminder.key) {
        if contained_target(root, Path::new(existing)).is_ok_and(|path| path.is_file()) {
            return Ok((existing.clone(), false));
        }
    }
    let config = site::load_config(root)?;
    let (title, body) = seasonal::draft_title_and_body(reminder);
    let slug = slugify(&title);
    if slug.is_empty() {
        return Err("the topic needs at least one letter or digit".into());
    }
    let fields: Vec<(&str, Value)> = vec![
        ("title", Value::Scalar(title)),
        ("date", Value::Scalar(today.to_string())),
        ("description", Value::Scalar(String::new())),
        ("draft", Value::Scalar("true".into())),
    ];
    let mut text = frontmatter::serialize(&fields);
    text.push('\n');
    text.push_str(&body);
    let year = reminder.opens.get(..4).unwrap_or("");
    let mut relative = String::new();
    for attempt in 0..20 {
        let suffix = match attempt {
            0 => String::new(),
            1 => format!("-{year}"),
            n => format!("-{year}-{n}"),
        };
        let candidate = format!(
            "{}/posts/{today}-{slug}{suffix}.md",
            config.paths.content.trim_end_matches('/')
        );
        let path = contained_target(root, Path::new(&candidate))?;
        if !path.exists() {
            relative = candidate;
            break;
        }
    }
    if relative.is_empty() {
        return Err("too many drafts already share this name; rename one first".into());
    }
    let path = contained_target(root, Path::new(&relative))?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("cannot create {}: {error}", parent.display()))?;
    }
    fsutil::create_new_file(&path, text.as_bytes())?;
    state.snoozed.remove(&reminder.key);
    state.opened.insert(reminder.key.clone(), relative.clone());
    write_state(root, &state)?;
    Ok((relative, true))
}
