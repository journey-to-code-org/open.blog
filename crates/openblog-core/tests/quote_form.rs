//! The quote form on the built site (ADRs 0381, 0382).
//!
//! The invariant: a site that never enables quote requests builds exactly as it did before, even when
//! its posts and landing page hold a `quote` fence or a quote-form section. When it is enabled the form
//! is plain markup with no request data, and a portable copy carries none of it.

use std::collections::BTreeMap;

use openblog_core::{generate, LoadOptions, Site, SiteConfig, SourceFile, Sources, ThemeSet};
use serde_json::{json, Value};

fn config(quote: Option<Value>) -> SiteConfig {
    let mut value = json!({
        "title": "Maple Falls Flooring",
        "url": "https://example.com",
        "author": {"name": "Ada", "url": "https://example.com/about/"},
        "feeds": {"rss": true},
        "serviceAreas": {"version": 1, "areas": [{"town": "Bend", "region": "OR"}]}
    });
    if let Some(quote) = quote {
        value["quote"] = quote;
    }
    SiteConfig::from_json(&value.to_string()).unwrap()
}

fn sources(with_form: bool) -> Sources {
    let fence = if with_form {
        "```quote\nservice: Fence repair\n```\n"
    } else {
        ""
    };
    let landing = if with_form {
        json!({"format": "openblog-landing", "version": 2, "sections": [
            {"id": "ask", "type": "quote-form", "heading": "Ask for a quote"}
        ]})
    } else {
        json!({"format": "openblog-landing", "version": 1, "sections": [
            {"id": "hello", "type": "rich-text", "markdown": "Hello"}
        ]})
    };
    Sources {
        posts: vec![SourceFile {
            path: "posts/one.md".into(),
            contents: format!("---\ntitle: One\ndate: 2026-10-01\n---\nBody.\n\n{fence}"),
        }],
        landing: Some(SourceFile {
            path: "content/landing.json".into(),
            contents: landing.to_string(),
        }),
        ..Default::default()
    }
}

fn build(config: SiteConfig, with_form: bool) -> BTreeMap<String, String> {
    let site = Site::load(config, sources(with_form), LoadOptions::default()).expect("site");
    generate(&site, &ThemeSet::new())
        .expect("generated")
        .into_iter()
        .map(|file| (file.path, file.contents))
        .collect()
}

#[test]
fn a_site_without_quote_requests_shows_no_form_anywhere() {
    for quote in [None, Some(json!({"enabled": false}))] {
        let files = build(config(quote), true);
        for (path, contents) in &files {
            assert!(!contents.contains("ob-quote"), "{path}");
            assert!(!contents.contains("/api/quote"), "{path}");
        }
    }
}

#[test]
fn off_is_byte_for_byte_the_same_as_never_set() {
    // The `quote` member is absent from a written default config, and the output does not change.
    let never = build(config(None), false);
    let off = build(config(Some(json!({"enabled": false}))), false);
    assert_eq!(never, off);
    assert!(!config(Some(json!({"enabled": false})))
        .to_json()
        .contains("quote"));
}

#[test]
fn enabled_the_fence_and_the_section_render_the_form_with_the_sites_towns() {
    let files = build(config(Some(json!({"enabled": true}))), true);
    let post = &files["posts/one/index.html"];
    assert!(
        post.contains("<ob-quote class=\"ob-quote\" endpoint=\"/api/quote\">"),
        "{post}"
    );
    assert!(post.contains("action=\"/api/quote/submit\""));
    assert!(post.contains("<option>Bend, OR</option>"));
    assert!(post.contains("<option>Fence repair</option>"));
    let home = &files["index.html"];
    assert!(home.contains("id=\"ob-home-ask\""));
    assert!(home.contains("Ask for a quote"));
    assert!(home.contains("<option>Bend, OR</option>"));
    // Ids stay unique when a page holds several forms.
    assert!(post.contains("id=\"ob-quote-1-name\""));
}

#[test]
fn the_markup_never_holds_a_request_value_and_feeds_never_carry_the_form() {
    let files = build(config(Some(json!({"enabled": true}))), true);
    for (path, contents) in &files {
        if path.ends_with(".xml") || path.ends_with(".json") && path != "landing.json" {
            assert!(!contents.contains("ob-quote"), "{path}");
        }
    }
    let post = &files["posts/one/index.html"];
    assert!(post.contains("name=\"token\" value=\"\""));
    assert!(post.contains("name=\"page\" value=\"\""));
}

#[test]
fn a_bad_endpoint_is_refused_with_the_config() {
    let error =
        SiteConfig::from_json(r#"{"quote":{"enabled":true,"endpoint":"http://x.example/q"}}"#)
            .unwrap_err();
    assert!(error.contains("quote.endpoint"), "{error}");
}

#[test]
fn the_landing_section_needs_version_two() {
    let result = openblog_core::landing::LandingPage::parse(
        &json!({"format": "openblog-landing", "version": 1, "sections": [
            {"id": "ask", "type": "quote-form", "heading": "Ask"}
        ]})
        .to_string(),
    );
    assert!(result.is_err());
}

fn one_post(config: SiteConfig, body: &str) -> Site {
    Site::load(
        config,
        Sources {
            posts: vec![SourceFile {
                path: "posts/2026-01-01-shakes.md".into(),
                contents: format!("---\ntitle: Shakes\ndate: 2026-01-01\n---\n{body}"),
            }],
            ..Default::default()
        },
        LoadOptions::default(),
    )
    .expect("site")
}

#[test]
fn off_a_quote_fence_is_the_ordinary_code_block_it_always_was() {
    // Before quote requests existed, a fence labelled `quote` was a code block. With them off it still
    // is: the post builds, and its words stay on the page instead of being refused or dropped.
    for body in [
        "```quote\nTo be, or not to be: that is the question.\n```\n",
        "```quote\nservice: Fencing\n```\n",
    ] {
        for quote in [None, Some(json!({"enabled": false}))] {
            let site = one_post(config(quote), body);
            let files: BTreeMap<String, String> = generate(&site, &ThemeSet::new())
                .expect("generated")
                .into_iter()
                .map(|file| (file.path, file.contents))
                .collect();
            let post = &files["posts/shakes/index.html"];
            let words = body.lines().nth(1).unwrap();
            assert!(post.contains("<pre"), "{post}");
            assert!(post.contains(words), "{post}");
            assert!(!post.contains("ob-quote"), "{post}");
        }
    }
}

#[test]
fn enabled_every_portable_copy_drops_the_form() {
    let mut config = config(Some(json!({"enabled": true})));
    config.feeds.json = true;
    config.feeds.full_content = true;
    let site = one_post(config, "Ask:\n\n```quote\nservice: Fencing\n```\n");
    let projection =
        openblog_core::portability::PortableProjection::from_post(&site.posts[0], &site.config)
            .unwrap();
    let html = projection.portable_html().unwrap().html;
    let markdown = projection.portable_markdown().unwrap();
    let text = projection.portable_text().unwrap();
    for (form, copy) in [("html", &html), ("markdown", &markdown), ("text", &text)] {
        assert!(copy.contains("Ask:"), "{form}: {copy}");
        assert!(!copy.contains("Fencing"), "{form}: {copy}");
        assert!(!copy.contains("```quote"), "{form}: {copy}");
    }
    let files: BTreeMap<String, String> = generate(&site, &ThemeSet::new())
        .expect("generated")
        .into_iter()
        .map(|file| (file.path, file.contents))
        .collect();
    let feed = &files["feed.json"];
    assert!(feed.contains("Ask:"), "{feed}");
    assert!(!feed.contains("Fencing"), "{feed}");
}
