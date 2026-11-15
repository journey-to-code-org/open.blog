//! Getting started's routes (Studio R9b, G70 to G74): the switch in effect, each account's
//! record, the reminder in Write, and every account's line for whoever helps with the site.
//!
//! Every route sits behind the session, every write behind the CSRF check. In `rehearse` the
//! routes read and write the practice record only: the real record is never touched, whatever a
//! request says. A request that asks for practice while the server isn't rehearsing is refused.
//! Nothing here holds a story: a record names pieces by id. Logs are events ("grammi finished"),
//! never words.

use super::*;
use crate::onboarding::{self as core, Mode, Record, Status, StepState};

/// A record and a few choices: far smaller than this.
pub(super) const MAX_REQUEST_BYTES: usize = 16 * 1024;

/// The mode in effect: the server's switch, then the site's file, then off.
pub(super) fn mode(state: &AppState) -> Mode {
    match site::load_config(&state.root) {
        Ok(config) => core::mode_for(state.onboarding_env.as_deref(), &config),
        // A site whose settings can't be read still honours the server's switch.
        Err(_) => core::mode_from(state.onboarding_env.as_deref(), None),
    }
}

fn body_object(req: &Request) -> Result<Json, Response> {
    require_json(req)?;
    if req.body.len() > MAX_REQUEST_BYTES {
        return Err(Response::error(413, "That request is too large"));
    }
    match serde_json::from_slice::<Json>(&req.body) {
        Ok(body) if body.is_object() => Ok(body),
        _ => Err(Response::error(400, "Invalid JSON")),
    }
}

/// Whether the helper has no usable key, so Getting started begins by asking for one. A key in
/// the server's environment, or one saved, means the step is never shown.
fn needs_key(state: &AppState) -> bool {
    let Ok(config) = site::load_config(&state.root) else {
        return false;
    };
    match assistant_credential_summary(&state.root, &config) {
        Ok(summary) => matches!(
            assistant_credential_state(&summary),
            "not-set" | "other-provider"
        ),
        Err(_) => false,
    }
}

/// The record a run works on, for this mode: the practice one in `rehearse` (and a finished
/// practice run starts afresh), else the real one unless it finished another round.
fn working_record(state: &AppState, mode: &Mode, user: &str) -> Result<Option<Record>, String> {
    let record = core::read(&state.root, user, mode.practice())?;
    if mode.practice() {
        return Ok(record.filter(|record| record.status == Status::InProgress));
    }
    Ok(core::current(mode, record.as_ref()).cloned())
}

fn record_json(record: Option<&Record>) -> Json {
    record.map_or(Json::Null, |record| json!(record))
}

fn etag_of(record: Option<&Record>) -> String {
    record.map(Record::etag).unwrap_or_default()
}

/// What `meta` says: `{ mode, practice, due, step, total, resume }` and nothing else.
pub(super) fn meta_json(state: &AppState, user: &str) -> Json {
    let mode = mode(state);
    let key = needs_key(state);
    let (record, readable) = match working_record(state, &mode, user) {
        Ok(record) => (record, true),
        Err(_) => (None, false),
    };
    let real = if mode.practice() {
        None
    } else {
        core::read(&state.root, user, false).ok().flatten()
    };
    let due = readable
        && core::due(
            &mode,
            if mode.practice() {
                record.as_ref()
            } else {
                real.as_ref()
            },
        );
    json!({
        "mode": mode.name(),
        "practice": mode.practice(),
        "due": due,
        "step": record.as_ref().map_or(if key { "helper" } else { "stories" }, |r| r.step.as_str()),
        "total": record.as_ref().map_or(if key { 3 } else { 2 }, |r| r.total),
        "resume": record.as_ref().is_some_and(|r| r.status == Status::InProgress),
    })
}

/// `GET onboarding`: this account's record, whether Getting started is due, and its revision.
pub(super) fn get(state: &AppState, user: &str) -> Response {
    let mode = mode(state);
    let record = match working_record(state, &mode, user) {
        Ok(record) => record,
        Err(error) => {
            return Response::json(
                200,
                &json!({
                    "mode": mode.name(), "practice": mode.practice(), "due": false,
                    "record": null, "etag": "", "unreadable": true, "needsKey": needs_key(state),
                    "error": error,
                }),
            )
        }
    };
    let real = if mode.practice() {
        record.clone()
    } else {
        core::read(&state.root, user, false).ok().flatten()
    };
    Response::json(
        200,
        &json!({
            "mode": mode.name(),
            "practice": mode.practice(),
            "due": core::due(&mode, real.as_ref()),
            "record": record_json(record.as_ref()),
            "etag": etag_of(record.as_ref()),
            "needsKey": needs_key(state),
        }),
    )
}

fn bad_step(what: &str) -> Response {
    Response::json(
        422,
        &json!({ "error": format!("That isn't a step of Getting started ({what})"), "code": "bad-step" }),
    )
}

/// `PUT onboarding`: move this account's Getting started along. The body is `{ etag, step?,
/// steps?, status?, stories?, total?, lastAutoOpen?, restart?, practice? }`; only what is named
/// changes. `etag` must be the revision that was read (`""` when there was none): another phone
/// that got there first is a `stale` 409 carrying the newer record. A step, a state or a story
/// id that isn't one is `bad-step`. `practice: true` anywhere but a rehearsing server is
/// `practice-only`.
pub(super) fn put(state: &AppState, req: &Request, user: &str) -> Response {
    let body = match body_object(req) {
        Ok(body) => body,
        Err(response) => return response,
    };
    let mode = mode(state);
    if body["practice"] == true && !mode.practice() {
        return coded_error(
            409,
            "practice-only",
            "A practice run is only kept while the server is rehearsing Getting started",
        );
    }
    let practice = mode.practice();
    let existing = match working_record(state, &mode, user) {
        Ok(record) => record,
        Err(error) => return coded_error(409, "unreadable", &error),
    };
    if body["etag"].as_str().unwrap_or("") != etag_of(existing.as_ref()) {
        return Response::json(
            409,
            &json!({
                "error": "Getting started was changed somewhere else",
                "code": "stale",
                "record": record_json(existing.as_ref()),
                "etag": etag_of(existing.as_ref()),
            }),
        );
    }
    let now = clock::now();
    let restart = body["restart"] == true;
    let mut record = match (&existing, restart) {
        (Some(record), false) => record.clone(),
        (old, _) => {
            let mut fresh = Record::begin(mode.round(), now);
            let key = needs_key(state);
            fresh.total = if key { 3 } else { 2 };
            fresh.step = if key { "helper" } else { "stories" }.into();
            if !key {
                fresh.steps.helper = StepState::NotNeeded;
            }
            // Starting again keeps what she said about being reminded.
            if let Some(old) = old {
                fresh.nudge = old.nudge.clone();
                fresh.last_auto_open = old.last_auto_open.clone();
                fresh.round = old.round.clone();
            }
            fresh
        }
    };
    if record.status != Status::InProgress && !restart {
        // A finished run only changes by starting again.
        if body.get("step").is_some()
            || body.get("steps").is_some()
            || body.get("stories").is_some()
        {
            return bad_step("it is finished");
        }
    }
    match &body["total"] {
        Json::Null => {}
        value => match value.as_u64() {
            // Fixed when the run starts: only a record just begun takes it.
            Some(total @ 1..=3) if existing.is_none() || restart => record.total = total as u8,
            Some(1..=3) => {}
            _ => return bad_step("total"),
        },
    }
    match &body["step"] {
        Json::Null => {}
        Json::String(step) if core::STEPS.contains(&step.as_str()) => record.step = step.clone(),
        _ => return bad_step("step"),
    }
    match &body["steps"] {
        Json::Null => {}
        Json::Object(steps) => {
            for (name, value) in steps {
                let Some(state_of) = value.as_str().and_then(StepState::parse) else {
                    return bad_step("a step's state");
                };
                match name.as_str() {
                    "helper" => record.steps.helper = state_of,
                    "stories" => record.steps.stories = state_of,
                    "voice" => record.steps.voice = state_of,
                    _ => return bad_step("a step's name"),
                }
            }
        }
        _ => return bad_step("steps"),
    }
    match &body["stories"] {
        Json::Null => {}
        Json::Array(ids) if ids.len() <= 24 => {
            let mut stories = Vec::new();
            for id in ids {
                match id.as_str() {
                    Some(id) if core::valid_piece_id(id) => {
                        if !stories.iter().any(|kept| kept == id) {
                            stories.push(id.to_string());
                        }
                    }
                    _ => return bad_step("a story"),
                }
            }
            record.stories = stories;
        }
        _ => return bad_step("stories"),
    }
    let was = record.status;
    match &body["status"] {
        Json::Null => {}
        Json::String(status) => {
            let next = match status.as_str() {
                "in-progress" => Status::InProgress,
                "done" => Status::Done,
                "skipped" => Status::Skipped,
                _ => return bad_step("status"),
            };
            if was != Status::InProgress && next != was {
                return bad_step("it is finished");
            }
            record.status = next;
        }
        _ => return bad_step("status"),
    }
    if record.status != Status::InProgress && record.finished_at.is_none() {
        record.finished_at = Some(now.rfc3339());
        record.step = "done".into();
    }
    if body["lastAutoOpen"] == true {
        record.last_auto_open = Some(now.rfc3339());
    }
    if let Err(error) = core::write(&state.root, user, practice, &record) {
        return Response::error(500, &voice::scrub_root(&state.root, &error));
    }
    if was == Status::InProgress && record.status != Status::InProgress {
        let how = if record.status == Status::Done {
            "finished"
        } else {
            "skipped the rest"
        };
        eprintln!(
            "onboarding: {user} {how}{} ({})",
            if practice { " (practice)" } else { "" },
            core::finished_words(&record)
        );
    }
    Response::json(
        200,
        &json!({
            "record": record,
            "etag": record.etag(),
            "practice": practice,
            "due": core::due(&mode, Some(&record)),
        }),
    )
}

/// How many pieces this account has in the library the mode works in. A piece that doesn't say
/// who wrote it (made before pieces said so) counts: nobody is nudged on a site that has some.
fn own_pieces(state: &AppState, mode: &Mode, user: &str) -> usize {
    let root = if mode.practice() {
        core::practice_voice_root(&state.root)
    } else {
        state.root.clone()
    };
    crate::voice_store::list(&root)
        .into_iter()
        .filter(|piece| piece.valid && piece.by.as_deref().is_none_or(|by| by == user))
        .count()
}

/// `GET onboarding/nudge`: whether the reminder in Write is due for this account, by the
/// server's rule. Read only.
pub(super) fn nudge(state: &AppState, user: &str) -> Response {
    let mode = mode(state);
    let record = core::read(&state.root, user, mode.practice())
        .ok()
        .flatten();
    let due = record.is_some()
        && core::nudge_due(
            &mode,
            record.as_ref(),
            own_pieces(state, &mode, user),
            clock::now(),
        );
    Response::json(200, &json!({ "due": due }))
}

/// `POST onboarding/nudge`: what happened to the reminder: `{ event: "shown" | "later" |
/// "accepted" | "stop" | "unstop", newPost? }`. `shown` is counted only for a new post, only
/// when the reminder was due, and once a day.
pub(super) fn nudge_event(state: &AppState, req: &Request, user: &str) -> Response {
    let body = match body_object(req) {
        Ok(body) => body,
        Err(response) => return response,
    };
    let Some(event) = body["event"].as_str() else {
        return coded_error(400, "bad-event", "Name what happened as `event`");
    };
    let mode = mode(state);
    let practice = mode.practice();
    let mut record = match core::read(&state.root, user, practice) {
        Ok(Some(record)) => record,
        Ok(None) => return coded_error(409, "no-record", "Getting started was never begun"),
        Err(error) => return coded_error(409, "unreadable", &error),
    };
    let now = clock::now();
    let mut counted = true;
    if event == "shown" {
        if body["newPost"] != true {
            return coded_error(422, "not-new-post", "The reminder only shows on a new post");
        }
        counted = core::nudge_due(&mode, Some(&record), own_pieces(state, &mode, user), now);
    }
    if counted && core::nudge_event(&mut record, event, now).is_err() {
        return coded_error(400, "bad-event", "That isn't something the reminder does");
    }
    if counted {
        if let Err(error) = core::write(&state.root, user, practice, &record) {
            return Response::error(500, &voice::scrub_root(&state.root, &error));
        }
    }
    Response::json(
        200,
        &json!({ "counted": counted, "shown": record.nudge.shown.len(), "stopped": record.nudge.stopped }),
    )
}

fn user_names(state: &AppState) -> Result<Vec<String>, Response> {
    let config = site::load_config(&state.root).map_err(|error| Response::error(500, &error))?;
    let users = crate::auth::Users::load(&state.root.join(&config.admin.users_file))
        .map_err(|error| Response::error(500, &error))?;
    Ok(users.users.iter().map(|user| user.name.clone()).collect())
}

/// `GET onboarding/accounts`: the switch in effect and where each account stands, for whoever
/// helps with the site: status, round, how many stories, each step's state, dates. Never a story.
pub(super) fn accounts(state: &AppState) -> Response {
    let names = match user_names(state) {
        Ok(names) => names,
        Err(response) => return response,
    };
    let mode = mode(state);
    let rows: Vec<Json> = core::accounts(&state.root, &names)
        .iter()
        .map(|account| {
            let record = account.record.as_ref();
            json!({
                "user": account.user,
                "status": if account.unreadable { "unreadable" } else {
                    match record.map(|r| r.status) {
                        None => "not-started",
                        Some(Status::InProgress) => "in-progress",
                        Some(Status::Done) => "done",
                        Some(Status::Skipped) => "skipped",
                    }
                },
                "round": record.map(|r| r.round.clone()),
                "step": record.map(|r| r.step.clone()),
                "stories": record.map_or(0, |r| r.stories.len()),
                "helper": record.map(|r| r.steps.helper.as_str()),
                "voice": record.map(|r| r.steps.voice.as_str()),
                "startedAt": record.map(|r| r.started_at.clone()),
                "finishedAt": record.and_then(|r| r.finished_at.clone()),
                "line": core::account_line(account),
            })
        })
        .collect();
    Response::json(
        200,
        &json!({
            "mode": mode.name(),
            "value": mode.value,
            "round": mode.round(),
            "source": mode.source.as_str(),
            "sourceWords": core::source_words(&mode),
            "problems": mode.problems,
            "filesMayVanish": state.files_may_vanish(),
            "accounts": rows,
        }),
    )
}

fn named_user(state: &AppState, body: &Json) -> Result<String, Response> {
    let names = user_names(state)?;
    match body["user"].as_str() {
        Some(user) if names.iter().any(|name| name == user) => Ok(user.to_string()),
        _ => Err(coded_error(
            404,
            "unknown-user",
            "That account isn't on this site",
        )),
    }
}

/// `POST onboarding/reset`: `{ user }`. Show that account Getting started again at its next
/// sign-in, by removing its record. Its stories are not touched. Any signed-in account may (the
/// accounts of a site are equal); each reset is logged. The answer carries the record that was
/// there, so it can be put back.
pub(super) fn reset(state: &AppState, req: &Request, actor: &str) -> Response {
    let body = match body_object(req) {
        Ok(body) => body,
        Err(response) => return response,
    };
    let user = match named_user(state, &body) {
        Ok(user) => user,
        Err(response) => return response,
    };
    let was = core::read(&state.root, &user, false).ok().flatten();
    if let Err(error) = core::remove(&state.root, &user, false) {
        return Response::error(500, &voice::scrub_root(&state.root, &error));
    }
    eprintln!("onboarding: {actor} reset {user}");
    Response::json(
        200,
        &json!({ "user": user, "record": record_json(was.as_ref()) }),
    )
}

/// `PUT onboarding/restore`: `{ user, record }`. Put back the record a reset removed (Undo).
pub(super) fn restore(state: &AppState, req: &Request, actor: &str) -> Response {
    let body = match body_object(req) {
        Ok(body) => body,
        Err(response) => return response,
    };
    let user = match named_user(state, &body) {
        Ok(user) => user,
        Err(response) => return response,
    };
    let Ok(record) = serde_json::from_value::<Record>(body["record"].clone()) else {
        return bad_step("the record");
    };
    if let Err(error) = core::write(&state.root, &user, false, &record) {
        return coded_error(422, "bad-step", &error);
    }
    eprintln!("onboarding: {actor} restored {user}");
    Response::json(
        200,
        &json!({ "user": user, "record": record, "etag": record.etag() }),
    )
}
