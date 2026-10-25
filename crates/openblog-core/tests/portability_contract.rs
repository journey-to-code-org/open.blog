use openblog_core::{
    capability::{CapabilityDescriptor, CapabilityDiagnosticCode, PortabilityLevel},
    contributor::CreditProvenance,
    model::CommentsPolicy,
    portability::{PortableProjection, RepresentationFormat},
    LoadOptions, Site, SiteConfig, SourceFile, Sources,
};
use serde_json::Value;

#[test]
fn universal_publishing_example_preserves_public_meaning_across_exports_and_feeds() {
    let config = SiteConfig::from_json(include_str!(
        "../../../examples/portable-publishing/openblog.json"
    ))
    .unwrap();
    let source =
        include_str!("../../../examples/portable-publishing/content/posts/portable-lesson.md");
    let site = Site::load(
        config.clone(),
        Sources {
            posts: vec![SourceFile {
                path: "posts/portable-lesson.md".into(),
                contents: source.into(),
            }],
            credits: vec![SourceFile {
                path: "posts/portable-lesson.credits.json".into(),
                contents: include_str!(
                    "../../../examples/portable-publishing/content/posts/portable-lesson.credits.json"
                )
                .into(),
            }],
            ..Default::default()
        },
        LoadOptions::default(),
    )
    .unwrap();
    let post = &site.posts[0];
    let projection = PortableProjection::from_post(post, &config).unwrap();
    let html = projection.portable_html().unwrap();
    let markdown = projection.portable_markdown().unwrap();
    let text = projection.portable_text().unwrap();
    let rss = openblog_core::feeds::rss(&site).unwrap();
    let feed: Value =
        serde_json::from_str(&openblog_core::feeds::json_feed(&site).unwrap()).unwrap();
    for output in [
        html.html.as_str(),
        markdown.as_str(),
        text.as_str(),
        rss.as_str(),
        feed["items"][0]["content_html"].as_str().unwrap(),
        feed["items"][0]["content_text"].as_str().unwrap(),
    ] {
        for essential in [
            "Alex Example",
            "10.5555/portable.lesson",
            "https://creativecommons.org/licenses/by/4.0/",
            "https://source.example.org/portable-lesson",
            "What does the Rust example print?",
            "Multiplication produces the answer",
            "fn main()",
            "print(6 * 7)",
            "color: navy",
            "querySelector",
            "Expected output",
            "Supporting study",
            "00:15",
            "https://portable.example.org/portable-lesson/",
        ] {
            assert!(
                output.contains(essential),
                "missing {essential:?}:\n{output}"
            );
        }
        for private in [
            "PRIVATE_FRONTMATTER_SENTINEL",
            "PRIVATE_COMMENT_SENTINEL",
            "runner.example.org",
            "discussion.example.org",
            "<ob-",
            "```quiz",
            "```web runnable",
        ] {
            assert!(!output.contains(private), "leaked {private:?}:\n{output}");
        }
    }
    let native = openblog_core::render::generate_document(
        &site,
        &openblog_core::theme::ThemeSet::new(),
        "posts/portable-lesson.md",
    )
    .unwrap();
    for anchor in ["lesson", "references"] {
        assert!(native.contents.contains(&format!("id=\"{anchor}\"")));
        assert!(html.html.contains(&format!(
            "https://portable.example.org/portable-lesson/#{anchor}"
        )));
    }
    assert!(!html.html.contains("<details class=\"ob-quiz-answer\""));
    assert!(html.html.contains("Open in Rust Playground"));
    assert!(markdown.contains("Open in Rust Playground"));
    assert!(html.html.contains("Join the discussion"));
    assert_eq!(
        post.authored_markdown(),
        openblog_core::frontmatter::parse(source).unwrap().body
    );
    for component in [
        "<ob-quiz",
        "<ob-web-sandbox",
        "<ob-code-runner data-language=\"rust\"",
        "<ob-code-runner data-language=\"python\"",
    ] {
        assert!(post.html.contains(component), "native lost {component}");
    }
    assert!(html
        .diagnostics
        .iter()
        .all(|diagnostic| diagnostic.source_path == post.source));
}

fn portability_name(level: PortabilityLevel) -> &'static str {
    match level {
        PortabilityLevel::FullyPortable => "fully-portable",
        PortabilityLevel::GracefullyTransformed => "gracefully-transformed",
        PortabilityLevel::CanonicalOnlyInteraction => "canonical-only-interaction",
    }
}

fn comments_name(policy: CommentsPolicy) -> &'static str {
    match policy {
        CommentsPolicy::Open => "open",
        CommentsPolicy::Locked => "locked",
        CommentsPolicy::Hidden => "hidden",
    }
}

fn credit_provenance_name(provenance: CreditProvenance) -> &'static str {
    match provenance {
        CreditProvenance::LegacySiteAuthor => "legacy-site-author",
        CreditProvenance::ExplicitSidecar => "explicit-sidecar",
    }
}

#[test]
fn portability_fixtures_preserve_semantics_and_native_views() {
    let manifest: Value = serde_json::from_str(include_str!(
        "../../../tests/fixtures/portability-contract.json"
    ))
    .unwrap();
    assert_eq!(manifest["version"], 1);

    for fixture in manifest["fixtures"].as_array().unwrap() {
        let name = fixture["name"].as_str().unwrap();
        let path = fixture["path"].as_str().unwrap();
        assert!(
            !fixture["semantics"].as_str().unwrap().trim().is_empty(),
            "{name}: semantics must be documented"
        );
        let expected = &fixture["expected"];
        let level = expected["level"].as_str().unwrap();
        assert!(
            [
                "fully-portable",
                "gracefully-transformed",
                "canonical-only-interaction",
                "not-public"
            ]
            .contains(&level),
            "{name}: unknown portability level {level}"
        );
        let config = SiteConfig::from_json(&fixture["config"].to_string()).unwrap();
        let credits = fixture
            .get("credits")
            .map(|sidecar| SourceFile {
                path: path
                    .strip_suffix(".md")
                    .map(|stem| format!("{stem}.credits.json"))
                    .unwrap(),
                contents: sidecar.to_string(),
            })
            .into_iter()
            .collect();
        let site = Site::load(
            config.clone(),
            Sources {
                posts: vec![SourceFile {
                    path: path.into(),
                    contents: fixture["source"].as_str().unwrap().into(),
                }],
                credits,
                ..Default::default()
            },
            LoadOptions {
                include_drafts: true,
                ..Default::default()
            },
        )
        .unwrap_or_else(|errors| panic!("{name}: {errors:?}"));
        assert_eq!(site.posts.len(), 1, "{name}");

        let post = &site.posts[0];
        assert_eq!(comments_name(post.comments), expected["comments"], "{name}");
        assert_eq!(
            post.source_url.as_deref(),
            expected["sourceUrl"].as_str(),
            "{name}"
        );
        assert_eq!(
            post.capabilities.len(),
            expected["capabilities"].as_array().unwrap().len(),
            "{name}"
        );

        let projection = PortableProjection::from_post(post, &config);
        if expected["public"] == false {
            let error = projection.unwrap_err();
            assert!(error.contains(path), "{name}: {error}");
            assert!(error.contains("drafts cannot"), "{name}: {error}");
            let title = "Private draft sentinel";
            assert!(!openblog_core::feeds::rss(&site).unwrap().contains(title));
            assert!(!openblog_core::feeds::json_feed(&site)
                .unwrap()
                .contains(title));
            assert!(!openblog_core::feeds::portfolio_snapshot(&site, 4)
                .unwrap()
                .contains(title));
            assert!(!openblog_core::feeds::llms_index(&site)
                .unwrap()
                .contains(title));
            assert!(!openblog_core::feeds::llms_full(&site)
                .unwrap()
                .contains(title));
            continue;
        }

        let projection = projection.unwrap_or_else(|error| panic!("{name}: {error}"));
        assert_eq!(
            projection.canonical_url(),
            config.absolute(&post.url),
            "{name}"
        );
        assert_eq!(
            projection.credit_provenance(),
            post.credit_provenance,
            "{name}"
        );
        assert_eq!(
            credit_provenance_name(projection.credit_provenance()),
            expected["creditProvenance"],
            "{name}"
        );
        assert_eq!(
            projection
                .authors()
                .map(|credit| credit.contributor.name.as_str())
                .collect::<Vec<_>>(),
            expected["authors"]
                .as_array()
                .unwrap()
                .iter()
                .map(Value::as_str)
                .map(Option::unwrap)
                .collect::<Vec<_>>(),
            "{name}"
        );
        assert_eq!(
            projection
                .references()
                .iter()
                .map(|reference| (reference.label.as_str(), reference.url.as_str()))
                .collect::<Vec<_>>(),
            expected["references"]
                .as_array()
                .unwrap()
                .iter()
                .map(|reference| {
                    (
                        reference["label"].as_str().unwrap(),
                        reference["url"].as_str().unwrap(),
                    )
                })
                .collect::<Vec<_>>(),
            "{name}"
        );

        for (actual, expected) in projection
            .capabilities()
            .iter()
            .zip(expected["capabilities"].as_array().unwrap())
        {
            assert_eq!(actual.id, expected["id"], "{name}");
            assert_eq!(
                portability_name(actual.portability),
                expected["portability"],
                "{name}"
            );
            assert_eq!(
                actual.fallback_renderer,
                expected["fallback"].as_str(),
                "{name}"
            );
            assert!(
                actual
                    .authored_semantics
                    .contains(expected["semanticsContains"].as_str().unwrap()),
                "{name}"
            );
        }
        if level == "gracefully-transformed" {
            assert!(!projection.capabilities().is_empty(), "{name}");
            assert!(
                projection
                    .capabilities()
                    .iter()
                    .all(|capability| { portability_name(capability.portability) == level }),
                "{name}"
            );
        }

        let html = projection.representation(RepresentationFormat::Html);
        let markdown = projection.representation(RepresentationFormat::Markdown);
        let text = projection.representation(RepresentationFormat::Text);
        let page = openblog_core::render::generate_document(
            &site,
            &openblog_core::theme::ThemeSet::new(),
            path,
        )
        .unwrap_or_else(|error| panic!("{name}: {error}"));
        let rss =
            openblog_core::feeds::rss(&site).unwrap_or_else(|error| panic!("{name}: {error}"));
        let json_feed: Value = serde_json::from_str(
            &openblog_core::feeds::json_feed(&site)
                .unwrap_or_else(|error| panic!("{name}: {error}")),
        )
        .unwrap_or_else(|error| panic!("{name}: {error}"));
        let full_text = openblog_core::feeds::llms_full(&site)
            .unwrap_or_else(|error| panic!("{name}: {error}"));
        let rss_html = rss
            .split_once("<content:encoded>")
            .and_then(|(_, content)| content.split_once("</content:encoded>"))
            .map(|(content, _)| content)
            .unwrap_or_else(|| panic!("{name}: missing RSS content:encoded"));
        for fragment in expected["htmlContains"].as_array().unwrap_or(&Vec::new()) {
            assert!(
                html.contains(fragment.as_str().unwrap()),
                "{name}: {fragment}"
            );
            assert!(
                page.contents.contains(fragment.as_str().unwrap()),
                "{name} native page: {fragment}"
            );
        }
        for fragment in expected["markdownContains"]
            .as_array()
            .unwrap_or(&Vec::new())
        {
            assert!(
                markdown.contains(fragment.as_str().unwrap()),
                "{name}: {fragment}"
            );
        }
        for fragment in expected["textContains"].as_array().unwrap_or(&Vec::new()) {
            assert!(
                text.contains(fragment.as_str().unwrap()),
                "{name}: {fragment}"
            );
            assert!(
                full_text.contains(fragment.as_str().unwrap()),
                "{name} llms-full: {fragment}"
            );
        }
        for fragment in expected["textExcludes"].as_array().unwrap_or(&Vec::new()) {
            assert!(
                !text.contains(fragment.as_str().unwrap()),
                "{name}: {fragment}"
            );
            assert!(
                !full_text.contains(fragment.as_str().unwrap()),
                "{name} llms-full: {fragment}"
            );
        }
        if let Some(headings) = expected["headingIds"].as_array() {
            assert_eq!(
                post.headings
                    .iter()
                    .map(|heading| heading.id.as_str())
                    .collect::<Vec<_>>(),
                headings
                    .iter()
                    .map(Value::as_str)
                    .map(Option::unwrap)
                    .collect::<Vec<_>>(),
                "{name}"
            );
        }
        if expected["recipe"] == true {
            assert!(post.recipe.is_some(), "{name}");
        }
        for link in expected["links"].as_array().unwrap_or(&Vec::new()) {
            assert_eq!(
                projection
                    .resolve_link(link["input"].as_str().unwrap())
                    .unwrap(),
                link["resolved"],
                "{name}"
            );
        }
        for link in expected["invalidLinks"].as_array().unwrap_or(&Vec::new()) {
            let error = projection.resolve_link(link.as_str().unwrap()).unwrap_err();
            assert!(error.contains(path), "{name}: {error}");
        }

        let portable = projection
            .portable_html()
            .unwrap_or_else(|error| panic!("{name}: {error}"));
        assert!(
            !portable.html.contains("<ob-") && !portable.html.contains("<script"),
            "{name}: portable HTML needs the open.blog runtime"
        );
        for fragment in expected["portableHtmlContains"]
            .as_array()
            .unwrap_or(&Vec::new())
        {
            assert!(
                portable.html.contains(fragment.as_str().unwrap()),
                "{name} portable HTML: {fragment}\n{}",
                portable.html
            );
            assert!(
                rss_html.contains(fragment.as_str().unwrap()),
                "{name} portable RSS: {fragment}"
            );
            assert!(
                json_feed["items"][0]["content_html"]
                    .as_str()
                    .is_some_and(|feed_html| feed_html.contains(fragment.as_str().unwrap())),
                "{name} portable JSON Feed: {fragment}"
            );
        }
        assert!(
            !rss_html.contains("<ob-"),
            "{name}: RSS contains a native component"
        );
        assert!(
            json_feed["items"][0]["content_html"]
                .as_str()
                .is_some_and(|feed_html| !feed_html.contains("<ob-")),
            "{name}: JSON Feed contains a native component"
        );
        assert!(
            json_feed["items"][0]["content_text"]
                .as_str()
                .is_some_and(|content| !content.trim().is_empty()),
            "{name}: JSON Feed content_text is missing"
        );
        assert_eq!(projection.portable_html().unwrap(), portable, "{name}");

        let repeated = PortableProjection::from_post(post, &config).unwrap();
        assert_eq!(
            repeated.canonical_url(),
            projection.canonical_url(),
            "{name}"
        );
        for format in [
            RepresentationFormat::Html,
            RepresentationFormat::Markdown,
            RepresentationFormat::Text,
        ] {
            assert_eq!(
                repeated.representation(format),
                projection.representation(format),
                "{name}: {format:?}"
            );
        }

        if let Some(unknown) = expected.get("unknownDescriptor") {
            let descriptor = CapabilityDescriptor::describe(unknown["id"].as_str().unwrap(), None);
            assert_eq!(descriptor.id, unknown["id"], "{name}");
            assert_eq!(
                portability_name(descriptor.portability),
                unknown["portability"],
                "{name}"
            );
            assert_eq!(
                descriptor.fallback_renderer,
                unknown["fallback"].as_str(),
                "{name}"
            );
            assert_eq!(
                descriptor.diagnostics[0].code,
                CapabilityDiagnosticCode::UnknownCapability,
                "{name}"
            );
            assert_eq!(unknown["diagnostic"], "UnknownCapability", "{name}");
        }
    }
}
