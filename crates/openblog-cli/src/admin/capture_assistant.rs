//! Turning a captured voice note into words (ADR 0420, #502): disclose what would be sent, send it only after
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
    Unavailable(&'static str),
}

fn engine_for(config: &SiteConfig) -> Engine {
    if let Some(command) = local_command_from_environment() {
        return Engine::Local(command);
    }
    let provider = config.knowledge_checks.provider;
    if !provider_transcribes(provider) {
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
        return Err(Response::error(400, "That capture id is not valid"));
    }
    let name = stored_capture_audio(state, id)
        .ok_or_else(|| Response::error(404, "No voice note is kept for that capture"))?;
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
            "destination": "this server",
            "model": null,
            "leavesServer": false,
            "sends": sends,
            "keeps": "The transcript is kept privately on your server, beside the note, and shown to you as notes to edit.",
        }),
        Engine::Provider { kind, model } => json!({
            "available": true,
            "engine": "provider",
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
    if body["confirmed"] != true {
        return Response::error(
            400,
            "Confirm what will be sent before the recording is transcribed",
        );
    }
    let (path, bytes, extension) = match stored_note(state, id) {
        Ok(note) => note,
        Err(response) => return response,
    };
    let (config, credential) = match assistant_provider_snapshot(state) {
        Ok(snapshot) => snapshot,
        Err(response) => return response,
    };
    let timeout = assistant_provider_timeout(config.knowledge_checks.provider, cfg!(test));
    let transcriber: Box<dyn AssistantTranscriber> = match engine_for(&config) {
        Engine::Local(command) => Box::new(LocalCommandTranscriber::new(command, timeout)),
        Engine::Provider { kind, model } => {
            match ProviderTranscriber::new(kind, credential, &model, timeout) {
                Ok(provider) => Box::new(provider),
                Err(error) => return review_error(error),
            }
        }
        Engine::Unavailable(reason) => {
            return Response::json(404, &json!({ "error": reason, "code": "not-configured" }))
        }
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
