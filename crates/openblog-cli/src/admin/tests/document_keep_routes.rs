//! Studio slice 2: a save with `"frontMatter": "keep"` changes only the values
//! that changed, and `POST document/restore` puts a deleted post back exactly.

use super::*;

const PIE: &str = "---\ntitle: Grammi's Pumpkin Pie\ndate: 2026-11-06\ndraft: true\nseries: thanksgiving\nprofile: recipe\nservings: 8\nprep: 15 min\ncook: 30 min\ntags: [thanksgiving]\ndescription: \"One sentence: about pie.\"\ncover: \"\"\n---\n\n\nThe story.\n\n## Ingredients\n\n- 1 can pumpkin\n\n## Steps\n\n1. Bake for 45 minutes.\n";
const REL: &str = "posts/2026-11-06-pumpkin-pie.md";

fn pie_site(tag: &str) -> Fixture {
    let f = fixture(tag);
    fs::write(f.dir.join("content").join(REL), PIE).unwrap();
    f
}

fn open(f: &Fixture, s: &(String, String)) -> Json {
    let response = handle(&f.state, &authed(req("GET", &format!("/admin/api/document?path={}", REL.replace('/', "%2F"))), s, false));
    assert_eq!(response.status, 200, "{}", String::from_utf8_lossy(&response.body));
    body_json(&response)
}

fn save(f: &Fixture, s: &(String, String), body: Json) -> Response {
    handle(&f.state, &authed(json_req("PUT", &format!("/admin/api/document?path={}", REL.replace('/', "%2F")), body), s, true))
}

fn on_disk(f: &Fixture) -> String {
    fs::read_to_string(f.dir.join("content").join(REL)).unwrap()
}

#[test]
fn keep_changes_only_the_changed_line() {
    let f = pie_site("keep-one-line");
    let s = login_ok(&f);
    let doc = open(&f, &s);
    let mut fields = doc["fields"].clone();
    fields["servings"] = json!("10");
    let response = save(&f, &s, json!({ "fields": fields, "body": doc["body"], "etag": doc["etag"], "frontMatter": "keep" }));
    assert_eq!(response.status, 200, "{}", String::from_utf8_lossy(&response.body));
    assert_eq!(body_json(&response)["layout"], "kept");
    assert_eq!(on_disk(&f), PIE.replace("servings: 8", "servings: 10"));
}

#[test]
fn keep_publishing_removes_only_the_draft_line_and_body_edits_stay_local() {
    let f = pie_site("keep-publish");
    let s = login_ok(&f);
    let doc = open(&f, &s);
    let mut fields = doc["fields"].clone();
    fields["draft"] = Json::Null;
    let body = doc["body"].as_str().unwrap().trim_start().replace("1 can pumpkin", "1 can (15 oz) pumpkin");
    let response = save(&f, &s, json!({ "fields": fields, "body": body, "etag": doc["etag"], "frontMatter": "keep" }));
    assert_eq!(response.status, 200, "{}", String::from_utf8_lossy(&response.body));
    assert_eq!(on_disk(&f), PIE.replace("draft: true\n", "").replace("1 can pumpkin", "1 can (15 oz) pumpkin"));
}

#[test]
fn without_keep_the_file_is_written_the_usual_way() {
    let f = pie_site("keep-off");
    let s = login_ok(&f);
    let doc = open(&f, &s);
    let mut fields = doc["fields"].clone();
    fields["servings"] = json!("10");
    let response = save(&f, &s, json!({ "fields": fields, "body": doc["body"], "etag": doc["etag"] }));
    assert_eq!(body_json(&response)["layout"], "rewritten");
    assert!(on_disk(&f).contains("draft: \"true\""));
}

fn delete(f: &Fixture, s: &(String, String)) -> Json {
    let response = handle(&f.state, &authed(req("DELETE", &format!("/admin/api/document?path={}", REL.replace('/', "%2F"))), s, true));
    assert_eq!(response.status, 200, "{}", String::from_utf8_lossy(&response.body));
    body_json(&response)
}

fn restore(f: &Fixture, s: &(String, String), body: Json) -> Response {
    handle(&f.state, &authed(json_req("POST", "/admin/api/document/restore", body), s, true))
}

#[test]
fn restore_puts_a_deleted_post_back_byte_for_byte() {
    let f = pie_site("restore-ok");
    let s = login_ok(&f);
    let deleted = delete(&f, &s);
    assert!(!f.dir.join("content").join(REL).exists());
    let response = restore(&f, &s, json!({ "path": REL, "trashedTo": deleted["trashedTo"], "trashedCreditsTo": deleted["trashedCreditsTo"], "trashedContextTo": deleted["trashedContextTo"] }));
    assert_eq!(response.status, 200, "{}", String::from_utf8_lossy(&response.body));
    assert_eq!(on_disk(&f), PIE);
    let reply = body_json(&response);
    assert_eq!(reply["path"], REL);
    assert_eq!(reply["status"], "draft");
    // Once back, the trash file is used up: a second Undo says so.
    let again = restore(&f, &s, json!({ "path": REL, "trashedTo": deleted["trashedTo"] }));
    assert_eq!(again.status, 404);
}

#[test]
fn restore_refuses_names_that_are_not_this_posts_and_requires_csrf() {
    let f = pie_site("restore-refuse");
    let s = login_ok(&f);
    let deleted = delete(&f, &s);
    let name = deleted["trashedTo"].as_str().unwrap().to_string();
    for bad in ["../config.json", "x-posts_other.md", ".hidden-posts_2026-11-06-pumpkin-pie.md", "a/b-posts_2026-11-06-pumpkin-pie.md"] {
        assert_eq!(restore(&f, &s, json!({ "path": REL, "trashedTo": bad })).status, 422, "{bad}");
    }
    assert_eq!(restore(&f, &s, json!({ "path": "posts/other.md", "trashedTo": name })).status, 422);
    assert_eq!(restore(&f, &s, json!({ "path": REL, "trashedTo": name, "trashedTrackTo": "t.gpx" })).status, 422);
    let no_csrf = handle(&f.state, &authed(json_req("POST", "/admin/api/document/restore", json!({ "path": REL, "trashedTo": name })), &s, false));
    assert_eq!(no_csrf.status, 403);
    fs::write(f.dir.join("content").join(REL), "---\ntitle: New\n---\nx\n").unwrap();
    assert_eq!(restore(&f, &s, json!({ "path": REL, "trashedTo": name })).status, 409);
}

#[test]
fn keep_leaves_keys_the_request_left_out_and_says_why_it_cannot_keep() {
    let f = pie_site("keep-omitted");
    let s = login_ok(&f);
    let doc = open(&f, &s);
    let mut fields = doc["fields"].clone();
    fields.as_object_mut().unwrap().remove("series");
    fields["servings"] = json!("6");
    let response = save(&f, &s, json!({ "fields": fields, "body": doc["body"], "etag": doc["etag"], "frontMatter": "keep" }));
    assert_eq!(response.status, 200);
    assert_eq!(on_disk(&f), PIE.replace("servings: 8", "servings: 6"), "a key left out is kept; only null removes");

    fs::write(f.dir.join("content").join(REL), PIE.replace("title: Grammi's Pumpkin Pie\n", "title: Grammi's Pumpkin Pie\ntitle: Pie\n")).unwrap();
    let doc = open(&f, &s);
    if doc["fields"].is_object() {
        let response = save(&f, &s, json!({ "fields": doc["fields"], "body": doc["body"], "etag": doc["etag"], "frontMatter": "keep" }));
        let reply = body_json(&response);
        assert_eq!(reply["layout"], "rewritten");
        assert!(reply["layoutReason"].as_str().unwrap().contains("written twice"), "{reply}");
    }
}

#[test]
fn delete_with_a_stale_etag_deletes_nothing() {
    let f = pie_site("delete-etag");
    let s = login_ok(&f);
    let response = handle(&f.state, &authed(req("DELETE", &format!("/admin/api/document?path={}&etag=stale", REL.replace('/', "%2F"))), &s, true));
    assert_eq!(response.status, 409);
    assert!(f.dir.join("content").join(REL).exists());
}
