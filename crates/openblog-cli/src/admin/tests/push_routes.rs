//! Admin routes for push notifications (ADR 0412): off and invisible unless configured, the session,
//! CSRF and body bounds of every Admin route, the key and actor sent to the hosted function, bodies
//! held to their fields, replies rebuilt from known fields with no endpoint passed back, and the
//! installed app's manifest, icons and service worker.

use super::*;
use crate::admin::push::route_with;
use std::io::{Read, Write};
use std::net::TcpListener;

const KEY: &str = "adm_push_admin_key_0000000000000000000000000";
const ID: &str = "11111111-1111-4111-8111-111111111111";
const PUBLIC: &str =
    "BNJXQLrFqB91iIEvDTQE-lvUxvYyB_Hj57arqlCDifnNudW0TeOybFZdAm45MSdoDRrmo7yK48iuCh2rOHYV7MM";
const HASH: &str = "0123456789abcdef0123456789abcdef";

const ROUTES: &[(&str, &str, bool)] = &[
    ("GET", "/admin/api/push/status", false),
    ("POST", "/admin/api/push/devices", true),
    (
        "POST",
        "/admin/api/push/devices/11111111-1111-4111-8111-111111111111",
        true,
    ),
    (
        "POST",
        "/admin/api/push/devices/11111111-1111-4111-8111-111111111111/remove",
        true,
    ),
    ("POST", "/admin/api/push/test", true),
];

fn env_for(endpoint: &str) -> impl Fn(&str) -> Option<String> {
    let endpoint = endpoint.to_string();
    move |name| match name {
        "OPENBLOG_PUSH_ENDPOINT" => Some(endpoint.clone()),
        "OPENBLOG_PUSH_ADMIN_KEY" => Some(KEY.to_string()),
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
    (format!("http://{address}/api/push"), handle)
}

fn ctype(r: &Response) -> String {
    r.headers
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case("content-type"))
        .map(|(_, v)| v.clone())
        .unwrap_or_default()
}

fn device(extra: Json) -> Json {
    let mut value = json!({
        "id": ID, "device": HASH, "label": "Grammi's iPhone", "kinds": ["comment", "app"],
        "createdAt": "2026-11-13T12:00:00.000Z", "lastSentAt": null,
        "endpoint": "https://fcm.googleapis.com/fcm/send/secret", "auth": "must-not-pass",
    });
    for (key, field) in extra.as_object().unwrap() {
        value[key] = field.clone();
    }
    value
}

#[test]
fn unconfigured_it_is_off_and_every_other_route_is_not_there() {
    let f = fixture("push-off");
    let session = login_ok(&f);
    let status = handle(
        &f.state,
        &authed(req("GET", "/admin/api/push/status"), &session, false),
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
    let f = fixture("push-auth");
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
        assert_eq!(allowed, 8 * 1024, "{method} {path} is bounded");
        if writes {
            let no_token = authed(json_req(method, path, json!({})), &session, false);
            assert_eq!(handle(&f.state, &no_token).status, 403, "{method} {path}");
        }
    }
    let (endpoint, _server) = hosted(vec![]);
    let env = env_for(&endpoint);
    assert_eq!(
        route_with(&env, &req("POST", "/x"), "grammi", "devices").status,
        415
    );
    for name in ["devices/not-an-id/remove", "nothing", "notify"] {
        let r = route_with(&env, &json_req("POST", "/x", json!({})), "grammi", name);
        assert_eq!(r.status, 404, "{name}");
    }
    // A body may hold only the fields its route takes, and is refused before anything is sent.
    let r = route_with(
        &env,
        &json_req(
            "POST",
            "/x",
            json!({ "label": "Phone", "endpoint": "https://evil.example" }),
        ),
        "grammi",
        "devices",
    );
    assert_eq!(r.status, 400);
    let r = route_with(
        &env,
        &json_req("POST", "/x", json!({ "id": "nope" })),
        "grammi",
        "test",
    );
    assert_eq!(r.status, 400);
}

#[test]
fn a_bad_setting_is_reported_by_name_and_nothing_is_sent() {
    let env = |name: &str| match name {
        "OPENBLOG_PUSH_ENDPOINT" => Some("http://family.example.com/api/push".to_string()),
        "OPENBLOG_PUSH_ADMIN_KEY" => Some("short".to_string()),
        _ => None,
    };
    let status = route_with(&env, &req("GET", "/x"), "grammi", "status");
    assert_eq!(
        body_json(&status),
        json!({ "enabled": false, "state": "invalid", "problems": ["OPENBLOG_PUSH_ENDPOINT", "OPENBLOG_PUSH_ADMIN_KEY"] })
    );
    assert_eq!(
        route_with(
            &env,
            &json_req("POST", "/x", json!({})),
            "grammi",
            "devices"
        )
        .status,
        404
    );
}

#[test]
fn status_is_rebuilt_from_known_fields_and_no_endpoint_comes_back() {
    let reply = json!({
        "enabled": true, "publicKey": PUBLIC, "otherApps": true, "leak": "x",
        "kinds": [{ "id": "comment", "label": "New comments" }, { "id": "secrets", "label": "Nope" }],
        "devices": [
            device(json!({})),
            device(json!({ "id": "22222222-2222-4222-8222-222222222222", "kinds": ["comment", "everything"] })),
            device(json!({ "id": "not-a-uuid" })),
            device(json!({ "id": "33333333-3333-4333-8333-333333333333", "device": "https://fcm.googleapis.com/x" })),
        ],
    });
    let (endpoint, server) = hosted(vec![(200, reply.to_string())]);
    let r = route_with(&env_for(&endpoint), &req("GET", "/x"), "grammi", "status");
    assert_eq!(r.status, 200);
    let body = body_json(&r);
    let text = body.to_string();
    assert!(
        !text.contains("fcm.googleapis.com"),
        "no endpoint is passed back"
    );
    assert!(!text.contains("must-not-pass") && body.get("leak").is_none());
    assert_eq!(body["publicKey"], PUBLIC);
    assert_eq!(
        body["kinds"],
        json!([{ "id": "comment", "label": "New comments" }])
    );
    let devices = body["devices"].as_array().unwrap();
    assert_eq!(devices.len(), 2, "a bad id or hash is dropped");
    assert_eq!(
        devices[1]["kinds"],
        json!(["comment"]),
        "unknown kinds are dropped"
    );
    let seen = server.join().unwrap();
    assert!(seen[0].starts_with("GET /api/push/status "));
    assert!(seen[0].to_ascii_lowercase().contains(&format!(
        "authorization: bearer {}",
        KEY.to_ascii_lowercase()
    )));
    assert!(seen[0]
        .to_ascii_lowercase()
        .contains("x-openblog-actor: grammi"));

    // A function switched off answers 404: Admin says so instead of failing.
    let (endpoint, _server) = hosted(vec![(404, json!({ "error": "not-enabled" }).to_string())]);
    let r = route_with(&env_for(&endpoint), &req("GET", "/x"), "grammi", "status");
    assert_eq!(
        body_json(&r),
        json!({ "enabled": false, "state": "unavailable" })
    );
}

#[test]
fn a_device_is_saved_through_the_function_and_its_refusals_are_plain_words() {
    let subscription = json!({ "endpoint": "https://fcm.googleapis.com/fcm/send/abc", "keys": { "p256dh": "x", "auth": "y" } });
    let (endpoint, server) = hosted(vec![
        (200, json!({ "device": device(json!({})) }).to_string()),
        (
            400,
            json!({ "error": "invalid-subscription", "field": "subscription" }).to_string(),
        ),
        (410, json!({ "error": "gone" }).to_string()),
    ]);
    let env = env_for(&endpoint);
    let saved = route_with(
        &env,
        &json_req(
            "POST",
            "/x",
            json!({ "subscription": subscription, "label": "Grammi's iPhone", "kinds": ["comment"] }),
        ),
        "grammi",
        "devices",
    );
    assert_eq!(saved.status, 200);
    assert_eq!(body_json(&saved)["device"]["label"], "Grammi's iPhone");
    assert!(!body_json(&saved).to_string().contains("fcm.googleapis.com"));
    let refused = route_with(
        &env,
        &json_req("POST", "/x", json!({ "subscription": {}, "label": "x" })),
        "grammi",
        "devices",
    );
    assert_eq!(refused.status, 400);
    assert!(body_json(&refused)["error"]
        .as_str()
        .unwrap()
        .contains("won't send to"));
    let gone = route_with(
        &env,
        &json_req("POST", "/x", json!({ "id": ID })),
        "grammi",
        "test",
    );
    assert_eq!(gone.status, 410);
    let seen = server.join().unwrap();
    assert!(seen[0].starts_with("POST /api/push/devices "));
    assert!(
        seen[0].contains("fcm.googleapis.com/fcm/send/abc"),
        "the subscription goes to the function"
    );
    assert!(seen[2].starts_with("POST /api/push/test "));
}

#[test]
fn admin_installs_as_an_app_with_the_sites_name_its_icons_and_a_worker() {
    let f = fixture("push-app");
    let manifest = handle(&f.state, &req("GET", "/admin/manifest.webmanifest"));
    assert_eq!(manifest.status, 200);
    assert!(ctype(&manifest).starts_with("application/manifest+json"));
    let value: Json = serde_json::from_slice(&manifest.body).unwrap();
    assert!(value["name"].as_str().unwrap().ends_with("Admin"));
    assert_eq!(value["start_url"], "/admin/");
    assert_eq!(value["scope"], "/admin/");
    assert_eq!(value["display"], "standalone");
    for icon in ["icon-192.png", "icon-512.png", "apple-touch-icon.png"] {
        let r = handle(&f.state, &req("GET", &format!("/admin/icons/{icon}")));
        assert_eq!(r.status, 200, "{icon}");
        assert_eq!(ctype(&r), "image/png");
        assert!(r.body.starts_with(b"\x89PNG"));
    }
    assert_eq!(
        handle(&f.state, &req("GET", "/admin/icons/../admin.js")).status,
        404
    );
    assert_eq!(
        handle(&f.state, &req("GET", "/admin/icons/other.png")).status,
        404
    );
    let worker = handle(&f.state, &req("GET", "/admin/sw.js"));
    assert_eq!(worker.status, 200);
    assert!(ctype(&worker).starts_with("text/javascript"));
    assert!(String::from_utf8_lossy(&worker.body).contains("showNotification"));
    let page = String::from_utf8_lossy(&handle(&f.state, &req("GET", "/admin/")).body).to_string();
    assert!(page.contains(r#"<link rel="manifest" href="/admin/manifest.webmanifest">"#));

    // A site can bring its own icon.
    let config = site::load_config(&f.state.root).unwrap_or_default();
    let own = f.state.root.join(&config.paths.web).join("admin/icons");
    std::fs::create_dir_all(&own).unwrap();
    std::fs::write(own.join("icon-192.png"), b"\x89PNG-grammi").unwrap();
    let r = handle(&f.state, &req("GET", "/admin/icons/icon-192.png"));
    assert_eq!(r.body, b"\x89PNG-grammi");
}
