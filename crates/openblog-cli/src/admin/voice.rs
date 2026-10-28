//! Admin routes for voice sessions (ADR 0266 to 0268, ADR 0271, #444).
//!
//! The routes are thin: the session record (`voice_session`) and the sample store
//! (`voice_store`) decide what may be written and the same core draws the prompts, so the CLI
//! and Admin agree. Every route sits behind the session, every write behind the CSRF check, and
//! an unknown name or verb is a 404 (deny by default). The deadline is read from the session
//! record on the server: a draft save is refused from the deadline on and a lock may hand over
//! its final text only within the grace the session module defines. A rough draft has no route
//! that changes it. Sample text is never put in an error, a log or a refusal, and a path in a
//! response is always relative to the project.

use openblog_core::voice::catalog::{Catalog, Prompt};
use openblog_core::voice::draw::{redraw_three, LibraryEntry};
use openblog_core::voice::{self, VoiceMeta, VoiceSample, VoiceStage};

use super::*;
use crate::voice_session::{self, Resume, StartError, Status};
use crate::voice_store::{self, Listed, StoreError, Visibility};

/// The largest request that carries text: a draft or a polished sample plus room for the wrapper.
pub(super) const MAX_TEXT_REQUEST_BYTES: usize = 256 * 1024;
/// The largest request that carries only choices.
pub(super) const MAX_SMALL_REQUEST_BYTES: usize = 4 * 1024;

/// How large a body a voice route may send, decided from its name alone.
pub(super) fn request_limit(req: &Request, name: &str) -> usize {
    match (req.method.as_str(), name) {
        ("PUT", "voice/session/draft")
        | ("POST", "voice/session/lock")
        | ("POST", "voice/samples") => MAX_TEXT_REQUEST_BYTES,
        ("PUT", rest) if matches!(sample_route(rest), Some(SampleRoute::One(_))) => {
            MAX_TEXT_REQUEST_BYTES
        }
        _ => MAX_SMALL_REQUEST_BYTES,
    }
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

/// Which route a path under `voice/samples/` names: the sample itself, or one of its actions.
pub(super) enum SampleRoute<'a> {
    One(&'a str),
    Visibility(&'a str),
    Promote(&'a str),
}

pub(super) fn sample_route(name: &str) -> Option<SampleRoute<'_>> {
    let rest = name.strip_prefix("voice/samples/")?;
    let (id, action) = match rest.split_once('/') {
        Some((id, action)) => (id, Some(action)),
        None => (rest, None),
    };
    let valid = !id.is_empty()
        && id.len() <= 160
        && id
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-');
    if !valid {
        return None;
    }
    match action {
        None => Some(SampleRoute::One(id)),
        Some("visibility") => Some(SampleRoute::Visibility(id)),
        Some("promote") => Some(SampleRoute::Promote(id)),
        Some(_) => None,
    }
}

fn body_object(req: &Request, limit: usize) -> Result<Json, Response> {
    require_json(req)?;
    if req.body.len() > limit {
        return Err(Response::error(413, "That request is too large"));
    }
    match serde_json::from_slice::<Json>(&req.body) {
        Ok(body) if body.is_object() => Ok(body),
        _ => Err(Response::error(400, "Invalid JSON")),
    }
}

fn optional_text(body: &Json, key: &str) -> Result<Option<String>, Response> {
    match &body[key] {
        Json::Null => Ok(None),
        Json::String(text) => Ok(Some(text.clone())),
        _ => Err(Response::error(400, &format!("`{key}` must be text"))),
    }
}

fn visibility_of(body: &Json) -> Result<Option<Visibility>, Response> {
    match optional_text(body, "visibility")? {
        None => Ok(None),
        Some(text) => Visibility::parse(&text)
            .map(Some)
            .ok_or_else(|| Response::error(400, "Choose portable or private")),
    }
}

/// A path in an error is the project's own folder: say so instead of showing where it is.
fn scrub(state: &AppState, message: &str) -> String {
    let root = state.root.display().to_string();
    let mut out = message.to_string();
    for spelling in [root.clone(), root.replace('\\', "/")] {
        if !spelling.is_empty() {
            out = out.replace(&spelling, "the project");
        }
    }
    out
}

fn store_error(state: &AppState, error: StoreError) -> Response {
    match error {
        StoreError::Refused(message) => Response::json(
            409,
            &json!({ "error": scrub(state, &message), "refused": true }),
        ),
        StoreError::Stale { message, current } => Response::json(
            409,
            &json!({ "error": message, "conflict": true, "revision": current }),
        ),
        StoreError::Failed(message) => Response::error(500, &scrub(state, &message)),
    }
}

fn catalog_of(state: &AppState) -> Catalog {
    voice_store::load_catalog(&state.root)
}

fn prompt_json(catalog: &Catalog, prompt: &Prompt) -> Json {
    let pack = catalog.pack(&prompt.pack);
    json!({
        "id": prompt.id,
        "pack": prompt.pack,
        "packTitle": pack.map_or("", |p| p.title.as_str()),
        "title": prompt.title,
        "invitation": prompt.invitation,
        "wordsMin": prompt.words_min,
        "wordsMax": prompt.words_max,
        "site": prompt.site,
    })
}

fn limits() -> Json {
    json!({
        "defaultSeconds": voice_session::DEFAULT_SECONDS,
        "minSeconds": voice_session::MIN_SECONDS,
        "maxSeconds": voice_session::MAX_SECONDS,
        "lockGraceSeconds": voice_session::LOCK_GRACE_SECONDS,
        "maxDraftBytes": voice_session::MAX_DRAFT_BYTES,
        "maxFileBytes": voice::MAX_FILE_BYTES,
    })
}

/// The project-relative place of a sample, never an absolute path.
fn relative_path(visibility: Visibility, file: &str) -> String {
    format!("{}/{file}", visibility.directory())
}

fn id_of(file: &str) -> &str {
    file.strip_suffix(".md").unwrap_or(file)
}

fn listed_json(catalog: &Catalog, item: &Listed) -> Json {
    let prompt = item.prompt.as_deref().and_then(|id| catalog.prompt(id));
    json!({
        "id": id_of(&item.file),
        "file": item.file,
        "visibility": item.visibility.as_str(),
        "path": relative_path(item.visibility, &item.file),
        "valid": item.valid,
        "guidance": item.guidance,
        "stage": item.stage.map(VoiceStage::as_str),
        "pack": item.pack,
        "prompt": item.prompt,
        "promptTitle": prompt.map(|p| p.title.as_str()),
        "title": item.title,
        "words": item.words,
        "date": item.date,
        "roughOf": item.rough_of,
        "revision": item.revision,
        "bytes": item.bytes,
    })
}

fn sample_json(
    catalog: &Catalog,
    visibility: Visibility,
    file: &str,
    loaded: &voice_store::Loaded,
) -> Json {
    let mut out = listed_json(catalog, &loaded.listed);
    out["visibility"] = json!(visibility.as_str());
    match &loaded.sample {
        Some(sample) => {
            out["subtitle"] = json!(sample.subtitle);
            out["slug"] = json!(sample.slug);
            out["description"] = json!(sample.description);
            out["tags"] = json!(sample.tags);
            out["timeLimitSeconds"] = json!(sample.voice.time_limit_seconds);
            out["body"] = json!(sample.body);
            out["readOnly"] = json!(sample.voice.stage == VoiceStage::Rough);
        }
        None => {
            out["body"] = Json::Null;
            out["readOnly"] = json!(true);
        }
    }
    out["path"] = json!(relative_path(visibility, file));
    out
}

fn session_json(catalog: &Catalog, session: &voice_session::Session, remaining: i64) -> Json {
    let prompt = catalog.prompt(&session.prompt_id);
    json!({
        "state": "active",
        "sessionId": session_id(session),
        "promptId": session.prompt_id,
        "pack": session.pack,
        "title": prompt.map_or(session.prompt_id.as_str(), |p| p.title.as_str()),
        "invitation": prompt.map_or("", |p| p.invitation.as_str()),
        "wordsMin": prompt.map_or(0, |p| p.words_min),
        "wordsMax": prompt.map_or(0, |p| p.words_max),
        "rule": catalog.rule,
        "startedAt": session.started_at,
        "deadline": session.deadline,
        "timeLimitSeconds": session.time_limit_seconds,
        "remainingSeconds": remaining,
        "draft": session.draft,
        "visibility": session.visibility.as_str(),
        "surface": session.surface,
        "now": clock::now().rfc3339(),
    })
}

/// A session is named by when it began and what it is for, so a draft from an earlier session
/// can never be saved into a later one.
fn session_id(session: &voice_session::Session) -> String {
    session.id()
}

// ---------------------------------------------------------------------------
// Catalog and draw
// ---------------------------------------------------------------------------

/// `GET voice/catalog`: the packs and prompts this site can draw from, the standing rule and the
/// limits the page counts with.
pub(super) fn catalog(state: &AppState) -> Response {
    let catalog = catalog_of(state);
    Response::json(
        200,
        &json!({
            "version": catalog.version,
            "rule": catalog.rule,
            "packs": catalog.packs.iter().map(|pack| json!({
                "id": pack.id,
                "title": pack.title,
                "summary": pack.summary,
                "prompts": pack.prompts.iter().map(|p| prompt_json(&catalog, p)).collect::<Vec<_>>(),
            })).collect::<Vec<_>>(),
            "warnings": catalog.warnings,
            "limits": limits(),
        }),
    )
}

fn seed() -> Result<u64, String> {
    let token = auth::random_token()?;
    u64::from_str_radix(&token[..16], 16).map_err(|e| e.to_string())
}

/// `POST voice/draw`: three prompts. The body may name `exclude` (the ids just shown, which are
/// avoided on a redraw) and `pack` (draw only from that pack). Prompts already written today are
/// left out while at least three others remain, because a session for them would be refused.
pub(super) fn draw(state: &AppState, req: &Request) -> Response {
    let body = match body_object(req, MAX_SMALL_REQUEST_BYTES) {
        Ok(body) => body,
        Err(response) => return response,
    };
    let exclude: Vec<String> = match &body["exclude"] {
        Json::Null => Vec::new(),
        Json::Array(items) if items.len() <= 12 => {
            let mut ids = Vec::new();
            for item in items {
                match item.as_str() {
                    Some(id) if voice::is_kebab(id) => ids.push(id.to_string()),
                    _ => return Response::error(400, "`exclude` must list prompt ids"),
                }
            }
            ids
        }
        _ => return Response::error(400, "`exclude` must list prompt ids"),
    };
    let pack = match optional_text(&body, "pack") {
        Ok(pack) => pack,
        Err(response) => return response,
    };
    let mut catalog = catalog_of(state);
    if let Some(pack) = &pack {
        if catalog.pack(pack).is_none() {
            return Response::error(404, "There is no such pack");
        }
        catalog.packs.retain(|p| &p.id == pack);
    }
    let today = clock::now().rfc3339()[..10].to_string();
    let written_today: Vec<String> = voice_store::list(&state.root)
        .into_iter()
        .filter(|item| {
            item.stage == Some(VoiceStage::Rough)
                && item.date.as_deref().and_then(|d| d.get(..10)) == Some(today.as_str())
        })
        .filter_map(|item| item.prompt)
        .collect();
    let mut open = catalog.clone();
    for p in &mut open.packs {
        p.prompts
            .retain(|prompt| !written_today.contains(&prompt.id));
    }
    if open.prompts().count() >= voice::draw::DRAW_SIZE {
        catalog = open;
    }
    let library: Vec<LibraryEntry> = voice_store::library(&state.root);
    let seed = match seed() {
        Ok(seed) => seed,
        Err(error) => return Response::error(500, &error),
    };
    let previous: Vec<&str> = exclude.iter().map(String::as_str).collect();
    let drawn = redraw_three(&catalog, &library, seed, &previous);
    Response::json(
        200,
        &json!({
            "prompts": drawn.iter().map(|p| prompt_json(&catalog, p)).collect::<Vec<_>>(),
            "rule": catalog.rule,
            "pack": pack,
        }),
    )
}

// ---------------------------------------------------------------------------
// The session
// ---------------------------------------------------------------------------

/// `GET voice/status`: whether a session is open and how many sample files exist, for the
/// invitation card. Read only: it never locks or creates anything.
pub(super) fn status(state: &AppState) -> Response {
    let now = clock::now();
    let session = match voice_session::status(&state.root, now) {
        Ok(Status::None) => json!({ "open": false }),
        Ok(Status::Active { session, .. }) => json!({
            "open": true,
            "expired": false,
            "sessionId": session_id(&session),
            "deadline": session.deadline,
            "draftChars": session.draft.chars().count(),
        }),
        Ok(Status::Expired { session }) => json!({
            "open": true,
            "expired": true,
            "sessionId": session_id(&session),
            "deadline": session.deadline,
            "draftChars": session.draft.chars().count(),
        }),
        // A record that cannot be used still means a session is in the way.
        Err(_) => json!({ "open": true, "unreadable": true }),
    };
    let samples = voice_store::list(&state.root).len();
    Response::json(200, &json!({ "session": session, "samples": samples }))
}

fn locked_json(state: &AppState, catalog: &Catalog, locked: &voice_session::Locked) -> Json {
    let written = &locked.written;
    let sample = voice_store::read(&state.root, written.visibility, &written.file)
        .ok()
        .map(|loaded| sample_json(catalog, written.visibility, &written.file, &loaded));
    json!({
        "state": "locked",
        "expired": locked.expired,
        "words": locked.words,
        "created": written.created,
        "sample": sample,
    })
}

/// `GET voice/session`: where the session stands. This is the resume: with time left the original
/// deadline and the saved draft come back; when the time ran out the rough draft is locked from the
/// saved text (or the empty session is discarded), so a reload never grants extra time.
pub(super) fn get_session(state: &AppState) -> Response {
    let catalog = catalog_of(state);
    match voice_session::resume(&state.root, &catalog, clock::now()) {
        Ok(Resume::NoSession) => Response::json(200, &json!({ "state": "none" })),
        Ok(Resume::Active {
            session,
            remaining_seconds,
        }) => Response::json(200, &session_json(&catalog, &session, remaining_seconds)),
        Ok(Resume::Locked(locked)) => Response::json(200, &locked_json(state, &catalog, &locked)),
        Ok(Resume::Discarded { prompt_id }) => {
            Response::json(200, &json!({ "state": "discarded", "promptId": prompt_id }))
        }
        // Another tab locked it between the check and the lock: nothing is open now.
        Err(StoreError::Refused(message)) if message == voice_session::NO_SESSION_TO_LOCK => {
            Response::json(200, &json!({ "state": "none" }))
        }
        Err(error) => store_error(state, error),
    }
}

/// `POST voice/session/start`: begin the one session. The body is `{ promptId, visibility?,
/// timeLimitSeconds? }`; a private session is the default. A session already open is a 409 that
/// says whether it ran out of time, so the page can offer to lock or scrap it.
pub(super) fn start(state: &AppState, req: &Request) -> Response {
    let body = match body_object(req, MAX_SMALL_REQUEST_BYTES) {
        Ok(body) => body,
        Err(response) => return response,
    };
    let Some(prompt_id) = body["promptId"].as_str() else {
        return Response::error(400, "Choose a prompt");
    };
    let visibility = match visibility_of(&body) {
        Ok(visibility) => visibility.unwrap_or(Visibility::Private),
        Err(response) => return response,
    };
    let seconds = match &body["timeLimitSeconds"] {
        Json::Null => voice_session::DEFAULT_SECONDS,
        value => match value.as_u64().and_then(|n| u32::try_from(n).ok()) {
            Some(seconds) => seconds,
            None => return Response::error(400, "`timeLimitSeconds` must be a whole number"),
        },
    };
    let catalog = catalog_of(state);
    let now = clock::now();
    match voice_session::start(
        &state.root,
        &catalog,
        prompt_id,
        "admin",
        visibility,
        seconds,
        now,
    ) {
        Ok(session) => {
            let remaining = session.remaining_seconds(now);
            Response::json(201, &session_json(&catalog, &session, remaining))
        }
        Err(StartError::AlreadyOpen { prompt_id, expired }) => Response::json(
            409,
            &json!({
                "error": StartError::AlreadyOpen { prompt_id: prompt_id.clone(), expired }.to_string(),
                "alreadyOpen": true,
                "promptId": prompt_id,
                "expired": expired,
            }),
        ),
        Err(StartError::Refused(message)) => Response::json(
            409,
            &json!({ "error": scrub(state, &message), "refused": true }),
        ),
        Err(StartError::Failed(message)) => Response::error(500, &scrub(state, &message)),
    }
}

/// Check that the page is talking about the session that is open.
fn same_session<'a>(state: &AppState, body: &'a Json) -> Result<&'a str, Response> {
    let wanted = match &body["sessionId"] {
        Json::String(id) => id.as_str(),
        _ => return Err(Response::error(400, "Name the session as `sessionId`")),
    };
    match voice_session::status(&state.root, clock::now()) {
        Ok(Status::None) => Err(Response::json(
            409,
            &json!({
                "error": "There is no open writing session. If the time ran out, your rough draft was locked from what was saved last.",
                "noSession": true,
            }),
        )),
        Ok(Status::Active { session, .. } | Status::Expired { session }) => {
            if session_id(&session) == wanted {
                Ok(wanted)
            } else {
                Err(Response::json(
                    409,
                    &json!({
                        "error": "That draft belongs to an earlier session, so it was not saved.",
                        "otherSession": true,
                    }),
                ))
            }
        }
        Err(error) => Err(store_error(state, error)),
    }
}

/// `PUT voice/session/draft`: save the text so far. The body is `{ sessionId, text }`. From the
/// deadline on this is refused (a 409 with `timeUp`), however the clock on the page reads, and
/// the draft that was saved last is what will be locked.
pub(super) fn save_draft(state: &AppState, req: &Request) -> Response {
    let body = match body_object(req, MAX_TEXT_REQUEST_BYTES) {
        Ok(body) => body,
        Err(response) => return response,
    };
    let Some(text) = body["text"].as_str() else {
        return Response::error(400, "Send the text as `text`");
    };
    if text.len() > voice_session::MAX_DRAFT_BYTES {
        return Response::error(413, "That draft is longer than a sample can hold");
    }
    let wanted = match same_session(state, &body) {
        Ok(wanted) => wanted,
        Err(response) => return response,
    };
    let now = clock::now();
    if let Ok(Status::Expired { .. }) = voice_session::status(&state.root, now) {
        return Response::json(
            409,
            &json!({
                "error": "Time is up. The draft will be locked from what was saved last.",
                "timeUp": true,
            }),
        );
    }
    match voice_session::save_draft(&state.root, Some(wanted), text, now) {
        Ok(Status::Active {
            remaining_seconds, ..
        }) => Response::json(
            200,
            &json!({ "saved": true, "remainingSeconds": remaining_seconds, "bytes": text.len() }),
        ),
        Ok(_) => Response::error(500, "The session changed while saving"),
        Err(StoreError::Refused(message)) if message.starts_with("Time is up") => {
            Response::json(409, &json!({ "error": message, "timeUp": true }))
        }
        Err(StoreError::Refused(message)) if message == voice_session::OTHER_SESSION => {
            Response::json(409, &json!({ "error": message, "otherSession": true }))
        }
        Err(error) => store_error(state, error),
    }
}

/// `POST voice/session/lock`: end the session by locking the rough draft. The body is `{
/// sessionId, text?, visibility? }`. `text` is what was on screen; it is used only within the
/// grace after the deadline, and otherwise the last saved draft is locked. The answer carries the
/// locked rough draft so the page can pre-fill the polished editor.
pub(super) fn lock_session(state: &AppState, req: &Request) -> Response {
    let body = match body_object(req, MAX_TEXT_REQUEST_BYTES) {
        Ok(body) => body,
        Err(response) => return response,
    };
    let text = match optional_text(&body, "text") {
        Ok(text) => text,
        Err(response) => return response,
    };
    if text
        .as_ref()
        .is_some_and(|t| t.len() > voice_session::MAX_DRAFT_BYTES)
    {
        return Response::error(413, "That draft is longer than a sample can hold");
    }
    let visibility = match visibility_of(&body) {
        Ok(visibility) => visibility,
        Err(response) => return response,
    };
    let wanted = match same_session(state, &body) {
        Ok(wanted) => wanted,
        Err(response) => return response,
    };
    let catalog = catalog_of(state);
    match voice_session::lock(
        &state.root,
        Some(wanted),
        &catalog,
        text.as_deref(),
        visibility,
        clock::now(),
    ) {
        Ok(locked) => Response::json(200, &locked_json(state, &catalog, &locked)),
        Err(StoreError::Refused(message)) if message.starts_with("Nothing was written") => {
            Response::json(409, &json!({ "error": message, "empty": true }))
        }
        Err(StoreError::Refused(message)) if message == voice_session::OTHER_SESSION => {
            Response::json(409, &json!({ "error": message, "otherSession": true }))
        }
        Err(error) => store_error(state, error),
    }
}

/// `DELETE voice/session`: give up on the session and write nothing.
pub(super) fn scrap(state: &AppState) -> Response {
    match voice_session::scrap(&state.root) {
        Ok(()) => Response::json(200, &json!({ "state": "none" })),
        Err(error) => store_error(state, error),
    }
}

// ---------------------------------------------------------------------------
// Samples
// ---------------------------------------------------------------------------

/// Which folder holds `file`. `wanted` narrows the search; a file in both folders is ambiguous
/// and refused rather than guessed at.
fn locate(
    state: &AppState,
    file: &str,
    wanted: Option<Visibility>,
) -> Result<(Visibility, voice_store::Loaded), Response> {
    let mut found = Vec::new();
    for visibility in [Visibility::Portable, Visibility::Private] {
        if wanted.is_some_and(|w| w != visibility) {
            continue;
        }
        match voice_store::read(&state.root, visibility, file) {
            Ok(loaded) => found.push((visibility, loaded)),
            Err(StoreError::Refused(message)) if message == "There is no such voice sample." => {}
            Err(error) => return Err(store_error(state, error)),
        }
    }
    match found.len() {
        0 => Err(Response::error(404, "There is no such voice sample.")),
        1 => Ok(found.remove(0)),
        _ => Err(Response::json(
            409,
            &json!({
                "error": "This sample is in both the portable and the private folder. Remove one copy, or say which with `visibility`.",
                "ambiguous": true,
            }),
        )),
    }
}

fn query_visibility(req: &Request) -> Result<Option<Visibility>, Response> {
    match req.query.get("visibility") {
        None => Ok(None),
        Some(text) => Visibility::parse(text)
            .map(Some)
            .ok_or_else(|| Response::error(400, "Choose portable or private")),
    }
}

/// `GET voice/samples`: every sample file, newest first, with the coverage of each pack. Invalid
/// files are listed with guidance, never hidden.
pub(super) fn list(state: &AppState) -> Response {
    let catalog = catalog_of(state);
    let mut items = voice_store::list(&state.root);
    items.sort_by(|a, b| {
        (b.date.as_deref(), &b.file, b.visibility).cmp(&(a.date.as_deref(), &a.file, a.visibility))
    });
    let valid: Vec<&Listed> = items.iter().filter(|i| i.valid).collect();
    let has = |prompt: &str, stage: VoiceStage| {
        valid
            .iter()
            .any(|i| i.prompt.as_deref() == Some(prompt) && i.stage == Some(stage))
    };
    let packs: Vec<Json> = catalog
        .packs
        .iter()
        .map(|pack| {
            let prompts: Vec<Json> = pack
                .prompts
                .iter()
                .map(|p| {
                    json!({
                        "id": p.id,
                        "title": p.title,
                        "rough": has(&p.id, VoiceStage::Rough),
                        "polished": has(&p.id, VoiceStage::Polished),
                    })
                })
                .collect();
            let count = |key: &str| prompts.iter().filter(|p| p[key] == true).count();
            json!({
                "id": pack.id,
                "title": pack.title,
                "summary": pack.summary,
                "total": prompts.len(),
                "withRough": count("rough"),
                "withPolished": count("polished"),
                "prompts": prompts,
            })
        })
        .collect();
    Response::json(
        200,
        &json!({
            "samples": items.iter().map(|i| listed_json(&catalog, i)).collect::<Vec<_>>(),
            "coverage": packs,
            "warnings": catalog.warnings,
        }),
    )
}

/// `GET voice/samples/{id}`: one sample with its text and revision. A rough draft is reported
/// `readOnly`. For a rough draft the polished draft that exists (if any) is named, and for a
/// polished one its rough draft.
pub(super) fn get(state: &AppState, req: &Request, id: &str) -> Response {
    let wanted = match query_visibility(req) {
        Ok(wanted) => wanted,
        Err(response) => return response,
    };
    let file = format!("{id}.md");
    let (visibility, loaded) = match locate(state, &file, wanted) {
        Ok(found) => found,
        Err(response) => return response,
    };
    let catalog = catalog_of(state);
    let mut out = sample_json(&catalog, visibility, &file, &loaded);
    let partner = match (loaded.listed.stage, voice::polished_file_name(&file)) {
        (Some(VoiceStage::Rough), Some(polished)) => Some(polished),
        (Some(VoiceStage::Polished), _) => loaded.listed.rough_of.clone(),
        _ => None,
    };
    out["partner"] = partner
        .and_then(|name| {
            voice_store::read(&state.root, visibility, &name)
                .ok()
                .map(|p| listed_json(&catalog, &p.listed))
        })
        .unwrap_or(Json::Null);
    Response::json(200, &out)
}

fn tags_of(body: &Json) -> Result<Option<Vec<String>>, Response> {
    match &body["tags"] {
        Json::Null if body.get("tags").is_none() => Ok(None),
        Json::Null => Ok(Some(Vec::new())),
        Json::Array(items) if items.len() <= 20 => items
            .iter()
            .map(|t| t.as_str().map(str::to_string))
            .collect::<Option<Vec<_>>>()
            .map(Some)
            .ok_or_else(|| Response::error(400, "`tags` must be a list of text")),
        _ => Err(Response::error(400, "`tags` must be a list of text")),
    }
}

/// The author's own fields from a request, applied over `sample`. Only these fields can change:
/// the stage, the prompt, the pairing and the date are the sample's, not the request's.
fn apply_fields(sample: &mut VoiceSample, body: &Json) -> Result<(), Response> {
    if let Some(title) = optional_text(body, "title")? {
        sample.title = title;
    }
    if let Some(text) = optional_text(body, "body")? {
        sample.body = text.replace("\r\n", "\n").replace('\r', "\n");
    }
    if body.get("subtitle").is_some() {
        sample.subtitle = optional_text(body, "subtitle")?.filter(|s| !s.trim().is_empty());
    }
    if body.get("description").is_some() {
        sample.description = optional_text(body, "description")?.filter(|s| !s.trim().is_empty());
    }
    if let Some(tags) = tags_of(body)? {
        sample.tags = tags;
    }
    sample.voice.words = voice::count_words(&sample.body);
    Ok(())
}

fn refuse_text(message: String) -> Response {
    Response::json(422, &json!({ "error": message, "invalid": true }))
}

/// `POST voice/samples`: write the polished draft of a rough draft that exists. The body is
/// `{ roughOf, title, body, ... }`; it is written beside the rough draft, so there is no
/// `visibility` to choose here (move the pair with `visibility`). It never replaces a polished
/// draft that exists: that is `PUT`, with the revision.
pub(super) fn create_polished(state: &AppState, req: &Request) -> Response {
    let body = match body_object(req, MAX_TEXT_REQUEST_BYTES) {
        Ok(body) => body,
        Err(response) => return response,
    };
    let Some(rough_file) = body["roughOf"].as_str() else {
        return Response::error(400, "Name the rough draft as `roughOf`");
    };
    if !matches!(
        voice::parse_file_name(rough_file),
        Some((_, _, VoiceStage::Rough))
    ) {
        return Response::error(400, "`roughOf` must be the file name of a rough draft");
    }
    let (visibility, rough) = match locate(state, rough_file, None) {
        Ok(found) => found,
        Err(response) => return response,
    };
    let Some(rough_sample) = rough.sample else {
        return Response::json(
            409,
            &json!({ "error": "That rough draft cannot be read, so it cannot be polished.", "refused": true }),
        );
    };
    if rough_sample.voice.stage != VoiceStage::Rough {
        return Response::error(400, "`roughOf` must be the file name of a rough draft");
    }
    let slug = {
        let title = body["title"].as_str().unwrap_or_default();
        let slug = openblog_core::slug::slugify(title);
        if voice::is_kebab(&slug) {
            slug
        } else {
            rough_sample.voice.prompt.clone()
        }
    };
    let mut sample = VoiceSample {
        title: rough_sample.title.clone(),
        subtitle: None,
        slug,
        date: rough_sample.date.clone(),
        description: None,
        tags: Vec::new(),
        voice: VoiceMeta {
            catalog: rough_sample.voice.catalog,
            pack: rough_sample.voice.pack.clone(),
            prompt: rough_sample.voice.prompt.clone(),
            stage: VoiceStage::Polished,
            time_limit_seconds: 0,
            words: 0,
            rough_of: Some(rough_file.to_string()),
        },
        body: String::new(),
        extra: std::collections::BTreeMap::new(),
    };
    if let Err(response) = apply_fields(&mut sample, &body) {
        return response;
    }
    if let Err(message) = sample.validate() {
        return refuse_text(message);
    }
    write_polished(state, visibility, &sample, None, 201)
}

/// `PUT voice/samples/{id}`: save the author's changes to a polished draft. The body carries the
/// `revision` that was read; a different current revision is a 409 `conflict` that says what it is
/// now. A rough draft has no such route: the answer is a plain refusal and nothing is written.
pub(super) fn save_polished(state: &AppState, req: &Request, id: &str) -> Response {
    let body = match body_object(req, MAX_TEXT_REQUEST_BYTES) {
        Ok(body) => body,
        Err(response) => return response,
    };
    let wanted = match query_visibility(req) {
        Ok(wanted) => wanted,
        Err(response) => return response,
    };
    let file = format!("{id}.md");
    if matches!(
        voice::parse_file_name(&file),
        Some((_, _, VoiceStage::Rough))
    ) {
        return Response::json(
            409,
            &json!({
                "error": "A rough draft is never changed after its session ends. Polish a copy instead.",
                "refused": true,
                "readOnly": true,
            }),
        );
    }
    let Some(revision) = body["revision"].as_str() else {
        return Response::error(400, "Send the revision you read as `revision`");
    };
    let (visibility, loaded) = match locate(state, &file, wanted) {
        Ok(found) => found,
        Err(response) => return response,
    };
    let Some(mut sample) = loaded.sample else {
        return Response::json(
            409,
            &json!({
                "error": "This polished draft cannot be read by this release, so it is left as it is.",
                "refused": true,
            }),
        );
    };
    if sample.voice.stage != VoiceStage::Polished {
        return Response::json(
            409,
            &json!({ "error": "Only a polished draft can be saved this way.", "refused": true }),
        );
    }
    if let Err(response) = apply_fields(&mut sample, &body) {
        return response;
    }
    if let Err(message) = sample.validate() {
        return refuse_text(message);
    }
    write_polished(state, visibility, &sample, Some(revision), 200)
}

fn write_polished(
    state: &AppState,
    visibility: Visibility,
    sample: &VoiceSample,
    revision: Option<&str>,
    status: u16,
) -> Response {
    match voice_store::write_polished(&state.root, visibility, sample, revision) {
        Ok(written) => {
            let catalog = catalog_of(state);
            match voice_store::read(&state.root, written.visibility, &written.file) {
                Ok(loaded) => Response::json(
                    status,
                    &sample_json(&catalog, written.visibility, &written.file, &loaded),
                ),
                Err(error) => store_error(state, error),
            }
        }
        Err(StoreError::Stale { message, current }) => {
            // Say what is stored now, so the page can offer the author's choice (ADR 0273).
            let latest = current.as_ref().and_then(|_| {
                let file = sample
                    .voice
                    .rough_of
                    .as_deref()
                    .and_then(voice::polished_file_name)?;
                voice_store::read(&state.root, visibility, &file)
                    .ok()
                    .map(|loaded| sample_json(&catalog_of(state), visibility, &file, &loaded))
            });
            Response::json(
                409,
                &json!({ "error": message, "conflict": true, "revision": current, "current": latest }),
            )
        }
        Err(error) => store_error(state, error),
    }
}

/// `POST voice/samples/{id}/visibility`: move the sample, with its rough or polished partner, to
/// the other folder. The bytes are copied unchanged and checked first. The body is `{ visibility
/// }`; asking for where it already is a plain refusal.
pub(super) fn set_visibility(state: &AppState, req: &Request, id: &str) -> Response {
    let body = match body_object(req, MAX_SMALL_REQUEST_BYTES) {
        Ok(body) => body,
        Err(response) => return response,
    };
    let to = match visibility_of(&body) {
        Ok(Some(to)) => to,
        Ok(None) => return Response::error(400, "Choose portable or private"),
        Err(response) => return response,
    };
    let file = format!("{id}.md");
    let (from, _) = match locate(state, &file, Some(to.other())) {
        Ok(found) => found,
        Err(response) => {
            // Already there, or nowhere: say which.
            if locate(state, &file, Some(to)).is_ok() {
                return Response::json(
                    409,
                    &json!({ "error": "The sample is already there.", "refused": true }),
                );
            }
            return response;
        }
    };
    match voice_store::move_visibility(&state.root, from, &file, to) {
        Ok(names) => {
            let catalog = catalog_of(state);
            let moved: Vec<Json> = names
                .iter()
                .filter_map(|name| {
                    voice_store::read(&state.root, to, name)
                        .ok()
                        .map(|loaded| listed_json(&catalog, &loaded.listed))
                })
                .collect();
            Response::json(200, &json!({ "moved": moved, "visibility": to.as_str() }))
        }
        Err(error) => store_error(state, error),
    }
}

/// `POST voice/samples/{id}/promote`: make a post draft from a polished sample. The body is `{ dir? }`
/// (a folder inside `posts`). A rough draft is refused with guidance, a slug already used by a post is
/// refused, and the sample itself is never touched. Writing a post takes the content transaction lock like
/// every other Admin post write. The answer names the new draft so the page can link to it in Write.
pub(super) fn promote(state: &AppState, req: &Request, id: &str) -> Response {
    let body = match body_object(req, MAX_SMALL_REQUEST_BYTES) {
        Ok(body) => body,
        Err(response) => return response,
    };
    let dir = match &body["dir"] {
        Json::Null => None,
        Json::String(dir) if dir.len() <= 200 => Some(dir.as_str()),
        _ => return Response::error(400, "`dir` must be a folder inside posts"),
    };
    let file = format!("{id}.md");
    let (visibility, loaded) = match locate(state, &file, None) {
        Ok(found) => found,
        Err(response) => return response,
    };
    if loaded.listed.stage != Some(VoiceStage::Polished) {
        return Response::json(
            409,
            &json!({
                "error": "Only a polished draft can become a post. A rough draft is never edited: polish a copy first, then make the post from that.",
                "refused": true,
                "rough": loaded.listed.stage == Some(VoiceStage::Rough),
            }),
        );
    }
    let _transaction = match content_transaction(state) {
        Ok(lock) => lock,
        Err(response) => return response,
    };
    match voice_store::promote_to_post_draft(&state.root, visibility, &file, dir) {
        Ok(created) => {
            let path = created.to_string_lossy().replace('\\', "/");
            let content = site::load_config(&state.root)
                .map(|config| config.paths.content)
                .unwrap_or_default();
            let edit = path
                .strip_prefix(&format!("{}/", content.trim_matches('/')))
                .unwrap_or(&path)
                .to_string();
            Response::json(
                201,
                &json!({
                    "created": true,
                    "path": path,
                    "editPath": edit,
                    "draft": true,
                    "message": "Created a post draft. It is not published while it says `draft: true`. Your voice samples were not changed.",
                }),
            )
        }
        Err(error) => store_error(state, error),
    }
}
