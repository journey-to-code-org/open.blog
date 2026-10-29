//! The bounds of a job capture made on a phone (ADRs 0400 to 0402). Pure: no file, clock or network.
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

/// The limits Admin's Capture view works to. `max_photo_mb` is the site's own `admin.maxUploadMb`.
pub fn limits_json(max_photo_mb: u32) -> Value {
    json!({
        "maxPhotos": MAX_PHOTOS,
        "maxNotesChars": MAX_NOTES_CHARS,
        "maxPhotoBytes": max_photo_mb as u64 * 1024 * 1024,
        "maxAudioSeconds": MAX_AUDIO_SECONDS,
    })
}
