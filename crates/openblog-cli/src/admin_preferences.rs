//! Each account's private preferences file (`.openblog/private/admin-preferences/<sha256>.json`).
//!
//! The old Admin's Personalize wrote version 1 (retired in R15). Studio reads one answer from a v1
//! file (whether this account said "No thanks" to the voice invitation before the server kept that
//! answer on its own, R9 G64), and since ONB1 (ADR 0417) keeps version 2 in the same file: the
//! first-run answers, the blog kind and the feature areas this login hides. A v1 file is read as
//! v2 in memory and written as v2 only on a save, keeping every key it had. Nothing here is ever
//! built or published, and one login's file is never read for another.
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};

/// The largest preferences file the old Admin wrote; anything bigger isn't one of its files.
const MAX_FILE_BYTES: u64 = 64 * 1024;

/// Where the old Admin kept this account's preferences.
pub fn preference_path(root: &Path, user: &str) -> Result<PathBuf, String> {
    if user.is_empty() || user.len() > 128 || user.chars().any(char::is_control) {
        return Err("invalid admin identity".into());
    }
    let identity = format!("{:x}", Sha256::digest(user.as_bytes()));
    Ok(root
        .join(".openblog")
        .join("private")
        .join("admin-preferences")
        .join(format!("{identity}.json")))
}

/// Whether this account dismissed the voice invitation in the old Admin (`voiceInvitationDismissed`).
/// Anything missing, unreadable or odd is "not dismissed": the invitation is harmless.
pub fn voice_invitation_dismissed(root: &Path, user: &str) -> bool {
    let Ok(path) = preference_path(root, user) else {
        return false;
    };
    let small =
        fs::metadata(&path).is_ok_and(|meta| meta.is_file() && meta.len() <= MAX_FILE_BYTES);
    small
        && fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
            .is_some_and(|stored| stored["voiceInvitationDismissed"] == Value::Bool(true))
}

// ---------------------------------------------------------------------------------------------
// Version 2 (ONB1): answers, kind and areas
// ---------------------------------------------------------------------------------------------

/// Studio's feature areas that can be hidden (`web/studio/parts/area-rules.js` `AREAS`, the same
/// list; a test compares them). Essentials are not areas here: they can never be hidden.
pub const AREA_IDS: &[&str] = &[
    "pages",
    "collections",
    "recipes",
    "trade",
    "seasonal",
    "sharing",
    "readers",
    "research",
    "teaching",
    "code",
    "together",
];

/// What a blog is mostly about: the first question's choices, and `openblog init --kind`.
pub const KIND_IDS: &[&str] = &[
    "technical",
    "recipes",
    "trade",
    "teaching",
    "research",
    "podcast",
    "docs",
    "personal",
];

/// Every question and its choices (`web/studio/parts/welcome-rules.js` `QUESTIONS`).
pub const QUESTIONS: &[(&str, &[&str])] = &[
    ("kind", KIND_IDS),
    ("together", &["solo", "few"]),
    ("seasons", &["yes", "no"]),
    ("sharing", &["yes", "later", "no"]),
    ("readers", &["yes", "no"]),
    ("amount", &["essentials", "everything"]),
];

/// Where a login stands with the questions.
pub const STATES: &[&str] = &["pending", "done", "skipped"];

/// At most this many pieces marked as stories.
pub const MAX_STORY_MARKS: usize = 200;

/// The keys version 2 owns; every other key in the file is kept as it was.
const V2_KEYS: &[&str] = &[
    "schemaVersion",
    "onboarding",
    "kind",
    "answers",
    "areas",
    "showEverything",
    "storyMarks",
];

/// One login's preferences as they are stored: the whole object (v1 keys included), its revision
/// (`""` when there is no file), and whether the file could be read at all.
#[derive(Debug, Clone)]
pub struct Stored {
    pub object: Map<String, Value>,
    pub etag: String,
    pub exists: bool,
}

/// The revision of a file's bytes (FNV-1a), `""` for no file.
fn etag_of(bytes: Option<&[u8]>) -> String {
    let Some(bytes) = bytes else {
        return String::new();
    };
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in bytes {
        h ^= u64::from(*byte);
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    format!("{h:016x}")
}

/// Read this login's file. A missing file is an empty object; anything that isn't a small JSON
/// object is an error (the routes say so, and nothing is overwritten).
pub fn read(root: &Path, user: &str) -> Result<Stored, String> {
    let path = preference_path(root, user)?;
    let bytes = crate::private_file::read(&path, MAX_FILE_BYTES as usize)?;
    let Some(bytes) = bytes else {
        return Ok(Stored {
            object: Map::new(),
            etag: String::new(),
            exists: false,
        });
    };
    match serde_json::from_slice::<Value>(&bytes) {
        Ok(Value::Object(object)) => Ok(Stored {
            object,
            etag: etag_of(Some(&bytes)),
            exists: true,
        }),
        _ => Err("this account's preferences file is not a JSON object".into()),
    }
}

fn known(list: &[&str], value: &str) -> bool {
    list.contains(&value)
}

/// Known area ids from a JSON list, once each, in the catalog's order. Anything else is dropped.
fn area_list(value: Option<&Value>) -> Vec<String> {
    let given: Vec<&str> = value
        .and_then(Value::as_array)
        .map(|items| items.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();
    AREA_IDS
        .iter()
        .filter(|id| given.contains(id))
        .map(|id| (*id).to_string())
        .collect()
}

/// Known question → choice pairs; anything else is dropped.
fn answer_map(value: Option<&Value>) -> Map<String, Value> {
    let mut out = Map::new();
    if let Some(given) = value.and_then(Value::as_object) {
        for (question, choices) in QUESTIONS {
            if let Some(choice) = given.get(*question).and_then(Value::as_str) {
                if known(choices, choice) {
                    out.insert((*question).to_string(), json!(choice));
                }
            }
        }
    }
    out
}

/// A voice piece id as the voice routes name one: plain characters, short.
fn piece_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 160
        && value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
        && !value.starts_with('.')
}

fn story_marks(value: Option<&Value>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for id in value
        .and_then(Value::as_array)
        .map(|items| items.iter().filter_map(Value::as_str).collect::<Vec<_>>())
        .unwrap_or_default()
    {
        if piece_id(id) && !out.iter().any(|kept| kept == id) && out.len() < MAX_STORY_MARKS {
            out.push(id.to_string());
        }
    }
    out
}

/// The v1 Personalize modules that mean an area now (ADR 0417): research and evidence panes are
/// Research, analytics is Readers. Nothing else carries over.
fn v1_hidden(object: &Map<String, Value>) -> Vec<String> {
    let modules: Vec<&str> = object
        .get("hiddenModules")
        .and_then(Value::as_array)
        .map(|items| items.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();
    let mut hidden = Vec::new();
    if modules.iter().any(|m| *m == "research" || *m == "evidence") {
        hidden.push(json!("research"));
    }
    if modules.contains(&"analytics") {
        hidden.push(json!("readers"));
    }
    area_list(Some(&Value::Array(hidden)))
}

/// The version 2 view of whatever is stored: what `GET areas` answers. A v1 file is a login that
/// was already set up (state `done`): `full` shows everything, a few hidden modules map to areas.
/// No file is a login that hasn't been asked (`pending`), with nothing hidden.
pub fn view(stored: &Stored) -> Value {
    let object = &stored.object;
    let version = object
        .get("schemaVersion")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    if version < 2 {
        let v1 = stored.exists && version == 1;
        return json!({
            "schemaVersion": 2,
            "onboarding": { "state": if v1 { "done" } else { "pending" }, "version": 1, "at": Value::Null },
            "kind": Value::Null,
            "answers": {},
            "areas": { "shown": [], "hidden": if v1 { v1_hidden(object) } else { Vec::new() } },
            "showEverything": v1 && object.get("preset").and_then(Value::as_str) == Some("full"),
            "storyMarks": [],
        });
    }
    let onboarding = object.get("onboarding").and_then(Value::as_object);
    let state = onboarding
        .and_then(|o| o.get("state"))
        .and_then(Value::as_str)
        .filter(|s| known(STATES, s))
        .unwrap_or("pending");
    let at = onboarding
        .and_then(|o| o.get("at"))
        .and_then(Value::as_str)
        .map_or(Value::Null, |at| json!(at));
    let kind = object
        .get("kind")
        .and_then(Value::as_str)
        .filter(|k| known(KIND_IDS, k))
        .map_or(Value::Null, |k| json!(k));
    let areas = object.get("areas").and_then(Value::as_object);
    json!({
        "schemaVersion": 2,
        "onboarding": { "state": state, "version": 1, "at": at },
        "kind": kind,
        "answers": answer_map(object.get("answers")),
        "areas": {
            "shown": area_list(areas.and_then(|a| a.get("shown"))),
            "hidden": area_list(areas.and_then(|a| a.get("hidden"))),
        },
        "showEverything": object.get("showEverything").and_then(Value::as_bool).unwrap_or(false),
        "storyMarks": story_marks(object.get("storyMarks")),
    })
}

/// A change to the view, from `PUT areas`: any subset of the v2 fields. Wrong types are an error;
/// unknown questions, choices, areas and kinds are dropped, never stored. `now` stamps a state
/// that becomes `done` or `skipped`.
pub fn apply(view: &Value, patch: &Map<String, Value>, now: &str) -> Result<Value, String> {
    let mut next = view.clone();
    if let Some(onboarding) = patch.get("onboarding") {
        let state = onboarding
            .as_object()
            .and_then(|o| o.get("state"))
            .and_then(Value::as_str)
            .ok_or("`onboarding` must be { state }")?;
        if known(STATES, state) {
            next["onboarding"] = json!({
                "state": state,
                "version": 1,
                "at": if state == "pending" { Value::Null } else { json!(now) },
            });
        }
    }
    if let Some(kind) = patch.get("kind") {
        next["kind"] = match kind {
            Value::Null => Value::Null,
            Value::String(k) if known(KIND_IDS, k) => json!(k),
            Value::String(_) => Value::Null,
            _ => return Err("`kind` must be text".into()),
        };
    }
    if let Some(answers) = patch.get("answers") {
        if !answers.is_object() {
            return Err("`answers` must be an object".into());
        }
        next["answers"] = Value::Object(answer_map(Some(answers)));
    }
    for (key, field) in [("hidden", "hidden"), ("shown", "shown")] {
        if let Some(list) = patch.get(key) {
            if !list.is_array() {
                return Err(format!("`{key}` must be a list"));
            }
            next["areas"][field] = json!(area_list(Some(list)));
        }
    }
    if let Some(everything) = patch.get("showEverything") {
        next["showEverything"] = json!(everything
            .as_bool()
            .ok_or("`showEverything` must be true or false")?);
    }
    if let Some(marks) = patch.get("storyMarks") {
        if !marks.is_array() {
            return Err("`storyMarks` must be a list".into());
        }
        next["storyMarks"] = json!(story_marks(Some(marks)));
    }
    Ok(next)
}

/// Write `view` as version 2, keeping every other key the file had (v1's included), and return
/// what is stored now.
pub fn write(root: &Path, user: &str, stored: &Stored, view: &Value) -> Result<Stored, String> {
    let mut object = stored.object.clone();
    for key in V2_KEYS {
        object.remove(*key);
    }
    if let Some(fields) = view.as_object() {
        for key in V2_KEYS {
            if let Some(value) = fields.get(*key) {
                object.insert((*key).to_string(), value.clone());
            }
        }
    }
    object.insert("schemaVersion".into(), json!(2));
    let bytes = serde_json::to_vec_pretty(&Value::Object(object.clone()))
        .map_err(|error| error.to_string())?;
    crate::private_file::write(&preference_path(root, user)?, &bytes)?;
    Ok(Stored {
        object,
        etag: etag_of(Some(&bytes)),
        exists: true,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn fixture(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("openblog-admin-preferences-{name}-{nonce}"));
        fs::create_dir_all(&root).unwrap();
        root
    }

    fn write(root: &Path, user: &str, bytes: &[u8]) {
        let path = preference_path(root, user).unwrap();
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, bytes).unwrap();
    }

    #[test]
    fn voice_invitation_carry_over_still_read() {
        let root = fixture("carry-over");
        // A file exactly as the old Admin's Personalize wrote it, with the invitation dismissed.
        write(
            &root,
            "author",
            br#"{"schemaVersion":1,"preset":"simple","density":"comfortable","editorMode":"visual","moduleOrder":["voice"],"hiddenModules":[],"voiceInvitationDismissed":true}"#,
        );
        assert!(voice_invitation_dismissed(&root, "author"));
        assert!(
            !voice_invitation_dismissed(&root, "someone-else"),
            "one account's answer is its own"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn anything_missing_or_odd_is_not_dismissed() {
        let root = fixture("odd");
        assert!(!voice_invitation_dismissed(&root, "author"), "no file");
        write(&root, "author", br#"{"schemaVersion":1,"preset":"simple"}"#);
        assert!(
            !voice_invitation_dismissed(&root, "author"),
            "never dismissed"
        );
        write(&root, "author", br#"{"voiceInvitationDismissed":"yes"}"#);
        assert!(!voice_invitation_dismissed(&root, "author"), "not a yes");
        write(&root, "author", b"not json");
        assert!(!voice_invitation_dismissed(&root, "author"), "not JSON");
        let mut big = br#"{"voiceInvitationDismissed":true,"x":""#.to_vec();
        big.extend(std::iter::repeat_n(b'x', MAX_FILE_BYTES as usize));
        big.extend(br#""}"#);
        write(&root, "author", &big);
        assert!(!voice_invitation_dismissed(&root, "author"), "too big");
        assert!(!voice_invitation_dismissed(&root, ""), "no account");
        fs::remove_dir_all(root).unwrap();
    }

    fn stored(root: &Path, user: &str) -> Stored {
        read(root, user).unwrap()
    }

    #[test]
    fn a_new_login_is_pending_with_nothing_hidden() {
        let root = fixture("v2-new");
        let view = view(&stored(&root, "grammi"));
        assert_eq!(view["onboarding"]["state"], "pending");
        assert_eq!(view["areas"]["hidden"], json!([]));
        assert_eq!(view["showEverything"], false);
        assert_eq!(stored(&root, "grammi").etag, "", "no file, no revision");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_v1_file_reads_as_v2_and_is_written_as_v2_only_on_save() {
        let root = fixture("v2-migrate");
        let v1 = br#"{"schemaVersion":1,"preset":"custom","density":"compact","editorMode":"visual","moduleOrder":[],"hiddenModules":["evidence","analytics","social"],"voiceInvitationDismissed":true}"#;
        write(&root, "mikey", v1);
        let before = stored(&root, "mikey");
        let view = view(&before);
        assert_eq!(
            view["onboarding"]["state"], "done",
            "an account already set up isn't asked"
        );
        assert_eq!(view["areas"]["hidden"], json!(["readers", "research"]));
        assert_eq!(view["showEverything"], false);
        let path = preference_path(&root, "mikey").unwrap();
        assert_eq!(fs::read(&path).unwrap(), v1, "reading never writes");
        let next = apply(
            &view,
            json!({ "showEverything": true }).as_object().unwrap(),
            "2026-11-16T00:00:00Z",
        )
        .unwrap();
        let after = super::write(&root, "mikey", &before, &next).unwrap();
        let file: Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert_eq!(file["schemaVersion"], 2);
        assert_eq!(file["showEverything"], true);
        assert_eq!(file["voiceInvitationDismissed"], true, "v1 keys are kept");
        assert_eq!(
            file["hiddenModules"],
            json!(["evidence", "analytics", "social"])
        );
        assert!(voice_invitation_dismissed(&root, "mikey"));
        assert_ne!(after.etag, before.etag);
        let full = br#"{"schemaVersion":1,"preset":"full","hiddenModules":[]}"#;
        write(&root, "dana", full);
        assert_eq!(super::view(&stored(&root, "dana"))["showEverything"], true);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn unknown_questions_choices_areas_and_kinds_are_dropped() {
        let root = fixture("v2-unknown");
        let view = view(&stored(&root, "grammi"));
        let patch = json!({
            "kind": "astrology",
            "answers": { "kind": "recipes", "seasons": "sometimes", "colour": "blue", "readers": "no" },
            "hidden": ["seasonal", "spaceships", "seasonal", "code"],
            "shown": ["recipes", 4],
            "storyMarks": ["2026-11-16-a-mistake-i-made", "../etc", "", "2026-11-16-a-mistake-i-made"],
            "onboarding": { "state": "maybe" },
        });
        let next = apply(&view, patch.as_object().unwrap(), "2026-11-16T00:00:00Z").unwrap();
        assert_eq!(next["kind"], Value::Null);
        assert_eq!(
            next["answers"],
            json!({ "kind": "recipes", "readers": "no" })
        );
        assert_eq!(next["areas"]["hidden"], json!(["seasonal", "code"]));
        assert_eq!(next["areas"]["shown"], json!(["recipes"]));
        assert_eq!(next["storyMarks"], json!(["2026-11-16-a-mistake-i-made"]));
        assert_eq!(
            next["onboarding"]["state"], "pending",
            "an unknown state is ignored"
        );
        assert!(apply(&view, json!({ "answers": [] }).as_object().unwrap(), "now").is_err());
        assert!(apply(
            &view,
            json!({ "showEverything": "yes" }).as_object().unwrap(),
            "now"
        )
        .is_err());
        let done = apply(
            &view,
            json!({ "onboarding": { "state": "done" } })
                .as_object()
                .unwrap(),
            "2026-11-16T00:00:00Z",
        )
        .unwrap();
        assert_eq!(
            done["onboarding"],
            json!({ "state": "done", "version": 1, "at": "2026-11-16T00:00:00Z" })
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_file_that_isnt_an_object_is_an_error_not_a_reset() {
        let root = fixture("v2-odd");
        write(&root, "grammi", b"[1,2]");
        assert!(read(&root, "grammi").is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
