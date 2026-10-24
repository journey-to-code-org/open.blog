use openblog_core::{
    generate, project_post, LoadOptions, ProjectionFormat, Site, SiteConfig, SourceFile, Sources,
    ThemeSet,
};

fn research_site() -> Site {
    let config = SiteConfig::from_json(
        r#"{
          "title":"Portable",
          "url":"https://blog.example/base",
          "postPath":"/posts/{slug}/",
          "author":{"name":"Legacy"},
          "contributors":{
            "ada":{"name":"Ada","url":"https://ada.example"},
            "grace":{"name":"Grace","url":"/people/grace/"}
          }
        }"#,
    )
    .unwrap();
    Site::load(
        config,
        Sources {
            posts: vec![SourceFile {
                path: "posts/work.md".into(),
                contents: r#"---
title: Portable work
date: 2026-10-24
profile: research
doi: 10.1234/example
syndicationId: durable-work
---

An authored [relative link](/notes/) with Unicode café.

## References

- [Primary source](https://source.example/paper)
"#
                .into(),
            }],
            credits: vec![SourceFile {
                path: "posts/work.credits.json".into(),
                contents: r#"{"version":1,"credits":[
                  {"contributor":"ada","roles":[{"vocabulary":"crossref","role":"author"}]},
                  {"contributor":"grace","roles":[{"vocabulary":"crossref","role":"editor"}]}
                ]}"#
                .into(),
            }],
            ..Sources::default()
        },
        LoadOptions::default(),
    )
    .unwrap()
}

#[test]
fn one_projection_preserves_identity_attribution_references_and_provenance() {
    let site = research_site();
    let post = &site.posts[0];
    let projection = project_post(post, &site.config).unwrap();

    assert_eq!(
        projection.publication_url,
        "https://blog.example/base/posts/work/"
    );
    assert_eq!(projection.canonical_url, "https://doi.org/10.1234/example");
    assert_eq!(projection.provenance.source_path, "posts/work.md");
    assert_eq!(projection.authors.len(), 2);
    assert_eq!(projection.authors[0].name, "Ada");
    assert_eq!(
        projection.authors[1].url.as_deref(),
        Some("https://blog.example/base/people/grace/")
    );
    assert_eq!(projection.references[0].label, "Primary source");
    assert_eq!(projection.references[0].url, "https://source.example/paper");
    assert!(projection
        .representation(ProjectionFormat::Markdown)
        .body
        .contains("[relative link](https://blog.example/base/notes/)"));
    assert!(projection
        .representation(ProjectionFormat::Text)
        .semantic_losses
        .iter()
        .any(|loss| loss.contains("interactive behavior")));
}

#[test]
fn requesting_projections_does_not_change_native_generation() {
    let site = research_site();
    let themes = ThemeSet::new();
    let before = generate(&site, &themes).unwrap();
    let _ = project_post(&site.posts[0], &site.config).unwrap();
    let after = generate(&site, &themes).unwrap();
    assert_eq!(before, after);
}

#[test]
fn projection_failures_name_the_canonical_source_and_do_not_mutate_it() {
    let mut site = research_site();
    let original = site.posts[0].clone();
    site.config.url = "javascript:alert(1)".into();
    let error = project_post(&site.posts[0], &site.config).unwrap_err();
    assert!(error.contains("posts/work.md"));
    assert!(error.contains("portable projection"));
    assert_eq!(site.posts[0], original);
}
