//! Admin routes for gifts under the tree (Studio slice 3b).
//!
//! Gifts are optional and off by default. The family leaves them on the public site; they live in the
//! site's private database behind the hosted `gifts` function, which keeps each one wrapped until its
//! opening time (Christmas morning). Admin reaches that function only from this server, with the
//! endpoint and key from the environment of the process running Admin (`OPENBLOG_GIFTS_ENDPOINT`,
//! `OPENBLOG_GIFTS_ADMIN_KEY`), never from `openblog.json`, the repository or a response. Unset or
//! invalid, and every route but `status` is a 404 and nothing is sent anywhere.
//!
//! Every route sits behind the session and, for a write, the CSRF check. A reply is rebuilt from
//! the fields Studio shows, so a faulty or hostile function cannot pass anything else through.
//! What the family wrote goes only to the signed-in owner and is never logged or put in an error.

use std::time::Duration;

use super::social::{is_uuid, text, valid_endpoint};
use super::*;

pub(super) const MAX_GIFTS_REQUEST_BYTES: usize = 1024;
const MAX_REPLY_BYTES: u64 = 4 * 1024 * 1024;
const MIN_KEY_CHARS: usize = 32;
const WRAPS: [&str; 6] = ["red", "green", "gold", "blue", "plaid", "stripes"];
const DESIGNS: [&str; 5] = [
    "snowy-night",
    "candy-stripe",
    "holly",
    "gingerbread",
    "starry",
];
const STICKERS: [&str; 10] = [
    "star",
    "heart",
    "snowflake",
    "candy-cane",
    "bell",
    "mitten",
    "cookie",
    "ornament",
    "holly",
    "gift",
];

struct GiftsConfig {
    endpoint: String,
    key: String,
}

enum Configured {
    Off,
    Invalid(Vec<&'static str>),
    On(GiftsConfig),
}

fn configuration(env: &dyn Fn(&str) -> Option<String>) -> Configured {
    let endpoint = env("OPENBLOG_GIFTS_ENDPOINT").unwrap_or_default();
    let key = env("OPENBLOG_GIFTS_ADMIN_KEY").unwrap_or_default();
    if endpoint.trim().is_empty() && key.is_empty() {
        return Configured::Off;
    }
    let mut problems = Vec::new();
    let endpoint = valid_endpoint(&endpoint);
    if endpoint.is_none() {
        problems.push("OPENBLOG_GIFTS_ENDPOINT");
    }
    if key.chars().count() < MIN_KEY_CHARS || key.chars().any(char::is_whitespace) {
        problems.push("OPENBLOG_GIFTS_ADMIN_KEY");
    }
    match (endpoint, problems.is_empty()) {
        (Some(endpoint), true) => Configured::On(GiftsConfig { endpoint, key }),
        _ => Configured::Invalid(problems),
    }
}

fn process_env(name: &str) -> Option<String> {
    std::env::var(name).ok()
}

/// Whether Admin has any gifts settings, valid or not. Only then does Studio show Gifts.
pub(super) fn is_configured() -> bool {
    !matches!(configuration(&process_env), Configured::Off)
}

fn bad_reply() -> Response {
    Response::error(502, "The gifts service sent a reply Admin could not use")
}

fn refusal(status: u16, body: &Json) -> Response {
    let code = body
        .get("error")
        .and_then(Json::as_str)
        .filter(|c| c.len() <= 40 && c.bytes().all(|b| b.is_ascii_lowercase() || b == b'-'));
    let (out, message) = match (status, code) {
        (401, _) => (
            502,
            "The gifts service did not accept Admin's key; check OPENBLOG_GIFTS_ADMIN_KEY",
        ),
        (404, Some("not-enabled")) => (
            502,
            "Gifts are not switched on where the gifts service runs",
        ),
        (404, _) => (404, "That gift is no longer there; reload"),
        (423, _) => (423, "It's still wrapped: gifts open on Christmas morning"),
        (422, _) | (400, _) => (400, "The gifts service refused the request"),
        _ => (502, "The gifts service failed; try again"),
    };
    let mut reply = json!({ "error": message, "code": code });
    if status == 423 {
        reply["opensAt"] = body.get("opensAt").and_then(instant).unwrap_or(Json::Null);
    }
    Response::json(out, &reply)
}

fn hosted(
    config: &GiftsConfig,
    method: &str,
    path: &str,
    body: Option<&Json>,
) -> Result<Json, Response> {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(30)))
        .max_redirects(0)
        .http_status_as_error(false)
        .user_agent(concat!("open.blog-admin/", env!("CARGO_PKG_VERSION")))
        .build()
        .into();
    let url = format!("{}/admin/{}", config.endpoint, path);
    let authorization = format!("Bearer {}", config.key);
    let result = if method == "GET" {
        agent
            .get(&url)
            .header("Authorization", &authorization)
            .call()
    } else {
        let bytes = body.map(Json::to_string).unwrap_or_else(|| "{}".into());
        agent
            .post(&url)
            .header("Authorization", &authorization)
            .header("Content-Type", "application/json")
            .send(bytes.as_bytes())
    };
    let mut response = match result {
        Ok(response) => response,
        Err(ureq::Error::Timeout(_)) => {
            return Err(Response::error(504, "The gifts service timed out"))
        }
        Err(_) => {
            return Err(Response::error(
                502,
                "The gifts service could not be reached",
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

/// A timestamp as the service writes it (RFC 3339), checked by shape and length only.
fn instant(value: &Json) -> Option<Json> {
    let s = value.as_str()?;
    let ok = (20..=40).contains(&s.len())
        && s.as_bytes()[4] == b'-'
        && s.as_bytes()[10] == b'T'
        && s.bytes()
            .all(|b| b.is_ascii_digit() || b"-:T.Z+".contains(&b));
    ok.then(|| Json::String(s.to_string()))
}

fn one_of(value: Option<&Json>, list: &[&str]) -> Option<Json> {
    let s = value?.as_str()?;
    list.contains(&s).then(|| Json::String(s.to_string()))
}

fn project_card(value: &Json) -> Option<Json> {
    let stickers = value
        .get("stickers")
        .and_then(Json::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[]);
    if stickers.len() > 8 {
        return None;
    }
    let stickers: Option<Vec<Json>> = stickers
        .iter()
        .map(|s| {
            let x = s.get("x")?.as_u64().filter(|x| *x <= 100)?;
            let y = s.get("y")?.as_u64().filter(|y| *y <= 100)?;
            Some(json!({ "kind": one_of(s.get("kind"), &STICKERS)?, "x": x, "y": y }))
        })
        .collect();
    Some(json!({
        "design": one_of(value.get("design"), &DESIGNS)?,
        "message": text(value.get("message")?, 300)?,
        "signOff": value.get("signOff").and_then(|s| text(s, 40)).unwrap_or_default(),
        "stickers": stickers?,
    }))
}

fn project_gift(value: &Json) -> Option<Json> {
    let id = value.get("id")?.as_str().filter(|id| is_uuid(id))?;
    let kind = one_of(value.get("kind"), &["note", "card"])?;
    let opened = value.get("opened").and_then(Json::as_bool).unwrap_or(false);
    let flag = |name: &str| value.get(name).and_then(Json::as_bool).unwrap_or(false);
    let mut gift = json!({
        "id": id,
        "from": text(value.get("from")?, 40)?,
        "showName": flag("showName"),
        "kind": kind,
        "wrap": one_of(value.get("wrap"), &WRAPS).unwrap_or_else(|| json!("red")),
        "createdAt": value.get("createdAt").and_then(instant)?,
        "opensAt": value.get("opensAt").and_then(instant)?,
        "canOpen": flag("canOpen"),
        "opened": opened,
        "openedAt": value.get("openedAt").and_then(instant).unwrap_or(Json::Null),
        "onTree": flag("onTree"),
    });
    if opened {
        match kind.as_str() {
            Some("note") => gift["note"] = Json::String(text(value.get("note")?, 1000)?),
            _ => gift["card"] = project_card(value.get("card")?)?,
        }
    }
    Some(gift)
}

fn empty_body(req: &Request) -> Result<(), Response> {
    let body: Json = if req.body.is_empty() {
        json!({})
    } else {
        serde_json::from_slice(&req.body)
            .map_err(|_| Response::error(400, "The request is not valid JSON"))?
    };
    match body.as_object() {
        Some(object) if object.is_empty() => Ok(()),
        _ => Err(Response::error(
            400,
            "The request has a field this route does not take",
        )),
    }
}

fn gift_reply(reply: Json) -> Result<Json, Response> {
    let gift = reply
        .get("gift")
        .and_then(project_gift)
        .ok_or_else(bad_reply)?;
    Ok(json!({ "gift": gift }))
}

pub(super) fn route(req: &Request, name: &str) -> Response {
    route_with(&process_env, req, name)
}

pub(super) fn route_with(
    env: &dyn Fn(&str) -> Option<String>,
    req: &Request,
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
        _ => return Response::error(404, "Gifts are not set up"),
    };
    if req.method != "GET" {
        if let Err(response) = require_json(req) {
            return response;
        }
    }
    let parts: Vec<&str> = name.split('/').collect();
    let result = match (req.method.as_str(), parts.as_slice()) {
        ("GET", ["status"]) => Ok(json!({ "enabled": true, "state": "on" })),
        ("GET", ["list"]) => hosted(&config, "GET", "list", None).and_then(|reply| {
            let list = reply
                .get("gifts")
                .and_then(Json::as_array)
                .ok_or_else(bad_reply)?;
            Ok(json!({
                "gifts": list.iter().filter_map(project_gift).collect::<Vec<_>>(),
                "showNames": reply.get("showNames").and_then(Json::as_bool).unwrap_or(true),
                "opensAt": reply.get("opensAt").and_then(instant).ok_or_else(bad_reply)?,
            }))
        }),
        ("POST", ["settings"]) => {
            let body: Result<bool, Response> = serde_json::from_slice::<Json>(&req.body)
                .ok()
                .and_then(|b| {
                    let object = b.as_object()?;
                    (object.len() == 1).then(|| object.get("showNames")?.as_bool())?
                })
                .ok_or_else(|| Response::error(400, "Send only showNames, true or false"));
            body.and_then(|show| {
                let reply = hosted(&config, "POST", "settings", Some(&json!({ "showNames": show })))?;
                Ok(json!({ "showNames": reply.get("showNames").and_then(Json::as_bool).ok_or_else(bad_reply)? }))
            })
        }
        ("POST", [id, action @ ("open" | "hide")]) if is_uuid(id) => empty_body(req)
            .and_then(|_| hosted(&config, "POST", &format!("{id}/{action}"), Some(&json!({}))))
            .and_then(gift_reply),
        _ => return Response::error(404, "Unknown API route"),
    };
    match result {
        Ok(value) => Response::json(200, &value),
        Err(response) => response,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env(pairs: &'static [(&'static str, &'static str)]) -> impl Fn(&str) -> Option<String> {
        move |name| {
            pairs
                .iter()
                .find(|(k, _)| *k == name)
                .map(|(_, v)| v.to_string())
        }
    }

    fn get(path: &str) -> Request {
        Request {
            method: "GET".into(),
            path: path.into(),
            query: Default::default(),
            headers: Default::default(),
            body: Vec::new(),
            peer: "127.0.0.1".into(),
        }
    }

    #[test]
    fn off_and_misconfigured_say_so_and_nothing_else_answers() {
        let off = route_with(&env(&[]), &get("status"), "status");
        assert_eq!(
            serde_json::from_slice::<Json>(&off.body).unwrap()["state"],
            "off"
        );
        assert_eq!(route_with(&env(&[]), &get("list"), "list").status, 404);
        let bad = route_with(
            &env(&[
                ("OPENBLOG_GIFTS_ENDPOINT", "http://evil.example/api/gifts"),
                ("OPENBLOG_GIFTS_ADMIN_KEY", "short"),
            ]),
            &get("status"),
            "status",
        );
        let body: Json = serde_json::from_slice(&bad.body).unwrap();
        assert_eq!(body["state"], "invalid");
        assert_eq!(
            body["problems"],
            json!(["OPENBLOG_GIFTS_ENDPOINT", "OPENBLOG_GIFTS_ADMIN_KEY"])
        );
    }

    #[test]
    fn a_wrapped_gift_shows_no_contents_and_unknown_fields_never_pass_through() {
        let wrapped = json!({
            "id": "f8e84e25-6215-451e-b586-320ee9ed8a99", "from": "Ava", "showName": true, "kind": "note", "wrap": "plaid",
            "createdAt": "2026-11-13T03:06:38.633801-05:00", "opensAt": "2026-12-25T00:00:00-05:00",
            "canOpen": false, "opened": false, "onTree": true, "note": "should not pass", "senderDigest": "x"
        });
        let out = project_gift(&wrapped).unwrap();
        assert!(out.get("note").is_none());
        assert!(out.get("senderDigest").is_none());
        let mut opened = wrapped.clone();
        opened["opened"] = json!(true);
        opened["note"] = json!("Merry Christmas");
        assert_eq!(project_gift(&opened).unwrap()["note"], "Merry Christmas");
        let card = json!({ "design": "<svg onload=x>", "message": "hi", "stickers": [] });
        assert!(project_card(&card).is_none());
        let card = json!({ "design": "holly", "message": "hi", "stickers": [{ "kind": "star", "x": 200, "y": 1 }] });
        assert!(project_card(&card).is_none());
        let card = json!({ "design": "holly", "message": "hi", "signOff": "Jim", "stickers": [{ "kind": "star", "x": 20, "y": 30, "extra": 1 }] });
        assert_eq!(
            project_card(&card).unwrap()["stickers"][0],
            json!({ "kind": "star", "x": 20, "y": 30 })
        );
    }

    #[test]
    fn a_still_wrapped_gift_is_a_423_with_its_time() {
        let response = refusal(
            423,
            &json!({ "error": "not-yet", "opensAt": "2026-12-25T00:00:00-05:00" }),
        );
        assert_eq!(response.status, 423);
        let body: Json = serde_json::from_slice(&response.body).unwrap();
        assert_eq!(body["opensAt"], "2026-12-25T00:00:00-05:00");
        assert_eq!(refusal(401, &json!({})).status, 502);
    }
}
