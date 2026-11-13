//! Admin routes for push notifications (ADR 0412).
//!
//! Notifications are optional and off by default. The devices the owner turned them on for live in
//! the site's private Supabase project behind the hosted `push` function, which also sends them:
//! the function is where a comment or a quote request arrives, so it is the one awake when there
//! is news. Admin reaches it only from this server, with the key from the environment of the
//! process running Admin (`OPENBLOG_PUSH_ENDPOINT`, `OPENBLOG_PUSH_ADMIN_KEY`), never from
//! `openblog.json`, the repository or a response. Unset or invalid, and every route but `status`
//! is a 404 and nothing is sent anywhere.
//!
//! Every route sits behind the session and, for a write, the CSRF check; a body is bounded before it
//! is read and may hold only the fields its route takes. A reply is rebuilt from the fields Admin
//! shows. A device's push endpoint goes from the browser to the function and never comes back:
//! Admin knows a device by a hash of it.

use std::time::Duration;

use super::social::{is_uuid, slug, text, valid_endpoint};
use super::*;

/// The largest request body any push route takes (a browser's subscription is well under 1 KB).
pub(super) const MAX_PUSH_REQUEST_BYTES: usize = 8 * 1024;
const MAX_REPLY_BYTES: u64 = 256 * 1024;
const MIN_KEY_CHARS: usize = 32;
const KINDS: [&str; 4] = ["comment", "feedback", "quote", "app"];

pub(super) struct PushConfig {
    endpoint: String,
    key: String,
}

pub(super) enum Configured {
    Off,
    Invalid(Vec<&'static str>),
    On(PushConfig),
}

pub(super) fn configuration(env: &dyn Fn(&str) -> Option<String>) -> Configured {
    let endpoint = env("OPENBLOG_PUSH_ENDPOINT").unwrap_or_default();
    let key = env("OPENBLOG_PUSH_ADMIN_KEY").unwrap_or_default();
    if endpoint.trim().is_empty() && key.is_empty() {
        return Configured::Off;
    }
    let mut problems = Vec::new();
    let endpoint = valid_endpoint(&endpoint);
    if endpoint.is_none() {
        problems.push("OPENBLOG_PUSH_ENDPOINT");
    }
    if key.chars().count() < MIN_KEY_CHARS || key.chars().any(char::is_whitespace) {
        problems.push("OPENBLOG_PUSH_ADMIN_KEY");
    }
    match (endpoint, problems.is_empty()) {
        (Some(endpoint), true) => Configured::On(PushConfig { endpoint, key }),
        _ => Configured::Invalid(problems),
    }
}

/// Whether Admin has any push settings, valid or not. Only then does the navigation show the page.
pub(super) fn is_configured() -> bool {
    !matches!(configuration(&process_env), Configured::Off)
}

fn process_env(name: &str) -> Option<String> {
    std::env::var(name).ok()
}

fn bad_reply() -> Response {
    Response::error(502, "The push function sent a reply Admin could not use")
}

/// The function's own refusal, reduced to a status Admin may pass on and a fixed message.
fn refusal(status: u16, body: &Json) -> Response {
    let code = body.get("error").and_then(slug);
    let message = match (status, code.as_deref()) {
        (401, _) => "The push function did not accept Admin's key; check OPENBLOG_PUSH_ADMIN_KEY",
        (404, Some("not-enabled")) => {
            "Notifications are not switched on where the push function runs"
        }
        (404, _) => "That device is no longer there; reload",
        (410, _) => "This device stopped taking notifications; turn them on again",
        (400, Some("invalid-subscription")) => {
            "This browser gave a subscription the push function won't send to"
        }
        (400, Some("label-required")) => "Give this device a name",
        (400, Some("invalid-kinds")) => "Pick from the kinds of news on the list",
        (409, Some("too-many")) => {
            "That's as many devices as notifications go to; remove one first"
        }
        (502, Some("send-failed")) => {
            "The test didn't go out; the browser's push service turned it down"
        }
        (400, _) => "The push function refused the request",
        _ => "The push function failed; try again",
    };
    let out = match status {
        400 | 404 | 409 | 410 => status,
        _ => 502,
    };
    Response::json(out, &json!({ "error": message, "code": code }))
}

fn hosted(
    config: &PushConfig,
    method: &str,
    path: &str,
    body: Option<&Json>,
    actor: &str,
) -> Result<Json, Response> {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(20)))
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
            return Err(Response::error(504, "The push function timed out"))
        }
        Err(_) => {
            return Err(Response::error(
                502,
                "The push function could not be reached",
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

fn kinds(value: Option<&Json>) -> Option<Vec<String>> {
    let list = value?.as_array()?;
    Some(
        list.iter()
            .filter_map(Json::as_str)
            .filter(|k| KINDS.contains(k))
            .map(str::to_string)
            .collect(),
    )
}

fn project_device(value: &Json) -> Option<Json> {
    let id = value.get("id")?.as_str().filter(|id| is_uuid(id))?;
    let device = value
        .get("device")?
        .as_str()
        .filter(|d| d.len() == 32 && d.bytes().all(|b| b.is_ascii_hexdigit()))?;
    Some(json!({
        "id": id,
        "device": device,
        "label": text(value.get("label")?, 60).filter(|l| !l.trim().is_empty())?,
        "kinds": kinds(value.get("kinds"))?,
        "createdAt": instant(value.get("createdAt"))?,
        "lastSentAt": instant(value.get("lastSentAt"))?,
    }))
}

fn project_status(value: &Json) -> Option<Json> {
    // A VAPID public key: an uncompressed P-256 point, 65 bytes, base64url without padding.
    let public_key = value.get("publicKey")?.as_str().filter(|k| {
        k.len() == 87
            && k.bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    })?;
    let kinds: Vec<Json> = value
        .get("kinds")?
        .as_array()?
        .iter()
        .filter_map(|k| {
            let id = k.get("id")?.as_str().filter(|id| KINDS.contains(id))?;
            Some(json!({ "id": id, "label": text(k.get("label")?, 80)? }))
        })
        .collect();
    let devices: Vec<Json> = value
        .get("devices")?
        .as_array()?
        .iter()
        .filter_map(project_device)
        .take(20)
        .collect();
    Some(json!({
        "enabled": true,
        "state": "on",
        "publicKey": public_key,
        "kinds": kinds,
        "otherApps": value.get("otherApps").and_then(Json::as_bool).unwrap_or(false),
        "devices": devices,
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
    let config = match configuration(env) {
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
        _ => return Response::error(404, "Notifications are not set up"),
    };
    if req.method != "GET" {
        if let Err(response) = require_json(req) {
            return response;
        }
    }
    let parts: Vec<&str> = name.split('/').collect();
    let device_reply = |reply: Json| -> Result<Json, Response> {
        let device = reply
            .get("device")
            .and_then(project_device)
            .ok_or_else(bad_reply)?;
        Ok(json!({ "device": device }))
    };
    let result = match (req.method.as_str(), parts.as_slice()) {
        ("GET", ["status"]) => match hosted(&config, "GET", "status", None, user) {
            Ok(reply) => project_status(&reply).ok_or_else(bad_reply),
            // The function says it is switched off: Admin's side is fine, the host's isn't.
            Err(response) if response.status == 404 => {
                Ok(json!({ "enabled": false, "state": "unavailable" }))
            }
            Err(response) => Err(response),
        },
        ("POST", ["devices"]) => object_body(req, &["subscription", "label", "kinds"])
            .and_then(|body| device_reply(hosted(&config, "POST", "devices", Some(&body), user)?)),
        ("POST", ["devices", id]) if is_uuid(id) => {
            object_body(req, &["label", "kinds"]).and_then(|body| {
                device_reply(hosted(
                    &config,
                    "POST",
                    &format!("devices/{id}"),
                    Some(&body),
                    user,
                )?)
            })
        }
        ("POST", ["devices", id, "remove"]) if is_uuid(id) => {
            object_body(req, &[]).and_then(|_| {
                hosted(
                    &config,
                    "POST",
                    &format!("devices/{id}/remove"),
                    Some(&json!({})),
                    user,
                )
                .map(|_| json!({ "removed": true }))
            })
        }
        ("POST", ["test"]) => object_body(req, &["id"]).and_then(|body| {
            if !body.get("id").and_then(Json::as_str).is_some_and(is_uuid) {
                return Err(Response::error(400, "Pick a device to test"));
            }
            hosted(&config, "POST", "test", Some(&body), user).map(|reply| {
                json!({ "sent": reply.get("sent").and_then(Json::as_bool).unwrap_or(false) })
            })
        }),
        _ => return Response::error(404, "Unknown API route"),
    };
    match result {
        Ok(value) => Response::json(200, &value),
        Err(response) => response,
    }
}

/// The installed app's manifest (ADR 0412): the site's own name, opening Admin in its own window.
pub(super) fn manifest(config: &SiteConfig) -> Response {
    let title = config.title.trim();
    let name = if title.is_empty() {
        "Admin".to_string()
    } else {
        format!("{title} Admin")
    };
    let short: String = if title.is_empty() || title.chars().count() > 12 {
        "Admin".into()
    } else {
        title.into()
    };
    let body = json!({
        "name": name,
        "short_name": short,
        "id": "/admin/",
        "start_url": "/admin/",
        "scope": "/admin/",
        "display": "standalone",
        "background_color": "#f7f3ec",
        "theme_color": "#3a3226",
        "icons": [
            { "src": "/admin/icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
            { "src": "/admin/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
        ]
    });
    Response::new(
        200,
        "application/manifest+json; charset=utf-8",
        body.to_string().into_bytes(),
    )
}
