//! Admin routes for stored quote requests (epic #474, story #486; ADR 0384).
//!
//! Quote requests are optional and off by default. Admin reaches the hosted quote function only
//! from this server, with the admin key from the environment of the process running Admin
//! (`OPENBLOG_QUOTE_ENDPOINT`, `OPENBLOG_QUOTE_ADMIN_KEY`), never from `openblog.json`, the
//! repository or a response. Unset or invalid, and every route here but `status` is a 404 and
//! nothing is sent anywhere. The browser never holds the key and never talks to Supabase.
//!
//! Every route sits behind the session and, for a write, the CSRF check, and the body is bounded
//! before it is read. A reply is rebuilt from the fields Admin shows, so a faulty or hostile
//! function cannot smuggle anything else through. Visitor values pass through only to the signed-in
//! owner, are bounded, and are never logged or placed in an error.

use std::time::Duration;

use super::social::{is_uuid, slug, text, valid_endpoint};
use super::*;

/// The largest request body any quote route takes (an erase names at most 100 ids).
pub(super) const MAX_QUOTE_REQUEST_BYTES: usize = 16 * 1024;
const MAX_REPLY_BYTES: u64 = 8 * 1024 * 1024;
const MIN_KEY_CHARS: usize = 32;
const STATUSES: [&str; 3] = ["new", "handled", "archived"];
/// The states of the owner's email about a request (ADR 0383).
const NOTIFY: [&str; 4] = ["off", "pending", "sent", "failed"];
/// The fixed codes the hosted notifier records for a failed email; anything else is dropped.
const NOTIFY_ERRORS: [&str; 7] = [
    "refused-key",
    "rejected",
    "rate-limited",
    "provider-error",
    "timeout",
    "network",
    "unknown",
];

pub(super) struct QuoteConfig {
    endpoint: String,
    key: String,
}

pub(super) enum Configured {
    Off,
    Invalid(Vec<&'static str>),
    On(QuoteConfig),
}

pub(super) fn configuration(env: &dyn Fn(&str) -> Option<String>) -> Configured {
    let endpoint = env("OPENBLOG_QUOTE_ENDPOINT").unwrap_or_default();
    let key = env("OPENBLOG_QUOTE_ADMIN_KEY").unwrap_or_default();
    if endpoint.trim().is_empty() && key.is_empty() {
        return Configured::Off;
    }
    let mut problems = Vec::new();
    let endpoint = valid_endpoint(&endpoint);
    if endpoint.is_none() {
        problems.push("OPENBLOG_QUOTE_ENDPOINT");
    }
    if key.chars().count() < MIN_KEY_CHARS || key.chars().any(char::is_whitespace) {
        problems.push("OPENBLOG_QUOTE_ADMIN_KEY");
    }
    match (endpoint, problems.is_empty()) {
        (Some(endpoint), true) => Configured::On(QuoteConfig { endpoint, key }),
        _ => Configured::Invalid(problems),
    }
}

/// Whether Admin has any quote settings, valid or not. Only then does the navigation show the page.
pub(super) fn is_configured() -> bool {
    !matches!(configuration(&process_env), Configured::Off)
}

fn process_env(name: &str) -> Option<String> {
    std::env::var(name).ok()
}

/// Free text from the visitor: bounded, with every control character other than a line break or
/// tab shown as a space. A request stored with one (U+0085, U+009B) is still shown, so the owner can
/// read, mark, archive and erase it (ADR 0386); it is never hidden.
fn visitor_text(value: &Json, max: usize) -> Option<String> {
    let value = value.as_str()?;
    (value.chars().count() <= max).then(|| {
        value
            .chars()
            .map(|c| {
                if c.is_control() && !matches!(c, '\n' | '\r' | '\t') {
                    ' '
                } else {
                    c
                }
            })
            .collect()
    })
}

fn optional(
    value: &Json,
    key: &str,
    max: usize,
    project: fn(&Json, usize) -> Option<String>,
) -> Json {
    value
        .get(key)
        .and_then(|v| project(v, max))
        .map(Json::String)
        .unwrap_or(Json::Null)
}

fn stamp(value: &Json, key: &str) -> Json {
    optional(value, key, 40, text)
}

/// Only an https address of a signed storage object, with no credentials.
fn photo_url(value: &Json) -> Option<String> {
    let raw = value.as_str().filter(|raw| raw.len() <= 2000)?;
    let url = url::Url::parse(raw).ok()?;
    (url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.path().contains("/storage/v1/object/sign/"))
    .then(|| url.to_string())
}

fn project_request(value: &Json) -> Option<Json> {
    let id = text(value.get("id")?, 36).filter(|id| is_uuid(id))?;
    let status = slug(value.get("status")?).filter(|s| STATUSES.contains(&s.as_str()))?;
    let photos: Vec<Json> = value
        .get("photos")
        .and_then(Json::as_array)
        .map(|list| {
            list.iter()
                .filter_map(|photo| {
                    Some(json!({
                        "url": photo_url(photo.get("url")?)?,
                        "type": text(photo.get("type")?, 40)?,
                    }))
                })
                .take(5)
                .collect()
        })
        .unwrap_or_default();
    Some(json!({
        "id": id,
        "status": status,
        "name": visitor_text(value.get("name")?, 100)?,
        "phone": visitor_text(value.get("phone")?, 30)?,
        "email": optional(value, "email", 200, visitor_text),
        "town": visitor_text(value.get("town")?, 100)?,
        "service": visitor_text(value.get("service")?, 100)?,
        "description": visitor_text(value.get("description")?, 2000)?,
        "page": optional(value, "page", 500, visitor_text),
        "photos": photos,
        "photoCount": value.get("photoCount").and_then(Json::as_u64).filter(|n| *n <= 5).unwrap_or(0),
        "createdAt": stamp(value, "createdAt"),
        "handledAt": stamp(value, "handledAt"),
        "archivedAt": stamp(value, "archivedAt"),
        "eraseAfter": stamp(value, "eraseAfter"),
        "notify": value.get("notify").and_then(slug).filter(|s| NOTIFY.contains(&s.as_str())),
        "notifyAttempts": value.get("notifyAttempts").and_then(Json::as_u64).filter(|n| *n <= 100).unwrap_or(0),
        "notifyError": value.get("notifyError").and_then(slug).filter(|s| NOTIFY_ERRORS.contains(&s.as_str())),
    }))
}

fn project_list(reply: &Json) -> Json {
    let given: &[Json] = reply
        .get("requests")
        .and_then(Json::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default();
    let given = &given[..given.len().min(500)];
    let requests: Vec<Json> = given.iter().filter_map(project_request).collect();
    // A stored request Admin cannot show is counted and said, never silently left out.
    let unreadable = given.len() - requests.len();
    let services: Vec<String> = reply
        .get("services")
        .and_then(Json::as_array)
        .map(|list| {
            list.iter()
                .filter_map(|s| visitor_text(s, 100))
                .take(200)
                .collect()
        })
        .unwrap_or_default();
    let days = reply
        .get("retentionDays")
        .and_then(Json::as_u64)
        .filter(|d| (1..=3650).contains(d));
    let notify_enabled = reply
        .get("notifyEnabled")
        .and_then(Json::as_bool)
        .unwrap_or(false);
    json!({ "requests": requests, "unreadable": unreadable, "services": services, "retentionDays": days, "retentionSource": retention_source(reply, days), "notifyEnabled": notify_enabled })
}

/// Who set the retention days (ADR 0387): `host` (where the function runs; Admin cannot change it),
/// `admin` (the owner, here), or nobody.
fn retention_source(reply: &Json, days: Option<u64>) -> Option<&'static str> {
    days?;
    match reply.get("retentionSource").and_then(Json::as_str) {
        Some("admin") => Some("admin"),
        // An older function names no source: its days can only come from where it runs.
        _ => Some("host"),
    }
}

fn bad_reply() -> Response {
    Response::error(502, "The quote function sent a reply Admin could not use")
}

/// The function's own refusal, reduced to a status Admin may pass on and a fixed plain message.
fn refusal(status: u16, body: &Json) -> Response {
    let code = body.get("error").and_then(slug);
    let message = match (status, code.as_deref()) {
        (401, _) => "The quote function did not accept Admin's key; check OPENBLOG_QUOTE_ADMIN_KEY",
        (404, Some("not-enabled")) => "Quote requests are not enabled on the hosted function",
        (409, Some("preview-required")) => {
            "Preview the erase again; the earlier preview no longer matches"
        }
        (409, Some("changed")) => {
            "Some requests changed or were already erased; reload and try again"
        }
        (409, Some("retention-set-by-host")) => {
            "The number of days is set where the quote function runs, so it cannot be changed here"
        }
        (409, Some("notifications-off")) => {
            "Emails to you are turned off where the quote function runs, so none can be sent again"
        }
        (400, _) => "The quote function refused the request",
        // A failed erase puts every photo back before the records are touched (ADR 0386).
        (502, Some("erase-failed")) => {
            "Erase failed. Every request and its photos are still here; try again"
        }
        (502, Some("erase-unverified")) => {
            "Erase could not be verified. Reload to see what remains"
        }
        _ => "The quote function failed; try again",
    };
    let out = match status {
        400 | 404 | 409 => status,
        _ => 502,
    };
    Response::json(out, &json!({ "error": message, "code": code }))
}

fn hosted(
    config: &QuoteConfig,
    method: &str,
    path: &str,
    query: &[(&str, &str)],
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
    let mut url = format!("{}/{}", config.endpoint, path);
    if !query.is_empty() {
        url.push('?');
        url.push_str(
            &url::form_urlencoded::Serializer::new(String::new())
                .extend_pairs(query)
                .finish(),
        );
    }
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
            return Err(Response::error(504, "The quote function timed out"))
        }
        Err(_) => {
            return Err(Response::error(
                502,
                "The quote function could not be reached",
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

fn ids_of(body: &Json) -> Result<Vec<String>, Response> {
    let ids: Vec<String> = body
        .get("ids")
        .and_then(Json::as_array)
        .map(|list| {
            list.iter()
                .filter_map(|v| v.as_str().filter(|id| is_uuid(id)).map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    let named = body.get("ids").and_then(Json::as_array).map_or(0, Vec::len);
    if ids.is_empty() || ids.len() != named || ids.len() > 100 {
        return Err(Response::error(400, "Choose between 1 and 100 requests"));
    }
    Ok(ids)
}

fn day(req: &Request, name: &str) -> Result<Option<String>, Response> {
    match req.query.get(name).map(String::as_str) {
        None | Some("") => Ok(None),
        Some(value) if is_day(value) => Ok(Some(value.to_string())),
        Some(_) => Err(Response::error(400, "Dates look like 2026-10-31")),
    }
}

fn is_day(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 10
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes
            .iter()
            .enumerate()
            .all(|(i, b)| matches!(i, 4 | 7) || b.is_ascii_digit())
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
    if name == "status" && req.method == "GET" {
        return match configured {
            Configured::Off => Response::json(200, &json!({ "enabled": false, "state": "off" })),
            Configured::Invalid(problems) => Response::json(
                200,
                &json!({ "enabled": false, "state": "invalid", "problems": problems }),
            ),
            Configured::On(_) => Response::json(200, &json!({ "enabled": true, "state": "on" })),
        };
    }
    let Configured::On(config) = configured else {
        return Response::error(404, "Quote requests are not set up");
    };
    if req.method != "GET" {
        if let Err(response) = require_json(req) {
            return response;
        }
    }
    let parts: Vec<&str> = name.split('/').collect();
    let result = match (req.method.as_str(), parts.as_slice()) {
        ("GET", ["requests"]) => list(req, &config, user),
        ("POST", ["requests", id, "status"]) if is_uuid(id) => set_status(req, &config, user, id),
        ("GET", ["export"]) => export(req, &config, user),
        ("POST", ["erase", "preview"]) => erase_preview(req, &config, user),
        ("POST", ["erase"]) => erase(req, &config, user),
        ("POST", ["retention", "run"]) => {
            object_body(req, &[]).and_then(|_| {
                hosted(&config, "POST", "retention/run", &[], Some(&json!({})), user).map(|reply| {
                    json!({
                        "enabled": reply.get("enabled").and_then(Json::as_bool).unwrap_or(false),
                        "erased": reply.get("erased").and_then(Json::as_u64).filter(|n| *n <= 100_000).unwrap_or(0),
                    })
                })
            })
        }
        ("POST", ["retention"]) => set_retention(req, &config, user),
        ("POST", ["notifications", "retry"]) => retry_notifications(req, &config, user),
        _ => return Response::error(404, "Unknown API route"),
    };
    match result {
        Ok(value) => Response::json(200, &value),
        Err(response) => response,
    }
}

fn list(req: &Request, config: &QuoteConfig, user: &str) -> Result<Json, Response> {
    let mut query: Vec<(&str, &str)> = Vec::new();
    if let Some(status) = req.query.get("status").filter(|s| !s.is_empty()) {
        if !STATUSES.contains(&status.as_str()) {
            return Err(Response::error(400, "Choose new, handled or archived"));
        }
        query.push(("status", status));
    }
    if let Some(service) = req.query.get("service").filter(|s| !s.is_empty()) {
        if service.chars().count() > 100 || service.chars().any(char::is_control) {
            return Err(Response::error(400, "That service name is not valid"));
        }
        query.push(("service", service));
    }
    hosted(config, "GET", "requests", &query, None, user).map(|reply| project_list(&reply))
}

/// The owner's choice of how many days an archived request is kept (ADR 0387): a whole number from
/// 1 to 3650, or `null` to keep archived requests until the owner erases them.
fn set_retention(req: &Request, config: &QuoteConfig, user: &str) -> Result<Json, Response> {
    let body = object_body(req, &["days"])?;
    let days = match body.get("days") {
        None | Some(Json::Null) => None,
        Some(value) => match value.as_u64().filter(|d| (1..=3650).contains(d)) {
            Some(days) => Some(days),
            None => {
                return Err(Response::error(
                    400,
                    "Choose a whole number of days from 1 to 3650",
                ))
            }
        },
    };
    let reply = hosted(
        config,
        "POST",
        "retention",
        &[],
        Some(&json!({ "days": days })),
        user,
    )?;
    let kept = reply
        .get("retentionDays")
        .and_then(Json::as_u64)
        .filter(|d| (1..=3650).contains(d));
    if kept != days {
        return Err(bad_reply());
    }
    Ok(json!({ "retentionDays": kept, "retentionSource": kept.map(|_| "admin") }))
}

/// Sends again the owner's emails that failed (at most five tries each, ADR 0383). Only counts
/// come back; no request is named.
fn retry_notifications(req: &Request, config: &QuoteConfig, user: &str) -> Result<Json, Response> {
    object_body(req, &[])?;
    let reply = hosted(
        config,
        "POST",
        "notifications/retry",
        &[],
        Some(&json!({})),
        user,
    )?;
    let count = |key: &str| {
        reply
            .get(key)
            .and_then(Json::as_u64)
            .filter(|n| *n <= 1000)
            .unwrap_or(0)
    };
    Ok(json!({
        "tried": count("tried"),
        "sent": count("sent"),
        "failed": count("failed"),
        "gaveUp": count("gaveUp"),
    }))
}

fn set_status(req: &Request, config: &QuoteConfig, user: &str, id: &str) -> Result<Json, Response> {
    let body = object_body(req, &["status"])?;
    let Some(status) = body
        .get("status")
        .and_then(Json::as_str)
        .filter(|s| STATUSES.contains(s))
    else {
        return Err(Response::error(400, "Choose new, handled or archived"));
    };
    hosted(
        config,
        "POST",
        &format!("requests/{id}/status"),
        &[],
        Some(&json!({ "status": status })),
        user,
    )?;
    Ok(json!({ "id": id, "status": status }))
}

fn export(req: &Request, config: &QuoteConfig, user: &str) -> Result<Json, Response> {
    let from = day(req, "from")?;
    let to = day(req, "to")?;
    let mut query: Vec<(&str, &str)> = Vec::new();
    if let Some(from) = &from {
        query.push(("from", from));
    }
    if let Some(to) = &to {
        query.push(("to", to));
    }
    let reply = hosted(config, "GET", "export", &query, None, user)?;
    let csv = reply.get("csv").and_then(Json::as_str);
    let filename = reply.get("filename").and_then(Json::as_str).filter(|f| {
        f.len() <= 80
            && f.ends_with(".csv")
            && f.bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_'))
    });
    match (csv, filename) {
        (Some(csv), Some(filename)) if csv.len() <= 6 * 1024 * 1024 => Ok(json!({
            "csv": csv,
            "filename": filename,
            "count": reply.get("count").and_then(Json::as_u64).unwrap_or(0),
        })),
        _ => Err(bad_reply()),
    }
}

fn erase_preview(req: &Request, config: &QuoteConfig, user: &str) -> Result<Json, Response> {
    let ids = ids_of(&object_body(req, &["ids"])?)?;
    let reply = hosted(
        config,
        "POST",
        "erase/preview",
        &[],
        Some(&json!({ "ids": ids })),
        user,
    )?;
    let token = reply.get("token").and_then(Json::as_str).filter(|t| {
        t.len() <= 200
            && t.bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_'))
    });
    match (token, reply.get("count").and_then(Json::as_u64)) {
        (Some(token), Some(count)) => Ok(json!({
            "count": count,
            "photos": reply.get("photos").and_then(Json::as_u64).unwrap_or(0),
            "expiresAt": reply.get("expiresAt").and_then(|v| text(v, 40)),
            "token": token,
        })),
        _ => Err(bad_reply()),
    }
}

fn erase(req: &Request, config: &QuoteConfig, user: &str) -> Result<Json, Response> {
    let body = object_body(req, &["ids", "token"])?;
    let ids = ids_of(&body)?;
    let Some(token) = body
        .get("token")
        .and_then(Json::as_str)
        .filter(|t| t.len() <= 200)
    else {
        return Err(Response::error(400, "Preview the erase first"));
    };
    let reply = hosted(
        config,
        "POST",
        "erase",
        &[],
        Some(&json!({ "ids": ids, "token": token })),
        user,
    )?;
    match (
        reply.get("erased").and_then(Json::as_u64),
        reply.get("verified").and_then(Json::as_bool),
    ) {
        (Some(erased), Some(true)) if erased as usize == ids.len() => Ok(json!({
            "erased": erased,
            "verified": true,
            "photosPending": reply
                .get("photosPending")
                .and_then(Json::as_u64)
                .filter(|n| *n <= 500)
                .unwrap_or(0),
        })),
        _ => Err(bad_reply()),
    }
}
