//! A theme may bring its own favicon and header logo (ADR 0268).

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
    let config = SiteConfig::from_json(r#"{"title":"T","postPath":"/{slug}/","logo":"/images/logo.png","favicon":"/images/logo.png"}"#).unwrap();
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
fn a_theme_may_bring_its_own_favicon_and_logo() {
    let theme = Some(r#"{"extends":"base","favicon":"icons/tab.png","logo":"/images/series.png"}"#);
    for path in ["series/guides/index.html", "one/index.html"] {
        let html = page(theme, "Body.\n", path);
        assert!(
            html.contains("<link rel=\"icon\" href=\"/themes/custom/icons/tab.png\">"),
            "{path}"
        );
        assert!(
            html.contains("<img class=\"ob-brand-logo\" src=\"/images/series.png\""),
            "{path}"
        );
    }
    // Pages in other themes keep the site's own.
    let home = page(theme, "Body.\n", "index.html");
    assert!(home.contains("<link rel=\"icon\" href=\"/images/logo.png\">"));
    assert!(home.contains("<img class=\"ob-brand-logo\" src=\"/images/logo.png\""));
}
