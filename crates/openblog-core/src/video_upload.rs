//! Publishing an approved video release to YouTube (epic #386, story #400, ADRs 0378 to 0380).
//!
//! The pure half of the upload: what an approval binds and when it still stands, the exact
//! `videos.insert` resource sent, how a Google reply is classified into a reliable failure state,
//! how far a resumable session got, and what a lookup after an uncertain upload may conclude. The
//! command line holds the credential, the network and the files; nothing here touches any of them.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::distribution::Status;
use crate::provider_manifest::{approval_stands, builtin_manifest, ProviderId, ProviderManifest};
use crate::social_schedule::{parse_schedule, ScheduleError};
use crate::video_release::VideoPreview;
use crate::DateTime;

/// Lets an upload create videos and set their thumbnails
/// (<https://developers.google.com/youtube/v3/docs/videos/insert>,
/// <https://developers.google.com/youtube/v3/docs/thumbnails/set>).
pub const SCOPE_UPLOAD: &str = "https://www.googleapis.com/auth/youtube.upload";
/// Lets a lookup list the channel's own uploads after an uncertain upload
/// (<https://developers.google.com/youtube/v3/docs/channels/list>).
pub const SCOPE_READONLY: &str = "https://www.googleapis.com/auth/youtube.readonly";
/// The scopes every connection asks for, and must be granted in full.
pub const SCOPES: [&str; 2] = [SCOPE_UPLOAD, SCOPE_READONLY];

/// Each resumable request carries this much of the file: a multiple of 256 KiB, as the resumable
/// protocol requires of every chunk but the last
/// (<https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol>).
pub const UPLOAD_CHUNK_BYTES: u64 = 8 * 1024 * 1024;

/// How long after the last byte was sent an empty lookup may conclude "not uploaded": a fresh
/// upload can take a while to appear in the channel's uploads list.
pub const LOOKUP_SETTLE_SECONDS: i64 = 15 * 60;
/// How far before the attempt a listed upload still counts as inside it (clock differences).
pub const LOOKUP_SKEW_SECONDS: i64 = 5 * 60;

pub const APPROVAL_VERSION: u32 = 1;
pub const RECORD_VERSION: u32 = 1;
/// The most history entries one release keeps; older ones are dropped first.
pub const HISTORY_LIMIT: usize = 50;

/// The size and BLAKE2b digest of the master file, read when the author approves and again before
/// any byte is sent, so a replaced file is never uploaded under an old approval.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileFingerprint {
    pub bytes: u64,
    pub digest: String,
}

/// The author's approval of one previewed release, for one file and one publication time.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoApproval {
    pub version: u32,
    pub slug: String,
    pub source_path: String,
    pub canonical_url: String,
    pub preview_digest: String,
    pub file: FileFingerprint,
    /// When YouTube makes the private upload public (`status.publishAt`), UTC; none keeps it
    /// private until the author publishes it in YouTube Studio.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub publish_at: Option<String>,
    /// The whole manifest the release was previewed under (ADR 0327).
    pub manifest: Value,
    pub approved_at: String,
}

/// Why an approval cannot be given, or no longer covers an upload. Every one means nothing was
/// sent.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ApprovalError {
    /// The release has a blocking problem.
    Blocked,
    /// The release names a video already on YouTube; there is no file to upload.
    NothingToUpload,
    /// The digest given is not the current preview's.
    PreviewMismatch,
    /// No approval is recorded for this release.
    NotApproved,
    /// The preview changed since it was approved.
    PreviewChanged,
    /// The master file changed since it was approved.
    SourceChanged,
    /// The YouTube manifest narrowed since the approval (ADR 0327).
    PolicyChanged,
    /// The approved publication time has passed or was never a valid one.
    Schedule(ScheduleError),
    /// The approved publication time is before the article goes live.
    ScheduleBeforeArticle,
}

impl ApprovalError {
    pub fn code(self) -> &'static str {
        match self {
            Self::Blocked => "release-blocked",
            Self::NothingToUpload => "nothing-to-upload",
            Self::PreviewMismatch => "plan-changed",
            Self::NotApproved => "not-approved",
            Self::PreviewChanged => "preview-changed",
            Self::SourceChanged => "source-changed",
            Self::PolicyChanged => "policy-changed",
            Self::Schedule(error) => error.code(),
            Self::ScheduleBeforeArticle => "time-before-article",
        }
    }

    pub fn message(self) -> &'static str {
        match self {
            Self::Blocked => "The release has blocking problems; fix them and preview it again.",
            Self::NothingToUpload => {
                "The release names a video already on YouTube, so there is no file to upload."
            }
            Self::PreviewMismatch => {
                "That digest is not the current preview's; preview the release again and approve the digest it shows."
            }
            Self::NotApproved => "The release has not been approved; preview it and approve its digest.",
            Self::PreviewChanged => {
                "The release changed since it was approved; preview it again and approve the new digest."
            }
            Self::SourceChanged => {
                "The video file changed since it was approved; preview it again and approve it."
            }
            Self::PolicyChanged => {
                "YouTube's provider policy changed since the approval; preview the release again and approve it."
            }
            Self::Schedule(ScheduleError::TimeTooSoon) => {
                "The publication time is in the past or less than a minute away; approve the release again with a later time."
            }
            Self::Schedule(ScheduleError::TimeTooFar) => {
                "The publication time is more than a year away."
            }
            Self::Schedule(ScheduleError::TimeNeedsZone) => {
                "The publication time must name its zone, such as 2026-11-02T09:00:00Z."
            }
            Self::Schedule(_) => "The publication time is not a valid RFC 3339 date and time.",
            Self::ScheduleBeforeArticle => {
                "The video would become public before the article it links; choose a time at or after the article's date."
            }
        }
    }
}

impl std::fmt::Display for ApprovalError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.message())
    }
}

/// Reads the publication time, an exact future UTC instant no earlier than `not_before` (the
/// article's own date), and returns it as YouTube receives it.
pub fn publication_time(
    input: &str,
    now: DateTime,
    not_before: DateTime,
) -> Result<String, ApprovalError> {
    let at = parse_schedule(input.trim(), now).map_err(ApprovalError::Schedule)?;
    if at.unix() < not_before.unix() {
        return Err(ApprovalError::ScheduleBeforeArticle);
    }
    Ok(at.rfc3339())
}

/// Records the author's approval of exactly `preview`, which must be the one whose digest they
/// were shown, for the file as it is now. Sends nothing.
pub fn approve(
    preview: &VideoPreview,
    digest: &str,
    file: FileFingerprint,
    publish_at: Option<String>,
    approved_at: &str,
) -> Result<VideoApproval, ApprovalError> {
    if preview.status == Status::Blocked {
        return Err(ApprovalError::Blocked);
    }
    if preview.reference.file.is_none() {
        return Err(ApprovalError::NothingToUpload);
    }
    if digest.trim() != preview.digest {
        return Err(ApprovalError::PreviewMismatch);
    }
    Ok(VideoApproval {
        version: APPROVAL_VERSION,
        slug: preview.slug.clone(),
        source_path: preview.source_path.clone(),
        canonical_url: preview.canonical_url.clone(),
        preview_digest: preview.digest.clone(),
        file,
        publish_at,
        manifest: builtin_manifest(ProviderId::Youtube).to_json_value(),
        approved_at: approved_at.to_string(),
    })
}

/// Whether `approval` still covers uploading `preview` from a file that is now `file`, under the
/// current YouTube manifest, at `now`, for an article whose date is now `not_before`. The approved
/// publication time is checked against the article's date again here, since the preview digest
/// does not hold that date and the article may have been moved later since the approval. Checked
/// before a credential is read or a request is sent.
pub fn covers(
    approval: Option<&VideoApproval>,
    preview: &VideoPreview,
    file: &FileFingerprint,
    now: DateTime,
    not_before: DateTime,
) -> Result<(), ApprovalError> {
    if preview.status == Status::Blocked {
        return Err(ApprovalError::Blocked);
    }
    if preview.reference.file.is_none() {
        return Err(ApprovalError::NothingToUpload);
    }
    let approval = approval.ok_or(ApprovalError::NotApproved)?;
    if approval.version != APPROVAL_VERSION
        || approval.slug != preview.slug
        || approval.source_path != preview.source_path
        || approval.canonical_url != preview.canonical_url
        || approval.preview_digest != preview.digest
    {
        return Err(ApprovalError::PreviewChanged);
    }
    if &approval.file != file {
        return Err(ApprovalError::SourceChanged);
    }
    let current = builtin_manifest(ProviderId::Youtube);
    let stands = ProviderManifest::from_value(approval.manifest.clone())
        .is_ok_and(|approved| approval_stands(&approved, &current));
    if !stands {
        return Err(ApprovalError::PolicyChanged);
    }
    if let Some(at) = &approval.publish_at {
        let at = parse_schedule(at, now).map_err(ApprovalError::Schedule)?;
        if at.unix() < not_before.unix() {
            return Err(ApprovalError::ScheduleBeforeArticle);
        }
    }
    Ok(())
}

/// The `video` resource `videos.insert` receives: the previewed title, description and tags, and a
/// status that is always private, with the author's audience and altered-content answers and the
/// approved publication time (<https://developers.google.com/youtube/v3/docs/videos>).
pub fn insert_resource(preview: &VideoPreview, publish_at: Option<&str>) -> Value {
    let mut snippet = json!({
        "title": preview.title,
        "description": preview.description,
    });
    if !preview.tags.is_empty() {
        snippet["tags"] = json!(preview.tags);
    }
    let mut status = json!({ "privacyStatus": "private" });
    if let Some(value) = preview.made_for_kids {
        status["selfDeclaredMadeForKids"] = json!(value);
    }
    if let Some(value) = preview.synthetic_media {
        status["containsSyntheticMedia"] = json!(value);
    }
    if let Some(at) = publish_at {
        status["publishAt"] = json!(at);
    }
    json!({ "snippet": snippet, "status": status })
}

/// What a Google reply that is not a success means for the release.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Failure {
    /// Google is briefly unavailable: retry the same request with back-off.
    Transient,
    /// The access token expired: refresh it once and retry.
    Unauthorized,
    /// The connection no longer works or lacks a permission: connect again.
    Reconnect,
    /// The project's daily API quota is spent; it resets at midnight Pacific Time.
    Quota,
    /// The channel reached its daily upload limit.
    UploadLimit,
    /// Too many requests just now: retry later.
    RateLimited,
    /// The resumable session expired or is unknown.
    SessionGone,
    /// YouTube refused the request; it will refuse it again until something changes.
    Rejected,
}

impl Failure {
    /// Whether retrying later, unchanged, can succeed.
    pub fn retryable(self) -> bool {
        matches!(
            self,
            Self::Transient | Self::Quota | Self::UploadLimit | Self::RateLimited
        )
    }
}

/// Classifies a reply by its status and Google's fixed `reason` codes
/// (<https://developers.google.com/youtube/v3/docs/errors>), returning the failure and a code that
/// names it. Only Google's codes are read, never its message, so nothing the reply echoes back
/// reaches a log.
pub fn classify(status: u16, body: &[u8]) -> (Failure, &'static str) {
    let value: Value = serde_json::from_slice(body).unwrap_or(Value::Null);
    let reasons: Vec<&str> = value["error"]["errors"]
        .as_array()
        .map(|errors| {
            errors
                .iter()
                .filter_map(|error| error["reason"].as_str())
                .collect()
        })
        .unwrap_or_default();
    let has = |reason: &str| reasons.contains(&reason);
    match status {
        500 | 502 | 503 | 504 => (Failure::Transient, "provider-unavailable"),
        429 => (Failure::RateLimited, "rate-limited"),
        404 | 410 => (Failure::SessionGone, "session-expired"),
        401 if has("youtubeSignupRequired") => (Failure::Reconnect, "no-channel"),
        401 => (Failure::Unauthorized, "token-expired"),
        _ if has("quotaExceeded") || has("dailyLimitExceeded") => {
            (Failure::Quota, "quota-exceeded")
        }
        _ if has("uploadLimitExceeded") => (Failure::UploadLimit, "upload-limit-reached"),
        _ if has("rateLimitExceeded")
            || has("userRateLimitExceeded")
            || has("uploadRateLimitExceeded") =>
        {
            (Failure::RateLimited, "rate-limited")
        }
        403 if has("insufficientPermissions") => (Failure::Reconnect, "permission-missing"),
        403 => (Failure::Rejected, "forbidden"),
        _ => (Failure::Rejected, "rejected"),
    }
}

/// How many bytes a `308 Resume Incomplete` reply says arrived, from its `Range: bytes=0-N`
/// header; none means none arrived. A header that is not that shape is `None`.
pub fn received_bytes(range: Option<&str>) -> Option<u64> {
    let Some(range) = range else {
        return Some(0);
    };
    let last = range.trim().strip_prefix("bytes=0-")?;
    last.parse::<u64>().ok().map(|last| last + 1)
}

/// The next chunk to send, as `(first, last)` inclusive byte offsets, after `received` of `total`
/// bytes arrived. `None` when everything has.
pub fn next_chunk(received: u64, total: u64) -> Option<(u64, u64)> {
    (received < total).then(|| (received, (received + UPLOAD_CHUNK_BYTES).min(total) - 1))
}

/// The video id and its watch address from a `videos.insert` success reply.
pub fn inserted_video(body: &[u8]) -> Option<String> {
    let value: Value = serde_json::from_slice(body).ok()?;
    let id = value["id"].as_str()?;
    video_id(id).then(|| id.to_string())
}

/// Whether `id` has the shape of a YouTube video id.
pub fn video_id(id: &str) -> bool {
    id.len() == 11
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

pub fn watch_url(id: &str) -> String {
    format!("https://www.youtube.com/watch?v={id}")
}

/// One upload in the channel's uploads list, as a lookup sees it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Upload {
    pub video_id: String,
    pub title: String,
    pub description: String,
    /// When it was added to the uploads list, as Unix seconds.
    pub published_at: i64,
}

/// What a lookup after an uncertain upload concludes.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LookupOutcome {
    /// Exactly one upload inside the attempt carries exactly the release's title and description.
    Found(String),
    /// The channel has no upload at all inside the attempt, and long enough has passed since the
    /// last byte was sent: nothing was created, and the release may be uploaded again.
    Absent,
    /// Nothing is listed yet, but the attempt is too recent to be sure; look again later.
    TooEarly,
    /// Something inside the attempt may be this release: a person decides.
    NeedsPerson(Vec<String>),
}

/// Decides what the channel's recent uploads say about an attempt that started at `started` and
/// last sent bytes at `last_sent`. Absence is concluded only from an empty window, never from
/// uploads that merely do not match, because the author may have edited the title or description
/// in YouTube Studio since. `complete` is false when the list may hold more uploads than were read.
pub fn lookup(
    uploads: &[Upload],
    complete: bool,
    title: &str,
    description: &str,
    started: i64,
    last_sent: i64,
    now: i64,
) -> LookupOutcome {
    let inside: Vec<&Upload> = uploads
        .iter()
        .filter(|upload| upload.published_at >= started - LOOKUP_SKEW_SECONDS)
        .collect();
    let matching: Vec<&&Upload> = inside
        .iter()
        .filter(|upload| upload.title == title && upload.description == description)
        .collect();
    if matching.len() == 1 && complete {
        return LookupOutcome::Found(matching[0].video_id.clone());
    }
    if inside.is_empty() && complete {
        return if now - last_sent >= LOOKUP_SETTLE_SECONDS {
            LookupOutcome::Absent
        } else {
            LookupOutcome::TooEarly
        };
    }
    LookupOutcome::NeedsPerson(inside.iter().map(|u| u.video_id.clone()).collect())
}

/// Where one release stands with YouTube.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum UploadState {
    /// Nothing was ever sent, or a lookup or a person settled that nothing was created.
    #[default]
    NotUploaded,
    /// A resumable session is open and part of the file has arrived; running again resumes it.
    Uploading,
    /// YouTube created the video; its id is recorded.
    Uploaded,
    /// The whole file may have arrived but the reply was lost and the session is gone: the video
    /// may exist. Nothing is sent again until a lookup or a person settles it.
    Unknown,
    /// YouTube refused the release before creating anything; fix the cause and upload again.
    Failed,
}

impl UploadState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::NotUploaded => "not-uploaded",
            Self::Uploading => "uploading",
            Self::Uploaded => "uploaded",
            Self::Unknown => "unknown",
            Self::Failed => "failed",
        }
    }
}

/// The thumbnail's own state, after the video exists.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ThumbnailState {
    /// The release has no local thumbnail to set.
    #[default]
    None,
    Pending,
    Set,
    Failed,
}

/// One dated entry of a release's history: an event and, for a failure, its fixed code.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub at: String,
    pub event: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
}

/// The private record of one release: its state, the open session, the remote id once known, and
/// a bounded history. It never holds a token, the file's content or the author's words.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct UploadRecord {
    pub state: UploadState,
    pub preview_digest: String,
    pub file: Option<FileFingerprint>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub publish_at: Option<String>,
    /// The resumable session address. Private: it is the upload's handle at Google.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session: Option<String>,
    pub received: u64,
    /// Whether the last chunk was sent, so the video may exist even without a reply.
    pub final_sent: bool,
    pub started_at: i64,
    pub last_sent_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub video_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    pub thumbnail: ThumbnailState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure: Option<String>,
    pub history: Vec<HistoryEntry>,
}

impl UploadRecord {
    pub fn log(&mut self, at: DateTime, event: &str, code: Option<&str>) {
        self.history.push(HistoryEntry {
            at: at.rfc3339(),
            event: event.to_string(),
            code: code.map(str::to_string),
        });
        if self.history.len() > HISTORY_LIMIT {
            let excess = self.history.len() - HISTORY_LIMIT;
            self.history.drain(..excess);
        }
    }

    /// Records the created video and forgets the session.
    pub fn uploaded(&mut self, at: DateTime, id: &str, event: &str) {
        self.state = UploadState::Uploaded;
        self.video_id = Some(id.to_string());
        self.url = Some(watch_url(id));
        self.session = None;
        self.failure = None;
        self.log(at, event, None);
    }

    /// The record as `--status` shows it: everything but the session address.
    pub fn public_view(&self) -> Value {
        let mut value = serde_json::to_value(self).unwrap_or(Value::Null);
        if let Some(object) = value.as_object_mut() {
            object.remove("session");
            object.insert("sessionOpen".into(), Value::Bool(self.session.is_some()));
        }
        value
    }
}

/// How a person settles an `unknown` release after looking in YouTube Studio.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Settlement {
    Uploaded(String),
    NotUploaded,
}

/// Reads `--settle uploaded:<video id>` or `--settle not-uploaded`.
pub fn settlement(input: &str) -> Option<Settlement> {
    match input.trim() {
        "not-uploaded" => Some(Settlement::NotUploaded),
        other => {
            let id = other.strip_prefix("uploaded:")?;
            video_id(id).then(|| Settlement::Uploaded(id.to_string()))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn google_reasons_become_fixed_failure_states() {
        let reason = |r: &str| {
            format!("{{\"error\":{{\"code\":403,\"errors\":[{{\"reason\":\"{r}\",\"message\":\"secret words\"}}]}}}}")
        };
        assert_eq!(
            classify(403, reason("quotaExceeded").as_bytes()),
            (Failure::Quota, "quota-exceeded")
        );
        assert_eq!(
            classify(400, reason("uploadLimitExceeded").as_bytes()),
            (Failure::UploadLimit, "upload-limit-reached")
        );
        assert_eq!(
            classify(403, reason("insufficientPermissions").as_bytes()),
            (Failure::Reconnect, "permission-missing")
        );
        assert_eq!(
            classify(401, reason("youtubeSignupRequired").as_bytes()),
            (Failure::Reconnect, "no-channel")
        );
        assert_eq!(classify(401, b"").0, Failure::Unauthorized);
        assert_eq!(classify(503, b"<html>").0, Failure::Transient);
        assert_eq!(classify(429, b"").0, Failure::RateLimited);
        assert_eq!(classify(404, b"").0, Failure::SessionGone);
        assert_eq!(
            classify(400, reason("invalidTitle").as_bytes()),
            (Failure::Rejected, "rejected")
        );
        assert!(Failure::Quota.retryable() && !Failure::Rejected.retryable());
    }

    #[test]
    fn resumable_ranges_are_read_and_chunks_follow_them() {
        assert_eq!(received_bytes(None), Some(0));
        assert_eq!(received_bytes(Some("bytes=0-8388607")), Some(8_388_608));
        assert_eq!(received_bytes(Some("bytes=5-9")), None);
        assert_eq!(received_bytes(Some("garbage")), None);
        assert_eq!(UPLOAD_CHUNK_BYTES % (256 * 1024), 0);
        assert_eq!(next_chunk(0, 10), Some((0, 9)));
        assert_eq!(
            next_chunk(0, UPLOAD_CHUNK_BYTES * 2),
            Some((0, UPLOAD_CHUNK_BYTES - 1))
        );
        assert_eq!(next_chunk(10, 10), None);
    }

    fn upload(id: &str, title: &str, at: i64) -> Upload {
        Upload {
            video_id: id.into(),
            title: title.into(),
            description: "d".into(),
            published_at: at,
        }
    }

    #[test]
    fn a_lookup_concludes_absence_only_from_an_empty_settled_window() {
        let start = 1_000_000;
        let old = upload("aaaaaaaaaaa", "Episode", start - 3600);
        let late = start + LOOKUP_SETTLE_SECONDS + 1;
        assert_eq!(
            lookup(
                std::slice::from_ref(&old),
                true,
                "Episode",
                "d",
                start,
                start,
                late
            ),
            LookupOutcome::Absent
        );
        assert_eq!(
            lookup(&[], true, "Episode", "d", start, start, start + 60),
            LookupOutcome::TooEarly
        );
        assert_eq!(
            lookup(&[], false, "Episode", "d", start, start, late),
            LookupOutcome::NeedsPerson(vec![])
        );
        let mine = upload("bbbbbbbbbbb", "Episode", start + 30);
        assert_eq!(
            lookup(
                &[mine.clone(), old],
                true,
                "Episode",
                "d",
                start,
                start,
                late
            ),
            LookupOutcome::Found("bbbbbbbbbbb".into())
        );
        // An upload inside the attempt that does not match is never read as absence.
        let edited = upload("ccccccccccc", "Episode (edited)", start + 30);
        assert_eq!(
            lookup(&[edited], true, "Episode", "d", start, start, late),
            LookupOutcome::NeedsPerson(vec!["ccccccccccc".into()])
        );
        let twin = upload("ddddddddddd", "Episode", start + 40);
        assert_eq!(
            lookup(&[mine, twin], true, "Episode", "d", start, start, late),
            LookupOutcome::NeedsPerson(vec!["bbbbbbbbbbb".into(), "ddddddddddd".into()])
        );
    }

    #[test]
    fn a_settlement_names_a_video_id_or_nothing() {
        assert_eq!(
            settlement("uploaded:dQw4w9WgXcQ"),
            Some(Settlement::Uploaded("dQw4w9WgXcQ".into()))
        );
        assert_eq!(settlement("not-uploaded"), Some(Settlement::NotUploaded));
        assert_eq!(settlement("uploaded:short"), None);
        assert_eq!(settlement("posted"), None);
    }

    #[test]
    fn the_history_is_bounded_and_the_session_is_never_shown() {
        let mut record = UploadRecord {
            session: Some("https://upload.example/session?upload_id=secret".into()),
            ..UploadRecord::default()
        };
        for _ in 0..(HISTORY_LIMIT + 5) {
            record.log(DateTime::from_unix(0), "attempt", None);
        }
        assert_eq!(record.history.len(), HISTORY_LIMIT);
        let view = record.public_view().to_string();
        assert!(!view.contains("secret"));
        assert!(view.contains("\"sessionOpen\":true"));
        record.uploaded(DateTime::from_unix(1), "dQw4w9WgXcQ", "uploaded");
        assert_eq!(record.session, None);
        assert_eq!(
            record.url.as_deref(),
            Some("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
        );
    }

    #[test]
    fn inserted_video_reads_only_a_well_formed_id() {
        assert_eq!(
            inserted_video(br#"{"id":"dQw4w9WgXcQ","kind":"youtube#video"}"#),
            Some("dQw4w9WgXcQ".into())
        );
        assert_eq!(inserted_video(br#"{"id":"../../x"}"#), None);
        assert_eq!(inserted_video(b"nope"), None);
    }
}
