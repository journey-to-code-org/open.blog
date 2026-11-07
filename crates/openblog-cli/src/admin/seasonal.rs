//! Admin routes for seasonal reminders (ADR 0354 to 0356, #525, #526):
//! `GET` and `PUT /admin/api/seasonal`, `POST /admin/api/seasonal/snooze` and `/open`.
//!
//! All sit behind the session and, for writes, the CSRF and same-origin checks in `api`. A save is
//! judged by the core and changes only the `seasonalPrompts` member of `openblog.json`. The only
//! thing a reminder can do is open an unpublished draft: no route here builds, publishes or sends.

use openblog_core::seasonal::{self, Reminder, SeasonalConfig, SEASONAL_VERSION};

use super::*;
use crate::config_text;
use crate::seasonal_store;

const MAX_REQUEST_BYTES: usize = 16 * 1024;

fn revision(stored: &Json) -> String {
    etag_bytes(stored.to_string().as_bytes())
}

fn stored_block(config: &Json) -> Json {
    match config.get("seasonalPrompts") {
        Some(Json::Object(object)) => Json::Object(object.clone()),
        _ => json!({}),
    }
}

fn status_json(reminder: &Reminder) -> Json {
    let (until, draft) = match &reminder.status {
        seasonal::Status::Snoozed(until) => (Json::from(until.clone()), Json::Null),
        seasonal::Status::Opened(path) => (Json::Null, Json::from(path.clone())),
        _ => (Json::Null, Json::Null),
    };
    json!({
        "key": reminder.key,
        "id": reminder.id,
        "topic": reminder.topic,
        "prompt": reminder.prompt,
        "opens": reminder.opens,
        "closes": reminder.closes,
        "status": reminder.status.id(),
        "snoozedUntil": until,
        "draft": draft,
    })
}

/// Whether the Assistant has a voice guide or voice samples to write a first draft from.
fn voice_ready(root: &Path) -> bool {
    crate::voice_assistant::read_guide(root).is_some() || !crate::voice_store::list(root).is_empty()
}

fn today_number() -> i64 {
    clock::now().unix().div_euclid(86_400)
}

/// The reminders for the saved config today, with the state the site remembers.
fn current(state: &AppState, config: &SiteConfig) -> Vec<Reminder> {
    if !config.seasonal_prompts.enabled {
        return Vec::new();
    }
    let topics = config.seasonal_prompts.resolve(&config.business.trade);
    seasonal::reminders(
        &topics,
        today_number(),
        &seasonal_store::read_state(&state.root),
    )
}

fn describe(state: &AppState, bytes: &[u8]) -> Result<Json, String> {
    let source = std::str::from_utf8(bytes).map_err(|error| error.to_string())?;
    let raw: Json = serde_json::from_str(source)
        .map_err(|_| "openblog.json must contain a valid JSON object".to_string())?;
    let config = SiteConfig::from_json(source)?;
    let stored = stored_block(&raw);
    let topics = config.seasonal_prompts.resolve(&config.business.trade);
    Ok(json!({
        "version": SEASONAL_VERSION,
        "enabled": config.seasonal_prompts.enabled,
        "etag": revision(&stored),
        "trade": config.business.trade,
        "entries": config.seasonal_prompts.to_value()["topics"].clone(),
        "topics": topics.iter().map(|topic| json!({
            "id": topic.id,
            "topic": topic.topic,
            "prompt": topic.prompt,
            "start": topic.start.text(),
            "end": topic.end.text(),
            "disabled": topic.disabled,
            "custom": topic.custom,
        })).collect::<Vec<_>>(),
        "reminders": current(state, &config).iter().map(status_json).collect::<Vec<_>>(),
        "voiceReady": voice_ready(&state.root),
        "today": clock::now().ymd(),
    }))
}

fn load(state: &AppState) -> Result<(String, SiteConfig), Response> {
    let text = fs::read_to_string(state.root.join(site::CONFIG_FILE))
        .map_err(|error| Response::error(500, &format!("cannot read openblog.json: {error}")))?;
    let config = SiteConfig::from_json(&text).map_err(|error| Response::error(500, &error))?;
    Ok((text, config))
}

pub(super) fn get_seasonal(state: &AppState) -> Response {
    let _transaction = match content_transaction(state) {
        Ok(lock) => lock,
        Err(response) => return response,
    };
    match fs::read(state.root.join(site::CONFIG_FILE))
        .map_err(|error| format!("cannot read openblog.json: {error}"))
        .and_then(|bytes| describe(state, &bytes))
    {
        Ok(body) => Response::json(200, &body),
        Err(error) => Response::error(500, &error),
    }
}

fn unprocessable(messages: &[String]) -> Response {
    Response::json(
        422,
        &json!({ "error": messages.join("; "), "problems": messages }),
    )
}

pub(super) fn save_seasonal(state: &AppState, req: &Request) -> Response {
    if let Err(response) = require_json(req) {
        return response;
    }
    if req.body.len() > MAX_REQUEST_BYTES {
        return Response::error(413, "The reminder settings are too large");
    }
    let body: Json = match serde_json::from_slice(&req.body) {
        Ok(Json::Object(body)) => Json::Object(body),
        _ => return Response::error(400, "Invalid JSON"),
    };
    let Some(etag) = body.get("etag").and_then(Json::as_str) else {
        return Response::error(422, "etag is required");
    };
    let submitted = match body.get("seasonalPrompts") {
        Some(value @ Json::Object(_)) => value.clone(),
        Some(Json::Null) | None => json!({}),
        Some(_) => return Response::error(422, "seasonalPrompts must be an object"),
    };
    let checked = match SeasonalConfig::from_value(&submitted) {
        Ok(checked) => checked,
        Err(errors) => return unprocessable(&errors),
    };
    if let Some(problem) = seasonal::incomplete(&checked).first() {
        return unprocessable(std::slice::from_ref(problem));
    }
    let _transaction = match content_transaction(state) {
        Ok(lock) => lock,
        Err(response) => return response,
    };
    let path = state.root.join(site::CONFIG_FILE);
    let (current_text, _) = match load(state) {
        Ok(loaded) => loaded,
        Err(response) => return response,
    };
    let raw: Json = match serde_json::from_str(&current_text) {
        Ok(Json::Object(object)) => Json::Object(object),
        _ => return Response::error(500, "openblog.json must contain a valid JSON object"),
    };
    if revision(&stored_block(&raw)) != etag {
        let mut conflict = describe(state, current_text.as_bytes()).unwrap_or_else(|_| json!({}));
        conflict["error"] =
            json!("The reminder settings changed since you opened them; reload before saving");
        return Response::json(409, &conflict);
    }
    let value = checked.to_value();
    let member = if checked.is_default() {
        None
    } else {
        Some(&value)
    };
    let candidate = match config_text::set_member(&current_text, "seasonalPrompts", member) {
        Ok(text) => text,
        Err(error) => return Response::error(500, &error),
    };
    if let Err(error) = SiteConfig::from_json(&candidate) {
        return Response::error(422, &error);
    }
    if let Err(error) = write_atomic(&path, &candidate) {
        return Response::error(500, &error);
    }
    // Reminders change nothing a reader sees, so there is nothing to rebuild.
    match describe(state, candidate.as_bytes()) {
        Ok(described) => Response::json(200, &described),
        Err(error) => Response::error(500, &error),
    }
}

/// The reminder named by a request, only if it is listed today for the saved settings.
fn named_reminder(state: &AppState, body: &Json) -> Result<Reminder, Response> {
    let key = body
        .get("key")
        .and_then(Json::as_str)
        .filter(|key| seasonal::valid_key(key))
        .ok_or_else(|| Response::error(422, "key is not a reminder key"))?;
    let (_, config) = load(state)?;
    if !config.seasonal_prompts.enabled {
        return Err(Response::error(409, "Seasonal reminders are off"));
    }
    current(state, &config)
        .into_iter()
        .find(|reminder| reminder.key == key)
        .ok_or_else(|| Response::error(404, "That reminder is not listed today"))
}

fn body_object(req: &Request) -> Result<Json, Response> {
    require_json(req)?;
    if req.body.len() > 1024 {
        return Err(Response::error(413, "The request is too large"));
    }
    match serde_json::from_slice(&req.body) {
        Ok(body @ Json::Object(_)) => Ok(body),
        _ => Err(Response::error(400, "Invalid JSON")),
    }
}

pub(super) fn snooze(state: &AppState, req: &Request) -> Response {
    let body = match body_object(req) {
        Ok(body) => body,
        Err(response) => return response,
    };
    let _transaction = match content_transaction(state) {
        Ok(lock) => lock,
        Err(response) => return response,
    };
    let reminder = match named_reminder(state, &body) {
        Ok(found) => found,
        Err(response) => return response,
    };
    if matches!(reminder.status, seasonal::Status::Opened(_)) {
        return Response::error(409, "A draft was already opened for this reminder");
    }
    let days = body.get("days").and_then(Json::as_i64).unwrap_or(7);
    let until = match seasonal::snooze_until(today_number(), days) {
        Ok(until) => until,
        Err(error) => return Response::error(422, &error),
    };
    if let Err(error) = seasonal_store::snooze(&state.root, &reminder.key, &until) {
        return Response::error(500, &error);
    }
    Response::json(200, &json!({ "key": reminder.key, "snoozedUntil": until }))
}

pub(super) fn open(state: &AppState, req: &Request) -> Response {
    let body = match body_object(req) {
        Ok(body) => body,
        Err(response) => return response,
    };
    let _transaction = match content_transaction(state) {
        Ok(lock) => lock,
        Err(response) => return response,
    };
    let reminder = match named_reminder(state, &body) {
        Ok(found) => found,
        Err(response) => return response,
    };
    match seasonal_store::open_draft(&state.root, &reminder, &clock::now().ymd()) {
        Ok((path, created)) => Response::json(
            200,
            &json!({
                "key": reminder.key,
                "path": path,
                "created": created,
                "draft": true,
                "voiceReady": voice_ready(&state.root),
            }),
        ),
        Err(error) => Response::error(500, &error),
    }
}
