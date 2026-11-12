//! Admin routes for greeting cards (ADR 0411): off and invisible unless configured, the session,
//! CSRF and body bounds of every Admin route, the key and actor sent to the hosted function, bodies
//! held to their fields, replies rebuilt from known fields, and the preview served under Admin's
//! preview policy rather than in Admin's own page.

use super::*;
use crate::admin::greetings::route_with;
use std::io::{Read, Write};
use std::net::TcpListener;

const KEY: &str = "adm_greetings_admin_key_00000000000000000000";
const ID: &str = "11111111-1111-4111-8111-111111111111";
const PERSON: &str = "22222222-2222-4222-8222-222222222222";

const ROUTES: &[(&str, &str, bool)] = &[
    ("GET", "/admin/api/greetings/status", false),
    ("GET", "/admin/api/greetings/contacts", false),
    ("POST", "/admin/api/greetings/contacts", true),
    (
        "POST",
        "/admin/api/greetings/contacts/22222222-2222-4222-8222-222222222222",
        true,
    ),
    (
        "POST",
        "/admin/api/greetings/contacts/22222222-2222-4222-8222-222222222222/remove",
        true,
    ),
    ("GET", "/admin/api/greetings/cards", false),
    ("POST", "/admin/api/greetings/cards", true),
    (
        "POST",
        "/admin/api/greetings/cards/11111111-1111-4111-8111-111111111111/cancel",
        true,
    ),
    ("POST", "/admin/api/greetings/preview", true),
    ("POST", "/admin/api/greetings/test", true),
];

fn env_for(endpoint: &str) -> impl Fn(&str) -> Option<String> {
    let endpoint = endpoint.to_string();
    move |name| match name {
        "OPENBLOG_GREETINGS_ENDPOINT" => Some(endpoint.clone()),
        "OPENBLOG_GREETINGS_ADMIN_KEY" => Some(KEY.to_string()),
        _ => None,
    }
}

/// A fake hosted function: answers each connection with the next canned reply and hands back the
/// raw requests it saw.
fn hosted(replies: Vec<(u16, String)>) -> (String, std::thread::JoinHandle<Vec<String>>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let handle = std::thread::spawn(move || {
        let mut seen = Vec::new();
        for (status, body) in replies {
            let mut stream = accept_provider_call(&listener);
            stream.set_read_timeout(Some(Duration::from_secs(10))).ok();
            let mut request = Vec::new();
            let mut chunk = [0u8; 4096];
            loop {
                let read = stream.read(&mut chunk).unwrap_or(0);
                if read == 0 {
                    break;
                }
                request.extend_from_slice(&chunk[..read]);
                let Some(end) = request.windows(4).position(|part| part == b"\r\n\r\n") else {
                    continue;
                };
                let head = String::from_utf8_lossy(&request[..end]).to_ascii_lowercase();
                let length = head
                    .lines()
                    .find_map(|line| {
                        line.strip_prefix("content-length:")
                            .and_then(|v| v.trim().parse::<usize>().ok())
                    })
                    .unwrap_or(0);
                if request.len() >= end + 4 + length {
                    break;
                }
            }
            seen.push(String::from_utf8_lossy(&request).to_string());
            let reply = format!(
                "HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            let _ = stream.write_all(reply.as_bytes());
        }
        seen
    });
    (format!("http://{address}/api/greetings"), handle)
}

fn card(extra: Json) -> Json {
    let mut value = json!({
        "id": ID, "contactId": PERSON, "design": "birthday", "subject": "Happy birthday, {name}!",
        "message": "Love you.\nSee you soon.", "signOff": "Love, Grammi", "sendOn": "1999-11-27", "hour": 8,
        "timeZone": "America/New_York", "yearly": true, "status": "scheduled",
        "nextSendAt": "2026-11-27T13:00:00.000Z", "lastSentAt": null, "attempts": 0, "error": null,
        "site_id": "must-not-pass",
    });
    for (key, field) in extra.as_object().unwrap() {
        value[key] = field.clone();
    }
    value
}

#[test]
fn unconfigured_it_is_off_and_every_other_route_is_not_there() {
    let f = fixture("greetings-off");
    let session = login_ok(&f);
    let status = handle(
        &f.state,
        &authed(req("GET", "/admin/api/greetings/status"), &session, false),
    );
    assert_eq!(status.status, 200);
    assert_eq!(
        body_json(&status),
        json!({ "enabled": false, "state": "off" })
    );
    for &(method, path, _) in ROUTES.iter().skip(1) {
        let r = handle(
            &f.state,
            &authed(json_req(method, path, json!({})), &session, true),
        );
        assert_eq!(r.status, 404, "{method} {path}");
    }
}

#[test]
fn every_route_denies_by_default_and_a_write_needs_a_session_the_csrf_token_and_json() {
    let f = fixture("greetings-auth");
    let session = login_ok(&f);
    for &(method, path, writes) in ROUTES {
        assert_eq!(
            handle(&f.state, &json_req(method, path, json!({}))).status,
            401,
            "{method} {path} unauthenticated"
        );
        assert!(
            preflight(&f.state, &req(method, path)).is_err(),
            "{method} {path} refused before its body is buffered"
        );
        let allowed = preflight(&f.state, &authed(req(method, path), &session, true)).unwrap();
        assert_eq!(allowed, 32 * 1024, "{method} {path} is bounded");
        if writes {
            let no_token = authed(json_req(method, path, json!({})), &session, false);
            assert_eq!(handle(&f.state, &no_token).status, 403, "{method} {path}");
        }
    }
    let (endpoint, _server) = hosted(vec![]);
    let env = env_for(&endpoint);
    assert_eq!(
        route_with(&env, &req("POST", "/x"), "grammi", "cards").status,
        415
    );
    for name in ["cards/not-an-id/cancel", "nothing", "contacts/x/remove"] {
        let r = route_with(&env, &json_req("POST", "/x", json!({})), "grammi", name);
        assert_eq!(r.status, 404, "{name}");
    }
    // A body may hold only the fields its route takes, and is refused before anything is sent.
    let r = route_with(
        &env,
        &json_req(
            "POST",
            "/x",
            json!({ "name": "Kristin", "email": "k@example.com", "admin": true }),
        ),
        "grammi",
        "contacts",
    );
    assert_eq!(r.status, 400);
}

#[test]
fn a_bad_setting_is_reported_by_name_and_nothing_is_sent() {
    let env = |name: &str| match name {
        "OPENBLOG_GREETINGS_ENDPOINT" => {
            Some("http://family.example.com/api/greetings".to_string())
        }
        "OPENBLOG_GREETINGS_ADMIN_KEY" => Some("short".to_string()),
        _ => None,
    };
    let status = route_with(&env, &req("GET", "/x"), "grammi", "status");
    assert_eq!(
        body_json(&status),
        json!({ "enabled": false, "state": "invalid", "problems": ["OPENBLOG_GREETINGS_ENDPOINT", "OPENBLOG_GREETINGS_ADMIN_KEY"] })
    );
    assert_eq!(
        route_with(&env, &req("GET", "/x"), "grammi", "cards").status,
        404
    );
}

#[test]
fn cards_are_rebuilt_from_known_fields_and_sent_with_the_key_and_actor() {
    let reply = json!({ "leak": "x", "cards": [
        card(json!({})),
        card(json!({ "id": "not-a-uuid" })),
        card(json!({ "id": "33333333-3333-4333-8333-333333333333", "status": "exploded" })),
        card(json!({ "id": "44444444-4444-4444-8444-444444444444", "message": "bell\u{7}" })),
    ]});
    let (endpoint, server) = hosted(vec![(200, reply.to_string())]);
    let r = route_with(&env_for(&endpoint), &req("GET", "/x"), "grammi", "cards");
    assert_eq!(r.status, 200);
    let body = body_json(&r);
    assert!(body.get("leak").is_none());
    let cards = body["cards"].as_array().unwrap();
    assert_eq!(cards.len(), 1, "a bad id, status or message is dropped");
    assert!(cards[0].get("site_id").is_none());
    assert_eq!(cards[0]["message"], "Love you.\nSee you soon.");
    assert_eq!(cards[0]["nextSendAt"], "2026-11-27T13:00:00.000Z");
    let seen = server.join().unwrap();
    assert!(seen[0].starts_with("GET /api/greetings/cards "));
    assert!(
        seen[0].contains(&format!("authorization: Bearer {KEY}"))
            || seen[0].contains(&format!("Authorization: Bearer {KEY}"))
    );
    assert!(seen[0]
        .to_ascii_lowercase()
        .contains("x-openblog-actor: grammi"));
}

#[test]
fn the_functions_refusal_names_the_field_in_plain_words() {
    let (endpoint, _server) = hosted(vec![(
        400,
        json!({ "error": "invalid-email", "field": "email" }).to_string(),
    )]);
    let r = route_with(
        &env_for(&endpoint),
        &json_req("POST", "/x", json!({ "name": "Kristin", "email": "nope" })),
        "grammi",
        "contacts",
    );
    assert_eq!(r.status, 400);
    let body = body_json(&r);
    assert_eq!(body["field"], "email");
    assert!(body["error"].as_str().unwrap().contains("name@example.com"));
}

#[test]
fn a_preview_is_served_as_its_own_document_under_a_policy_that_runs_nothing() {
    let f = fixture("greetings-preview");
    let session = login_ok(&f);
    let (endpoint, _server) = hosted(vec![(
        200,
        json!({ "subject": "Happy birthday, Kristin!", "sendsAt": "2026-11-27T13:00:00.000Z",
                "html": "<!doctype html><p style=\"color:red\">Happy birthday</p>" })
        .to_string(),
    )]);
    std::env::set_var("OPENBLOG_GREETINGS_ENDPOINT", &endpoint);
    std::env::set_var("OPENBLOG_GREETINGS_ADMIN_KEY", KEY);
    let r = handle(
        &f.state,
        &authed(
            json_req(
                "POST",
                "/admin/api/greetings/preview",
                json!({ "contactId": PERSON, "design": "birthday", "message": "Hi", "sendOn": "1999-11-27" }),
            ),
            &session,
            true,
        ),
    );
    std::env::remove_var("OPENBLOG_GREETINGS_ENDPOINT");
    std::env::remove_var("OPENBLOG_GREETINGS_ADMIN_KEY");
    assert_eq!(r.status, 200);
    let body = body_json(&r);
    assert!(
        body.get("html").is_none(),
        "the card is not handed to Admin's own page"
    );
    let url = body["previewUrl"].as_str().unwrap();
    let served = handle(&f.state, &authed(req("GET", url), &session, false));
    assert_eq!(served.status, 200);
    assert!(String::from_utf8(served.body.clone())
        .unwrap()
        .contains("Happy birthday"));
    assert!(served
        .headers
        .iter()
        .any(|(name, value)| name == "Content-Security-Policy"
            && value.starts_with("default-src 'none'; style-src 'unsafe-inline'")
            && !value.contains("script-src")));
}
