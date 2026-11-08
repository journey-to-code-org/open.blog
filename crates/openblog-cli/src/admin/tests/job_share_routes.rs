//! The Share this job routes (story #488, ADR 0396): deny by default, every place's preview and
//! where it stands, a Facebook Page reached through the announcements when the job has no photo,
//! and a by-hand mark that holds only for exactly what was shown. Nothing here sends anything.

use super::*;

const PATH: &str = "/admin/api/job-share";
const JOB: &str = "---\ntitle: New oak floor in Maple Falls\ndate: 2026-10-21\ndescription: Sanded, stained and sealed a worn oak floor.\nprofile: job\njob:\n  trade: flooring\n  service: hardwood-install\n  place:\n    town: Maple Falls\n    region: WA\n  started: 2026-10-14\n  finished: 2026-10-16\n---\nDone.\n";

fn job_site(tag: &str) -> Fixture {
    let f = fixture(tag);
    let config = f.dir.join(site::CONFIG_FILE);
    let mut value: Json = serde_json::from_str(&fs::read_to_string(&config).unwrap()).unwrap();
    value["url"] = json!("https://floors.example.org");
    fs::write(&config, serde_json::to_string_pretty(&value).unwrap()).unwrap();
    fs::write(f.dir.join("content/posts/floor.md"), JOB).unwrap();
    f
}

fn get(f: &Fixture, session: &(String, String), path: &str) -> Response {
    handle(
        &f.state,
        &authed(
            req("GET", &format!("{PATH}?path={}", path.replace('/', "%2F"))),
            session,
            false,
        ),
    )
}

fn by_hand(f: &Fixture, session: &(String, String), body: Json) -> Response {
    handle(
        &f.state,
        &authed(
            json_req("POST", &format!("{PATH}/by-hand"), body),
            session,
            true,
        ),
    )
}

fn place<'a>(described: &'a Json, destination: &str) -> &'a Json {
    described["destinations"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["destination"] == destination)
        .unwrap()
}

#[test]
fn the_share_routes_deny_by_default_and_require_csrf() {
    let f = job_site("job-share-auth");
    assert_eq!(
        handle(
            &f.state,
            &req("GET", &format!("{PATH}?path=posts%2Ffloor.md"))
        )
        .status,
        401
    );
    let body = json!({"path": "posts/floor.md", "destination": "nextdoor", "digest": "x"});
    assert_eq!(
        handle(
            &f.state,
            &json_req("POST", &format!("{PATH}/by-hand"), body.clone())
        )
        .status,
        401
    );
    let session = login_ok(&f);
    let no_csrf = authed(
        json_req("POST", &format!("{PATH}/by-hand"), body),
        &session,
        false,
    );
    assert_eq!(handle(&f.state, &no_csrf).status, 403);
}

#[test]
fn every_place_is_shown_with_where_it_stands_and_nothing_is_sent() {
    let f = job_site("job-share-get");
    let session = login_ok(&f);
    let response = get(&f, &session, "posts/floor.md");
    assert_eq!(
        response.status,
        200,
        "{}",
        String::from_utf8_lossy(&response.body)
    );
    let described = body_json(&response);
    assert_eq!(described["title"], "New oak floor in Maple Falls");
    assert_eq!(described["path"], "posts/floor.md");
    assert_eq!(described["googleSending"], false);
    assert_eq!(described["destinations"].as_array().unwrap().len(), 3);
    for destination in ["google-business-profile", "facebook", "nextdoor"] {
        let item = place(&described, destination);
        assert_eq!(item["record"], Json::Null, "{destination}");
        assert_eq!(item["ready"], true, "{destination}: {item}");
    }
    // With no photo, a Facebook Page is reached through the announcements' Page adapter (SP5).
    assert_eq!(place(&described, "facebook")["route"], "adapter");
    assert_eq!(place(&described, "nextdoor")["route"], "by-hand");
    assert!(place(&described, "nextdoor")["openUrl"]
        .as_str()
        .unwrap()
        .starts_with("https://nextdoor.com/sharekit/"));
    assert_eq!(
        described["work"],
        place(&described, "facebook")["link"]
            .as_str()
            .unwrap()
            .trim_start_matches("https://floors.example.org")
    );
    assert!(!f.dir.join(crate::job_share::STATE_FILE).exists());
}

#[test]
fn a_by_hand_mark_holds_only_for_what_was_shown_and_shows_as_the_standing() {
    let f = job_site("job-share-mark");
    let session = login_ok(&f);
    let described = body_json(&get(&f, &session, "posts/floor.md"));
    let digest = place(&described, "nextdoor")["digest"]
        .as_str()
        .unwrap()
        .to_string();
    let stale = by_hand(
        &f,
        &session,
        json!({"path": "posts/floor.md", "destination": "nextdoor", "digest": "0000"}),
    );
    assert_eq!(stale.status, 409);
    assert_eq!(body_json(&stale)["code"], "changed");
    assert!(!f.dir.join(crate::job_share::STATE_FILE).exists());
    let marked = by_hand(
        &f,
        &session,
        json!({"path": "posts/floor.md", "destination": "nextdoor", "digest": digest}),
    );
    assert_eq!(
        marked.status,
        200,
        "{}",
        String::from_utf8_lossy(&marked.body)
    );
    let again = body_json(&get(&f, &session, "posts/floor.md"));
    assert_eq!(
        place(&again, "nextdoor")["record"]["status"],
        "posted-by-hand"
    );
    assert_eq!(place(&again, "nextdoor")["changedSince"], false);
    assert_eq!(place(&again, "facebook")["record"], Json::Null);
    // The job changes: the standing says so.
    fs::write(
        f.dir.join("content/posts/floor.md"),
        JOB.replace("worn oak floor", "worn maple floor"),
    )
    .unwrap();
    let changed = body_json(&get(&f, &session, "posts/floor.md"));
    assert_eq!(place(&changed, "nextdoor")["changedSince"], true);
    let unknown = by_hand(
        &f,
        &session,
        json!({"path": "posts/floor.md", "destination": "twitter", "digest": digest}),
    );
    assert_eq!(unknown.status, 400);
}

#[test]
fn a_draft_or_a_post_that_is_not_a_job_is_not_shared() {
    let f = job_site("job-share-refused");
    let session = login_ok(&f);
    fs::write(
        f.dir.join("content/posts/draft.md"),
        JOB.replace("profile: job", "draft: true\nprofile: job"),
    )
    .unwrap();
    fs::write(
        f.dir.join("content/posts/note.md"),
        "---\ntitle: Note\ndate: 2026-10-01\n---\nHi.\n",
    )
    .unwrap();
    for path in ["posts/draft.md", "posts/note.md", "posts/missing.md"] {
        let response = get(&f, &session, path);
        assert_eq!(response.status, 422, "{path}");
        assert_eq!(body_json(&response)["code"], "not-shareable");
    }
    assert_eq!(
        handle(&f.state, &authed(req("GET", PATH), &session, false)).status,
        400
    );
}
