//! Admin routes for stored quote requests (ADR 0384): off and invisible unless configured, the
//! session, CSRF and body bounds of every Admin route, the key and actor sent to the hosted
//! function, and replies rebuilt from known fields.

use super::*;
use crate::admin::quote::route_with;
use std::io::{Read, Write};
use std::net::TcpListener;

const KEY: &str = "adm_quote_admin_key_000000000000000000000000";
const ID: &str = "11111111-1111-4111-8111-111111111111";

const ROUTES: &[(&str, &str, bool)] = &[
    ("GET", "/admin/api/quote/status", false),
    ("GET", "/admin/api/quote/requests", false),
    (
        "POST",
        "/admin/api/quote/requests/11111111-1111-4111-8111-111111111111/status",
        true,
    ),
    ("GET", "/admin/api/quote/export", false),
    ("POST", "/admin/api/quote/erase/preview", true),
    ("POST", "/admin/api/quote/erase", true),
    ("POST", "/admin/api/quote/retention/run", true),
    ("POST", "/admin/api/quote/notifications/retry", true),
];

fn env_for(endpoint: &str) -> impl Fn(&str) -> Option<String> {
    let endpoint = endpoint.to_string();
    move |name| match name {
        "OPENBLOG_QUOTE_ENDPOINT" => Some(endpoint.clone()),
        "OPENBLOG_QUOTE_ADMIN_KEY" => Some(KEY.to_string()),
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
    (format!("http://{address}/api/quote"), handle)
}

fn request(extra: Json) -> Json {
    let mut value = json!({
        "id": ID, "status": "new", "name": "Pat Smith", "phone": "+1 360 555 0142", "email": null,
        "town": "Bend", "service": "Fencing", "description": "Replace the fence.\nSecond line.",
        "page": "/services/fencing/", "photoCount": 1,
        "photos": [{ "url": "https://proj.supabase.co/storage/v1/object/sign/openblog-quote-photos/acme/x/1.jpg?token=t", "type": "image/jpeg" }],
        "createdAt": "2026-10-29T12:00:00.000Z", "handledAt": null, "archivedAt": null, "eraseAfter": null, "notify": "off",
        "client_hash": "must-not-pass", "token_hash": "must-not-pass",
    });
    for (key, field) in extra.as_object().unwrap() {
        value[key] = field.clone();
    }
    value
}

#[test]
fn unconfigured_it_is_off_and_every_other_route_is_not_there() {
    let f = fixture("quote-off");
    let session = login_ok(&f);
    let status = handle(
        &f.state,
        &authed(req("GET", "/admin/api/quote/status"), &session, false),
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
    let f = fixture("quote-auth");
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
        assert_eq!(allowed, 16 * 1024, "{method} {path} is bounded");
        if !writes {
            continue;
        }
        let no_token = authed(json_req(method, path, json!({})), &session, false);
        assert_eq!(handle(&f.state, &no_token).status, 403, "{method} {path}");
    }
    let (endpoint, _server) = hosted(vec![]);
    let env = env_for(&endpoint);
    assert_eq!(
        route_with(&env, &req("POST", "/x"), "mikey", "erase").status,
        415
    );
    for name in ["requests/not-an-id/status", "nothing", "erase/now"] {
        let r = route_with(&env, &json_req("POST", "/x", json!({})), "mikey", name);
        assert_eq!(r.status, 404, "{name}");
    }
}

#[test]
fn a_bad_setting_is_reported_by_name_and_nothing_is_sent() {
    let env = |name: &str| match name {
        "OPENBLOG_QUOTE_ENDPOINT" => Some("http://blog.example.com/api/quote".to_string()),
        "OPENBLOG_QUOTE_ADMIN_KEY" => Some("short".to_string()),
        _ => None,
    };
    let status = route_with(&env, &req("GET", "/x"), "mikey", "status");
    assert_eq!(
        body_json(&status),
        json!({ "enabled": false, "state": "invalid", "problems": ["OPENBLOG_QUOTE_ENDPOINT", "OPENBLOG_QUOTE_ADMIN_KEY"] })
    );
    assert_eq!(
        route_with(&env, &req("GET", "/x"), "mikey", "requests").status,
        404
    );
}

#[test]
fn the_list_is_rebuilt_from_known_fields_and_sent_with_the_key_actor_and_filters() {
    let reply = json!({
        "retentionDays": 30, "services": ["Fencing"], "leak": "x",
        "requests": [
            request(json!({})),
            request(json!({ "id": "22222222-2222-4222-8222-222222222222", "photos": [{ "url": "https://evil.example/x.jpg", "type": "image/jpeg" }, { "url": "http://proj.supabase.co/storage/v1/object/sign/a", "type": "image/jpeg" }] })),
            request(json!({ "id": "not-a-uuid" })),
            request(json!({ "id": "33333333-3333-4333-8333-333333333333", "status": "won" })),
        ],
    });
    let (endpoint, server) = hosted(vec![(200, reply.to_string())]);
    let env = env_for(&endpoint);
    let mut get = req("GET", "/x");
    get.query.insert("status".into(), "new".into());
    get.query.insert("service".into(), "Fen cing&x".into());
    let r = route_with(&env, &get, "mikey", "requests");
    assert_eq!(r.status, 200);
    let body = body_json(&r);
    let list = body["requests"].as_array().unwrap();
    assert_eq!(list.len(), 2, "a bad id or status is dropped");
    assert_eq!(body["unreadable"], 2, "and counted, so Admin can say so");
    assert_eq!(list[0]["description"], "Replace the fence.\nSecond line.");
    assert_eq!(list[0]["photos"].as_array().unwrap().len(), 1);
    assert_eq!(
        list[1]["photos"].as_array().unwrap().len(),
        0,
        "only signed https storage addresses pass"
    );
    assert_eq!(body["retentionDays"], 30);
    let text = body.to_string();
    assert!(!text.contains("must-not-pass") && !text.contains("leak"));
    let seen = server.join().unwrap();
    let head = seen[0].to_ascii_lowercase();
    assert!(head.starts_with("get /api/quote/requests?status=new&service=fen+cing%26x "));
    assert!(head.contains(&format!(
        "authorization: bearer {}",
        KEY.to_ascii_lowercase()
    )));
    assert!(head.contains("x-openblog-actor: mikey"));
}

#[test]
fn a_request_with_a_c1_control_character_is_shown_not_hidden() {
    // Stored before the intake stripped them (ADR 0386): U+0085 in the name, U+009B in the text.
    let reply = json!({
        "requests": [
            request(json!({ "name": "Ann\u{0085}Lee", "description": "Fence\u{009b}31m please.\nThanks" })),
            request(json!({ "id": "22222222-2222-4222-8222-222222222222" })),
        ],
    });
    let (endpoint, _server) = hosted(vec![(200, reply.to_string())]);
    let env = env_for(&endpoint);
    let body = body_json(&route_with(&env, &req("GET", "/x"), "mikey", "requests"));
    let list = body["requests"].as_array().unwrap();
    assert_eq!(list.len(), 2, "both requests are listed");
    assert_eq!(list[0]["name"], "Ann Lee");
    assert_eq!(list[0]["description"], "Fence 31m please.\nThanks");
    assert_eq!(body["unreadable"], 0);
}

#[test]
fn a_status_change_accepts_only_the_three_statuses() {
    let (endpoint, server) = hosted(vec![(
        200,
        json!({ "id": ID, "status": "archived" }).to_string(),
    )]);
    let env = env_for(&endpoint);
    let bad = route_with(
        &env,
        &json_req("POST", "/x", json!({ "status": "won" })),
        "mikey",
        &format!("requests/{ID}/status"),
    );
    assert_eq!(bad.status, 400);
    let extra = route_with(
        &env,
        &json_req("POST", "/x", json!({ "status": "new", "name": "x" })),
        "mikey",
        &format!("requests/{ID}/status"),
    );
    assert_eq!(extra.status, 400);
    let ok = route_with(
        &env,
        &json_req("POST", "/x", json!({ "status": "archived" })),
        "mikey",
        &format!("requests/{ID}/status"),
    );
    assert_eq!(ok.status, 200);
    assert_eq!(body_json(&ok), json!({ "id": ID, "status": "archived" }));
    assert_eq!(
        server.join().unwrap().len(),
        1,
        "refused changes never reached the function"
    );
}

#[test]
fn export_validates_its_dates_and_returns_a_safe_download() {
    let (endpoint, server) = hosted(vec![
        (200, json!({ "csv": "id,x\r\n", "count": 0, "filename": "quote-requests-2026-10-01-to-now.csv" }).to_string()),
        (200, json!({ "csv": "x", "count": 0, "filename": "../evil.csv" }).to_string()),
    ]);
    let env = env_for(&endpoint);
    let mut bad = req("GET", "/x");
    bad.query.insert("from".into(), "yesterday".into());
    assert_eq!(route_with(&env, &bad, "mikey", "export").status, 400);
    let mut ok = req("GET", "/x");
    ok.query.insert("from".into(), "2026-10-01".into());
    let r = route_with(&env, &ok, "mikey", "export");
    assert_eq!(
        body_json(&r)["filename"],
        "quote-requests-2026-10-01-to-now.csv"
    );
    assert_eq!(
        route_with(&env, &ok, "mikey", "export").status,
        502,
        "an unsafe filename is not passed on"
    );
    server.join().unwrap();
}

#[test]
fn erase_needs_a_preview_token_and_valid_ids_and_reports_a_verified_result() {
    let (endpoint, server) = hosted(vec![
        (200, json!({ "count": 1, "photos": 2, "expiresAt": "2026-10-29T12:10:00.000Z", "token": "1700000000000.abc_-" }).to_string()),
        (200, json!({ "erased": 1, "verified": true, "photosPending": 1 }).to_string()),
        (502, json!({ "error": "erase-failed", "detail": "Pat Smith leaked" }).to_string()),
    ]);
    let env = env_for(&endpoint);
    for body in [
        json!({ "ids": [] }),
        json!({ "ids": ["x"] }),
        json!({ "ids": [ID], "other": 1 }),
    ] {
        assert_eq!(
            route_with(
                &env,
                &json_req("POST", "/x", body),
                "mikey",
                "erase/preview"
            )
            .status,
            400
        );
    }
    assert_eq!(
        route_with(
            &env,
            &json_req("POST", "/x", json!({ "ids": [ID] })),
            "mikey",
            "erase"
        )
        .status,
        400,
        "no token"
    );
    let preview = route_with(
        &env,
        &json_req("POST", "/x", json!({ "ids": [ID] })),
        "mikey",
        "erase/preview",
    );
    assert_eq!(body_json(&preview)["token"], "1700000000000.abc_-");
    let done = route_with(
        &env,
        &json_req(
            "POST",
            "/x",
            json!({ "ids": [ID], "token": "1700000000000.abc_-" }),
        ),
        "mikey",
        "erase",
    );
    assert_eq!(
        body_json(&done),
        json!({ "erased": 1, "verified": true, "photosPending": 1 })
    );
    let failed = route_with(
        &env,
        &json_req("POST", "/x", json!({ "ids": [ID], "token": "t" })),
        "mikey",
        "erase",
    );
    assert_eq!(failed.status, 502);
    assert!(!String::from_utf8_lossy(&failed.body).contains("Pat"));
    let said = String::from_utf8_lossy(&failed.body).to_string();
    // A failed erase puts every photo back first (ADR 0386), so nothing is said to be gone.
    assert!(said.contains("Every request and its photos are still here"));
    assert!(!said.contains("may already be gone"));
    assert_eq!(server.join().unwrap().len(), 3);
}

#[test]
fn failed_owner_emails_reach_admin_and_a_retry_passes_back_only_counts() {
    let reply = json!({
        "retentionDays": null, "services": [], "notifyEnabled": true,
        "requests": [
            request(json!({ "notify": "failed", "notifyAttempts": 2, "notifyError": "provider-error" })),
            request(json!({ "id": "22222222-2222-4222-8222-222222222222", "notify": "exploded", "notifyAttempts": 9999, "notifyError": "Pat Smith's inbox" })),
        ],
    });
    let (endpoint, server) = hosted(vec![
        (200, reply.to_string()),
        (
            200,
            json!({ "tried": 1, "sent": 1, "failed": 0, "gaveUp": 0, "rows": [{ "name": "Pat" }] })
                .to_string(),
        ),
        (409, json!({ "error": "notifications-off" }).to_string()),
    ]);
    let env = env_for(&endpoint);
    let list = body_json(&route_with(&env, &req("GET", "/x"), "mikey", "requests"));
    assert_eq!(list["notifyEnabled"], true);
    let first = &list["requests"][0];
    assert_eq!(
        (
            &first["notify"],
            &first["notifyAttempts"],
            &first["notifyError"]
        ),
        (&json!("failed"), &json!(2), &json!("provider-error"))
    );
    let odd = &list["requests"][1];
    assert_eq!(
        (&odd["notify"], &odd["notifyAttempts"], &odd["notifyError"]),
        (&Json::Null, &json!(0), &Json::Null),
        "unknown states, counts and codes are dropped"
    );
    assert_eq!(
        route_with(
            &env,
            &json_req("POST", "/x", json!({ "ids": [] })),
            "mikey",
            "notifications/retry"
        )
        .status,
        400,
        "the retry takes no fields"
    );
    let retried = route_with(
        &env,
        &json_req("POST", "/x", json!({})),
        "mikey",
        "notifications/retry",
    );
    assert_eq!(
        body_json(&retried),
        json!({ "tried": 1, "sent": 1, "failed": 0, "gaveUp": 0 })
    );
    let off = route_with(
        &env,
        &json_req("POST", "/x", json!({})),
        "mikey",
        "notifications/retry",
    );
    assert_eq!(off.status, 409);
    assert!(String::from_utf8_lossy(&off.body).contains("turned off"));
    let seen = server.join().unwrap();
    assert!(seen[1]
        .to_ascii_lowercase()
        .starts_with("post /api/quote/notifications/retry "));
}
