//! Theme components on the landing page (ADR 0408).
//!
//! The invariants: a component section holds only a name and checked values, so what reaches the
//! page is the declared element with escaped attributes and the theme's own script; a page that
//! places one is version 4; and a theme cannot declare a component that loads a script from
//! elsewhere or takes an event handler as a setting.

use openblog_core::landing::LandingPage;
use openblog_core::theme::ThemeFile;
use openblog_core::{generate, LoadOptions, Site, SiteConfig, SourceFile, Sources, ThemeSet};
use serde_json::{json, Value};

fn house() -> Value {
    json!({
        "label": "House",
        "extends": "base",
        "components": {
            "holiday-countdown": {
                "label": "Countdown sign",
                "description": "Days until the holiday.",
                "script": "components/holiday-countdown.js",
                "fallback": "A countdown sign hangs here.",
                "props": [
                    { "name": "holiday", "type": "choice", "label": "Which holiday", "default": "thanksgiving",
                      "choices": [ { "value": "thanksgiving", "label": "Thanksgiving" },
                                   { "value": "christmas", "label": "Christmas" } ] },
                    { "name": "note", "type": "text", "label": "A line under it" },
                    { "name": "sparkle", "type": "toggle", "label": "Sparkle" }
                ]
            }
        }
    })
}

fn themes(house: Value) -> ThemeSet {
    let mut set = ThemeSet::new();
    set.insert("base", ThemeFile::builtin_base());
    set.insert("house", ThemeFile::from_json(&house.to_string()).unwrap());
    set
}

fn landing(sections: Value) -> String {
    json!({ "format": "openblog-landing", "version": 4, "sections": sections }).to_string()
}

fn home(landing_json: String) -> String {
    let config = SiteConfig::from_json(
        r#"{"title":"Grammi's House","url":"https://example.com","theme":"house"}"#,
    )
    .unwrap();
    let sources = Sources {
        landing: Some(SourceFile {
            path: "content/landing.json".into(),
            contents: landing_json,
        }),
        ..Default::default()
    };
    let site = Site::load(config, sources, LoadOptions::default()).expect("site");
    generate(&site, &themes(house()))
        .expect("generated")
        .into_iter()
        .find(|file| file.path == "index.html")
        .expect("home page")
        .contents
}

#[test]
fn a_placed_component_is_its_element_with_escaped_settings_and_its_theme_script() {
    let page = home(landing(json!([
        { "id": "welcome", "type": "welcome", "heading": "Welcome" },
        { "id": "sign", "type": "component", "tag": "holiday-countdown", "heading": "Coming up",
          "props": { "holiday": "christmas", "note": "\"><script>alert(1)</script>", "sparkle": true } }
    ])));
    assert!(page.contains(
        "<holiday-countdown holiday=\"christmas\" note=\"&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;\" sparkle></holiday-countdown>"
    ), "{page}");
    assert!(
        !page.contains("<script>alert(1)"),
        "a value is never markup"
    );
    assert!(page.contains(
        "<script type=\"module\" src=\"/themes/house/components/holiday-countdown.js\"></script>"
    ));
    assert!(page.contains(
        "<noscript><p class=\"ob-home-note\">A countdown sign hangs here.</p></noscript>"
    ));
    assert!(
        page.contains("id=\"ob-home-sign-title\""),
        "the heading names the section"
    );
}

#[test]
fn a_setting_left_out_takes_its_default_and_an_off_toggle_is_left_out() {
    let page = home(landing(json!([
        { "id": "sign", "type": "component", "tag": "holiday-countdown", "props": { "sparkle": false } }
    ])));
    assert!(
        page.contains("<holiday-countdown holiday=\"thanksgiving\"></holiday-countdown>"),
        "{page}"
    );
}

#[test]
fn a_component_the_theme_does_not_offer_renders_nothing() {
    let page = home(landing(json!([
        { "id": "welcome", "type": "welcome", "heading": "Welcome" },
        { "id": "other", "type": "component", "tag": "snow-globe" }
    ])));
    assert!(!page.contains("snow-globe"));
}

#[test]
fn a_page_with_a_component_is_version_4() {
    let older = json!({ "format": "openblog-landing", "version": 3, "sections": [
        { "id": "sign", "type": "component", "tag": "holiday-countdown" } ] });
    let problems = LandingPage::parse(&older.to_string()).unwrap_err();
    assert!(
        problems.iter().any(|p| p.message.contains("version")),
        "{problems:?}"
    );
    assert!(LandingPage::parse(&landing(json!([
        { "id": "sign", "type": "component", "tag": "holiday-countdown" } ])))
    .is_ok());
}

#[test]
fn settings_that_are_not_plain_values_are_refused_by_the_page() {
    let problems = LandingPage::parse(&landing(json!([
        { "id": "sign", "type": "component", "tag": "holiday-countdown", "props": { "holiday": { "a": 1 } } }
    ])))
    .unwrap_err();
    assert!(
        problems.iter().any(|p| p.message.contains("props")),
        "{problems:?}"
    );
}

#[test]
fn a_theme_cannot_declare_a_script_from_elsewhere_or_an_event_handler() {
    let mut remote = house();
    remote["components"]["holiday-countdown"]["script"] = json!("https://cdn.example.com/x.js");
    let error = themes(remote).resolve("house").unwrap_err();
    assert!(error.contains("inside the theme folder"), "{error}");

    let mut handler = house();
    handler["components"]["holiday-countdown"]["props"][1]["name"] = json!("onclick");
    let error = themes(handler).resolve("house").unwrap_err();
    assert!(error.contains("attribute name"), "{error}");
}

#[test]
fn a_child_theme_inherits_its_parents_components() {
    let mut set = themes(house());
    set.insert(
        "christmas",
        ThemeFile::from_json(r#"{"label":"Christmas","extends":"house"}"#).unwrap(),
    );
    let theme = set.resolve("christmas").unwrap();
    assert_eq!(
        theme.components["holiday-countdown"].script,
        "/themes/house/components/holiday-countdown.js",
        "the script stays where the theme that declared it keeps it"
    );
}
