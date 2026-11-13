//! The `text-compare` fence on the page, in a portable copy, and as a validation error.

use openblog_core::{
    markdown::{render, RenderOptions},
    portability::PortableProjection,
    LoadOptions, Site, SiteConfig, SourceFile, Sources,
};

fn point(title: &str) -> String {
    format!(
        "```text-compare title=\"{title}\"\nperspective-a-label: Conservative View\nperspective-b-label: Progressive View\n\n### Core Principle\nperspective-a: Tradition anchors us.\nperspective-b: Tradition changes with us.\n\n### Key Values\nperspective-a: Continuity of sacred wisdom.\nperspective-b: Practice from genuine understanding.\n```\n"
    )
}

fn site(body: &str) -> (SiteConfig, Site) {
    let config = SiteConfig::from_json(
        r#"{ "title": "Fixture", "url": "https://example.test/blog", "postPath": "/{slug}/",
             "author": { "name": "Site Author" } }"#,
    )
    .unwrap();
    let site = Site::load(
        config.clone(),
        Sources {
            posts: vec![SourceFile {
                path: "posts/text.md".into(),
                contents: format!("---\ntitle: Text\ndate: 2026-10-01\n---\n{body}"),
            }],
            ..Default::default()
        },
        LoadOptions::default(),
    )
    .unwrap_or_else(|errors| panic!("{errors:?}"));
    (config, site)
}

#[test]
fn the_page_gets_one_element_per_heading_under_the_fence_title() {
    let rendered = render(&point("Two Views"), RenderOptions::default());
    assert!(rendered.errors.is_empty(), "{:?}", rendered.errors);
    assert!(rendered.html.contains("<h2>Two Views</h2>"));
    assert!(rendered.html.contains("<h3>Core Principle</h3>"));
    assert_eq!(
        rendered
            .html
            .matches("<ob-text-compare class=\"ob-text-comparison\">")
            .count(),
        2
    );
    assert!(rendered
        .html
        .contains("<div class=\"ob-compare-label\">Conservative View</div>"));
    assert_eq!(rendered.capabilities.len(), 1);
    assert_eq!(rendered.capabilities[0].id, "textual-comparison");
    assert_eq!(
        rendered.capabilities[0].native_renderer,
        Some("ob-text-compare")
    );
    assert!(
        rendered.capabilities[0].diagnostics.is_empty(),
        "{:?}",
        rendered.capabilities[0].diagnostics
    );
    assert!(!rendered
        .code_languages
        .contains(&"text-compare".to_string()));
}

#[test]
fn duplicate_labels_are_rejected_instead_of_discarding_authored_text() {
    let body = "```text-compare title=\"T\"\nperspective-a-label: First\nperspective-a-label: Second\nperspective-a: One.\nperspective-b: Two.\n```\n";
    let rendered = render(body, RenderOptions::default());
    assert_eq!(rendered.errors.len(), 1, "{:?}", rendered.errors);
    assert!(
        rendered.errors[0].contains("perspective-a-label appears more than once"),
        "{:?}",
        rendered.errors
    );
}

#[test]
fn duplicate_fence_titles_are_rejected_instead_of_discarding_authored_text() {
    let body = "```text-compare title=\"First\" title=\"Second\"\nperspective-a: One.\nperspective-b: Two.\n```\n";
    let rendered = render(body, RenderOptions::default());
    assert_eq!(rendered.errors.len(), 1, "{:?}", rendered.errors);
    assert!(
        rendered.errors[0].contains("title appears more than once"),
        "{:?}",
        rendered.errors
    );
}

#[test]
fn point_headings_must_be_nonempty_level_three_headings() {
    for heading in ["# Wrong level", "###"] {
        let body = format!(
            "```text-compare title=\"T\"\n{heading}\nperspective-a: One.\nperspective-b: Two.\n```\n"
        );
        let rendered = render(&body, RenderOptions::default());
        assert_eq!(rendered.errors.len(), 1, "{heading}: {:?}", rendered.errors);
        assert!(
            rendered.errors[0].contains("point heading must be written as `### Heading`"),
            "{heading}: {:?}",
            rendered.errors
        );
    }
}

#[test]
fn the_title_can_be_given_in_the_body_instead_of_the_fence_line() {
    let body =
        "```text-compare\ntitle: Body Title\nperspective-a: One.\nperspective-b: Two.\n```\n";
    let rendered = render(body, RenderOptions::default());
    assert!(rendered.errors.is_empty(), "{:?}", rendered.errors);
    assert!(rendered.html.contains("<h2>Body Title</h2>"));
}

#[test]
fn a_missing_title_is_an_error_with_a_plain_message() {
    let body = "```text-compare\nperspective-a: One.\nperspective-b: Two.\n```\n";
    let rendered = render(body, RenderOptions::default());
    assert_eq!(rendered.errors.len(), 1, "{:?}", rendered.errors);
    assert!(
        rendered.errors[0].contains("title is required"),
        "{:?}",
        rendered.errors
    );
    assert!(rendered.html.contains("ob-text-compare-error"));
    assert!(!rendered.html.contains("<ob-text-compare "));
}

#[test]
fn a_label_longer_than_fifty_characters_is_an_error() {
    let body = format!(
        "```text-compare title=\"T\"\nperspective-a-label: {}\nperspective-a: One.\nperspective-b: Two.\n```\n",
        "x".repeat(51)
    );
    let rendered = render(&body, RenderOptions::default());
    assert_eq!(rendered.errors.len(), 1, "{:?}", rendered.errors);
    assert!(
        rendered.errors[0]
            .contains("perspective-a-label is too long (51 characters); maximum is 50"),
        "{:?}",
        rendered.errors
    );
}

#[test]
fn a_label_of_exactly_fifty_characters_is_accepted() {
    let body = format!(
        "```text-compare title=\"T\"\nperspective-b-label: {}\nperspective-a: One.\nperspective-b: Two.\n```\n",
        "é".repeat(50)
    );
    let rendered = render(&body, RenderOptions::default());
    assert!(rendered.errors.is_empty(), "{:?}", rendered.errors);
}

#[test]
fn a_portable_copy_keeps_the_title_headings_labels_and_both_perspectives() {
    let (config, site) = site(&point("Two Views"));
    let projection = PortableProjection::from_post(&site.posts[0], &config).unwrap();
    let output = projection.portable_html().unwrap();
    assert!(output.diagnostics.is_empty(), "{:?}", output.diagnostics);
    assert!(!output.html.contains("<ob-text-compare"));
    assert!(
        output
            .html
            .contains("<h2>Two Views</h2><h3>Core Principle</h3>"),
        "{}",
        output.html
    );
    for words in [
        "Two Views",
        "Core Principle",
        "Conservative View",
        "Tradition anchors us.",
        "Progressive View",
        "Practice from genuine understanding.",
    ] {
        assert!(output.html.contains(words), "{words}: {}", output.html);
    }
    assert_eq!(output.capabilities[0].id, "textual-comparison");
    let markdown = projection.portable_markdown().unwrap();
    assert!(
        markdown.contains("## Two Views\n\n### Core Principle"),
        "{markdown}"
    );
    assert!(
        markdown.contains("**Conservative View:** Tradition anchors us."),
        "{markdown}"
    );
    assert!(!markdown.contains("```text-compare"));
    let text = projection.portable_text().unwrap();
    assert!(
        text.contains("Progressive View") && text.contains("Continuity of sacred wisdom"),
        "{text}"
    );
}

#[test]
fn the_stylesheet_lays_the_two_sides_out_side_by_side() {
    let css = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../../web/base.css"))
        .unwrap();
    let rule = css
        .split("ob-text-compare.ob-text-comparison {")
        .nth(1)
        .expect("the textual comparison layout rule");
    let block = &rule[..rule.find('}').unwrap()];
    assert!(block.contains("display: grid;"), "{block}");
    assert!(
        block.contains("grid-template-columns: repeat(2, minmax(0, 1fr));"),
        "{block}"
    );
}
