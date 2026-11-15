//! Getting started (Studio R9b, G70 to G80): the switch and its precedence as the routes see
//! them, each account's private record, the practice run that keeps nothing real, the reminder,
//! reset, stories told out loud (the recording is never kept), throwing one piece away, and who
//! wrote a piece. Providers are loopback fakes or a local command; no test reaches a network.

use super::*;
use crate::assistant::transcribe::{set_test_endpoint, LOCAL_COMMAND_LOCK};
use crate::onboarding as core;

const STORY: &str = "well my mother always made the gravy first STORY-MARK-4410";

/// A site with two accounts, the server's switch as given (`None` is unset), and
/// `studio.onboarding` in its file as given (`None` removes it).
fn fixture_with(tag: &str, environment: Option<&str>, config: Option<Json>) -> Fixture {
    let dir =
        std::env::temp_dir().join(format!("ob-onboarding-routes-{tag}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    scaffold::init(&dir, Some("Test Blog"), false).unwrap();
    let mut users = Users::default();
    users.set("mikey", "correct horse battery").unwrap();
    users.set("grammi", "a long enough password").unwrap();
    users.save(&dir.join(".openblog/users.json")).unwrap();
    let path = dir.join("openblog.json");
    let mut file: Json = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
    match config {
        Some(value) => file["studio"] = json!({ "onboarding": value }),
        None => {
            file.as_object_mut().unwrap().remove("studio");
        }
    }
    fs::write(&path, serde_json::to_string_pretty(&file).unwrap()).unwrap();
    let mut state = AppState::new(dir.clone(), None, false, true);
    state.onboarding_env = environment.map(str::to_string);
    let state = Arc::new(state);
    state.rebuild().unwrap();
    Fixture { state, dir }
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

fn grammi(f: &Fixture) -> (String, String) {
    login_as(f, "grammi", "a long enough password")
}

fn files_under(dir: &Path) -> Vec<String> {
    let mut found: Vec<String> = fsutil::walk(dir)
        .into_iter()
        .map(|path| fsutil::relative(dir, &path))
        .collect();
    found.sort();
    found
}

fn real_voice_files(f: &Fixture) -> Vec<String> {
    let mut all = files_under(&f.dir.join(".openblog/private/context/voice"));
    all.extend(files_under(&f.dir.join("assistant/context/voice")));
    all
}

fn wav(seconds: u32) -> Vec<u8> {
    let rate: u32 = 8000;
    let data = vec![0u8; (rate * seconds) as usize];
    let mut out = Vec::new();
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data.len() as u32).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&rate.to_le_bytes());
    out.extend_from_slice(&rate.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&8u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&(data.len() as u32).to_le_bytes());
    out.extend_from_slice(&data);
    out
}

const AUDIO_MARK: &[u8] = b"AUDIO-BYTES-MARK-9917";

fn webm() -> Vec<u8> {
    [&[0x1A, 0x45, 0xDF, 0xA3][..], AUDIO_MARK, &[0u8; 64]].concat()
}

fn speak(f: &Fixture, s: &(String, String), query: &str, audio: Vec<u8>) -> Response {
    let mut r = authed(
        req("POST", &format!("/admin/api/voice/spoken?{query}")),
        s,
        true,
    );
    r.headers.insert("content-type".into(), "audio/webm".into());
    r.body = audio;
    handle(&f.state, &r)
}

fn temp_audio(f: &Fixture) -> Vec<String> {
    files_under(&f.dir.join(".openblog/private/onboarding/tmp"))
}

/// A loopback stand-in for a company's audio endpoint: answers once.
fn fake_hearing(status: u16, body: &str) -> (String, std::thread::JoinHandle<Vec<u8>>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let endpoint = format!(
        "http://{}/v1/audio/transcriptions",
        listener.local_addr().unwrap()
    );
    let body = body.to_string();
    let handle = std::thread::spawn(move || {
        let mut stream = accept_provider_call(&listener);
        stream.set_read_timeout(Some(Duration::from_secs(10))).ok();
        let mut request = Vec::new();
        let mut chunk = [0u8; 8192];
        loop {
            let read = stream.read(&mut chunk).unwrap_or(0);
            if read == 0 {
                break;
            }
            request.extend_from_slice(&chunk[..read]);
            if let Some(end) = request.windows(4).position(|part| part == b"\r\n\r\n") {
                let headers = String::from_utf8_lossy(&request[..end]).to_lowercase();
                let length = headers
                    .lines()
                    .find_map(|line| {
                        line.strip_prefix("content-length:")?
                            .trim()
                            .parse::<usize>()
                            .ok()
                    })
                    .unwrap_or(0);
                if request.len() >= end + 4 + length {
                    break;
                }
            }
        }
        let response = format!(
            "HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        stream.write_all(response.as_bytes()).unwrap();
        request
    });
    (endpoint, handle)
}

fn use_anthropic(f: &Fixture) {
    let path = f.dir.join("openblog.json");
    let mut config: Json = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
    config["knowledgeChecks"] = json!({ "provider": "anthropic", "model": "claude-test" });
    fs::write(path, config.to_string()).unwrap();
}

// ---------------------------------------------------------------------------
// The switch (G70)
// ---------------------------------------------------------------------------

/// (the server's variable, the site's file, mode, due, practice, source, problems)
type SwitchCase = (
    Option<&'static str>,
    Option<Json>,
    &'static str,
    bool,
    bool,
    &'static str,
    usize,
);

#[test]
fn every_value_of_the_switch_as_meta_and_the_accounts_route_say_it() {
    // (the server's variable, the site's file) → (mode, due on first sign-in, practice, source, problems)
    let table: &[SwitchCase] = &[
        (None, None, "off", false, false, "none", 0),
        (None, Some(json!("off")), "off", false, false, "config", 0),
        (None, Some(json!("on")), "on", true, false, "config", 0),
        (
            Some("off"),
            Some(json!("on")),
            "off",
            false,
            false,
            "environment",
            0,
        ),
        (
            Some("on"),
            Some(json!("off")),
            "on",
            true,
            false,
            "environment",
            0,
        ),
        (Some("on"), None, "on", true, false, "environment", 0),
        (
            Some("on:2026-11-20"),
            Some(json!("off")),
            "on",
            true,
            false,
            "environment",
            0,
        ),
        (
            Some("rehearse"),
            Some(json!("off")),
            "rehearse",
            true,
            true,
            "environment",
            0,
        ),
        (
            Some("rehearse"),
            Some(json!("on")),
            "rehearse",
            true,
            true,
            "environment",
            0,
        ),
        // A value that can't be used is off, with one problem, and never falls through.
        (
            Some("ON"),
            Some(json!("on")),
            "off",
            false,
            false,
            "environment",
            1,
        ),
        (
            Some("on:"),
            Some(json!("on")),
            "off",
            false,
            false,
            "environment",
            1,
        ),
        (Some("on:x y"), None, "off", false, false, "environment", 1),
        (
            None,
            Some(json!("rehearse")),
            "off",
            false,
            false,
            "config",
            1,
        ),
        (None, Some(json!("on:2")), "off", false, false, "config", 1),
        (None, Some(json!(true)), "off", false, false, "config", 1),
        // Set to nothing is unset: the site's file decides.
        (Some(""), Some(json!("on")), "on", true, false, "config", 0),
    ];
    for (index, (environment, config, mode, due, practice, source, problems)) in
        table.iter().enumerate()
    {
        let f = fixture_with(&format!("switch-{index}"), *environment, config.clone());
        let s = login_ok(&f);
        let label = format!("{environment:?} with {config:?}");
        let (status, meta) = get(&f, &s, "meta");
        assert_eq!(status, 200, "{label}");
        let onboarding = &meta["onboarding"];
        assert_eq!(onboarding["mode"], *mode, "{label}");
        assert_eq!(onboarding["due"], *due, "{label}");
        assert_eq!(onboarding["practice"], *practice, "{label}");
        // Nothing but the six: no user names, no stories, no value of the variable.
        let mut keys: Vec<&String> = onboarding.as_object().unwrap().keys().collect();
        keys.sort();
        assert_eq!(
            keys,
            ["due", "mode", "practice", "resume", "step", "total"],
            "{label}"
        );
        let (_, accounts) = get(&f, &s, "onboarding/accounts");
        assert_eq!(accounts["mode"], *mode, "{label}");
        assert_eq!(accounts["source"], *source, "{label}");
        assert_eq!(
            accounts["problems"].as_array().unwrap().len(),
            *problems,
            "{label}"
        );
        let (_, own) = get(&f, &s, "onboarding");
        assert_eq!(own["due"], *due, "{label}");
        assert_eq!(own["record"], Json::Null, "{label}");
    }
}

#[test]
fn a_round_shows_it_again_once_to_an_account_that_finished_another_round() {
    let f = fixture_with("round", Some("on"), None);
    let s = grammi(&f);
    let (status, started) = send(
        &f,
        &s,
        "PUT",
        "onboarding",
        json!({ "etag": "", "step": "stories" }),
    );
    assert_eq!(status, 200, "{started}");
    assert_eq!(started["record"]["round"], "1");
    let (_, done) = send(
        &f,
        &s,
        "PUT",
        "onboarding",
        json!({ "etag": started["etag"], "status": "done" }),
    );
    assert_eq!(done["record"]["status"], "done");
    assert_eq!(done["due"], false);
    assert_eq!(
        get(&f, &s, "meta").1["onboarding"]["due"],
        false,
        "done: it doesn't show again"
    );
    drop(f.state.clone());

    // The same site, the server now says on:2: due again, as a new run; her finished record stays
    // until the new run's first save.
    let mut state = AppState::new(f.dir.clone(), None, false, true);
    state.onboarding_env = Some("on:2".into());
    let again = Fixture {
        state: Arc::new(state),
        dir: f.dir.clone(),
    };
    let s2 = grammi(&again);
    let (_, own) = get(&again, &s2, "onboarding");
    assert_eq!(
        (
            own["due"].clone(),
            own["record"].clone(),
            own["etag"].clone()
        ),
        (json!(true), Json::Null, json!(""))
    );
    let (_, fresh) = send(
        &again,
        &s2,
        "PUT",
        "onboarding",
        json!({ "etag": "", "status": "skipped" }),
    );
    assert_eq!(fresh["record"]["round"], "2");
    assert_eq!(get(&again, &s2, "meta").1["onboarding"]["due"], false);
    std::mem::forget(again); // `f` removes the folder
}

// ---------------------------------------------------------------------------
// The record (G71)
// ---------------------------------------------------------------------------

#[test]
fn the_record_is_private_per_account_revision_checked_and_takes_only_real_steps() {
    let f = fixture_with("record", Some("on"), None);
    let s = grammi(&f);
    let other = login_ok(&f);
    // Signed in, with the CSRF token.
    assert_eq!(
        handle(&f.state, &req("GET", "/admin/api/onboarding")).status,
        401
    );
    let bare = authed(
        json_req("PUT", "/admin/api/onboarding", json!({ "etag": "" })),
        &s,
        false,
    );
    assert_eq!(handle(&f.state, &bare).status, 403);

    let (status, first) = send(
        &f,
        &s,
        "PUT",
        "onboarding",
        json!({ "etag": "", "lastAutoOpen": true }),
    );
    assert_eq!(status, 200, "{first}");
    let record = &first["record"];
    // No key on this site: three steps, starting with the helper's key.
    assert_eq!(
        (record["step"].clone(), record["total"].clone()),
        (json!("helper"), json!(3))
    );
    assert_eq!(record["status"], "in-progress");
    assert!(record["startedAt"].as_str().unwrap().starts_with("20"));
    assert!(
        record["lastAutoOpen"].is_string(),
        "the server's time, not the phone's"
    );
    assert_eq!(
        get(&f, &other, "onboarding").1["record"],
        Json::Null,
        "another account's is its own"
    );

    // One file, named by a hash, 0600, and nothing left beside it.
    let folder = f.dir.join(core::RECORDS_DIR);
    let names: Vec<String> = fs::read_dir(&folder)
        .unwrap()
        .flatten()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    assert_eq!(names.len(), 1, "{names:?}");
    assert!(names[0].len() == 69 && !names[0].contains("grammi"));
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        assert_eq!(
            fs::metadata(folder.join(&names[0]))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
    }

    // Another phone that got there first: stale, with the newer record, and nothing written.
    let (status, stale) = send(
        &f,
        &s,
        "PUT",
        "onboarding",
        json!({ "etag": "old", "step": "voice" }),
    );
    assert_eq!((status, stale["code"].as_str()), (409, Some("stale")));
    assert_eq!(stale["record"]["step"], "helper");
    assert_eq!(stale["etag"], first["etag"]);

    for bad in [
        json!({ "step": "billing" }),
        json!({ "steps": { "helper": "maybe" } }),
        json!({ "steps": { "payment": "done" } }),
        json!({ "stories": ["../../etc/passwd"] }),
        json!({ "stories": "all of them" }),
        json!({ "status": "finished" }),
        json!({ "total": 9 }),
    ] {
        let mut body = bad.clone();
        body["etag"] = first["etag"].clone();
        let (status, answer) = send(&f, &s, "PUT", "onboarding", body);
        assert_eq!(
            (status, answer["code"].as_str()),
            (422, Some("bad-step")),
            "{bad}"
        );
    }
    assert_eq!(
        get(&f, &s, "onboarding").1["etag"],
        first["etag"],
        "a refusal writes nothing"
    );

    let (_, moved) = send(
        &f,
        &s,
        "PUT",
        "onboarding",
        json!({ "etag": first["etag"], "step": "stories", "steps": { "helper": "skipped" }, "stories": ["2026-11-20-a-meal-you-love-rough"] }),
    );
    assert_eq!(moved["record"]["steps"]["helper"], "skipped");
    assert_eq!(
        moved["record"]["stories"],
        json!(["2026-11-20-a-meal-you-love-rough"])
    );
    assert_eq!(
        moved["record"]["total"], 3,
        "the total is fixed when the run starts"
    );
    let (_, meta) = get(&f, &s, "meta");
    assert_eq!(
        meta["onboarding"],
        json!({ "mode": "on", "practice": false, "due": true, "step": "stories", "total": 3, "resume": true })
    );

    // Finished: it stops showing, and only starting again changes it.
    let (_, done) = send(
        &f,
        &s,
        "PUT",
        "onboarding",
        json!({ "etag": moved["etag"], "status": "done" }),
    );
    assert_eq!(
        (
            done["record"]["status"].clone(),
            done["record"]["step"].clone()
        ),
        (json!("done"), json!("done"))
    );
    assert!(done["record"]["finishedAt"].is_string());
    let (status, _) = send(
        &f,
        &s,
        "PUT",
        "onboarding",
        json!({ "etag": done["etag"], "step": "stories" }),
    );
    assert_eq!(status, 422);
    let (_, again) = send(
        &f,
        &s,
        "PUT",
        "onboarding",
        json!({ "etag": done["etag"], "restart": true }),
    );
    assert_eq!(
        (
            again["record"]["status"].clone(),
            again["record"]["round"].clone()
        ),
        (json!("in-progress"), json!("1"))
    );
    assert_eq!(again["record"]["stories"], json!([]));

    // Asking for practice on a server that isn't rehearsing is refused.
    let (status, refused) = send(
        &f,
        &s,
        "PUT",
        "onboarding",
        json!({ "etag": again["etag"], "practice": true, "step": "voice" }),
    );
    assert_eq!(
        (status, refused["code"].as_str()),
        (409, Some("practice-only"))
    );
}

#[test]
fn with_a_key_in_place_there_are_two_steps_and_the_key_step_is_never_named() {
    let _env = quiz_env();
    let _key = EnvRestore::capture("ANTHROPIC_API_KEY");
    let f = fixture_with("two-steps", Some("on"), None);
    use_anthropic(&f);
    std::env::set_var("ANTHROPIC_API_KEY", "sk-ant-test-not-real");
    let s = grammi(&f);
    assert_eq!(get(&f, &s, "onboarding").1["needsKey"], false);
    let (_, meta) = get(&f, &s, "meta");
    assert_eq!(
        (
            meta["onboarding"]["step"].clone(),
            meta["onboarding"]["total"].clone()
        ),
        (json!("stories"), json!(2))
    );
    let (_, started) = send(&f, &s, "PUT", "onboarding", json!({ "etag": "" }));
    assert_eq!(started["record"]["steps"]["helper"], "not-needed");
    assert_eq!(
        (
            started["record"]["step"].clone(),
            started["record"]["total"].clone()
        ),
        (json!("stories"), json!(2))
    );
    assert!(!get(&f, &s, "onboarding").1.to_string().contains("sk-ant"));
}

// ---------------------------------------------------------------------------
// The practice run (G74)
// ---------------------------------------------------------------------------

#[test]
fn rehearse_keeps_no_stories_never_touches_the_real_record_and_never_marks_her_done() {
    let _env = quiz_env();
    let f = fixture_with("rehearse", Some("rehearse"), Some(json!("on")));
    let s = grammi(&f);
    // She has a real record from before (in progress, one real story).
    let mut real = core::Record::begin("1", clock::now());
    real.stories = vec!["2026-11-01-a-meal-you-love-rough".into()];
    core::write(&f.dir, "grammi", false, &real).unwrap();
    let real_path = core::record_path(&f.dir, "grammi", false).unwrap();
    let real_bytes = fs::read(&real_path).unwrap();
    let voice_before = real_voice_files(&f);

    // Due every time, as a fresh run, whatever the real record says.
    let (_, own) = get(&f, &s, "onboarding");
    assert_eq!(
        (
            own["due"].clone(),
            own["practice"].clone(),
            own["record"].clone()
        ),
        (json!(true), json!(true), Json::Null)
    );
    let (_, started) = send(
        &f,
        &s,
        "PUT",
        "onboarding",
        json!({ "etag": "", "step": "stories" }),
    );
    assert_eq!(started["practice"], true);

    // A practice story, typed: start, save, lock, all with `practice`.
    let (_, drawn) = send(
        &f,
        &s,
        "POST",
        "voice/draw",
        json!({ "pack": "getting-started", "practice": true }),
    );
    let prompt = drawn["prompts"][0]["id"].as_str().unwrap().to_string();
    let (status, session) = send(
        &f,
        &s,
        "POST",
        "voice/session/start",
        json!({ "promptId": prompt, "practice": true }),
    );
    assert_eq!(status, 201, "{session}");
    let (status, _) = send(
        &f,
        &s,
        "PUT",
        "voice/session/draft",
        json!({ "sessionId": session["sessionId"], "text": STORY, "practice": true }),
    );
    assert_eq!(status, 200);
    // The real library has no session and no story; a request without `practice` can't see this one.
    assert_eq!(get(&f, &s, "voice/session").1["state"], "none");
    assert_eq!(get(&f, &s, "voice/session?practice=1").1["state"], "active");
    let (status, locked) = send(
        &f,
        &s,
        "POST",
        "voice/session/lock",
        json!({ "sessionId": session["sessionId"], "text": STORY, "practice": true }),
    );
    assert_eq!(status, 200, "{locked}");
    let id = locked["sample"]["id"].as_str().unwrap().to_string();
    assert_eq!(locked["sample"]["by"], "grammi");
    assert_eq!(
        get(&f, &s, "voice/samples?practice=1").1["samples"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        get(&f, &s, &format!("voice/samples/{id}?practice=1")).1["body"],
        STORY
    );

    // Nothing practice is among the real pieces, in the hub, the status or the helper's catalog.
    assert_eq!(
        real_voice_files(&f),
        voice_before,
        "the real library is untouched"
    );
    assert_eq!(get(&f, &s, "voice/samples").1["samples"], json!([]));
    assert_eq!(get(&f, &s, "voice/status").1["samples"], 0);
    assert_eq!(get(&f, &s, &format!("voice/samples/{id}")).0, 404);
    assert!(!get(&f, &s, "assistant/context?content=none")
        .1
        .to_string()
        .contains(&id));
    assert!(f
        .dir
        .join(core::PRACTICE_VOICE_ROOT)
        .join(".openblog/private/context/voice")
        .join(format!("{id}.md"))
        .is_file());

    // Finishing the practice run marks only the practice record; the real one is byte for byte.
    let (_, moved) = send(
        &f,
        &s,
        "PUT",
        "onboarding",
        json!({ "etag": started["etag"], "stories": [id], "status": "done", "practice": true }),
    );
    assert_eq!(moved["record"]["status"], "done");
    assert_eq!(
        fs::read(&real_path).unwrap(),
        real_bytes,
        "the real record was never written"
    );
    assert_eq!(
        core::read(&f.dir, "grammi", false).unwrap().unwrap().status,
        core::Status::InProgress
    );
    // And it shows again, fresh, at the next load.
    let (_, next) = get(&f, &s, "onboarding");
    assert_eq!(
        (next["due"].clone(), next["record"].clone()),
        (json!(true), Json::Null)
    );
    assert_eq!(get(&f, &s, "meta").1["onboarding"]["due"], true);

    // Reset from Home's details works on the real record, never the practice one.
    assert!(core::read(&f.dir, "grammi", true).unwrap().is_some());

    // The server starting again in another mode sweeps the practice run, stories and all.
    core::at_start(&f.dir, &core::mode_from(Some("on"), None));
    assert!(!f.dir.join(core::PRACTICE_DIR).exists());
    assert_eq!(fs::read(&real_path).unwrap(), real_bytes);
    assert_eq!(real_voice_files(&f), voice_before);
}

#[test]
fn a_practice_request_is_refused_on_every_voice_route_unless_the_server_is_rehearsing() {
    let f = fixture_with("practice-only", Some("on"), None);
    let s = grammi(&f);
    let refusals = [
        send(&f, &s, "POST", "voice/draw", json!({ "practice": true })),
        send(
            &f,
            &s,
            "POST",
            "voice/session/start",
            json!({ "promptId": "a-meal-you-love", "practice": true }),
        ),
        send(
            &f,
            &s,
            "PUT",
            "voice/session/draft",
            json!({ "sessionId": "x", "text": "t", "practice": true }),
        ),
        send(
            &f,
            &s,
            "POST",
            "voice/session/lock",
            json!({ "sessionId": "x", "text": "t", "practice": true }),
        ),
        send(
            &f,
            &s,
            "DELETE",
            "voice/session",
            json!({ "sessionId": "x", "practice": true }),
        ),
        send(
            &f,
            &s,
            "POST",
            "assistant/voice-guide",
            json!({ "sampleIds": ["voice:private:x-rough.md"], "practice": true }),
        ),
        get(&f, &s, "voice/session?practice=1"),
        get(&f, &s, "voice/samples?practice=1"),
        get(
            &f,
            &s,
            "voice/samples/2026-11-20-a-meal-you-love-rough?practice=1",
        ),
    ];
    for (index, answer) in refusals.iter().enumerate() {
        assert_eq!(
            (answer.0, answer.1["code"].as_str()),
            (409, Some("practice-only")),
            "route {index}: {}",
            answer.1
        );
    }
    let spoken = speak(&f, &s, "promptId=a-meal-you-love&practice=1", webm());
    assert_eq!(
        (
            spoken.status,
            body_json(&spoken)["code"].as_str().map(str::to_string)
        ),
        (409, Some("practice-only".into()))
    );
    assert!(!f.dir.join(core::PRACTICE_DIR).exists(), "nothing was made");
}

// ---------------------------------------------------------------------------
// The reminder (G72)
// ---------------------------------------------------------------------------

#[test]
fn the_reminder_is_due_by_the_server_s_rule_and_counts_only_a_new_post_once_a_day() {
    let f = fixture_with("nudge", Some("on"), None);
    let s = grammi(&f);
    assert_eq!(
        get(&f, &s, "onboarding/nudge").1,
        json!({ "due": false }),
        "never started"
    );
    let (status, none) = send(
        &f,
        &s,
        "POST",
        "onboarding/nudge",
        json!({ "event": "shown", "newPost": true }),
    );
    assert_eq!((status, none["code"].as_str()), (409, Some("no-record")));

    let (_, started) = send(
        &f,
        &s,
        "PUT",
        "onboarding",
        json!({ "etag": "", "step": "stories" }),
    );
    assert_eq!(
        get(&f, &s, "onboarding/nudge").1["due"],
        false,
        "stories not skipped"
    );
    send(
        &f,
        &s,
        "PUT",
        "onboarding",
        json!({ "etag": started["etag"], "steps": { "stories": "skipped" }, "status": "done" }),
    );
    assert_eq!(get(&f, &s, "onboarding/nudge").1["due"], true);
    assert_eq!(
        get(&f, &login_ok(&f), "onboarding/nudge").1["due"],
        false,
        "another account skipped nothing"
    );

    // Only a new post reports it, and it is counted once that day.
    let (status, refused) = send(
        &f,
        &s,
        "POST",
        "onboarding/nudge",
        json!({ "event": "shown" }),
    );
    assert_eq!(
        (status, refused["code"].as_str()),
        (422, Some("not-new-post"))
    );
    let (_, shown) = send(
        &f,
        &s,
        "POST",
        "onboarding/nudge",
        json!({ "event": "shown", "newPost": true }),
    );
    assert_eq!(
        (shown["counted"].clone(), shown["shown"].clone()),
        (json!(true), json!(1))
    );
    assert_eq!(
        get(&f, &s, "onboarding/nudge").1["due"],
        false,
        "not again within seven days"
    );
    let (_, twice) = send(
        &f,
        &s,
        "POST",
        "onboarding/nudge",
        json!({ "event": "shown", "newPost": true }),
    );
    assert_eq!(
        (twice["counted"].clone(), twice["shown"].clone()),
        (json!(false), json!(1))
    );

    // Seven days on (the record's day moved back), it is due again; three times is the last.
    let age = |days: &[&str]| {
        let mut record = core::read(&f.dir, "grammi", false).unwrap().unwrap();
        record.nudge.shown = days.iter().map(|d| d.to_string()).collect();
        core::write(&f.dir, "grammi", false, &record).unwrap();
    };
    age(&["2020-01-01"]);
    assert_eq!(get(&f, &s, "onboarding/nudge").1["due"], true);
    age(&["2020-01-01", "2020-01-08", "2020-01-15"]);
    assert_eq!(
        get(&f, &s, "onboarding/nudge").1["due"],
        false,
        "three times ever"
    );

    age(&["2020-01-01"]);
    let (_, stopped) = send(
        &f,
        &s,
        "POST",
        "onboarding/nudge",
        json!({ "event": "stop" }),
    );
    assert_eq!(stopped["stopped"], true);
    assert_eq!(get(&f, &s, "onboarding/nudge").1["due"], false);
    send(
        &f,
        &s,
        "POST",
        "onboarding/nudge",
        json!({ "event": "unstop" }),
    );
    assert_eq!(get(&f, &s, "onboarding/nudge").1["due"], true);
    let (status, _) = send(
        &f,
        &s,
        "POST",
        "onboarding/nudge",
        json!({ "event": "nag-more" }),
    );
    assert_eq!(status, 400);

    // A piece of her own ends it for good.
    let (_, session) = send(
        &f,
        &s,
        "POST",
        "voice/session/start",
        json!({ "promptId": "a-meal-you-love" }),
    );
    send(
        &f,
        &s,
        "POST",
        "voice/session/lock",
        json!({ "sessionId": session["sessionId"], "text": STORY }),
    );
    assert_eq!(get(&f, &s, "onboarding/nudge").1["due"], false);
}

// ---------------------------------------------------------------------------
// Accounts and reset (G73)
// ---------------------------------------------------------------------------

#[test]
fn any_account_sees_every_account_s_line_and_can_show_it_again_with_undo() {
    let f = fixture_with("accounts", Some("on:2026-11-20"), None);
    let mikey = login_ok(&f);
    let s = grammi(&f);
    let (_, started) = send(
        &f,
        &s,
        "PUT",
        "onboarding",
        json!({ "etag": "", "step": "stories", "steps": { "helper": "skipped" }, "stories": ["2026-11-20-a-meal-you-love-rough"] }),
    );
    let (_, list) = get(&f, &mikey, "onboarding/accounts");
    assert_eq!(
        (
            list["mode"].clone(),
            list["round"].clone(),
            list["sourceWords"].clone()
        ),
        (
            json!("on"),
            json!("2026-11-20"),
            json!("the server's environment")
        )
    );
    let rows = list["accounts"].as_array().unwrap();
    assert_eq!(rows.len(), 2);
    let hers = rows.iter().find(|row| row["user"] == "grammi").unwrap();
    assert_eq!(
        (
            hers["status"].clone(),
            hers["stories"].clone(),
            hers["helper"].clone()
        ),
        (json!("in-progress"), json!(1), json!("skipped"))
    );
    assert!(hers["line"]
        .as_str()
        .unwrap()
        .starts_with("grammi · in progress · stories 1 of 3 · helper's key skipped"));
    assert_eq!(
        rows.iter().find(|row| row["user"] == "mikey").unwrap()["status"],
        "not-started"
    );
    // Never a story, never a password hash.
    assert!(
        !list.to_string().contains("a-meal-you-love") && !list.to_string().contains("credential")
    );

    let bare = authed(
        json_req(
            "POST",
            "/admin/api/onboarding/reset",
            json!({ "user": "grammi" }),
        ),
        &mikey,
        false,
    );
    assert_eq!(handle(&f.state, &bare).status, 403);
    let (status, unknown) = send(
        &f,
        &mikey,
        "POST",
        "onboarding/reset",
        json!({ "user": "nobody" }),
    );
    assert_eq!(
        (status, unknown["code"].as_str()),
        (404, Some("unknown-user"))
    );

    // Her story stays where it is when her record goes.
    let voice = f.dir.join(".openblog/private/context/voice");
    fs::create_dir_all(&voice).unwrap();
    fs::write(voice.join("kept.txt"), "a story file").unwrap();
    let (status, reset) = send(
        &f,
        &mikey,
        "POST",
        "onboarding/reset",
        json!({ "user": "grammi" }),
    );
    assert_eq!(status, 200);
    assert_eq!(reset["record"]["stories"], started["record"]["stories"]);
    assert_eq!(get(&f, &s, "onboarding").1["record"], Json::Null);
    assert_eq!(get(&f, &s, "meta").1["onboarding"]["due"], true);
    assert!(voice.join("kept.txt").is_file());

    // Undo puts the record back as it was.
    let (status, back) = send(
        &f,
        &mikey,
        "PUT",
        "onboarding/restore",
        json!({ "user": "grammi", "record": reset["record"] }),
    );
    assert_eq!(status, 200, "{back}");
    assert_eq!(get(&f, &s, "onboarding").1["record"], started["record"]);
    let (status, _) = send(
        &f,
        &mikey,
        "PUT",
        "onboarding/restore",
        json!({ "user": "grammi", "record": { "v": 9 } }),
    );
    assert_eq!(status, 422);
    let (status, _) = send(
        &f,
        &mikey,
        "PUT",
        "onboarding/restore",
        json!({ "user": "nobody", "record": reset["record"] }),
    );
    assert_eq!(status, 404);
}

// ---------------------------------------------------------------------------
// Stories told out loud (G75, G76), who and how (G79), throwing one away (G78)
// ---------------------------------------------------------------------------

#[test]
fn a_story_told_out_loud_becomes_a_rough_piece_and_the_recording_is_never_kept() {
    let _env = quiz_env();
    let _local = LOCAL_COMMAND_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let _command = EnvRestore::capture("OPENBLOG_TRANSCRIBE_COMMAND");
    let _openai = EnvRestore::capture("OPENAI_API_KEY");
    let _gemini = EnvRestore::capture("GEMINI_API_KEY");
    for name in [
        "OPENBLOG_TRANSCRIBE_COMMAND",
        "OPENAI_API_KEY",
        "GEMINI_API_KEY",
    ] {
        std::env::remove_var(name);
    }
    let f = fixture_with("spoken", Some("on"), None);
    use_anthropic(&f);
    let s = grammi(&f);

    // Signed in, with the CSRF token.
    let mut bare = authed(
        req("POST", "/admin/api/voice/spoken?promptId=a-meal-you-love"),
        &s,
        false,
    );
    bare.body = webm();
    assert_eq!(handle(&f.state, &bare).status, 403);

    // An Anthropic helper and nothing that can hear: not offered, and nothing is written.
    let preview = get(&f, &s, "assistant/transcribe").1;
    assert_eq!(preview["available"], false);
    let none = speak(&f, &s, "promptId=a-meal-you-love", webm());
    assert_eq!(
        (none.status, body_json(&none)["code"].clone()),
        (404, json!("no-transcriber"))
    );
    assert_eq!(temp_audio(&f), Vec::<String>::new());

    // A key in the server's environment that can hear is used for the recording only (G76).
    std::env::set_var("OPENAI_API_KEY", "sk-hearing-test-not-real");
    let preview = get(&f, &s, "assistant/transcribe").1;
    assert_eq!(
        (
            preview["available"].clone(),
            preview["company"].clone(),
            preview["leavesServer"].clone()
        ),
        (json!(true), json!("OpenAI"), json!(true))
    );
    assert!(!preview.to_string().contains("sk-hearing"));

    // What it refuses before anything is sent anywhere.
    let bad_prompt = speak(&f, &s, "promptId=no-such-prompt", webm());
    assert_eq!(
        (bad_prompt.status, body_json(&bad_prompt)["code"].clone()),
        (400, json!("bad-prompt"))
    );
    let not_audio = speak(
        &f,
        &s,
        "promptId=a-meal-you-love",
        b"<html>not a recording</html>".to_vec(),
    );
    assert_eq!(
        (not_audio.status, body_json(&not_audio)["code"].clone()),
        (415, json!("not-audio"))
    );
    let long = speak(&f, &s, "promptId=a-meal-you-love", wav(201));
    assert_eq!(
        (long.status, body_json(&long)["code"].clone()),
        (413, json!("too-large"))
    );
    let mut huge = webm();
    huge.resize(voice::MAX_SPOKEN_BYTES + 1, 0);
    let too_big = speak(&f, &s, "promptId=a-meal-you-love", huge);
    assert_eq!(too_big.status, 413);
    assert_eq!(temp_audio(&f), Vec::<String>::new());
    assert_eq!(real_voice_files(&f), Vec::<String>::new());

    // The company fails, hears nothing, or times out: the recording is gone each time, and no piece is made.
    for (status, body, expected, code) in [
        (500, r#"{"error":"down"}"#, 502, "provider-down"),
        (401, r#"{"error":"bad key"}"#, 502, "key-rejected"),
        (200, r#"{"text":"  \n "}"#, 422, "empty-transcript"),
    ] {
        let (endpoint, provider) = fake_hearing(status, body);
        set_test_endpoint(Some(endpoint));
        let answer = speak(&f, &s, "promptId=a-meal-you-love", webm());
        provider.join().unwrap();
        assert_eq!(
            (answer.status, body_json(&answer)["code"].clone()),
            (expected, json!(code)),
            "{body}"
        );
        assert_eq!(
            temp_audio(&f),
            Vec::<String>::new(),
            "the recording is removed after {code}"
        );
        assert!(!String::from_utf8_lossy(&answer.body).contains("sk-hearing"));
    }
    assert_eq!(real_voice_files(&f), Vec::<String>::new());

    // It hears: the words become the rough draft, as said, with who told it and how.
    let (endpoint, provider) = fake_hearing(200, &json!({ "text": STORY }).to_string());
    set_test_endpoint(Some(endpoint));
    let answer = speak(&f, &s, "promptId=a-meal-you-love", webm());
    let sent = provider.join().unwrap();
    set_test_endpoint(None);
    assert_eq!(
        answer.status,
        201,
        "{}",
        String::from_utf8_lossy(&answer.body)
    );
    let made = body_json(&answer);
    assert_eq!(made["text"], STORY);
    assert_eq!(made["words"], 9);
    let id = made["id"].as_str().unwrap().to_string();
    assert!(id.ends_with("-a-meal-you-love-rough"));
    // Only the recording went: the hearing key as its bearer, the audio, and nothing of the site's.
    let sent_text = String::from_utf8_lossy(&sent);
    assert!(sent_text
        .to_lowercase()
        .contains("authorization: bearer sk-hearing-test-not-real"));
    assert!(sent
        .windows(AUDIO_MARK.len())
        .any(|part| part == AUDIO_MARK));
    assert!(!sent_text.contains("Test Blog") && !sent_text.contains("grammi"));
    assert_eq!(
        temp_audio(&f),
        Vec::<String>::new(),
        "the recording is not kept after success"
    );

    let file = fs::read_to_string(
        f.dir
            .join(".openblog/private/context/voice")
            .join(format!("{id}.md")),
    )
    .unwrap();
    assert!(
        file.contains("told: spoken") && file.contains("by: grammi"),
        "{file}"
    );
    assert!(file.contains(STORY));
    assert!(!file.contains("AUDIO-BYTES"));
    let (_, listed) = get(&f, &s, "voice/samples");
    assert_eq!(
        (
            listed["samples"][0]["by"].clone(),
            listed["samples"][0]["told"].clone(),
            listed["samples"][0]["stage"].clone()
        ),
        (json!("grammi"), json!("spoken"), json!("rough"))
    );
    // Private, never portable.
    assert_eq!(listed["samples"][0]["visibility"], "private");
    // Told once: the same prompt the same day is refused, and nothing is replaced.
    let (endpoint, provider) = fake_hearing(200, r#"{"text":"something else entirely"}"#);
    set_test_endpoint(Some(endpoint));
    let again = speak(&f, &s, "promptId=a-meal-you-love", webm());
    provider.join().unwrap();
    set_test_endpoint(None);
    assert_eq!(again.status, 409);
    assert!(fs::read_to_string(
        f.dir
            .join(".openblog/private/context/voice")
            .join(format!("{id}.md"))
    )
    .unwrap()
    .contains(STORY));

    // A typed piece says who and how too; a piece from before says neither.
    let (_, session) = send(
        &f,
        &s,
        "POST",
        "voice/session/start",
        json!({ "promptId": "a-day-you-still-remember" }),
    );
    let (_, locked) = send(
        &f,
        &s,
        "POST",
        "voice/session/lock",
        json!({ "sessionId": session["sessionId"], "text": "typed words" }),
    );
    assert_eq!(
        (
            locked["sample"]["by"].clone(),
            locked["sample"]["told"].clone()
        ),
        (json!("grammi"), json!("typed"))
    );
}

#[test]
fn a_local_engine_hears_without_anything_leaving_and_its_temporary_file_is_private_and_removed() {
    let _env = quiz_env();
    let _local = LOCAL_COMMAND_LOCK
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let _command = EnvRestore::capture("OPENBLOG_TRANSCRIBE_COMMAND");
    // `echo <file>`: the "transcript" is the path it was given, which says where the recording was.
    let command = if cfg!(windows) {
        json!(["cmd", "/c", "echo"])
    } else {
        json!(["echo"])
    };
    std::env::set_var("OPENBLOG_TRANSCRIBE_COMMAND", command.to_string());
    let f = fixture_with("spoken-local", Some("on"), None);
    use_anthropic(&f);
    let s = grammi(&f);
    let preview = get(&f, &s, "assistant/transcribe").1;
    assert_eq!(
        (
            preview["available"].clone(),
            preview["engine"].clone(),
            preview["company"].clone()
        ),
        (json!(true), json!("local"), Json::Null)
    );
    let answer = speak(&f, &s, "promptId=someone-who-taught-you", webm());
    assert_eq!(
        answer.status,
        201,
        "{}",
        String::from_utf8_lossy(&answer.body)
    );
    let said = body_json(&answer)["text"]
        .as_str()
        .unwrap()
        .replace('\\', "/");
    assert!(
        said.contains(".openblog/private/onboarding/tmp/") && said.ends_with(".webm"),
        "{said}"
    );
    assert!(
        !Path::new(said.trim()).exists(),
        "the recording was removed"
    );
    assert_eq!(temp_audio(&f), Vec::<String>::new());

    // An engine that never answers is stopped at the deadline, and the recording still goes.
    if !cfg!(windows) {
        std::env::set_var(
            "OPENBLOG_TRANSCRIBE_COMMAND",
            json!(["sh", "-c", "sleep 30"]).to_string(),
        );
        TEST_PROVIDER_TIMEOUT.with(|limit| limit.set(Duration::from_millis(300)));
        let slow = speak(&f, &s, "promptId=a-day-you-still-remember", webm());
        TEST_PROVIDER_TIMEOUT.with(|limit| limit.set(Duration::from_secs(10)));
        assert_eq!(
            (slow.status, body_json(&slow)["code"].clone()),
            (504, json!("timeout"))
        );
        assert_eq!(
            temp_audio(&f),
            Vec::<String>::new(),
            "removed after a timeout"
        );
        assert_eq!(
            real_voice_files(&f).len(),
            1,
            "no piece from a recording nobody heard"
        );
    }
}

#[test]
fn throwing_one_piece_away_takes_its_rough_draft_and_polished_copy_and_nothing_else() {
    let f = fixture_with("throw", Some("on"), None);
    let s = grammi(&f);
    let write = |prompt: &str, text: &str| {
        let (_, session) = send(
            &f,
            &s,
            "POST",
            "voice/session/start",
            json!({ "promptId": prompt }),
        );
        let (status, locked) = send(
            &f,
            &s,
            "POST",
            "voice/session/lock",
            json!({ "sessionId": session["sessionId"], "text": text }),
        );
        assert_eq!(status, 200, "{locked}");
        locked["sample"].clone()
    };
    let first = write("a-meal-you-love", "the first story");
    let second = write("a-day-you-still-remember", "the second story");
    let (status, polished) = send(
        &f,
        &s,
        "POST",
        "voice/samples",
        json!({ "roughOf": first["file"], "title": "Tidy", "body": "The first story." }),
    );
    assert_eq!(status, 201, "{polished}");
    // The guide stays: it keeps what it learned until she updates it.
    let guide = f.dir.join(".openblog/private/context/voice.md");
    fs::write(&guide, "# Voice\n").unwrap();
    let id = first["id"].as_str().unwrap();

    let bare = authed(
        req("DELETE", &format!("/admin/api/voice/samples/{id}")),
        &s,
        false,
    );
    assert_eq!(handle(&f.state, &bare).status, 403);
    let (status, not_rough) = send(
        &f,
        &s,
        "DELETE",
        &format!("voice/samples/{}", polished["id"].as_str().unwrap()),
        json!({}),
    );
    assert_eq!(
        (status, not_rough["code"].as_str()),
        (400, Some("not-rough"))
    );

    // While a piece on that prompt is being written, it can't be thrown away.
    fs::write(
        f.dir.join(crate::voice_store::SESSION_PATH),
        json!({ "format": crate::voice_store::SESSION_FORMAT, "version": 1, "promptId": "a-meal-you-love", "pack": "getting-started", "catalogVersion": 1,
            "startedAt": clock::now().rfc3339(), "deadline": clock::now().rfc3339(), "timeLimitSeconds": 180, "draft": "", "surface": "admin", "visibility": "private" }).to_string(),
    )
    .unwrap();
    let (status, busy) = send(&f, &s, "DELETE", &format!("voice/samples/{id}"), json!({}));
    assert_eq!((status, busy["code"].as_str()), (409, Some("in-session")));
    fs::remove_file(f.dir.join(crate::voice_store::SESSION_PATH)).unwrap();

    let (status, gone) = send(&f, &s, "DELETE", &format!("voice/samples/{id}"), json!({}));
    assert_eq!(status, 200, "{gone}");
    assert_eq!(gone["gone"].as_array().unwrap().len(), 2);
    assert!(
        !gone.to_string().contains("first story"),
        "what went is named, never quoted"
    );
    let left = real_voice_files(&f);
    assert_eq!(
        left,
        vec![second["file"].as_str().unwrap().to_string()],
        "only the other piece is left"
    );
    assert!(guide.is_file());
    let (status, again) = send(&f, &s, "DELETE", &format!("voice/samples/{id}"), json!({}));
    assert_eq!((status, again["code"].as_str()), (404, Some("gone")));
}

#[test]
fn the_getting_started_set_is_bundled_with_six_prompts_whose_ids_never_change() {
    let f = fixture_with("pack", None, None);
    let s = login_ok(&f);
    let (_, catalog) = get(&f, &s, "voice/catalog");
    let pack = catalog["packs"]
        .as_array()
        .unwrap()
        .iter()
        .find(|pack| pack["id"] == "getting-started")
        .unwrap();
    assert_eq!(pack["title"], "Getting started");
    assert_eq!(
        pack["summary"],
        "Short stories, the way you'd tell them to a friend."
    );
    let prompts: Vec<(&str, &str)> = pack["prompts"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| (p["id"].as_str().unwrap(), p["title"].as_str().unwrap()))
        .collect();
    assert_eq!(
        prompts,
        [
            ("a-meal-you-love", "A meal you love"),
            (
                "a-place-from-when-you-were-young",
                "A place from when you were young"
            ),
            ("someone-who-taught-you", "Someone who taught you something"),
            ("a-day-you-still-remember", "A day you still remember"),
            (
                "something-you-make-or-do-well",
                "Something you make or do well"
            ),
            (
                "something-that-made-you-laugh",
                "Something that made you laugh"
            ),
        ]
    );
    for prompt in pack["prompts"].as_array().unwrap() {
        assert_eq!(
            (prompt["wordsMin"].clone(), prompt["wordsMax"].clone()),
            (json!(40), json!(150))
        );
        let invitation = prompt["invitation"].as_str().unwrap();
        assert!(!invitation.is_empty() && !invitation.contains('\n'));
    }
    // Drawing from it gives three of its own, and avoids the ones just shown.
    let (_, drawn) = send(
        &f,
        &s,
        "POST",
        "voice/draw",
        json!({ "pack": "getting-started" }),
    );
    let ids: Vec<String> = drawn["prompts"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["id"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(ids.len(), 3);
    assert!(drawn["prompts"]
        .as_array()
        .unwrap()
        .iter()
        .all(|p| p["pack"] == "getting-started"));
    let (_, others) = send(
        &f,
        &s,
        "POST",
        "voice/draw",
        json!({ "pack": "getting-started", "exclude": ids }),
    );
    assert!(others["prompts"]
        .as_array()
        .unwrap()
        .iter()
        .all(|p| !ids.iter().any(|id| p["id"] == *id)));
}
