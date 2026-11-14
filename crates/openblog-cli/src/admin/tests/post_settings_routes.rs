//! Studio R5, "About this post": a post says what it is and whether it was ever on the site (G38),
//! a refused save says why by `code` (G36), a summary-only change rewrites one line, meta and
//! `GET publish` say how a scheduled post goes up (G37, G39, G40), a scheduled post goes out by
//! itself on a site that sends itself out, and the contributor registry refuses by `code` (G41).

use super::*;

const PIE: &str = "---\ntitle: Pumpkin bread\ndate: 2026-11-06\ndraft: true\nprep: 15 min\nsummary: Moist and spiced.\ndek: From my mother\n---\n\nMy mother's bread. It keeps for days and travels well to every family supper.\n";
const REL: &str = "posts/2026-11-06-pumpkin-bread.md";

fn path_query(rel: &str) -> String {
    rel.replace('/', "%2F")
}

fn bread_site(tag: &str) -> Fixture {
    let f = fixture(tag);
    fs::write(f.dir.join("content").join(REL), PIE).unwrap();
    f
}

fn open(f: &Fixture, s: &(String, String), rel: &str) -> Json {
    let response = handle(
        &f.state,
        &authed(
            req(
                "GET",
                &format!("/admin/api/document?path={}", path_query(rel)),
            ),
            s,
            false,
        ),
    );
    assert_eq!(
        response.status,
        200,
        "{}",
        String::from_utf8_lossy(&response.body)
    );
    body_json(&response)
}

fn put(f: &Fixture, s: &(String, String), rel: &str, body: Json) -> Response {
    handle(
        &f.state,
        &authed(
            json_req(
                "PUT",
                &format!("/admin/api/document?path={}", path_query(rel)),
                body,
            ),
            s,
            true,
        ),
    )
}

fn post(f: &Fixture, s: &(String, String), body: Json) -> Response {
    handle(
        &f.state,
        &authed(json_req("POST", "/admin/api/document", body), s, true),
    )
}

fn git_site(f: &Fixture) -> crate::git::Git {
    let git = crate::git::Git::new(&f.dir);
    git.init().unwrap();
    git.run(&["config", "user.email", "t@example.com"]).unwrap();
    git.run(&["config", "user.name", "T"]).unwrap();
    git.run(&["config", "commit.gpgsign", "false"]).unwrap();
    git
}

fn commit_all(git: &crate::git::Git, message: &str) {
    git.run(&["add", "-A"]).unwrap();
    git.run(&["commit", "-q", "-m", message]).unwrap();
}

fn edit_config(f: &Fixture, change: impl FnOnce(&mut Json)) {
    let path = f.dir.join("openblog.json");
    let mut config: Json = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
    change(&mut config);
    fs::write(&path, serde_json::to_string_pretty(&config).unwrap()).unwrap();
}

#[test]
fn a_post_says_what_it_is_where_it_lives_and_its_excerpt() {
    let f = bread_site("about-facts");
    let s = login_ok(&f);
    let doc = open(&f, &s, REL);
    assert_eq!(doc["status"], "draft");
    assert_eq!(doc["slug"], "pumpkin-bread");
    assert!(
        doc["url"].as_str().unwrap().contains("pumpkin-bread"),
        "{doc}"
    );
    // The excerpt is the engine's own, from the words, not her summary.
    assert!(
        doc["excerpt"]
            .as_str()
            .unwrap()
            .starts_with("My mother's bread."),
        "{doc}"
    );
    // Not in Git: nothing can show it was never on the site, so it counts as having been.
    assert_eq!(doc["wasPublished"], true);
    // A published post says so, and was on the site.
    let rel = "posts/2020-01-01-live.md";
    fs::write(
        f.dir.join("content").join(rel),
        "---\ntitle: Live\ndate: 2020-01-01\n---\n\nUp.\n",
    )
    .unwrap();
    let live = open(&f, &s, rel);
    assert_eq!(live["status"], "published");
    assert_eq!(live["wasPublished"], true);
}

#[test]
fn a_draft_never_committed_was_never_published_and_one_committed_live_was() {
    let f = bread_site("about-history");
    let s = login_ok(&f);
    let git = git_site(&f);
    // Everything else committed; the draft too, but only as a draft.
    commit_all(&git, "start");
    assert_eq!(
        open(&f, &s, REL)["wasPublished"],
        false,
        "a draft only ever committed as a draft"
    );
    // It went live once (not a draft, dated in the past when committed)...
    fs::write(
        f.dir.join("content").join(REL),
        PIE.replace("draft: true\n", ""),
    )
    .unwrap();
    commit_all(&git, "publish");
    // ...and is a draft again now.
    fs::write(f.dir.join("content").join(REL), PIE).unwrap();
    commit_all(&git, "draft again");
    let doc = open(&f, &s, REL);
    assert_eq!(doc["status"], "draft");
    assert_eq!(doc["wasPublished"], true);
}

#[test]
fn a_draft_scheduled_in_history_but_never_reached_was_not_published() {
    let f = fixture("about-future");
    let s = login_ok(&f);
    let git = git_site(&f);
    let rel = "posts/2099-01-01-later.md";
    fs::write(
        f.dir.join("content").join(rel),
        "---\ntitle: Later\ndate: 2099-01-01\n---\n\nSoon.\n",
    )
    .unwrap();
    commit_all(&git, "scheduled far ahead");
    fs::write(
        f.dir.join("content").join(rel),
        "---\ntitle: Later\ndate: 2099-01-01\ndraft: true\n---\n\nSoon.\n",
    )
    .unwrap();
    let doc = open(&f, &s, rel);
    assert_eq!(doc["status"], "draft");
    assert_eq!(doc["wasPublished"], false);
}

#[test]
fn changing_only_the_summary_rewrites_one_line_under_its_own_name() {
    let f = bread_site("about-summary");
    let s = login_ok(&f);
    let doc = open(&f, &s, REL);
    let response = put(
        &f,
        &s,
        REL,
        json!({ "fields": { "summary": "Moist, spiced and easy." }, "body": doc["body"], "etag": doc["etag"], "frontMatter": "keep" }),
    );
    assert_eq!(
        response.status,
        200,
        "{}",
        String::from_utf8_lossy(&response.body)
    );
    assert_eq!(body_json(&response)["layout"], "kept");
    assert_eq!(
        fs::read_to_string(f.dir.join("content").join(REL)).unwrap(),
        PIE.replace(
            "summary: Moist and spiced.",
            "summary: Moist, spiced and easy."
        )
    );
}

#[test]
fn a_refused_save_says_why_by_code() {
    let f = bread_site("about-codes");
    let s = login_ok(&f);
    let doc = open(&f, &s, REL);
    // Someone else changed it.
    let stale = put(
        &f,
        &s,
        REL,
        json!({ "fields": {}, "body": "x", "etag": "nope", "frontMatter": "keep" }),
    );
    assert_eq!(stale.status, 409);
    assert_eq!(body_json(&stale)["code"], "changed");
    // Who wrote it changed elsewhere.
    let credits = put(
        &f,
        &s,
        REL,
        json!({ "fields": {}, "body": doc["body"], "etag": doc["etag"], "frontMatter": "keep", "credits": [], "creditEtag": "old" }),
    );
    assert_eq!(credits.status, 409);
    assert_eq!(body_json(&credits)["code"], "credits-changed");
    // Too long.
    let big = put(
        &f,
        &s,
        REL,
        json!({ "fields": {}, "body": "x".repeat(MAX_DOCUMENT_BYTES + 1), "etag": doc["etag"] }),
    );
    assert_eq!(big.status, 413);
    assert_eq!(body_json(&big)["code"], "too-large");
    // Outside the content folder.
    let bad = put(
        &f,
        &s,
        "../openblog.json",
        json!({ "fields": {}, "body": "", "etag": "" }),
    );
    assert_eq!(bad.status, 400);
    assert_eq!(body_json(&bad)["code"], "bad-path");
    // A date that can't be read is named as the date's problem; the sentences stay as they were.
    let date = put(
        &f,
        &s,
        REL,
        json!({ "fields": { "date": "next friday", "draft": null }, "body": doc["body"], "etag": doc["etag"], "frontMatter": "keep" }),
    );
    assert_eq!(date.status, 422, "{}", String::from_utf8_lossy(&date.body));
    let answer = body_json(&date);
    assert_eq!(answer["code"], "date");
    assert_eq!(answer["issues"][0]["field"], "date");
    assert!(answer["problems"][0]
        .as_str()
        .unwrap()
        .contains("next friday"));
    // Comments that aren't one of the three.
    let comments = put(
        &f,
        &s,
        REL,
        json!({ "fields": { "comments": "maybe" }, "body": doc["body"], "etag": doc["etag"], "frontMatter": "keep" }),
    );
    assert_eq!(comments.status, 422);
    assert_eq!(body_json(&comments)["issues"][0]["code"], "comments");
    // A credit naming someone not in the registry.
    let unknown = put(
        &f,
        &s,
        REL,
        json!({ "fields": {}, "body": doc["body"], "etag": doc["etag"], "frontMatter": "keep",
            "credits": [{ "contributor": "ruth", "roles": [{ "vocabulary": "crossref", "role": "author" }] }], "creditEtag": null }),
    );
    assert_eq!(
        unknown.status,
        422,
        "{}",
        String::from_utf8_lossy(&unknown.body)
    );
    assert_eq!(
        body_json(&unknown)["issues"][0]["code"],
        "credit-unknown-person"
    );
    // Nothing was written by any of them.
    assert_eq!(
        fs::read_to_string(f.dir.join("content").join(REL)).unwrap(),
        PIE
    );
}

#[test]
fn a_new_post_whose_address_is_taken_says_which() {
    let f = bread_site("about-exists");
    let s = login_ok(&f);
    let by_title = post(
        &f,
        &s,
        json!({ "kind": "posts", "fields": { "title": "Pumpkin bread", "date": "2026-11-06", "draft": true }, "body": "x" }),
    );
    assert_eq!(by_title.status, 409);
    assert_eq!(body_json(&by_title)["code"], "exists");
    assert_eq!(body_json(&by_title)["slug"], false);
    let by_slug = post(
        &f,
        &s,
        json!({ "kind": "posts", "fields": { "title": "Other", "slug": "pumpkin-bread", "date": "2026-11-06", "draft": true }, "body": "x" }),
    );
    assert_eq!(by_slug.status, 409);
    assert_eq!(body_json(&by_slug)["slug"], true);
    // Another post's address taken by a new name in the same day's file: the build says slug-taken.
    let taken = post(
        &f,
        &s,
        json!({ "kind": "posts", "fields": { "title": "Bread two", "slug": "pumpkin-bread", "date": "2026-11-07", "draft": true }, "body": "x" }),
    );
    assert_eq!(
        taken.status,
        422,
        "{}",
        String::from_utf8_lossy(&taken.body)
    );
    let answer = body_json(&taken);
    assert_eq!(answer["code"], "slug-taken");
    assert_eq!(answer["issues"][0]["field"], "slug");
}

#[test]
fn meta_says_how_scheduled_posts_go_up_and_how_profile_fields_are_drawn() {
    let f = fixture("about-meta");
    let s = login_ok(&f);
    let meta = || {
        body_json(&handle(
            &f.state,
            &authed(req("GET", "/admin/api/meta"), &s, false),
        ))
    };
    let first = meta();
    // Not in Git: this server's build is the site, so a scheduled post goes up by itself.
    assert_eq!(first["schedule"], "self");
    assert_eq!(first["siteUses"]["pinterest"], false);
    let video = first["profiles"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["id"] == "video")
        .unwrap()
        .clone();
    let field = |key: &str| {
        video["fields"]
            .as_array()
            .unwrap()
            .iter()
            .find(|f| f["key"] == key)
            .unwrap()
            .clone()
    };
    assert_eq!(field("videoUrl")["kind"], "url");
    assert_eq!(field("videoFile")["kind"], "path");
    assert_eq!(field("madeForKids")["kind"], "choice");
    assert_eq!(
        field("madeForKids")["choices"],
        json!([{ "value": "yes" }, { "value": "no" }])
    );
    assert_eq!(field("productionStatus")["kind"], "production-status");
    assert_eq!(field("productionStatus")["choices"][6]["value"], "released");
    assert_eq!(field("videoTitle")["max"], 100);
    edit_config(&f, |config| {
        config["syndication"]["pinterest"] = json!({ "enabled": true, "board": "1" });
    });
    assert_eq!(meta()["siteUses"]["pinterest"], true);
    // Sent to a remote by hand: the live site is built elsewhere.
    let git = git_site(&f);
    git.run(&["remote", "add", "origin", "https://example.com/blog.git"])
        .unwrap();
    assert_eq!(meta()["schedule"], "next-send");
    let publish = body_json(&handle(
        &f.state,
        &authed(req("GET", "/admin/api/publish"), &s, false),
    ));
    assert_eq!(publish["mode"], "by-hand");
    assert_eq!(publish["schedule"], "next-send");
    assert!(publish.get("nextDue").is_some());
    // Sent out after every save, pages and all: it goes up by itself again.
    edit_config(&f, |config| {
        config["publish"] = json!({ "auto": true, "paths": ["content", "dist"] });
    });
    assert_eq!(meta()["schedule"], "self");
}

#[test]
fn a_scheduled_post_is_sent_out_when_it_goes_up_on_a_site_that_sends_itself_out() {
    let f = fixture("about-scheduled-send");
    let s = login_ok(&f);
    let git = git_site(&f);
    let remote = f.dir.with_extension("remote.git");
    let _ = fs::remove_dir_all(&remote);
    fs::create_dir_all(&remote).unwrap();
    crate::git::Git::new(&remote)
        .run(&["init", "--bare", "-q"])
        .unwrap();
    git.run(&["remote", "add", "origin", remote.to_str().unwrap()])
        .unwrap();
    // The built pages are what's sent out here, so they're kept in Git.
    fs::write(f.dir.join(".gitignore"), "/.openblog\n").unwrap();
    edit_config(&f, |config| {
        config["publish"] = json!({ "auto": true, "paths": ["content", "openblog.json", "dist"], "pullFirst": false });
    });
    commit_all(&git, "start");
    let branch = git.current_branch().unwrap();
    edit_config(&f, |config| {
        config["publish"]["branch"] = json!(branch);
    });
    commit_all(&git, "branch");
    git.run(&["push", "-q", "origin", &branch]).unwrap();
    // A post due in a moment.
    let soon = DateTime::from_unix(clock::now().unix() + 2).rfc3339();
    let created = post(
        &f,
        &s,
        json!({ "kind": "posts", "fields": { "title": "Thanksgiving morning", "date": soon }, "body": "Up by itself." }),
    );
    assert_eq!(
        created.status,
        201,
        "{}",
        String::from_utf8_lossy(&created.body)
    );
    assert_eq!(body_json(&created)["status"], "scheduled");
    std::thread::sleep(Duration::from_millis(3500));
    assert!(
        f.state.tick_scheduler().is_some(),
        "the scheduler rebuilt when it was due"
    );
    let remote_git = crate::git::Git::new(&remote);
    let mut log = String::new();
    for _ in 0..100 {
        log = remote_git
            .run(&["log", "--format=%s", &branch])
            .unwrap_or_default();
        if log.contains("Publish scheduled post Thanksgiving morning") {
            break;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    assert!(
        log.contains("Publish: Publish scheduled post Thanksgiving morning"),
        "{log}"
    );
    let _ = fs::remove_dir_all(&remote);
}

#[test]
fn the_registry_refuses_by_code_and_names_the_posts_that_name_someone() {
    let f = bread_site("about-people");
    let s = login_ok(&f);
    let registry = || {
        body_json(&handle(
            &f.state,
            &authed(req("GET", "/admin/api/contributors"), &s, false),
        ))
    };
    let save = |body: Json| {
        handle(
            &f.state,
            &authed(json_req("PUT", "/admin/api/contributors", body), &s, true),
        )
    };
    let start = registry();
    let added = save(
        json!({ "etag": start["etag"], "contributors": { "ruth": { "name": "Ruth Nichols", "url": "https://ruthbakes.com" } } }),
    );
    assert_eq!(
        added.status,
        200,
        "{}",
        String::from_utf8_lossy(&added.body)
    );
    // An old etag.
    let stale = save(json!({ "etag": start["etag"], "contributors": {} }));
    assert_eq!(stale.status, 409);
    assert_eq!(body_json(&stale)["code"], "changed");
    // A website that isn't one.
    let now = registry();
    let invalid = save(
        json!({ "etag": now["etag"], "contributors": { "ruth": { "name": "Ruth Nichols", "url": "ruthbakes" } } }),
    );
    assert_eq!(invalid.status, 422);
    assert_eq!(body_json(&invalid)["code"], "invalid");
    assert_eq!(body_json(&invalid)["field"], "url");
    // Named on the pumpkin bread: she stays, and the post is named by its title.
    let doc = open(&f, &s, REL);
    let credited = put(
        &f,
        &s,
        REL,
        json!({ "fields": {}, "body": doc["body"], "etag": doc["etag"], "frontMatter": "keep",
            "credits": [{ "contributor": "ruth", "roles": [{ "vocabulary": "crossref", "role": "author" }] }], "creditEtag": null }),
    );
    assert_eq!(
        credited.status,
        200,
        "{}",
        String::from_utf8_lossy(&credited.body)
    );
    let refused = save(json!({ "etag": registry()["etag"], "contributors": {} }));
    assert_eq!(refused.status, 422);
    let answer = body_json(&refused);
    assert_eq!(answer["code"], "named-on-posts");
    assert_eq!(
        answer["posts"],
        json!([{ "path": REL, "title": "Pumpkin bread" }])
    );
    assert!(
        registry()["contributors"]["ruth"].is_object(),
        "nothing changed"
    );
}

#[test]
fn a_credit_file_that_cant_be_read_never_stops_the_title_saving() {
    let f = bread_site("about-broken-credits");
    let s = login_ok(&f);
    let sidecar = f
        .dir
        .join("content/posts/2026-11-06-pumpkin-bread.credits.json");
    fs::write(&sidecar, "{ not json").unwrap();
    let doc = open(&f, &s, REL);
    assert!(doc["creditError"].is_string(), "{doc}");
    let saved = put(
        &f,
        &s,
        REL,
        json!({ "fields": { "title": "Pumpkin loaf" }, "body": doc["body"], "etag": doc["etag"], "frontMatter": "keep" }),
    );
    assert_eq!(
        saved.status,
        200,
        "{}",
        String::from_utf8_lossy(&saved.body)
    );
    assert!(fs::read_to_string(f.dir.join("content").join(REL))
        .unwrap()
        .contains("title: Pumpkin loaf"));
    assert_eq!(
        fs::read_to_string(&sidecar).unwrap(),
        "{ not json",
        "the broken file is left as it is"
    );
    // Changing who wrote it still answers for the file: repaired by replacing it.
    let doc = open(&f, &s, REL);
    let repaired = put(
        &f,
        &s,
        REL,
        json!({ "fields": {}, "body": doc["body"], "etag": doc["etag"], "frontMatter": "keep", "credits": null, "creditEtag": doc["creditEtag"] }),
    );
    assert_eq!(
        repaired.status,
        200,
        "{}",
        String::from_utf8_lossy(&repaired.body)
    );
    assert!(!sidecar.exists());
}
