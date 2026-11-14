//! Studio's words in `GET meta` (docs/studio-words.md, W4): what's in effect for the site, where
//! each change came from, and the problems, with the host's file read on every `meta`.

use super::*;

fn meta_of(state: &AppState, s: &(String, String)) -> Json {
    let response = handle(state, &authed(req("GET", "/admin/api/meta"), s, false));
    assert_eq!(
        response.status,
        200,
        "{}",
        String::from_utf8_lossy(&response.body)
    );
    body_json(&response)
}

fn set_words(f: &Fixture, author: &str, words: Json) {
    let path = f.dir.join("openblog.json");
    let mut config: Json = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
    config["author"]["name"] = json!(author);
    if words.is_null() {
        config.as_object_mut().unwrap().remove("studio");
    } else {
        config["studio"] = json!({ "words": words });
    }
    fs::write(&path, serde_json::to_string_pretty(&config).unwrap()).unwrap();
}

#[test]
fn meta_says_which_words_are_in_effect_and_why_any_were_dropped() {
    let f = fixture("studio-words-meta");
    let s = login_ok(&f);
    // Nothing set: the built-in variables, her name from the author's.
    set_words(&f, "Grammi Nichols", Json::Null);
    let words = meta_of(&f.state, &s)["studioWords"].clone();
    assert_eq!(
        words,
        json!({ "vars": { "helper": "the person who set up your site", "product": "your blog", "owner": "Grammi" }, "text": {}, "from": {}, "problems": [] })
    );
    // Grammi's House, with one mistake.
    set_words(
        &f,
        "Grammi",
        json!({ "vars": { "helper": "Mikey" }, "text": { "cards.signOff": "Love, {owner}", "card.signoff": "Love" } }),
    );
    let words = meta_of(&f.state, &s)["studioWords"].clone();
    assert_eq!(words["vars"]["helper"], "Mikey");
    assert_eq!(words["text"], json!({ "cards.signOff": "Love, {owner}" }));
    assert_eq!(
        words["from"],
        json!({ "helper": "site", "cards.signOff": "site" })
    );
    assert_eq!(
        words["problems"],
        json!([{ "where": "site", "key": "card.signoff", "words": "card.signoff isn't a word id. Did you mean cards.signOff?" }])
    );
}

#[test]
fn the_hosts_file_is_read_on_every_meta_and_the_site_wins() {
    let f = fixture("studio-words-host");
    let host = f.dir.join("host-words.json");
    fs::write(
        &host,
        r#"{"vars":{"helper":"Hillside Web Care","product":"your website"}}"#,
    )
    .unwrap();
    let mut state = AppState::new(f.dir.clone(), None, false, true);
    state.studio_words_path = Some(host.clone());
    let host_site = Fixture {
        state: Arc::new(state),
        dir: f.dir.clone(),
    };
    let s = login_ok(&host_site);
    let state = &host_site.state;
    set_words(
        &f,
        "Dana",
        json!({ "vars": { "product": "your roofing site" } }),
    );
    let words = meta_of(state, &s)["studioWords"].clone();
    assert_eq!(words["vars"]["helper"], "Hillside Web Care");
    assert_eq!(words["vars"]["product"], "your roofing site");
    assert_eq!(
        words["from"],
        json!({ "helper": "server", "product": "site" })
    );
    // Edited while the server runs: the next meta has it, no restart.
    fs::write(&host, r#"{"vars":{"helper":"Ridge Web"}}"#).unwrap();
    assert_eq!(
        meta_of(state, &s)["studioWords"]["vars"]["helper"],
        "Ridge Web"
    );
    // Broken: set aside, said once, and Studio still opens.
    fs::write(&host, "{ not json").unwrap();
    let words = meta_of(state, &s)["studioWords"].clone();
    assert_eq!(words["vars"]["helper"], "the person who set up your site");
    assert_eq!(words["problems"].as_array().unwrap().len(), 1);
    assert_eq!(words["problems"][0]["where"], "server");
}
