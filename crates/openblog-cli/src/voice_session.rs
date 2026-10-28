//! Resumable timed voice sessions (ADR 0351).
//!
//! A session is one timed sitting with one prompt. Its only state is a private record,
//! `.openblog/private/voice/session.json`, holding the prompt, the catalog version, when it
//! started and when it ends, the draft so far and the surface (CLI, Admin) that began it, so any
//! surface can resume it with the original deadline. There is one per site. The record is written
//! to a temporary file and renamed into place, so a crash leaves either the old record or the new
//! one.
//!
//! Ending a session is [`lock`] or [`scrap`], and either removes the record. Locking writes the
//! rough draft through [`voice_store::write_rough`], the only way a rough draft is ever created.
//! Time is passed in, so every rule here is testable at an exact second.
// The Admin, CLI and Assistant layers of the voice-samples family call this API.
#![allow(dead_code)]

use std::fmt;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use openblog_core::voice::catalog::Catalog;
use openblog_core::voice::{self, VoiceMeta, VoiceSample, VoiceStage};
use openblog_core::DateTime;
use serde_json::{json, Value};

use crate::assistant_storage::contained_target;
use crate::fsutil;
use crate::voice_store::{self, StoreError, Visibility, Written, SESSION_FORMAT, SESSION_PATH};

/// The record version this release writes and reads.
pub const SESSION_VERSION: u64 = 1;
/// The writing window the bundled flows offer, in seconds.
pub const DEFAULT_SECONDS: u32 = 180;
/// The shortest and longest writing window a session may have.
pub const MIN_SECONDS: u32 = 30;
pub const MAX_SECONDS: u32 = 3600;
/// How long after the deadline a surface may still hand over its final text, for the delay of
/// a request that left at zero. Later than this, the last saved text is what gets locked.
pub const LOCK_GRACE_SECONDS: i64 = 10;
/// The most text a draft can hold, leaving room in the 64 KiB file for the front matter.
pub const MAX_DRAFT_BYTES: usize = 60 * 1024;
const MAX_RECORD_BYTES: usize = 128 * 1024;

/// The open session.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Session {
    pub prompt_id: String,
    pub pack: String,
    pub catalog_version: u32,
    /// RFC 3339.
    pub started_at: String,
    /// RFC 3339.
    pub deadline: String,
    pub time_limit_seconds: u32,
    /// The text so far, as last saved.
    pub draft: String,
    /// Which surface began it, such as `cli` or `admin`.
    pub surface: String,
    /// Where the rough draft will be kept when locked.
    pub visibility: Visibility,
}

impl Session {
    fn deadline_unix(&self) -> i64 {
        DateTime::parse(&self.deadline).map_or(0, DateTime::unix)
    }

    /// Whole seconds left at `now`, never below zero.
    pub fn remaining_seconds(&self, now: DateTime) -> i64 {
        (self.deadline_unix() - now.unix()).max(0)
    }

    pub fn expired(&self, now: DateTime) -> bool {
        now.unix() >= self.deadline_unix()
    }
}

/// Where the session stands.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Status {
    None,
    Active {
        session: Session,
        remaining_seconds: i64,
    },
    Expired {
        session: Session,
    },
}

/// A rough draft that a session locked.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Locked {
    pub written: Written,
    /// Whether the time had run out, so the last saved text was locked.
    pub expired: bool,
    pub words: u32,
}

/// What resuming did.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Resume {
    NoSession,
    /// Time is left; carry on with `session.draft`.
    Active {
        session: Session,
        remaining_seconds: i64,
    },
    /// The time had run out, so the rough draft was locked from the saved text.
    Locked(Locked),
    /// The time had run out with nothing written, so the empty session was discarded.
    Discarded {
        prompt_id: String,
    },
}

/// Why a session could not be started.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum StartError {
    /// One session is already open; the caller asks the author to lock or scrap it first.
    AlreadyOpen {
        prompt_id: String,
        expired: bool,
    },
    Refused(String),
    Failed(String),
}

impl fmt::Display for StartError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::AlreadyOpen {
                prompt_id,
                expired: false,
            } => write!(
                f,
                "A writing session for \"{prompt_id}\" is already open. Lock it or scrap it before starting another."
            ),
            Self::AlreadyOpen {
                prompt_id,
                expired: true,
            } => write!(
                f,
                "A writing session for \"{prompt_id}\" has run out of time and is waiting to be locked. Lock it or scrap it before starting another."
            ),
            Self::Refused(message) | Self::Failed(message) => f.write_str(message),
        }
    }
}

impl From<StoreError> for StartError {
    fn from(error: StoreError) -> Self {
        match error {
            StoreError::Failed(message) => Self::Failed(message),
            other => Self::Refused(other.to_string()),
        }
    }
}

type Result<T> = std::result::Result<T, StoreError>;

fn refused<T>(message: impl Into<String>) -> Result<T> {
    Err(StoreError::Refused(message.into()))
}

fn path(root: &Path) -> Result<PathBuf> {
    contained_target(root, Path::new(SESSION_PATH))
        .map_err(|error| StoreError::Refused(format!("{error}.")))
}

fn normalized(text: &str) -> String {
    text.replace("\r\n", "\n")
}

/// Read the record. `Ok(None)` if there is none; an error if it exists but cannot be used, which
/// leaves it exactly as it is.
fn read(root: &Path) -> Result<Option<Session>> {
    let path = path(root)?;
    let metadata = match fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => {
            return Err(StoreError::Failed(format!(
                "Cannot read the session record: {error}"
            )))
        }
    };
    if !metadata.is_file() || metadata.len() > MAX_RECORD_BYTES as u64 {
        return refused("The session record is not usable. Scrap the session to start again.");
    }
    let bytes = fs::read(&path)
        .map_err(|error| StoreError::Failed(format!("Cannot read the session record: {error}")))?;
    let unusable = || {
        StoreError::Refused(
            "The session record is damaged. Scrap the session to start again.".into(),
        )
    };
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| unusable())?;
    if value["format"] != SESSION_FORMAT {
        return Err(unusable());
    }
    match value["version"].as_u64() {
        Some(SESSION_VERSION) => {}
        Some(newer) if newer > SESSION_VERSION => {
            return refused(
                "The session was started by a newer release of open.blog. Update open.blog to continue it; it has been left untouched.",
            )
        }
        _ => return Err(unusable()),
    }
    let text = |key: &str| value[key].as_str().map(str::to_string).ok_or_else(unusable);
    let session = Session {
        prompt_id: text("promptId")?,
        pack: text("pack")?,
        catalog_version: value["catalogVersion"]
            .as_u64()
            .and_then(|n| u32::try_from(n).ok())
            .ok_or_else(unusable)?,
        started_at: text("startedAt")?,
        deadline: text("deadline")?,
        time_limit_seconds: value["timeLimitSeconds"]
            .as_u64()
            .and_then(|n| u32::try_from(n).ok())
            .ok_or_else(unusable)?,
        draft: text("draft")?,
        surface: text("surface")?,
        visibility: Visibility::parse(&text("visibility")?).ok_or_else(unusable)?,
    };
    if DateTime::parse(&session.started_at).is_none()
        || DateTime::parse(&session.deadline).is_none()
    {
        return Err(unusable());
    }
    Ok(Some(session))
}

/// Write the record to a temporary file and rename it into place.
fn write(root: &Path, session: &Session) -> Result<()> {
    let path = path(root)?;
    let directory = path
        .parent()
        .ok_or_else(|| StoreError::Failed("The session record has no folder.".into()))?;
    fs::create_dir_all(directory)
        .map_err(|error| StoreError::Failed(format!("Cannot create the voice folder: {error}")))?;
    let value = json!({
        "format": SESSION_FORMAT,
        "version": SESSION_VERSION,
        "promptId": session.prompt_id,
        "pack": session.pack,
        "catalogVersion": session.catalog_version,
        "startedAt": session.started_at,
        "deadline": session.deadline,
        "timeLimitSeconds": session.time_limit_seconds,
        "draft": session.draft,
        "surface": session.surface,
        "visibility": session.visibility.as_str(),
    });
    let text = serde_json::to_string_pretty(&value)
        .map_err(|error| StoreError::Failed(error.to_string()))?
        + "\n";
    let token = crate::auth::random_token().map_err(StoreError::Failed)?;
    let temporary = directory.join(format!(".session-{token}.tmp"));
    let result = (|| -> std::io::Result<()> {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        file.write_all(text.as_bytes())?;
        file.sync_all()?;
        drop(file);
        fsutil::replace_file(&temporary, &path)
    })();
    if let Err(error) = result {
        let _ = fs::remove_file(&temporary);
        return Err(StoreError::Failed(format!(
            "Cannot save the session: {error}"
        )));
    }
    Ok(())
}

fn remove(root: &Path) -> Result<()> {
    let path = path(root)?;
    match fsutil::retry_transient(|| fs::remove_file(&path)) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(StoreError::Failed(format!(
            "Cannot remove the session record: {error}"
        ))),
    }
}

/// Where the session stands at `now`. Read only.
pub fn status(root: &Path, now: DateTime) -> Result<Status> {
    Ok(match read(root)? {
        None => Status::None,
        Some(session) if session.expired(now) => Status::Expired { session },
        Some(session) => Status::Active {
            remaining_seconds: session.remaining_seconds(now),
            session,
        },
    })
}

/// Start the one session for `prompt_id`. If a session is already open (even one that has run
/// out of time) this refuses with [`StartError::AlreadyOpen`] and changes nothing, so the caller
/// can ask the author to lock or scrap it first.
pub fn start(
    root: &Path,
    catalog: &Catalog,
    prompt_id: &str,
    surface: &str,
    visibility: Visibility,
    time_limit_seconds: u32,
    now: DateTime,
) -> std::result::Result<Session, StartError> {
    if !voice::is_kebab(surface) || surface.len() > 20 {
        return Err(StartError::Refused(
            "The surface must be a short lowercase name such as cli or admin.".into(),
        ));
    }
    if !(MIN_SECONDS..=MAX_SECONDS).contains(&time_limit_seconds) {
        return Err(StartError::Refused(format!(
            "The writing window must be between {MIN_SECONDS} and {MAX_SECONDS} seconds."
        )));
    }
    let prompt = catalog.prompt(prompt_id).ok_or_else(|| {
        StartError::Refused(format!("There is no prompt called \"{prompt_id}\"."))
    })?;
    let _lock = voice_store::lock(root)?;
    if let Some(open) = read(root)? {
        return Err(StartError::AlreadyOpen {
            expired: open.expired(now),
            prompt_id: open.prompt_id,
        });
    }
    let day = now.rfc3339();
    let day = &day[..10];
    let taken = voice_store::list(root).into_iter().any(|item| {
        item.stage == Some(VoiceStage::Rough)
            && item.prompt.as_deref() == Some(prompt_id)
            && item.date.as_deref().and_then(|d| d.get(..10)) == Some(day)
    });
    if taken {
        return Err(StartError::Refused(
            "You already wrote this prompt today. Choose another, or come back tomorrow.".into(),
        ));
    }
    let session = Session {
        prompt_id: prompt.id.clone(),
        pack: prompt.pack.clone(),
        catalog_version: catalog.version,
        started_at: now.rfc3339(),
        deadline: DateTime::from_unix(now.unix() + i64::from(time_limit_seconds)).rfc3339(),
        time_limit_seconds,
        draft: String::new(),
        surface: surface.to_string(),
        visibility,
    };
    write(root, &session)?;
    if visibility == Visibility::Private {
        crate::landing_history::keep_out_of_git(root);
    }
    Ok(session)
}

/// Save the text so far. Refused once the time has run out: the saved text is what will be locked.
pub fn save_draft(root: &Path, text: &str, now: DateTime) -> Result<Status> {
    let text = normalized(text);
    if text.len() > MAX_DRAFT_BYTES {
        return refused(format!(
            "The draft is longer than {} KiB, which is more than a sample can hold.",
            MAX_DRAFT_BYTES / 1024
        ));
    }
    if text.contains('\0') {
        return refused("The draft cannot contain null characters.");
    }
    let _lock = voice_store::lock(root)?;
    let Some(mut session) = read(root)? else {
        return refused("There is no open writing session.");
    };
    if now.unix() > session.deadline_unix() + LOCK_GRACE_SECONDS {
        return refused("Time is up. The draft will be locked from what was saved last.");
    }
    session.draft = text;
    write(root, &session)?;
    Ok(Status::Active {
        remaining_seconds: session.remaining_seconds(now),
        session,
    })
}

/// End the session by locking its rough draft. `final_text` is the text on screen when the
/// author finished; it is used only if it arrives within [`LOCK_GRACE_SECONDS`] of the deadline,
/// otherwise the last saved text is locked. Nothing is corrected, trimmed or reflowed: the only
/// change is that CRLF line endings become LF before the lock. `visibility` overrides where the
/// session said to keep it.
pub fn lock(
    root: &Path,
    catalog: &Catalog,
    final_text: Option<&str>,
    visibility: Option<Visibility>,
    now: DateTime,
) -> Result<Locked> {
    let session = match read(root)? {
        Some(session) => session,
        None => return refused("There is no open writing session to lock."),
    };
    let late = now.unix() > session.deadline_unix() + LOCK_GRACE_SECONDS;
    let text = match final_text {
        Some(text) if !late => normalized(text),
        _ => session.draft.clone(),
    };
    if text.len() > MAX_DRAFT_BYTES {
        return refused("The draft is longer than a sample can hold.");
    }
    if text.trim().is_empty() {
        return refused(
            "Nothing was written, so there is nothing to lock. Scrap the session to start again.",
        );
    }
    let title = catalog
        .prompt(&session.prompt_id)
        .map_or_else(|| session.prompt_id.clone(), |prompt| prompt.title.clone());
    let words = voice::count_words(&text);
    let sample = VoiceSample {
        title,
        subtitle: None,
        slug: session.prompt_id.clone(),
        date: session.started_at.clone(),
        description: None,
        tags: Vec::new(),
        voice: VoiceMeta {
            catalog: session.catalog_version,
            pack: session.pack.clone(),
            prompt: session.prompt_id.clone(),
            stage: VoiceStage::Rough,
            time_limit_seconds: session.time_limit_seconds,
            words,
            rough_of: None,
        },
        body: text,
        extra: std::collections::BTreeMap::new(),
    };
    let written =
        voice_store::write_rough(root, visibility.unwrap_or(session.visibility), &sample)?;
    let _lock = voice_store::lock(root)?;
    remove(root)?;
    Ok(Locked {
        written,
        expired: session.expired(now),
        words,
    })
}

/// Give up on the session and write nothing. Removes the record.
pub fn scrap(root: &Path) -> Result<()> {
    let _lock = voice_store::lock(root)?;
    // A record from a newer release is left alone; a damaged one can be scrapped.
    if let Err(StoreError::Refused(message)) = read(root) {
        if message.contains("newer release") {
            return Err(StoreError::Refused(message));
        }
    }
    remove(root)
}

/// Pick up where a surface left off. With time left, the session carries on with its original
/// deadline. If the time ran out, the rough draft is locked from the saved text (a session with
/// nothing saved is discarded).
pub fn resume(root: &Path, catalog: &Catalog, now: DateTime) -> Result<Resume> {
    match status(root, now)? {
        Status::None => Ok(Resume::NoSession),
        Status::Active {
            session,
            remaining_seconds,
        } => Ok(Resume::Active {
            session,
            remaining_seconds,
        }),
        Status::Expired { session } => {
            if session.draft.trim().is_empty() {
                scrap(root)?;
                Ok(Resume::Discarded {
                    prompt_id: session.prompt_id,
                })
            } else {
                lock(root, catalog, None, None, now).map(Resume::Locked)
            }
        }
    }
}

#[cfg(test)]
mod tests;
