#![cfg(all(feature = "diagram-rendering", not(target_arch = "wasm32")))]

use blake2::{Blake2s256, Digest};
use openblog_core::{feeds, portability::PortableProjection};
use openblog_core::{
    generate, DateTime, LoadOptions, Site, SiteConfig, SourceFile, Sources, ThemeSet,
};

const VALID: &str = "```mermaid title=\"Request\" description=\"A calls B\" caption=\"Flow\"\nflowchart LR\nA --> B\n```\n";
const INVALID: &str = "```mermaid\nflowchart LR\nA --> B\n```\n";

fn post(body: &str, extra: &str) -> SourceFile {
    SourceFile {
        path: "posts/example.md".into(),
        contents: format!("---\ntitle: Example\ndate: 2026-01-01\n{extra}---\n{body}"),
    }
}

fn page(body: &str) -> SourceFile {
    SourceFile {
        path: "pages/about.md".into(),
        contents: format!("---\ntitle: About\n---\n{body}"),
    }
}

fn load(sources: Sources, options: LoadOptions) -> Result<Site, Vec<String>> {
    Site::load(
        SiteConfig::from_json(r#"{"title":"Test","url":"https://example.test"}"#).unwrap(),
        sources,
        options,
    )
}

#[test]
fn published_post_and_page_render_static_accessible_figures() {
    let site = load(
        Sources {
            posts: vec![post(VALID, "")],
            pages: vec![page(VALID)],
            ..Default::default()
        },
        LoadOptions::default(),
    )
    .unwrap();
    let files = generate(&site, &ThemeSet::new()).unwrap();
    for path in ["posts/example/index.html", "about/index.html"] {
        let html = &files
            .iter()
            .find(|file| file.path == path)
            .unwrap()
            .contents;
        assert!(html.contains("<figure class=\"ob-diagram\">"), "{path}");
        assert!(html.contains("role=\"img\""), "{path}");
        assert!(
            html.contains("<summary>Show diagram source</summary>"),
            "{path}"
        );
        assert!(!html.contains("<script src=\"https://"), "{path}");
    }
}

#[test]
fn published_invalid_diagrams_fail_at_the_source_line() {
    for (sources, location) in [
        (
            Sources {
                posts: vec![post(INVALID, "")],
                ..Default::default()
            },
            "line 5, column 1",
        ),
        (
            Sources {
                pages: vec![page(INVALID)],
                ..Default::default()
            },
            "line 4, column 1",
        ),
    ] {
        let errors = load(sources, LoadOptions::default()).unwrap_err();
        let text = errors.join("; ");
        assert!(text.contains(location), "{text}");
        assert!(text.contains("accTitle"), "{text}");
    }
}

#[test]
fn draft_scheduled_and_preview_diagrams_warn_and_keep_source() {
    for (record, options) in [
        (
            post(INVALID, "draft: true\n"),
            LoadOptions {
                include_drafts: true,
                ..Default::default()
            },
        ),
        (
            post(INVALID, ""),
            LoadOptions {
                preview_source: Some("posts/example.md".into()),
                ..Default::default()
            },
        ),
        (
            post(INVALID, ""),
            LoadOptions {
                include_drafts: true,
                now: DateTime::parse("2025-01-01"),
                ..Default::default()
            },
        ),
    ] {
        let site = load(
            Sources {
                posts: vec![record],
                ..Default::default()
            },
            options,
        )
        .unwrap();
        assert!(site
            .warnings
            .iter()
            .any(|warning| warning.contains("accTitle")));
        assert!(site.posts[0].html.contains("flowchart LR"));
        assert!(!site.posts[0].html.contains("<figure class=\"ob-diagram\">"));
    }

    let site = load(
        Sources {
            pages: vec![page(INVALID)],
            ..Default::default()
        },
        LoadOptions {
            preview_source: Some("pages/about.md".into()),
            ..Default::default()
        },
    )
    .unwrap();
    assert!(site
        .warnings
        .iter()
        .any(|warning| warning.contains("accTitle")));
    assert!(site.pages[0].html.contains("flowchart LR"));
}

#[test]
fn malformed_syntax_is_rejected_even_with_accessible_text() {
    let malformed = "```mermaid title=Broken description=Broken\nflowchart LR\nA -->\n```\n";
    let errors = load(
        Sources {
            posts: vec![post(malformed, "")],
            ..Default::default()
        },
        LoadOptions::default(),
    )
    .unwrap_err();
    assert!(
        errors.iter().any(|error| error.contains("line 8")),
        "{errors:?}"
    );
}

#[test]
fn nested_diagram_syntax_reports_the_source_line() {
    let body =
        "Intro.\n\n> ```mermaid title=Broken description=Broken\n> flowchart LR\n> A -->\n> ```\n";
    let errors = load(
        Sources {
            pages: vec![page(body)],
            ..Default::default()
        },
        LoadOptions::default(),
    )
    .unwrap_err();
    assert!(
        errors.iter().any(|error| error.contains("line 9")),
        "{errors:?}"
    );
}

#[test]
fn docs_publication_and_draft_preview_use_the_same_gate() {
    let config = || {
        SiteConfig::from_json(
            r#"{"title":"Test","url":"https://example.test","docs":{"enabled":true}}"#,
        )
        .unwrap()
    };
    let doc = |draft: bool| SourceFile {
        path: "docs/guide.md".into(),
        contents: format!("---\ntitle: Guide\ndraft: {draft}\n---\n{INVALID}"),
    };
    let sources = |draft| Sources {
        docs: vec![doc(draft)],
        ..Default::default()
    };
    let errors = Site::load(config(), sources(false), LoadOptions::default()).unwrap_err();
    assert!(errors
        .iter()
        .any(|error| error.contains("line 5") && error.contains("accTitle")));
    let site = Site::load(
        config(),
        sources(true),
        LoadOptions {
            include_drafts: true,
            ..Default::default()
        },
    )
    .unwrap();
    assert!(site
        .warnings
        .iter()
        .any(|warning| warning.contains("accTitle")));
    assert!(site.pages[0].html.contains("flowchart LR"));
}

#[test]
fn series_descriptions_render_and_gate_diagrams() {
    let series = |body: &str| SourceFile {
        path: "series/guide.md".into(),
        contents: format!("---\nname: Guide\n---\n{body}"),
    };
    let site = load(
        Sources {
            series: vec![series(VALID)],
            posts: vec![post("A post in the guide.\n", "series: guide\n")],
            ..Default::default()
        },
        LoadOptions::default(),
    )
    .unwrap();
    let files = generate(&site, &ThemeSet::new()).unwrap();
    let page = files
        .iter()
        .find(|file| file.path == "series/guide/index.html")
        .unwrap();
    assert!(page.contents.contains("<figure class=\"ob-diagram\">"));
    assert!(page.contents.contains("Show diagram source"));
    assert!(files
        .iter()
        .any(|file| file.path.starts_with("assets/diagrams/") && file.path.ends_with(".svg")));

    let unpublished = load(
        Sources {
            series: vec![series(VALID)],
            ..Default::default()
        },
        LoadOptions::default(),
    )
    .unwrap();
    let files = generate(&unpublished, &ThemeSet::new()).unwrap();
    assert!(!files
        .iter()
        .any(|file| file.path.starts_with("assets/diagrams/")));

    let sources = || Sources {
        series: vec![series(INVALID)],
        posts: vec![post("A post in the guide.\n", "series: guide\n")],
        ..Default::default()
    };
    let errors = load(sources(), LoadOptions::default()).unwrap_err();
    assert!(errors.iter().any(|error| error.contains("series/guide.md")
        && error.contains("line 4, column 1")
        && error.contains("accTitle")));
    let preview = load(
        sources(),
        LoadOptions {
            preview_source: Some("series/guide.md".into()),
            ..Default::default()
        },
    )
    .unwrap();
    assert!(preview
        .warnings
        .iter()
        .any(|warning| warning.contains("accTitle")));
    assert!(preview.series[0].description_html.contains("flowchart LR"));
    assert!(!preview.series[0]
        .description_html
        .contains("<figure class=\"ob-diagram\">"));
    let unused = load(
        Sources {
            series: vec![series(INVALID)],
            ..Default::default()
        },
        LoadOptions::default(),
    )
    .unwrap();
    assert!(unused
        .warnings
        .iter()
        .any(|warning| warning.contains("accTitle")));
    assert!(!generate(&unused, &ThemeSet::new())
        .unwrap()
        .iter()
        .any(|file| file.path == "series/guide/index.html"));
}

#[test]
fn feeds_and_portable_copies_use_real_digest_named_images_with_alternatives() {
    let nested = format!(
        "{VALID}\n> ```mermaid title=\"Nested\" description=\"C calls D\"\n> flowchart LR\n> C --> D\n> ```\n"
    );
    let mut site = load(
        Sources {
            posts: vec![post(&nested, "")],
            ..Default::default()
        },
        LoadOptions::default(),
    )
    .unwrap();
    site.config.feeds.full_content = true;
    let files = generate(&site, &ThemeSet::new()).unwrap();
    let images: Vec<_> = files
        .iter()
        .filter(|file| file.path.starts_with("assets/diagrams/") && file.path.ends_with(".svg"))
        .collect();
    assert_eq!(images.len(), 2);
    for image in &images {
        let filename = image
            .path
            .trim_start_matches("assets/diagrams/")
            .trim_end_matches(".svg");
        assert_eq!(filename.len(), 64);
        assert!(filename.bytes().all(|byte| byte.is_ascii_hexdigit()));
        let actual: String = Blake2s256::digest(image.contents.as_bytes())
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect();
        assert_eq!(filename, actual);
        assert!(roxmltree::Document::parse(&image.contents).is_ok());
    }
    let repeated = generate(&site, &ThemeSet::new()).unwrap();
    for image in &images {
        assert_eq!(
            repeated
                .iter()
                .find(|other| other.path == image.path)
                .unwrap()
                .contents,
            image.contents
        );
    }

    let projection = PortableProjection::for_site(&site, &site.posts[0]).unwrap();
    let portable = projection.portable_html().unwrap();
    let markdown = projection.portable_markdown().unwrap();
    let (bundled, bundled_assets) = projection
        .portable_markdown_bundle("openblog-diagrams-test")
        .unwrap();
    assert_eq!(bundled_assets.len(), 2);
    let rss = feeds::rss(&site).unwrap();
    let json: serde_json::Value = serde_json::from_str(&feeds::json_feed(&site).unwrap()).unwrap();
    let json_html = json["items"][0]["content_html"].as_str().unwrap();
    for image in &images {
        let url = format!("https://example.test/{}", image.path);
        assert!(portable.html.contains(&url), "{}", portable.html);
        assert!(markdown.contains(&url), "{markdown}");
        let filename = image.path.rsplit('/').next().unwrap();
        assert!(bundled.contains(&format!("openblog-diagrams-test/{filename}")));
        assert!(!bundled.contains(&url));
        assert!(rss.contains(&url), "{rss}");
        assert!(json_html.contains(&url), "{json_html}");
    }
    for html in [&portable.html, &rss, json_html] {
        assert!(html.contains("Request: A calls B"), "{html}");
        assert!(html.contains("Nested: C calls D"), "{html}");
    }
    assert!(markdown.contains("Diagram source:"));
    assert!(bundled.contains("Diagram source:"));
    assert!(projection.portable_markdown_bundle("../unsafe").is_err());
    assert!(!markdown.contains("```mermaid"));
}

#[test]
fn diagram_alternatives_are_escaped_in_valid_full_content_feeds() {
    let body =
        "```mermaid title=\"A & B\" description=\"Calls <the API>\"\nflowchart LR\nA --> B\n```\n";
    let mut site = load(
        Sources {
            posts: vec![post(body, "")],
            ..Default::default()
        },
        LoadOptions::default(),
    )
    .unwrap();
    site.config.feeds.full_content = true;
    let rss = feeds::rss(&site).unwrap();
    let xml = roxmltree::Document::parse(&rss).unwrap();
    let content = xml
        .descendants()
        .find(|node| {
            node.tag_name().name() == "encoded"
                && node.tag_name().namespace() == Some("http://purl.org/rss/1.0/modules/content/")
        })
        .unwrap()
        .text()
        .unwrap();
    let json: serde_json::Value = serde_json::from_str(&feeds::json_feed(&site).unwrap()).unwrap();
    for html in [content, json["items"][0]["content_html"].as_str().unwrap()] {
        assert!(
            html.contains("alt=\"A &amp; B: Calls &lt;the API&gt;\""),
            "{html}"
        );
        assert!(
            html.contains("https://example.test/assets/diagrams/"),
            "{html}"
        );
        assert!(!html.contains("<svg"), "{html}");
    }
}

#[test]
fn each_technical_template_builds_with_its_accessible_example() {
    let mut ids = std::collections::BTreeSet::new();
    for template in openblog_core::diagram::TEMPLATES {
        assert!(ids.insert(template.id));
        let body = format!("```mermaid\n{}```\n", template.source);
        let site = load(
            Sources {
                posts: vec![post(&body, "")],
                ..Default::default()
            },
            LoadOptions::default(),
        )
        .unwrap_or_else(|errors| panic!("{}: {errors:?}", template.id));
        assert!(site.posts[0].html.contains("<figure class=\"ob-diagram\">"));
        generate(&site, &ThemeSet::new())
            .unwrap_or_else(|error| panic!("{}: {error}", template.id));
    }
}
