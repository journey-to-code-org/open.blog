//! Admin seasonal reminder routes (ADR 0354 to 0356, #525, #526): deny by default, CSRF, off until
//! turned on, a reminder opens one unpublished draft and nothing else, snooze and disable per topic,
//! stale writes, and no code path from a reminder to a publish.

use super::*;

const PATH: &str = "/admin/api/seasonal";

/// A topic whose window is the whole year, so a reminder is due whatever day the test runs.
const ALL_YEAR: &str = r#"{"id":"all-year","start":"01-01","end":"12-31","topic":"Winter pipes","prompt":"What should a homeowner do before the first freeze?"}"#;

fn config_path(f: &Fixture) -> PathBuf {
    f.dir.join(site::CONFIG_FILE)
}

fn call(f: &Fixture, session: &(String, String), method: &str, path: &str, body: Json) -> Response {
    handle(
        &f.state,
        &authed(json_req(method, path, body), session, true),
    )
}

fn get(f: &Fixture, session: &(String, String)) -> Json {
    let response = handle(&f.state, &authed(req("GET", PATH), session, false));
    assert_eq!(
        response.status,
        200,
        "{}",
        String::from_utf8_lossy(&response.body)
    );
    body_json(&response)
}

fn turn_on(f: &Fixture, session: &(String, String)) -> Json {
    let etag = get(f, session)["etag"].clone();
    let topics: Json = serde_json::from_str(&format!("[{ALL_YEAR}]")).unwrap();
    let response = call(
        f,
        session,
        "PUT",
        PATH,
        json!({"etag": etag, "seasonalPrompts": {"enabled": true, "topics": topics}}),
    );
    assert_eq!(
        response.status,
        200,
        "{}",
        String::from_utf8_lossy(&response.body)
    );
    body_json(&response)
}

fn reminder_key(described: &Json) -> String {
    described["reminders"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["id"] == "all-year")
        .expect("the all-year reminder is listed")["key"]
        .as_str()
        .unwrap()
        .to_string()
}

#[test]
fn the_seasonal_routes_deny_by_default_and_require_csrf() {
    let f = fixture("seasonal-auth");
    for (method, path) in [
        ("GET", PATH),
        ("PUT", PATH),
        ("POST", "/admin/api/seasonal/snooze"),
        ("POST", "/admin/api/seasonal/open"),
    ] {
        let response = if method == "GET" {
            handle(&f.state, &req(method, path))
        } else {
            handle(&f.state, &json_req(method, path, json!({})))
        };
        assert_eq!(response.status, 401, "{method} {path}");
    }
    let session = login_ok(&f);
    let no_csrf = handle(
        &f.state,
        &authed(
            json_req(
                "POST",
                "/admin/api/seasonal/open",
                json!({"key": "a@2026-01-01"}),
            ),
            &session,
            false,
        ),
    );
    assert_eq!(no_csrf.status, 403);
    assert_eq!(
        handle(&f.state, &authed(req("DELETE", PATH), &session, true)).status,
        404
    );
}

#[test]
fn reminders_are_off_until_turned_on_and_an_off_site_is_untouched() {
    let f = fixture("seasonal-off");
    let session = login_ok(&f);
    let before = fs::read_to_string(config_path(&f)).unwrap();
    let described = get(&f, &session);
    assert_eq!(described["enabled"], false);
    assert_eq!(described["reminders"], json!([]));
    // The bundled topics are shown so the owner can see what turning them on would do.
    assert!(!described["topics"].as_array().unwrap().is_empty());
    let open = call(
        &f,
        &session,
        "POST",
        "/admin/api/seasonal/open",
        json!({"key": "winter-slow@2026-12-01"}),
    );
    assert_eq!(open.status, 409);
    assert_eq!(fs::read_to_string(config_path(&f)).unwrap(), before);
    assert!(!f.dir.join(".openblog/private/seasonal.json").exists());
}

#[test]
fn opening_a_reminder_makes_one_unpublished_draft_and_publishes_nothing() {
    let f = fixture("seasonal-open");
    let session = login_ok(&f);
    let described = turn_on(&f, &session);
    assert_eq!(described["enabled"], true);
    let key = reminder_key(&described);
    let status = described["reminders"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["key"] == key.as_str())
        .unwrap()["status"]
        .clone();
    assert_eq!(status, "due");

    let before: Vec<_> = openblog_cli_posts(&f);
    let open = call(
        &f,
        &session,
        "POST",
        "/admin/api/seasonal/open",
        json!({"key": key}),
    );
    assert_eq!(open.status, 200, "{}", String::from_utf8_lossy(&open.body));
    let opened = body_json(&open);
    assert_eq!(opened["created"], true);
    assert_eq!(opened["draft"], true);
    let path = opened["path"].as_str().unwrap().to_string();
    let text = fs::read_to_string(f.dir.join(&path)).unwrap();
    assert!(
        text.contains("draft: \"true\"") || text.contains("draft: true"),
        "{text}"
    );
    assert!(text.contains("title: Winter pipes"), "{text}");
    assert!(text.contains("What should a homeowner do before the first freeze?"));

    // A second tap finds the same draft and writes nothing.
    let again = call(
        &f,
        &session,
        "POST",
        "/admin/api/seasonal/open",
        json!({"key": key}),
    );
    let again = body_json(&again);
    assert_eq!(again["created"], false);
    assert_eq!(again["path"], path.as_str());
    assert_eq!(openblog_cli_posts(&f).len(), before.len() + 1);

    // The list now says so, and the draft reaches no public output.
    let listed = get(&f, &session);
    let item = listed["reminders"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["key"] == key.as_str())
        .unwrap();
    assert_eq!(item["status"], "opened");
    assert_eq!(item["draft"], path.as_str());
    f.state.rebuild().unwrap();
    for file in ["dist/index.html", "dist/rss.xml", "dist/sitemap.xml"] {
        let public = fs::read_to_string(f.dir.join(file)).unwrap_or_default();
        assert!(!public.contains("Winter pipes"), "{file} leaked the draft");
        assert!(!public.contains("first freeze"), "{file} leaked the prompt");
    }
    assert!(!f.dir.join("dist/posts/winter-pipes").exists());
    // The record is private and holds a path and a key, never prose.
    let record = fs::read_to_string(f.dir.join(".openblog/private/seasonal.json")).unwrap();
    assert!(record.contains(&key) && !record.contains("first freeze"));
}

fn openblog_cli_posts(f: &Fixture) -> Vec<PathBuf> {
    fs::read_dir(f.dir.join("content/posts"))
        .map(|entries| {
            entries
                .filter_map(|entry| entry.ok().map(|e| e.path()))
                .collect()
        })
        .unwrap_or_default()
}

#[test]
fn a_snooze_hides_a_reminder_and_is_bounded_and_checked() {
    let f = fixture("seasonal-snooze");
    let session = login_ok(&f);
    let key = reminder_key(&turn_on(&f, &session));
    let snooze = |body: Json| call(&f, &session, "POST", "/admin/api/seasonal/snooze", body);

    assert_eq!(snooze(json!({"key": key, "days": 0})).status, 422);
    assert_eq!(snooze(json!({"key": key, "days": 91})).status, 422);
    assert_eq!(snooze(json!({"key": "../x@2026-01-01"})).status, 422);
    assert_eq!(
        snooze(json!({"key": "nothing-here@2026-01-01"})).status,
        404
    );

    let done = snooze(json!({"key": key, "days": 14}));
    assert_eq!(done.status, 200, "{}", String::from_utf8_lossy(&done.body));
    let until = body_json(&done)["snoozedUntil"]
        .as_str()
        .unwrap()
        .to_string();
    let listed = get(&f, &session);
    let item = listed["reminders"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["key"] == key.as_str())
        .unwrap();
    assert_eq!(item["status"], "snoozed");
    assert_eq!(item["snoozedUntil"], until.as_str());
    // Nothing was written to content.
    assert!(openblog_cli_posts(&f)
        .iter()
        .all(|p| !p.to_string_lossy().contains("winter-pipes")));

    // Opening a snoozed reminder is the owner's choice and clears the snooze.
    let open = call(
        &f,
        &session,
        "POST",
        "/admin/api/seasonal/open",
        json!({"key": key}),
    );
    assert_eq!(open.status, 200);
    let after = snooze(json!({"key": key}));
    assert_eq!(after.status, 409, "an opened reminder cannot be snoozed");
}

#[test]
fn a_topic_is_disabled_or_moved_by_a_save_and_stale_or_invalid_saves_change_nothing() {
    let f = fixture("seasonal-save");
    let session = login_ok(&f);
    let described = turn_on(&f, &session);
    let etag = described["etag"].clone();

    let moved = call(
        &f,
        &session,
        "PUT",
        PATH,
        json!({"etag": etag, "seasonalPrompts": {"enabled": true, "topics": [
            serde_json::from_str::<Json>(ALL_YEAR).unwrap(),
            {"id": "spring-prep", "start": "02-01", "end": "02-28"},
            {"id": "summer-heat", "disabled": true}
        ]}}),
    );
    assert_eq!(
        moved.status,
        200,
        "{}",
        String::from_utf8_lossy(&moved.body)
    );
    let saved = body_json(&moved);
    let topics = saved["topics"].as_array().unwrap();
    let spring = topics.iter().find(|t| t["id"] == "spring-prep").unwrap();
    assert_eq!(
        (spring["start"].as_str(), spring["end"].as_str()),
        (Some("02-01"), Some("02-28"))
    );
    assert_eq!(
        topics.iter().find(|t| t["id"] == "summer-heat").unwrap()["disabled"],
        true
    );
    let text = fs::read_to_string(config_path(&f)).unwrap();
    assert!(text.contains("seasonalPrompts"));
    let kept = text.clone();

    // The old revision is now stale.
    let stale = call(
        &f,
        &session,
        "PUT",
        PATH,
        json!({"etag": etag, "seasonalPrompts": {"enabled": false}}),
    );
    assert_eq!(stale.status, 409);
    assert_eq!(fs::read_to_string(config_path(&f)).unwrap(), kept);

    // Mistakes are said in words and write nothing.
    let etag = saved["etag"].clone();
    for (body, needle) in [
        (
            json!({"enabled": true, "topics": [{"id": "mine"}]}),
            "needs a start",
        ),
        (
            json!({"enabled": true, "topics": [{"id": "spring-prep", "start": "13-40"}]}),
            "month and day",
        ),
        (json!({"enabled": "yes"}), "true or false"),
    ] {
        let response = call(
            &f,
            &session,
            "PUT",
            PATH,
            json!({"etag": etag, "seasonalPrompts": body}),
        );
        assert_eq!(response.status, 422);
        assert!(
            String::from_utf8_lossy(&response.body).contains(needle),
            "{needle}"
        );
        assert_eq!(fs::read_to_string(config_path(&f)).unwrap(), kept);
    }

    // Turning everything off removes the member entirely.
    let off = call(
        &f,
        &session,
        "PUT",
        PATH,
        json!({"etag": etag, "seasonalPrompts": {}}),
    );
    assert_eq!(off.status, 200);
    assert!(!fs::read_to_string(config_path(&f))
        .unwrap()
        .contains("seasonalPrompts"));
}

#[test]
fn no_reminder_code_can_publish_syndicate_announce_or_send() {
    // The reminder code is read as text: apart from comments and tests it never names a way to
    // publish, so a reminder can only ever write one draft (ADR 0355).
    let sources = [
        include_str!("../../../../openblog-core/src/seasonal.rs"),
        include_str!("../../seasonal_store.rs"),
        include_str!("../seasonal.rs"),
    ];
    for source in sources {
        let code = source.split("#[cfg(test)]").next().unwrap();
        for line in code
            .lines()
            .filter(|line| !line.trim_start().starts_with("//"))
        {
            let lower = line.to_ascii_lowercase();
            for banned in [
                "publish", "syndicat", "announce", "social", "rebuild", "send(", "http",
            ] {
                assert!(
                    !lower.contains(banned),
                    "`{banned}` in reminder code: {line}"
                );
            }
        }
    }
}

#[test]
fn a_simple_workspace_is_told_reminders_are_in_use_once_they_are_on() {
    let f = fixture("seasonal-site-uses");
    let session = login_ok(&f);
    let uses = |f: &Fixture| {
        let meta = handle(
            &f.state,
            &authed(req("GET", "/admin/api/meta"), &session, false),
        );
        body_json(&meta)["siteUses"]["reminders"].clone()
    };
    assert_eq!(uses(&f), json!(false));
    turn_on(&f, &session);
    assert_eq!(uses(&f), json!(true));
}
