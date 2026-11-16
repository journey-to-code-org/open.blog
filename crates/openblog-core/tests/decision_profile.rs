use openblog_core::{
    generate, DateTime, LoadOptions, Site, SiteConfig, SourceFile, Sources, ThemeSet,
};

const BODY: &str = "## Context\n\nA problem.\n\n## Options considered\n\nTwo choices.\n\n## Decision\n\nThe first.\n\n## Consequences\n\nA trade-off.\n";

fn post(name: &str, extra: &str, body: &str) -> SourceFile {
    SourceFile {
        path: format!("posts/{name}.md"),
        contents: format!(
            "---\ntitle: {name}\ndate: 2026-01-01\nprofile: decision\n{extra}---\n{body}"
        ),
    }
}

fn load(posts: Vec<SourceFile>, options: LoadOptions) -> Result<Site, Vec<String>> {
    Site::load(
        SiteConfig::from_json(r#"{"title":"Test","url":"https://example.test"}"#).unwrap(),
        Sources {
            posts,
            ..Default::default()
        },
        options,
    )
}

#[test]
fn published_decision_shows_accessible_status_successor_and_structured_data() {
    let site = load(
        vec![
            post(
                "old",
                "decisionStatus: superseded\nsupersededBy: /posts/new/\n",
                BODY,
            ),
            post("new", "decisionStatus: accepted\n", BODY),
        ],
        LoadOptions::default(),
    )
    .unwrap();
    let files = generate(&site, &ThemeSet::new()).unwrap();
    let page = files
        .iter()
        .find(|file| file.path == "posts/old/index.html")
        .unwrap();
    assert!(page
        .contents
        .contains("Decision status: <strong>superseded</strong>"));
    assert!(page
        .contents
        .contains("href=\"/posts/new/\">Read the decision that supersedes this one</a>"));
    assert!(page
        .contents
        .contains("\"creativeWorkStatus\":\"superseded\""));
}

#[test]
fn incomplete_draft_warns_and_published_record_fails() {
    let draft = post(
        "draft",
        "draft: true\ndecisionStatus: proposed\n",
        "## Context\n",
    );
    let site = load(
        vec![draft],
        LoadOptions {
            include_drafts: true,
            ..Default::default()
        },
    )
    .unwrap();
    assert!(site
        .warnings
        .iter()
        .any(|warning| warning.contains("Options considered")));
    assert!(site.posts[0].decision.is_none());
    let errors = load(
        vec![post("live", "decisionStatus: proposed\n", "## Context\n")],
        LoadOptions::default(),
    )
    .unwrap_err();
    assert!(errors
        .iter()
        .any(|error| error.contains("Options considered")));
}

#[test]
fn incomplete_preview_and_scheduled_record_warn() {
    let preview = post("preview", "decisionStatus: proposed\n", "## Context\n");
    let site = load(
        vec![preview],
        LoadOptions {
            preview_source: Some("posts/preview.md".into()),
            ..Default::default()
        },
    )
    .unwrap();
    assert!(site
        .warnings
        .iter()
        .any(|warning| warning.contains("in this preview")));
    let mut future = post("later", "decisionStatus: proposed\n", "## Context\n");
    future.contents = future.contents.replace("2026-01-01", "2027-01-01");
    let site = load(
        vec![future],
        LoadOptions {
            include_drafts: true,
            now: DateTime::parse("2026-06-01"),
            ..Default::default()
        },
    )
    .unwrap();
    assert!(site
        .warnings
        .iter()
        .any(|warning| warning.contains("until the post is due")));
}

#[test]
fn successor_must_be_public_and_not_self() {
    let old = |target: &str| {
        post(
            "old",
            &format!("decisionStatus: superseded\nsupersededBy: {target}\n"),
            BODY,
        )
    };
    for (record, other) in [
        (old("/posts/old/"), None),
        (old("/posts/missing/"), None),
        (
            old("/posts/new/"),
            Some(post("new", "draft: true\ndecisionStatus: proposed\n", BODY)),
        ),
    ] {
        let mut posts = vec![record];
        posts.extend(other);
        let errors = load(posts, LoadOptions::default()).unwrap_err();
        assert!(errors
            .iter()
            .any(|error| error.contains("another published post or page")));
    }

    let mut future = post("new", "decisionStatus: accepted\n", BODY);
    future.contents = future.contents.replace("2026-01-01", "2027-01-01");
    let errors = load(
        vec![old("/posts/new/"), future],
        LoadOptions {
            include_drafts: true,
            now: DateTime::parse("2026-06-01"),
            ..Default::default()
        },
    )
    .unwrap_err();
    assert!(errors
        .iter()
        .any(|error| error.contains("another published post or page")));
}

#[test]
fn successor_can_be_a_page_and_preview_never_links_a_missing_target() {
    let old = post(
        "old",
        "decisionStatus: superseded\nsupersededBy: /about/\n",
        BODY,
    );
    let config = SiteConfig::from_json(r#"{"title":"Test","url":"https://example.test"}"#).unwrap();
    let sources = Sources {
        posts: vec![old.clone()],
        pages: vec![SourceFile {
            path: "pages/about.md".into(),
            contents: "---\ntitle: About\n---\nAbout.".into(),
        }],
        ..Default::default()
    };
    assert!(Site::load(config, sources, LoadOptions::default()).is_ok());
    let preview = load(
        vec![old],
        LoadOptions {
            preview_source: Some("posts/old.md".into()),
            ..Default::default()
        },
    )
    .unwrap();
    assert!(preview
        .warnings
        .iter()
        .any(|warning| warning.contains("another published post or page")));
    assert!(preview.posts[0].decision.is_none());
}
