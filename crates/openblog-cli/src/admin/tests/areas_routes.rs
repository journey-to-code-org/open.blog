//! Feature areas (Studio ONB1): the areas a site already uses (one fixture per area, and none), each
//! login's answers and hidden areas (pending for a new login, a v1 file read as v2, revisions,
//! unknown ids dropped, private to the login), suggestions that change `openblog.json` only on a
//! press and exactly as shown, and drawing prompts from the sets that suit a blog.

use super::*;

/// A site with nothing in any area: no pages, no collections, a post with no fences.
fn bare(tag: &str) -> Fixture {
    let dir = std::env::temp_dir().join(format!("ob-areas-{tag}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    scaffold::init(&dir, Some("Test Blog"), false).unwrap();
    let _ = fs::remove_dir_all(dir.join("content/pages"));
    let _ = fs::remove_dir_all(dir.join("content/series"));
    let _ = fs::remove_dir_all(dir.join("content/posts"));
    fs::create_dir_all(dir.join("content/posts")).unwrap();
    post(
        &dir,
        "plain",
        "title: Plain\ndate: 2026-11-01",
        "Just words.",
    );
    let mut users = Users::default();
    users.set("mikey", "correct horse battery").unwrap();
    users.set("grammi", "a long enough password").unwrap();
    users.save(&dir.join(".openblog/users.json")).unwrap();
    let state = Arc::new(AppState::new(dir.clone(), None, false, true));
    state.rebuild().unwrap();
    Fixture { state, dir }
}

fn post(dir: &Path, name: &str, front: &str, body: &str) {
    fs::write(
        dir.join(format!("content/posts/{name}.md")),
        format!("---\n{front}\n---\n\n{body}\n"),
    )
    .unwrap();
}

fn set_config(f: &Fixture, key: &str, value: Json) {
    let path = f.dir.join("openblog.json");
    let mut file: Json = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
    file[key] = value;
    fs::write(&path, serde_json::to_string_pretty(&file).unwrap()).unwrap();
}

fn get(f: &Fixture, s: &(String, String), path: &str) -> (u16, Json) {
    let r = handle(
        &f.state,
        &authed(req("GET", &format!("/admin/api/{path}")), s, false),
    );
    (r.status, body_json(&r))
}

fn send(f: &Fixture, s: &(String, String), method: &str, path: &str, body: Json) -> (u16, Json) {
    source_call(f, s, method, &format!("/admin/api/{path}"), body)
}

fn in_use(f: &Fixture, s: &(String, String)) -> Json {
    let (status, meta) = get(f, s, "meta");
    assert_eq!(status, 200, "{meta}");
    assert_eq!(meta["areas"]["inUse"], meta["areasInUse"]);
    meta["areasInUse"].clone()
}

#[test]
fn a_site_with_nothing_uses_no_area() {
    let f = bare("none");
    let mikey = login_ok(&f);
    assert_eq!(in_use(&f, &mikey), json!([]));
}

#[test]
fn each_area_is_in_use_when_the_site_has_it() {
    type Setup = fn(&Fixture);
    let cases: &[(&str, Setup)] = &[
        ("pages", |f| {
            fs::create_dir_all(f.dir.join("content/pages")).unwrap();
            fs::write(
                f.dir.join("content/pages/about.md"),
                "---\ntitle: About\n---\n\nHi.\n",
            )
            .unwrap();
        }),
        ("collections", |f| {
            fs::create_dir_all(f.dir.join("content/series")).unwrap();
            fs::write(
                f.dir.join("content/series/pies.md"),
                "---\ntitle: Pies\n---\n\nPies.\n",
            )
            .unwrap();
        }),
        ("recipes", |f| {
            post(
                &f.dir,
                "pie",
                "title: Pie\ndate: 2026-11-02\nprofile: recipe",
                "Bake it.",
            )
        }),
        ("trade", |f| {
            post(
                &f.dir,
                "roof",
                "title: Roof\ndate: 2026-11-02\nprofile: job",
                "Fixed it.",
            )
        }),
        ("seasonal", |f| {
            set_config(f, "seasons", json!({ "enabled": true }))
        }),
        ("sharing", |f| {
            set_config(
                f,
                "syndication",
                json!({ "targets": { "dev": { "provider": "dev" } } }),
            )
        }),
        ("readers", |f| {
            set_config(
                f,
                "engagement",
                json!({ "enabled": true, "endpoint": "https://comments.example.com" }),
            )
        }),
        ("research", |f| {
            set_config(f, "interpretations", json!({ "publish": true }))
        }),
        ("teaching", |f| {
            post(
                &f.dir,
                "lesson",
                "title: Lesson\ndate: 2026-11-02",
                "```quiz\nWhat?\n```",
            )
        }),
        ("code", |f| {
            post(
                &f.dir,
                "flow",
                "title: Flow\ndate: 2026-11-02",
                "```mermaid\ngraph TD; A-->B\n```",
            )
        }),
    ];
    for (area, setup) in cases {
        let f = bare(&format!("one-{area}"));
        let mikey = login_ok(&f);
        assert_eq!(in_use(&f, &mikey), json!([]), "{area}: without it");
        setup(&f);
        assert_eq!(in_use(&f, &mikey), json!([area]), "{area}: with it");
    }
}

#[test]
fn working_out_the_areas_stays_bounded_on_a_big_site() {
    let f = bare("big");
    for n in 0..2000 {
        post(
            &f.dir,
            &format!("post-{n:04}"),
            &format!("title: Post {n}\ndate: 2026-01-01"),
            "Words and more words.\n\n```rust\nfn x() {}\n```",
        );
    }
    let config = site::load_config(&f.dir).unwrap();
    let sources = site::read_sources(&f.dir, &config).unwrap();
    let started = std::time::Instant::now();
    let used = areas::in_use(&f.state, &config, &sources);
    let took = started.elapsed();
    assert!(used.is_empty(), "{used:?}");
    assert!(took < Duration::from_secs(10), "took {took:?}");
}

#[test]
fn a_new_login_is_pending_and_its_answers_are_its_own() {
    let f = bare("prefs");
    let mikey = login_ok(&f);
    let grammi = login_as(&f, "grammi", "a long enough password");
    let (status, got) = get(&f, &grammi, "areas");
    assert_eq!(status, 200);
    assert_eq!(got["preferences"]["onboarding"]["state"], "pending");
    assert_eq!(got["etag"], "");
    assert_eq!(got["hint"], Json::Null);
    let (_, meta) = get(&f, &grammi, "meta");
    assert_eq!(meta["areas"]["onboarding"]["state"], "pending");
    assert_eq!(meta["areas"]["etag"], "");

    let (status, saved) = send(
        &f,
        &grammi,
        "PUT",
        "areas",
        json!({
            "etag": "",
            "onboarding": { "state": "done" },
            "kind": "recipes",
            "answers": { "kind": "recipes", "seasons": "yes", "sharing": "later", "colour": "red" },
            "hidden": ["sharing", "research", "warp-drive"],
        }),
    );
    assert_eq!(status, 200, "{saved}");
    assert_eq!(
        saved["preferences"]["answers"],
        json!({ "kind": "recipes", "seasons": "yes", "sharing": "later" })
    );
    assert_eq!(
        saved["preferences"]["areas"]["hidden"],
        json!(["sharing", "research"])
    );
    let etag = saved["etag"].as_str().unwrap().to_string();
    assert!(!etag.is_empty());

    // Mikey's login is untouched.
    let (_, his) = get(&f, &mikey, "areas");
    assert_eq!(his["preferences"]["onboarding"]["state"], "pending");
    assert_eq!(his["preferences"]["areas"]["hidden"], json!([]));

    // An old revision is refused with the newer one.
    let (status, stale) = send(
        &f,
        &grammi,
        "PUT",
        "areas",
        json!({ "etag": "", "showEverything": true }),
    );
    assert_eq!(status, 409);
    assert_eq!(stale["code"], "stale");
    assert_eq!(stale["etag"], etag);
    assert_eq!(stale["preferences"]["kind"], "recipes");

    // Wrong types are refused; nothing changes.
    let (status, _) = send(
        &f,
        &grammi,
        "PUT",
        "areas",
        json!({ "etag": etag, "hidden": "seasonal" }),
    );
    assert_eq!(status, 400);
    let (status, _) = send(&f, &grammi, "PUT", "areas", json!({ "hidden": [] }));
    assert_eq!(status, 400, "no etag");
    let big = "x".repeat(areas::MAX_REQUEST_BYTES + 10);
    let (status, _) = send(
        &f,
        &grammi,
        "PUT",
        "areas",
        json!({ "etag": etag, "kind": big }),
    );
    assert_eq!(status, 413);

    // The file is private and never built.
    let path = crate::admin_preferences::preference_path(&f.dir, "grammi").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
    f.state.rebuild().unwrap();
    for file in crate::fsutil::walk(&f.dir.join("dist")) {
        let text = String::from_utf8_lossy(&fs::read(&file).unwrap()).to_string();
        assert!(
            !text.contains("showEverything") && !text.contains("storyMarks"),
            "{}",
            file.display()
        );
    }
}

#[test]
fn an_old_preferences_file_keeps_its_keys_through_a_save() {
    let f = bare("v1");
    let mikey = login_ok(&f);
    let path = crate::admin_preferences::preference_path(&f.dir, "mikey").unwrap();
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    let v1 = br#"{"schemaVersion":1,"preset":"custom","hiddenModules":["evidence"],"voiceInvitationDismissed":true}"#;
    fs::write(&path, v1).unwrap();
    let (_, got) = get(&f, &mikey, "areas");
    assert_eq!(got["preferences"]["onboarding"]["state"], "done");
    assert_eq!(got["preferences"]["areas"]["hidden"], json!(["research"]));
    assert_eq!(fs::read(&path).unwrap(), v1, "reading writes nothing");
    let (status, _) = send(
        &f,
        &mikey,
        "PUT",
        "areas",
        json!({ "etag": got["etag"], "hidden": ["seasonal"] }),
    );
    assert_eq!(status, 200);
    let file: Json = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    assert_eq!(file["schemaVersion"], 2);
    assert_eq!(file["voiceInvitationDismissed"], true);
    assert_eq!(file["preset"], "custom");
    let (_, status) = get(&f, &mikey, "voice/status");
    assert_eq!(
        status["invitationDismissed"], true,
        "R9 still reads the old answer"
    );
}

#[test]
fn init_s_kind_is_the_hint() {
    let f = bare("hint");
    let mikey = login_ok(&f);
    scaffold::write_kind_hint(&f.dir, "technical").unwrap();
    let (_, got) = get(&f, &mikey, "areas");
    assert_eq!(got["hint"], "technical");
    let (_, meta) = get(&f, &mikey, "meta");
    assert_eq!(meta["areas"]["hint"], "technical");
    fs::write(f.dir.join(areas::HINT_FILE), r#"{"kind":"astrology"}"#).unwrap();
    let (_, got) = get(&f, &mikey, "areas");
    assert_eq!(got["hint"], Json::Null, "an unknown kind is no hint");
}

#[test]
fn declining_every_suggestion_leaves_the_file_byte_for_byte() {
    let f = bare("decline");
    let mikey = login_ok(&f);
    let before = fs::read(f.dir.join("openblog.json")).unwrap();
    for kind in [
        "technical",
        "recipes",
        "trade",
        "teaching",
        "research",
        "podcast",
        "docs",
        "personal",
    ] {
        let (status, got) = send(
            &f,
            &mikey,
            "POST",
            "areas/suggestions",
            json!({ "kind": kind, "answers": { "seasons": "yes", "readers": "yes", "sharing": "yes" } }),
        );
        assert_eq!(status, 200, "{kind}: {got}");
        assert!(got["suggestions"].is_array());
    }
    assert_eq!(fs::read(f.dir.join("openblog.json")).unwrap(), before);
}

#[test]
fn an_applied_suggestion_is_exactly_the_change_shown() {
    let f = bare("apply");
    let mikey = login_ok(&f);
    let path = f.dir.join("openblog.json");
    let before = fs::read_to_string(&path).unwrap();
    let (status, got) = send(
        &f,
        &mikey,
        "POST",
        "areas/suggestions",
        json!({ "kind": "docs" }),
    );
    assert_eq!(status, 200);
    let shown = got["suggestions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["id"] == "docs-section")
        .cloned()
        .expect("a documentation blog is offered the section");
    assert_eq!(shown["type"], "change");
    assert_eq!(shown["member"], "docs");
    assert!(shown["lines"]
        .as_array()
        .unwrap()
        .iter()
        .any(|l| l["op"] == "+" && l["text"].as_str().unwrap().contains("\"enabled\": true")));

    // A file changed since it was shown is refused, and left alone.
    let (status, stale) = send(
        &f,
        &mikey,
        "POST",
        "areas/suggestions/apply",
        json!({ "id": "docs-section", "etag": "0000" }),
    );
    assert_eq!(status, 409);
    assert_eq!(stale["code"], "stale");
    assert_eq!(fs::read_to_string(&path).unwrap(), before);

    let (status, applied) = send(
        &f,
        &mikey,
        "POST",
        "areas/suggestions/apply",
        json!({ "id": "docs-section", "etag": got["etag"] }),
    );
    assert_eq!(status, 200, "{applied}");
    assert_eq!(applied["lines"], shown["lines"], "exactly the change shown");
    let after = fs::read_to_string(&path).unwrap();
    // Every line but the changed ones is where it was.
    let removed: Vec<&str> = shown["lines"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|l| l["op"] == "-")
        .map(|l| l["text"].as_str().unwrap())
        .collect();
    for line in before.lines().filter(|l| !removed.contains(l)) {
        assert!(after.contains(line), "kept: {line}");
    }
    assert!(site::load_config(&f.dir).unwrap().docs.enabled);

    // Done once; not offered again, and applying it again says so.
    let (_, again) = send(
        &f,
        &mikey,
        "POST",
        "areas/suggestions",
        json!({ "kind": "docs" }),
    );
    assert!(again["suggestions"]
        .as_array()
        .unwrap()
        .iter()
        .all(|s| s["id"] != "docs-section"));
    let (status, twice) = send(
        &f,
        &mikey,
        "POST",
        "areas/suggestions/apply",
        json!({ "id": "docs-section", "etag": applied["etag"] }),
    );
    assert_eq!(status, 409);
    assert_eq!(twice["code"], "already");
    let (status, unknown) = send(
        &f,
        &mikey,
        "POST",
        "areas/suggestions/apply",
        json!({ "id": "turn-everything-off", "etag": applied["etag"] }),
    );
    assert_eq!(status, 404);
    assert_eq!(unknown["code"], "unknown");
}

#[test]
fn suggestions_that_need_her_details_open_a_screen() {
    let f = bare("open");
    let mikey = login_ok(&f);
    let (_, got) = send(
        &f,
        &mikey,
        "POST",
        "areas/suggestions",
        json!({ "kind": "trade", "answers": { "seasons": "yes", "readers": "yes" } }),
    );
    let ids: Vec<(&str, &str)> = got["suggestions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| (s["id"].as_str().unwrap(), s["href"].as_str().unwrap_or("")))
        .collect();
    assert!(ids.contains(&("business", "#/business")), "{ids:?}");
    assert!(ids.contains(&("seasons", "#/decorations")), "{ids:?}");
    assert!(ids.contains(&("readers", "#/readers")), "{ids:?}");
    let (_, none) = send(
        &f,
        &mikey,
        "POST",
        "areas/suggestions",
        json!({ "kind": "technical", "answers": { "seasons": "no" } }),
    );
    assert_eq!(none["suggestions"], json!([]));
}

#[test]
fn drawing_for_a_kind_uses_its_sets_and_always_a_story() {
    let f = bare("draw");
    let mikey = login_ok(&f);
    for _ in 0..12 {
        let (status, drawn) = send(
            &f,
            &mikey,
            "POST",
            "voice/draw",
            json!({ "packs": ["teaching", "expertise", "opinions", "craft"], "story": true }),
        );
        assert_eq!(status, 200, "{drawn}");
        let packs: Vec<&str> = drawn["prompts"]
            .as_array()
            .unwrap()
            .iter()
            .map(|p| p["pack"].as_str().unwrap())
            .collect();
        assert_eq!(packs.len(), 3);
        assert!(packs.contains(&"stories"), "{packs:?}");
        assert!(
            packs
                .iter()
                .all(|p| ["teaching", "expertise", "opinions", "craft", "stories"].contains(p)),
            "{packs:?}"
        );
    }
    let (status, drawn) = send(
        &f,
        &mikey,
        "POST",
        "voice/draw",
        json!({ "packs": ["stories", "people"], "story": true }),
    );
    assert_eq!(status, 200);
    assert!(drawn["prompts"]
        .as_array()
        .unwrap()
        .iter()
        .all(|p| ["stories", "people"].contains(&p["pack"].as_str().unwrap())));
    let (status, gone) = send(
        &f,
        &mikey,
        "POST",
        "voice/draw",
        json!({ "packs": ["no-such-set"] }),
    );
    assert_eq!(status, 404);
    assert_eq!(gone["code"], "pack-gone");
    let (status, _) = send(
        &f,
        &mikey,
        "POST",
        "voice/draw",
        json!({ "packs": "stories" }),
    );
    assert_eq!(status, 400);
}
