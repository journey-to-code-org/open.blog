#![cfg(all(feature = "diagram-rendering", not(target_arch = "wasm32")))]

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
        errors.iter().any(|error| error.contains("line 5")),
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
