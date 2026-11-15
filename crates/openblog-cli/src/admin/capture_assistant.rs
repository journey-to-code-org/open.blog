//! The Assistant routes of the Capture view: turning a voice note into words (ADR 0302, #502) and the notes into a
//! job-draft proposal (ADR 0303, #503). For transcription: disclose what would be sent, send it only after
//! the author confirmed, and keep the transcript privately beside the note as untrusted text. The audio goes
//! out only through the Assistant provider boundary (or a local engine the server's owner configured), and
//! every failure leaves the typed notes as the way forward.

use super::*;
use crate::assistant::transcribe::{
    local_command_from_environment, provider_transcribes, AssistantTranscriber, AudioClip,
    LocalCommandTranscriber, ProviderTranscriber, OPENAI_TRANSCRIPTION_MODEL,
};
use openblog_core::capture;

/// How the server can turn audio into words, decided from configuration alone.
enum Engine {
    Local(Vec<String>),
    Provider {
        kind: AssistantProviderKind,
        model: String,
    },
    /// The helper's company can't take audio, and the server's environment holds a key for one
    /// that can (Studio R9b, G76). It is used for turning recordings into words and nothing else.
    Hearing {
        kind: AssistantProviderKind,
        model: String,
        credential: String,
    },
    Unavailable(&'static str),
}

/// A model for a hearing key whose company has no fixed one (Gemini).
const HEARING_MODEL_ENVIRONMENT: &str = "OPENBLOG_TRANSCRIBE_MODEL";

/// A key in the server's environment that can hear, for a helper whose company can't: OpenAI's
/// first, then Gemini's (which also needs a model named, as it has no fixed one for audio). Read
/// from the environment only: a key saved for the helper is never borrowed for this.
fn hearing_key() -> Option<Engine> {
    let key = |name: &str| {
        std::env::var(name)
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
    };
    if let Some(credential) = key("OPENAI_API_KEY") {
        return Some(Engine::Hearing {
            kind: AssistantProviderKind::OpenAi,
            model: String::new(),
            credential,
        });
    }
    let model = key(HEARING_MODEL_ENVIRONMENT)?;
    key("GEMINI_API_KEY").map(|credential| Engine::Hearing {
        kind: AssistantProviderKind::Gemini,
        model,
        credential,
    })
}

fn engine_for(config: &SiteConfig) -> Engine {
    if let Some(command) = local_command_from_environment() {
        return Engine::Local(command);
    }
    let provider = config.knowledge_checks.provider;
    if !provider_transcribes(provider) {
        if let Some(hearing) = hearing_key() {
            return hearing;
        }
        return Engine::Unavailable(
            "The configured Assistant provider does not take audio. Type your notes instead.",
        );
    }
    if config.knowledge_checks.model.trim().is_empty() && provider != AssistantProviderKind::OpenAi
    {
        return Engine::Unavailable(
            "Choose a model in Assistant settings to transcribe. Type your notes instead.",
        );
    }
    Engine::Provider {
        kind: provider,
        model: config.knowledge_checks.model.trim().to_string(),
    }
}

/// The stored note of a capture: its path, bytes and container, or why it cannot be read.
fn stored_note(state: &AppState, id: &str) -> Result<(PathBuf, Vec<u8>, &'static str), Response> {
    if !capture::valid_id(id) {
        return Err(coded_error(
            400,
            "capture-id",
            "That capture id is not valid",
        ));
    }
    let name = stored_capture_audio(state, id)
        .ok_or_else(|| coded_error(404, "no-note", "No voice note is kept for that capture"))?;
    let path = captures_dir(state).join(&name);
    let bytes = match fs::read(&path) {
        Ok(bytes) if bytes.len() <= capture::MAX_AUDIO_BYTES => bytes,
        Ok(_) => return Err(Response::error(413, "That voice note is too large")),
        Err(_) => return Err(Response::error(500, "Cannot read the voice note")),
    };
    let extension = capture::sniff_audio(&bytes)
        .ok_or_else(|| Response::error(415, "That is not an audio recording this site can read"))?;
    Ok((path, bytes, extension))
}

fn company_of(kind: AssistantProviderKind) -> &'static str {
    match kind {
        AssistantProviderKind::OpenAi => "OpenAI",
        AssistantProviderKind::Gemini => "Google",
        _ => "",
    }
}

/// The site's transcriber, ready to use, or the refusal to answer with: the local engine, the
/// helper's own company when it takes audio, or a hearing key from the environment. Shared by a
/// job's voice note and a story told out loud.
pub(super) fn transcriber(
    state: &AppState,
) -> Result<(Box<dyn AssistantTranscriber>, &'static str), Response> {
    let (config, credential) = assistant_provider_snapshot(state)?;
    let timeout = assistant_provider_timeout(config.knowledge_checks.provider, cfg!(test));
    match engine_for(&config) {
        Engine::Local(command) => Ok((
            Box::new(LocalCommandTranscriber::new(command, timeout)),
            "local",
        )),
        Engine::Provider { kind, model } => {
            match ProviderTranscriber::new(kind, credential, &model, timeout) {
                Ok(provider) => Ok((Box::new(provider), "provider")),
                Err(error) => Err(review_error(error)),
            }
        }
        Engine::Hearing {
            kind,
            model,
            credential,
        } => match ProviderTranscriber::new(kind, Some(credential), &model, timeout) {
            Ok(provider) => Ok((Box::new(provider), "provider")),
            Err(error) => Err(review_error(error)),
        },
        Engine::Unavailable(reason) => Err(Response::json(
            404,
            &json!({ "error": reason, "code": "not-configured" }),
        )),
    }
}

fn kb(bytes: usize) -> usize {
    bytes.div_ceil(1024)
}

/// What a transcription would send and where, written for the author to read before confirming. It names
/// the audio only: no title, no notes, no photo and no context goes with a recording.
fn disclosure(engine: &Engine, audio: Option<(usize, &str)>) -> Json {
    let sends = audio
        .map(|(bytes, extension)| {
            json!([format!(
                "Your voice note ({} KB, {extension}). Nothing else: no notes, photos, title or voice guide."
                , kb(bytes))])
        })
        .unwrap_or_else(|| json!(["Your voice note, and nothing else."]));
    match engine {
        Engine::Local(_) => json!({
            "available": true,
            "engine": "local",
            "company": null,
            "destination": "this server",
            "model": null,
            "leavesServer": false,
            "sends": sends,
            "keeps": "The transcript is kept privately on your server, beside the note, and shown to you as notes to edit.",
        }),
        Engine::Provider { kind, model } | Engine::Hearing { kind, model, .. } => json!({
            "available": true,
            "engine": "provider",
            // The company by name, so a page can say "What goes to OpenAI" (G76).
            "company": company_of(*kind),
            "provider": kind.as_str(),
            "destination": assistant_provider_destination(*kind),
            "model": if *kind == AssistantProviderKind::OpenAi { OPENAI_TRANSCRIPTION_MODEL } else { model.as_str() },
            "leavesServer": true,
            "sends": sends,
            "keeps": "The transcript is kept privately on your server, beside the note, and shown to you as notes to edit. The provider's own retention rules apply to what it receives.",
        }),
        Engine::Unavailable(reason) => {
            json!({ "available": false, "engine": "none", "reason": reason })
        }
    }
}

/// `GET assistant/transcribe[?capture=<id>]`: whether transcription is possible and the disclosure to show
/// before sending. Reads configuration and the stored note's size; it contacts nothing.
pub(super) fn preview(state: &AppState, req: &Request) -> Response {
    let config = match site::load_config(&state.root) {
        Ok(config) => config,
        Err(error) => {
            return Response::error(
                500,
                &format!("Cannot read assistant configuration: {error}"),
            )
        }
    };
    let engine = engine_for(&config);
    let mut audio = None;
    let mut transcript = false;
    if let Some(id) = req.query.get("capture") {
        let (_, bytes, extension) = match stored_note(state, id) {
            Ok(note) => note,
            Err(response) => return response,
        };
        audio = Some((bytes.len(), extension));
        transcript = capture::transcript_file_name(id)
            .is_some_and(|name| captures_dir(state).join(name).is_file());
    }
    let mut preview = disclosure(&engine, audio);
    preview["hasTranscript"] = json!(transcript);
    preview["maxTranscriptChars"] = json!(capture::MAX_TRANSCRIPT_CHARS);
    Response::json(200, &preview)
}

/// `POST assistant/transcribe` with `{ captureId, confirmed: true }`.
pub(super) fn transcribe(state: &AppState, req: &Request) -> Response {
    if let Err(response) = require_json(req) {
        return response;
    }
    let body: Json = match serde_json::from_slice(&req.body) {
        Ok(body) => body,
        Err(_) => return Response::error(400, "Invalid transcription request"),
    };
    let Some(id) = body["captureId"].as_str() else {
        return Response::error(400, "Name the capture to transcribe");
    };
    if let Err(response) = super::provider_confirmed(&body) {
        return response;
    }
    let (path, bytes, extension) = match stored_note(state, id) {
        Ok(note) => note,
        Err(response) => return response,
    };
    let (transcriber, _) = match transcriber(state) {
        Ok(found) => found,
        Err(response) => return response,
    };
    let _permit = match state.assistant_operations.try_acquire() {
        Some(permit) => permit,
        None => {
            return Response::json(
                429,
                &json!({ "error": "Two Assistant operations are already running; try again shortly", "code": "concurrency-limit" }),
            )
        }
    };
    let raw = match transcriber.transcribe(&AudioClip {
        bytes: &bytes,
        extension,
        path: &path,
    }) {
        Ok(raw) => raw,
        Err(error) => return review_error(error),
    };
    let (transcript, truncated) = capture::clean_transcript(&raw);
    if transcript.is_empty() {
        return Response::json(
            422,
            &json!({ "error": "No words were found in the recording. Type your notes instead.", "code": "empty-transcript" }),
        );
    }
    let name = capture::transcript_file_name(id).expect("the id was checked");
    {
        let _guard = lock(&state.build);
        let _filesystem_transaction = match content_transaction(state) {
            Ok(lock) => lock,
            Err(response) => return response,
        };
        if let Err(error) =
            fsutil::write_file(&captures_dir(state).join(&name), transcript.as_bytes())
        {
            return Response::error(500, &error);
        }
    }
    eprintln!(
        "admin: kept a transcript ({} characters)",
        transcript.chars().count()
    );
    Response::json(
        200,
        &json!({ "transcript": transcript, "truncated": truncated, "untrusted": true }),
    )
}

fn bounded_line(body: &Json, field: &str, max: usize) -> Result<String, Response> {
    match &body[field] {
        Json::Null => Ok(String::new()),
        Json::String(text)
            if text.chars().count() <= max && !text.chars().any(char::is_control) =>
        {
            Ok(text.trim().to_string())
        }
        _ => Err(Response::error(
            400,
            &format!("`{field}` must be a short line of text"),
        )),
    }
}

/// `POST assistant/job-draft` (ADR 0303): the author's notes become a title, a description and the four
/// scaffold sections. The selected context, including the voice guide, is read again on the server from the
/// ids alone (ADR 0278). The result is checked against the strict schema and returned as a proposal; nothing
/// is written.
pub(super) fn job_draft(state: &AppState, req: &Request) -> Response {
    use crate::assistant::job_draft::{
        JobDraftInput, MAX_FIELD_CHARS, MAX_PHOTO_ALTS, MAX_PHOTO_ALT_CHARS,
    };
    if let Err(response) = require_json(req) {
        return response;
    }
    let body: Json = match serde_json::from_slice(&req.body) {
        Ok(body) => body,
        Err(_) => return Response::error(400, "Invalid job draft request"),
    };
    if let Err(response) = super::provider_confirmed(&body) {
        return response;
    }
    let notes = match body["notes"].as_str() {
        Some(notes)
            if notes.chars().count() <= capture::MAX_NOTES_CHARS && !notes.contains('\0') =>
        {
            notes.trim().to_string()
        }
        _ => {
            return coded_error(
                400,
                "notes-too-long",
                &format!(
                    "Notes must be text of at most {} characters",
                    capture::MAX_NOTES_CHARS
                ),
            )
        }
    };
    if notes.is_empty() {
        return coded_error(
            400,
            "no-notes",
            "Add a few words or a transcript to draft from",
        );
    }
    let mut photo_alts = Vec::new();
    match &body["photoAlts"] {
        Json::Null => {}
        Json::Array(alts) if alts.len() <= MAX_PHOTO_ALTS => {
            for alt in alts {
                match alt.as_str() {
                    Some(alt)
                        if alt.chars().count() <= MAX_PHOTO_ALT_CHARS
                            && !alt.chars().any(char::is_control) =>
                    {
                        if !alt.trim().is_empty() {
                            photo_alts.push(alt.trim().to_string());
                        }
                    }
                    _ => {
                        return coded_error(
                            400,
                            "bad-photo-alt",
                            "A photo description is too long or invalid",
                        )
                    }
                }
            }
        }
        _ => {
            return coded_error(
                400,
                "bad-photo-alt",
                "`photoAlts` must be a short list of text",
            )
        }
    }
    let input = JobDraftInput {
        notes,
        photo_alts,
        trade: match bounded_line(&body, "trade", MAX_FIELD_CHARS) {
            Ok(value) => value,
            Err(response) => return response,
        },
        service: match bounded_line(&body, "service", MAX_FIELD_CHARS) {
            Ok(value) => value,
            Err(response) => return response,
        },
        town: match bounded_line(&body, "town", MAX_FIELD_CHARS) {
            Ok(value) => value,
            Err(response) => return response,
        },
    };
    let context_ids = if body["contextIds"].is_null() {
        Vec::new()
    } else {
        match selected_ids(&body, "contextIds", 16) {
            Ok(ids) => ids,
            Err(response) => return response,
        }
    };
    let context = {
        let _assistant_lock = lock(&state.build);
        match resolve_review_contexts(&state.root, &context_ids) {
            Ok(context) => context,
            Err(response) => return response,
        }
    };
    let (config, credential) = match assistant_provider_snapshot(state) {
        Ok(snapshot) => snapshot,
        Err(response) => return response,
    };
    let provider = match configured_assistant_provider(
        &config,
        credential,
        assistant_provider_timeout(config.knowledge_checks.provider, cfg!(test)),
    ) {
        Ok(provider) => provider,
        Err(error) => return review_error(error),
    };
    let request = AssistantRequest::job_draft(config.knowledge_checks.model, input, context);
    let _permit = match state.assistant_operations.try_acquire() {
        Some(permit) => permit,
        None => {
            return Response::json(
                429,
                &json!({ "error": "Two Assistant operations are already running; try again shortly", "code": "concurrency-limit" }),
            )
        }
    };
    match provider.generate(&request) {
        Ok(AssistantResult::JobDraft(draft)) => Response::json(
            200,
            &json!({ "draft": draft, "body": draft.body(), "proposal": true }),
        ),
        Ok(_) => Response::error(502, "Assistant provider returned the wrong result type"),
        Err(error) => review_error(error),
    }
}
