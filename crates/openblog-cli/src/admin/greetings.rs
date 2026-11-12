//! Admin routes for greeting cards (ADR 0411).
//!
//! Greeting cards are optional and off by default. The address book and the cards live in the
//! site's private Supabase project behind the hosted `greetings` function, which sends each card on
//! its day through Brevo. Admin reaches that function only from this server, with the key from the
//! environment of the process running Admin (`OPENBLOG_GREETINGS_ENDPOINT`,
//! `OPENBLOG_GREETINGS_ADMIN_KEY`), never from `openblog.json`, the repository or a response. Unset
//! or invalid, and every route but `status` is a 404 and nothing is sent anywhere.
//!
//! Every route sits behind the session and, for a write, the CSRF check; a body is bounded before it
//! is read and may hold only the fields its route takes. A reply is rebuilt from the fields Admin
//! shows, so a faulty or hostile function cannot pass anything else through. Names, addresses and
//! messages go only to the signed-in owner and are never logged or placed in an error.

use std::time::Duration;

use super::social::{is_uuid, slug, text, valid_endpoint};
use super::*;

/// The largest request body any greetings route takes (a card's message is at most 4,000 characters).
pub(super) const MAX_GREETINGS_REQUEST_BYTES: usize = 32 * 1024;
const MAX_REPLY_BYTES: u64 = 4 * 1024 * 1024;
const MIN_KEY_CHARS: usize = 32;
const STATUSES: [&str; 5] = ["scheduled", "sending", "sent", "failed", "cancelled"];
const CONTACT_FIELDS: [&str; 3] = ["name", "email", "birthday"];
const CARD_FIELDS: [&str; 9] = [
    "contactId",
    "design",
    "subject",
    "message",
    "signOff",
    "sendOn",
    "hour",
    "timeZone",
    "yearly",
];

pub(super) struct GreetingsConfig {
    endpoint: String,
    key: String,
}

pub(super) enum Configured {
    Off,
    Invalid(Vec<&'static str>),
    On(GreetingsConfig),
}

pub(super) fn configuration(env: &dyn Fn(&str) -> Option<String>) -> Configured {
    let endpoint = env("OPENBLOG_GREETINGS_ENDPOINT").unwrap_or_default();
    let key = env("OPENBLOG_GREETINGS_ADMIN_KEY").unwrap_or_default();
    if endpoint.trim().is_empty() && key.is_empty() {
        return Configured::Off;
    }
    let mut problems = Vec::new();
    let endpoint = valid_endpoint(&endpoint);
    if endpoint.is_none() {
        problems.push("OPENBLOG_GREETINGS_ENDPOINT");
    }
    if key.chars().count() < MIN_KEY_CHARS || key.chars().any(char::is_whitespace) {
        problems.push("OPENBLOG_GREETINGS_ADMIN_KEY");
    }
    match (endpoint, problems.is_empty()) {
        (Some(endpoint), true) => Configured::On(GreetingsConfig { endpoint, key }),
        _ => Configured::Invalid(problems),
    }
}

/// Whether Admin has any greetings settings, valid or not. Only then does the navigation show the page.
pub(super) fn is_configured() -> bool {
    !matches!(configuration(&process_env), Configured::Off)
}

fn process_env(name: &str) -> Option<String> {
    std::env::var(name).ok()
}

fn bad_reply() -> Response {
    Response::error(
        502,
        "The greetings function sent a reply Admin could not use",
    )
}

/// The function's own refusal, reduced to a status Admin may pass on, a fixed message, and the
/// field it names (so the form can point at it).
fn refusal(status: u16, body: &Json) -> Response {
    let code = body.get("error").and_then(slug);
    let field = body.get("field").and_then(slug);
    let message = match (status, code.as_deref()) {
        (401, _) => {
            "The greetings function did not accept Admin's key; check OPENBLOG_GREETINGS_ADMIN_KEY"
        }
        (404, Some("not-enabled")) => {
            "Greeting cards are not switched on where the greetings function runs"
        }
        (404, _) => "That card or person is no longer there; reload",
        (400, Some("name-required")) => "Add the person's name",
        (400, Some("invalid-email")) => {
            "That doesn't look like an email address. Write it like name@example.com"
        }
        (400, Some("invalid-day")) => "Pick a day from the calendar",
        (400, Some("invalid-design")) => "Pick a card design",
        (400, Some("contact-required")) => "Pick who the card is for",
        (400, Some("message-required")) => "Write a message for the card",
        (400, Some("invalid-hour")) => "Pick a time of day",
        (400, Some("invalid-time-zone")) => "That time zone isn't one the calendar knows",
        (409, Some("too-many")) => "That's as many as the address book or card list holds",
        (409, Some("busy")) => "That card is being sent right now; try again in a minute",
        (502, Some("send-failed")) => {
            "The test card didn't go out; the email service turned it down"
        }
        (400, _) => "The greetings function refused the request",
        _ => "The greetings function failed; try again",
    };
    let out = match status {
        400 | 404 | 409 => status,
        _ => 502,
    };
    Response::json(
        out,
        &json!({ "error": message, "code": code, "field": field }),
    )
}

fn hosted(
    config: &GreetingsConfig,
    method: &str,
    path: &str,
    body: Option<&Json>,
    actor: &str,
) -> Result<Json, Response> {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(30)))
        .max_redirects(0)
        .http_status_as_error(false)
        .user_agent(concat!("open.blog-admin/", env!("CARGO_PKG_VERSION")))
        .build()
        .into();
    let url = format!("{}/{}", config.endpoint, path);
    let authorization = format!("Bearer {}", config.key);
    let result = if method == "GET" {
        agent
            .get(&url)
            .header("Authorization", &authorization)
            .header("X-OpenBlog-Actor", actor)
            .call()
    } else {
        let bytes = body.map(Json::to_string).unwrap_or_else(|| "{}".into());
        agent
            .post(&url)
            .header("Authorization", &authorization)
            .header("X-OpenBlog-Actor", actor)
            .header("Content-Type", "application/json")
            .send(bytes.as_bytes())
    };
    let mut response = match result {
        Ok(response) => response,
        Err(ureq::Error::Timeout(_)) => {
            return Err(Response::error(504, "The greetings function timed out"))
        }
        Err(_) => {
            return Err(Response::error(
                502,
                "The greetings function could not be reached",
            ))
        }
    };
    let status = response.status().as_u16();
    let bytes = response
        .body_mut()
        .with_config()
        .limit(MAX_REPLY_BYTES)
        .read_to_vec()
        .map_err(|_| bad_reply())?;
    let value: Json = serde_json::from_slice(&bytes).map_err(|_| bad_reply())?;
    if status >= 300 {
        return Err(refusal(status, &value));
    }
    Ok(value)
}

fn object_body(req: &Request, allowed: &[&str]) -> Result<Json, Response> {
    if req.body.is_empty() {
        return Ok(json!({}));
    }
    let body: Json = serde_json::from_slice(&req.body)
        .map_err(|_| Response::error(400, "The request is not valid JSON"))?;
    let Some(object) = body.as_object() else {
        return Err(Response::error(400, "The request must be a JSON object"));
    };
    if object.keys().any(|key| !allowed.contains(&key.as_str())) {
        return Err(Response::error(
            400,
            "The request has a field this route does not take",
        ));
    }
    Ok(body)
}

fn is_day(value: &str) -> bool {
    openblog_core::date::DateTime::parse(value).is_some_and(|day| day.ymd() == value)
}

fn day_or_null(value: Option<&Json>) -> Option<Json> {
    match value {
        None | Some(Json::Null) => Some(Json::Null),
        Some(Json::String(day)) if is_day(day) => Some(json!(day)),
        _ => None,
    }
}

fn instant(value: Option<&Json>) -> Option<Json> {
    match value {
        None | Some(Json::Null) => Some(Json::Null),
        Some(Json::String(at))
            if at.len() <= 40 && openblog_core::date::DateTime::parse(at).is_some() =>
        {
            Some(json!(at))
        }
        _ => None,
    }
}

fn project_contact(value: &Json) -> Option<Json> {
    let id = value.get("id")?.as_str().filter(|id| is_uuid(id))?;
    Some(json!({
        "id": id,
        "name": text(value.get("name")?, 80).filter(|n| !n.trim().is_empty())?,
        "email": text(value.get("email")?, 254).filter(|e| e.contains('@'))?,
        "birthday": day_or_null(value.get("birthday"))?,
    }))
}

fn project_card(value: &Json) -> Option<Json> {
    let id = value.get("id")?.as_str().filter(|id| is_uuid(id))?;
    let contact = value.get("contactId")?.as_str().filter(|id| is_uuid(id))?;
    let status = value
        .get("status")?
        .as_str()
        .filter(|s| STATUSES.contains(s))?;
    let message = value.get("message")?.as_str()?;
    if message.chars().count() > 4000
        || message
            .chars()
            .any(|c| c.is_control() && c != '\n' && c != '\t')
    {
        return None;
    }
    let send_on = value.get("sendOn")?.as_str().filter(|d| is_day(d))?;
    let hour = value.get("hour")?.as_u64().filter(|h| *h <= 23)?;
    Some(json!({
        "id": id,
        "contactId": contact,
        "design": slug(value.get("design")?)?,
        "subject": text(value.get("subject")?, 150)?,
        "message": message,
        "signOff": value.get("signOff").and_then(|v| text(v, 80)).unwrap_or_default(),
        "sendOn": send_on,
        "hour": hour,
        "timeZone": text(value.get("timeZone")?, 64)?,
        "yearly": value.get("yearly").and_then(Json::as_bool).unwrap_or(false),
        "status": status,
        "nextSendAt": instant(value.get("nextSendAt"))?,
        "lastSentAt": instant(value.get("lastSentAt"))?,
        "attempts": value.get("attempts").and_then(Json::as_u64).filter(|n| *n <= 100).unwrap_or(0),
        "error": value.get("error").and_then(slug),
    }))
}

fn project_status(value: &Json) -> Option<Json> {
    let designs: Vec<Json> = value
        .get("designs")?
        .as_array()?
        .iter()
        .filter_map(|d| {
            Some(json!({
                "id": slug(d.get("id")?)?,
                "label": text(d.get("label")?, 40)?,
                "subject": text(d.get("subject")?, 150)?,
            }))
        })
        .take(30)
        .collect();
    let from = value.get("from")?;
    Some(json!({
        "enabled": true,
        "state": "on",
        "timeZone": text(value.get("timeZone")?, 64)?,
        "from": {
            "name": from.get("name").and_then(|n| text(n, 80)),
            "email": text(from.get("email")?, 254)?,
        },
        "designs": designs,
    }))
}

pub(super) fn route(req: &Request, user: &str, name: &str) -> Response {
    route_with(&process_env, req, user, name)
}

pub(super) fn route_with(
    env: &dyn Fn(&str) -> Option<String>,
    req: &Request,
    user: &str,
    name: &str,
) -> Response {
    let configured = configuration(env);
    let config = match configured {
        Configured::On(config) => config,
        Configured::Off if name == "status" && req.method == "GET" => {
            return Response::json(200, &json!({ "enabled": false, "state": "off" }))
        }
        Configured::Invalid(problems) if name == "status" && req.method == "GET" => {
            return Response::json(
                200,
                &json!({ "enabled": false, "state": "invalid", "problems": problems }),
            )
        }
        _ => return Response::error(404, "Greeting cards are not set up"),
    };
    if req.method != "GET" {
        if let Err(response) = require_json(req) {
            return response;
        }
    }
    let parts: Vec<&str> = name.split('/').collect();
    let result = match (req.method.as_str(), parts.as_slice()) {
        ("GET", ["status"]) => match hosted(&config, "GET", "status", None, user) {
            Ok(reply) => project_status(&reply).ok_or_else(bad_reply),
            // The function says it is switched off: Admin's side is fine, the host's isn't.
            Err(response) if response.status == 404 => {
                Ok(json!({ "enabled": false, "state": "unavailable" }))
            }
            Err(response) => Err(response),
        },
        ("GET", ["contacts"]) => hosted(&config, "GET", "contacts", None, user).map(|reply| {
            let list = reply.get("contacts").and_then(Json::as_array);
            json!({ "contacts": list.map(|l| l.iter().filter_map(project_contact).collect::<Vec<_>>()).unwrap_or_default() })
        }),
        ("POST", ["contacts"]) => object_body(req, &CONTACT_FIELDS).and_then(|body| {
            let reply = hosted(&config, "POST", "contacts", Some(&body), user)?;
            let contact = reply.get("contact").and_then(project_contact).ok_or_else(bad_reply)?;
            Ok(json!({ "contact": contact }))
        }),
        ("POST", ["contacts", id]) if is_uuid(id) => object_body(req, &CONTACT_FIELDS).and_then(|body| {
            let reply = hosted(&config, "POST", &format!("contacts/{id}"), Some(&body), user)?;
            let contact = reply.get("contact").and_then(project_contact).ok_or_else(bad_reply)?;
            Ok(json!({ "contact": contact }))
        }),
        ("POST", ["contacts", id, "remove"]) if is_uuid(id) => object_body(req, &[]).and_then(|_| {
            hosted(&config, "POST", &format!("contacts/{id}/remove"), Some(&json!({})), user)
                .map(|_| json!({ "removed": true }))
        }),
        ("GET", ["cards"]) => hosted(&config, "GET", "cards", None, user).map(|reply| {
            let list = reply.get("cards").and_then(Json::as_array);
            json!({ "cards": list.map(|l| l.iter().filter_map(project_card).collect::<Vec<_>>()).unwrap_or_default() })
        }),
        ("POST", ["cards"]) => object_body(req, &CARD_FIELDS).and_then(|body| {
            let reply = hosted(&config, "POST", "cards", Some(&body), user)?;
            let card = reply.get("card").and_then(project_card).ok_or_else(bad_reply)?;
            Ok(json!({ "card": card }))
        }),
        ("POST", ["cards", id]) if is_uuid(id) => object_body(req, &CARD_FIELDS).and_then(|body| {
            let reply = hosted(&config, "POST", &format!("cards/{id}"), Some(&body), user)?;
            let card = reply.get("card").and_then(project_card).ok_or_else(bad_reply)?;
            Ok(json!({ "card": card }))
        }),
        ("POST", ["cards", id, "cancel"]) if is_uuid(id) => object_body(req, &[]).and_then(|_| {
            hosted(&config, "POST", &format!("cards/{id}/cancel"), Some(&json!({})), user)
                .map(|_| json!({ "cancelled": true }))
        }),
        ("POST", ["preview"]) => object_body(req, &CARD_FIELDS).and_then(|body| {
            let reply = hosted(&config, "POST", "preview", Some(&body), user)?;
            // The preview is shown in a sandboxed frame with no scripts; it is the function's own
            // template around escaped words, bounded here.
            let html = reply
                .get("html")
                .and_then(Json::as_str)
                .filter(|h| h.len() <= 200_000)
                .ok_or_else(bad_reply)?;
            Ok(json!({
                "subject": reply.get("subject").and_then(|s| text(s, 150)).ok_or_else(bad_reply)?,
                "html": html,
                "sendsAt": instant(reply.get("sendsAt")).ok_or_else(bad_reply)?,
            }))
        }),
        ("POST", ["test"]) => object_body(req, &CARD_FIELDS).and_then(|body| {
            let reply = hosted(&config, "POST", "test", Some(&body), user)?;
            Ok(json!({
                "sent": reply.get("sent").and_then(Json::as_bool).unwrap_or(false),
                "to": reply.get("to").and_then(|t| text(t, 254)),
            }))
        }),
        _ => return Response::error(404, "Unknown API route"),
    };
    match result {
        Ok(value) => Response::json(200, &value),
        Err(response) => response,
    }
}
