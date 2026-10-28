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
