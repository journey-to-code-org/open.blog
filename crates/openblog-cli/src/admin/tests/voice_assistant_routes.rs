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
