//! `GET /admin/api/distribution` (#403, #404; ADRs 0402 to 0404): behind the session, read-only,
//! bounded in days, and the same report the CLI prints.

use super::*;

#[test]
fn the_report_needs_a_session_reads_only_and_checks_its_days() {
    let f = fixture("distribution");
    let unauthenticated = handle(&f.state, &req("GET", "/admin/api/distribution"));
    assert_eq!(unauthenticated.status, 401);
    let session = login_ok(&f);
    let before: Vec<_> = fs::read_dir(f.dir.join(".openblog"))
        .unwrap()
        .map(|e| e.unwrap().file_name())
        .collect();
    let answer = handle(
        &f.state,
        &authed(req("GET", "/admin/api/distribution"), &session, false),
    );
    assert_eq!(
        answer.status,
        200,
        "{}",
        String::from_utf8_lossy(&answer.body)
    );
    let report = body_json(&answer);
    assert_eq!(report["version"], 1);
    assert_eq!(report["days"], 30);
    assert_eq!(report["reached"], 0);
    assert_eq!(report["visitsAvailable"], true);
    let after: Vec<_> = fs::read_dir(f.dir.join(".openblog"))
        .unwrap()
        .map(|e| e.unwrap().file_name())
        .collect();
    assert_eq!(before, after, "reading the report writes nothing");
    for bad in ["0", "401", "x", "-1"] {
        let answer = handle(
            &f.state,
            &authed(
                req("GET", &format!("/admin/api/distribution?days={bad}")),
                &session,
                false,
            ),
        );
        assert_eq!(answer.status, 400, "{bad}");
    }
    let week = handle(
        &f.state,
        &authed(
            req("GET", "/admin/api/distribution?days=7"),
            &session,
            false,
        ),
    );
    assert_eq!(body_json(&week)["days"], 7);
    let post = handle(
        &f.state,
        &authed(
            json_req("POST", "/admin/api/distribution", json!({})),
            &session,
            true,
        ),
    );
    assert_ne!(post.status, 200);
}

#[test]
fn a_shared_job_shows_up_against_its_post_with_its_evidence() {
    let f = fixture("distribution-job");
    let session = login_ok(&f);
    fs::write(
        f.dir.join(crate::job_share::STATE_FILE),
        r#"{"version":1,"jobs":{"posts/hello-world.md":{"nextdoor":{"status":"posted-by-hand","at":"2026-11-03T10:00:00Z","digest":"x"}}}}"#,
    )
    .unwrap();
    let report = body_json(&handle(
        &f.state,
        &authed(req("GET", "/admin/api/distribution"), &session, false),
    ));
    assert_eq!(report["reached"], 1, "{report}");
    let row = &report["posts"][0]["destinations"][0];
    assert_eq!(row["destination"], "nextdoor");
    assert_eq!(row["evidence"], "author");
}

#[test]
fn meta_says_the_site_has_shared_something_once_a_record_holds_a_row() {
    // G16: Sharing shows "Where it went" on a site without social accounts once anything went out.
    let f = fixture("distribution-shared");
    let session = login_ok(&f);
    let meta = |f: &Fixture| {
        body_json(&handle(
            &f.state,
            &authed(req("GET", "/admin/api/meta"), &session, false),
        ))
    };
    assert_eq!(meta(&f)["siteUses"]["shared"], false);
    fs::create_dir_all(f.dir.join(".openblog")).unwrap();
    fs::write(
        f.dir.join(crate::job_share::STATE_FILE),
        json!({"version": 1, "jobs": {}}).to_string(),
    )
    .unwrap();
    assert_eq!(
        meta(&f)["siteUses"]["shared"],
        false,
        "an empty record is not sharing"
    );
    fs::write(
        f.dir.join(crate::job_share::STATE_FILE),
        json!({"version": 1, "jobs": {"posts/hello.md": {"nextdoor": {"status": "posted-by-hand", "at": "2026-10-22T10:00:00Z", "digest": "d"}}}}).to_string(),
    )
    .unwrap();
    assert_eq!(meta(&f)["siteUses"]["shared"], true);
}
