//! The ten-minute checklist route (ADR 0401, #529): behind the session, read-only, and every step
//! reflects the files on disk, ticking and unticking with them, never with clicks.

use super::*;

const PATH: &str = "/admin/api/trade-checklist";

fn trade_fixture(tag: &str) -> Fixture {
    let dir = std::env::temp_dir().join(format!("ob-admin-{tag}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    let starter = scaffold::Starter::parse("trade", Some("flooring")).unwrap();
    scaffold::init_with(&dir, Some("Maple Falls Flooring"), false, Some(&starter)).unwrap();
    let mut users = Users::default();
    users.set("mikey", "correct horse battery").unwrap();
    users.save(&dir.join(".openblog/users.json")).unwrap();
    let state = Arc::new(AppState::new(dir.clone(), None, false, true));
    state.rebuild().unwrap();
    Fixture { state, dir }
}

fn checklist(f: &Fixture, session: &(String, String)) -> Json {
    let response = handle(&f.state, &authed(req("GET", PATH), session, false));
    assert_eq!(
        response.status,
        200,
        "{}",
        String::from_utf8_lossy(&response.body)
    );
    body_json(&response)
}

fn done(list: &Json) -> Vec<&str> {
    list["steps"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|step| step["done"] == true)
        .map(|step| step["id"].as_str().unwrap())
        .collect()
}

fn edit_config(f: &Fixture, change: impl FnOnce(&mut Json)) {
    let path = f.dir.join(site::CONFIG_FILE);
    let mut config: Json = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
    change(&mut config);
    fs::write(&path, config.to_string()).unwrap();
}

#[test]
fn the_checklist_needs_a_session_and_only_reads() {
    let f = trade_fixture("trade-checklist-auth");
    let response = handle(&f.state, &req("GET", PATH));
    assert_eq!(response.status, 401);
    let session = login_ok(&f);
    let before = fs::read_to_string(f.dir.join(site::CONFIG_FILE)).unwrap();
    checklist(&f, &session);
    assert_eq!(
        fs::read_to_string(f.dir.join(site::CONFIG_FILE)).unwrap(),
        before
    );
    let post = handle(
        &f.state,
        &authed(json_req("POST", PATH, json!({})), &session, true),
    );
    assert_ne!(post.status, 200);
}

#[test]
fn a_plain_blog_is_not_offered_the_checklist() {
    let f = fixture("trade-checklist-plain");
    let session = login_ok(&f);
    assert_eq!(checklist(&f, &session)["applies"], false);
}

#[test]
fn each_step_ticks_from_the_files_and_unticks_when_they_go() {
    let f = trade_fixture("trade-checklist-steps");
    let session = login_ok(&f);
    let fresh = checklist(&f, &session);
    assert_eq!(fresh["applies"], true);
    assert_eq!(fresh["total"], 5);
    assert_eq!(fresh["done"], 0, "the starter's own files tick nothing");
    assert!(done(&fresh).is_empty());

    // Business facts: a way to reach the business.
    edit_config(&f, |config| {
        config["business"]["phone"] = json!("+13605550142")
    });
    assert_eq!(done(&checklist(&f, &session)), ["business"]);

    // A first service: publishing one of the example drafts.
    let service = f.dir.join("content/services/repairs.md");
    let draft = fs::read_to_string(&service).unwrap();
    let live: String = draft
        .lines()
        .filter(|line| !line.starts_with("draft:"))
        .map(|line| format!("{line}\n"))
        .collect();
    fs::write(&service, &live).unwrap();
    assert_eq!(done(&checklist(&f, &session)), ["business", "service"]);

    // A first job, and sharing then points at it.
    fs::write(
        f.dir.join("content/posts/oak.md"),
        "---\ntitle: New oak floor\ndate: 2026-10-21\nprofile: job\njob:\n  trade: flooring\n  service: repairs\n  place:\n    town: Bend\n    region: OR\n  started: 2026-10-20\n  finished: 2026-10-21\n---\nDone.\n",
    )
    .unwrap();
    let list = checklist(&f, &session);
    assert_eq!(done(&list), ["business", "service", "job"]);
    let destination = list["steps"]
        .as_array()
        .unwrap()
        .iter()
        .find(|step| step["id"] == "destination")
        .unwrap();
    assert_eq!(destination["href"], "#/edit/posts%2Foak.md");

    // A first review.
    fs::write(
        f.dir.join("content/proof/dana.md"),
        "---\nversion: 1\nid: dana\nauthor: Dana R.\ndate: 2026-10-22\nplatform: google\nsourceUrl: https://g.page/r/maple/review\nrating: 5\n---\nGreat floor.\n",
    )
    .unwrap();
    assert_eq!(done(&checklist(&f, &session)).len(), 4);

    // A place to share jobs: a job posted by hand somewhere.
    let record = f.dir.join(crate::job_share::STATE_FILE);
    fs::create_dir_all(record.parent().unwrap()).unwrap();
    fs::write(
        &record,
        r#"{"version":1,"jobs":{"posts/oak.md":{"nextdoor":{"status":"posted-by-hand","at":"2026-10-23T10:00:00Z","digest":"abc"}}}}"#,
    )
    .unwrap();
    let all = checklist(&f, &session);
    assert_eq!(all["done"], 5, "{all}");

    // Taking a thing away unticks its step: the list follows the files, not clicks.
    fs::write(&service, &draft).unwrap();
    fs::remove_file(f.dir.join("content/proof/dana.md")).unwrap();
    let back = checklist(&f, &session);
    assert!(!done(&back).contains(&"service"));
    assert!(!done(&back).contains(&"review"));
    assert_eq!(back["done"], 3);
}
