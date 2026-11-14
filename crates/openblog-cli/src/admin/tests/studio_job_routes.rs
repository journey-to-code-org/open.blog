//! Studio R4, jobs from the site: what the server already has of a capture (G29), the voice note
//! for the post it became (G30), codes on capture errors (G31), the job check the build makes (G32),
//! `meta.job` (G33), the app icon's New job (G34) and the worker's list of Studio's own files (G35).

use super::*;

const ID: &str = "abcdef0123456789abcdef0123456789";

fn png() -> Vec<u8> {
    [
        &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A][..],
        &[0u8; 32],
    ]
    .concat()
}

fn webm() -> Vec<u8> {
    [&[0x1A, 0x45, 0xDF, 0xA3][..], &[0u8; 64]].concat()
}

fn send(f: &Fixture, session: &(String, String), path: &str, bytes: Vec<u8>) -> Response {
    let mut r = authed(req("POST", path), session, true);
    r.body = bytes;
    handle(&f.state, &r)
}

fn get(f: &Fixture, session: &(String, String), path: &str) -> Response {
    handle(&f.state, &authed(req("GET", path), session, false))
}

fn post(f: &Fixture, session: &(String, String), path: &str, body: Json) -> Response {
    handle(
        &f.state,
        &authed(json_req("POST", path, body), session, true),
    )
}

fn ctype(r: &Response) -> String {
    r.headers
        .iter()
        .find(|(name, _)| name.eq_ignore_ascii_case("content-type"))
        .map(|(_, value)| value.clone())
        .unwrap_or_default()
}

fn code(response: &Response) -> String {
    body_json(response)["code"]
        .as_str()
        .unwrap_or("")
        .to_string()
}

fn save_capture(f: &Fixture, session: &(String, String), id: &str) -> Response {
    post(
        f,
        session,
        "/admin/api/document",
        json!({
            "kind": "posts",
            "captureId": id,
            "fields": { "title": "Roof repair in Elkins", "slug": format!("roof-repair-in-elkins-{}", &id[..6]), "draft": "true", "profile": "job" },
            "body": "## Problem\n\nLeak\n"
        }),
    )
}

#[test]
fn what_the_server_has_of_a_capture_is_photos_by_slot_the_note_and_the_draft() {
    let f = fixture("r4-capture-status");
    let session = login_ok(&f);
    let empty = get(&f, &session, &format!("/admin/api/capture?id={ID}"));
    assert_eq!(empty.status, 200);
    assert_eq!(
        body_json(&empty),
        json!({ "photos": [], "audio": false, "draft": null })
    );

    for slot in [0, 2] {
        let sent = send(
            &f,
            &session,
            &format!("/admin/api/upload?name=a.png&capture={ID}&slot={slot}"),
            png(),
        );
        assert_eq!(sent.status, 201, "{}", String::from_utf8_lossy(&sent.body));
    }
    assert_eq!(
        send(
            &f,
            &session,
            &format!("/admin/api/capture-audio?capture={ID}"),
            webm()
        )
        .status,
        201
    );
    let part = body_json(&get(&f, &session, &format!("/admin/api/capture?id={ID}")));
    assert_eq!(
        part["photos"],
        json!([
            { "slot": 0, "url": "/images/uploads/captures/capture-abcdef012345-0.png" },
            { "slot": 2, "url": "/images/uploads/captures/capture-abcdef012345-2.png" }
        ])
    );
    assert_eq!(part["audio"], true);
    assert_eq!(part["draft"], Json::Null);

    let saved = save_capture(&f, &session, ID);
    assert_eq!(
        saved.status,
        201,
        "{}",
        String::from_utf8_lossy(&saved.body)
    );
    let path = body_json(&saved)["path"].as_str().unwrap().to_string();
    let done = body_json(&get(&f, &session, &format!("/admin/api/capture?id={ID}")));
    assert_eq!(done["draft"], json!({ "path": path, "status": "draft" }));

    fs::remove_file(f.dir.join("content").join(&path)).unwrap();
    let gone = body_json(&get(&f, &session, &format!("/admin/api/capture?id={ID}")));
    assert_eq!(gone["draft"]["status"], "removed");

    let bad = get(&f, &session, "/admin/api/capture?id=../../etc");
    assert_eq!(bad.status, 400);
    assert_eq!(code(&bad), "capture-id");
    assert_eq!(
        handle(
            &f.state,
            &req("GET", &format!("/admin/api/capture?id={ID}"))
        )
        .status,
        401,
        "only for someone signed in"
    );
}

#[test]
fn the_voice_note_of_a_job_plays_in_write_and_only_for_someone_signed_in() {
    let f = fixture("r4-capture-audio");
    let session = login_ok(&f);
    let missing = get(
        &f,
        &session,
        &format!("/admin/api/capture-audio?capture={ID}"),
    );
    assert_eq!(missing.status, 404);
    assert_eq!(code(&missing), "no-note");
    assert_eq!(
        send(
            &f,
            &session,
            &format!("/admin/api/capture-audio?capture={ID}"),
            webm()
        )
        .status,
        201
    );
    let note = get(
        &f,
        &session,
        &format!("/admin/api/capture-audio?capture={ID}"),
    );
    assert_eq!(note.status, 200);
    assert_eq!(ctype(&note), "audio/webm");
    assert_eq!(note.body, webm());
    assert!(note
        .headers
        .iter()
        .any(|(name, value)| name == "Cache-Control" && value == "no-store"));
    assert_eq!(
        handle(
            &f.state,
            &req("GET", &format!("/admin/api/capture-audio?capture={ID}"))
        )
        .status,
        401
    );
    let bad = get(&f, &session, "/admin/api/capture-audio?capture=nope");
    assert_eq!((bad.status, code(&bad).as_str()), (400, "capture-id"));
}

#[test]
fn a_job_made_on_a_phone_names_its_capture_when_opened() {
    let f = fixture("r4-document-capture");
    let session = login_ok(&f);
    // Another capture's ledger first, so the lookup can't just take the only one.
    let other = "0000000000000000000000000000ffff";
    assert_eq!(save_capture(&f, &session, other).status, 201);
    send(
        &f,
        &session,
        &format!("/admin/api/capture-audio?capture={ID}"),
        webm(),
    );
    let saved = save_capture(&f, &session, ID);
    let path = body_json(&saved)["path"].as_str().unwrap().to_string();
    let opened = body_json(&get(
        &f,
        &session,
        &format!("/admin/api/document?path={path}"),
    ));
    assert_eq!(
        opened["capture"],
        json!({ "id": ID, "audio": true, "transcript": false })
    );
    fs::write(
        f.dir
            .join(".openblog/captures")
            .join(openblog_core::capture::transcript_file_name(ID).unwrap()),
        "Leak by the chimney",
    )
    .unwrap();
    let again = body_json(&get(
        &f,
        &session,
        &format!("/admin/api/document?path={path}"),
    ));
    assert_eq!(again["capture"]["transcript"], true);

    // A post not made from a capture has none.
    let plain = post(
        &f,
        &session,
        "/admin/api/document",
        json!({ "kind": "posts", "fields": { "title": "Desk job", "draft": "true", "profile": "job" }, "body": "" }),
    );
    let plain_path = body_json(&plain)["path"].as_str().unwrap().to_string();
    let opened = body_json(&get(
        &f,
        &session,
        &format!("/admin/api/document?path={plain_path}"),
    ));
    assert!(opened.get("capture").is_none(), "{opened}");
}

#[test]
fn capture_refusals_carry_a_code_a_phone_can_say_in_its_own_words() {
    let f = fixture("r4-codes");
    let session = login_ok(&f);
    let upload = |query: &str, bytes: Vec<u8>| {
        send(
            &f,
            &session,
            &format!("/admin/api/upload?name=a{query}"),
            bytes,
        )
    };
    let heic = [&[0, 0, 0, 0x18][..], b"ftypheic", &[0u8; 32]].concat();
    let refused = upload("", heic);
    assert_eq!((refused.status, code(&refused).as_str()), (415, "heic"));
    let text = upload("", b"hello there".to_vec());
    assert_eq!((text.status, code(&text).as_str()), (415, "not-image"));
    let slot = upload(&format!("&capture={ID}&slot=99"), png());
    assert_eq!((slot.status, code(&slot).as_str()), (400, "capture-slot"));
    let half = upload(&format!("&capture={ID}"), png());
    assert_eq!(code(&half), "capture-slot");

    let audio = |query: &str, bytes: Vec<u8>| {
        send(
            &f,
            &session,
            &format!("/admin/api/capture-audio?{query}"),
            bytes,
        )
    };
    let not_audio = audio(&format!("capture={ID}"), png());
    assert_eq!(
        (not_audio.status, code(&not_audio).as_str()),
        (415, "not-audio")
    );
    assert_eq!(code(&audio("capture=nope", webm())), "capture-id");

    let bad_id = save_capture(&f, &session, "ABCDEF0123456789abcdef0123456789");
    assert_eq!((bad_id.status, code(&bad_id).as_str()), (422, "capture-id"));
    fs::create_dir_all(f.dir.join(".openblog/captures")).unwrap();
    fs::write(
        f.dir.join(".openblog/captures").join(format!("{ID}.json")),
        r#"{"v":2,"path":"x"}"#,
    )
    .unwrap();
    let newer = save_capture(&f, &session, ID);
    assert_eq!(
        (newer.status, code(&newer).as_str()),
        (409, "ledger-version")
    );

    let transcribe = post(
        &f,
        &session,
        "/admin/api/assistant/transcribe",
        json!({ "captureId": "11111111111111111111111111111111", "confirmed": true }),
    );
    assert_eq!(
        (transcribe.status, code(&transcribe).as_str()),
        (404, "no-note")
    );
    let draft = |body: Json| post(&f, &session, "/admin/api/assistant/job-draft", body);
    assert_eq!(code(&draft(json!({ "notes": "  " }))), "no-notes");
    assert_eq!(
        code(&draft(
            json!({ "notes": "x".repeat(openblog_core::capture::MAX_NOTES_CHARS + 1) })
        )),
        "notes-too-long"
    );
    assert_eq!(
        code(&draft(json!({ "notes": "Leak", "photoAlts": ["a\u{7}"] }))),
        "bad-photo-alt"
    );
    assert_eq!(
        code(&draft(json!({ "notes": "Leak", "photoAlts": "a" }))),
        "bad-photo-alt"
    );
}

fn write(f: &Fixture, rel: &str, text: &str) {
    let path = f.dir.join("content").join(rel);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, text).unwrap();
}

#[test]
fn the_job_check_matches_the_build_and_codes_each_problem() {
    let f = fixture("r4-job-check");
    let session = login_ok(&f);
    let check = |fields: Json| {
        body_json(&post(
            &f,
            &session,
            "/admin/api/job/check",
            json!({ "fields": fields }),
        ))
    };
    let good = json!({
        "job.trade": "roofing", "job.service": "gutter-guards",
        "job.place.town": "Elkins", "job.place.region": "WV",
        "job.started": "2026-11-12", "job.finished": "2026-11-13",
        "job.review": "smith-2026",
    });
    // No services or reviews yet: nothing to check them against.
    let none = check(good.clone());
    assert_eq!(none["ok"], true, "{none}");
    assert_eq!(none["messages"], json!([]));

    write(
        &f,
        "services/roof-repair.md",
        "---\nversion: 1\nid: roof-repair\nname: Roof repair\nsummary: Leaks fixed.\n---\n",
    );
    write(&f, "proof/jones.md", "---\nversion: 1\nid: jones-2026\nauthor: Pat Jones\ndate: 2026-10-01\nplatform: google\nsourceUrl: https://g.page/r/crew/review\nrating: 5\nprovenance: snapshot\nretrievedAt: 2026-11-08T15:04:05Z\n---\nGreat work.\n");
    let known = check(good);
    let problems = known["problems"].as_array().unwrap();
    assert!(
        problems
            .iter()
            .any(|p| p["field"] == "job.service" && p["code"] == "unknown-service"),
        "{known}"
    );
    assert!(
        problems
            .iter()
            .any(|p| p["field"] == "job.review" && p["code"] == "unknown-review"),
        "{known}"
    );
    assert_eq!(known["ok"], false);
    assert!(known["messages"]
        .as_array()
        .unwrap()
        .iter()
        .any(|m| m.as_str().unwrap().contains("gutter-guards")));

    let order = check(
        json!({ "job.started": "2026-11-13", "job.finished": "2026-11-01", "job.place.town": "12 Main St 26241" }),
    );
    let codes: Vec<(String, String)> = order["problems"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| {
            (
                p["field"].as_str().unwrap().to_string(),
                p["code"].as_str().unwrap().to_string(),
            )
        })
        .collect();
    for expected in [
        ("job.finished", "order"),
        ("job.place.town", "address"),
        ("job.trade", "missing"),
    ] {
        assert!(
            codes.contains(&(expected.0.to_string(), expected.1.to_string())),
            "{expected:?}: {codes:?}"
        );
    }
}

#[test]
fn meta_job_names_services_by_title_and_the_sites_trade_and_state() {
    let f = fixture("r4-meta-job");
    let session = login_ok(&f);
    let path = f.dir.join("openblog.json");
    let mut config: Json = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
    config["business"] = json!({ "trade": "Roofing", "phone": "+13045550142" });
    fs::write(&path, config.to_string()).unwrap();
    write(
        &f,
        "services/roof-repair.md",
        "---\nversion: 1\nid: roof-repair\nname: Roof repair\nsummary: Leaks fixed.\n---\n",
    );
    write(
        &f,
        "services/draft.md",
        "---\nversion: 1\nid: chimneys\nname: Chimneys\nsummary: Soon.\ndraft: true\n---\n",
    );
    for (name, region) in [("a", "WV"), ("b", "wv"), ("c", "MD")] {
        write(&f, &format!("posts/{name}.md"), &format!("---\ntitle: {name}\ndate: 2026-10-01\nprofile: job\ndraft: true\njob:\n  service: gutter-guards\n  place:\n    region: {region}\n---\n"));
    }
    let meta = body_json(&get(&f, &session, "/admin/api/meta"));
    assert_eq!(
        meta["job"]["services"],
        json!([
            { "id": "gutter-guards", "title": "Gutter guards" },
            { "id": "roof-repair", "title": "Roof repair" }
        ])
    );
    assert_eq!(meta["job"]["siteTrade"], "roofing");
    assert_eq!(meta["job"]["siteRegion"], "WV");
}

#[test]
fn a_trade_sites_app_icon_offers_new_job_and_no_other_site_does() {
    let f = fixture("r4-manifest");
    let plain = handle(&f.state, &req("GET", "/admin/manifest.webmanifest"));
    let value: Json = serde_json::from_slice(&plain.body).unwrap();
    assert!(value.get("shortcuts").is_none(), "{value}");
    write(
        &f,
        "services/roof-repair.md",
        "---\nversion: 1\nid: roof-repair\nname: Roof repair\nsummary: Leaks fixed.\n---\n",
    );
    let trade = handle(&f.state, &req("GET", "/admin/manifest.webmanifest"));
    let value: Json = serde_json::from_slice(&trade.body).unwrap();
    assert_eq!(value["shortcuts"][0]["name"], "New job");
    assert_eq!(value["shortcuts"][0]["url"], "/admin/studio/#/new-job");
}

#[test]
fn the_worker_keeps_only_studios_own_files_and_each_is_served() {
    let f = fixture("r4-worker-files");
    let worker = handle(&f.state, &req("GET", "/admin/sw.js"));
    assert_eq!(worker.status, 200);
    let text = String::from_utf8(worker.body.clone()).unwrap();
    let first = text.lines().next().unwrap();
    let release: Json = serde_json::from_str(
        first
            .strip_prefix("self.STUDIO_RELEASE = ")
            .and_then(|rest| rest.strip_suffix(';'))
            .unwrap(),
    )
    .unwrap();
    assert_eq!(release["version"].as_str().unwrap().len(), 16);
    let files: Vec<&str> = release["files"]
        .as_array()
        .unwrap()
        .iter()
        .map(|file| file.as_str().unwrap())
        .collect();
    assert!(files.contains(&"/admin/studio/"));
    assert!(files.contains(&"/admin/studio/studio.js"));
    assert!(files.contains(&"/admin/studio/screens/home.js"));
    for file in &files {
        assert!(file.starts_with("/admin/studio/"), "{file}");
        assert!(
            !file.contains("/api/") && !file.ends_with("sw.js"),
            "{file}"
        );
        assert_eq!(handle(&f.state, &req("GET", file)).status, 200, "{file}");
    }
    // The same release twice is the same worker, so nothing is fetched again for nothing.
    assert_eq!(
        handle(&f.state, &req("GET", "/admin/sw.js")).body,
        worker.body
    );
}

#[test]
fn a_job_photo_and_voice_note_on_the_phone_can_be_shown_before_they_send_and_nothing_else_opens() {
    let f = fixture("r4-csp");
    let page = handle(&f.state, &req("GET", "/admin/studio/"));
    let csp = page
        .headers
        .iter()
        .find(|(name, _)| name == "Content-Security-Policy")
        .map(|(_, value)| value.clone())
        .unwrap();
    let directive = |name: &str| {
        csp.split(';')
            .map(str::trim)
            .find(|d| d.split_whitespace().next() == Some(name))
            .unwrap_or_else(|| panic!("{name} missing from {csp}"))
            .to_string()
    };
    // Thumbnails and the voice note's player read what the page itself made (blob:), nothing more.
    assert_eq!(directive("img-src"), "img-src 'self' data: https: blob:");
    assert_eq!(directive("media-src"), "media-src 'self' blob:");
    assert_eq!(
        directive("script-src"),
        "script-src 'self' 'wasm-unsafe-eval'"
    );
    assert_eq!(directive("style-src"), "style-src 'self'");
    assert!(!csp.contains("unsafe-inline"), "{csp}");
}
