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

fn header(r: &Response, name: &str) -> String {
    r.headers
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case(name))
        .map(|(_, v)| v.clone())
        .unwrap_or_default()
}

#[test]
fn the_installed_app_opens_studio_under_the_same_id_and_scope_with_studios_worker_and_icons() {
    let f = fixture("push-app");
    let manifest = handle(&f.state, &req("GET", "/admin/manifest.webmanifest"));
    assert_eq!(manifest.status, 200);
    assert!(ctype(&manifest).starts_with("application/manifest+json"));
    let value: Json = serde_json::from_slice(&manifest.body).unwrap();
    // Same app as before Studio (id, scope), now opening Studio's Home, named in her words.
    assert_eq!(value["id"], "/admin/");
    assert_eq!(value["start_url"], "/admin/studio/");
    assert_eq!(value["scope"], "/admin/");
    assert_eq!(value["display"], "standalone");
    for field in ["name", "short_name"] {
        let name = value[field].as_str().unwrap();
        assert!(
            !name.is_empty() && !name.contains("Admin"),
            "{field}: {name}"
        );
    }
    assert!(value["short_name"].as_str().unwrap().chars().count() <= 12);
    let icons: Vec<&str> = value["icons"]
        .as_array()
        .unwrap()
        .iter()
        .map(|i| i["src"].as_str().unwrap())
        .collect();
    assert!(icons.contains(&"/admin/icons/badge-96.png"));
    for icon in [
        "icon-192.png",
        "icon-512.png",
        "apple-touch-icon.png",
        "badge-96.png",
    ] {
        let r = handle(&f.state, &req("GET", &format!("/admin/icons/{icon}")));
        assert_eq!(r.status, 200, "{icon}");
        assert_eq!(ctype(&r), "image/png");
        assert!(r.body.starts_with(b"\x89PNG"));
        let studio = crate::admin::studio_bytes(&format!("icons/{icon}")).unwrap();
        assert_eq!(r.body, studio, "{icon} is Studio's own");
    }
    for bad in [
        "/admin/icons/../admin.js",
        "/admin/icons/other.png",
        "/admin/icons/icons/icon-192.png",
    ] {
        assert_eq!(handle(&f.state, &req("GET", bad)).status, 404, "{bad}");
    }

    // The one worker is Studio's, at the old address and always asked again; never under /admin/studio/.
    let worker = handle(&f.state, &req("GET", "/admin/sw.js"));
    assert_eq!(worker.status, 200);
    assert!(ctype(&worker).starts_with("text/javascript"));
    assert_eq!(header(&worker, "cache-control"), "no-cache");
    // Studio's file, after the one line naming this release's own files (R4 G35).
    let mut expected = crate::admin::studio_release_line().into_bytes();
    expected.extend_from_slice(crate::admin::studio_bytes("sw.js").unwrap());
    assert_eq!(worker.body, expected);
    let code = String::from_utf8_lossy(&worker.body).to_string();
    assert!(code.contains("showNotification") && code.contains("/admin/studio/"));
    assert_eq!(
        handle(&f.state, &req("GET", "/admin/studio/sw.js")).status,
        404
    );

    // Both pages point at the manifest.
    for page in ["/admin/", "/admin/studio/"] {
        let body = String::from_utf8_lossy(&handle(&f.state, &req("GET", page)).body).to_string();
        assert!(
            body.contains(r#"<link rel="manifest" href="/admin/manifest.webmanifest">"#),
            "{page}"
        );
    }

    // A site can bring its own icon, but not its own worker.
    let config = site::load_config(&f.state.root).unwrap_or_default();
    let web = f.state.root.join(&config.paths.web).join("admin");
    std::fs::create_dir_all(web.join("icons")).unwrap();
    std::fs::write(web.join("icons/icon-192.png"), b"\x89PNG-grammi").unwrap();
    std::fs::write(web.join("sw.js"), b"self.close()").unwrap();
    let r = handle(&f.state, &req("GET", "/admin/icons/icon-192.png"));
    assert_eq!(r.body, b"\x89PNG-grammi");
    let worker = handle(&f.state, &req("GET", "/admin/sw.js"));
    // Studio's file, after the one line naming this release's own files (R4 G35).
    let mut expected = crate::admin::studio_release_line().into_bytes();
    expected.extend_from_slice(crate::admin::studio_bytes("sw.js").unwrap());
    assert_eq!(worker.body, expected);
}

#[test]
fn studio_knows_which_release_it_is_and_the_worker_keeps_that_file_too() {
    let f = fixture("push-release");
    let line = crate::admin::studio_release_line();
    let release: Json = serde_json::from_str(
        line.trim()
            .trim_start_matches("self.STUDIO_RELEASE = ")
            .trim_end_matches(';'),
    )
    .unwrap();
    let version = release["version"].as_str().unwrap().to_string();
    assert_eq!(version.len(), 16);
    let r = handle(&f.state, &req("GET", "/admin/studio/release.js"));
    assert_eq!(r.status, 200);
    assert!(ctype(&r).starts_with("text/javascript"));
    assert_eq!(
        String::from_utf8_lossy(&r.body),
        format!("export const RELEASE = \"{version}\";\n")
    );
    let files: Vec<&str> = release["files"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(Json::as_str)
        .collect();
    assert!(files.contains(&"/admin/studio/release.js"));
    assert!(files.contains(&"/admin/studio/"));
    assert!(!files.iter().any(|file| file.contains("/api/")));
    // Not a file of its own anywhere else, and only ever read.
    assert_eq!(
        handle(&f.state, &req("GET", "/admin/release.js")).status,
        404
    );
    assert_eq!(
        handle(&f.state, &req("POST", "/admin/studio/release.js")).status,
        405
    );
}

#[test]
fn the_manifest_names_the_app_after_the_site_or_my_blog() {
    let mut config = SiteConfig::default();
    let named = |config: &SiteConfig| -> Json {
        serde_json::from_slice(&crate::admin::push::manifest(config, false).body).unwrap()
    };
    config.title = "Grammi's House".into();
    let value = named(&config);
    assert_eq!(value["name"], "Grammi's House");
    assert_eq!(value["short_name"], "My blog", "more than 12 characters");
    config.title = "Grammi".into();
    assert_eq!(named(&config)["short_name"], "Grammi");
    config.title = "  ".into();
    let value = named(&config);
    assert_eq!(value["name"], "My blog");
    assert_eq!(value["short_name"], "My blog");
}

#[test]
fn every_push_error_carries_a_code_studio_can_choose_its_words_by() {
    let code = |r: &Response| body_json(r)["code"].as_str().unwrap_or("").to_string();
    // Not set up.
    let off = |_: &str| None;
    let r = route_with(&off, &json_req("POST", "/x", json!({})), "grammi", "test");
    assert_eq!((r.status, code(&r)), (404, "not-set-up".into()));

    let (endpoint, server) = hosted(vec![
        (401, json!({ "error": "unauthorized" }).to_string()),
        (503, json!({ "error": "storage-unavailable" }).to_string()),
        (409, json!({ "error": "too-many" }).to_string()),
        (200, "not json".to_string()),
        (
            200,
            json!({ "enabled": true, "publicKey": PUBLIC, "kinds": [], "devices": [], "limits": { "devices": 25, "label": 60 } }).to_string(),
        ),
        (
            200,
            json!({ "enabled": true, "publicKey": PUBLIC, "kinds": [], "devices": [] }).to_string(),
        ),
    ]);
    let env = env_for(&endpoint);
    let body = json!({ "id": ID });
    let r = route_with(
        &env,
        &json_req("POST", "/x", body.clone()),
        "grammi",
        "test",
    );
    assert_eq!(
        (r.status, code(&r)),
        (502, "hosted-key-rejected".into()),
        "never a 401, which would sign her out"
    );
    let r = route_with(
        &env,
        &json_req("POST", "/x", body.clone()),
        "grammi",
        "test",
    );
    assert_eq!((r.status, code(&r)), (502, "storage-unavailable".into()));
    let r = route_with(
        &env,
        &json_req(
            "POST",
            "/x",
            json!({ "subscription": {}, "label": "x", "kinds": [] }),
        ),
        "grammi",
        "devices",
    );
    assert_eq!((r.status, code(&r)), (409, "too-many".into()));
    let r = route_with(&env, &json_req("POST", "/x", body), "grammi", "test");
    assert_eq!((r.status, code(&r)), (502, "bad-reply".into()));
    let r = route_with(&env, &req("GET", "/x"), "grammi", "status");
    assert_eq!(body_json(&r)["limits"], json!({ "devices": 25 }));
    let r = route_with(&env, &req("GET", "/x"), "grammi", "status");
    assert_eq!(
        body_json(&r)["limits"],
        json!({ "devices": 20 }),
        "an older function"
    );
    server.join().unwrap();

    // Admin's own refusals, before anything is sent.
    let (endpoint, _server) = hosted(vec![]);
    let env = env_for(&endpoint);
    let r = route_with(
        &env,
        &json_req("POST", "/x", json!({ "id": "nope" })),
        "grammi",
        "test",
    );
    assert_eq!((r.status, code(&r)), (400, "device-required".into()));
    let r = route_with(
        &env,
        &json_req("POST", "/x", json!({ "label": "x", "extra": 1 })),
        "grammi",
        "devices",
    );
    assert_eq!((r.status, code(&r)), (400, "unknown-field".into()));
    let r = route_with(
        &env,
        &json_req("POST", "/x", json!([1])),
        "grammi",
        "devices",
    );
    assert_eq!((r.status, code(&r)), (400, "invalid-request".into()));

    // Nothing listening: unreachable.
    let closed = {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        drop(listener);
        format!("http://{address}/api/push")
    };
    let r = route_with(&env_for(&closed), &req("GET", "/x"), "grammi", "status");
    assert_eq!((r.status, code(&r)), (502, "hosted-unavailable".into()));
}
