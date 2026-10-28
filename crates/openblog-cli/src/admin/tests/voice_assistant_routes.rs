//! Voice samples and the voice guide as Assistant context (epic #409, ADRs 0350 to 0353): the
//! catalog lists samples, a request names them by id and the server reads them again, and the
//! provider call sees them as untrusted data.

use super::*;

use crate::voice_assistant::test_support::write_rough;
use crate::voice_store::Visibility;

const MISTAKE: &str = "so i deleted the wrong folder and just stared at the screen";
const BOOK: &str = "honestly it was a quiet book, and that was the whole point of it";

fn catalog(f: &Fixture, session: &(String, String)) -> Json {
    let response = handle(
        &f.state,
        &authed(req("GET", "/admin/api/assistant/context"), session, false),
    );
    assert_eq!(response.status, 200);
    body_json(&response)
}

#[test]
fn the_context_catalog_lists_voice_samples_with_stage_pack_visibility_and_size() {
    let f = fixture("voice-context-catalog");
    let session = login_ok(&f);
    // No samples: an empty list, the budget, and no folder made by looking.
    let empty = catalog(&f, &session);
    assert_eq!(empty["voiceSamples"], json!([]));
    assert_eq!(
        empty["voiceBudget"],
        json!({ "samples": 8, "characters": 120000 })
    );
    assert!(!f.dir.join("assistant/context/voice").exists());

    let private = write_rough(
        &f.dir,
        Visibility::Private,
        "a-mistake-i-made",
        "stories",
        "2026-10-28",
        MISTAKE,
    );
    let portable = write_rough(
        &f.dir,
        Visibility::Portable,
        "a-book-i-loved",
        "reviews",
        "2026-10-29",
        BOOK,
    );
    fs::write(
        f.dir
            .join("assistant/context/voice/2026-10-30-broken-rough.md"),
        "not a sample",
    )
    .unwrap();

    let found = catalog(&f, &session);
    let samples = found["voiceSamples"].as_array().unwrap();
    assert_eq!(samples.len(), 3);
    let by_name = |name: &str| samples.iter().find(|s| s["name"] == name).unwrap();
    let mistake = by_name(&private);
    assert_eq!(mistake["id"], format!("voice:private:{private}"));
    assert_eq!(mistake["stage"], "rough");
    assert_eq!(mistake["pack"], "stories");
    assert_eq!(mistake["prompt"], "a-mistake-i-made");
    assert_eq!(mistake["visibility"], "private");
    assert_eq!(mistake["characters"], MISTAKE.chars().count());
    assert_eq!(mistake["valid"], true);
    assert_eq!(
        mistake["path"],
        format!(".openblog/private/context/voice/{private}")
    );
    assert_eq!(by_name(&portable)["visibility"], "portable");
    let broken = by_name("2026-10-30-broken-rough.md");
    assert_eq!(broken["valid"], false);
    assert_eq!(broken["characters"], 0);
    assert!(broken["guidance"].as_str().unwrap().len() > 10);
    // The listing never carries sample text.
    assert!(!String::from_utf8_lossy(&serde_json::to_vec(&found).unwrap()).contains("stared"));
}

#[test]
fn the_voice_guide_is_listed_and_saved_like_other_context_with_a_revision_check() {
    let f = fixture("voice-guide-context");
    let session = login_ok(&f);
    let found = catalog(&f, &session);
    let guides: Vec<&Json> = found["voiceGuides"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|d| d["contextType"] == "voice")
        .collect();
    assert_eq!(guides.len(), 2);
    assert!(guides
        .iter()
        .any(|d| d["id"] == "portable:voice" && d["exists"] == false));
    assert!(guides.iter().any(|d| d["id"] == "private:voice"));

    let save = |body: Json| {
        handle(
            &f.state,
            &authed(
                json_req("PUT", "/admin/api/assistant/context", body),
                &session,
                true,
            ),
        )
    };
    let created = save(json!({
        "contextType": "voice", "visibility": "portable", "content": "# Voice guide\n", "etag": null
    }));
    assert_eq!(
        created.status,
        200,
        "{}",
        String::from_utf8_lossy(&created.body)
    );
    assert_eq!(
        fs::read_to_string(f.dir.join("assistant/context/voice.md")).unwrap(),
        "# Voice guide\n"
    );
    let stale = save(json!({
        "contextType": "voice", "visibility": "portable", "content": "# Other\n", "etag": "stale"
    }));
    assert_eq!(stale.status, 409);
}

fn review_body(context_ids: Json) -> Json {
    json!({
        "source": { "title": "Unsaved", "metadata": { "draft": "true" }, "markdown": "Draft body needs voice." },
        "skillIds": ["voice-review"],
        "contextIds": context_ids,
    })
}

fn complete_body(context_ids: Json) -> Json {
    json!({
        "source": { "title": "T", "metadata": {}, "markdown": "The lantern opened",
            "prefix": "The lantern", "suffix": " opened", "editorMode": "markdown" },
        "contextIds": context_ids,
    })
}

fn post(f: &Fixture, session: &(String, String), path: &str, body: Json) -> Response {
    handle(
        &f.state,
        &authed(json_req("POST", path, body), session, true),
    )
}

#[test]
fn review_reads_selected_samples_on_the_server_and_labels_them_untrusted() {
    let _env = quiz_env();
    let _key = EnvRestore::capture("OPENBLOG_LESSONS_API_KEY");
    let f = fixture("voice-review-reload");
    let session = login_ok(&f);
    let file = write_rough(
        &f.dir,
        Visibility::Private,
        "a-mistake-i-made",
        "stories",
        "2026-10-28",
        MISTAKE,
    );
    let id = format!("voice:private:{file}");
    let (endpoint, captured, provider) = capturing_provider(json!({ "findings": [] }).to_string());
    set_quiz_endpoint(&f, &endpoint);
    std::env::set_var("OPENBLOG_LESSONS_API_KEY", "voice-secret");

    // The browser also tries to supply its own text and size; both are ignored.
    let mut body = review_body(json!([id]));
    body["voiceSamples"] =
        json!([{ "id": id, "content": "FORGED BY THE BROWSER", "characters": 1 }]);
    let response = post(&f, &session, "/admin/api/assistant/review", body);
    assert_eq!(
        response.status,
        200,
        "{}",
        String::from_utf8_lossy(&response.body)
    );
    provider.join().unwrap();
    let outbound = captured.recv().unwrap();
    let entry = &outbound["untrustedData"]["context"][0];
    assert_eq!(entry["content"], MISTAKE);
    assert_eq!(entry["kind"], "voice-sample");
    assert_eq!(entry["stage"], "rough");
    assert_eq!(entry["pack"], "stories");
    assert_eq!(entry["name"], file);
    assert!(!outbound.to_string().contains("FORGED BY THE BROWSER"));
    let result = body_json(&response);
    assert_eq!(result["context"][0]["id"], id);
    assert_eq!(result["context"][0]["visibility"], "private");
    assert!(!String::from_utf8_lossy(&response.body).contains("voice-secret"));
}

#[test]
fn completion_reads_selected_samples_on_the_server_too() {
    let _env = quiz_env();
    let _key = EnvRestore::capture("OPENBLOG_LESSONS_API_KEY");
    let f = fixture("voice-complete-reload");
    let session = login_ok(&f);
    let file = write_rough(
        &f.dir,
        Visibility::Portable,
        "a-book-i-loved",
        "reviews",
        "2026-10-29",
        BOOK,
    );
    let (endpoint, captured, provider) =
        capturing_provider(json!({ "completion": " and so on." }).to_string());
    set_quiz_endpoint(&f, &endpoint);
    std::env::set_var("OPENBLOG_LESSONS_API_KEY", "voice-secret");
    let response = post(
        &f,
        &session,
        "/admin/api/assistant/complete",
        complete_body(json!([format!("voice:portable:{file}")])),
    );
    assert_eq!(
        response.status,
        200,
        "{}",
        String::from_utf8_lossy(&response.body)
    );
    provider.join().unwrap();
    let outbound = captured.recv().unwrap();
    assert_eq!(outbound["untrustedData"]["context"][0]["content"], BOOK);
    assert_eq!(
        outbound["untrustedData"]["context"][0]["kind"],
        "voice-sample"
    );
}

#[test]
fn a_sample_removed_after_the_catalog_showed_it_fails_the_request() {
    let _env = quiz_env();
    let _key = EnvRestore::capture("OPENBLOG_LESSONS_API_KEY");
    let f = fixture("voice-reload-changes");
    let session = login_ok(&f);
    let file = write_rough(
        &f.dir,
        Visibility::Private,
        "a-mistake-i-made",
        "stories",
        "2026-10-28",
        MISTAKE,
    );
    let id = format!("voice:private:{file}");
    std::env::set_var("OPENBLOG_LESSONS_API_KEY", "voice-secret");
    // Nothing listens at this endpoint: a request that got as far as the provider would fail
    // differently from a refusal.
    set_quiz_endpoint(&f, "https://assistant.example/generate");
    fs::remove_file(f.dir.join(".openblog/private/context/voice").join(&file)).unwrap();
    let gone = post(
        &f,
        &session,
        "/admin/api/assistant/review",
        review_body(json!([id])),
    );
    assert_eq!(gone.status, 400, "{}", String::from_utf8_lossy(&gone.body));
}

#[test]
fn an_unknown_invalid_or_malformed_sample_fails_closed_before_any_provider_call() {
    let _env = quiz_env();
    let _key = EnvRestore::capture("OPENBLOG_LESSONS_API_KEY");
    let f = fixture("voice-fail-closed");
    let session = login_ok(&f);
    set_quiz_endpoint(&f, "https://assistant.example/generate");
    std::env::set_var("OPENBLOG_LESSONS_API_KEY", "voice-secret");
    let good = write_rough(
        &f.dir,
        Visibility::Private,
        "a-mistake-i-made",
        "stories",
        "2026-10-28",
        MISTAKE,
    );
    fs::write(
        f.dir
            .join(".openblog/private/context/voice/2026-10-30-broken-rough.md"),
        "not a sample",
    )
    .unwrap();
    let bad_ids = [
        "voice:private:2026-10-31-never-written-rough.md".to_string(),
        format!("voice:portable:{good}"), // right file, wrong folder
        "voice:private:2026-10-30-broken-rough.md".to_string(),
        "voice:private:not-a-sample-name.md".to_string(),
        "voice:private:../../openblog.json".to_string(),
        "voice:private:a/b-rough.md".to_string(),
        "voice:everyone:x-rough.md".to_string(),
        "voice:private".to_string(),
    ];
    for bad in &bad_ids {
        let review = post(
            &f,
            &session,
            "/admin/api/assistant/review",
            review_body(json!([bad])),
        );
        assert_eq!(
            review.status,
            400,
            "{bad}: {}",
            String::from_utf8_lossy(&review.body)
        );
        let complete = post(
            &f,
            &session,
            "/admin/api/assistant/complete",
            complete_body(json!([bad])),
        );
        assert_eq!(
            complete.status,
            400,
            "{bad}: {}",
            String::from_utf8_lossy(&complete.body)
        );
    }
    // A good id next to a bad one still fails the whole request.
    let mixed = post(
        &f,
        &session,
        "/admin/api/assistant/review",
        review_body(json!([
            format!("voice:private:{good}"),
            "voice:private:2026-10-31-never-written-rough.md"
        ])),
    );
    assert_eq!(mixed.status, 400);
}

#[test]
fn too_many_samples_or_too_many_characters_are_refused_with_a_sentence() {
    let _env = quiz_env();
    let _key = EnvRestore::capture("OPENBLOG_LESSONS_API_KEY");
    let f = fixture("voice-budget");
    let session = login_ok(&f);
    set_quiz_endpoint(&f, "https://assistant.example/generate");
    std::env::set_var("OPENBLOG_LESSONS_API_KEY", "voice-secret");
    let many: Vec<String> = (1..=9)
        .map(|n| {
            let file = write_rough(
                &f.dir,
                Visibility::Private,
                &format!("prompt-{n}"),
                "stories",
                "2026-10-28",
                "short words",
            );
            format!("voice:private:{file}")
        })
        .collect();
    let refused = post(
        &f,
        &session,
        "/admin/api/assistant/review",
        review_body(json!(many)),
    );
    assert_eq!(refused.status, 400);
    assert!(String::from_utf8_lossy(&refused.body).contains("at most 8"));

    let long: Vec<String> = (1..=3)
        .map(|n| {
            let file = write_rough(
                &f.dir,
                Visibility::Portable,
                &format!("long-{n}"),
                "stories",
                "2026-10-28",
                &"word ".repeat(10_000),
            );
            format!("voice:portable:{file}")
        })
        .collect();
    let refused = post(
        &f,
        &session,
        "/admin/api/assistant/review",
        review_body(json!(long)),
    );
    assert_eq!(refused.status, 400);
    assert!(String::from_utf8_lossy(&refused.body).contains("at most 120000"));
}

// ---- the voice-guide route (#456) ------------------------------------------------------------

const GUIDE_PATH: &str = "/admin/api/assistant/voice-guide";

fn write_guide_skill(f: &Fixture) {
    fs::create_dir_all(f.dir.join("assistant/skills")).unwrap();
    fs::write(
        f.dir.join("assistant/skills/voice-guide.md"),
        "---\nid: voice-guide\nname: Voice guide\ndescription: Folds samples into a guide.\nversion: 1.0.0\nscopes: [document]\noutput: voice-guide\noverride: voice-guide\n---\nFold the samples into the guide, as this project wants.\n",
    )
    .unwrap();
}

fn provider_guide(file: &str) -> String {
    json!({
        "sections": [{ "id": "diction", "traits": [
            { "statement": "Starts with so", "quote": "so i deleted", "sample": file, "oneSample": true }
        ]}],
        "unknown": ["How you end a piece"]
    })
    .to_string()
}

fn tree(root: &Path) -> Vec<(String, Vec<u8>)> {
    fn walk(base: &Path, dir: &Path, out: &mut Vec<(String, Vec<u8>)>) {
        let Ok(entries) = fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                walk(base, &path, out);
            } else {
                let name = path
                    .strip_prefix(base)
                    .unwrap()
                    .to_string_lossy()
                    .replace('\\', "/");
                out.push((name, fs::read(&path).unwrap()));
            }
        }
    }
    let mut out = Vec::new();
    walk(root, &root.join("assistant"), &mut out);
    walk(root, &root.join(".openblog/private/context"), &mut out);
    out.sort();
    out
}

#[test]
fn the_voice_guide_route_proposes_a_guide_and_writes_nothing() {
    let _env = quiz_env();
    let _key = EnvRestore::capture("OPENBLOG_LESSONS_API_KEY");
    let f = fixture("voice-guide-propose");
    let session = login_ok(&f);
    write_guide_skill(&f);
    let file = write_rough(
        &f.dir,
        Visibility::Private,
        "a-mistake-i-made",
        "stories",
        "2026-10-28",
        MISTAKE,
    );
    let (endpoint, captured, provider) = capturing_provider(provider_guide(&file));
    set_quiz_endpoint(&f, &endpoint);
    std::env::set_var("OPENBLOG_LESSONS_API_KEY", "voice-secret");
    let before = tree(&f.dir);

    let response = post(
        &f,
        &session,
        GUIDE_PATH,
        json!({ "sampleIds": [format!("voice:private:{file}")] }),
    );
    assert_eq!(
        response.status,
        200,
        "{}",
        String::from_utf8_lossy(&response.body)
    );
    provider.join().unwrap();
    let outbound = captured.recv().unwrap();
    assert_eq!(outbound["task"], "voice-guide");
    assert_eq!(outbound["untrustedData"]["context"][0]["content"], MISTAKE);
    assert!(outbound["untrustedData"]["currentGuide"].is_null());
    assert_eq!(outbound["skills"][0]["id"], "voice-guide");

    let result = body_json(&response);
    let markdown = result["markdown"].as_str().unwrap();
    assert!(markdown.starts_with("# Voice guide\n"));
    assert!(markdown.contains(&format!(
        "- Starts with so: \"so i deleted\" ({file}) (one sample)"
    )));
    assert!(markdown.ends_with("- How you end a piece\n"));
    assert_eq!(result["guide"]["sections"][0]["heading"], "Word choice");
    assert_eq!(result["current"]["exists"], false);
    assert!(result["diff"].as_str().unwrap().contains("+# Voice guide"));
    assert_eq!(result["targets"]["portable"]["exists"], false);
    assert_eq!(result["targets"]["private"]["etag"], Json::Null);
    assert_eq!(result["samples"][0]["name"], file);
    assert!(!String::from_utf8_lossy(&response.body).contains("voice-secret"));
    // Nothing was written: no guide, and every sample and context byte as it was.
    assert!(!f.dir.join("assistant/context/voice.md").exists());
    assert!(!f.dir.join(".openblog/private/context/voice.md").exists());
    assert_eq!(tree(&f.dir), before);
}

#[test]
fn the_proposal_is_shown_as_a_diff_against_the_saved_guide_and_saved_only_with_the_revision_seen() {
    let _env = quiz_env();
    let _key = EnvRestore::capture("OPENBLOG_LESSONS_API_KEY");
    let f = fixture("voice-guide-approve");
    let session = login_ok(&f);
    write_guide_skill(&f);
    let file = write_rough(
        &f.dir,
        Visibility::Private,
        "a-mistake-i-made",
        "stories",
        "2026-10-28",
        MISTAKE,
    );
    fs::create_dir_all(f.dir.join("assistant/context")).unwrap();
    let saved = "# Voice guide\n\n## Habits and quirks\n\n- Likes lists\n";
    fs::write(f.dir.join("assistant/context/voice.md"), saved).unwrap();
    let (endpoint, captured, provider) = capturing_provider(provider_guide(&file));
    set_quiz_endpoint(&f, &endpoint);
    std::env::set_var("OPENBLOG_LESSONS_API_KEY", "voice-secret");

    let response = post(
        &f,
        &session,
        GUIDE_PATH,
        json!({ "sampleIds": [format!("voice:private:{file}")] }),
    );
    assert_eq!(
        response.status,
        200,
        "{}",
        String::from_utf8_lossy(&response.body)
    );
    provider.join().unwrap();
    // The provider saw the saved guide as untrusted data.
    assert_eq!(
        captured.recv().unwrap()["untrustedData"]["currentGuide"],
        saved
    );
    let result = body_json(&response);
    assert_eq!(result["current"]["content"], saved);
    assert_eq!(result["current"]["visibility"], "portable");
    let diff = result["diff"].as_str().unwrap();
    assert!(diff.contains("-- Likes lists"), "{diff}");
    assert!(diff.contains("+## Word choice"), "{diff}");
    assert_eq!(
        fs::read_to_string(f.dir.join("assistant/context/voice.md")).unwrap(),
        saved,
        "proposing changes nothing"
    );

    // Save is the ordinary context save, with the revision the author saw.
    let etag = result["targets"]["portable"]["etag"]
        .as_str()
        .unwrap()
        .to_string();
    let put = |content: &str, etag: Json| {
        handle(
            &f.state,
            &authed(
                json_req(
                    "PUT",
                    "/admin/api/assistant/context",
                    json!({ "contextType": "voice", "visibility": "portable", "content": content, "etag": etag }),
                ),
                &session,
                true,
            ),
        )
    };
    let edited = format!("{}\n- My own line\n", result["markdown"].as_str().unwrap());
    assert_eq!(put(&edited, json!("stale")).status, 409);
    assert_eq!(
        fs::read_to_string(f.dir.join("assistant/context/voice.md")).unwrap(),
        saved
    );
    assert_eq!(put(&edited, json!(etag)).status, 200);
    assert_eq!(
        fs::read_to_string(f.dir.join("assistant/context/voice.md")).unwrap(),
        edited
    );
}

#[test]
fn a_result_that_quotes_text_the_sample_does_not_contain_is_rejected_and_no_guide_is_shown() {
    let _env = quiz_env();
    let _key = EnvRestore::capture("OPENBLOG_LESSONS_API_KEY");
    let f = fixture("voice-guide-invalid");
    let session = login_ok(&f);
    write_guide_skill(&f);
    let file = write_rough(
        &f.dir,
        Visibility::Private,
        "a-mistake-i-made",
        "stories",
        "2026-10-28",
        MISTAKE,
    );
    let invented = provider_guide(&file).replace("so i deleted", "so I deleted");
    let (endpoint, _captured, provider) = capturing_provider(invented);
    set_quiz_endpoint(&f, &endpoint);
    std::env::set_var("OPENBLOG_LESSONS_API_KEY", "voice-secret");
    let response = post(
        &f,
        &session,
        GUIDE_PATH,
        json!({ "sampleIds": [format!("voice:private:{file}")] }),
    );
    provider.join().unwrap();
    assert_eq!(response.status, 502);
    let body = body_json(&response);
    assert_eq!(body["code"], "invalid-result");
    assert!(body["error"]
        .as_str()
        .unwrap()
        .contains("does not occur word for word"));
    assert!(body.get("markdown").is_none() && body.get("guide").is_none());
}

#[test]
fn the_voice_guide_route_is_authenticated_csrf_protected_bounded_and_samples_only() {
    let _env = quiz_env();
    let _key = EnvRestore::capture("OPENBLOG_LESSONS_API_KEY");
    let f = fixture("voice-guide-guards");
    let session = login_ok(&f);
    write_guide_skill(&f);
    set_quiz_endpoint(&f, "https://assistant.example/generate");
    std::env::set_var("OPENBLOG_LESSONS_API_KEY", "voice-secret");
    let file = write_rough(
        &f.dir,
        Visibility::Private,
        "a-mistake-i-made",
        "stories",
        "2026-10-28",
        MISTAKE,
    );
    let id = format!("voice:private:{file}");
    let body = json!({ "sampleIds": [id] });
    assert_eq!(
        handle(&f.state, &json_req("POST", GUIDE_PATH, body.clone())).status,
        401
    );
    assert_eq!(
        handle(
            &f.state,
            &authed(json_req("POST", GUIDE_PATH, body.clone()), &session, false)
        )
        .status,
        403
    );
    for bad in [
        json!({ "sampleIds": [] }),
        json!({ "sampleIds": ["portable:author"] }),
        json!({ "sampleIds": [id.clone(), id.clone()] }),
        json!({ "sampleIds": ["voice:private:2026-10-31-never-written-rough.md"] }),
        json!({ "sampleIds": [id.clone()], "guide": "everyone" }),
        json!({}),
    ] {
        let response = post(&f, &session, GUIDE_PATH, bad.clone());
        assert_eq!(
            response.status,
            400,
            "{bad}: {}",
            String::from_utf8_lossy(&response.body)
        );
    }
    let _first = f.state.assistant_operations.try_acquire().unwrap();
    let _second = f.state.assistant_operations.try_acquire().unwrap();
    assert_eq!(post(&f, &session, GUIDE_PATH, body).status, 429);
}

#[test]
fn the_built_in_voice_guide_skill_runs_the_task_and_is_not_a_review_skill() {
    let _env = quiz_env();
    let _key = EnvRestore::capture("OPENBLOG_LESSONS_API_KEY");
    let f = fixture("voice-guide-builtin-skill");
    let session = login_ok(&f);
    let file = write_rough(
        &f.dir,
        Visibility::Private,
        "a-mistake-i-made",
        "stories",
        "2026-10-28",
        MISTAKE,
    );
    let (endpoint, captured, provider) = capturing_provider(provider_guide(&file));
    set_quiz_endpoint(&f, &endpoint);
    std::env::set_var("OPENBLOG_LESSONS_API_KEY", "voice-secret");
    // No project skill file: the built-in is used.
    assert!(!f.dir.join("assistant/skills").exists());
    let response = post(
        &f,
        &session,
        GUIDE_PATH,
        json!({ "sampleIds": [format!("voice:private:{file}")] }),
    );
    assert_eq!(
        response.status,
        200,
        "{}",
        String::from_utf8_lossy(&response.body)
    );
    provider.join().unwrap();
    let outbound = captured.recv().unwrap();
    assert_eq!(outbound["skills"][0]["id"], "voice-guide");
    assert!(outbound["skills"][0]["instructions"]
        .as_str()
        .unwrap()
        .contains("word for word"));
    assert_eq!(body_json(&response)["skill"]["version"], "1.0.0");

    // It appears in the skill catalog, with its own output kind, and cannot be picked for a document review.
    let skills = body_json(&handle(
        &f.state,
        &authed(req("GET", "/admin/api/assistant/skills"), &session, false),
    ));
    let listed = skills["skills"]
        .as_array()
        .unwrap()
        .iter()
        .find(|skill| skill["id"] == "voice-guide")
        .expect("listed");
    assert_eq!(listed["output"], "voice-guide");
    let review = post(
        &f,
        &session,
        "/admin/api/assistant/review",
        json!({
            "source": { "title": "T", "metadata": {}, "markdown": "Body" },
            "skillIds": ["voice-guide"],
            "contextIds": [],
        }),
    );
    assert_eq!(review.status, 400);
}
