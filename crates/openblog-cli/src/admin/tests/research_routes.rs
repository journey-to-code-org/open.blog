//! Studio R11's research gaps (docs/specs/studio/r11/ux.md "Server gaps"): G92 research shows only
//! on a site that uses it, G93 every research refusal carries a code, G94 where each source is
//! used, G95 a checked citation as readers will see it. None of them writes anything.

use super::*;

fn meta_of(f: &Fixture, session: &(String, String)) -> Json {
    let response = handle(
        &f.state,
        &authed(req("GET", "/admin/api/meta"), session, false),
    );
    assert_eq!(
        response.status,
        200,
        "{}",
        String::from_utf8_lossy(&response.body)
    );
    body_json(&response)
}

fn post(f: &Fixture, file: &str, text: &str) {
    fs::write(f.dir.join("content/posts").join(file), text).unwrap();
}

fn edit_config(f: &Fixture, change: impl FnOnce(&mut Json)) {
    let path = f.dir.join(site::CONFIG_FILE);
    let mut config: Json = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
    change(&mut config);
    fs::write(&path, config.to_string()).unwrap();
}

/// A library with a work and a translation of it.
fn library(f: &Fixture, session: &(String, String)) -> String {
    let empty = source_library(f, session);
    let (status, work) = source_call(
        f,
        session,
        "POST",
        "/admin/api/sources",
        json!({ "revision": empty["revision"], "source": { "id": "plato-republic", "kind": "work", "title": "Republic" } }),
    );
    assert_eq!(status, 201, "{work}");
    let (status, translation) = source_call(
        f,
        session,
        "POST",
        "/admin/api/sources",
        json!({
            "revision": work["revision"],
            "source": { "id": "republic-slings", "kind": "translation", "of": "plato-republic", "language": "en", "title": "Republic, tr. Slings" },
        }),
    );
    assert_eq!(status, 201, "{translation}");
    translation["revision"].as_str().unwrap().to_string()
}

// ---- G92

#[test]
fn a_site_that_never_used_research_says_so_and_no_research_file_appears() {
    let f = fixture("research-g92-none");
    let session = login_ok(&f);
    let meta = meta_of(&f, &session);
    assert_eq!(meta["siteUses"]["research"], false);
    assert_eq!(
        meta["research"]["citationLocales"],
        json!(["en", "de", "fr", "es"])
    );
    assert_eq!(meta["research"]["atlasPublishes"], false);
    assert!(
        !f.dir.join(".openblog/private/research").exists(),
        "reading meta writes nothing"
    );
}

#[test]
fn research_is_used_once_a_store_a_research_post_a_citation_or_a_switch_exists() {
    // A private store (the first source).
    let f = fixture("research-g92-store");
    let session = login_ok(&f);
    library(&f, &session);
    assert_eq!(meta_of(&f, &session)["siteUses"]["research"], true);

    // A research post.
    let f = fixture("research-g92-profile");
    let session = login_ok(&f);
    post(
        &f,
        "cave.md",
        "---\ntitle: The cave\nprofile: research\n---\n\nWords.\n",
    );
    assert_eq!(meta_of(&f, &session)["siteUses"]["research"], true);

    // A post that opted into citations.
    let f = fixture("research-g92-citations");
    let session = login_ok(&f);
    post(
        &f,
        "cave.md",
        "---\ntitle: The cave\ncitations: notes\n---\n\nWords.\n",
    );
    assert_eq!(meta_of(&f, &session)["siteUses"]["research"], true);

    // A citation in the words, but not one inside code.
    let f = fixture("research-g92-marker");
    let session = login_ok(&f);
    post(
        &f,
        "code.md",
        "---\ntitle: Code\n---\n\n`[@not-a-citation]`\n\n```\n[@nor-this]\n```\n",
    );
    assert_eq!(
        meta_of(&f, &session)["siteUses"]["research"],
        false,
        "code is not a citation"
    );
    post(
        &f,
        "cave.md",
        "---\ntitle: The cave\n---\n\nShadows [@plato-republic, page 514].\n",
    );
    assert_eq!(meta_of(&f, &session)["siteUses"]["research"], true);

    // A projection switched on.
    let f = fixture("research-g92-switch");
    let session = login_ok(&f);
    edit_config(&f, |config| {
        config["knowledgeAtlas"] = json!({ "publish": true })
    });
    let meta = meta_of(&f, &session);
    assert_eq!(meta["siteUses"]["research"], true);
    assert_eq!(meta["research"]["atlasPublishes"], true);
}

// ---- G93

#[test]
fn research_refusals_carry_a_code_beside_their_sentence() {
    let f = fixture("research-g93");
    let session = login_ok(&f);
    let revision = library(&f, &session);

    // 409: a stale revision.
    let (status, stale) = source_call(
        &f,
        &session,
        "PUT",
        "/admin/api/sources",
        json!({ "revision": "stale", "source": { "id": "plato-republic", "kind": "work", "title": "Changed" } }),
    );
    assert_eq!(status, 409);
    assert_eq!(stale["code"], "changed");
    assert_eq!(stale["conflict"], true, "the old flag stays one release");
    assert!(stale["error"].is_string());

    // 422: a refused change, with its diagnostics' own codes kept.
    let (status, invalid) = source_call(
        &f,
        &session,
        "POST",
        "/admin/api/sources",
        json!({ "revision": revision, "source": { "id": "Not A Key", "kind": "work", "title": "X" } }),
    );
    assert_eq!(status, 422);
    assert_eq!(invalid["code"], "invalid");
    assert_eq!(invalid["diagnostics"][0]["code"], "invalid-id");

    // 400: no revision.
    let (status, bad) = source_call(
        &f,
        &session,
        "POST",
        "/admin/api/research/passages",
        json!({ "passage": {} }),
    );
    assert_eq!(status, 400);
    assert_eq!(bad["code"], "bad-request");

    // 409 on the citation picker: the library changed.
    let (status, changed) = source_call(
        &f,
        &session,
        "POST",
        "/admin/api/citations/check",
        json!({ "revision": "stale", "citation": { "key": "plato-republic" } }),
    );
    assert_eq!(status, 409);
    assert_eq!(changed["code"], "changed");

    // 422 from the citation check: an unknown key.
    let (status, unknown) = source_call(
        &f,
        &session,
        "POST",
        "/admin/api/citations/check",
        json!({ "revision": revision, "citation": { "key": "nobody" } }),
    );
    assert_eq!(status, 422);
    assert_eq!(unknown["code"], "invalid");
    assert_eq!(unknown["diagnostics"][0]["code"], "unknown-key");
}

#[test]
fn an_unreadable_store_is_coded_unreadable_with_its_diagnostic_codes() {
    let f = fixture("research-g93-unreadable");
    let session = login_ok(&f);
    let path = f.dir.join(crate::source_store::LIBRARY_FILE);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, "{ not json").unwrap();
    let response = handle(
        &f.state,
        &authed(req("GET", "/admin/api/sources"), &session, false),
    );
    assert_eq!(response.status, 422);
    let body = body_json(&response);
    assert_eq!(body["code"], "unreadable");
    assert_eq!(body["codes"], json!(["invalid-json"]));
    assert_eq!(body["file"], crate::source_store::LIBRARY_FILE);
    assert_eq!(
        fs::read_to_string(&path).unwrap(),
        "{ not json",
        "nothing was repaired or written"
    );
}

#[test]
fn codes_never_touch_answers_outside_research_and_keep_a_code_already_there() {
    use crate::admin::research::coded;
    let other = Response::json(409, &json!({ "error": "x" }));
    assert_eq!(
        body_json(&coded("seasons", "PUT", other)),
        json!({ "error": "x" })
    );
    let busy = Response::json(409, &json!({ "error": "x", "code": "busy" }));
    assert_eq!(body_json(&coded("sources", "PUT", busy))["code"], "busy");
    let built = Response::json(
        200,
        &json!({ "saved": true, "build": { "ok": true, "files": 3 } }),
    );
    assert_eq!(
        body_json(&coded("research/atlas/entries", "PUT", built))["build"]["code"],
        "built"
    );
    let failed = Response::json(200, &json!({ "build": { "ok": false, "error": "no" } }));
    assert_eq!(
        body_json(&coded("research/alignments", "PUT", failed))["build"]["code"],
        "build-failed"
    );
    let large = Response::json(413, &json!({ "error": "big" }));
    assert_eq!(
        body_json(&coded("sources/import", "POST", large))["code"],
        "too-large"
    );
    let storage = Response::json(500, &json!({ "error": "disk" }));
    assert_eq!(
        body_json(&coded("research/notes", "PUT", storage))["code"],
        "storage"
    );
}

// ---- G94

#[test]
fn each_source_says_which_posts_cite_it_or_a_version_of_it_and_what_points_at_it() {
    let f = fixture("research-g94");
    let session = login_ok(&f);
    let revision = library(&f, &session);
    post(
        &f,
        "cave.md",
        "---\ntitle: The cave\n---\n\nShadows [@republic-slings, page 514].\n",
    );
    post(
        &f,
        "code.md",
        "---\ntitle: Code\n---\n\n`[@plato-republic]`\n",
    );
    let notebook = notebook(&f, &session);
    let (status, passage) = notebook_call(
        &f,
        &session,
        "POST",
        "/admin/api/research/passages",
        json!({
            "revision": notebook["revision"],
            "passage": { "id": "p1", "source": "republic-slings", "excerpt": { "text": "they see only their own shadows" } },
        }),
    );
    assert_eq!(status, 201, "{passage}");
    let (status, note) = notebook_call(
        &f,
        &session,
        "POST",
        "/admin/api/research/notes",
        json!({
            "revision": passage["revision"],
            "note": { "id": "n1", "kind": "observation", "text": "The fire.", "passages": ["p1"] },
        }),
    );
    assert_eq!(status, 201, "{note}");
    let _ = revision;

    let listed = source_library(&f, &session);
    let uses = &listed["uses"];
    assert_eq!(
        uses["republic-slings"]["citedBy"],
        json!([{ "path": "posts/cave.md", "title": "The cave" }])
    );
    assert_eq!(
        uses["plato-republic"]["citedBy"],
        json!([{ "path": "posts/cave.md", "title": "The cave" }]),
        "citing a translation counts for its work; code doesn't count"
    );
    assert_eq!(uses["republic-slings"]["usedBy"]["passages"], 1);
    assert_eq!(uses["republic-slings"]["usedBy"]["notes"], 1);
    assert_eq!(uses["plato-republic"]["usedBy"]["passages"], 0);
    assert_eq!(uses["plato-republic"]["usedBy"]["atlasEvidence"], 0);
    // The records themselves carry no counts, so one sent back to be saved stays as it was.
    for record in listed["sources"].as_array().unwrap() {
        assert!(
            record.get("citedBy").is_none() && record.get("usedBy").is_none(),
            "{record}"
        );
    }
}

// ---- G95

#[test]
fn a_checked_citation_reads_as_readers_will_see_it_in_the_posts_language() {
    let f = fixture("research-g95");
    let session = login_ok(&f);
    let revision = library(&f, &session);
    let citation = json!({ "key": "republic-slings", "locators": [{ "kind": "page", "value": "514", "to": "520" }] });

    let (status, english) = source_call(
        &f,
        &session,
        "POST",
        "/admin/api/citations/check",
        json!({ "revision": revision, "citation": citation }),
    );
    assert_eq!(status, 200, "{english}");
    assert_eq!(
        english["markdown"], "[@republic-slings, page 514 to 520]",
        "the markdown is unchanged"
    );
    assert_eq!(english["label"], "Republic, tr. Slings, pp. 514–520");
    assert_eq!(english["locale"], "en");
    assert!(
        english["note"].as_str().unwrap().ends_with("pp. 514–520"),
        "{}",
        english["note"]
    );

    post(
        &f,
        "cave.md",
        "---\ntitle: The cave\ncitationLocale: de\n---\n\nWords.\n",
    );
    let (status, german) = source_call(
        &f,
        &session,
        "POST",
        "/admin/api/citations/check",
        json!({ "revision": revision, "citation": citation, "post": "posts/cave.md" }),
    );
    assert_eq!(status, 200, "{german}");
    assert_eq!(german["label"], "Republic, tr. Slings, S. 514–520");
    assert_eq!(german["locale"], "de");

    // A post that isn't there reads in the site's language; nothing is written.
    let (status, missing) = source_call(
        &f,
        &session,
        "POST",
        "/admin/api/citations/check",
        json!({ "revision": revision, "citation": { "key": "plato-republic" }, "post": "posts/../../etc/passwd" }),
    );
    assert_eq!(status, 200, "{missing}");
    assert_eq!(missing["label"], "Republic");
    assert_eq!(missing["locale"], "en");
}

// ---- G93 on R12's routes: the atlas, claims, alignments, choices for readers, what readers see

#[test]
fn the_atlas_claims_alignments_and_choices_code_their_refusals_too() {
    let f = fixture("research-g93-r12");
    let session = login_ok(&f);
    let get = |path: &str| {
        let response = handle(&f.state, &authed(req("GET", path), &session, false));
        assert_eq!(
            response.status,
            200,
            "{path}: {}",
            String::from_utf8_lossy(&response.body)
        );
        body_json(&response)
    };
    let atlas = get("/admin/api/research/atlas");
    let revision = atlas["revision"].as_str().unwrap().to_string();

    // 409: an atlas save on an old revision.
    let (status, stale) = source_call(
        &f,
        &session,
        "POST",
        "/admin/api/research/atlas/entries",
        json!({ "revision": "stale", "entry": { "id": "plato", "kind": "person", "label": "Plato", "visibility": "private" } }),
    );
    assert_eq!(status, 409, "{stale}");
    assert_eq!(stale["code"], "changed");
    assert_eq!(stale["conflict"], true);

    // 422: an entry the atlas refuses keeps its diagnostics' own codes.
    let (status, invalid) = source_call(
        &f,
        &session,
        "POST",
        "/admin/api/research/atlas/entries",
        json!({ "revision": revision, "entry": { "id": "Not A Key", "kind": "person", "label": "X", "visibility": "private" } }),
    );
    assert_eq!(status, 422, "{invalid}");
    assert_eq!(invalid["code"], "invalid");
    assert!(invalid["diagnostics"][0]["code"].is_string());

    // 400: an alignment without a revision, and a claim anchor without its post.
    let (status, bad) = source_call(
        &f,
        &session,
        "POST",
        "/admin/api/research/alignments",
        json!({ "alignment": {} }),
    );
    assert_eq!(status, 400, "{bad}");
    assert_eq!(bad["code"], "bad-request");
    let (status, bad) = source_call(
        &f,
        &session,
        "POST",
        "/admin/api/research/claims/anchor",
        json!({}),
    );
    assert_eq!(status, 400, "{bad}");
    assert_eq!(bad["code"], "bad-request");

    // 409: an alignment and a claim on old revisions.
    let (status, stale) = source_call(
        &f,
        &session,
        "DELETE",
        "/admin/api/research/alignments",
        json!({ "revision": "stale", "id": "nothing" }),
    );
    assert_eq!(status, 409, "{stale}");
    assert_eq!(stale["code"], "changed");

    // The views a screen reads carry no code, and a saved entry on a site that doesn't publish the
    // atlas carries no build either.
    for path in [
        "/admin/api/research/alignments",
        "/admin/api/research/boundary",
    ] {
        assert!(get(path).get("code").is_none(), "{path} answers as before");
    }
    let (status, saved) = source_call(
        &f,
        &session,
        "POST",
        "/admin/api/research/atlas/entries",
        json!({ "revision": revision, "entry": { "id": "plato", "kind": "person", "label": "Plato", "visibility": "private" } }),
    );
    assert_eq!(status, 201, "{saved}");
    assert!(saved.get("code").is_none());
    assert!(
        saved.get("build").is_none(),
        "nothing is rebuilt when the site doesn't publish its atlas"
    );
}

#[test]
fn a_save_that_rebuilds_the_published_atlas_says_how_it_went() {
    let f = fixture("research-g93-build");
    edit_config(&f, |config| {
        config["knowledgeAtlas"] = json!({ "publish": true })
    });
    let session = login_ok(&f);
    let response = handle(
        &f.state,
        &authed(req("GET", "/admin/api/research/atlas"), &session, false),
    );
    let revision = body_json(&response)["revision"]
        .as_str()
        .unwrap()
        .to_string();
    let (status, saved) = source_call(
        &f,
        &session,
        "POST",
        "/admin/api/research/atlas/entries",
        json!({ "revision": revision, "entry": { "id": "plato", "kind": "person", "label": "Plato", "visibility": "approved" } }),
    );
    assert_eq!(status, 201, "{saved}");
    let ok = saved["build"]["ok"].as_bool().expect("a build outcome");
    assert_eq!(
        saved["build"]["code"],
        if ok { "built" } else { "build-failed" }
    );
}

#[test]
fn an_unreadable_atlas_is_coded_unreadable_and_left_alone() {
    let f = fixture("research-g93-atlas-unreadable");
    let session = login_ok(&f);
    let path = f.dir.join(crate::atlas_store::ATLAS_FILE);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, "{ not json").unwrap();
    let response = handle(
        &f.state,
        &authed(req("GET", "/admin/api/research/atlas"), &session, false),
    );
    assert_eq!(response.status, 422);
    let body = body_json(&response);
    assert_eq!(body["code"], "unreadable");
    assert_eq!(body["codes"], json!(["invalid-json"]));
    assert_eq!(
        fs::read_to_string(&path).unwrap(),
        "{ not json",
        "nothing was repaired or written"
    );
}
