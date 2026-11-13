//! Studio slice 3: saving seasons leaves `openblog.json` as the owner wrote it except the values
//! that changed, "put it up now" (`seasons.upNow`) wins until its last day and undoes byte for
//! byte, and `POST seasons/preview` dresses the home page in a look without writing anything.

use super::*;

const PATH: &str = "/admin/api/seasons";

/// Two looks the fixture has, and a config with Grammi's layout: keys in documented order, one
/// window per object.
fn house(tag: &str) -> (Fixture, String, String) {
    let f = fixture(tag);
    let s = login_ok(&f);
    let got = body_json(&handle(&f.state, &authed(req("GET", PATH), &s, false)));
    let names: Vec<String> = got["themes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["name"].as_str().unwrap().to_string())
        .collect();
    let first = names[0].clone();
    let second = names.get(1).cloned().unwrap_or_else(|| first.clone());
    let config = f.dir.join(site::CONFIG_FILE);
    let mut text = fs::read_to_string(&config).unwrap();
    let close = text.rfind('}').unwrap();
    let before = text[..close].trim_end().to_string();
    text = format!(
        "{before},\n  \"seasons\": {{\n    \"version\": 1,\n    \"enabled\": true,\n    \"windows\": [\n      {{\n        \"theme\": \"{second}\",\n        \"start\": \"12-01\",\n        \"end\": \"01-06\"\n      }},\n      {{\n        \"theme\": \"{first}\",\n        \"start\": \"02-01\",\n        \"end\": \"02-29\"\n      }}\n    ]\n  }}\n}}\n"
    );
    fs::write(&config, &text).unwrap();
    (f, first, second)
}

fn on_disk(f: &Fixture) -> String {
    fs::read_to_string(f.dir.join(site::CONFIG_FILE)).unwrap()
}

fn get(f: &Fixture, s: &(String, String)) -> Json {
    body_json(&handle(&f.state, &authed(req("GET", PATH), s, false)))
}

fn put(f: &Fixture, s: &(String, String), body: Json) -> Response {
    handle(&f.state, &authed(json_req("PUT", PATH, body), s, true))
}

#[test]
fn a_save_that_changes_nothing_writes_nothing() {
    let (f, _, _) = house("seasons-noop");
    let s = login_ok(&f);
    let before = on_disk(&f);
    let got = get(&f, &s);
    let response = put(
        &f,
        &s,
        json!({ "etag": got["etag"], "theme": got["theme"], "seasons": got["seasons"] }),
    );
    assert_eq!(
        response.status,
        200,
        "{}",
        String::from_utf8_lossy(&response.body)
    );
    assert_eq!(body_json(&response)["changed"], false);
    assert_eq!(on_disk(&f), before);
}

#[test]
fn changing_one_end_day_changes_only_that_line() {
    let (f, _, _) = house("seasons-one-line");
    let s = login_ok(&f);
    let before = on_disk(&f);
    let got = get(&f, &s);
    let mut seasons = got["seasons"].clone();
    seasons["windows"][0]["end"] = json!("01-10");
    let response = put(
        &f,
        &s,
        json!({ "etag": got["etag"], "theme": got["theme"], "seasons": seasons }),
    );
    assert_eq!(
        response.status,
        200,
        "{}",
        String::from_utf8_lossy(&response.body)
    );
    assert_eq!(
        on_disk(&f),
        before.replace("\"end\": \"01-06\"", "\"end\": \"01-10\"")
    );
}

#[test]
fn put_it_up_now_wins_until_its_last_day_and_undoes_byte_for_byte() {
    let (f, first, second) = house("seasons-up-now");
    let s = login_ok(&f);
    let before = on_disk(&f);
    let got = get(&f, &s);
    let mut seasons = got["seasons"].clone();
    seasons["upNow"] = json!({ "theme": second, "until": "2099-01-06" });
    let response = put(
        &f,
        &s,
        json!({ "etag": got["etag"], "theme": got["theme"], "seasons": seasons }),
    );
    assert_eq!(
        response.status,
        200,
        "{}",
        String::from_utf8_lossy(&response.body)
    );
    let reply = body_json(&response);
    assert_eq!(reply["wearing"], json!(second));
    assert!(
        on_disk(&f).contains("\"upNow\": {\n      \"theme\""),
        "{}",
        on_disk(&f)
    );
    let _ = first;
    // Undo: the same calendar without upNow.
    assert_eq!(
        reply["seasons"]["upNow"]["until"], "2099-01-06",
        "the reply shows what's up early"
    );
    let mut back = reply["seasons"].clone();
    back.as_object_mut().unwrap().remove("upNow");
    let response = put(
        &f,
        &s,
        json!({ "etag": reply["etag"], "theme": reply["theme"], "seasons": back }),
    );
    assert_eq!(response.status, 200);
    assert_eq!(on_disk(&f), before);
}

#[test]
fn an_up_now_that_has_ended_is_just_the_calendar_and_bad_days_are_refused() {
    let (f, _, second) = house("seasons-up-now-past");
    let s = login_ok(&f);
    let got = get(&f, &s);
    let mut seasons = got["seasons"].clone();
    seasons["upNow"] = json!({ "theme": second, "until": "2001-01-06" });
    let reply = body_json(&put(
        &f,
        &s,
        json!({ "etag": got["etag"], "theme": got["theme"], "seasons": seasons }),
    ));
    assert_eq!(reply["wearing"], got["wearing"]);
    seasons["upNow"] = json!({ "theme": second, "until": "2027-02-30" });
    let fresh = get(&f, &s);
    let response = put(
        &f,
        &s,
        json!({ "etag": fresh["etag"], "theme": fresh["theme"], "seasons": seasons }),
    );
    assert_eq!(response.status, 422);
}

#[test]
fn a_stale_etag_is_a_conflict_with_fresh_state() {
    let (f, _, _) = house("seasons-409");
    let s = login_ok(&f);
    let got = get(&f, &s);
    let response = put(
        &f,
        &s,
        json!({ "etag": "stale", "theme": got["theme"], "seasons": got["seasons"] }),
    );
    assert_eq!(response.status, 409);
    assert_eq!(body_json(&response)["etag"], got["etag"]);
}

#[test]
fn preview_dresses_the_home_page_in_a_look_and_writes_nothing() {
    let (f, _, second) = house("seasons-preview");
    let s = login_ok(&f);
    let before = on_disk(&f);
    let response = handle(
        &f.state,
        &authed(
            json_req(
                "POST",
                "/admin/api/seasons/preview",
                json!({ "look": second }),
            ),
            &s,
            true,
        ),
    );
    assert_eq!(
        response.status,
        200,
        "{}",
        String::from_utf8_lossy(&response.body)
    );
    let url = body_json(&response)["previewUrl"]
        .as_str()
        .unwrap()
        .to_string();
    let page = handle(&f.state, &authed(req("GET", &url), &s, false));
    assert_eq!(page.status, 200);
    assert!(String::from_utf8_lossy(&page.body).contains("<html"));
    let missing = handle(
        &f.state,
        &authed(
            json_req(
                "POST",
                "/admin/api/seasons/preview",
                json!({ "look": "no-such-look" }),
            ),
            &s,
            true,
        ),
    );
    assert_eq!(missing.status, 422);
    let no_csrf = handle(
        &f.state,
        &authed(
            json_req(
                "POST",
                "/admin/api/seasons/preview",
                json!({ "look": second }),
            ),
            &s,
            false,
        ),
    );
    assert_eq!(no_csrf.status, 403);
    assert_eq!(on_disk(&f), before);
}
