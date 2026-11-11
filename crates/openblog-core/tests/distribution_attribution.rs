//! Attribution adds nothing to a site (#404; ADR 0404): turning `analytics.campaigns` on changes
//! no byte of a build, its feeds or its pages, and a built site loads no third-party script and sets
//! no cookie, whether or not any analytics backend exists.

use openblog_core::{generate, LoadOptions, Site, SiteConfig, SourceFile, Sources, ThemeSet};

fn build(config: &str) -> Vec<(String, String)> {
    let site = Site::load(
        SiteConfig::from_json(config).unwrap(),
        Sources {
            posts: vec![SourceFile {
                path: "posts/a.md".into(),
                contents: "---\ntitle: A post\ndate: 2026-10-01\ndescription: A short post about attribution and nothing else at all.\ntags: [notes]\n---\n## One\n\nText.\n".into(),
            }],
            ..Default::default()
        },
        LoadOptions::default(),
    )
    .unwrap();
    let mut files: Vec<(String, String)> = generate(&site, &ThemeSet::new())
        .unwrap()
        .into_iter()
        .map(|f| (f.path, f.contents))
        .collect();
    files.sort();
    files
}

#[test]
fn campaign_tags_change_nothing_in_a_build() {
    let base = r#"{"title":"T","url":"https://t.example"}"#;
    let on = r#"{"title":"T","url":"https://t.example","analytics":{"campaigns":true}}"#;
    assert_eq!(build(base), build(on));
}

#[test]
fn a_built_site_loads_no_third_party_script_and_sets_no_cookie() {
    for config in [
        r#"{"title":"T","url":"https://t.example"}"#,
        r#"{"title":"T","url":"https://t.example","analytics":{"builtin":false,"campaigns":true}}"#,
    ] {
        for (path, contents) in build(config) {
            if !(path.ends_with(".html") || path.ends_with(".js")) {
                continue;
            }
            for script in contents
                .match_indices("<script")
                .map(|(i, _)| &contents[i..])
            {
                let tag = &script[..script.find('>').unwrap_or(script.len())];
                if let Some(src) = tag.split("src=\"").nth(1) {
                    let src = &src[..src.find('"').unwrap_or(src.len())];
                    assert!(
                        src.starts_with('/') && !src.starts_with("//"),
                        "{path} loads a script from {src}"
                    );
                }
            }
            assert!(
                !contents.contains("document.cookie"),
                "{path} sets a cookie"
            );
            for tracker in [
                "google-analytics.com",
                "googletagmanager.com",
                "facebook.net",
                "fbq(",
                "gtag(",
            ] {
                assert!(!contents.contains(tracker), "{path} contains {tracker}");
            }
        }
    }
}
