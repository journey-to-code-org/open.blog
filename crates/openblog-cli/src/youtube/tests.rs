//! The YouTube adapter over a scripted Google: every test uses a fake transport and never reaches
//! a real provider.

use std::cell::RefCell;
use std::collections::VecDeque;

use serde_json::json;

use super::*;
use crate::video_release;

const VIDEO_ID: &str = "dQw4w9WgXcQ";
const SESSION: &str =
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&upload_id=abc123";

struct Script {
    replies: RefCell<VecDeque<Result<Reply, NoReply>>>,
    sent: RefCell<Vec<Request>>,
}

impl Script {
    fn new(replies: Vec<Result<Reply, NoReply>>) -> Self {
        Self {
            replies: RefCell::new(replies.into()),
            sent: RefCell::new(Vec::new()),
        }
    }

    fn urls(&self) -> Vec<String> {
        self.sent
            .borrow()
            .iter()
            .map(|r| {
                let short = r.url.split('?').next().unwrap_or_default();
                format!("{} {short}", r.method)
            })
            .collect()
    }
}

impl Transport for Script {
    fn send(&self, request: &Request) -> Result<Reply, NoReply> {
        self.sent.borrow_mut().push(request.clone());
        self.replies
            .borrow_mut()
            .pop_front()
            .expect("the script has a reply for every request")
    }
}

fn reply(status: u16, body: &str) -> Result<Reply, NoReply> {
    Ok(Reply {
        status,
        headers: Vec::new(),
        body: body.as_bytes().to_vec(),
    })
}

fn with_header(status: u16, name: &str, value: &str) -> Result<Reply, NoReply> {
    Ok(Reply {
        status,
        headers: vec![(name.to_string(), value.to_string())],
        body: Vec::new(),
    })
}

fn token() -> Result<Reply, NoReply> {
    reply(200, r#"{"access_token":"ya29.access","expires_in":3599}"#)
}

fn session() -> Result<Reply, NoReply> {
    with_header(200, "Location", SESSION)
}

fn created() -> Result<Reply, NoReply> {
    reply(
        201,
        &format!(r#"{{"id":"{VIDEO_ID}","kind":"youtube#video"}}"#),
    )
}

fn google_error(status: u16, reason: &str) -> Result<Reply, NoReply> {
    reply(
        status,
        &format!(
            r#"{{"error":{{"code":{status},"message":"private words","errors":[{{"reason":"{reason}"}}]}}}}"#
        ),
    )
}

fn client() -> Client {
    Client {
        id: "client-123.apps.googleusercontent.com".into(),
        secret: Some("client-secret".into()),
    }
}

fn env<'a>(transport: &'a Script, now: &'a dyn Fn() -> DateTime) -> Env<'a> {
    Env {
        transport,
        now,
        sleep: &|_| {},
        client: Some(client()),
    }
}

fn real_now() -> DateTime {
    crate::clock::now()
}

fn project(tag: &str, video_bytes: usize) -> PathBuf {
    let root = std::env::temp_dir().join(format!(
        "openblog-youtube-{tag}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::create_dir_all(root.join("content/posts")).unwrap();
    fs::create_dir_all(root.join("static/images")).unwrap();
    fs::create_dir_all(root.join("media")).unwrap();
    fs::write(
        root.join("openblog.json"),
        "{\"title\":\"Studio\",\"url\":\"https://studio.example.org\"}",
    )
    .unwrap();
    let mut png = b"\x89PNG\r\n\x1a\n\0\0\0\x0dIHDR".to_vec();
    png.extend(1280u32.to_be_bytes());
    png.extend(720u32.to_be_bytes());
    png.extend([8, 6, 0, 0, 0]);
    fs::write(root.join("static/images/episode.png"), &png).unwrap();
    let mut video = b"\0\0\0\x20ftypisom\0\0\0\0".to_vec();
    video.resize(video_bytes, 7);
    fs::write(root.join("media/episode.mp4"), &video).unwrap();
    fs::write(
        root.join("media/episode.en.vtt"),
        "WEBVTT\n\n00:00.000 --> 00:02.000\nThe gate opens.\n",
    )
    .unwrap();
    post(&root, false);
    root
}

fn post(root: &Path, draft: bool) {
    fs::write(
        root.join("content/posts/2026-10-01-episode.md"),
        format!("---\ntitle: Episode one\ndate: 2026-10-01\ndescription: A walk to the gate.\nprofile: video\ndraft: {draft}\ntags:\n  - animation\nduration: 3 min\nthumbnail: /images/episode.png\nvideoFile: media/episode.mp4\nvideoTitle: Episode one\ncaptions: media/episode.en.vtt\nvideoRights: owned\nvideoPeople: none\nmadeForKids: no\nsyntheticMedia: no\n---\nIntro.\n\n## Chapters\n\n00:00 Road\n00:42 Ash\n01:36 Gate\n\n## Transcript\n\n**Narrator:** The gate opens.\n"),
    )
    .unwrap();
}

fn connected(root: &Path) {
    let grant = Grant {
        version: 1,
        refresh_token: "1//refresh-secret".into(),
        scopes: video_upload::SCOPES.iter().map(|s| s.to_string()).collect(),
        client: client().fingerprint(),
        connected_at: "2026-10-29T00:00:00Z".into(),
    };
    write_protected(
        &private_path(root, CREDENTIAL_FILE).unwrap(),
        &serde_json::to_vec(&grant).unwrap(),
        "credential",
    )
    .unwrap();
}

fn approved(root: &Path) -> Prepared {
    let prepared = video_release::prepare(root, "episode").unwrap();
    approve_at(
        root,
        &prepared,
        &prepared.preview.digest.clone(),
        None,
        real_now(),
    )
    .unwrap();
    prepared
}

fn ready(tag: &str, video_bytes: usize) -> (PathBuf, Prepared) {
    let root = project(tag, video_bytes);
    connected(&root);
    let prepared = approved(&root);
    (root, prepared)
}

fn record(root: &Path) -> UploadRecord {
    load_record(root, "episode").unwrap()
}

fn code(error: &str) -> &str {
    error
        .strip_prefix('[')
        .and_then(|rest| rest.split(']').next())
        .unwrap_or(error)
}

#[test]
fn an_approved_release_uploads_private_with_the_previewed_metadata_then_sets_the_thumbnail() {
    let (root, prepared) = ready("happy", 64);
    let script = Script::new(vec![token(), session(), created(), reply(200, "{}")]);
    upload_with(&root, &prepared, &env(&script, &real_now)).unwrap();
    assert_eq!(
        script.urls(),
        [
            "POST https://oauth2.googleapis.com/token",
            "POST https://www.googleapis.com/upload/youtube/v3/videos",
            "PUT https://www.googleapis.com/upload/youtube/v3/videos",
            "POST https://www.googleapis.com/upload/youtube/v3/thumbnails/set",
        ]
    );
    let sent = script.sent.borrow();
    let refresh = String::from_utf8(sent[0].body.clone()).unwrap();
    assert!(refresh.contains("grant_type=refresh_token"));
    let resource: Value = serde_json::from_slice(&sent[1].body).unwrap();
    assert_eq!(resource["status"]["privacyStatus"], "private");
    assert_eq!(resource["status"]["selfDeclaredMadeForKids"], false);
    assert_eq!(resource["status"]["containsSyntheticMedia"], false);
    assert!(resource["status"].get("publishAt").is_none());
    assert_eq!(resource["snippet"]["title"], prepared.preview.title);
    assert_eq!(
        resource["snippet"]["description"],
        prepared.preview.description
    );
    assert_eq!(resource["snippet"]["tags"], json!(["animation"]));
    assert!(sent[1]
        .headers
        .contains(&("X-Upload-Content-Length", "64".to_string())));
    assert!(sent[1]
        .headers
        .contains(&("Authorization", "Bearer ya29.access".to_string())));
    assert_eq!(sent[2].url, SESSION);
    assert_eq!(
        sent[2].body,
        fs::read(root.join("media/episode.mp4")).unwrap()
    );
    assert!(sent[2]
        .headers
        .contains(&("Content-Range", "bytes 0-63/64".to_string())));
    assert!(sent[3].url.contains(&format!("videoId={VIDEO_ID}")));
    assert!(sent[3]
        .headers
        .contains(&("Content-Type", "image/png".to_string())));
    drop(sent);

    let done = record(&root);
    assert_eq!(done.state, UploadState::Uploaded);
    assert_eq!(done.video_id.as_deref(), Some(VIDEO_ID));
    assert_eq!(
        done.url.as_deref(),
        Some("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
    );
    assert_eq!(done.thumbnail, ThumbnailState::Set);
    assert_eq!(done.session, None);
    // The record never holds a token, and on Windows it is not even readable as text.
    let stored = fs::read(private_path(&root, RECORDS_FILE).unwrap()).unwrap();
    let text = String::from_utf8_lossy(&stored);
    assert!(!text.contains("ya29") && !text.contains("refresh-secret"));
    let credential = fs::read(private_path(&root, CREDENTIAL_FILE).unwrap()).unwrap();
    if cfg!(windows) {
        assert!(!String::from_utf8_lossy(&credential).contains("refresh-secret"));
    }

    // Running again sends nothing: the video is recorded.
    let again = Script::new(vec![]);
    upload_with(&root, &prepared, &env(&again, &real_now)).unwrap();
    assert!(again.sent.borrow().is_empty());
}

#[test]
fn nothing_is_sent_without_a_client_a_connection_an_approval_or_the_approved_file() {
    // Off: no OAuth client in the environment.
    let (root, prepared) = ready("off", 32);
    let script = Script::new(vec![]);
    let mut off = env(&script, &real_now);
    off.client = None;
    let error = upload_with(&root, &prepared, &off).unwrap_err();
    assert_eq!(code(&error), "youtube-not-configured");
    assert!(error.contains("Nothing was sent") && error.contains("--preview"));

    // Not connected.
    fs::remove_file(private_path(&root, CREDENTIAL_FILE).unwrap()).unwrap();
    let error = upload_with(&root, &prepared, &env(&script, &real_now)).unwrap_err();
    assert_eq!(code(&error), "youtube-not-connected");

    // Not approved.
    let root = project("unapproved", 32);
    connected(&root);
    let prepared = video_release::prepare(&root, "episode").unwrap();
    let error = upload_with(&root, &prepared, &env(&script, &real_now)).unwrap_err();
    assert_eq!(code(&error), "not-approved");

    // A file replaced after the approval.
    let (root, _) = ready("swapped", 32);
    let mut other = fs::read(root.join("media/episode.mp4")).unwrap();
    other[31] = 9;
    fs::write(root.join("media/episode.mp4"), other).unwrap();
    let prepared = video_release::prepare(&root, "episode").unwrap();
    let error = upload_with(&root, &prepared, &env(&script, &real_now)).unwrap_err();
    assert_eq!(code(&error), "source-changed");

    // A release edited after the approval.
    let (root, _) = ready("edited", 32);
    let source = root.join("content/posts/2026-10-01-episode.md");
    let edited = fs::read_to_string(&source).unwrap().replace(
        "videoTitle: Episode one",
        "videoTitle: Episode one, revised",
    );
    fs::write(&source, edited).unwrap();
    let prepared = video_release::prepare(&root, "episode").unwrap();
    let error = upload_with(&root, &prepared, &env(&script, &real_now)).unwrap_err();
    assert_eq!(code(&error), "preview-changed");

    // A draft article.
    let (root, _) = ready("draft", 32);
    post(&root, true);
    let prepared = video_release::prepare(&root, "episode").unwrap();
    let error = upload_with(&root, &prepared, &env(&script, &real_now)).unwrap_err();
    assert_eq!(code(&error), "article-draft");

    assert!(script.sent.borrow().is_empty(), "{:?}", script.urls());
}

#[test]
fn an_approval_binds_the_digest_a_public_canonical_address_and_a_time_after_the_article() {
    let root = project("approve", 32);
    let prepared = video_release::prepare(&root, "episode").unwrap();
    let now = DateTime::parse("2026-10-29T12:00:00Z").unwrap();
    let error = approve_at(&root, &prepared, "0000", None, now).unwrap_err();
    assert_eq!(code(&error), "plan-changed");
    let digest = prepared.preview.digest.clone();
    let error =
        approve_at(&root, &prepared, &digest, Some("2026-10-29T12:00:30Z"), now).unwrap_err();
    assert_eq!(code(&error), "time-too-soon");
    let error = approve_at(&root, &prepared, &digest, Some("next tuesday"), now).unwrap_err();
    assert_eq!(code(&error), "time-invalid");
    approve_at(
        &root,
        &prepared,
        &digest,
        Some("2026-11-02T09:00:00+01:00"),
        now,
    )
    .unwrap();
    let approvals = load_approvals(&root).unwrap();
    let approval = &approvals.approvals["episode"];
    assert_eq!(approval.publish_at.as_deref(), Some("2026-11-02T08:00:00Z"));
    assert_eq!(approval.file.bytes, 32);
    assert_eq!(approval.manifest["policyVersion"], "2026-10-29.2");

    // The video may not go public before the article it links.
    let late = Prepared {
        post_date: DateTime::parse("2026-12-01T00:00:00Z").unwrap(),
        ..video_release::prepare(&root, "episode").unwrap()
    };
    let error = approve_at(&root, &late, &digest, Some("2026-11-02T09:00:00Z"), now).unwrap_err();
    assert_eq!(code(&error), "time-before-article");

    // A site still at its example address cannot be linked from YouTube.
    fs::write(
        root.join("openblog.json"),
        "{\"title\":\"Studio\",\"url\":\"https://example.com\"}",
    )
    .unwrap();
    let local = video_release::prepare(&root, "episode").unwrap();
    let error = approve_at(&root, &local, &local.preview.digest.clone(), None, now).unwrap_err();
    assert_eq!(code(&error), "canonical-not-public");
}

#[test]
fn a_scheduled_release_sends_publish_at_and_stays_private_until_then() {
    let root = project("scheduled", 32);
    connected(&root);
    let prepared = video_release::prepare(&root, "episode").unwrap();
    let at = DateTime::from_unix(real_now().unix() + 86_400).rfc3339();
    approve_at(
        &root,
        &prepared,
        &prepared.preview.digest.clone(),
        Some(&at),
        real_now(),
    )
    .unwrap();
    let script = Script::new(vec![token(), session(), created(), reply(200, "{}")]);
    upload_with(&root, &prepared, &env(&script, &real_now)).unwrap();
    let resource: Value = serde_json::from_slice(&script.sent.borrow()[1].body).unwrap();
    assert_eq!(resource["status"]["privacyStatus"], "private");
    assert_eq!(resource["status"]["publishAt"], at);
    assert_eq!(record(&root).publish_at.as_deref(), Some(at.as_str()));
}

#[test]
fn an_article_moved_after_the_approved_time_refuses_the_upload_and_sends_nothing() {
    let root = project("moved", 32);
    connected(&root);
    let prepared = video_release::prepare(&root, "episode").unwrap();
    let at = DateTime::from_unix(real_now().unix() + 86_400);
    approve_at(
        &root,
        &prepared,
        &prepared.preview.digest.clone(),
        Some(&at.rfc3339()),
        real_now(),
    )
    .unwrap();

    // The author moves the article to two days after the approved publication time. The preview
    // digest does not hold the date, so the approval still matches the preview.
    let path = root.join("content/posts/2026-10-01-episode.md");
    let later = DateTime::from_unix(at.unix() + 2 * 86_400).rfc3339();
    let text = fs::read_to_string(&path)
        .unwrap()
        .replace("date: 2026-10-01", &format!("date: {}", &later[..10]));
    fs::write(&path, text).unwrap();
    let moved = video_release::prepare(&root, "episode").unwrap();
    assert_eq!(moved.preview.digest, prepared.preview.digest);
    assert!(moved.post_date.unix() > at.unix());

    let script = Script::new(vec![token(), session(), created(), reply(200, "{}")]);
    let error = upload_with(&root, &moved, &env(&script, &real_now)).unwrap_err();
    assert_eq!(code(&error), "time-before-article");
    assert!(script.sent.borrow().is_empty(), "{:?}", script.urls());
    assert_eq!(record(&root).state, UploadState::NotUploaded);
}

#[test]
fn a_lost_reply_to_the_last_chunk_is_asked_about_never_sent_twice() {
    let (root, prepared) = ready("lost-final", 64);
    let script = Script::new(vec![
        token(),
        session(),
        Err(NoReply),
        created(),
        reply(200, "{}"),
    ]);
    upload_with(&root, &prepared, &env(&script, &real_now)).unwrap();
    let sent = script.sent.borrow();
    assert_eq!(sent.len(), 5);
    assert_eq!(sent[3].method, "PUT");
    assert!(
        sent[3].body.is_empty(),
        "the session is asked, not sent the bytes again"
    );
    assert!(sent[3]
        .headers
        .contains(&("Content-Range", "bytes */64".to_string())));
    assert_eq!(record(&root).state, UploadState::Uploaded);
}

#[test]
fn a_large_file_goes_in_chunks_and_resumes_in_a_later_run_where_it_stopped() {
    let total = video_upload::UPLOAD_CHUNK_BYTES as usize + 100;
    let (root, prepared) = ready("chunks", total);
    let first_end = video_upload::UPLOAD_CHUNK_BYTES - 1;
    let mut replies = vec![
        token(),
        session(),
        with_header(308, "Range", &format!("bytes=0-{first_end}")),
        Err(NoReply),
    ];
    // The second chunk's reply is lost, and the session does not answer either.
    replies.extend((0..MAX_ATTEMPTS * MAX_ATTEMPTS).map(|_| Err(NoReply)));
    let script = Script::new(replies);
    let error = upload_with(&root, &prepared, &env(&script, &real_now)).unwrap_err();
    assert_eq!(code(&error), "provider-unavailable");
    let kept = record(&root);
    assert_eq!(kept.state, UploadState::Uploading);
    assert_eq!(kept.received, video_upload::UPLOAD_CHUNK_BYTES);
    assert!(kept.final_sent, "the last chunk may have arrived");
    assert!(kept.session.is_some());
    assert_eq!(
        fs::read_dir(root.join(".openblog/private/youtube"))
            .unwrap()
            .filter(|e| e.as_ref().unwrap().file_name() == "upload.lock")
            .count(),
        0
    );

    // The next run asks the session first, sends only the rest, and opens no new session.
    let script = Script::new(vec![
        token(),
        with_header(308, "Range", &format!("bytes=0-{first_end}")),
        created(),
        reply(200, "{}"),
    ]);
    upload_with(&root, &prepared, &env(&script, &real_now)).unwrap();
    let sent = script.sent.borrow();
    assert!(sent.iter().all(|r| !r.url.ends_with("part=snippet,status")));
    assert!(sent[1].body.is_empty());
    assert_eq!(sent[2].body.len(), 100);
    assert!(sent[2].headers.contains(&(
        "Content-Range",
        format!("bytes {}-{}/{total}", first_end + 1, total - 1)
    )));
    assert_eq!(record(&root).state, UploadState::Uploaded);
}

#[test]
fn an_expired_token_is_refreshed_once_and_a_revoked_grant_asks_to_connect_again() {
    let (root, prepared) = ready("refresh", 32);
    let script = Script::new(vec![
        token(),
        session(),
        google_error(401, "authError"),
        token(),
        with_header(308, "Range", "bytes=0-9"),
        created(),
        reply(200, "{}"),
    ]);
    upload_with(&root, &prepared, &env(&script, &real_now)).unwrap();
    let sent = script.sent.borrow();
    assert!(sent[5]
        .headers
        .contains(&("Content-Range", "bytes 10-31/32".to_string())));
    drop(sent);

    let (root, prepared) = ready("revoked", 32);
    let script = Script::new(vec![reply(400, r#"{"error":"invalid_grant"}"#)]);
    let error = upload_with(&root, &prepared, &env(&script, &real_now)).unwrap_err();
    assert_eq!(code(&error), "grant-revoked");
    assert_eq!(script.sent.borrow().len(), 1);
    assert_eq!(record(&root).state, UploadState::NotUploaded);
}

#[test]
fn quota_limits_and_refusals_are_reliable_states_and_never_echo_googles_words() {
    let (root, prepared) = ready("quota", 32);
    let script = Script::new(vec![token(), google_error(403, "quotaExceeded")]);
    let error = upload_with(&root, &prepared, &env(&script, &real_now)).unwrap_err();
    assert_eq!(code(&error), "quota-exceeded");
    assert!(error.contains("midnight Pacific Time") && !error.contains("private words"));
    let stopped = record(&root);
    assert_eq!(stopped.state, UploadState::NotUploaded);
    assert_eq!(stopped.failure.as_deref(), Some("quota-exceeded"));

    // Quota spent part-way: the session is kept to resume tomorrow.
    let (root, prepared) = ready("quota-mid", 32);
    let script = Script::new(vec![token(), session(), google_error(403, "quotaExceeded")]);
    let error = upload_with(&root, &prepared, &env(&script, &real_now)).unwrap_err();
    assert!(error.contains("resumes where it stopped"));
    let kept = record(&root);
    assert_eq!(kept.state, UploadState::Uploading);
    assert!(!kept.final_sent);
    assert!(kept.session.is_some());

    let (root, prepared) = ready("limit", 32);
    let script = Script::new(vec![token(), google_error(400, "uploadLimitExceeded")]);
    let error = upload_with(&root, &prepared, &env(&script, &real_now)).unwrap_err();
    assert_eq!(code(&error), "upload-limit-reached");

    let (root, prepared) = ready("rejected", 32);
    let script = Script::new(vec![token(), google_error(400, "invalidTitle")]);
    let error = upload_with(&root, &prepared, &env(&script, &real_now)).unwrap_err();
    assert_eq!(code(&error), "rejected");
    assert_eq!(record(&root).state, UploadState::Failed);

    // A 5xx while opening the session is retried with back-off: no video exists yet.
    let (root, prepared) = ready("flaky", 32);
    let script = Script::new(vec![
        token(),
        reply(503, ""),
        Err(NoReply),
        session(),
        created(),
        reply(200, "{}"),
    ]);
    upload_with(&root, &prepared, &env(&script, &real_now)).unwrap();
    assert_eq!(record(&root).state, UploadState::Uploaded);
}

#[test]
fn a_session_that_disappears_after_the_last_byte_is_unknown_until_looked_up_or_settled() {
    let (root, prepared) = ready("unknown", 32);
    let start = real_now().unix();
    let script = Script::new(vec![token(), session(), Err(NoReply), reply(404, "")]);
    let error = upload_with(&root, &prepared, &env(&script, &real_now)).unwrap_err();
    assert_eq!(code(&error), "upload-unknown");
    assert_eq!(record(&root).state, UploadState::Unknown);

    // No new upload while unknown.
    let none = Script::new(vec![]);
    let error = upload_with(&root, &prepared, &env(&none, &real_now)).unwrap_err();
    assert_eq!(code(&error), "upload-unknown");
    assert!(none.sent.borrow().is_empty());

    let channels = reply(
        200,
        r#"{"items":[{"contentDetails":{"relatedPlaylists":{"uploads":"UUchannel"}}}]}"#,
    );
    let item = |id: &str, title: &str, description: &str, at: i64| {
        json!({"snippet": {
            "title": title,
            "description": description,
            "publishedAt": DateTime::from_unix(at).rfc3339(),
            "resourceId": {"videoId": id}
        }})
    };
    let older = item("aaaaaaaaaaa", "Old", "", start - 86_400);

    // Too soon to conclude absence from an empty window.
    let soon = || DateTime::from_unix(start + 60);
    let script = Script::new(vec![
        token(),
        channels.clone(),
        reply(200, &json!({"items": [older.clone()]}).to_string()),
    ]);
    let error = lookup_with(&root, &prepared, &env(&script, &soon)).unwrap_err();
    assert_eq!(code(&error), "lookup-too-early");
    assert!(script.sent.borrow()[2].url.contains("playlistId=UUchannel"));

    // An edited upload inside the window is never read as absence.
    let later = || DateTime::from_unix(start + 3_600);
    let edited = item("eeeeeeeeeee", "Episode one (edited)", "", start + 5);
    let script = Script::new(vec![
        token(),
        channels.clone(),
        reply(200, &json!({"items": [edited, older.clone()]}).to_string()),
    ]);
    let error = lookup_with(&root, &prepared, &env(&script, &later)).unwrap_err();
    assert_eq!(code(&error), "needs-person");
    assert!(error.contains("eeeeeeeeeee"));
    assert_eq!(record(&root).state, UploadState::Unknown);

    // Exactly the release, inside the window: found and recorded.
    let mine = item(
        VIDEO_ID,
        &prepared.preview.title,
        &prepared.preview.description,
        start + 5,
    );
    let script = Script::new(vec![
        token(),
        channels.clone(),
        reply(200, &json!({"items": [mine, older.clone()]}).to_string()),
    ]);
    lookup_with(&root, &prepared, &env(&script, &later)).unwrap();
    let found = record(&root);
    assert_eq!(found.state, UploadState::Uploaded);
    assert_eq!(found.video_id.as_deref(), Some(VIDEO_ID));
    assert_eq!(found.thumbnail, ThumbnailState::Pending);
    // The next upload run only sets the thumbnail.
    let script = Script::new(vec![token(), reply(200, "{}")]);
    upload_with(&root, &prepared, &env(&script, &real_now)).unwrap();
    assert_eq!(
        script.urls()[1],
        "POST https://www.googleapis.com/upload/youtube/v3/thumbnails/set"
    );
    assert_eq!(record(&root).thumbnail, ThumbnailState::Set);
}

#[test]
fn an_empty_settled_window_means_not_uploaded_and_a_person_can_settle_either_way() {
    let (root, prepared) = ready("absent", 32);
    let start = real_now().unix();
    let script = Script::new(vec![token(), session(), Err(NoReply), reply(410, "")]);
    upload_with(&root, &prepared, &env(&script, &real_now)).unwrap_err();
    let later = || DateTime::from_unix(start + 3_600);
    let script = Script::new(vec![
        token(),
        reply(
            200,
            r#"{"items":[{"contentDetails":{"relatedPlaylists":{"uploads":"UUchannel"}}}]}"#,
        ),
        reply(200, r#"{"items":[]}"#),
    ]);
    lookup_with(&root, &prepared, &env(&script, &later)).unwrap();
    assert_eq!(record(&root).state, UploadState::NotUploaded);
    let error = settle_at(&root, "episode", "not-uploaded", later()).unwrap_err();
    assert_eq!(code(&error), "not-unknown");

    let (root, prepared) = ready("settle", 32);
    let script = Script::new(vec![token(), session(), Err(NoReply), reply(404, "")]);
    upload_with(&root, &prepared, &env(&script, &real_now)).unwrap_err();
    assert!(settle_at(&root, "episode", "uploaded:nope", later()).is_err());
    settle_at(&root, "episode", &format!("uploaded:{VIDEO_ID}"), later()).unwrap();
    let settled = record(&root);
    assert_eq!(settled.state, UploadState::Uploaded);
    assert_eq!(settled.history.last().unwrap().event, "settled-uploaded");
}

#[test]
fn a_refused_thumbnail_leaves_the_video_uploaded_and_is_retried_alone() {
    let (root, prepared) = ready("thumbnail", 32);
    let script = Script::new(vec![
        token(),
        session(),
        created(),
        google_error(403, "forbidden"),
    ]);
    upload_with(&root, &prepared, &env(&script, &real_now)).unwrap();
    let done = record(&root);
    assert_eq!(done.state, UploadState::Uploaded);
    assert_eq!(done.thumbnail, ThumbnailState::Failed);
    let script = Script::new(vec![token(), reply(200, "{}")]);
    upload_with(&root, &prepared, &env(&script, &real_now)).unwrap();
    assert_eq!(script.sent.borrow().len(), 2);
    assert_eq!(record(&root).thumbnail, ThumbnailState::Set);
}

#[test]
fn a_session_address_off_googles_upload_origin_is_never_followed() {
    let (root, prepared) = ready("redirect", 32);
    let script = Script::new(vec![
        token(),
        with_header(
            200,
            "Location",
            "https://attacker.example/upload?upload_id=1",
        ),
    ]);
    let error = upload_with(&root, &prepared, &env(&script, &real_now)).unwrap_err();
    assert_eq!(code(&error), "session-unreadable");
    assert_eq!(script.sent.borrow().len(), 2);
}

#[test]
fn pkce_and_the_authorization_address_follow_googles_installed_app_flow() {
    // BASE64URL(SHA-256(verifier)) without padding (RFC 7636, section 4.2).
    assert_eq!(
        pkce_challenge("dBjftJeZ4CVP-mJ92K27uhbUJU1p1r_wW1gFWFOEjXk"),
        "ngF5GsXcbwljx6u133FFr3Xht9xooA_DuaX_3QwODtc"
    );
    let url = authorization_url(&client(), "http://127.0.0.1:5000", "challenge", "state-1");
    let parsed = url::Url::parse(&url).unwrap();
    assert_eq!(parsed.host_str(), Some("accounts.google.com"));
    let pairs: std::collections::HashMap<_, _> = parsed.query_pairs().into_owned().collect();
    assert_eq!(pairs["code_challenge_method"], "S256");
    assert_eq!(pairs["redirect_uri"], "http://127.0.0.1:5000");
    assert_eq!(pairs["scope"], video_upload::SCOPES.join(" "));
    assert_eq!(pairs["state"], "state-1");
    assert!(!url.contains("client-secret"));

    assert_eq!(
        parse_callback("GET /favicon.ico HTTP/1.1", "s"),
        Callback::Other
    );
    assert_eq!(
        parse_callback("GET /?state=s&code=4%2Fabc HTTP/1.1", "s"),
        Callback::Code("4/abc".into())
    );
    assert_eq!(
        parse_callback("GET /?state=other&code=x HTTP/1.1", "s"),
        Callback::Forged
    );
    assert_eq!(
        parse_callback("GET /?state=s&error=access_denied HTTP/1.1", "s"),
        Callback::Denied
    );
    assert_eq!(
        parse_callback("POST /?state=s&code=x HTTP/1.1", "s"),
        Callback::Other
    );
}

/// Plays the browser: follows the authorization address's redirect to the loopback listener.
fn browser(redirect_query: impl Fn(&str) -> String + Send + 'static) -> impl FnMut(&str) {
    move |url: &str| {
        let parsed = url::Url::parse(url).unwrap();
        let pairs: std::collections::HashMap<_, _> = parsed.query_pairs().into_owned().collect();
        let redirect = pairs["redirect_uri"].clone();
        let query = redirect_query(&pairs["state"]);
        std::thread::spawn(move || {
            let address = redirect.trim_start_matches("http://");
            let mut favicon = TcpStream::connect(address).unwrap();
            write!(favicon, "GET /favicon.ico HTTP/1.1\r\n\r\n").unwrap();
            let mut stream = TcpStream::connect(address).unwrap();
            write!(stream, "GET /?{query} HTTP/1.1\r\nHost: {address}\r\n\r\n").unwrap();
            let mut page = String::new();
            let _ = stream.read_to_string(&mut page);
        });
    }
}

#[test]
fn connecting_stores_the_refresh_token_protected_only_when_every_scope_is_granted() {
    let root = project("connect", 16);
    let scopes = video_upload::SCOPES.join(" ");
    let script = Script::new(vec![reply(
        200,
        &json!({"access_token": "ya29.a", "refresh_token": "1//refresh-secret", "scope": scopes, "token_type": "Bearer"}).to_string(),
    )]);
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    connect(
        &root,
        &env(&script, &real_now),
        listener,
        Duration::from_secs(20),
        &mut browser(|state| format!("state={state}&code=4%2Fcode&scope=x")),
    )
    .unwrap();
    let sent = script.sent.borrow();
    let form = String::from_utf8(sent[0].body.clone()).unwrap();
    assert!(form.contains("grant_type=authorization_code") && form.contains("code=4%2Fcode"));
    assert!(form.contains("code_verifier="));
    assert!(form.contains("redirect_uri=http%3A%2F%2F127.0.0.1%3A"));
    drop(sent);
    let grant = load_grant(&root).unwrap().unwrap();
    assert_eq!(grant.refresh_token, "1//refresh-secret");
    assert_eq!(grant.client, client().fingerprint());
    let stored = fs::read(private_path(&root, CREDENTIAL_FILE).unwrap()).unwrap();
    if cfg!(windows) {
        assert!(!String::from_utf8_lossy(&stored).contains("refresh-secret"));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = fs::metadata(private_path(&root, CREDENTIAL_FILE).unwrap())
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o077, 0);
    }

    // Disconnecting revokes at Google and removes the credential.
    let script = Script::new(vec![reply(200, "")]);
    disconnect(&root, &env(&script, &real_now)).unwrap();
    assert!(String::from_utf8(script.sent.borrow()[0].body.clone())
        .unwrap()
        .contains("token=1%2F%2Frefresh-secret"));
    assert!(load_grant(&root).unwrap().is_none());

    // A grant for another OAuth client is never used.
    connected(&root);
    let script = Script::new(vec![]);
    let mut other = env(&script, &real_now);
    other.client = Some(Client {
        id: "another.apps.googleusercontent.com".into(),
        secret: None,
    });
    let prepared = approved(&root);
    let error = upload_with(&root, &prepared, &other).unwrap_err();
    assert_eq!(code(&error), "client-changed");
    assert!(script.sent.borrow().is_empty());
}

#[test]
fn a_partial_grant_a_refusal_or_a_forged_reply_stores_nothing() {
    let root = project("partial", 16);
    let script = Script::new(vec![
        reply(
            200,
            &json!({"access_token": "a", "refresh_token": "1//partial", "scope": video_upload::SCOPE_UPLOAD}).to_string(),
        ),
        reply(200, ""),
    ]);
    let error = connect(
        &root,
        &env(&script, &real_now),
        TcpListener::bind("127.0.0.1:0").unwrap(),
        Duration::from_secs(20),
        &mut browser(|state| format!("state={state}&code=c")),
    )
    .unwrap_err();
    assert_eq!(code(&error), "scope-missing");
    assert!(error.contains("youtube.readonly"));
    assert_eq!(
        script.urls()[1],
        "POST https://oauth2.googleapis.com/revoke"
    );
    assert!(load_grant(&root).unwrap().is_none());

    let script = Script::new(vec![]);
    let error = connect(
        &root,
        &env(&script, &real_now),
        TcpListener::bind("127.0.0.1:0").unwrap(),
        Duration::from_secs(20),
        &mut browser(|state| format!("state={state}&error=access_denied")),
    )
    .unwrap_err();
    assert_eq!(code(&error), "access-denied");

    let error = connect(
        &root,
        &env(&script, &real_now),
        TcpListener::bind("127.0.0.1:0").unwrap(),
        Duration::from_secs(20),
        &mut browser(|_| "state=forged&code=c".to_string()),
    )
    .unwrap_err();
    assert_eq!(code(&error), "state-mismatch");
    assert!(script.sent.borrow().is_empty());
    assert!(load_grant(&root).unwrap().is_none());

    let mut off = env(&script, &real_now);
    off.client = None;
    let error = connect(
        &root,
        &off,
        TcpListener::bind("127.0.0.1:0").unwrap(),
        Duration::from_secs(1),
        &mut |_| {},
    )
    .unwrap_err();
    assert_eq!(code(&error), "youtube-not-configured");
}

#[test]
fn an_approval_given_under_the_guided_workflow_does_not_cover_an_upload() {
    let (root, prepared) = ready("policy", 32);
    let path = private_path(&root, APPROVALS_FILE).unwrap();
    let mut approvals: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
    let manifest = &mut approvals["approvals"]["episode"]["manifest"];
    manifest["policyVersion"] = json!("2026-10-29");
    manifest["login"] = json!({"method": "none", "scopes": []});
    manifest["publishing"] = json!("manual");
    for capability in ["link", "text", "image", "video", "draft", "schedule"] {
        manifest["capabilities"][capability] = json!("manual");
    }
    fs::write(&path, approvals.to_string()).unwrap();
    let script = Script::new(vec![]);
    let error = upload_with(&root, &prepared, &env(&script, &real_now)).unwrap_err();
    assert_eq!(code(&error), "policy-changed");
    assert!(script.sent.borrow().is_empty());
}

#[test]
fn a_changed_release_after_a_lost_final_reply_is_unknown_and_never_uploaded_again() {
    let (root, _) = ready("changed-after-final", 32);
    let prepared = video_release::prepare(&root, "episode").unwrap();
    let mut replies = vec![token(), session(), Err(NoReply)];
    replies.extend((0..MAX_ATTEMPTS).map(|_| Err(NoReply)));
    let script = Script::new(replies);
    let error = upload_with(&root, &prepared, &env(&script, &real_now)).unwrap_err();
    assert_eq!(code(&error), "provider-unavailable");
    let kept = record(&root);
    assert_eq!(kept.state, UploadState::Uploading);
    assert!(kept.final_sent);

    // The author fixes the description, previews and approves the new digest, then uploads.
    let path = root.join("content/posts/2026-10-01-episode.md");
    let text = fs::read_to_string(&path).unwrap();
    fs::write(
        &path,
        text.replace("A walk to the gate.", "A walk to the old gate."),
    )
    .unwrap();
    let changed = approved(&root);
    assert_ne!(changed.preview.digest, prepared.preview.digest);
    let none = Script::new(vec![]);
    let error = upload_with(&root, &changed, &env(&none, &real_now)).unwrap_err();
    assert_eq!(code(&error), "upload-unknown");
    assert!(none.sent.borrow().is_empty(), "no second session is opened");
    let unknown = record(&root);
    assert_eq!(unknown.state, UploadState::Unknown);
    assert_eq!(unknown.failure.as_deref(), Some("release-changed"));
}

#[test]
fn a_refused_status_query_after_the_last_chunk_keeps_the_video_possible() {
    // A forbidden status query after the final reply was lost: unknown, not failed.
    let (root, prepared) = ready("query-forbidden", 32);
    let script = Script::new(vec![
        token(),
        session(),
        Err(NoReply),
        google_error(403, "forbidden"),
    ]);
    let error = upload_with(&root, &prepared, &env(&script, &real_now)).unwrap_err();
    assert_eq!(code(&error), "upload-unknown");
    assert!(!error.contains("no video was created"));
    assert_eq!(record(&root).state, UploadState::Unknown);

    // A rate limit on the status query keeps the session and `final_sent`; a session that has
    // expired by the next run is then unknown, not a fresh upload.
    let (root, prepared) = ready("query-rate", 32);
    let script = Script::new(vec![token(), session(), Err(NoReply), reply(429, "")]);
    let error = upload_with(&root, &prepared, &env(&script, &real_now)).unwrap_err();
    assert_eq!(code(&error), "rate-limited");
    let kept = record(&root);
    assert_eq!(kept.state, UploadState::Uploading);
    assert!(kept.final_sent, "the last chunk may have arrived");
    assert!(kept.session.is_some());
    let script = Script::new(vec![token(), reply(404, "")]);
    let error = upload_with(&root, &prepared, &env(&script, &real_now)).unwrap_err();
    assert_eq!(code(&error), "upload-unknown");
    assert!(script
        .sent
        .borrow()
        .iter()
        .all(|r| !r.url.ends_with("part=snippet,status")));
    assert_eq!(record(&root).state, UploadState::Unknown);

    // A refusal of the final chunk itself means that chunk did not complete the video.
    let (root, prepared) = ready("chunk-forbidden", 32);
    let script = Script::new(vec![token(), session(), google_error(403, "forbidden")]);
    let error = upload_with(&root, &prepared, &env(&script, &real_now)).unwrap_err();
    assert_eq!(code(&error), "forbidden");
    let failed = record(&root);
    assert_eq!(failed.state, UploadState::Failed);
    assert!(!failed.final_sent);
}
