//! A theme whose series page has its own hero renders no series cover there (ADR 0270).

use openblog_core::{
    render, LoadOptions, Site, SiteConfig, SourceFile, Sources, ThemeFile, ThemeSet,
};

fn file(path: &str, contents: &str) -> SourceFile {
    SourceFile {
        path: path.into(),
        contents: contents.into(),
    }
}

fn page(theme_json: Option<&str>, post_body: &str, path: &str) -> String {
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
                &format!("---\nname: Guides\ncover: /images/guides.jpg\n{theme_line}---\n\nAbout.\n"),
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

#[test]
fn a_theme_may_leave_the_cover_off_its_series_page() {
    let plain = page(None, "Body.\n", "series/guides/index.html");
    assert!(plain.contains("<figure class=\"ob-cover\"><img src=\"/images/guides.jpg\""));
    let theme = Some(r#"{"extends":"base","options":{"seriesPageCover":false}}"#);
    let html = page(theme, "Body.\n", "series/guides/index.html");
    assert!(
        !html.contains("<figure class=\"ob-cover\""),
        "never downloaded only to be hidden"
    );
    assert!(
        page(theme, "Body.\n", "series/index.html").contains("/images/guides.jpg"),
        "the card keeps it"
    );
}
