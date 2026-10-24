use openblog_core::capability::{self, CapabilityOccurrence, CapabilitySource, PortabilityLevel};
use openblog_core::{
    classify_source, generate, project_post, LoadOptions, ProjectionFormat, Site, SiteConfig,
    SourceFile, SourceKind, Sources, ThemeSet,
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    schema_version: u32,
    cases: Vec<Case>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Case {
    id: String,
    source: String,
    credit_source: Option<String>,
    visibility: String,
    capabilities: Vec<ExpectedCapability>,
}

#[derive(Debug, Deserialize)]
struct ExpectedCapability {
    id: String,
    semantics: String,
    portability: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectionGolden {
    source: String,
    title: String,
    publication_url: String,
    canonical_url: String,
    authors: Vec<String>,
    references: Vec<String>,
}

fn manifest() -> Manifest {
    serde_json::from_str(include_str!("fixtures/portability/manifest.json")).unwrap()
}

fn fixture(name: &str) -> &'static str {
    match name {
        "standard-unicode.md" => include_str!("fixtures/portability/standard-unicode.md"),
        "research-credits.md" => include_str!("fixtures/portability/research-credits.md"),
        "research-credits.credits.json" => {
            include_str!("fixtures/portability/research-credits.credits.json")
        }
        "legacy-recipe.md" => include_str!("fixtures/portability/legacy-recipe.md"),
        "interactive-media.md" => include_str!("fixtures/portability/interactive-media.md"),
        "hostile-future.md" => include_str!("fixtures/portability/hostile-future.md"),
        "draft.md" => include_str!("fixtures/portability/draft.md"),
        "private-context.md" => include_str!("fixtures/portability/private-context.md"),
        other => panic!("fixture manifest names an unknown source: {other}"),
    }
}

fn site() -> Site {
    let config = SiteConfig::from_json(
        r#"{
          "title":"Portability fixtures",
          "url":"https://fixture.example/blog",
          "postPath":"/posts/{slug}/",
          "author":{"name":"Legacy Author","url":"/about/"},
          "contributors":{
            "ada":{"name":"Ada","url":"https://ada.example"},
            "grace":{"name":"Grace","url":"/people/grace/"}
          },
          "feeds":{"fullContent":true}
        }"#,
    )
    .unwrap();
    let manifest = manifest();
    let mut sources = Sources::default();
    for case in manifest
        .cases
        .iter()
        .filter(|case| case.visibility != "private")
    {
        sources.posts.push(SourceFile {
            path: format!("posts/{}", case.source),
            contents: fixture(&case.source).into(),
        });
        if let Some(credit_source) = &case.credit_source {
            sources.credits.push(SourceFile {
                path: format!("posts/{credit_source}"),
                contents: fixture(credit_source).into(),
            });
        }
    }
    Site::load(config, sources, LoadOptions::default()).unwrap()
}

fn expected_level(value: &str) -> Option<PortabilityLevel> {
    match value {
        "fully-portable" => Some(PortabilityLevel::FullyPortable),
        "gracefully-transformed" => Some(PortabilityLevel::GracefullyTransformed),
        "canonical-only-interaction" => Some(PortabilityLevel::CanonicalOnlyInteraction),
        "unknown" => None,
        other => panic!("unknown fixture portability level: {other}"),
    }
}

#[test]
fn fixtures_declare_real_capabilities_and_forward_compatible_unknowns() {
    let manifest = manifest();
    assert_eq!(manifest.schema_version, 1);
    for case in &manifest.cases {
        let source = fixture(&case.source);
        for expected in &case.capabilities {
            let occurrence = CapabilityOccurrence {
                id: &expected.id,
                authored_semantics: source,
                source: CapabilitySource {
                    path: &case.source,
                    line: 1,
                    column: 1,
                },
            };
            let resolution = capability::resolve(occurrence);
            match expected_level(&expected.portability) {
                Some(level) => {
                    let descriptor = resolution.descriptor.unwrap_or_else(|| {
                        panic!("{} should resolve capability {}", case.id, expected.id)
                    });
                    assert_eq!(descriptor.portability, level);
                    assert_eq!(descriptor.authored_semantics, expected.semantics);
                    assert!(resolution.diagnostic.is_none());
                }
                None => {
                    assert!(resolution.descriptor.is_none());
                    assert!(resolution.diagnostic.is_some());
                    assert!(source.contains(&expected.id));
                    assert!(!expected.semantics.trim().is_empty());
                }
            }
        }
    }
}

#[test]
fn public_projection_summary_matches_the_checked_in_golden_contract() {
    let site = site();
    let mut actual = site
        .posts
        .iter()
        .map(|post| {
            let projection = project_post(post, &site.config).unwrap();
            ProjectionGolden {
                source: projection.provenance.source_path,
                title: projection.title,
                publication_url: projection.publication_url,
                canonical_url: projection.canonical_url,
                authors: projection
                    .authors
                    .into_iter()
                    .map(|author| author.name)
                    .collect(),
                references: projection
                    .references
                    .into_iter()
                    .map(|reference| format!("{}={}", reference.label, reference.url))
                    .collect(),
            }
        })
        .collect::<Vec<_>>();
    actual.sort_by(|left, right| left.source.cmp(&right.source));
    let actual = serde_json::to_value(actual).unwrap();
    let expected: serde_json::Value = serde_json::from_str(include_str!(
        "fixtures/portability/expected-projections.json"
    ))
    .unwrap();
    assert_eq!(actual, expected);
}

#[test]
fn drafts_and_private_context_never_enter_public_projection_or_generated_files() {
    let manifest = manifest();
    let site = site();
    assert!(manifest.cases.iter().any(|case| case.visibility == "draft"));
    assert!(manifest
        .cases
        .iter()
        .any(|case| case.visibility == "private"));
    assert_eq!(
        classify_source(".openblog/private/context/private-context.md"),
        None
    );
    assert!(site
        .posts
        .iter()
        .all(|post| !post.title.contains("SECRET_DRAFT_FIXTURE")));

    let files = generate(&site, &ThemeSet::new()).unwrap();
    let public = files
        .iter()
        .map(|file| file.contents.as_str())
        .collect::<String>();
    assert!(!public.contains("SECRET_DRAFT_FIXTURE"));
    assert!(!public.contains("SECRET_PRIVATE_FIXTURE"));
}

#[test]
fn legacy_unknown_hostile_and_interactive_sources_remain_stable_and_readable() {
    let site = site();
    let first = generate(&site, &ThemeSet::new()).unwrap();
    let second = generate(&site, &ThemeSet::new()).unwrap();
    assert_eq!(first, second);

    let recipe = site
        .posts
        .iter()
        .find(|post| post.title == "Legacy soup")
        .unwrap();
    assert_eq!(recipe.profile, "recipe");
    assert!(recipe.recipe.is_some());

    let future = site
        .posts
        .iter()
        .find(|post| post.title == "Future syntax")
        .unwrap();
    let projection = project_post(future, &site.config).unwrap();
    assert!(projection
        .representation(ProjectionFormat::Markdown)
        .body
        .contains("```future-widget mode=\"unknown\""));
    assert!(projection
        .representation(ProjectionFormat::Html)
        .body
        .contains("javascript:alert(1)"));
    assert!(projection.authors.iter().all(|author| {
        author
            .url
            .as_deref()
            .is_none_or(|url| url.starts_with("http://") || url.starts_with("https://"))
    }));

    assert_eq!(
        classify_source("posts/standard-unicode.md"),
        Some(SourceKind::Post)
    );
}
