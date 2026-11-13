//! Admin routes for connected social accounts (ADR 0301): off and invisible unless configured,
//! the session, CSRF and body bounds of every Admin route, the actor and key sent to the hosted
//! function, and replies rebuilt from known fields so no token, key or foreign address gets through.

use super::*;
use crate::admin::social::route_with;
use std::io::{Read, Write};
use std::net::TcpListener;

const KEY: &str = "adm_social_admin_key_0000000000000000000000";
const ACCESS: &str = "AQX-access-token-value-0001";
const ID: &str = "11111111-1111-4111-8111-111111111111";

const ROUTES: &[(&str, &str, bool)] = &[
    ("GET", "/admin/api/social/status", false),
    ("GET", "/admin/api/social/accounts", false),
    ("GET", "/admin/api/social/connections", false),
    ("POST", "/admin/api/social/connections", true),
    (
        "POST",
        "/admin/api/social/connections/11111111-1111-4111-8111-111111111111/select",
        true,
    ),
    (
        "POST",
        "/admin/api/social/connections/11111111-1111-4111-8111-111111111111/cancel",
        true,
    ),
    (
        "POST",
        "/admin/api/social/accounts/11111111-1111-4111-8111-111111111111/reconnect",
        true,
    ),
    (
        "POST",
        "/admin/api/social/accounts/11111111-1111-4111-8111-111111111111/disconnect",
        true,
    ),
];

fn env_for(endpoint: &str) -> impl Fn(&str) -> Option<String> {
    let endpoint = endpoint.to_string();
    move |name| match name {
        "OPENBLOG_SOCIAL_ENDPOINT" => Some(endpoint.clone()),
        "OPENBLOG_SOCIAL_ADMIN_KEY" => Some(KEY.to_string()),
        _ => None,
    }
}

/// A fake hosted function: answers each connection with the next canned reply and hands back the
/// raw requests it saw. It panics its thread (never hangs a test) if it is not called.
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
    (format!("http://{address}/api/social"), handle)
}

fn account(extra: Json) -> Json {
    let mut value = json!({
        "id": ID, "provider": "linkedin", "kind": "member", "externalId": "urn:li:person:abc",
        "displayName": "Ada Lovelace", "status": "connected", "health": "ok", "connectedBy": "mikey",
        "createdAt": "2026-10-29T12:00:00Z", "updatedAt": "2026-10-29T12:00:00Z", "disconnectedAt": null,
        "credential": { "status": "active", "accessExpiresAt": "2026-12-01T00:00:00Z", "refreshExpiresAt": null, "scopes": ["openid", "w_member_social"], "lastRefreshedAt": null },
    });
    for (key, field) in extra.as_object().unwrap() {
        value[key] = field.clone();
    }
    value
}

#[test]
fn unconfigured_it_is_off_and_every_other_route_is_not_there() {
    let f = fixture("social-off");
    let session = login_ok(&f);
    let status = handle(
        &f.state,
        &authed(req("GET", "/admin/api/social/status"), &session, false),
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
    let f = fixture("social-auth");
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
        assert_eq!(allowed, 4096, "{method} {path} is bounded");
        if !writes {
            continue;
        }
        let no_token = authed(json_req(method, path, json!({})), &session, false);
        assert_eq!(
            handle(&f.state, &no_token).status,
            403,
            "{method} {path} no token"
        );
        let mut cross = authed(json_req(method, path, json!({})), &session, true);
        cross
            .headers
            .insert("origin".into(), "https://evil.example".into());
        assert_eq!(
            handle(&f.state, &cross).status,
            403,
            "{method} {path} cross-origin"
        );
    }
    // Configured, a write must still say it is JSON, and unknown shapes are not routes.
    let (endpoint, _server) = hosted(vec![]);
    let env = env_for(&endpoint);
    let plain = route_with(&env, &req("POST", "/x"), "mikey", "connections");
    assert_eq!(plain.status, 415);
    for name in [
        "accounts/not-an-id/disconnect",
        "connections/x/select",
        "nothing",
        "accounts/11111111-1111-4111-8111-111111111111/delete",
    ] {
        let r = route_with(&env, &json_req("POST", "/x", json!({})), "mikey", name);
        assert_eq!(r.status, 404, "{name}");
    }
    assert_eq!(
        route_with(
            &env,
            &json_req("DELETE", "/x", json!({})),
            "mikey",
            "accounts"
        )
        .status,
        404
    );
}

#[test]
fn a_bad_setting_is_reported_by_name_and_nothing_is_sent() {
    for (endpoint, key, problems) in [
        (
            "http://blog.example.com/api/social",
            KEY,
            vec!["OPENBLOG_SOCIAL_ENDPOINT"],
        ),
        (
            "https://user:pw@blog.example.com/api/social",
            KEY,
            vec!["OPENBLOG_SOCIAL_ENDPOINT"],
        ),
        (
            "https://blog.example.com/api/social?x=1",
            KEY,
            vec!["OPENBLOG_SOCIAL_ENDPOINT"],
        ),
        (
            "https://blog.example.com/api/social",
            "short",
            vec!["OPENBLOG_SOCIAL_ADMIN_KEY"],
        ),
        ("", KEY, vec!["OPENBLOG_SOCIAL_ENDPOINT"]),
    ] {
        let env = |name: &str| match name {
            "OPENBLOG_SOCIAL_ENDPOINT" => Some(endpoint.to_string()),
            "OPENBLOG_SOCIAL_ADMIN_KEY" => Some(key.to_string()),
            _ => None,
        };
        let status = route_with(&env, &req("GET", "/x"), "mikey", "status");
        let body = body_json(&status);
        assert_eq!(body["state"], "invalid", "{endpoint}");
        assert_eq!(body["problems"], json!(problems));
        assert!(!String::from_utf8_lossy(&status.body).contains(KEY));
        assert_eq!(
            route_with(&env, &req("GET", "/x"), "mikey", "accounts").status,
            404
        );
    }
}

#[test]
fn accounts_are_fetched_with_the_key_and_actor_and_rebuilt_from_known_fields() {
    let leaky = account(json!({
        "accessToken": ACCESS, "envelope": {"body": "x"}, "refreshToken": ACCESS,
        "credential": { "status": "active", "accessExpiresAt": null, "refreshExpiresAt": null, "scopes": ["w_member_social"], "lastRefreshedAt": null, "token": ACCESS },
    }));
    let junk = json!({ "id": "not-a-uuid", "provider": "linkedin" });
    let (endpoint, server) = hosted(vec![(
        200,
        json!({ "accounts": [leaky, junk] }).to_string(),
    )]);
    let r = route_with(&env_for(&endpoint), &req("GET", "/x"), "mikey", "accounts");
    assert_eq!(r.status, 200, "{}", String::from_utf8_lossy(&r.body));
    let body = String::from_utf8_lossy(&r.body).to_string();
    assert!(!body.contains(ACCESS) && !body.contains("envelope") && !body.contains("refreshToken"));
    let value = body_json(&r);
    assert_eq!(
        value["accounts"].as_array().unwrap().len(),
        1,
        "an unusable row is dropped"
    );
    assert_eq!(value["accounts"][0]["displayName"], "Ada Lovelace");
    assert_eq!(
        value["accounts"][0]["credential"]["scopes"],
        json!(["w_member_social"])
    );
    let seen = server.join().unwrap().remove(0).to_ascii_lowercase();
    assert!(seen.starts_with("get /api/social/accounts "), "{seen}");
    assert!(seen.contains(&format!(
        "authorization: bearer {}",
        KEY.to_ascii_lowercase()
    )));
    assert!(seen.contains("x-openblog-actor: mikey"));
}

#[test]
fn starting_a_connection_returns_only_a_provider_address_and_validates_what_it_sends() {
    let connection = json!({ "id": ID, "provider": "facebook", "status": "pending", "expiresAt": "2026-10-29T12:10:00Z", "requestedScopes": ["pages_show_list"], "grantedScopes": [], "createdBy": "mikey", "createdAt": "2026-10-29T12:00:00Z", "reauthAccountId": null, "errorCode": null, "message": null, "destinations": [], "notes": [] });
    let url = "https://www.facebook.com/v23.0/dialog/oauth?client_id=1&state=abc";
    let (endpoint, server) = hosted(vec![(
        201,
        json!({ "connection": connection, "authorizeUrl": url }).to_string(),
    )]);
    let env = env_for(&endpoint);
    let ok = route_with(
        &env,
        &json_req("POST", "/x", json!({ "provider": "facebook" })),
        "mikey",
        "connections",
    );
    assert_eq!(ok.status, 200);
    assert_eq!(body_json(&ok)["authorizeUrl"], url);
    let sent = server.join().unwrap().remove(0);
    assert!(sent.ends_with(r#"{"provider":"facebook"}"#), "{sent}");

    // Bad requests never reach the function (the fake would panic on an unexpected call).
    for body in [
        json!({}),
        json!({ "provider": "myspace" }),
        json!({ "provider": "facebook", "siteId": "x" }),
        json!({ "provider": "facebook", "redirect_uri": "https://evil.example" }),
    ] {
        let r = route_with(
            &env,
            &json_req("POST", "/x", body.clone()),
            "mikey",
            "connections",
        );
        assert_eq!(r.status, 400, "{body}");
    }
    let mut garbled = json_req("POST", "/x", json!({}));
    garbled.body = b"{not json".to_vec();
    assert_eq!(
        route_with(&env, &garbled, "mikey", "connections").status,
        400
    );

    // An address that is not a provider's own is never passed on.
    for bad in [
        "https://evil.example/oauth",
        "http://www.linkedin.com/oauth",
        "https://www.linkedin.com.evil.example/",
        "https://user:pw@www.linkedin.com/x",
        "javascript:alert(1)",
    ] {
        let (endpoint, server) = hosted(vec![(
            201,
            json!({ "connection": connection, "authorizeUrl": bad }).to_string(),
        )]);
        let r = route_with(
            &env_for(&endpoint),
            &json_req("POST", "/x", json!({ "provider": "linkedin" })),
            "mikey",
            "connections",
        );
        assert_eq!(r.status, 502, "{bad}");
        assert!(!String::from_utf8_lossy(&r.body).contains("evil"));
        server.join().unwrap();
    }
}

#[test]
fn choosing_a_destination_sends_only_the_choice_and_returns_only_the_account() {
    let (endpoint, server) = hosted(vec![(
        201,
        json!({ "account": account(json!({})), "credential": { "accessToken": ACCESS } })
            .to_string(),
    )]);
    let env = env_for(&endpoint);
    let path = format!("connections/{ID}/select");
    let r = route_with(
        &env,
        &json_req("POST", "/x", json!({ "destination": "urn:li:person:abc" })),
        "mikey",
        &path,
    );
    assert_eq!(r.status, 200);
    assert!(!String::from_utf8_lossy(&r.body).contains(ACCESS));
    assert_eq!(body_json(&r)["account"]["externalId"], "urn:li:person:abc");
    let sent = server.join().unwrap().remove(0);
    assert!(
        sent.starts_with(&format!("POST /api/social/{path} ")),
        "{sent}"
    );
    assert!(sent.ends_with(r#"{"destination":"urn:li:person:abc"}"#));
    for body in [
        json!({}),
        json!({ "destination": "" }),
        json!({ "destination": 4 }),
        json!({ "destination": "x", "accountId": ID }),
        json!({ "destination": "x".repeat(300) }),
    ] {
        assert_eq!(
            route_with(&env, &json_req("POST", "/x", body), "mikey", &path).status,
            400
        );
    }
}

#[test]
fn the_functions_refusals_are_passed_on_plainly_and_its_failures_are_not_trusted() {
    let cases: Vec<(u16, String, u16, &str)> = vec![
        (409, json!({ "error": "already-connected", "message": "That account is already connected." }).to_string(), 409, "already connected"),
        (429, json!({ "error": "too-many-attempts", "message": "Too many connection attempts are open." }).to_string(), 429, "Too many"),
        (401, json!({ "error": "unauthorized", "message": "Not authorized." }).to_string(), 502, "OPENBLOG_SOCIAL_ADMIN_KEY"),
        (500, json!({ "error": "internal", "message": format!("leaked {ACCESS}") }).to_string(), 502, ""),
        (200, "<html>not json</html>".to_string(), 502, ""),
        (200, json!({ "accounts": "nope" }).to_string(), 200, ""),
    ];
    for (status, body, expected, needle) in cases {
        let (endpoint, server) = hosted(vec![(status, body.clone())]);
        let r = route_with(
            &env_for(&endpoint),
            &json_req("POST", "/x", json!({})),
            "mikey",
            &format!("accounts/{ID}/disconnect"),
        );
        let text = String::from_utf8_lossy(&r.body).to_string();
        assert!(
            !text.contains("leaked"),
            "a 5xx message is not forwarded: {text}"
        );
        assert_eq!(
            r.status,
            if status == 200 { 502 } else { expected },
            "{status} {text}"
        );
        if !needle.is_empty() {
            assert!(
                text.to_lowercase().contains(&needle.to_lowercase()),
                "{text}"
            );
        }
        server.join().unwrap();
    }
    // A function that is not there is a plain failure, not a hang or a panic.
    let env = env_for("http://127.0.0.1:9/api/social");
    let r = route_with(&env, &req("GET", "/x"), "mikey", "accounts");
    assert_eq!(r.status, 502);
}

#[test]
fn a_function_that_says_social_is_not_enabled_is_reported_as_unavailable_not_as_an_error() {
    let (endpoint, server) = hosted(vec![(
        404,
        json!({ "error": "not-enabled", "message": "Social publishing is not enabled." })
            .to_string(),
    )]);
    let r = route_with(&env_for(&endpoint), &req("GET", "/x"), "mikey", "status");
    assert_eq!(r.status, 200);
    let body = body_json(&r);
    assert_eq!(body["enabled"], false);
    assert_eq!(body["state"], "unavailable");
    server.join().unwrap();
}

#[test]
fn the_status_shows_the_redirect_to_register_and_drops_unknown_fields() {
    let reply = json!({ "enabled": true, "problems": ["OPENBLOG_SOCIAL_FACEBOOK_API_VERSION"], "providers": [
        { "provider": "linkedin", "label": "LinkedIn", "redirectUri": "https://blog.example.com/api/social/callback/linkedin", "version": "202510", "scopes": ["openid", "profile", "w_member_social"], "requiredScopes": ["openid", "profile", "w_member_social"], "organizations": false, "pkce": false, "clientSecret": ACCESS },
        { "provider": "myspace", "label": "No", "redirectUri": "https://x", "version": "1", "scopes": [], "requiredScopes": [] },
    ] });
    let (endpoint, server) = hosted(vec![(200, reply.to_string())]);
    let r = route_with(&env_for(&endpoint), &req("GET", "/x"), "mikey", "status");
    let text = String::from_utf8_lossy(&r.body).to_string();
    assert!(!text.contains(ACCESS) && !text.contains(KEY) && !text.contains("myspace"));
    let body = body_json(&r);
    assert_eq!(body["enabled"], true);
    assert_eq!(body["providers"].as_array().unwrap().len(), 1);
    assert_eq!(
        body["providers"][0]["redirectUri"],
        "https://blog.example.com/api/social/callback/linkedin"
    );
    server.join().unwrap();
}

#[test]
fn a_disconnect_reports_how_many_announcements_it_canceled_and_nothing_more() {
    let reply = json!({ "account": account(json!({
        "status": "disconnected", "health": "disconnected", "disconnectedAt": "2026-10-29T12:00:00Z",
        "canceledAnnouncements": 3, "secret": "li_token"
    })) })
    .to_string();
    let (endpoint, server) = hosted(vec![(200, reply)]);
    let r = route_with(
        &env_for(&endpoint),
        &json_req("POST", "/x", json!({})),
        "mikey",
        &format!("accounts/{ID}/disconnect"),
    );
    server.join().unwrap();
    assert_eq!(r.status, 200);
    let body: Json = serde_json::from_slice(&r.body).unwrap();
    assert_eq!(body["account"]["canceledAnnouncements"], 3);
    assert!(!String::from_utf8_lossy(&r.body).contains("li_token"));

    // A count that is not a small whole number is not passed on.
    let reply =
        json!({ "account": account(json!({ "canceledAnnouncements": "3; drop" })) }).to_string();
    let (endpoint, server) = hosted(vec![(200, reply)]);
    let r = route_with(
        &env_for(&endpoint),
        &json_req("POST", "/x", json!({})),
        "mikey",
        &format!("accounts/{ID}/disconnect"),
    );
    server.join().unwrap();
    let body: Json = serde_json::from_slice(&r.body).unwrap();
    assert!(body["account"].get("canceledAnnouncements").is_none());
}

const DID: &str = "did:plc:abcdefghijklmnopqrstuvwx";
const APP_PASSWORD: &str = "abcd-efgh-ijkl-mnop";

fn bluesky_connection(status: &str, reauth: Option<&str>) -> Json {
    json!({ "id": ID, "provider": "bluesky", "status": status, "expiresAt": "2026-10-29T12:30:00Z", "requestedScopes": [], "grantedScopes": [], "createdBy": "mikey", "createdAt": "2026-10-29T12:00:00Z", "reauthAccountId": reauth, "errorCode": null, "message": null, "destinations": [{ "id": DID, "kind": "account", "name": "@ada.bsky.social", "eligible": true, "reason": null }], "notes": [] })
}

#[test]
fn bluesky_signs_in_with_a_handle_and_an_app_password_sent_once_and_never_answered() {
    let (endpoint, server) = hosted(vec![(
        201,
        json!({ "connection": bluesky_connection("authorized", None), "authorizeUrl": "https://evil.example/" , "accessJwt": ACCESS }).to_string(),
    )]);
    let env = env_for(&endpoint);
    let ok = route_with(
        &env,
        &json_req(
            "POST",
            "/x",
            json!({ "provider": "bluesky", "identifier": " ada.bsky.social ", "appPassword": "ABCD-EFGH-IJKL-MNOP" }),
        ),
        "mikey",
        "connections",
    );
    assert_eq!(ok.status, 200);
    let text = String::from_utf8_lossy(&ok.body).to_string();
    assert!(
        !text.contains(ACCESS)
            && !text.contains("evil")
            && !text.to_ascii_lowercase().contains(APP_PASSWORD)
    );
    let body = body_json(&ok);
    assert_eq!(body["connection"]["destinations"][0]["id"], DID);
    assert!(body.get("authorizeUrl").is_none());
    let sent = server.join().unwrap().remove(0);
    assert!(
        sent.ends_with(&format!(
            r#"{{"appPassword":"{APP_PASSWORD}","identifier":"ada.bsky.social","provider":"bluesky"}}"#
        )),
        "{sent}"
    );

    // Never reaches the function: an account password, no password, a sign-in for an OAuth provider.
    for body in [
        json!({ "provider": "bluesky", "identifier": "ada.bsky.social", "appPassword": "correct horse battery" }),
        json!({ "provider": "bluesky", "identifier": "ada.bsky.social" }),
        json!({ "provider": "bluesky", "appPassword": APP_PASSWORD }),
        json!({ "provider": "bluesky" }),
        json!({ "provider": "linkedin", "identifier": "ada.bsky.social", "appPassword": APP_PASSWORD }),
    ] {
        let r = route_with(
            &env,
            &json_req("POST", "/x", body.clone()),
            "mikey",
            "connections",
        );
        assert_eq!(r.status, 400, "{body}");
        assert!(!String::from_utf8_lossy(&r.body).contains("correct horse"));
    }
}

#[test]
fn a_bluesky_reconnect_forwards_the_sign_in_and_returns_the_finished_attempt() {
    let (endpoint, server) = hosted(vec![(
        201,
        json!({ "connection": bluesky_connection("completed", Some(ID)) }).to_string(),
    )]);
    let r = route_with(
        &env_for(&endpoint),
        &json_req(
            "POST",
            "/x",
            json!({ "identifier": "ada.bsky.social", "appPassword": APP_PASSWORD }),
        ),
        "mikey",
        &format!("accounts/{ID}/reconnect"),
    );
    assert_eq!(r.status, 200);
    assert_eq!(body_json(&r)["connection"]["status"], "completed");
    let sent = server.join().unwrap().remove(0);
    assert!(
        sent.contains(&format!("/accounts/{ID}/reconnect")),
        "{sent}"
    );
    assert!(sent.ends_with(&format!(
        r#"{{"appPassword":"{APP_PASSWORD}","identifier":"ada.bsky.social"}}"#
    )));
}

#[test]
fn the_status_marks_bluesky_as_an_app_password_provider_without_a_redirect() {
    let reply = json!({ "enabled": true, "problems": [], "providers": [
        { "provider": "bluesky", "label": "Bluesky", "login": "app-password", "redirectUri": null, "version": "atproto", "scopes": [], "requiredScopes": [], "organizations": false, "pkce": false },
        { "provider": "facebook", "label": "Facebook", "redirectUri": null, "version": "v23.0", "scopes": [], "requiredScopes": [] },
    ] });
    let (endpoint, server) = hosted(vec![(200, reply.to_string())]);
    let body = body_json(&route_with(
        &env_for(&endpoint),
        &req("GET", "/x"),
        "mikey",
        "status",
    ));
    let providers = body["providers"].as_array().unwrap();
    // An OAuth provider without its redirect is dropped; Bluesky needs none.
    assert_eq!(providers.len(), 1);
    assert_eq!(providers[0]["login"], "app-password");
    assert_eq!(providers[0]["redirectUri"], Json::Null);
    server.join().unwrap();
}

fn mastodon_status(instance: &str) -> String {
    json!({ "enabled": true, "problems": [], "providers": [
        { "provider": "mastodon", "label": "Mastodon", "login": "oauth", "redirectUri": "https://blog.example.com/api/social/callback/mastodon", "version": "v1", "scopes": ["read:accounts", "write:statuses"], "requiredScopes": ["read:accounts", "write:statuses"], "organizations": false, "pkce": true, "instance": instance, "visibility": "unlisted", "media": "none", "clientSecret": "never" },
    ] })
    .to_string()
}

#[test]
fn the_status_shows_the_mastodon_instance_and_what_it_posts_and_drops_a_bad_one() {
    let (endpoint, server) = hosted(vec![(200, mastodon_status("https://social.example.org"))]);
    let body = body_json(&route_with(
        &env_for(&endpoint),
        &req("GET", "/x"),
        "mikey",
        "status",
    ));
    let provider = &body["providers"][0];
    assert_eq!(provider["instance"], "https://social.example.org");
    assert_eq!(provider["visibility"], "unlisted");
    assert_eq!(provider["media"], "none");
    assert!(provider.get("clientSecret").is_none());
    server.join().unwrap();

    for bad in [
        "http://social.example.org",
        "https://social.example.org/@ada",
        "https://u:p@social.example.org",
        "https://localhost",
    ] {
        let (endpoint, server) = hosted(vec![(200, mastodon_status(bad))]);
        let body = body_json(&route_with(
            &env_for(&endpoint),
            &req("GET", "/x"),
            "mikey",
            "status",
        ));
        assert_eq!(body["providers"].as_array().unwrap().len(), 0, "{bad}");
        server.join().unwrap();
    }
}

#[test]
fn a_mastodon_sign_in_address_is_passed_on_only_at_the_instance_the_function_names() {
    let connection = json!({ "id": ID, "provider": "mastodon", "status": "pending", "expiresAt": "2026-10-29T12:10:00Z", "requestedScopes": ["read:accounts"], "grantedScopes": [], "createdBy": "mikey", "createdAt": "2026-10-29T12:00:00Z", "reauthAccountId": null, "errorCode": null, "message": null, "destinations": [], "notes": [] });
    let good = "https://social.example.org/oauth/authorize?client_id=1&state=abc";
    let (endpoint, server) = hosted(vec![
        (200, mastodon_status("https://social.example.org")),
        (
            201,
            json!({ "connection": connection, "authorizeUrl": good }).to_string(),
        ),
    ]);
    let ok = route_with(
        &env_for(&endpoint),
        &json_req("POST", "/x", json!({ "provider": "mastodon" })),
        "mikey",
        "connections",
    );
    assert_eq!(ok.status, 200);
    assert_eq!(body_json(&ok)["authorizeUrl"], good);
    let seen = server.join().unwrap();
    assert!(seen[0].starts_with("GET /api/social/status"), "{}", seen[0]);

    for bad in [
        "https://evil.example/oauth/authorize?state=abc",
        "https://social.example.org/auth/sign_in",
        "https://social.example.org:8443/oauth/authorize",
        "https://social.example.org.evil.example/oauth/authorize",
    ] {
        let (endpoint, server) = hosted(vec![
            (200, mastodon_status("https://social.example.org")),
            (
                201,
                json!({ "connection": connection, "authorizeUrl": bad }).to_string(),
            ),
        ]);
        let r = route_with(
            &env_for(&endpoint),
            &json_req("POST", "/x", json!({ "provider": "mastodon" })),
            "mikey",
            "connections",
        );
        assert_eq!(r.status, 502, "{bad}");
        server.join().unwrap();
    }
}

// ---- Studio R2: the way back to Studio (G6) and refusals with codes (G18) ----------------------

fn facebook_pending() -> Json {
    json!({ "id": ID, "provider": "facebook", "status": "pending", "expiresAt": "2026-10-29T12:10:00Z", "requestedScopes": ["pages_show_list"], "grantedScopes": [], "createdBy": "mikey", "createdAt": "2026-10-29T12:00:00Z", "reauthAccountId": null, "errorCode": null, "message": null, "destinations": [], "notes": [] })
}

fn status_reply(returns: bool) -> String {
    json!({ "enabled": true, "returns": returns, "problems": [], "providers": [
        { "provider": "facebook", "label": "Facebook", "login": "oauth", "redirectUri": "https://blog.example.com/api/social/callback/facebook", "version": "v23.0", "scopes": ["pages_show_list"], "requiredScopes": ["pages_show_list"], "organizations": false, "pkce": false },
    ] })
    .to_string()
}

fn started_reply() -> String {
    json!({ "connection": facebook_pending(), "authorizeUrl": "https://www.facebook.com/v23.0/dialog/oauth?state=abc" }).to_string()
}

fn from(origin: Option<&str>, host: &str, body: Json) -> Request {
    let mut r = json_req("POST", "/x", body);
    r.headers.insert("host".into(), host.into());
    if let Some(origin) = origin {
        r.headers.insert("origin".into(), origin.into());
    }
    r
}

#[test]
fn the_status_says_whether_the_function_sends_the_browser_back() {
    for (reply, expected) in [
        (status_reply(true), true),
        (status_reply(false), false),
        (
            json!({ "enabled": true, "returns": "yes", "providers": [] }).to_string(),
            false,
        ),
        (
            json!({ "enabled": true, "providers": [] }).to_string(),
            false,
        ),
    ] {
        let (endpoint, server) = hosted(vec![(200, reply)]);
        let body = body_json(&route_with(
            &env_for(&endpoint),
            &req("GET", "/x"),
            "mikey",
            "status",
        ));
        assert_eq!(body["returns"], expected);
        server.join().unwrap();
    }
}

#[test]
fn a_connect_names_its_own_studio_as_the_way_back_only_when_the_function_returns() {
    for (origin, host, expected) in [
        (
            "https://blog.example.com",
            "blog.example.com",
            "https://blog.example.com/admin/studio/",
        ),
        (
            "https://blog.example.com:8443",
            "blog.example.com:8443",
            "https://blog.example.com:8443/admin/studio/",
        ),
        (
            "http://127.0.0.1:4000",
            "127.0.0.1:4000",
            "http://127.0.0.1:4000/admin/studio/",
        ),
        (
            "http://localhost:4000",
            "localhost:4000",
            "http://localhost:4000/admin/studio/",
        ),
    ] {
        let (endpoint, server) = hosted(vec![(200, status_reply(true)), (201, started_reply())]);
        let r = route_with(
            &env_for(&endpoint),
            &from(Some(origin), host, json!({ "provider": "facebook" })),
            "mikey",
            "connections",
        );
        assert_eq!(r.status, 200, "{origin}");
        let seen = server.join().unwrap();
        assert!(
            seen[0].starts_with("GET /api/social/status "),
            "{}",
            seen[0]
        );
        assert!(
            seen[1].ends_with(&format!(
                r#"{{"provider":"facebook","returnTo":"{expected}"}}"#
            )),
            "{}",
            seen[1]
        );
    }
    // A function from before G6 (no `returns`) gets no address, and the connect still works.
    let (endpoint, server) = hosted(vec![(200, status_reply(false)), (201, started_reply())]);
    let r = route_with(
        &env_for(&endpoint),
        &from(
            Some("https://blog.example.com"),
            "blog.example.com",
            json!({ "provider": "facebook" }),
        ),
        "mikey",
        "connections",
    );
    assert_eq!(r.status, 200);
    let seen = server.join().unwrap();
    assert!(
        seen[1].ends_with(r#"{"provider":"facebook"}"#),
        "{}",
        seen[1]
    );
}

#[test]
fn a_start_and_a_reconnect_say_whether_a_way_back_was_recorded() {
    let start = || {
        from(
            Some("https://blog.example.com"),
            "blog.example.com",
            json!({ "provider": "facebook" }),
        )
    };
    // The function returns: the address was sent with the start, and the reply says so.
    let (endpoint, server) = hosted(vec![(200, status_reply(true)), (201, started_reply())]);
    let r = route_with(&env_for(&endpoint), &start(), "mikey", "connections");
    assert_eq!(r.status, 200);
    assert_eq!(body_json(&r)["returns"], true);
    server.join().unwrap();
    // The function doesn't, or its status couldn't be read this time: none was sent, and the reply
    // says false, so Studio takes the new-tab way whatever it read when the page loaded.
    for status in [
        (200, status_reply(false)),
        (500, json!({ "error": "internal" }).to_string()),
    ] {
        let (endpoint, server) = hosted(vec![status, (201, started_reply())]);
        let r = route_with(&env_for(&endpoint), &start(), "mikey", "connections");
        assert_eq!(r.status, 200, "{}", String::from_utf8_lossy(&r.body));
        assert_eq!(body_json(&r)["returns"], false);
        let seen = server.join().unwrap();
        assert!(!seen[1].contains("returnTo"), "{}", seen[1]);
    }
    // A plain-http origin names none either, and says so.
    let (endpoint, server) = hosted(vec![(201, started_reply())]);
    let r = route_with(
        &env_for(&endpoint),
        &from(
            Some("http://blog.example.com"),
            "blog.example.com",
            json!({ "provider": "facebook" }),
        ),
        "mikey",
        "connections",
    );
    assert_eq!(body_json(&r)["returns"], false);
    server.join().unwrap();
    // A reconnect says the same.
    let mut pending = facebook_pending();
    pending["reauthAccountId"] = json!(ID);
    let reconnecting = json!({ "connection": pending, "authorizeUrl": "https://www.facebook.com/v23.0/dialog/oauth?state=again" }).to_string();
    let path = format!("accounts/{ID}/reconnect");
    for (status, expected) in [(status_reply(true), true), (status_reply(false), false)] {
        let (endpoint, server) = hosted(vec![(200, status), (201, reconnecting.clone())]);
        let r = route_with(
            &env_for(&endpoint),
            &from(
                Some("https://blog.example.com"),
                "blog.example.com",
                json!({}),
            ),
            "mikey",
            &path,
        );
        assert_eq!(r.status, 200);
        assert_eq!(body_json(&r)["returns"], expected);
        server.join().unwrap();
    }
}

#[test]
fn no_way_back_is_named_from_a_foreign_malformed_or_plain_http_origin_and_none_from_the_browser() {
    // Each of these sends only the start (the fake would panic on a status call it was not given).
    for (origin, host) in [
        (None, "blog.example.com"),
        (Some("http://blog.example.com"), "blog.example.com"),
        (Some("https://evil.example"), "blog.example.com"),
        (
            Some("https://blog.example.com.evil.example"),
            "blog.example.com",
        ),
        (
            Some("https://blog.example.com/admin/studio/"),
            "blog.example.com",
        ),
        (Some("https://u:p@blog.example.com"), "blog.example.com"),
        (Some("HTTPS://BLOG.EXAMPLE.COM"), "BLOG.EXAMPLE.COM"),
        (Some("null"), "blog.example.com"),
        (Some("https://[2001:db8::1]"), "[2001:db8::1]"),
        (Some("javascript://blog.example.com"), "blog.example.com"),
    ] {
        let (endpoint, server) = hosted(vec![(201, started_reply())]);
        let r = route_with(
            &env_for(&endpoint),
            &from(origin, host, json!({ "provider": "facebook" })),
            "mikey",
            "connections",
        );
        assert_eq!(r.status, 200, "{origin:?}");
        let seen = server.join().unwrap();
        assert_eq!(seen.len(), 1, "{origin:?}");
        assert!(
            seen[0].ends_with(r#"{"provider":"facebook"}"#),
            "{origin:?}: {}",
            seen[0]
        );
    }
    // The browser cannot name one: the field is refused before anything is sent.
    let (endpoint, server) = hosted(vec![]);
    for body in [
        json!({ "provider": "facebook", "returnTo": "https://evil.example/admin/studio/" }),
        json!({ "returnTo": "https://evil.example/admin/studio/" }),
    ] {
        let path = if body.get("provider").is_some() {
            "connections".to_string()
        } else {
            format!("accounts/{ID}/reconnect")
        };
        let r = route_with(
            &env_for(&endpoint),
            &from(Some("https://blog.example.com"), "blog.example.com", body),
            "mikey",
            &path,
        );
        assert_eq!(r.status, 400, "{path}");
        assert_eq!(body_json(&r)["code"], "invalid-request");
    }
    drop(server);
}

#[test]
fn an_oauth_reconnect_names_the_way_back_and_a_bluesky_one_never_does() {
    let mut pending = facebook_pending();
    pending["reauthAccountId"] = json!(ID);
    let reconnecting = json!({ "connection": pending, "authorizeUrl": "https://www.facebook.com/v23.0/dialog/oauth?state=again" });
    let (endpoint, server) = hosted(vec![
        (200, status_reply(true)),
        (201, reconnecting.to_string()),
    ]);
    let path = format!("accounts/{ID}/reconnect");
    let r = route_with(
        &env_for(&endpoint),
        &from(
            Some("https://blog.example.com"),
            "blog.example.com",
            json!({}),
        ),
        "mikey",
        &path,
    );
    assert_eq!(r.status, 200, "{}", String::from_utf8_lossy(&r.body));
    let seen = server.join().unwrap();
    assert!(seen[1].ends_with(r#"{"returnTo":"https://blog.example.com/admin/studio/"}"#));

    let (endpoint, server) = hosted(vec![(
        201,
        json!({ "connection": bluesky_connection("completed", Some(ID)) }).to_string(),
    )]);
    let r = route_with(
        &env_for(&endpoint),
        &from(
            Some("https://blog.example.com"),
            "blog.example.com",
            json!({ "identifier": "ada.bsky.social", "appPassword": APP_PASSWORD }),
        ),
        "mikey",
        &path,
    );
    assert_eq!(r.status, 200);
    let seen = server.join().unwrap();
    assert_eq!(seen.len(), 1, "no status call for an app-password sign-in");
    assert!(!seen[0].contains("returnTo"));
}

#[test]
fn every_refusal_carries_a_code_studio_can_word() {
    // Admin's own refusals, before anything is sent.
    let (endpoint, server) = hosted(vec![]);
    let env = env_for(&endpoint);
    for (body, path, code) in [
        (json!({}), "connections", "missing-provider"),
        (
            json!({ "provider": "bluesky" }),
            "connections",
            "app-password-required",
        ),
        (
            json!({ "provider": "facebook", "identifier": "ada.bsky.social", "appPassword": APP_PASSWORD }),
            "connections",
            "oauth-required",
        ),
        (
            json!({ "provider": "bluesky", "identifier": "", "appPassword": APP_PASSWORD }),
            "connections",
            "invalid-identifier",
        ),
        (
            json!({ "provider": "bluesky", "identifier": "ada.bsky.social", "appPassword": "hunter2" }),
            "connections",
            "invalid-app-password",
        ),
        (
            json!({ "provider": "facebook", "x": 1 }),
            "connections",
            "invalid-request",
        ),
    ] {
        let r = route_with(&env, &json_req("POST", "/x", body.clone()), "mikey", path);
        assert_eq!(r.status, 400, "{body}");
        assert_eq!(body_json(&r)["code"], code, "{body}");
        assert!(!String::from_utf8_lossy(&r.body).contains("hunter2"));
    }
    drop(server);
    let off = |_: &str| None;
    let r = route_with(&off, &req("GET", "/x"), "mikey", "accounts");
    assert_eq!(
        (r.status, body_json(&r)["code"].clone()),
        (404, json!("not-set-up"))
    );

    // The function's answers: its code kept for 429 and 503, fixed codes for the rest.
    for (status, body, expected, code) in [
        (429, json!({ "error": "too-many-attempts", "message": "Too many connection attempts are open." }).to_string(), 429, "too-many-attempts"),
        (503, json!({ "error": "provider-unavailable", "message": format!("leaked {ACCESS}") }).to_string(), 503, "provider-unavailable"),
        (503, json!({ "message": "x" }).to_string(), 503, "hosted-unavailable"),
        (409, json!({ "error": "provider-not-configured", "message": "That provider is not set up on the server." }).to_string(), 409, "provider-not-configured"),
        (401, json!({ "error": "unauthorized" }).to_string(), 502, "hosted-key-rejected"),
        (500, json!({ "error": "internal" }).to_string(), 502, "hosted-unavailable"),
        (200, "<html>".to_string(), 502, "bad-reply"),
        (200, json!({ "nothing": true }).to_string(), 502, "bad-reply"),
    ] {
        let (endpoint, server) = hosted(vec![(status, body)]);
        let r = route_with(
            &env_for(&endpoint),
            &json_req("POST", "/x", json!({})),
            "mikey",
            &format!("connections/{ID}/cancel"),
        );
        server.join().unwrap();
        assert_eq!(r.status, expected, "{status} {code}");
        assert_eq!(body_json(&r)["code"], code, "{status}");
        assert!(!String::from_utf8_lossy(&r.body).contains("leaked"));
    }
    let r = route_with(
        &env_for("http://127.0.0.1:9/api/social"),
        &req("GET", "/x"),
        "mikey",
        "accounts",
    );
    assert_eq!(
        (r.status, body_json(&r)["code"].clone()),
        (502, json!("hosted-unavailable"))
    );
}
