//! The bounds and stored formats of a job capture made on a phone (ADRs 0400 to 0402). Pure: no file, clock
//! or network.
//!
//! Admin's Capture view reads these numbers from `GET /admin/api/meta` (`capture`), so the phone, the queue
//! on the phone and the server agree on one set of limits.

use serde_json::{json, Value};

/// Most photos one capture may carry.
pub const MAX_PHOTOS: usize = 12;
/// Most characters in the notes of one capture.
pub const MAX_NOTES_CHARS: usize = 8_000;
/// Longest a capture's voice note may run, in seconds.
pub const MAX_AUDIO_SECONDS: u32 = 180;

/// Version of the record the phone keeps for a waiting capture, and of the server's ledger entry.
pub const STORED_VERSION: u32 = 1;
/// Most captures a device keeps waiting to be sent.
pub const MAX_QUEUED: usize = 5;
/// Most bytes one waiting capture may hold (photos and any voice note).
pub const MAX_CAPTURE_BYTES: u64 = 60 * 1024 * 1024;
/// Most bytes the whole waiting queue may hold.
pub const MAX_QUEUE_BYTES: u64 = 120 * 1024 * 1024;

const ID_LEN: usize = 32;

/// A capture id: 32 lowercase hex digits, made on the phone. It names files and ledger entries, so nothing else is accepted.
pub fn valid_id(id: &str) -> bool {
    id.len() == ID_LEN
        && id
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// The stored name (without extension) of a capture's photo, so sending the same photo again lands on the same file.
pub fn photo_stem(id: &str, slot: usize) -> Option<String> {
    (valid_id(id) && slot < MAX_PHOTOS).then(|| format!("capture-{}-{slot}", &id[..12]))
}

/// What the server keeps once a capture has become a draft, so a replay finds it.
pub fn ledger_text(path: &str) -> String {
    json!({ "v": STORED_VERSION, "path": path }).to_string()
}

/// The draft path a ledger entry names. An entry written by a newer version is an error, never guessed at.
pub fn parse_ledger(text: &str) -> Result<String, String> {
    let value: Value = serde_json::from_str(text)
        .map_err(|_| "The capture ledger entry is unreadable".to_string())?;
    if value["v"] != STORED_VERSION {
        return Err("The capture ledger entry was written by another version of open.blog".into());
    }
    value["path"]
        .as_str()
        .filter(|path| !path.is_empty())
        .map(str::to_string)
        .ok_or_else(|| "The capture ledger entry has no path".to_string())
}

/// The limits Admin's Capture view works to. `max_photo_mb` is the site's own `admin.maxUploadMb`.
pub fn limits_json(max_photo_mb: u32) -> Value {
    json!({
        "maxPhotos": MAX_PHOTOS,
        "maxNotesChars": MAX_NOTES_CHARS,
        "maxPhotoBytes": max_photo_mb as u64 * 1024 * 1024,
        "maxAudioSeconds": MAX_AUDIO_SECONDS,
        "storedVersion": STORED_VERSION,
        "maxQueued": MAX_QUEUED,
        "maxCaptureBytes": MAX_CAPTURE_BYTES,
        "maxQueueBytes": MAX_QUEUE_BYTES,
    })
}
