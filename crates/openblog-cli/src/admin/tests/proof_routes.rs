//! Admin review routes (ADR 0389, #520): a saved review is edited through the same document routes services
//! use, judged by the build's own rules, and a copy from its link goes through the Assistant's URL snapshot
//! route, unchanged, so its limits and refusals are that route's own.

use super::*;

fn call(f: &Fixture, session: &(String, String), method: &str, path: &str, body: Json) -> Response {
    handle(
        &f.state,
        &authed(json_req(method, path, body), session, true),
    )
}

fn review_fields() -> Json {
    json!({
        "version": "1",
        "id": "dana-r-2026-10-20",
        "author": "Dana R.",
        "date": "2026-10-20",
        "platform": "google",
        "sourceUrl": "https://g.page/r/crew/review",
        "rating": "5",
        "provenance": "snapshot",
        "retrievedAt": "2026-11-08T15:04:05Z",
        "future": "kept"
    })
}

fn create(f: &Fixture, session: &(String, String), fields: Json, body: &str) -> Response {
    call(
        f,
        session,
        "POST",
        "/admin/api/document",
        json!({ "kind": "proof", "fields": fields, "body": body }),
    )
}

fn review_path(f: &Fixture, name: &str) -> PathBuf {
    f.dir.join("content/proof").join(name)
}

#[test]
fn a_review_is_created_listed_read_back_and_offered_to_the_job_form() {
    let f = fixture("proof-roundtrip");
    let session = login_ok(&f);
    let before = body_json(&handle(
        &f.state,
        &authed(req("GET", "/admin/api/meta"), &session, false),
    ));
    assert_eq!(before["job"]["reviews"], json!([]));

    let created = create(&f, &session, review_fields(), "On time and careful.\n");
    assert_eq!(
        created.status,
        201,
        "{}",
        String::from_utf8_lossy(&created.body)
    );
    assert_eq!(body_json(&created)["path"], "proof/dana-r-2026-10-20.md");
    let text = fs::read_to_string(review_path(&f, "dana-r-2026-10-20.md")).unwrap();
    for line in [
        "provenance: snapshot",
        "retrievedAt: \"2026-11-08T15:04:05Z\"",
        "future: kept",
        "rating: 5",
    ] {
        assert!(
            text.contains(line) || text.contains(&line.replace('"', "")),
            "{line} in {text}"
        );
    }
    assert!(text.trim_end().ends_with("On time and careful."));

    let listed = body_json(&handle(
        &f.state,
        &authed(
            req("GET", "/admin/api/documents?kind=proof"),
            &session,
            false,
        ),
    ));
    let item = &listed["items"][0];
    assert_eq!(item["title"], "Dana R.");
    assert_eq!(item["rating"], "5");
    assert_eq!(item["status"], "published");

    let read = body_json(&handle(
        &f.state,
        &authed(
            req("GET", "/admin/api/document?path=proof/dana-r-2026-10-20.md"),
            &session,
            false,
        ),
    ));
    assert_eq!(read["kind"], "proof");
    assert_eq!(read["fields"]["platform"], "google");

    let meta = body_json(&handle(
        &f.state,
        &authed(req("GET", "/admin/api/meta"), &session, false),
    ));
    assert_eq!(
        meta["job"]["reviews"],
        json!([{ "id": "dana-r-2026-10-20", "label": "Dana R., Google, 2026-10-20" }])
    );
    assert_eq!(meta["siteUses"]["reviews"], true);
}

#[test]
fn a_rating_outside_one_to_five_and_other_problems_are_refused_in_the_builds_words() {
    let f = fixture("proof-problems");
    let session = login_ok(&f);
    let mut fields = review_fields();
    fields["rating"] = json!("9");
    fields["sourceUrl"] = json!("https://google.example.com/review");
    let refused = create(&f, &session, fields, "");
    assert_eq!(refused.status, 422);
    let problems = body_json(&refused)["problems"].to_string();
    for expected in [
        "rating: `9` is not a star rating",
        "is not a Google address",
        "text: add the review's words",
    ] {
        assert!(problems.contains(expected), "{expected} in {problems}");
    }
    assert!(!review_path(&f, "dana-r-2026-10-20.md").exists());

    let mut no_id = review_fields();
    no_id.as_object_mut().unwrap().remove("id");
    assert_eq!(create(&f, &session, no_id, "Words.").status, 422);
}

#[test]
fn the_review_routes_need_a_session_and_the_csrf_token() {
    let f = fixture("proof-auth");
    assert_eq!(
        handle(&f.state, &req("GET", "/admin/api/documents?kind=proof")).status,
        401
    );
    let session = login_ok(&f);
    let no_csrf = authed(
        json_req(
            "POST",
            "/admin/api/document",
            json!({ "kind": "proof", "fields": review_fields(), "body": "Words." }),
        ),
        &session,
        false,
    );
    assert_eq!(handle(&f.state, &no_csrf).status, 403);
    let fetch = authed(
        json_req(
            "POST",
            "/admin/api/assistant/context/url/retrieve",
            json!({ "url": "https://example.com/", "confirmed": true }),
        ),
        &session,
        false,
    );
    assert_eq!(handle(&f.state, &fetch).status, 403);
    assert!(!review_path(&f, "dana-r-2026-10-20.md").exists());
}

#[test]
fn copying_from_a_link_has_the_snapshot_routes_own_refusals_and_contacts_nothing_first() {
    let f = fixture("proof-snapshot");
    let session = login_ok(&f);
    let retrieve = |body: Json| {
        call(
            &f,
            &session,
            "POST",
            "/admin/api/assistant/context/url/retrieve",
            body,
        )
    };
    // Without the owner's say-so nothing is fetched.
    let unconfirmed = retrieve(json!({ "url": "https://g.page/r/crew/review" }));
    assert_eq!(unconfirmed.status, 400);
    assert!(String::from_utf8_lossy(&unconfirmed.body).contains("Confirm retrieval"));
    // Private, local and credentialed addresses are refused before any connection.
    for (address, words) in [
        ("http://127.0.0.1/review", "local or private"),
        ("http://192.168.1.10/review", "local or private"),
        ("http://localhost/review", "local or private"),
        ("https://user:pw@g.page/r/x", "credentials"),
        ("ftp://g.page/r/x", "only HTTP(S)"),
        ("not a link", "complete HTTP(S) URL"),
    ] {
        let refused = retrieve(json!({ "url": address, "confirmed": true }));
        assert_eq!(refused.status, 400, "{address}");
        let text = String::from_utf8_lossy(&refused.body);
        assert!(text.contains(words), "{address}: {text}");
        assert_eq!(
            crate::url_context::validate_public_url(address).unwrap_err(),
            body_json(&refused)["error"].as_str().unwrap(),
            "{address}: the same refusal as the reference flow"
        );
    }
    // Saving a copied review never fetches again: the copy's time is what was sent.
    let created = create(&f, &session, review_fields(), "Great.\n");
    assert_eq!(created.status, 201);
    let text = fs::read_to_string(review_path(&f, "dana-r-2026-10-20.md")).unwrap();
    assert!(text.contains("2026-11-08T15:04:05Z"));
}
