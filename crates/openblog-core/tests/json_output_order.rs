use openblog_core::{generate, LoadOptions, Site, SiteConfig, SourceFile, Sources, ThemeSet};

fn sorted_json(input: &str, pretty: bool) -> String {
    let mut value: serde_json::Value = serde_json::from_str(input).unwrap();
    value.sort_all_objects();
    if pretty {
        serde_json::to_string_pretty(&value).unwrap()
    } else {
        value.to_string()
    }
}

#[test]
fn published_json_objects_keep_their_order_when_dependencies_enable_preserve_order() {
    let config = SiteConfig::from_json(
        r#"{"title":"Test","url":"https://example.test","author":{"name":"Author","url":"https://example.test/about/"}}"#,
    )
    .unwrap();
    let site = Site::load(
        config,
        Sources {
            posts: vec![SourceFile {
                path: "posts/example.md".into(),
                contents:
                    "---\ntitle: Example\ndate: 2026-01-01\ntags: [second, first]\n---\nBody\n"
                        .into(),
            }],
            ..Default::default()
        },
        LoadOptions::default(),
    )
    .unwrap();
    let files = generate(&site, &ThemeSet::new()).unwrap();
    let file = |path: &str| {
        &files
            .iter()
            .find(|file| file.path == path)
            .unwrap_or_else(|| panic!("missing {path}"))
            .contents
    };

    for path in ["feed.json", "api/blog.json"] {
        assert_eq!(*file(path), sorted_json(file(path), true), "{path}");
    }
    let theme = file("themes/base/resolved.json");
    assert_eq!(*theme, sorted_json(theme, false));
    for path in ["index.html", "posts/example/index.html"] {
        let html = file(path);
        let marker = "<script type=\"application/ld+json\">";
        let start = html.find(marker).unwrap() + marker.len();
        let end = start + html[start..].find("</script>").unwrap();
        let json = &html[start..end];
        assert_eq!(json, sorted_json(json, false), "{path}");
    }
}
