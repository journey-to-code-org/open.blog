//! A theme with `codeWindows` frames plain code blocks as it writes the page (ADR 0269).

use openblog_core::{
    render, LoadOptions, Site, SiteConfig, SourceFile, Sources, ThemeFile, ThemeSet,
};

fn file(path: &str, contents: &str) -> SourceFile {
    SourceFile {
        path: path.into(),
        contents: contents.into(),
    }
}

fn page(theme_json: Option<&str>, post_body: &str, series_body: &str, path: &str) -> String {
    let config = SiteConfig::from_json(r#"{"title":"T","postPath":"/{slug}/"}"#).unwrap();
    let theme_line = if theme_json.is_some() {
        "theme: custom\n"
    } else {
        ""
    };
    let site = Site::load(
        config,
        Sources {
            posts: vec![file(
                "posts/2026-01-01-one.md",
                &format!("---\ntitle: One\nslug: one\ndate: 2026-01-01\nseries: guides\n---\n\n{post_body}"),
            )],
            series: vec![file(
                "series/guides.md",
                &format!(
                    "---\nname: Guides\ncover: /images/guides.jpg\n{theme_line}---\n\n{series_body}\n"
                ),
            )],
            ..Sources::default()
        },
        LoadOptions::default(),
    )
    .unwrap();
    let mut themes = ThemeSet::new();
    if let Some(json) = theme_json {
        themes.insert("custom", ThemeFile::from_json(json).unwrap());
    }
    render::generate(&site, &themes)
        .unwrap()
        .into_iter()
        .find(|f| f.path == path)
        .unwrap_or_else(|| panic!("missing {path}"))
        .contents
}

const FENCES: &str = "```bash\ncargo run\n```\n\n```rust title=\"main.rs\"\nfn main() {}\n```\n";

#[test]
fn a_theme_with_code_windows_frames_plain_blocks() {
    let html = page(
        Some(r#"{"extends":"base","options":{"codeWindows":true}}"#),
        FENCES,
        "About.",
        "one/index.html",
    );
    assert!(html.contains("<figure class=\"ob-code-block\"><figcaption class=\"ob-code-title\">Terminal</figcaption><pre><code class=\"language-bash\">"), "{html}");
    assert_eq!(
        html.matches("ob-code-title").count(),
        2,
        "the titled block keeps its one caption"
    );
}

#[test]
fn other_themes_and_feeds_keep_plain_blocks() {
    let html = page(None, FENCES, "About.", "one/index.html");
    assert!(html.contains("<pre><code class=\"language-bash\">"));
    assert_eq!(html.matches("ob-code-title").count(), 1);
    let feed = page(
        Some(r#"{"extends":"base","options":{"codeWindows":true}}"#),
        FENCES,
        "About.",
        "feed.json",
    );
    assert!(!feed.contains("Terminal"), "a feed is not themed");
}

#[test]
fn a_series_landing_code_window_uses_the_shared_code_enhancer_once() {
    let html = page(
        Some(r#"{"extends":"base","options":{"codeWindows":true}}"#),
        FENCES,
        "```rust title=\"main.rs\"\nfn main() {}\n```",
        "series/guides/index.html",
    );
    assert!(
        html.contains("<ob-code highlight><div class=\"ob-prose\">")
            || html.contains("<ob-code highlight line-numbers><div class=\"ob-prose\">"),
        "series landing code must use the same enhancer as posts and pages: {html}"
    );
    assert_eq!(
        html.matches("ob-code-title").count(),
        1,
        "the enhancer must not duplicate the engine-owned caption"
    );
}
