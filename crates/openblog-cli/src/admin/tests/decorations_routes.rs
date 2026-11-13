//! Studio slice 3b: a theme's decorations are pieces the owner can take down or swap. The choices
//! are names only, a save changes nothing else in `openblog.json`, unknown pieces and versions are
//! refused, and the preview shows choices before they're saved.

use super::*;

const PATH: &str = "/admin/api/decorations";

/// A fixture with a `festive` theme that declares a garland (with a toy-shelf version) and snow.
fn festive(tag: &str) -> (Fixture, (String, String)) {
    let f = fixture(tag);
    let dir = f.dir.join("themes").join("festive");
    fs::create_dir_all(&dir).unwrap();
    fs::write(
        dir.join("theme.json"),
        r#"{
  "label": "Festive",
  "tokens": { "decorGarland": "url(g.svg)", "ghSnow": "on" },
  "decorations": {
    "garland": {
      "label": "Garland",
      "tokens": ["decorGarland"],
      "off": { "decorGarland": "none" },
      "variants": { "toyshelf": { "label": "From the toy shelf", "tokens": { "decorGarland": "url(toys.svg)" } } }
    },
    "snow": { "label": "Snow", "tokens": ["ghSnow"], "off": { "ghSnow": "none" } }
  }
}
"#,
    )
    .unwrap();
    let s = login_ok(&f);
    (f, s)
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
fn lists_the_pieces_of_every_look_that_has_them() {
    let (f, s) = festive("decor-list");
    let got = get(&f, &s);
    let looks = got["looks"].as_array().unwrap();
    assert_eq!(looks.len(), 1, "{got}");
    assert_eq!(looks[0]["name"], "festive");
    let pieces = looks[0]["pieces"].as_array().unwrap();
    assert_eq!(pieces[0]["id"], "garland");
    assert_eq!(pieces[0]["variants"][0]["label"], "From the toy shelf");
    assert_eq!(pieces[0]["choice"], Json::Null);
    assert_eq!(pieces[1]["label"], "Snow");
}

#[test]
fn taking_one_piece_down_writes_only_that_choice_and_undoes_byte_for_byte() {
    let (f, s) = festive("decor-off");
    let before = on_disk(&f);
    let got = get(&f, &s);
    let response = put(
        &f,
        &s,
        json!({ "etag": got["etag"], "decorations": { "festive": { "snow": false } } }),
    );
    assert_eq!(
        response.status,
        200,
        "{}",
        String::from_utf8_lossy(&response.body)
    );
    let saved = body_json(&response);
    assert_eq!(saved["changed"], true);
    assert_eq!(saved["looks"][0]["pieces"][1]["choice"], false);
    let after = on_disk(&f);
    assert!(after.contains("\"decorations\": {"), "{after}");
    assert!(after.contains("\"snow\": false"), "{after}");
    let config: Json = serde_json::from_str(&after).unwrap();
    let was: Json = serde_json::from_str(&before).unwrap();
    for (key, value) in was.as_object().unwrap() {
        assert_eq!(&config[key], value, "{key} changed");
    }
    // Putting it back up removes the member and leaves the file as it was.
    let response = put(
        &f,
        &s,
        json!({ "etag": saved["etag"], "decorations": { "festive": {} } }),
    );
    assert_eq!(
        response.status,
        200,
        "{}",
        String::from_utf8_lossy(&response.body)
    );
    assert_eq!(on_disk(&f), before);
}

#[test]
fn a_built_page_wears_the_choice() {
    let (f, s) = festive("decor-built");
    let got = get(&f, &s);
    let response = put(
        &f,
        &s,
        json!({ "etag": got["etag"], "decorations": { "festive": { "garland": "toyshelf" } } }),
    );
    assert_eq!(
        response.status,
        200,
        "{}",
        String::from_utf8_lossy(&response.body)
    );
    let config = site::load_config(&f.dir).unwrap();
    let themes = site::load_themes(&f.dir, &config).unwrap();
    let theme = themes
        .resolve("festive")
        .unwrap()
        .with_decorations(&config.decorations["festive"]);
    assert!(theme.tokens_css().contains("url(toys.svg)"));
    assert!(theme.tokens_url().contains("?v="));
}

#[test]
fn unknown_pieces_versions_and_css_are_refused_and_nothing_is_written() {
    let (f, s) = festive("decor-refuse");
    let before = on_disk(&f);
    let got = get(&f, &s);
    for bad in [
        json!({ "festive": { "bells": false } }),
        json!({ "festive": { "garland": "gold" } }),
        json!({ "nowhere": { "garland": false } }),
        json!({ "festive": { "garland": "url(x)" } }),
        json!({ "festive": { "garland": true } }),
    ] {
        let response = put(&f, &s, json!({ "etag": got["etag"], "decorations": bad }));
        assert_eq!(
            response.status,
            422,
            "{bad}: {}",
            String::from_utf8_lossy(&response.body)
        );
    }
    assert_eq!(on_disk(&f), before);
}

#[test]
fn a_stale_etag_is_a_conflict_with_the_current_state() {
    let (f, s) = festive("decor-conflict");
    let got = get(&f, &s);
    let first = put(
        &f,
        &s,
        json!({ "etag": got["etag"], "decorations": { "festive": { "snow": false } } }),
    );
    assert_eq!(first.status, 200);
    let second = put(
        &f,
        &s,
        json!({ "etag": got["etag"], "decorations": { "festive": { "garland": false } } }),
    );
    assert_eq!(second.status, 409);
    assert_eq!(body_json(&second)["decorations"]["festive"]["snow"], false);
}

#[test]
fn the_preview_shows_unsaved_choices_and_writes_nothing() {
    let (f, s) = festive("decor-preview");
    let before = on_disk(&f);
    let response = handle(
        &f.state,
        &authed(
            json_req(
                "POST",
                "/admin/api/decorations/preview",
                json!({ "look": "festive", "pieces": { "garland": "toyshelf" } }),
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
    assert!(String::from_utf8_lossy(&page.body).contains("url(toys.svg)"));
    assert_eq!(on_disk(&f), before);
}

#[test]
fn a_stale_saved_choice_never_blocks_another_change() {
    let (f, s) = festive("decor-stale");
    let config = f.dir.join(site::CONFIG_FILE);
    let text = fs::read_to_string(&config).unwrap();
    let close = text.rfind('}').unwrap();
    fs::write(
        &config,
        format!(
            "{},\n  \"decorations\": {{ \"gone\": {{ \"garland\": false }} }}\n}}\n",
            text[..close].trim_end()
        ),
    )
    .unwrap();
    let got = get(&f, &s);
    let response = put(
        &f,
        &s,
        json!({ "etag": got["etag"], "decorations": { "gone": { "garland": false }, "festive": { "snow": false } } }),
    );
    assert_eq!(
        response.status,
        200,
        "{}",
        String::from_utf8_lossy(&response.body)
    );
    assert!(on_disk(&f).contains("\"snow\": false"));
}

#[test]
fn a_piece_with_nothing_to_take_down_cant_be_switched_off() {
    let (f, s) = festive("decor-always");
    let path = f.dir.join("themes").join("festive").join("theme.json");
    let theme = fs::read_to_string(&path).unwrap();
    let changed = theme.replace(
        r#""snow": { "label": "Snow", "tokens": ["ghSnow"], "off": { "ghSnow": "none" } }"#,
        r#""snow": { "label": "Snow", "tokens": ["ghSnow"] }"#,
    );
    assert_ne!(changed, theme);
    fs::write(&path, changed).unwrap();
    let got = get(&f, &s);
    assert_eq!(got["looks"][0]["pieces"][1]["canTakeDown"], false);
    let response = put(
        &f,
        &s,
        json!({ "etag": got["etag"], "decorations": { "festive": { "snow": false } } }),
    );
    assert_eq!(response.status, 422);
}
