//! Studio R8, the writing helper's server side (docs/specs/studio/r8/ux.md, G54–G62): provider
//! failures by code, input limits by code, status as facts, the key check, the light catalog, and
//! above all the key: write-only, never over plain http, never in an answer or a log line.
//! Providers are loopback fakes; no test reaches a network.

use super::*;

const KEY: &str = "sk-ant-r8-KNOWN-key-0123456789abcdef";

/// A fake provider that answers once with `status`, `headers` and `body`, and hands back what it
/// was sent (the request line, headers and body as text).
fn provider_once(
    status: u16,
    headers: &'static str,
    body: String,
) -> (
    String,
    std::sync::mpsc::Receiver<String>,
    std::thread::JoinHandle<()>,
) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let (sender, receiver) = std::sync::mpsc::channel();
    let handle = std::thread::spawn(move || {
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
            let Some(header_end) = request.windows(4).position(|part| part == b"\r\n\r\n") else {
                continue;
            };
            let head = String::from_utf8_lossy(&request[..header_end]);
            let length = head
                .lines()
                .find_map(|line| {
                    let (name, value) = line.split_once(':')?;
                    name.eq_ignore_ascii_case("content-length")
                        .then(|| value.trim().parse::<usize>().ok())
                        .flatten()
                })
                .unwrap_or(0);
            if request.len() >= header_end + 4 + length {
                break;
            }
        }
        sender
            .send(String::from_utf8_lossy(&request).into_owned())
            .ok();
        let response = format!(
            "HTTP/1.1 {status} X\r\nContent-Type: application/json\r\n{headers}Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        let _ = stream.write_all(response.as_bytes());
    });
    (format!("http://{address}/generate"), receiver, handle)
}

fn post(f: &Fixture, session: &(String, String), route: &str, body: Json) -> Response {
    handle(
        &f.state,
        &authed(
            json_req("POST", &format!("/admin/api/{route}"), body),
            session,
            true,
        ),
    )
}

fn get(f: &Fixture, session: &(String, String), route: &str) -> Response {
    handle(
        &f.state,
        &authed(req("GET", &format!("/admin/api/{route}")), session, false),
    )
}

fn review_body() -> Json {
    json!({
        "source": { "title": "Pie", "metadata": {}, "markdown": "I use alot of butter." },
        "skillIds": ["copy-review"],
        "contextIds": [],
        "confirmed": true
    })
}

fn complete_body() -> Json {
    json!({
        "source": { "title": "Pie", "metadata": {}, "markdown": "I use butter", "prefix": "I use butter", "suffix": "", "editorMode": "markdown" },
        "contextIds": [],
        "confirmed": true
    })
}

fn settings(f: &Fixture, session: &(String, String)) -> Json {
    body_json(&get(f, session, "assistant/settings"))
}

fn put_settings(f: &Fixture, session: &(String, String), request: Request) -> Response {
    handle(&f.state, &authed(request, session, true))
}

fn key_log() -> Vec<String> {
    KEY_LOG.with(|log| log.borrow().clone())
}

#[test]
fn a_provider_failure_answers_with_its_own_code_on_every_helper_route() {
    let _env = quiz_env();
    let _key = EnvRestore::capture("OPENBLOG_LESSONS_API_KEY");
    let f = fixture("r8-provider-codes");
    let session = login_ok(&f);
    std::env::set_var("OPENBLOG_LESSONS_API_KEY", KEY);
    let routes: [(&str, Json); 4] = [
        ("assistant/review", confirmed(review_body())),
        ("assistant/complete", confirmed(complete_body())),
        (
            "quiz/generate",
            json!({ "confirmed": true, "context": "A short section.", "count": 1 }),
        ),
        (
            "assistant/code-interaction",
            json!({ "confirmed": true, "context": "A short section.", "kind": "example" }),
        ),
    ];
    let cases: [(u16, &'static str, &str, &str, Option<u64>); 8] = [
        (401, "", "{}", "key-rejected", None),
        (403, "", "{}", "key-rejected", None),
        (429, "Retry-After: 7\r\n", "{}", "provider-busy", Some(7)),
        (429, "", "{}", "provider-busy", None),
        (500, "", "{}", "provider-down", None),
        (529, "", "{}", "provider-down", None),
        (400, "", "{}", "provider-error", None),
        (200, "", "not json at all", "invalid-result", None),
    ];
    for (route, body) in &routes {
        for (status, headers, reply, code, retry) in cases {
            // A provider that echoes the key back must not get it into the answer.
            let reply = if reply == "{}" {
                format!(r#"{{"error":"bad key {KEY}"}}"#)
            } else {
                reply.to_string()
            };
            let (endpoint, _seen, provider) = provider_once(status, headers, reply);
            set_quiz_endpoint(&f, &endpoint);
            let response = post(&f, &session, route, body.clone());
            provider.join().unwrap();
            let text = String::from_utf8_lossy(&response.body).into_owned();
            assert_eq!(response.status, 502, "{route} {status}: {text}");
            let json = body_json(&response);
            assert_eq!(json["code"], code, "{route} {status}: {text}");
            assert!(json["error"].is_string(), "{route} {status}");
            match retry {
                Some(seconds) => assert_eq!(json["retryAfter"], seconds, "{route}"),
                None => assert!(json.get("retryAfter").is_none(), "{route} {status}"),
            }
            assert!(!text.contains(KEY) && !text.contains("bad key"), "{text}");
        }
    }
}

#[test]
fn a_slow_provider_is_a_timeout_and_a_full_server_is_busy_as_json_on_quiz_generation() {
    let _env = quiz_env();
    let _key = EnvRestore::capture("OPENBLOG_LESSONS_API_KEY");
    let f = fixture("r8-quiz-codes");
    let session = login_ok(&f);
    std::env::set_var("OPENBLOG_LESSONS_API_KEY", KEY);
    let body = json!({ "context": "A short section.", "count": 1 });

    TEST_PROVIDER_TIMEOUT.with(|limit| limit.set(Duration::from_millis(300)));
    let (endpoint, server) = quiz_provider(200, "{}".into(), Duration::from_millis(700));
    set_quiz_endpoint(&f, &endpoint);
    let slow = post(&f, &session, "quiz/generate", confirmed(body.clone()));
    TEST_PROVIDER_TIMEOUT.with(|limit| limit.set(Duration::from_secs(10)));
    server.join().unwrap();
    assert_eq!(slow.status, 504);
    assert_eq!(body_json(&slow)["code"], "timeout");

    set_quiz_endpoint(&f, "https://assistant.example/generate");
    let _first = f.state.assistant_operations.try_acquire().unwrap();
    let _second = f.state.assistant_operations.try_acquire().unwrap();
    let busy = post(&f, &session, "quiz/generate", confirmed(body));
    assert_eq!(busy.status, 429);
    assert_eq!(body_json(&busy)["code"], "concurrency-limit");

    // Not set up at all is a code too, not a bare sentence.
    std::env::remove_var("OPENBLOG_LESSONS_API_KEY");
    drop((_first, _second));
    let off = post(
        &f,
        &session,
        "quiz/generate",
        json!({ "confirmed": true, "context": "A short section.", "count": 1 }),
    );
    assert_eq!(off.status, 503);
    assert_eq!(body_json(&off)["code"], "missing-credential");
}

#[test]
fn a_refusal_and_a_cut_off_answer_have_their_own_codes() {
    use crate::assistant::{AssistantErrorKind, ProviderFailure};
    let request = AssistantRequest::knowledge_checks(
        "m".into(),
        "Some words.".into(),
        KnowledgeCheckCount::new(1).unwrap(),
    );
    let refused = crate::assistant::anthropic_result(
        &json!({ "content": [], "stop_reason": "refusal" }),
        &request,
    )
    .unwrap_err();
    assert_eq!(refused.failure, Some(ProviderFailure::Refused));
    let response = review_error(refused);
    assert_eq!(response.status, 502);
    assert_eq!(body_json(&response)["code"], "refused");

    // Cut off part-way through its JSON: the text is there but isn't whole.
    let cut = crate::assistant::anthropic_result(
        &json!({ "content": [{ "type": "text", "text": "{\"questions\": [" }], "stop_reason": "max_tokens" }),
        &request,
    )
    .unwrap_err();
    assert_eq!(cut.kind, AssistantErrorKind::InvalidJson);
    assert_eq!(body_json(&review_error(cut))["code"], "cut-short");

    for (kind, envelope, code) in [
        (
            crate::assistant::NativeProviderKind::OpenAi,
            json!({ "status": "incomplete", "incomplete_details": { "reason": "max_output_tokens" }, "output": [] }),
            "cut-short",
        ),
        (
            crate::assistant::NativeProviderKind::OpenAi,
            json!({ "output": [{ "type": "message", "content": [{ "type": "refusal", "refusal": "No." }] }] }),
            "refused",
        ),
        (
            crate::assistant::NativeProviderKind::Mistral,
            json!({ "choices": [{ "finish_reason": "length", "message": { "content": "{\"questions\": [" } }] }),
            "cut-short",
        ),
        (
            crate::assistant::NativeProviderKind::OpenRouter,
            json!({ "choices": [{ "finish_reason": "content_filter", "message": {} }] }),
            "refused",
        ),
        (
            crate::assistant::NativeProviderKind::Gemini,
            json!({ "candidates": [{ "finishReason": "MAX_TOKENS", "content": { "parts": [] } }] }),
            "cut-short",
        ),
        (
            crate::assistant::NativeProviderKind::Gemini,
            json!({ "promptFeedback": { "blockReason": "SAFETY" } }),
            "refused",
        ),
    ] {
        let error =
            crate::assistant::native_provider_result(kind, &envelope, &request).unwrap_err();
        assert_eq!(body_json(&review_error(error))["code"], code, "{envelope}");
    }
    // An answer that is just wrong stays `invalid-result`.
    let wrong = crate::assistant::anthropic_result(
        &json!({ "content": [{ "type": "text", "text": "hello" }], "stop_reason": "end_turn" }),
        &request,
    )
    .unwrap_err();
    assert_eq!(body_json(&review_error(wrong))["code"], "invalid-result");
}

#[test]
fn a_request_the_helper_cannot_take_says_which_limit_by_code() {
    let _env = quiz_env();
    let _key = EnvRestore::capture("OPENBLOG_LESSONS_API_KEY");
    let f = fixture("r8-input-codes");
    let session = login_ok(&f);
    set_quiz_endpoint(&f, "https://assistant.example/generate");
    std::env::set_var("OPENBLOG_LESSONS_API_KEY", KEY);
    let long = "a ".repeat(15_000);
    let review = |change: &dyn Fn(&mut Json)| {
        let mut body = review_body();
        change(&mut body);
        post(&f, &session, "assistant/review", confirmed(body))
    };

    let passage = review(&|body| {
        body["source"]["markdown"] = json!(long);
        body["passage"] = json!({ "kind": "selection", "start": 0, "end": 25_000 });
    });
    let json = body_json(&passage);
    assert_eq!(passage.status, 400);
    assert_eq!(
        (&json["code"], &json["field"], &json["max"], &json["unit"]),
        (
            &json!("too-long"),
            &json!("passage"),
            &json!(20_000),
            &json!("characters")
        )
    );

    let blank = review(&|body| {
        body["source"]["markdown"] = json!("Words.      More.");
        body["passage"] = json!({ "kind": "selection", "start": 7, "end": 11 });
    });
    assert_eq!(body_json(&blank)["code"], "no-text");

    let many = review(&|body| {
        body["skillIds"] = json!((0..13).map(|n| format!("skill-{n}")).collect::<Vec<_>>());
    });
    let json = body_json(&many);
    assert_eq!(
        (&json["code"], &json["field"], &json["max"]),
        (&json!("too-many"), &json!("skillIds"), &json!(12))
    );
    let many = review(&|body| {
        body["contextIds"] = json!((0..17)
            .map(|n| format!("private:reference:r{n}.md"))
            .collect::<Vec<_>>());
    });
    assert_eq!(body_json(&many)["field"], "contextIds");
    assert_eq!(body_json(&many)["max"], 16);

    let unknown = review(&|body| body["skillIds"] = json!(["no-such-skill"]));
    let json = body_json(&unknown);
    assert_eq!(
        (&json["code"], &json["skillId"]),
        (&json!("skill-scope"), &json!("no-such-skill"))
    );
    // A whole-post skill asked for a selection.
    let scope = review(&|body| {
        body["skillIds"] = json!(["developmental-review"]);
        body["passage"] = json!({ "kind": "selection", "start": 0, "end": 5 });
    });
    assert_eq!(body_json(&scope)["code"], "skill-scope");
    assert_eq!(body_json(&scope)["skillId"], "developmental-review");

    let gone = review(&|body| body["contextIds"] = json!(["private:author"]));
    let json = body_json(&gone);
    assert_eq!(gone.status, 400);
    assert_eq!(
        (&json["code"], &json["id"]),
        (&json!("context-unavailable"), &json!("private:author"))
    );

    let big = "x".repeat(2 * 1024 * 1024 + 1);
    let huge = review(&|body| body["source"]["markdown"] = json!(big));
    assert_eq!(huge.status, 413);
    assert_eq!(body_json(&huge)["code"], "too-long");
    assert_eq!(body_json(&huge)["field"], "markdown");

    for (field, max) in [("markdown", 100_000), ("prefix", 8_000), ("suffix", 8_000)] {
        let mut body = complete_body();
        body["source"][field] = json!("y".repeat(max + 1));
        let response = post(&f, &session, "assistant/complete", confirmed(body));
        let json = body_json(&response);
        assert_eq!(response.status, 400, "{field}");
        assert_eq!(
            (&json["code"], &json["field"], &json["max"]),
            (&json!("too-long"), &json!(field), &json!(max)),
            "{field}"
        );
    }

    for route in ["quiz/generate", "assistant/code-interaction"] {
        let with = |context: String| {
            post(
                &f,
                &session,
                route,
                confirmed(json!({ "context": context, "count": 1, "kind": "example" })),
            )
        };
        assert_eq!(body_json(&with("  ".into()))["code"], "no-text", "{route}");
        let json = body_json(&with("z".repeat(50_001)));
        assert_eq!(
            (&json["code"], &json["field"], &json["max"]),
            (&json!("too-long"), &json!("context"), &json!(50_000)),
            "{route}"
        );
    }
    let count = post(
        &f,
        &session,
        "quiz/generate",
        json!({ "confirmed": true, "context": "Words.", "count": 4 }),
    );
    assert_eq!(body_json(&count)["code"], "bad-count");
    for language in ["not a language!", "python"] {
        let response = post(
            &f,
            &session,
            "assistant/code-interaction",
            json!({ "confirmed": true, "context": "Words.", "kind": "example", "language": language }),
        );
        assert_eq!(response.status, 400, "{language}");
        assert_eq!(body_json(&response)["code"], "bad-language", "{language}");
    }
}

#[test]
fn status_says_why_in_states_and_names_the_company_never_the_key() {
    let _env = quiz_env();
    let _key = EnvRestore::capture("OPENBLOG_LESSONS_API_KEY");
    let _anthropic = EnvRestore::capture("ANTHROPIC_API_KEY");
    std::env::remove_var("OPENBLOG_LESSONS_API_KEY");
    std::env::remove_var("ANTHROPIC_API_KEY");
    let f = fixture("r8-status");
    let session = login_ok(&f);
    let status = || {
        let response = get(&f, &session, "assistant/status");
        assert!(!String::from_utf8_lossy(&response.body).contains(KEY));
        body_json(&response)
    };
    let configure = |value: Json| {
        let path = f.dir.join("openblog.json");
        let mut config: Json = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        config["knowledgeChecks"] = value;
        fs::write(path, config.to_string()).unwrap();
    };

    configure(json!({ "provider": "custom-https", "generationEndpoint": "", "model": "" }));
    assert_eq!(status()["reason"], "no-endpoint");
    assert_eq!(status()["configured"], false);
    assert_eq!(status()["credential"]["state"], "not-set");
    configure(json!({ "generationEndpoint": "http://plain.example/x", "model": "" }));
    assert_eq!(status()["reason"], "bad-endpoint");
    configure(
        json!({ "generationEndpoint": "https://user:pw@helper.example:8443/v1?api_key=q", "model": "" }),
    );
    let custom = status();
    assert_eq!(custom["reason"], "no-key");
    assert_eq!(custom["company"], "helper.example");
    assert!(!custom.to_string().contains("pw@") && !custom.to_string().contains("api_key"));

    configure(json!({ "provider": "anthropic", "model": "" }));
    assert_eq!(status()["reason"], "no-model");
    assert_eq!(status()["company"], "Anthropic");
    configure(json!({ "provider": "anthropic", "model": "claude-test" }));
    assert_eq!(status()["reason"], "no-key");

    // A key saved for Anthropic, then the company changed without a new key.
    let etag = settings(&f, &session)["etag"].clone();
    let saved = put_settings(
        &f,
        &session,
        local_json_req(
            "PUT",
            "/admin/api/assistant/settings",
            json!({ "provider": "anthropic", "model": "claude-test", "etag": etag, "credentialAction": "replace", "credential": KEY }),
        ),
    );
    assert_eq!(saved.status, 200);
    let ready = status();
    assert_eq!(
        (
            &ready["reason"],
            &ready["credential"]["state"],
            &ready["configured"]
        ),
        (&json!("ready"), &json!("set"), &json!(true))
    );
    configure(json!({ "provider": "open-ai", "model": "gpt-test" }));
    let other = status();
    assert_eq!(other["reason"], "key-other-provider");
    assert_eq!(other["credential"]["state"], "other-provider");
    assert_eq!(other["company"], "OpenAI");
    assert_eq!(other["configured"], false);

    configure(json!({ "provider": "anthropic", "model": "claude-test" }));
    std::env::set_var("ANTHROPIC_API_KEY", "sk-ant-from-the-server-environment");
    let server = status();
    assert_eq!(server["credential"]["state"], "server");
    assert_eq!(server["reason"], "ready");
    assert!(!server.to_string().contains("from-the-server-environment"));
    for (provider, company) in [
        ("gemini", "Google"),
        ("xai", "xAI"),
        ("deep-seek", "DeepSeek"),
        ("mistral", "Mistral"),
        ("open-router", "OpenRouter"),
    ] {
        configure(json!({ "provider": provider, "model": "m" }));
        assert_eq!(status()["company"], company);
    }
}

#[test]
fn the_key_check_makes_one_small_call_with_nothing_of_the_site_in_it() {
    let _env = quiz_env();
    let _key = EnvRestore::capture("OPENBLOG_LESSONS_API_KEY");
    let f = fixture("r8-check");
    fs::write(
        f.dir.join("content/posts/secret-recipe.md"),
        "---\ntitle: The Secret Recipe\ndate: 2026-10-01\n---\nNever-shared filling.\n",
    )
    .unwrap();
    std::env::set_var("OPENBLOG_LESSONS_API_KEY", KEY);
    let request = || {
        json_req(
            "POST",
            "/admin/api/assistant/check",
            json!({ "confirmed": true }),
        )
    };
    assert_eq!(handle(&f.state, &request()).status, 401);
    let session = login_ok(&f);
    assert_eq!(
        handle(&f.state, &authed(request(), &session, false)).status,
        403
    );

    let answer = json!({ "questions": [{ "prompt": "What colour is a clear sky?", "choices": ["Blue", "Green"], "correctIndex": 0, "explanation": "It looks blue." }] });
    let (endpoint, seen, provider) = provider_once(200, "", answer.to_string());
    set_quiz_endpoint(&f, &endpoint);
    let ok = post(
        &f,
        &session,
        "assistant/check",
        json!({ "confirmed": true }),
    );
    provider.join().unwrap();
    assert_eq!(ok.status, 200, "{}", String::from_utf8_lossy(&ok.body));
    let json = body_json(&ok);
    assert_eq!(json["ok"], true);
    assert!(json["checkedAt"]
        .as_str()
        .is_some_and(|at| at.contains('T')));
    assert!(!String::from_utf8_lossy(&ok.body).contains(KEY));
    let sent = seen.recv().unwrap();
    for private in ["Secret Recipe", "Never-shared", "Test Blog", "mikey"] {
        assert!(!sent.contains(private), "the check sent {private}");
    }

    // Asked again straight away: refused before any call is made.
    let soon = post(
        &f,
        &session,
        "assistant/check",
        json!({ "confirmed": true }),
    );
    assert_eq!(soon.status, 429);
    assert_eq!(body_json(&soon)["code"], "too-soon");

    // Another session may ask; a refused key says so by code, and a full server says busy.
    let second = login_ok(&f);
    let (endpoint, _seen, provider) = provider_once(401, "", format!(r#"{{"e":"{KEY}"}}"#));
    set_quiz_endpoint(&f, &endpoint);
    let refused = post(&f, &second, "assistant/check", json!({ "confirmed": true }));
    provider.join().unwrap();
    assert_eq!(refused.status, 502);
    assert_eq!(body_json(&refused)["code"], "key-rejected");
    assert!(!String::from_utf8_lossy(&refused.body).contains(KEY));

    let third = login_ok(&f);
    let _first = f.state.assistant_operations.try_acquire().unwrap();
    let _second = f.state.assistant_operations.try_acquire().unwrap();
    let busy = post(&f, &third, "assistant/check", json!({ "confirmed": true }));
    assert_eq!(busy.status, 429);
    assert_eq!(body_json(&busy)["code"], "concurrency-limit");
}

#[test]
fn the_light_catalog_carries_no_text_and_one_item_is_asked_for_by_id() {
    let f = fixture("r8-light-catalog");
    let session = login_ok(&f);
    fs::create_dir_all(f.dir.join(".openblog/private/context")).unwrap();
    fs::write(
        f.dir.join(".openblog/private/context/author.md"),
        "I bake for my family.\n",
    )
    .unwrap();
    fs::write(
        f.dir.join("content/posts/pie.md"),
        "---\ntitle: Pie\ndate: 2026-10-01\n---\nThe whole pie story.\n",
    )
    .unwrap();

    let full = body_json(&get(&f, &session, "assistant/context"));
    let author = |catalog: &Json| {
        catalog["documents"]
            .as_array()
            .unwrap()
            .iter()
            .find(|d| d["id"] == "private:author")
            .cloned()
            .unwrap()
    };
    assert_eq!(author(&full)["content"], "I bake for my family.\n");

    let light_response = get(&f, &session, "assistant/context?content=none");
    assert_eq!(light_response.status, 200);
    let text = String::from_utf8_lossy(&light_response.body).into_owned();
    assert!(!text.contains("I bake for my family"), "{text}");
    assert!(!text.contains("whole pie story"), "{text}");
    let light = body_json(&light_response);
    let note = author(&light);
    assert!(note.get("content").is_none());
    assert_eq!(note["exists"], true);
    assert_eq!(note["characters"], 22);
    assert!(note["etag"].is_string());
    let snapshot = light["postSnapshots"]
        .as_array()
        .unwrap()
        .iter()
        .find(|post| post["path"] == "posts/pie.md")
        .unwrap();
    assert!(snapshot.get("content").is_none());
    assert_eq!(snapshot["valid"], true);
    assert!(snapshot["characters"].as_u64().unwrap() > 10);
    assert_eq!(
        get(&f, &session, "assistant/context?content=all").status,
        400
    );

    assert_eq!(
        handle(
            &f.state,
            &req("GET", "/admin/api/assistant/context/item?id=private:author")
        )
        .status,
        401
    );
    let item = get(&f, &session, "assistant/context/item?id=private:author");
    assert_eq!(item.status, 200);
    assert_eq!(body_json(&item)["content"], "I bake for my family.\n");
    assert_eq!(body_json(&item)["visibility"], "private");
    let post_item = get(&f, &session, "assistant/context/item?id=post:posts/pie.md");
    assert!(body_json(&post_item)["content"]
        .as_str()
        .unwrap()
        .contains("whole pie story"));
    for bad in [
        "private:site",
        "private:reference:..%2F..%2Fusers.json",
        "nonsense",
        "post:../openblog.json",
        "",
    ] {
        let response = get(&f, &session, &format!("assistant/context/item?id={bad}"));
        assert_eq!(response.status, 400, "{bad}");
        assert!(body_json(&response).get("content").is_none(), "{bad}");
    }
}

#[test]
fn suggestions_as_you_type_wait_twenty_seconds_at_most_and_a_review_names_its_provider() {
    for provider in [
        AssistantProviderKind::Anthropic,
        AssistantProviderKind::OpenAi,
        AssistantProviderKind::CustomHttps,
    ] {
        assert_eq!(
            assistant_completion_timeout(provider, false),
            Duration::from_secs(20)
        );
    }
    assert_eq!(
        assistant_provider_timeout(AssistantProviderKind::Anthropic, false),
        Duration::from_secs(240),
        "a review may still take its time"
    );
    let with = |provider: &str| {
        SiteConfig::from_json(
            &json!({ "title": "T", "knowledgeChecks": { "provider": provider, "model": "m" } })
                .to_string(),
        )
        .unwrap()
    };
    assert_eq!(assistant_provider_type(&with("anthropic")), "anthropic");
    assert_eq!(assistant_provider_type(&with("open-ai")), "open-ai");
    assert_eq!(
        assistant_provider_type(&with("custom-https")),
        "generic-https"
    );
}

#[test]
fn a_key_is_refused_over_plain_http_and_accepted_privately() {
    let _env = quiz_env();
    let _key = EnvRestore::capture("ANTHROPIC_API_KEY");
    std::env::remove_var("ANTHROPIC_API_KEY");
    let f = fixture("r8-insecure");
    let session = login_ok(&f);
    let body = |action: &str| {
        let mut body = json!({ "provider": "anthropic", "model": "claude-test", "etag": settings(&f, &session)["etag"], "credentialAction": action });
        if action == "replace" {
            body["credential"] = json!(KEY);
        }
        body
    };
    let key_file = f.dir.join(ASSISTANT_CREDENTIAL_FILE);
    let refused = |request: Request, why: &str| {
        let response = put_settings(&f, &session, request);
        let text = String::from_utf8_lossy(&response.body).into_owned();
        assert_eq!(response.status, 422, "{why}: {text}");
        assert_eq!(body_json(&response)["code"], "insecure", "{why}");
        assert!(!text.contains(KEY), "{why}");
        assert!(!key_file.exists(), "{why}: nothing was written");
        assert_eq!(
            settings(&f, &session)["provider"],
            "custom-https",
            "{why}: the settings were left alone too"
        );
    };
    let put = |action: &str| json_req("PUT", "/admin/api/assistant/settings", body(action));

    // Straight from another computer: plain http.
    refused(put("replace"), "another computer");
    // A header anyone can send proves nothing without a trusted proxy.
    let mut spoofed = put("replace");
    spoofed
        .headers
        .insert("x-forwarded-proto".into(), "https".into());
    refused(spoofed, "an untrusted peer claiming https");
    // From this computer but through something that forwarded it.
    let mut forwarded = put("replace");
    forwarded.peer = "127.0.0.1".into();
    forwarded
        .headers
        .insert("x-forwarded-for".into(), "203.0.113.9".into());
    refused(forwarded, "a local proxy that isn't trusted");
    let mut named = put("replace");
    named.peer = "127.0.0.1".into();
    named.headers.insert("host".into(), "blog.example".into());
    refused(named, "a local proxy serving a public name");

    // A trusted proxy must say the browser used https.
    let path = f.dir.join("openblog.json");
    let mut config: Json = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
    config["admin"]["trustedProxies"] = json!(["10.0.0.1"]);
    fs::write(&path, config.to_string()).unwrap();
    refused(put("replace"), "a trusted proxy that didn't say https");
    let mut plain = put("replace");
    plain
        .headers
        .insert("x-forwarded-proto".into(), "http".into());
    refused(plain, "a trusted proxy that said http");

    // Keeping or clearing carries no key, so it isn't refused.
    assert_eq!(put_settings(&f, &session, put("keep")).status, 200);

    let mut secure = put("replace");
    secure
        .headers
        .insert("x-forwarded-proto".into(), "https".into());
    let saved = put_settings(&f, &session, secure);
    assert_eq!(
        saved.status,
        200,
        "{}",
        String::from_utf8_lossy(&saved.body)
    );
    assert!(key_file.exists());
    assert_eq!(body_json(&saved)["credential"]["source"], "private");
    assert!(!String::from_utf8_lossy(&saved.body).contains(KEY));
    assert_eq!(put_settings(&f, &session, put("clear")).status, 200);
    assert!(!key_file.exists());

    // And from this computer with nothing in between, with no proxy configured at all.
    config["admin"]["trustedProxies"] = json!([]);
    fs::write(&path, config.to_string()).unwrap();
    for (peer, host) in [
        ("127.0.0.1", "localhost:8080"),
        ("::1", "[::1]:8080"),
        ("127.0.0.1", "127.0.0.1:4173"),
    ] {
        let mut local = put("replace");
        local.peer = peer.into();
        local.headers.insert("host".into(), host.into());
        assert_eq!(
            put_settings(&f, &session, local).status,
            200,
            "{peer} {host}"
        );
    }
}

#[test]
fn the_key_is_write_only_in_every_answer_and_its_changes_are_logged_without_it() {
    let _env = quiz_env();
    let _key = EnvRestore::capture("ANTHROPIC_API_KEY");
    let _lessons = EnvRestore::capture("OPENBLOG_LESSONS_API_KEY");
    std::env::remove_var("ANTHROPIC_API_KEY");
    std::env::remove_var("OPENBLOG_LESSONS_API_KEY");
    KEY_LOG.with(|log| log.borrow_mut().clear());
    let f = fixture("r8-write-only");
    let session = login_ok(&f);
    let mut seen: Vec<(String, Response)> = Vec::new();
    let mut keep = |what: &str, response: Response| -> Json {
        let json = body_json(&response);
        seen.push((what.to_string(), response));
        json
    };
    let put = |etag: &Json, action: &str, credential: Option<&str>, provider: &str| {
        let mut body = json!({ "provider": provider, "model": "claude-test", "etag": etag, "credentialAction": action });
        if let Some(credential) = credential {
            body["credential"] = json!(credential);
        }
        put_settings(
            &f,
            &session,
            local_json_req("PUT", "/admin/api/assistant/settings", body),
        )
    };

    let first = keep("get", get(&f, &session, "assistant/settings"));
    let saved = keep(
        "replace",
        put(&first["etag"], "replace", Some(KEY), "anthropic"),
    );
    assert_eq!(saved["credential"]["source"], "private");
    assert!(saved.get("credentialAction").is_none());
    // Every way an answer could carry it back.
    keep("get after", get(&f, &session, "assistant/settings"));
    keep("status", get(&f, &session, "assistant/status"));
    keep("meta", get(&f, &session, "meta"));
    keep(
        "stale",
        put(&first["etag"], "replace", Some(KEY), "anthropic"),
    );
    keep(
        "bad provider",
        put(&saved["etag"], "replace", Some(KEY), "nobody"),
    );
    keep(
        "bad action",
        put(&saved["etag"], "print", Some(KEY), "anthropic"),
    );
    let huge = format!("{KEY}{}", "k".repeat(17 * 1024));
    keep(
        "too long",
        put(&saved["etag"], "replace", Some(&huge), "anthropic"),
    );
    let mut bad_endpoint = local_json_req(
        "PUT",
        "/admin/api/assistant/settings",
        json!({ "provider": "custom-https", "generationEndpoint": format!("http://{KEY}@plain.example/"), "model": "", "etag": saved["etag"], "credentialAction": "replace", "credential": KEY }),
    );
    bad_endpoint.peer = "127.0.0.1".into();
    keep("bad endpoint", put_settings(&f, &session, bad_endpoint));
    keep(
        "insecure",
        put_settings(
            &f,
            &session,
            json_req(
                "PUT",
                "/admin/api/assistant/settings",
                json!({ "provider": "anthropic", "model": "claude-test", "etag": saved["etag"], "credentialAction": "replace", "credential": KEY }),
            ),
        ),
    );
    keep(
        "not json",
        handle(&f.state, &{
            let mut r = authed(
                local_json_req("PUT", "/admin/api/assistant/settings", json!({})),
                &session,
                true,
            );
            r.body = format!("{{\"credential\": \"{KEY}\"").into_bytes();
            r
        }),
    );
    // A helper call that fails for want of a model still says nothing of the key.
    let other = "sk-ant-r8-SECOND-key-fedcba9876543210";
    let again = keep(
        "replace again",
        put(&saved["etag"], "replace", Some(other), "anthropic"),
    );
    keep("keep", put(&again["etag"], "keep", None, "anthropic"));
    let now = settings(&f, &session);
    let cleared = keep("clear", put(&now["etag"], "clear", None, "anthropic"));
    assert_eq!(cleared["credential"]["configured"], false);
    // Clearing when nothing is saved changes nothing and logs nothing.
    keep(
        "clear nothing",
        put(&cleared["etag"], "clear", None, "anthropic"),
    );

    for (what, response) in &seen {
        let text = String::from_utf8_lossy(&response.body);
        assert!(
            !text.contains(KEY) && !text.contains(other) && !text.contains("KNOWN-key"),
            "{what}: {text}"
        );
        for (name, value) in &response.headers {
            assert!(
                !value.contains(KEY) && !value.contains(other),
                "{what}: {name}"
            );
        }
    }
    let statuses: Vec<(String, u16)> = seen
        .iter()
        .map(|(what, response)| (what.clone(), response.status))
        .collect();
    for (what, status) in [
        ("stale", 409),
        ("bad provider", 422),
        ("bad action", 422),
        ("too long", 422),
        ("bad endpoint", 422),
        ("insecure", 422),
        ("not json", 400),
    ] {
        assert!(
            statuses.contains(&(what.to_string(), status)),
            "{what}: {statuses:?}"
        );
    }

    let log = key_log();
    assert_eq!(
        log,
        vec![
            "admin: assistant key replaced by 'mikey' (anthropic)".to_string(),
            "admin: assistant key replaced by 'mikey' (anthropic)".to_string(),
            "admin: assistant key removed by 'mikey' (anthropic)".to_string(),
        ]
    );
    for line in &log {
        assert!(
            !line.contains(KEY)
                && !line.contains(other)
                && !line.contains("sk-ant")
                && !line.contains(&KEY.len().to_string()),
            "{line}"
        );
    }
    // The key is kept outside the content folder and out of the site's settings file.
    assert!(!fs::read_to_string(f.dir.join("openblog.json"))
        .unwrap()
        .contains("sk-ant"));
}

#[test]
fn the_admin_and_studio_pages_no_longer_allow_wasm_or_frame_codepen() {
    let f = fixture("r8-csp");
    for path in ["/admin", "/admin/", "/admin/studio/", "/admin/api/meta"] {
        let response = handle(&f.state, &req("GET", path));
        let csp = response
            .headers
            .iter()
            .find(|(name, _)| name == "Content-Security-Policy")
            .unwrap_or_else(|| panic!("{path} has no policy"))
            .1
            .clone();
        assert!(!csp.contains("wasm-unsafe-eval"), "{path}: {csp}");
        assert!(!csp.contains("codepen"), "{path}: {csp}");
        assert!(!csp.contains("unsafe"), "{path}: {csp}");
        assert_eq!(
            csp,
            "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https: blob:; media-src 'self' blob:; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
            "{path}"
        );
    }
}

/// S1: the handlers that reach the helper's provider, found by reading the server's own source: a
/// function that builds the provider (`configured_assistant_provider(`) or hands a recording to a
/// transcriber (`transcriber.transcribe(`). Each must ask for the author's word
/// (`provider_confirmed`) before that line. A new handler that calls a provider without asking
/// fails here, and so does one this list doesn't know about.
#[test]
fn every_handler_that_calls_a_provider_asks_for_the_authors_word_first() {
    let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut files = vec![src.join("admin.rs")];
    for entry in fs::read_dir(src.join("admin")).unwrap() {
        let path = entry.unwrap().path();
        if path.extension().is_some_and(|extension| extension == "rs") {
            files.push(path);
        }
    }
    let mut found = Vec::new();
    for file in files {
        let text = fs::read_to_string(&file).unwrap();
        // The tests of admin.rs build providers of their own.
        let text = text.split("\nmod tests {").next().unwrap();
        let starts = |line: &str| {
            ["fn ", "pub fn ", "pub(super) fn ", "pub(crate) fn "]
                .iter()
                .find_map(|prefix| line.strip_prefix(prefix))
                .map(|rest| {
                    rest.split(|c: char| !(c.is_alphanumeric() || c == '_'))
                        .next()
                        .unwrap()
                        .to_string()
                })
        };
        let mut name = String::new();
        let mut body = String::new();
        let mut functions = Vec::new();
        for line in text.lines() {
            if let Some(next) = starts(line) {
                functions.push((
                    std::mem::replace(&mut name, next),
                    std::mem::take(&mut body),
                ));
            }
            body.push_str(line);
            body.push('\n');
        }
        functions.push((name, body));
        for (name, body) in functions {
            // Skip the declaration line: the function that builds a provider is not a caller.
            let inside = body.split_once('\n').map_or("", |(_, rest)| rest);
            let call = ["configured_assistant_provider(", "transcriber.transcribe("]
                .iter()
                .filter_map(|marker| inside.find(marker))
                .min();
            let Some(call) = call else { continue };
            let asked = inside.find("provider_confirmed");
            assert!(
                asked.is_some_and(|asked| asked < call),
                "{name} in {} calls a provider without `provider_confirmed` before it",
                file.display()
            );
            found.push(name);
        }
    }
    found.sort();
    assert_eq!(
        found,
        [
            "check_assistant_provider",
            "draft",
            "generate_code_interaction",
            "generate_document_review",
            "generate_inline_completion",
            "generate_quiz",
            "generate_voice_guide",
            "job_draft",
            "spoken",
            "transcribe",
        ],
        "the handlers that call a provider; a new one belongs in the route list of the next test"
    );
}

/// S1: every one of those routes, asked without `confirmed: true`, answers 400 `not-confirmed`
/// before it reads anything else, with a helper that is set up and would otherwise be called.
#[test]
fn every_provider_route_refuses_a_request_that_does_not_say_confirmed() {
    let _env = quiz_env();
    let _key = EnvRestore::capture("OPENBLOG_LESSONS_API_KEY");
    let f = fixture("s1-not-confirmed");
    let session = login_ok(&f);
    std::env::set_var("OPENBLOG_LESSONS_API_KEY", KEY);
    // An address nothing answers at: a request that got past the check would fail another way.
    set_quiz_endpoint(&f, "https://assistant.invalid/generate");
    let mut review = review_body();
    let mut complete = complete_body();
    review.as_object_mut().unwrap().remove("confirmed");
    complete.as_object_mut().unwrap().remove("confirmed");
    let routes: [(&str, Json); 9] = [
        ("assistant/check", json!({})),
        ("assistant/review", review),
        ("assistant/complete", complete),
        (
            "quiz/generate",
            json!({ "context": "A short section.", "count": 1 }),
        ),
        (
            "assistant/code-interaction",
            json!({ "context": "A short section.", "kind": "example" }),
        ),
        ("assistant/job-draft", json!({ "notes": "leak fixed" })),
        ("assistant/voice-guide", json!({ "sampleIds": [] })),
        ("assistant/transcribe", json!({ "captureId": "x" })),
        ("theme-draft", json!({ "description": "warm and plain" })),
    ];
    for (route, body) in routes {
        for said in [
            None,
            Some(json!(false)),
            Some(json!("true")),
            Some(json!(1)),
        ] {
            let mut body = body.clone();
            if let Some(said) = &said {
                body["confirmed"] = said.clone();
            }
            let response = post(&f, &session, route, body);
            assert_eq!(response.status, 400, "{route} {said:?}");
            assert_eq!(
                body_json(&response)["code"],
                "not-confirmed",
                "{route} {said:?}"
            );
        }
    }
    // A recording is the whole body, so its word rides in the address.
    for query in ["", "&confirmed=false", "&confirmed=1"] {
        let mut spoken = authed(
            req(
                "POST",
                &format!("/admin/api/voice/spoken?promptId=a-meal-you-love{query}"),
            ),
            &session,
            true,
        );
        spoken
            .headers
            .insert("content-type".into(), "audio/webm".into());
        spoken.body = vec![0x1A, 0x45, 0xDF, 0xA3, 0, 0, 0, 0];
        let response = handle(&f.state, &spoken);
        assert_eq!(response.status, 400, "voice/spoken {query}");
        assert_eq!(
            body_json(&response)["code"],
            "not-confirmed",
            "voice/spoken {query}"
        );
    }
}

/// S2: whatever a page sends, a hidden place never reaches the provider, and a shown one may.
#[test]
fn a_hidden_place_is_taken_out_of_the_details_before_a_provider_sees_them() {
    let trip = |privacy: Json| {
        let mut fields = json!({
            "profile": "field-journal", "activity": "Hike", "conditions": "Wet",
            "location": "PLACE-MARK", "distanceKm": "12.4", "elevationGainM": "640",
            "duration": "PT4H10M", "tags": ["hike"],
            "trackToken": "tok", "captureId": "cap", "route": "media/r.gpx",
            "routeShape": "0,0 1,1", "elevationProfile": "1,2,3",
        });
        if !privacy.is_null() {
            fields["locationPrivacy"] = privacy;
        }
        fields
    };
    for hidden in [
        Json::Null,
        json!("hidden"),
        json!(""),
        json!("nonsense"),
        json!(3),
    ] {
        let sent = metadata_without_hidden_place(trip(hidden.clone()));
        assert_eq!(
            sent,
            json!({ "profile": "field-journal", "activity": "Hike", "conditions": "Wet", "tags": ["hike"] }),
            "{hidden}"
        );
    }
    for shown in ["trimmed", "approximate", "exact", " Exact "] {
        let sent = metadata_without_hidden_place(trip(json!(shown)));
        let mut keys: Vec<&str> = sent
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        keys.sort_unstable();
        assert_eq!(
            keys,
            [
                "activity",
                "conditions",
                "distanceKm",
                "duration",
                "elevationGainM",
                "location",
                "locationPrivacy",
                "profile",
                "tags"
            ],
            "{shown}: the route's own file and shape never go"
        );
    }
    // A video's length is its own.
    assert_eq!(
        metadata_without_hidden_place(
            json!({ "profile": "video", "duration": "PT4M", "location": "x" })
        ),
        json!({ "profile": "video", "duration": "PT4M" })
    );
}

/// S2, end to end: a review of a trip whose place is hidden sends the provider nothing of it.
#[test]
fn a_review_of_a_trip_with_a_hidden_place_sends_nothing_about_the_place() {
    let _env = quiz_env();
    let _key = EnvRestore::capture("OPENBLOG_LESSONS_API_KEY");
    let f = fixture("s2-hidden-place");
    let session = login_ok(&f);
    std::env::set_var("OPENBLOG_LESSONS_API_KEY", KEY);
    let (endpoint, seen, provider) = provider_once(200, "", r#"{"findings":[]}"#.to_string());
    set_quiz_endpoint(&f, &endpoint);
    let mut body = review_body();
    body["source"]["metadata"] = json!({
        "profile": "field-journal", "location": "PLACE-MARK-7731", "distanceKm": "12.4731",
        "elevationGainM": "64077", "duration": "PT4H10M", "routeShape": "SHAPE-MARK", "locationPrivacy": "hidden",
    });
    let _ = post(&f, &session, "assistant/review", body);
    provider.join().unwrap();
    let sent = seen.recv().unwrap();
    assert!(
        sent.contains("alot of butter"),
        "the post itself went: {sent}"
    );
    for place in [
        "PLACE-MARK-7731",
        "12.4731",
        "64077",
        "PT4H10M",
        "SHAPE-MARK",
        "locationPrivacy",
    ] {
        assert!(!sent.contains(place), "{place} reached the provider");
    }
}

/// S3: "from this same computer with nothing in between" is taken as private only while nothing
/// says the server is deployed. A proxy on the same computer that isn't listed, and that strips
/// the forwarded headers and rewrites `Host`, looks exactly like a person at the keyboard; so once
/// the server knows it is deployed, that look is not enough.
#[test]
fn a_request_from_this_computer_is_not_private_once_the_server_knows_it_is_deployed() {
    let _env = quiz_env();
    let _key = EnvRestore::capture("ANTHROPIC_API_KEY");
    std::env::remove_var("ANTHROPIC_API_KEY");
    let mut f = fixture("s3-deployed");
    let config_path = f.dir.join("openblog.json");
    let original = fs::read_to_string(&config_path).unwrap();
    let key_file = f.dir.join(ASSISTANT_CREDENTIAL_FILE);
    let replace = |f: &Fixture, session: &(String, String)| {
        let body = json!({ "provider": "anthropic", "model": "claude-test", "etag": settings(f, session)["etag"], "credentialAction": "replace", "credential": KEY });
        put_settings(
            f,
            session,
            local_json_req("PUT", "/admin/api/assistant/settings", body),
        )
    };
    let refused = |f: &Fixture, session: &(String, String), why: &str| {
        let response = replace(f, session);
        let text = String::from_utf8_lossy(&response.body).into_owned();
        assert_eq!(response.status, 422, "{why}: {text}");
        assert_eq!(body_json(&response)["code"], "insecure", "{why}");
        assert!(!text.contains(KEY), "{why}");
        assert!(!key_file.exists(), "{why}: nothing was written");
    };

    // What the site's own settings say.
    let session = login_ok(&f);
    for (why, change) in [
        (
            "a proxy is listed, and this request didn't come through it",
            json!({ "trustedProxies": ["10.9.9.9"] }),
        ),
        (
            "the Admin is said to be served over https",
            json!({ "secureCookies": true }),
        ),
    ] {
        let mut config: Json = serde_json::from_str(&original).unwrap();
        for (key, value) in change.as_object().unwrap() {
            config["admin"][key] = value.clone();
        }
        fs::write(&config_path, config.to_string()).unwrap();
        refused(&f, &session, why);
    }
    fs::write(&config_path, &original).unwrap();

    // What the server knows about where it runs.
    type Signal = (&'static str, fn(&mut AppState));
    let signals: [Signal; 3] = [
        ("it listens beyond this computer", |state| {
            state.listens_beyond_this_computer = true
        }),
        ("a host's own variable is set", |state| {
            state.hosted_env = true
        }),
        (
            "the host chose the port and the site has a public address",
            |state| state.port_env = true,
        ),
    ];
    for (why, set) in signals {
        let mut state = AppState::new(f.dir.clone(), None, false, true);
        set(&mut state);
        f.state = Arc::new(state);
        f.state.rebuild().unwrap();
        let session = login_ok(&f);
        if why.starts_with("the host chose the port") {
            // With no public address the port alone says nothing (a developer's own PORT).
            let mut config: Json = serde_json::from_str(&original).unwrap();
            config["url"] = json!("http://localhost:8080");
            fs::write(&config_path, config.to_string()).unwrap();
            assert_eq!(
                replace(&f, &session).status,
                200,
                "a port and a local address"
            );
            fs::remove_file(&key_file).unwrap();
            config["url"] = json!("https://blog.example");
            fs::write(&config_path, config.to_string()).unwrap();
        }
        refused(&f, &session, why);
        // Deployed, the way in is the listed proxy saying https.
        let mut config: Json =
            serde_json::from_str(&fs::read_to_string(&config_path).unwrap()).unwrap();
        config["admin"]["trustedProxies"] = json!(["127.0.0.1"]);
        fs::write(&config_path, config.to_string()).unwrap();
        refused(&f, &session, "the listed proxy didn't say https");
        let body = json!({ "provider": "anthropic", "model": "claude-test", "etag": settings(&f, &session)["etag"], "credentialAction": "replace", "credential": KEY });
        let mut through = local_json_req("PUT", "/admin/api/assistant/settings", body);
        through
            .headers
            .insert("x-forwarded-proto".into(), "https".into());
        assert_eq!(put_settings(&f, &session, through).status, 200, "{why}");
        fs::remove_file(&key_file).unwrap();
        fs::write(&config_path, &original).unwrap();
    }

    // Nothing says deployed: a person at this computer may set the key, as before.
    f.state = Arc::new(AppState::new(f.dir.clone(), None, false, true));
    f.state.rebuild().unwrap();
    let session = login_ok(&f);
    assert_eq!(replace(&f, &session).status, 200);
    assert!(key_file.exists());
}

/// S3 (N8): the same rule on every route that accepts a secret. The readers' service token and a
/// social account's app password are refused over plain http, before anything is read or written.
#[test]
fn every_route_that_accepts_a_secret_refuses_it_over_plain_http() {
    let f = fixture("s3-secrets");
    let session = login_ok(&f);
    let config_path = f.dir.join(site::CONFIG_FILE);
    let before = fs::read_to_string(&config_path).unwrap();
    let etag = body_json(&handle(
        &f.state,
        &authed(
            req("GET", "/admin/api/engagement/settings"),
            &session,
            false,
        ),
    ))["etag"]
        .clone();
    let engagement = |action: &str| {
        let mut body = json!({ "enabled": true, "comments": true, "analytics": true, "endpoint": "https://blog.example/api", "etag": etag, "credentialAction": action });
        if action == "replace" {
            body["credential"] = json!("SECRET-MARK-5512");
        }
        body
    };
    let insecure = |request: Request, why: &str| {
        let response = handle(&f.state, &authed(request, &session, true));
        let text = String::from_utf8_lossy(&response.body).into_owned();
        assert_eq!(response.status, 422, "{why}: {text}");
        assert_eq!(body_json(&response)["code"], "insecure", "{why}");
        assert!(!text.contains("SECRET-MARK-5512"), "{why}");
    };
    insecure(
        json_req(
            "PUT",
            "/admin/api/engagement/settings",
            engagement("replace"),
        ),
        "the readers' service token from another computer",
    );
    let mut spoofed = json_req(
        "PUT",
        "/admin/api/engagement/settings",
        engagement("replace"),
    );
    spoofed
        .headers
        .insert("x-forwarded-proto".into(), "https".into());
    insecure(spoofed, "an untrusted peer claiming https");
    assert_eq!(
        fs::read_to_string(&config_path).unwrap(),
        before,
        "nothing was written"
    );
    for path in [
        "/admin/api/social/connections",
        "/admin/api/social/accounts/11111111-1111-4111-8111-111111111111/reconnect",
    ] {
        insecure(
            json_req(
                "POST",
                path,
                json!({ "provider": "bluesky", "identifier": "me.example", "appPassword": "SECRET-MARK-5512" }),
            ),
            path,
        );
        // With no password in it there is no secret to refuse.
        let plain = handle(
            &f.state,
            &authed(
                json_req("POST", path, json!({ "provider": "linkedin" })),
                &session,
                true,
            ),
        );
        assert_ne!(body_json(&plain)["code"], "insecure", "{path}");
    }
    // Saving without a token, and a token from this computer, go through.
    let kept = handle(
        &f.state,
        &authed(
            json_req("PUT", "/admin/api/engagement/settings", engagement("keep")),
            &session,
            true,
        ),
    );
    assert_ne!(body_json(&kept)["code"], "insecure");
    let etag = body_json(&handle(
        &f.state,
        &authed(
            req("GET", "/admin/api/engagement/settings"),
            &session,
            false,
        ),
    ))["etag"]
        .clone();
    let mut body = engagement("replace");
    body["etag"] = etag;
    let local = handle(
        &f.state,
        &authed(
            local_json_req("PUT", "/admin/api/engagement/settings", body),
            &session,
            true,
        ),
    );
    assert_eq!(
        local.status,
        200,
        "{}",
        String::from_utf8_lossy(&local.body)
    );
}

/// S3: which of a host's own variables say the server runs on its platform.
#[test]
fn a_hosts_own_variable_says_the_server_is_deployed() {
    let with = |name: &'static str, value: &'static str| {
        hosted_env_given(move |asked| (asked == name).then(|| value.to_string()))
    };
    assert!(!hosted_env_given(|_| None));
    for name in [
        "RAILWAY_ENVIRONMENT",
        "RAILWAY_PROJECT_ID",
        "RAILWAY_SERVICE_ID",
        "RAILWAY_STATIC_URL",
        "RAILWAY_PUBLIC_DOMAIN",
        "FLY_APP_NAME",
        "DYNO",
        "K_SERVICE",
    ] {
        assert!(with(name, "x"), "{name}");
        assert!(!with(name, "  "), "{name} set to nothing");
    }
    assert!(with("RENDER", "true"));
    assert!(!with("RENDER", "false"));
    assert!(!with("HOME", "/root"));
    for (host, own) in [
        ("localhost", true),
        ("127.0.0.1", true),
        ("[::1]", true),
        ("LOCALHOST", true),
        ("blog.example", false),
        ("0.0.0.0", false),
        ("10.0.0.4", false),
    ] {
        assert_eq!(names_this_computer(host), own, "{host}");
    }
}
